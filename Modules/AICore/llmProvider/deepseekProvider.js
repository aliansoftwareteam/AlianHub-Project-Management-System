const axios = require('axios');
const config = require('../../../Config/config');
const { providerTimeoutMs } = require('../../Agents/engine/timeouts');
const { fromOpenAiCompatible } = require('../providerError');
const { normaliseRequest, STRUCTURED_OUTPUT } = require('./normalise');

// DeepSeek exposes an OpenAI-compatible Chat Completions API, so this
// provider mirrors openaiProvider.js almost exactly — same request body
// shape, same `Authorization: Bearer` header, same `response_format`
// JSON mode, and the same `choices[0].message.content` + `usage.*`
// response shape. The base URL is configurable so the same code works
// against DeepSeek's main endpoint or a compatible proxy.
//
// Docs: https://api-docs.deepseek.com/
const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

// DeepSeek's current V4 models — which `deepseek-chat`, `deepseek-reasoner`,
// `deepseek-v4-flash`, and `deepseek-v4-pro` all resolve to — support up to
// 384K output tokens. We keep a generous safety ceiling here, well above the
// orchestrator's 32000 default (LLM_MAX_TOKENS_PLAN), so a normal plan
// request passes through UNCLAMPED while a pathological request is still
// capped before it can 400 or run up a huge bill.
//
// This must be roomy because `deepseek-reasoner` (thinking mode) spends part
// of its output budget on hidden chain-of-thought BEFORE the visible JSON
// answer — the budget has to cover CoT + the full plan. The old 8192 value
// (a DeepSeek-V3-era limit) was far too low and truncated large plans
// mid-output, surfacing as "ran out of output token budget".
// V4 models generate up to 384,000 tokens, sharing a 1M context window with the
// prompt. 262144 stays clear of that ceiling so a long brief plus a long plan
// cannot collide with the context limit, while being roomy enough for the
// largest plans — 65536 was a V3-era figure and truncated them mid-output.
// This is a guard against a pathological request, not a target: a plan only
// spends what it needs, and DeepSeek output runs $0.28 per million.
const DEEPSEEK_MAX_OUTPUT_TOKENS = 262144;

// DeepSeek's reasoning model (`deepseek-reasoner`, i.e. R1) ignores
// sampling params like `temperature` / `top_p`. We omit `temperature`
// for it to match DeepSeek's guidance and avoid relying on undefined
// behavior. Classic `deepseek-chat` honors `temperature` normally.
function isReasoningModel(modelId) {
    if (typeof modelId !== 'string') return false;
    return modelId.toLowerCase().includes('reasoner');
}

function getBaseUrl() {
    const raw = (process.env.DEEPSEEK_BASE_URL || DEFAULT_DEEPSEEK_BASE_URL).trim();
    // Normalize: strip any trailing slash so we can append the path cleanly.
    return raw.replace(/\/+$/, '');
}

const deepseekProvider = {
    name: 'deepseek',
    get isConfigured() {
        return Boolean(config.DEEPSEEK_API_KEY && config.DEEPSEEK_MODEL);
    },
    get model() {
        return config.DEEPSEEK_MODEL || null;
    },
    capabilities: Object.freeze({
        structuredOutput: STRUCTURED_OUTPUT.JSON_OBJECT,
        defaultMaxTokens: DEEPSEEK_MAX_OUTPUT_TOKENS,
        maxOutputTokens: () => DEEPSEEK_MAX_OUTPUT_TOKENS,
        isReasoningModel,
        omitTemperatureWhenReasoning: true,
    }),

    /**
     * @param {import('./types').ChatOptions} opts
     * @returns {Promise<import('./types').ChatResult>}
     */
    async chat(opts) {
        if (!deepseekProvider.isConfigured) {
            throw new Error('DeepSeek provider not configured: set DEEPSEEK_API_KEY and DEEPSEEK_MODEL in .env');
        }
        const messages = [];
        if (opts.systemPrompt) {
            messages.push({ role: 'system', content: opts.systemPrompt });
        }
        for (const m of opts.messages || []) {
            messages.push({ role: m.role, content: m.content });
        }

        const request = normaliseRequest(deepseekProvider, opts);
        const { model, reasoning } = request;

        const body = {
            model,
            messages,
            max_tokens: request.maxTokens,
        };
        if (request.temperature !== null) {
            body.temperature = request.temperature;
        }
        if (request.jsonMode) {
            // DeepSeek requires the literal word "json" somewhere in the
            // prompt when json_object mode is on. The shared output-format
            // partial already instructs JSON-only output, so this is
            // satisfied for both the plan and clarify stages.
            body.response_format = { type: 'json_object' };
        }

        // Reasoner (R1) spends extra wall-clock on hidden chain-of-thought, so
        // it gets the full model budget; DEEPSEEK_TIMEOUT_MS overrides both.
        const timeoutMs = providerTimeoutMs('deepseek', { reasoning });
        const chatUrl = `${getBaseUrl()}/chat/completions`;

        let response;
        try {
            response = await axios.post(chatUrl, body, {
                headers: {
                    Authorization: `Bearer ${config.DEEPSEEK_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                timeout: timeoutMs,
            });
        } catch (error) {
            throw fromOpenAiCompatible('deepseek', model, error);
        }

        const choice = response.data && response.data.choices && response.data.choices[0];
        const usage = response.data && response.data.usage;
        if (!choice || !choice.message) {
            throw new Error('DeepSeek response missing choices[0].message');
        }
        return {
            content: choice.message.content || '',
            inputTokens: (usage && usage.prompt_tokens) || 0,
            outputTokens: (usage && usage.completion_tokens) || 0,
            totalTokens: (usage && usage.total_tokens) || 0,
            model,
            // DeepSeek mirrors OpenAI's `finish_reason`: 'length' means the
            // output hit the token cap (likely the 8192 ceiling) and is
            // truncated, not malformed — so the caller should not waste a
            // JSON-repair retry on it.
            finishReason: choice.finish_reason || null,
            truncated: choice.finish_reason === 'length',
        };
    },
};

module.exports = deepseekProvider;
