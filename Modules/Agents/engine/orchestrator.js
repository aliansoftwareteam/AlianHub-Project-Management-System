const logger = require('../../../Config/loggerConfig');
const { getProvider, isAnyProviderConfigured } = require('../../AIProjectGenerator/llmProvider');
const { emptyUsage, usageFromResult, addUsage } = require('../../AIProjectGenerator/usage');
const { audit, extractUrl } = require('./pageAudit');
const qaReview = require('../skills/qaReview');
const skillIndex = require('../skills');

// A deterministic five-phase pipeline, not a free-roaming agent loop:
//
//   gather → ground → analyse → verify → emit
//
// The model is invoked exactly once, in `analyse`, and only to prioritise and
// phrase facts that `ground` already measured. Cost is therefore bounded and
// predictable, the same input produces the same shape of output, and a
// hallucinated finding has nowhere to enter — `verify` drops anything whose
// factId was not measured.

const LOG_PREFIX = '[agent]';
const SKILLS = skillIndex.BY_SLUG;

const getSkill = (slug) => skillIndex.getSkill(slug);

const SEVERITY = ['high', 'medium', 'low'];
const rank = (s) => { const i = SEVERITY.indexOf(String(s).toLowerCase()); return i === -1 ? 2 : i; };

/* Strip markdown fences some models wrap JSON in, then parse. A parse failure is
 * a failed run, never a silent empty result — silence would read as "clean page". */
function parseModelJson(raw) {
    const text = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
    try { return { ok: true, value: JSON.parse(text) }; }
    catch (e) { return { ok: false, error: `model did not return valid JSON: ${e.message}` }; }
}

/* PHASE 4 — verify. The gate that makes this trustworthy.
 *  - evidence: a finding must name a fact id that actually failed
 *  - dedup: one finding per fact
 *  - cap: bounded volume, worst-first
 * Anything dropped is counted and reported, so a silent filter cannot hide a bug. */
function verify(findings, auditResult, skill) {
    const failingIds = new Set(auditResult.facts.filter((f) => !f.ok).map((f) => f.id));
    const seen = new Set();
    const kept = [];
    const dropped = [];

    for (const f of Array.isArray(findings) ? findings : []) {
        const factId = String(f?.factId || '');
        if (!failingIds.has(factId)) { dropped.push({ title: f?.title || '(untitled)', reason: `no failing fact "${factId}"` }); continue; }
        if (seen.has(factId)) { dropped.push({ title: f?.title || '(untitled)', reason: `duplicate of ${factId}` }); continue; }
        if (!f.title || !String(f.title).trim()) { dropped.push({ title: '(untitled)', reason: 'no title' }); continue; }
        seen.add(factId);
        const fact = auditResult.facts.find((x) => x.id === factId);
        kept.push({
            factId,
            title: String(f.title).trim().slice(0, 180),
            severity: SEVERITY.includes(String(f.severity).toLowerCase()) ? String(f.severity).toLowerCase() : 'medium',
            why: String(f.why || '').trim().slice(0, 400),
            fix: String(f.fix || '').trim().slice(0, 600),
            evidence: fact ? fact.detail : null,
        });
    }

    kept.sort((a, b) => rank(a.severity) - rank(b.severity));
    const capped = kept.slice(0, skill.maxFindings);
    if (kept.length > capped.length) {
        dropped.push({ title: `${kept.length - capped.length} more`, reason: `over the ${skill.maxFindings}-finding cap` });
    }
    return { findings: capped, dropped };
}

/* Deterministic fallback: every failing fact becomes a finding, worded from the
 * fact itself. Used when no LLM is configured or the call fails — a QA run that
 * reports nothing because a provider was down would be actively misleading. */
function findingsWithoutModel(auditResult, skill) {
    return auditResult.facts.filter((f) => !f.ok).slice(0, skill.maxFindings).map((f) => ({
        factId: f.id,
        title: `Fix: ${f.detail}`,
        severity: f.id === 'og_image' || f.id === 'viewport' ? 'high' : 'medium',
        why: 'Detected by the deterministic page audit.',
        fix: f.evidence ? `Evidence: ${f.evidence}` : '',
        evidence: f.detail,
    }));
}

/* Skills other than the page audit: gather their own input, ask the model once,
 * and hand back a summary plus the changes the run should propose or apply. */
