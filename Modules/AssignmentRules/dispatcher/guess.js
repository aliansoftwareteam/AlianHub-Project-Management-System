const { isAnyProviderConfigured } = require('../../AICore/llmProvider');
const { modelGuesser } = require('./modelGuesser');

// The model's guess at a role, asked only with a server key set and the project's model guess switched on (./gate).
// It is given the task's title, type, tags and description and each enabled role's name and 'who it is', nothing else.
// `use` swaps the guesser; tests use it to stand in for the model.

const TIMEOUT_MS = 20000;

let guesser = modelGuesser;
let timeoutMs = TIMEOUT_MS;

const use = (fn, { timeout = TIMEOUT_MS } = {}) => {
    guesser = typeof fn === 'function' ? fn : null;
    timeoutMs = timeout;
};

const TIMED_OUT = Symbol('timed out');

const within = async (work, ms) => {
    let timer;
    const late = new Promise((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), ms); });
    try {
        return await Promise.race([work, late]);
    } finally {
        clearTimeout(timer);
    }
};

/* { role, confidence 0-100, reason } naming one of `roles`, { failed: why } when the guess could not be made, or null. */
const guess = async ({ companyId, task, roles }) => {
    if (!guesser || !roles.length || !isAnyProviderConfigured()) return null;
    let answer;
    try {
        answer = await within(Promise.resolve().then(() => guesser({ companyId, task, roles })), timeoutMs);
    } catch (error) {
        return { failed: 'model_failed' };
    }
    if (answer === TIMED_OUT) return { failed: 'model_timeout' };
    if (answer && answer.failed) return { failed: String(answer.failed) };
    if (!answer || !roles.some((role) => role.key === answer.role)) return null;
    const confidence = Math.max(0, Math.min(100, Number(answer.confidence) || 0));
    return { role: answer.role, confidence, reason: String(answer.reason || '') };
};

module.exports = { TIMEOUT_MS, use, guess };
