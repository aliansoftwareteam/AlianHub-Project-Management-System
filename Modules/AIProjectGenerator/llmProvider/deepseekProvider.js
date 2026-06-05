const axios = require('axios');
const config = require('../../../Config/config');

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
const DEEPSEEK_MAX_OUTPUT_TOKENS = 65536;

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

        const reasoning = isReasoningModel(config.DEEPSEEK_MODEL);

        // Clamp to DeepSeek's hard 8192-token output ceiling regardless of
        // what the caller requested.
        const requestedMax = opts.maxTokens || DEEPSEEK_MAX_OUTPUT_TOKENS;
        const maxTokens = Math.min(requestedMax, DEEPSEEK_MAX_OUTPUT_TOKENS);

        const body = {
            model: config.DEEPSEEK_MODEL,
            messages,
            max_tokens: maxTokens,
        };
        if (!reasoning) {
            body.temperature = typeof opts.temperature === 'number' ? opts.temperature : 0.4;
        }
        if (opts.jsonMode) {
            // DeepSeek requires the literal word "json" somewhere in the
            // prompt when json_object mode is on. The shared output-format
            // partial already instructs JSON-only output, so this is
            // satisfied for both the plan and clarify stages.
            body.response_format = { type: 'json_object' };
        }

        // Reasoner (R1) spends extra wall-clock on hidden chain-of-thought
        // before emitting visible output, so give it a longer default
        // timeout. Both are overridable via DEEPSEEK_TIMEOUT_MS.
        const defaultTimeout = reasoning ? 600000 : 240000;
        const timeoutMs = Number(process.env.DEEPSEEK_TIMEOUT_MS) || defaultTimeout;
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
        } catch (axiosErr) {
            const status = axiosErr.response && axiosErr.response.status;
            const errBody = axiosErr.response && axiosErr.response.data && axiosErr.response.data.error;
            const apiMsg = errBody && errBody.message;
            const apiCode = errBody && errBody.code;

            // DeepSeek uses 402 Payment Required for an exhausted balance and
            // 429 for genuine rate limits — cleaner than OpenAI's overloaded
            // 429. Map each to the right user-facing message + error code.
            if (status === 402) {
                const err = new Error(
                    'Your DeepSeek account is out of credits. Please add balance to your DeepSeek '
                    + 'account (https://platform.deepseek.com/top_up) and try again.',
                );
                err.code = 'LLM_QUOTA_EXCEEDED';
                throw err;
            }
            if (status === 429) {
                const isQuotaIssue = apiCode === 'insufficient_quota'
                    || (typeof apiMsg === 'string' && /quota|billing|credit|balance/i.test(apiMsg));
                if (isQuotaIssue) {
                    const err = new Error(
                        'Your DeepSeek account is out of credits. Please add balance to your DeepSeek '
                        + 'account (https://platform.deepseek.com/top_up) and try again.',
                    );
                    err.code = 'LLM_QUOTA_EXCEEDED';
                    throw err;
                }
                const err = new Error('The AI service is rate-limited (too many requests). Please wait about a minute and try again.');
                err.code = 'LLM_RATE_LIMITED';
                throw err;
            }
            if (status === 401) {
                const err = new Error('Invalid DeepSeek API key. Please check your DEEPSEEK_API_KEY configuration.');
                err.code = 'LLM_AUTH_FAILED';
                throw err;
            }
            if (status === 403) {
                const err = new Error('DeepSeek API access denied. Check your API key permissions.');
                err.code = 'LLM_AUTH_FAILED';
                throw err;
            }
            if (status === 400) {
                const err = new Error(apiMsg || 'Invalid request to DeepSeek API. Check your model configuration.');
                err.code = 'LLM_BAD_REQUEST';
                throw err;
            }
            if (status === 503 || status === 502) {
                const err = new Error('The AI service is temporarily unavailable. Please try again in a moment.');
                err.code = 'LLM_UNAVAILABLE';
                throw err;
            }
            if (axiosErr.code === 'ECONNABORTED' || axiosErr.code === 'ETIMEDOUT') {
                const err = new Error('The AI request timed out. Please try again.');
                err.code = 'LLM_TIMEOUT';
                throw err;
            }
            const fallback = new Error(apiMsg || axiosErr.message || 'DeepSeek request failed');
            fallback.code = 'LLM_ERROR';
            throw fallback;
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
            model: config.DEEPSEEK_MODEL,
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
