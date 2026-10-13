const crypto = require('crypto');
const logger = require('../../Config/loggerConfig');
const { FEATURES } = require('../AICore/features');
const { STATE, isAiOff } = require('../AICore/aiSwitch');
const { withTimeout } = require('../AI/withTimeout');
const { crud } = require('./goalStore');

let providerFactory = null;
try {
    providerFactory = require('../AICore/llmProvider');
} catch (_e) {
    providerFactory = null;
}

const REQUEST_TIMEOUT_MS = 60_000;
const SUMMARY_CHAR_CAP = 1200;

const SYSTEM_PROMPT = [
    'You summarise the progress of a goal in a project-management tool for a teammate who has not looked at it.',
    'You are given the goal name, its period and its targets with their numbers.',
    'Write 2-4 short sentences, plain prose, present tense, no bullet points, no headings, no markdown.',
    'Say how far the goal is, which targets are ahead or behind, and what is left. Use only the numbers given.',
    'Never invent facts, names or causes that are not in the input.',
    'Return a single JSON object: {"summary": "<text>"}.',
].join(' ');

const NUMBERS = ['progressPct', 'weight', 'start', 'target', 'current'];
const TEXTS = ['name', 'kind', 'unit', 'currencyCode'];

/* Only the goal's own name, dates and targets with their numbers: never what a target counts, which differs per reader. */
const inputsOf = (goal) => ({
    name: goal.name || '',
    periodStart: goal.periodStart || '',
    periodEnd: goal.periodEnd || '',
    progressPct: goal.progressPct || 0,
    targets: (goal.targets || []).map((target) => ({
        ...Object.fromEntries(TEXTS.filter((key) => target[key] != null).map((key) => [key, target[key]])),
        ...Object.fromEntries(NUMBERS.filter((key) => target[key] != null).map((key) => [key, target[key]])),
        ...(target.kind === 'boolean' ? { done: target.done === true } : {}),
        ...(target.kind === 'tasks' ? { done: (target.counted && target.counted.done) || 0, total: (target.counted && target.counted.total) || 0 } : {}),
    })),
});

const basisOf = (goal) => crypto.createHash('sha256').update(JSON.stringify(inputsOf(goal))).digest('hex');

const promptOf = (goal) => `Goal inputs (JSON):\n${JSON.stringify(inputsOf(goal))}`;

const parseSummary = (content) => {
    if (typeof content !== 'string') return '';
    const text = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
    } catch (_e) {
        return '';
    }
};

/* What a reader is shown: the kept text and when it was made, marked stale once the inputs it was made from have changed. */
const keptView = (goal) => {
    const kept = goal.aiSummary;
    if (!kept || !kept.text) return null;
    return { text: kept.text, madeAt: new Date(kept.madeAt).toISOString(), stale: kept.basis !== basisOf(goal) };
};

const providerReady = () => Boolean(providerFactory && typeof providerFactory.isAnyProviderConfigured === 'function' && providerFactory.isAnyProviderConfigured());

/* The model is called only from here, and here only from the route a person presses a button for. */
async function summariseGoal({ companyId, uid, goal }) {
    if (!providerReady()) return { status: false, aiState: STATE.UNCONFIGURED, reason: 'no LLM provider configured' };
    try {
        const result = await withTimeout(providerFactory.getProvider().chat({
            systemPrompt: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: promptOf(goal) }],
            jsonMode: true,
            temperature: 0.3,
            maxTokens: 400,
            spend: { feature: FEATURES.GOAL_SUMMARY, companyId, userId: uid },
        }), REQUEST_TIMEOUT_MS, 'AI goal summary request timed out');
        const text = parseSummary(result && result.content).slice(0, SUMMARY_CHAR_CAP);
        if (!text) return { status: false, reason: 'no summary returned' };
        const kept = { text, basis: basisOf(goal), madeAt: new Date() };
        await crud(companyId, [{ _id: goal._id }, { $set: { aiSummary: kept } }], 'updateOne');
        return { status: true, summary: { text, madeAt: kept.madeAt.toISOString(), stale: false } };
    } catch (error) {
        logger.error(`goal summary failed: ${(error && error.message) || error}`);
        if (isAiOff(error)) return { status: false, aiState: error.scope === 'instance' ? STATE.OFF_INSTANCE : STATE.OFF_WORKSPACE, reason: error.message };
        return { status: false, reason: (error && error.message) || 'summary error' };
    }
}

module.exports = { summariseGoal, keptView, inputsOf, basisOf, promptOf, parseSummary };
