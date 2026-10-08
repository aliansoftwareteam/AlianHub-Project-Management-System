const { FEATURES } = require('../../AICore/features');
const aiSwitch = require('../../AICore/aiSwitch');
const { askModel } = require('../../AICore/modelCall');
const usage = require('../../AICore/usage');
const budget = require('../../Agents/budget');
const prompts = require('../prompts');

const REASON_CAP = 200;
const WHO_CAP = 300;

const DECIDE = Object.freeze({
    maxTokens: 200,
    systemPrompt: [
        'You pick which role of a team should take one project task.',
        'Each role has a key, a name and a line saying who it is.',
        'Pick the one role whose description best fits the task, or none when no role clearly fits.',
        'Never pick a role that is not in the list, and never invent or alter a key.',
        'Return exactly one JSON object: {"role": "<a role key>" or null, "confidence": <whole number 0-100, how sure you are>, "reason": "<one line of at most 15 words>"}.',
    ].join(' '),
});

const promptOf = ({ title, type, tags, description }, roles) => [
    prompts.taskBlock({ title, type, tags, description }),
    '',
    'Roles',
    ...roles.map((role) => `- key: ${role.key} | name: ${prompts.oneLine(role.name, 80)} | who it is: ${prompts.oneLine(role.who, WHO_CAP)}`),
].join('\n');

const checked = async (why, read) => {
    try {
        return { value: await read() };
    } catch (error) {
        return { failed: why };
    }
};

/* Needs a priced model so the call's cost is always known, and stops at the company's monthly agent budget. A check that
 * throws sends the task to Needs routing with the reason, rather than leaving it unrouted. */
async function allowed(companyId) {
    const ai = await checked('ai_check_failed', () => aiSwitch.allowed(companyId));
    if (ai.failed) return ai;
    if (!ai.value) return { ok: false };
    const model = usage.checkConfiguredModelPriced();
    if (!model.ok || !model.model) return { ok: false };
    const spend = await checked('budget_check_failed', () => budget.check(companyId));
    if (spend.failed) return spend;
    return { ok: Boolean(spend.value && spend.value.ok) };
}

async function modelGuesser({ companyId, task, roles }) {
    const gate = await allowed(companyId);
    if (gate.failed) return { failed: gate.failed };
    if (!gate.ok) return null;
    const answer = await askModel(DECIDE, {
        prompt: promptOf(task, roles),
        budget: {},
        spend: { feature: FEATURES.ASSIGNMENT_RULES, companyId: String(companyId) },
    });
    if (!answer.raw && /^model call failed/.test(answer.degraded || '')) return { failed: 'model_failed' };
    const value = answer.raw && typeof answer.raw === 'object' ? answer.raw : null;
    if (!value || typeof value.role !== 'string') return null;
    return { role: value.role.trim(), confidence: Number(value.confidence), reason: prompts.oneLine(value.reason, REASON_CAP) };
}

module.exports = { modelGuesser, DECIDE };
