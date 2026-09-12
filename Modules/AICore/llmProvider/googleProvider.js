const axios = require('axios');
const { providerTimeoutMs } = require('../../Agents/engine/timeouts');
const { fromGoogle } = require('../providerError');
const { normaliseRequest, STRUCTURED_OUTPUT, JSON_ONLY_INSTRUCTION } = require('./normalise');

// Google's generative-language REST API. Nothing here needs @google/generative-ai,
// and the key travels in the x-goog-api-key header rather than the documented
// ?key= query parameter, so it cannot leak through a logged URL.
//
// Docs: https://ai.google.dev/api/generate-content
const DEFAULT_GOOGLE_BASE_URL = 'https://generativelanguage.googleapis.com';
const API_VERSION = 'v1beta';

const GEMINI_MAX_OUTPUT_TOKENS = 65536;

function googleMaxOutputTokens(modelId) {
    const id = String(modelId || '').toLowerCase();
    if (id.startsWith('gemini-1.5') || id.startsWith('gemini-1.0') || id.startsWith('gemini-pro')) return 8192;
    return GEMINI_MAX_OUTPUT_TOKENS;
}

// Gemini 2.5 and later think before they answer, spending output budget on
// hidden reasoning first. They still accept `temperature`, unlike OpenAI's
// o-series, so only the timeout and the default ceiling change.
function isReasoningModel(modelId) {
    if (typeof modelId !== 'string') return false;
    const id = modelId.toLowerCase();
    return id.includes('thinking') || /^gemini-(2\.5|[3-9])/.test(id);
}

const getBaseUrl = () => String(process.env.GOOGLE_BASE_URL || DEFAULT_GOOGLE_BASE_URL).trim().replace(/\/+$/, '');

const toContents = (messages) => (messages || []).map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(m.content == null ? '' : m.content) }],
}));

const textOf = (candidate) => {
    const parts = (candidate && candidate.content && candidate.content.parts) || [];
    return parts.filter((p) => p && typeof p.text === 'string').map((p) => p.text).join('');
};

const googleProvider = {
    name: 'google',
    get isConfigured() {
        return Boolean(process.env.GOOGLE_API_KEY && process.env.GOOGLE_MODEL);
    },
    get model() {
        return process.env.GOOGLE_MODEL || null;
    },
    capabilities: Object.freeze({
        structuredOutput: STRUCTURED_OUTPUT.RESPONSE_MIME_TYPE,
        defaultMaxTokens: 32000,
        maxOutputTokens: googleMaxOutputTokens,
        isReasoningModel,
        omitTemperatureWhenReasoning: false,
    }),

    /**
     * @param {import('./types').ChatOptions} opts
     * @returns {Promise<import('./types').ChatResult>}
     */
    async chat(opts) {
        if (!googleProvider.isConfigured) {
            throw new Error('Google provider not configured: set GOOGLE_API_KEY and GOOGLE_MODEL in .env');
        }
        const request = normaliseRequest(googleProvider, opts);
        const generationConfig = { maxOutputTokens: request.maxTokens };
        if (request.temperature !== null) generationConfig.temperature = request.temperature;
        if (request.jsonMode) generationConfig.responseMimeType = 'application/json';

        const body = { contents: toContents(opts.messages), generationConfig };
        const system = [opts.systemPrompt, request.jsonMode ? JSON_ONLY_INSTRUCTION : null].filter(Boolean).join('\n\n');
        if (system) body.systemInstruction = { parts: [{ text: system }] };

        const url = `${getBaseUrl()}/${API_VERSION}/models/${encodeURIComponent(request.model)}:generateContent`;
        let response;
        try {
            response = await axios.post(url, body, {
                headers: { 'x-goog-api-key': process.env.GOOGLE_API_KEY, 'Content-Type': 'application/json' },
                timeout: providerTimeoutMs('google', { reasoning: request.reasoning }),
            });
        } catch (error) {
            throw fromGoogle(request.model, error);
        }

        const data = response.data || {};
        const candidate = Array.isArray(data.candidates) ? data.candidates[0] : null;
        // A prompt Google refuses comes back 200 with no candidate and a
        // blockReason, so silence here is a refusal, not an empty answer.
        if (!candidate) {
            const blocked = data.promptFeedback && data.promptFeedback.blockReason;
            throw new Error(blocked ? `Google blocked the request (${blocked})` : 'Google response missing candidates[0]');
        }
        const usage = data.usageMetadata || {};
        const finishReason = candidate.finishReason || null;
        return {
            content: textOf(candidate),
            inputTokens: usage.promptTokenCount || 0,
            outputTokens: (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0),
            totalTokens: usage.totalTokenCount || 0,
            model: data.modelVersion || request.model,
            finishReason,
            truncated: finishReason === 'MAX_TOKENS',
        };
    },
};

module.exports = googleProvider;
