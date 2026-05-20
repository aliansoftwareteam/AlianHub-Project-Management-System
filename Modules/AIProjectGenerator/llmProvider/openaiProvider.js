const axios = require('axios');
const config = require('../../../Config/config');

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';

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

        const body = {
            model: config.AI_MODEL,
            messages,
            temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.4,
            max_tokens: opts.maxTokens || 4000,
        };
        if (opts.jsonMode) {
            body.response_format = { type: 'json_object' };
        }

        const response = await axios.post(OPENAI_CHAT_URL, body, {
            headers: {
                Authorization: `Bearer ${config.AI_API_KEY}`,
                'Content-Type': 'application/json',
            },
            timeout: 120000,
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
        };
    },
};

module.exports = openaiProvider;
