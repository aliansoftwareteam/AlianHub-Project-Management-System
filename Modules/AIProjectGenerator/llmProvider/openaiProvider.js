const axios = require('axios');
const config = require('../../../Config/config');

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

const openaiProvider = {
    name: 'openai',
    get isConfigured() {
        return Boolean(config.AI_API_KEY && config.AI_MODEL);
    },

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

        const reasoning = isReasoningModel(config.AI_MODEL);
        const body = {
            model: config.AI_MODEL,
            messages,
        };
        if (reasoning) {
            // Reasoning models: leave temperature at the default (any explicit
            // value returns 400) and use max_completion_tokens. Reasoning
            // models burn hidden tokens internally on top of the visible
            // output, so a roomy default is essential.
            body.max_completion_tokens = opts.maxTokens || 32000;
        } else {
            body.temperature = typeof opts.temperature === 'number' ? opts.temperature : 0.4;
            body.max_tokens = opts.maxTokens || 32000;
        }
        if (opts.jsonMode) {
            body.response_format = { type: 'json_object' };
        }

        // Allow timeout overrides via env so operators can tune without a
        // code change. Reasoning / gpt-5 models need generous headroom because
        // they burn hidden reasoning tokens before producing visible output,
        // and a richer system prompt (more rules, more example tasks) directly
        // increases generation time. Default: 10 min for reasoning, 4 min for
        // classic chat models.
        const defaultTimeout = reasoning ? 600000 : 240000;
        const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS) || defaultTimeout;

        const response = await axios.post(OPENAI_CHAT_URL, body, {
            headers: {
                Authorization: `Bearer ${config.AI_API_KEY}`,
                'Content-Type': 'application/json',
            },
            timeout: timeoutMs,
        });

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
            model: config.AI_MODEL,
            // 'length' from OpenAI means the response was truncated at the
            // token cap — caller should treat this as truncation, not as a
            // bad-JSON case that's worth a repair retry.
            finishReason: choice.finish_reason || null,
            truncated: choice.finish_reason === 'length',
        };
    },
};

module.exports = openaiProvider;
