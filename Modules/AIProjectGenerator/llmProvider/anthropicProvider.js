let AnthropicSdk;
try {
    AnthropicSdk = require('@anthropic-ai/sdk');
} catch (_e) {
    AnthropicSdk = null;
}

const anthropicProvider = {
    name: 'anthropic',
    get isConfigured() {
        return Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_MODEL && AnthropicSdk);
    },

    /**
     * @param {import('./types').ChatOptions} opts
     * @returns {Promise<import('./types').ChatResult>}
     */
    async chat(opts) {
        if (!anthropicProvider.isConfigured) {
            throw new Error('Anthropic provider not configured: install @anthropic-ai/sdk and set ANTHROPIC_API_KEY + ANTHROPIC_MODEL');
        }
        const Anthropic = AnthropicSdk.default || AnthropicSdk.Anthropic || AnthropicSdk;
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

        // Anthropic messages API takes user/assistant only; system is separate.
        const messages = (opts.messages || []).map((m) => ({
            role: m.role === 'system' ? 'user' : m.role,
            content: m.content,
        }));

        // For JSON mode, prefix the assistant turn so Claude knows to start with `{`.
        // (Anthropic does not have an OpenAI-style response_format yet — the repair
        // loop in the controller handles malformed JSON.)
        const params = {
            model: process.env.ANTHROPIC_MODEL,
            max_tokens: opts.maxTokens || 4000,
            temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.4,
            messages,
        };
        if (opts.systemPrompt) {
            params.system = opts.systemPrompt
                + (opts.jsonMode ? '\n\nRespond with ONLY a single valid JSON object. No prose, no markdown fences.' : '');
        } else if (opts.jsonMode) {
            params.system = 'Respond with ONLY a single valid JSON object. No prose, no markdown fences.';
        }

        const response = await client.messages.create(params);

        let text = '';
        if (Array.isArray(response.content)) {
            for (const block of response.content) {
                if (block.type === 'text' && typeof block.text === 'string') {
                    text += block.text;
                }
            }
        }
        const usage = response.usage || {};
        return {
            content: text,
            inputTokens: usage.input_tokens || 0,
            outputTokens: usage.output_tokens || 0,
            totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
            model: response.model || process.env.ANTHROPIC_MODEL,
        };
    },
};

module.exports = anthropicProvider;
