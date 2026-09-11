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
// ANTHROPIC_TIMEOUT_MS overrides the shared model timeout; the job lock is
// derived from the same module, so raising it here raises the lock too.
const { providerTimeoutMs } = require('../../Agents/engine/timeouts');
const { AIProviderError, TYPES, isProviderError, requestIdOf, retryAfterMsOf, vendorRaw, typeOfStatus, fromTransport, CONTEXT_LENGTH, QUOTA_MESSAGE } = require('../providerError');

const PROVIDER = 'anthropic';

/* The `error.type` values of the SDK's ErrorType (resources/shared.d.ts). */
const VENDOR_TYPES = {
    invalid_request_error: TYPES.INVALID_REQUEST,
    authentication_error: TYPES.AUTH,
    permission_error: TYPES.PERMISSION,
    not_found_error: TYPES.NOT_FOUND,
    rate_limit_error: TYPES.RATE_LIMIT,
    billing_error: TYPES.QUOTA,
    timeout_error: TYPES.TIMEOUT,
    overloaded_error: TYPES.OVERLOADED,
    api_error: TYPES.SERVER,
};

const sdkClass = (name) => (AnthropicSdk && typeof AnthropicSdk[name] === 'function' ? AnthropicSdk[name] : null);
const isSdk = (err, name) => { const Cls = sdkClass(name); return Boolean(Cls && err instanceof Cls); };

/* APIError carries { type: 'error', error: { type, message }, request_id } as `error`,
 * with status undefined when the failure arrived as an SSE error event mid-stream. */
function toProviderError(err, model = process.env.ANTHROPIC_MODEL || null) {
    if (isProviderError(err)) return err;
    if (isSdk(err, 'APIConnectionTimeoutError')) return new AIProviderError({ provider: PROVIDER, model, type: TYPES.TIMEOUT, code: 'timeout' });
    if (isSdk(err, 'APIUserAbortError')) return new AIProviderError({ provider: PROVIDER, model, type: TYPES.UNKNOWN, code: 'aborted', message: 'Anthropic: request aborted' });
    if (isSdk(err, 'APIConnectionError')) {
        const typed = fromTransport(PROVIDER, model, err.cause || err);
        return typed.type === TYPES.UNKNOWN ? new AIProviderError({ provider: PROVIDER, model, type: TYPES.NETWORK, code: 'connection_error' }) : typed;
    }
    const body = err && err.error;
    const errorObject = body && body.error && typeof body.error === 'object' ? body.error : null;
    const status = err && Number.isFinite(err.status) ? err.status : null;
    if (!status && !errorObject) return fromTransport(PROVIDER, model, err);
    const vendorType = (err.type) || (errorObject && errorObject.type) || null;
    const message = String((errorObject && errorObject.message) || '');
    let type = VENDOR_TYPES[vendorType] || typeOfStatus(status);
    if (type === TYPES.INVALID_REQUEST && CONTEXT_LENGTH.test(message)) type = TYPES.CONTEXT_LENGTH;
    else if ((type === TYPES.INVALID_REQUEST || type === TYPES.RATE_LIMIT) && QUOTA_MESSAGE.test(message)) type = TYPES.QUOTA;
    return new AIProviderError({
        provider: PROVIDER, model, status, type,
        code: vendorType || (status ? `http_${status}` : null),
        requestId: err.requestID || requestIdOf(err.headers, body),
        retryAfterMs: retryAfterMsOf(err.headers),
        raw: vendorRaw(errorObject),
    });
}

const anthropicProvider = {
    name: 'anthropic',
    get isConfigured() {
        return Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_MODEL && AnthropicSdk);
    },
    get model() {
        return process.env.ANTHROPIC_MODEL || null;
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
        const timeoutMs = providerTimeoutMs('anthropic');
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
        // Clamp to Claude's output ceiling. Unlike DeepSeek this provider had no
        // clamp at all, so once the shared default was raised past 128K for
        // DeepSeek's sake, every Anthropic request would have been rejected
        // outright. Each provider bounds its own limit; the caller asks freely.
        const ANTHROPIC_MAX_OUTPUT_TOKENS = 128000;
        const maxTokens = Math.min(opts.maxTokens || 32000, ANTHROPIC_MAX_OUTPUT_TOKENS);

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
            throw toProviderError(err);
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

anthropicProvider.toProviderError = toProviderError;

module.exports = anthropicProvider;
