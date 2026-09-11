const { emptyUsage } = require('../../AICore/usage');
const { askModel, parseModelJson } = require('../../AICore/modelCall');
const { FEATURES } = require('../../AICore/features');
const { audit, extractUrl } = require('./pageAudit');
const { isBlockedHostname } = require('./safeFetch');
const skillIndex = require('../skills');
const skillRecord = require('../skillRecord');
const { narrowChanges } = require('../skills/effectiveActions');

// A deterministic pipeline, not a free-roaming agent loop:
//
//   gather → ground → analyse → verify → emit
//
// `gather` and `analyse` are separately callable so the run graph can hold a
// checkpoint between them; `run` is the two in sequence for callers that want
// the whole pipeline. The model is invoked exactly once, in `analyse`, and only
// to prioritise and phrase facts that `ground` already measured. Cost is
// therefore bounded and predictable, the same input produces the same shape of
// output, and a hallucinated finding has nowhere to enter — `verify` drops
// anything whose factId was not measured.

const SKILLS = skillIndex.BY_SLUG;
const GATHERED = 'gathered';

const getSkill = (slug) => skillIndex.getSkill(slug);

/* A company's data skill first, the built-in code skill second. */
const requireSkill = async (companyId, slug) => {
    const skill = companyId ? await skillRecord.getSkill(companyId, slug) : getSkill(slug);
    if (!skill) throw Object.assign(new Error(`unknown skill "${slug}"`), { deterministic: true });
    return skill;
};

const SEVERITY = ['high', 'medium', 'low'];
const rank = (s) => { const i = SEVERITY.indexOf(String(s).toLowerCase()); return i === -1 ? 2 : i; };

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

const skipped = (skill, reason, started) => ({ status: 'skipped', reason, skill: skill.slug, findings: [], usage: emptyUsage(), durationMs: Date.now() - started });

/* The spend guard refused the call before the vendor saw it: no fallback, no
 * findings, the run stops with the guard's reason. */
const refused = (skill, { refused: ticket, model, usage }, started) => ({ status: 'refused', reason: ticket.reason, code: ticket.code, skill: skill.slug, findings: [], usage, model, durationMs: Date.now() - started });

/* PHASE 1 — gather. A generic skill collects its own input; the page audit
 * needs a public URL in the task. Either declines with `skipped`. */
async function gather({ skillSlug = 'qa-review', task, companyId, memory, startedBy }) {
    const skill = await requireSkill(companyId, skillSlug);
    const started = Date.now();
    if (skill.kind === 'generic') {
        const context = await skill.gather({ task, companyId, memory, startedBy });
        if (!context || context.skip) return skipped(skill, (context && context.skip) || 'nothing to work on', started);
        return { status: GATHERED, skill: skill.slug, context };
    }
    const url = extractUrl(task?.TaskName) || extractUrl(task?.description) || extractUrl(task?.rawDescription);
    if (url) return { status: GATHERED, skill: skill.slug, context: { url } };
    const text = [task?.TaskName, task?.description, task?.rawDescription].join(' ');
    const privateUrl = (text.match(/https?:\/\/[^\s<>"')]+/gi) || []).some((u) => { try { return isBlockedHostname(new URL(u).hostname); } catch (e) { return false; } });
    return skipped(skill, privateUrl
        ? 'the URL points at a private or local host, which agents do not fetch — use a public address'
        : 'no reviewable URL found in the task title or description', started);
}

/* Skills other than the page audit: ask the model once about the gathered
 * context and hand back a summary plus the changes the run should propose or apply. */
async function analyseGeneric(skill, { task, context, budget, spend, agent }) {
    const started = Date.now();
    const asked = await askModel(skill, { prompt: skill.buildUserPrompt({ task, context }), budget, spend });
    if (asked.refused) return refused(skill, asked, started);
    const { raw: answer, model, degraded, usage } = asked;
    if (!answer && !context.fallback) {
        return { status: 'failed', reason: degraded || 'the model returned nothing usable', skill: skill.slug, usage, model, durationMs: Date.now() - started };
    }
    let raw = answer;
    let dropped = [];
    if (raw && typeof skill.verify === 'function') ({ raw, dropped } = skill.verify({ raw, context }));
    const emitted = skill.toChanges({ task, raw, context });
    const narrowed = narrowChanges(agent, skill, emitted.changes);
    dropped = dropped.concat(Array.isArray(emitted.dropped) ? emitted.dropped : [], narrowed.dropped);
    return { status: 'success', skill: skill.slug, model, degraded, summary: emitted.summary, changes: narrowed.changes, dropped, findings: [], usage, durationMs: Date.now() - started };
}

/* The page audit: ground → analyse → verify → emit. The caller writes; this
 * only decides WHAT. */
async function analyseAudit(skill, { task, context, budget, spend }) {
    const started = Date.now();
    const { url } = context;
    let auditResult;
    try {
        auditResult = await audit(url);
    } catch (error) {
        return { status: 'failed', reason: `could not fetch ${url}: ${error.message}`, skill: skill.slug, url, findings: [], usage: emptyUsage(), durationMs: Date.now() - started };
    }
    if (!auditResult.ok) {
        return { status: 'failed', reason: auditResult.fatal, skill: skill.slug, url, findings: [], usage: emptyUsage(), durationMs: Date.now() - started };
    }

    const asked = await askModel(skill, { prompt: skill.buildUserPrompt({ task, audit: auditResult }), budget, spend });
    if (asked.refused) return refused(skill, asked, started);
    const { raw, model, degraded, usage } = asked;

    const proposed = raw?.findings ?? findingsWithoutModel(auditResult, skill);
    const { findings, dropped } = raw
        ? verify(proposed, auditResult, skill)
        : { findings: proposed, dropped: [] };

    const passing = auditResult.facts.filter((f) => f.ok).length;
    return {
        status: 'success',
        skill: skill.slug,
        url,
        model,
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

/* PHASES 2–5 on a gathered context. */
async function analyse({ skillSlug = 'qa-review', task, context, budget = {}, spend, companyId, agent }) {
    const skill = await requireSkill(companyId || (spend && spend.companyId), skillSlug);
    return skill.kind === 'generic' ? analyseGeneric(skill, { task, context, budget, spend, agent }) : analyseAudit(skill, { task, context, budget, spend });
}

async function run({ skillSlug = 'qa-review', task, companyId, budget = {}, spend, agent }) {
    const started = Date.now();
    const gathered = await gather({ skillSlug, task, companyId });
    if (gathered.status !== GATHERED) return gathered;
    const result = await analyse({ skillSlug, task, context: gathered.context, budget, spend: spend || { feature: FEATURES.AGENT_RUN, companyId }, companyId, agent });
    return { ...result, durationMs: Date.now() - started };
}

const runGeneric = (skill, args) => run({ ...args, skillSlug: skill.slug });

module.exports = { GATHERED, gather, analyse, run, runGeneric, verify, parseModelJson, findingsWithoutModel, getSkill, SKILLS };
