const usage = require('./usage');
const taskClass = require('./taskClass');

/**
 * What a model call is about to cost, before it is made.
 *
 * No tokenizer ships with the app (neither tiktoken nor gpt-tokenizer is a
 * dependency), so input is sized from characters. Four characters per token is
 * the documented rule of thumb for English prose and JSON on the GPT and Claude
 * tokenizers; code, URLs and non-Latin text tokenize denser, hence the safety
 * factor. Output is taken at the configured maximum because nothing shorter is
 * guaranteed. The number is a ceiling for a spend gate: erring high refuses a
 * call that would have fit, erring low lets one through, and the second is the
 * defect the gate exists to stop.
 */
const CHARS_PER_TOKEN = 4;
const SAFETY_FACTOR = 1.25;
const PER_MESSAGE_OVERHEAD_TOKENS = 4;

const textOf = (value) => {
    if (typeof value === 'string') return value;
    if (value == null) return '';
    try { return JSON.stringify(value); } catch (e) { return String(value); }
};

function estimateTokens(text) {
    const chars = textOf(text).length;
    return chars ? Math.ceil((chars / CHARS_PER_TOKEN) * SAFETY_FACTOR) : 0;
}

/**
 * @returns {{inputTokens:number, outputTokens:number, totalTokens:number,
 *            model:string, priced:boolean, costUsd:number|null}}
 *          `costUsd` is null and `priced` false for a model with no price on file.
 */
function estimateCall({ systemPrompt, messages, prompt, maxTokens, model } = {}) {
    const turns = Array.isArray(messages) ? messages : (prompt ? [{ role: 'user', content: prompt }] : []);
    const inputTokens = estimateTokens(systemPrompt) + turns.reduce((n, m) => n + estimateTokens(m && m.content) + PER_MESSAGE_OVERHEAD_TOKENS, 0);
    const outputTokens = Math.max(0, Math.ceil(Number(maxTokens) || 0));
    const priced = usage.summarize({ inputTokens, outputTokens }, model || usage.configuredModel() || '');
    return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, model: priced.model, priced: priced.priced, costUsd: priced.costUsd };
}

/**
 * The same estimate, read against the input budget of the task class the
 * feature belongs to. The budget is the platform's own number (taskClass.js),
 * so a prompt that has grown past what its class was sized for is visible on
 * the routing decision instead of only surfacing as a context-length error
 * from whichever vendor answered.
 *
 * Nothing is refused here: an over-budget prompt is a fact about the call, and
 * the model that can hold it is the router's problem, not the estimator's.
 *
 * @returns {{taskClass:string, inputBudgetTokens:number, overInputBudget:boolean,
 *            inputTokens:number, outputTokens:number, totalTokens:number,
 *            model:string, priced:boolean, costUsd:number|null}}
 */
function preflight(request = {}) {
    const key = taskClass.isTaskClass(request.taskClass) ? request.taskClass : taskClass.classOfFeature(request.feature);
    const definition = taskClass.definitionOf(key);
    const call = estimateCall(request);
    return {
        ...call,
        taskClass: key,
        inputBudgetTokens: definition.inputBudgetTokens,
        overInputBudget: call.inputTokens > definition.inputBudgetTokens,
    };
}

module.exports = { estimateTokens, estimateCall, preflight, CHARS_PER_TOKEN, SAFETY_FACTOR, PER_MESSAGE_OVERHEAD_TOKENS };
