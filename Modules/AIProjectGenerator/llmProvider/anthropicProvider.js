let AnthropicSdk;
try {
    AnthropicSdk = require('@anthropic-ai/sdk');
} catch (_e) {
    AnthropicSdk = null;
}

// Anthropic's SDK officially recommends streaming for any messages call
// with max_tokens > 4096 — long non-streaming requests get throttled and
// occasionally killed by intermediate proxies (manifests as the call
// hanging forever on the client side). We always stream, then assemble
// the final text from the stream's `finalMessage()`. This keeps the
// connection alive throughout the generation and gives us deterministic
// completion even on long outputs.
//
// Reference: https://docs.anthropic.com/en/api/messages-streaming
//
// The SDK has a default 10-minute network timeout; we surface it as
// ANTHROPIC_TIMEOUT_MS so operators can raise it for very long plans.

const DEFAULT_ANTHROPIC_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

function isClaudeOpus(modelId) {
    return typeof modelId === 'string' && modelId.toLowerCase().includes('opus');
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
        const timeoutMs = Number(process.env.ANTHROPIC_TIMEOUT_MS) || DEFAULT_ANTHROPIC_TIMEOUT_MS;
        const client = new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY,
            timeout: timeoutMs,
        });

        // Anthropic messages API takes user/assistant only; system is separate.
        const messages = (opts.messages || []).map((m) => ({
            role: m.role === 'system' ? 'user' : m.role,
            content: m.content,
        }));

        // 32000 default — large plans (30+ tasks) with rich descriptions
        // can run 15-25K output tokens. Claude Sonnet 4.5 supports up to
        // 64K output natively, so 32K is well within range.
        const maxTokens = opts.maxTokens || 32000;

        const params = {
            model: process.env.ANTHROPIC_MODEL,
            max_tokens: maxTokens,
            temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.4,
            messages,
        };
        if (opts.systemPrompt) {
            params.system = opts.systemPrompt
                + (opts.jsonMode ? '\n\nRespond with ONLY a single valid JSON object. No prose, no markdown fences. The first character must be `{` and the last must be `}`.' : '');
        } else if (opts.jsonMode) {
            params.system = 'Respond with ONLY a single valid JSON object. No prose, no markdown fences. The first character must be `{` and the last must be `}`.';
        }

        // Stream the response and resolve to the assembled final message.
        // Anthropic returns chunked SSE-style events under the hood; the
        // SDK helper hides all of that and gives us a single MessageStream
        // with a `finalMessage()` promise.
        let response;
        try {
            const stream = client.messages.stream(params);
            response = await stream.finalMessage();
        } catch (err) {
            // Surface Anthropic API errors with a useful message instead of
            // letting the SDK's default string bubble up. The controller
            // logs the message and emits it to the SSE error event.
            const detail = err && err.error && err.error.error && err.error.error.message;
            const message = detail
                || (err && err.message)
                || 'Anthropic request failed';
            const wrapped = new Error(`Anthropic: ${message}`);
            wrapped.cause = err;
            wrapped.status = err && err.status;
            // Opus has a smaller default max_tokens budget than Sonnet; flag
            // the most common config mistake so operators don't chase ghosts.
            if (isClaudeOpus(process.env.ANTHROPIC_MODEL) && maxTokens > 4096) {
                wrapped.hint = 'Claude Opus has a smaller default max_tokens. Try lowering LLM_MAX_TOKENS_PLAN to 4096.';
            }
            throw wrapped;
        }

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
            // 'max_tokens' from Anthropic = the response was cut off at the
            // token cap. Surface it so the caller doesn't waste a repair
            // attempt on output that's truncated, not malformed.
            stopReason: response.stop_reason || null,
            truncated: response.stop_reason === 'max_tokens',
        };
    },
};

module.exports = anthropicProvider;