async function runGeneric(skill, { task, companyId, budget = {} }) {
    const started = Date.now();
    let usage = emptyUsage();
    const context = await skill.gather({ task, companyId });
    if (!context || context.skip) {
        return { status: 'skipped', reason: (context && context.skip) || 'nothing to work on', skill: skill.slug, usage, durationMs: Date.now() - started };
    }
    let raw = null; let modelUsed = null; let degraded = null;
    if (isAnyProviderConfigured() && budget.allowModel !== false) {
        try {
            const provider = getProvider();
            const result = await provider.chat({
                systemPrompt: skill.systemPrompt,
                messages: [{ role: 'user', content: skill.buildUserPrompt({ task, context }) }],
                maxTokens: Math.min(skill.maxTokens, budget.maxTokens || skill.maxTokens),
                temperature: 0.2,
                jsonMode: true,
            });
            usage = addUsage(usage, usageFromResult(result));
            modelUsed = result.model || null;
            const parsed = parseModelJson(result.content);
            if (parsed.ok) raw = parsed.value; else degraded = parsed.error;
        } catch (error) {
            degraded = `model call failed: ${error.message}`;
            logger.error(`${LOG_PREFIX} ${degraded}`);
        }
    } else {
        degraded = 'no LLM provider configured';
    }
    if (!raw && !context.fallback) {
        return { status: 'failed', reason: degraded || 'the model returned nothing usable', skill: skill.slug, usage, model: modelUsed, durationMs: Date.now() - started };
    }
    const { summary, changes } = skill.toChanges({ task, raw, context });
    return { status: 'success', skill: skill.slug, model: modelUsed, degraded, summary, changes, findings: [], usage, durationMs: Date.now() - started };
}

async function run({ skillSlug = 'qa-review', task, companyId, budget = {} }) {
    const skill = getSkill(skillSlug);
    if (!skill) throw Object.assign(new Error(`unknown skill "${skillSlug}"`), { deterministic: true });
    if (skill.kind === 'generic') return runGeneric(skill, { task, companyId, budget });

    const started = Date.now();
    let usage = emptyUsage();

    // ── 1. gather ────────────────────────────────────────────────────────────
    const url = extractUrl(task?.TaskName) || extractUrl(task?.description) || extractUrl(task?.rawDescription);
    if (!url) {
        const text = [task?.TaskName, task?.description, task?.rawDescription].join(' ');
        const privateUrl = /https?:\/\/(localhost|127\.|10\.|192\.168\.|0\.0\.0\.0|\[?::1)/i.test(text);
        return { status: 'skipped',
                 reason: privateUrl
                     ? 'the URL points at a private or local host, which agents do not fetch — use a public address'
                     : 'no reviewable URL found in the task title or description',
                 skill: skill.slug, findings: [], usage, durationMs: Date.now() - started };
    }

    // ── 2. ground ────────────────────────────────────────────────────────────
    let auditResult;
    try {
        auditResult = await audit(url);
    } catch (error) {
        return { status: 'failed', reason: `could not fetch ${url}: ${error.message}`,
                 skill: skill.slug, url, findings: [], usage, durationMs: Date.now() - started };
    }
    if (!auditResult.ok) {
        return { status: 'failed', reason: auditResult.fatal, skill: skill.slug, url,
                 findings: [], usage, durationMs: Date.now() - started };
    }

    // ── 3. analyse ───────────────────────────────────────────────────────────
    let raw = null;
    let modelUsed = null;
    let degraded = null;
    if (isAnyProviderConfigured() && budget.allowModel !== false) {
        try {
            const provider = getProvider();
            const result = await provider.chat({
                systemPrompt: skill.systemPrompt,
                messages: [{ role: 'user', content: skill.buildUserPrompt({ task, audit: auditResult }) }],
                maxTokens: Math.min(skill.maxTokens, budget.maxTokens || skill.maxTokens),
                temperature: 0.2,
                jsonMode: true,
            });
            usage = addUsage(usage, usageFromResult(result));
            modelUsed = result.model || null;
            const parsed = parseModelJson(result.content);
            if (parsed.ok) raw = parsed.value;
            else degraded = parsed.error;
        } catch (error) {
            degraded = `model call failed: ${error.message}`;
            logger.error(`${LOG_PREFIX} ${degraded}`);
        }
    } else {
        degraded = 'no LLM provider configured';
    }

    // ── 4. verify ────────────────────────────────────────────────────────────
    const proposed = raw?.findings ?? findingsWithoutModel(auditResult, skill);
    const { findings, dropped } = raw
        ? verify(proposed, auditResult, skill)
        : { findings: proposed, dropped: [] };

    // ── 5. emit (the caller writes; this only decides WHAT) ──────────────────
    const passing = auditResult.facts.filter((f) => f.ok).length;
    return {
        status: 'success',
        skill: skill.slug,
        url,
        model: modelUsed,
        degraded,
        summary: raw?.summary || `Audited ${url}: ${auditResult.facts.length - passing} issue(s) across ${auditResult.facts.length} checks.`,
        notes: raw?.notes || null,
        findings,
        dropped,
        checksRun: auditResult.facts.length,
        checksPassed: passing,
        blindSpots: auditResult.blindSpots,
        usage,
        durationMs: Date.now() - started,
    };
}

module.exports = { run, runGeneric, verify, parseModelJson, findingsWithoutModel, getSkill, SKILLS };
