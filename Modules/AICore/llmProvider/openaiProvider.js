const axios = require('axios');
const config = require('../../../Config/config');
const { providerTimeoutMs } = require('../../Agents/engine/timeouts');
const { fromOpenAiCompatible } = require('../providerError');
const { normaliseRequest, STRUCTURED_OUTPUT } = require('./normalise');

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';

/**
 * OpenAI's reasoning models (the `o-series` and `gpt-5-*` family) accept a
 * different set of parameters than the classic chat-completion models:
 *
 *   - They require `max_completion_tokens` instead of `max_tokens` (the older
 *     param returns a 400 "Unsupported parameter").
 *   - They only accept the default `temperature` of 1; sending anything else
 *     returns a 400 "Unsupported value: temperature".
 *   - They still support `response_format: { type: 'json_object' }` so JSON
 *     mode keeps working.
 *
 * Detected by model-id prefix. Conservative: we only treat IDs we're sure
 * are reasoning models as such; everything else uses the classic shape so
 * gpt-4o / gpt-4o-mini / gpt-3.5 / fine-tunes keep their current behavior.
 *
 * Reasoning models also consume tokens internally for their reasoning, so
 * the practical max_completion_tokens budget needs to be generous — we bump
 * the default floor to 16000 for them.
 */
function isReasoningModel(modelId) {
    if (typeof modelId !== 'string') return false;
    const id = modelId.toLowerCase();
    if (id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4')) return true;
    if (id.startsWith('gpt-5')) return true;
    return false;
}

// Each provider clamps the shared LLM_MAX_TOKENS_PLAN ask to what *this*
// model will actually accept. Anthropic and DeepSeek already do this.
// OpenAI did not, so gpt-4o (16,384 max output) 400'd when the env asked
// for 32,000. Caller still asks freely; we bound it here.
function openaiMaxOutputTokens(modelId) {
    const id = String(modelId || '').toLowerCase();
    if (id.startsWith('gpt-5') || id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4')) {
        return 100000;
    }
    if (id.startsWith('gpt-4.1')) return 32768;
    if (id.includes('gpt-4-turbo') || id === 'gpt-4' || id.startsWith('gpt-4-0') || id.startsWith('gpt-3.5')) {
        return 4096;
    }
    // gpt-4o, gpt-4o-mini, and unknown chat models
    return 16384;
}

const openaiProvider = {
    name: 'openai',
    get isConfigured() {
        return Boolean(config.AI_API_KEY && config.AI_MODEL);
    },
    get model() {
        return config.AI_MODEL || null;
    },
    capabilities: Object.freeze({
        structuredOutput: STRUCTURED_OUTPUT.JSON_OBJECT,
        defaultMaxTokens: 32000,
        maxOutputTokens: openaiMaxOutputTokens,
        isReasoningModel,
        omitTemperatureWhenReasoning: true,
    }),

    /**
     * @param {import('./types').ChatOptions} opts
     * @returns {Promise<import('./types').ChatResult>}
     */
    async chat(opts) {
        if (!openaiProvider.isConfigured) {
            throw new Error('OpenAI provider not configured: set AI_API_KEY and AI_MODEL in .env');
        }
        const messages = [];
        if (opts.systemPrompt) {
            messages.push({ role: 'system', content: opts.systemPrompt });
        }
        for (const m of opts.messages || []) {
            messages.push({ role: m.role, content: m.content });
        }

        const request = normaliseRequest(openaiProvider, opts);
        const { model, reasoning, maxTokens } = request;
        const body = { model, messages };
        if (reasoning) {
            body.max_completion_tokens = maxTokens;
        } else {
            body.temperature = request.temperature;
            body.max_tokens = maxTokens;
        }
        if (request.jsonMode) {
            body.response_format = { type: 'json_object' };
        }

        // Reasoning / gpt-5 models burn hidden reasoning tokens before any
        // visible output, so they get the full model budget; OPENAI_TIMEOUT_MS
        // overrides both (see Agents/engine/timeouts for the job lock it feeds).
        const timeoutMs = providerTimeoutMs('openai', { reasoning });

        let response;
        try {
            response = await axios.post(OPENAI_CHAT_URL, body, {
                headers: {
                    Authorization: `Bearer ${config.AI_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                timeout: timeoutMs,
            });
        } catch (error) {
            throw fromOpenAiCompatible('openai', model, error);
        }

        const choice = response.data && response.data.choices && response.data.choices[0];
        const usage = response.data && response.data.usage;
        if (!choice || !choice.message) {
            throw new Error('OpenAI response missing choices[0].message');
        }
        return {
            content: choice.message.content || '',
            inputTokens: (usage && usage.prompt_tokens) || 0,
            outputTokens: (usage && usage.completion_tokens) || 0,
            totalTokens: (usage && usage.total_tokens) || 0,
            model,
            // 'length' from OpenAI means the response was truncated at the
            // token cap — caller should treat this as truncation, not as a
            // bad-JSON case that's worth a repair retry.
            finishReason: choice.finish_reason || null,
            truncated: choice.finish_reason === 'length',
        };
    },
};

module.exports = openaiProvider;
