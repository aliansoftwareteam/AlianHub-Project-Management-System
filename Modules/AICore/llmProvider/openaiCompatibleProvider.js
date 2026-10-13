const client = require('./compatibleClient');
const { apiKeyFor } = require('../providerKeys');
const { providerTimeoutMs } = require('../../Agents/engine/timeouts');
const { fromOpenAiCompatible, noEmbeddings } = require('../providerError');
const { normaliseRequest, STRUCTURED_OUTPUT } = require('./normalise');

/* Any server that speaks the OpenAI Chat Completions and Embeddings API at a base URL the
 * instance owner chose: Ollama (http://host:11434/v1), vLLM, LM Studio, LiteLLM or a company
 * gateway. Every request goes through compatibleClient, the one client allowed to reach a
 * private or loopback address. */

const NAME = 'openai_compatible';
const EMBED_BATCH_SIZE = 100;
/* Local models often have an 8k context, and vLLM refuses a max_tokens that does not fit, so the
 * default ceiling is modest; OPENAI_COMPATIBLE_MAX_OUTPUT_TOKENS raises it for a bigger model. */
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

const trimmed = (value) => String(value || '').trim();
const baseUrl = () => trimmed(process.env.OPENAI_COMPATIBLE_BASE_URL);
const chatModel = () => trimmed(process.env.OPENAI_COMPATIBLE_MODEL);
const embeddingsModel = () => trimmed(process.env.OPENAI_COMPATIBLE_EMBEDDINGS_MODEL);

const maxOutputTokens = () => {
    const n = Number(process.env.OPENAI_COMPATIBLE_MAX_OUTPUT_TOKENS);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_OUTPUT_TOKENS;
};

/* Local inference is slow, so a chat call gets the long model budget; OPENAI_COMPATIBLE_TIMEOUT_MS overrides it. */
const timeoutMs = () => providerTimeoutMs(NAME, { reasoning: true });

const sizeError = (message) => Object.assign(new Error(message), { code: 'embedding_size_mismatch' });

const vectorsOf = (response, model, expected) => {
    const rows = response && response.data && Array.isArray(response.data.data) ? response.data.data : [];
    if (rows.length !== expected || rows.some((row) => !Array.isArray(row.embedding))) {
        throw new Error(`The OpenAI-compatible endpoint (${model}) answered ${rows.length} vectors for ${expected} texts`);
    }
    return [...rows].sort((a, b) => (a.index || 0) - (b.index || 0)).map((row) => row.embedding);
};

const openaiCompatibleProvider = {
    name: NAME,
    get isConfigured() {
        return Boolean(baseUrl() && chatModel());
    },
    get model() {
        return chatModel() || null;
    },
    get embeddingsConfigured() {
        return Boolean(baseUrl() && embeddingsModel());
    },
    get embeddingsModel() {
        return embeddingsModel() || null;
    },
    capabilities: Object.freeze({
        structuredOutput: STRUCTURED_OUTPUT.JSON_OBJECT,
        get defaultMaxTokens() { return maxOutputTokens(); },
        maxOutputTokens: () => maxOutputTokens(),
        isReasoningModel: () => false,
        omitTemperatureWhenReasoning: false,
        embeddings: true,
    }),

    /**
     * @param {import('./types').EmbedOptions} opts
     * @returns {Promise<import('./types').EmbedResult>}
     */
    async embed(opts) {
        if (!openaiCompatibleProvider.embeddingsConfigured) throw noEmbeddings(NAME, 'has no embeddings until OPENAI_COMPATIBLE_BASE_URL and OPENAI_COMPATIBLE_EMBEDDINGS_MODEL are set');
        const model = String((opts && opts.model) || '').trim() || embeddingsModel();
        const texts = (Array.isArray(opts.texts) ? opts.texts : []).map((text) => (text === undefined || text === null ? '' : String(text)));
        const timeout = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : timeoutMs();
        const apiKey = await apiKeyFor(NAME);
        const embeddings = [];
        let inputTokens = 0;
        for (let at = 0; at < texts.length; at += EMBED_BATCH_SIZE) {
            const input = texts.slice(at, at + EMBED_BATCH_SIZE);
            let response;
            try {
                response = await client.request({ baseUrl: baseUrl(), path: '/embeddings', body: { model, input }, apiKey, timeoutMs: timeout });
            } catch (error) {
                throw fromOpenAiCompatible(NAME, model, error);
            }
            embeddings.push(...vectorsOf(response, model, input.length));
            const billed = response.data && response.data.usage;
            inputTokens += (billed && billed.prompt_tokens) || 0;
        }
        const sizes = [...new Set(embeddings.map((vector) => vector.length))];
        if (sizes.length > 1) {
            throw sizeError(`The OpenAI-compatible endpoint (${model}) answered vectors of different sizes (${sizes.join(', ')} dimensions); every embedding must be the same size.`);
        }
        return { embeddings, model, inputTokens, outputTokens: 0, totalTokens: inputTokens, dimensions: sizes[0] || 0 };
    },

    /**
     * @param {import('./types').ChatOptions} opts
     * @returns {Promise<import('./types').ChatResult>}
     */
    async chat(opts) {
        if (!openaiCompatibleProvider.isConfigured) {
            throw new Error('OpenAI-compatible provider not configured: set OPENAI_COMPATIBLE_BASE_URL and OPENAI_COMPATIBLE_MODEL');
        }
        const messages = [];
        if (opts.systemPrompt) messages.push({ role: 'system', content: opts.systemPrompt });
        for (const m of opts.messages || []) messages.push({ role: m.role, content: m.content });

        const request = normaliseRequest(openaiCompatibleProvider, opts);
        const { model } = request;
        const body = { model, messages, max_tokens: request.maxTokens };
        if (request.temperature !== null) body.temperature = request.temperature;
        if (request.jsonMode) body.response_format = { type: 'json_object' };

        let response;
        try {
            response = await client.request({ baseUrl: baseUrl(), path: '/chat/completions', body, apiKey: await apiKeyFor(NAME), timeoutMs: timeoutMs() });
        } catch (error) {
            throw fromOpenAiCompatible(NAME, model, error);
        }

        const choice = response.data && response.data.choices && response.data.choices[0];
        const usage = response.data && response.data.usage;
        if (!choice || !choice.message) throw new Error('OpenAI-compatible response missing choices[0].message');
        return {
            content: choice.message.content || '',
            inputTokens: (usage && usage.prompt_tokens) || 0,
            outputTokens: (usage && usage.completion_tokens) || 0,
            totalTokens: (usage && usage.total_tokens) || 0,
            model,
            finishReason: choice.finish_reason || null,
            truncated: choice.finish_reason === 'length',
        };
    },
};

module.exports = openaiCompatibleProvider;
