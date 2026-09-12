/* Every adapter shapes one request out of the same chat options, so a caller
 * never has to know which provider it landed on. What differs between vendors
 * is declared, not branched on: each adapter exports `capabilities`, and this
 * module turns those plus the caller's options into the values every vendor
 * needs — the model id, the output ceiling, the temperature, and how
 * structured output is asked for. */

const STRUCTURED_OUTPUT = Object.freeze({
    JSON_OBJECT: 'json_object',
    RESPONSE_MIME_TYPE: 'response_mime_type',
    SYSTEM_PROMPT: 'system_prompt',
});

const JSON_ONLY_INSTRUCTION = 'Respond with ONLY a single valid JSON object. No prose, no markdown fences. The first character must be `{` and the last must be `}`.';

const DEFAULT_TEMPERATURE = 0.4;

/* The router flag. `off` — the default — is today's behaviour exactly: the
 * configured provider answers every call and a model named on the chat options
 * is ignored, so the registry can ship before a policy exists to drive it. */
const routerEnabled = () => String(process.env.AI_MODEL_ROUTER || 'off').trim().toLowerCase() === 'on';

/* The model this call will actually send. A model on the chat options only
 * wins while the router is on; otherwise the adapter's configured model does. */
function resolveModel(adapter, opts) {
    const asked = opts && opts.model ? String(opts.model).trim() : '';
    if (asked && routerEnabled()) return asked;
    return (adapter && adapter.model) || null;
}

function capabilitiesOf(adapter) {
    const caps = (adapter && adapter.capabilities) || {};
    const defaultMaxTokens = caps.defaultMaxTokens || 32000;
    return {
        structuredOutput: caps.structuredOutput || STRUCTURED_OUTPUT.SYSTEM_PROMPT,
        defaultMaxTokens,
        maxOutputTokens: typeof caps.maxOutputTokens === 'function' ? caps.maxOutputTokens : () => defaultMaxTokens,
        isReasoningModel: typeof caps.isReasoningModel === 'function' ? caps.isReasoningModel : () => false,
        omitTemperatureWhenReasoning: caps.omitTemperatureWhenReasoning === true,
    };
}

/**
 * @returns {{model: string|null, maxTokens: number, temperature: number|null,
 *            reasoning: boolean, jsonMode: boolean, structuredOutput: string}}
 *          `temperature` is null when this model refuses the parameter, which
 *          means "send no temperature at all", not "send zero".
 */
function normaliseRequest(adapter, opts = {}) {
    const caps = capabilitiesOf(adapter);
    const model = resolveModel(adapter, opts);
    const reasoning = Boolean(caps.isReasoningModel(model));
    const ceiling = Number(caps.maxOutputTokens(model)) || caps.defaultMaxTokens;
    const asked = Number(opts.maxTokens) > 0 ? Number(opts.maxTokens) : caps.defaultMaxTokens;
    const fixedTemperature = reasoning && caps.omitTemperatureWhenReasoning;
    return {
        model,
        maxTokens: Math.min(asked, ceiling),
        temperature: fixedTemperature ? null : (typeof opts.temperature === 'number' ? opts.temperature : DEFAULT_TEMPERATURE),
        reasoning,
        jsonMode: Boolean(opts.jsonMode),
        structuredOutput: caps.structuredOutput,
    };
}

module.exports = { normaliseRequest, resolveModel, capabilitiesOf, routerEnabled, STRUCTURED_OUTPUT, JSON_ONLY_INSTRUCTION, DEFAULT_TEMPERATURE };
