// POST /api/v1/ai/project/guide — the project's Guide instructions, generated
// from the approved brief. Nothing here knows what kind of project it is.
'use strict';

const logger = require('../../Config/loggerConfig');
const { tenantOf, TenantError } = require('../../Config/tenant');
const { getProvider, isAnyProviderConfigured } = require('./llmProvider');
const { tryParseJson } = require('./schemaValidator');
const { _readPartial: readPartial } = require('./promptBuilder');
const { usageFromResult, summarize } = require('./usage');

const MIN_BRIEF_CHARS = 20;
const MAX_STAGES = 8;
const MIN_STAGES = 2;
const MAX_LIST = 10;
const MAX_TOKENS = 2500;

const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const strings = (list, n) => (Array.isArray(list) ? list : []).map((s) => clip(typeof s === 'object' && s ? (s.text || s.name) : s, 300)).filter(Boolean).slice(0, n);

const normaliseGuide = (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const stages = (Array.isArray(raw.stages) ? raw.stages : [])
        .map((s) => (typeof s === 'string' ? { name: s, goal: '' } : s))
        .filter((s) => s && clip(s.name, 80))
        .map((s) => ({ name: clip(s.name, 80), goal: clip(s.goal, 300) }))
        .slice(0, MAX_STAGES);
    if (stages.length < MIN_STAGES) return null;
    const guide = {
        stages,
        essentials: strings(raw.essentials, MAX_LIST),
        escalations: strings(raw.escalations, MAX_LIST),
        style: clip(raw.style, 800),
    };
    guide.markdown = guideMarkdown(guide);
    return guide;
};

const guideMarkdown = (guide) => [
    '## Stages',
    ...guide.stages.map((s, i) => `${i + 1}. **${s.name}**${s.goal ? ` — ${s.goal}` : ''}`),
    '',
    '## Essentials to flag',
    ...(guide.essentials.length ? guide.essentials.map((e) => `- ${e}`) : ['- none noted']),
    '',
    '## Escalate to a person when',
    ...(guide.escalations.length ? guide.escalations.map((e) => `- ${e}`) : ['- none noted']),
    '',
    '## Response style',
    guide.style || 'Lead with the clearest next step.',
].join('\n');

const assumptionLines = (assumptions) => (Array.isArray(assumptions) ? assumptions : [])
    .map((a) => (typeof a === 'string' ? a : a && a.text)).filter(Boolean).map((t) => `- ${clip(t, 300)}`);

const planOutline = (plan) => {
    if (!plan || !Array.isArray(plan.sprints)) return '';
    return plan.sprints.slice(0, 30).map((s, i) => {
        const tasks = (Array.isArray(s.tasks) ? s.tasks : []).slice(0, 40).map((t) => `  - ${clip(t.TaskName, 120)}`);
        return [`${i + 1}. ${clip(s.sprintName, 80) || `Sprint ${i + 1}`}`, ...tasks].join('\n');
    }).join('\n');
};

const buildGuideUserMessage = ({ approvedBrief, assumptions, plan }) => [
    '## Approved brief',
    clip(approvedBrief, 12000),
    '',
    '## Assumptions the plan was built on',
    ...(assumptionLines(assumptions).length ? assumptionLines(assumptions) : ['- none']),
    '',
    '## Plan outline',
    planOutline(plan) || '(no plan yet)',
].join('\n');

const generateGuide = async ({ approvedBrief, assumptions, plan }) => {
    const provider = getProvider();
    const result = await provider.chat({
        systemPrompt: readPartial('guide', 'system.md'),
        messages: [{ role: 'user', content: buildGuideUserMessage({ approvedBrief, assumptions, plan }) }],
        jsonMode: true,
        maxTokens: MAX_TOKENS,
        temperature: 0.3,
    });
    const parsed = tryParseJson(result.content);
    const guide = normaliseGuide(parsed.ok ? parsed.value : null);
    if (!guide) throw new Error('The AI did not return a usable guide. Please try again.');
    return { guide, usage: summarize(usageFromResult(result), result.model), model: result.model, provider: result.provider };
};

const sendError = (res, status, message) => res.status(status).send({ status: false, statusText: message, message });

exports.guide = async (req, res) => {
    try {
        if (!req.uid) return sendError(res, 401, 'Unauthorized');
        tenantOf(req);
        const body = req.body || {};
        const approvedBrief = clip(body.approvedBrief, 20000);
        if (approvedBrief.length < MIN_BRIEF_CHARS) return sendError(res, 400, `approvedBrief must be at least ${MIN_BRIEF_CHARS} characters`);
        if (!isAnyProviderConfigured()) return sendError(res, 503, 'No LLM provider is configured');
        const out = await generateGuide({ approvedBrief, assumptions: body.assumptions, plan: body.plan });
        return res.send({ status: true, data: { guide: out.guide }, usage: out.usage, model: out.model, provider: out.provider });
    } catch (error) {
        if (error instanceof TenantError) return sendError(res, error.statusCode, error.message);
        logger.error(`AIPG guide error: ${error && error.message ? error.message : error}`);
        return sendError(res, 500, error && error.message ? error.message : 'Guide generation failed');
    }
};

exports.normaliseGuide = normaliseGuide;
exports.guideMarkdown = guideMarkdown;
exports.buildGuideUserMessage = buildGuideUserMessage;
exports.generateGuide = generateGuide;
