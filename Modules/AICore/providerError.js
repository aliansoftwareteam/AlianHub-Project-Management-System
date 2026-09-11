const TYPES = Object.freeze({
    RATE_LIMIT: 'rate_limit',
    QUOTA: 'quota',
    AUTH: 'auth',
    PERMISSION: 'permission',
    INVALID_REQUEST: 'invalid_request',
    CONTEXT_LENGTH: 'context_length',
    CONTENT_FILTER: 'content_filter',
    NOT_FOUND: 'not_found',
    OVERLOADED: 'overloaded',
    SERVER: 'server',
    TIMEOUT: 'timeout',
    NETWORK: 'network',
    UNKNOWN: 'unknown',
});
const TYPE_LIST = Object.freeze(Object.values(TYPES));
const RETRYABLE = new Set([TYPES.RATE_LIMIT, TYPES.OVERLOADED, TYPES.SERVER, TYPES.TIMEOUT, TYPES.NETWORK]);

const TIMEOUT_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);
const NETWORK_CODES = new Set(['ECONNRESET', 'ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH', 'ENETDOWN', 'UND_ERR_SOCKET', 'ERR_NETWORK']);

const SECRET = /\b(sk-[A-Za-z0-9_*-]{4,}|Bearer\s+[A-Za-z0-9._*-]+)/g;
const redact = (text) => (typeof text === 'string' ? text.replace(SECRET, '[redacted]') : text);

const BILLING_URL = {
    openai: 'https://platform.openai.com/account/billing',
    anthropic: 'https://console.anthropic.com/settings/billing',
    deepseek: 'https://platform.deepseek.com/top_up',
};
const LABEL = { openai: 'OpenAI', anthropic: 'Anthropic', deepseek: 'DeepSeek' };

/* Callers such as the project generator show this message to the person who asked,
 * so the types a person can act on keep a sentence that says what to do. */
const messageFor = (provider, type, vendorMessage) => {
    const name = LABEL[provider] || provider;
    switch (type) {
    case TYPES.QUOTA: return `Your ${name} account is out of credits. Please add balance to your ${name} account (${BILLING_URL[provider] || 'billing settings'}) and try again.`;
    case TYPES.RATE_LIMIT: return 'The AI service is rate-limited (too many requests). Please wait about a minute and try again.';
    case TYPES.AUTH: return `Invalid ${name} API key. Check the API key configuration.`;
    case TYPES.PERMISSION: return `${name} API access denied. Check your API key permissions.`;
    case TYPES.OVERLOADED: return 'The AI service is temporarily overloaded. Please try again in a moment.';
    case TYPES.TIMEOUT: return 'The AI request timed out. Please try again.';
    default: return redact(vendorMessage) || `${name} request failed`;
    }
};

class AIProviderError extends Error {
    constructor({ provider, model = null, status = null, code = null, type = TYPES.UNKNOWN, retryable, requestId = null, retryAfterMs = null, raw = null, message, cause } = {}) {
        const safeType = TYPE_LIST.includes(type) ? type : TYPES.UNKNOWN;
        super(message || messageFor(provider, safeType, raw && raw.message));
        this.name = 'AIProviderError';
        this.provider = provider || 'unknown';
        this.model = model || null;
        this.status = Number.isFinite(Number(status)) && status !== null ? Number(status) : null;
        this.type = safeType;
        this.code = code ? String(code) : safeType;
        this.retryable = typeof retryable === 'boolean' ? retryable : RETRYABLE.has(safeType);
        this.requestId = requestId ? String(requestId) : null;
        this.retryAfterMs = Number.isFinite(retryAfterMs) && retryAfterMs >= 0 ? Math.round(retryAfterMs) : null;
        this.raw = raw;
        if (cause && cause.code) this.causeCode = String(cause.code);
    }

    groupKey() {
        return `${this.provider}:${this.type}:${this.code}`;
    }

    toFailure() {
        return { type: this.type, code: this.code, provider: this.provider, model: this.model, status: this.status, requestId: this.requestId, groupKey: this.groupKey(), message: this.message };
    }
}

const isProviderError = (error) => error instanceof AIProviderError;

const failureOf = (error) => (isProviderError(error) ? error.toFailure() : null);

/* Works on fetch Headers (the Anthropic SDK), axios headers and plain objects. */
const headerValue = (headers, name) => {
    if (!headers) return null;
    if (typeof headers.get === 'function') {
        const v = headers.get(name);
        if (v !== undefined && v !== null && v !== '') return String(v);
    }
    const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
    return key && headers[key] !== undefined && headers[key] !== null ? String(headers[key]) : null;
};

const requestIdOf = (headers, body) => headerValue(headers, 'x-request-id') || headerValue(headers, 'request-id') || (body && body.request_id) || null;

const retryAfterMsOf = (headers, now = Date.now()) => {
    const ms = parseFloat(headerValue(headers, 'retry-after-ms'));
    if (Number.isFinite(ms) && ms >= 0) return ms;
    const raw = headerValue(headers, 'retry-after');
    if (!raw) return null;
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const at = Date.parse(raw);
    return Number.isFinite(at) ? Math.max(0, at - now) : null;
};

/* The vendor's error object only: a transport error carries the request config,
 * whose headers hold the API key, so nothing is copied from anywhere else. */
const vendorRaw = (errorObject) => {
    if (!errorObject || typeof errorObject !== 'object') return null;
    const raw = {};
    ['type', 'code', 'param', 'message'].forEach((k) => {
        const v = errorObject[k];
        if (typeof v === 'string' || typeof v === 'number') raw[k] = redact(v);
    });
    return Object.keys(raw).length ? raw : null;
};

const CONTEXT_LENGTH = /context[ _]length|context window|maximum context|prompt is too long|too many tokens/i;
const QUOTA_MESSAGE = /insufficient[ _](quota|balance)|credit balance|out of credits|billing/i;

const typeOfStatus = (status) => {
    if (status === 400 || status === 409 || status === 413 || status === 422) return TYPES.INVALID_REQUEST;
    if (status === 401) return TYPES.AUTH;
    if (status === 402) return TYPES.QUOTA;
    if (status === 403) return TYPES.PERMISSION;
    if (status === 404) return TYPES.NOT_FOUND;
    if (status === 408 || status === 504) return TYPES.TIMEOUT;
    if (status === 429) return TYPES.RATE_LIMIT;
    if (status === 503 || status === 529) return TYPES.OVERLOADED;
    if (status >= 500) return TYPES.SERVER;
    return TYPES.UNKNOWN;
};

const transportTypeOf = (error) => {
    const code = error && (error.code || (error.cause && error.cause.code));
    if (TIMEOUT_CODES.has(code) || /timed? ?out/i.test(String(error && error.message))) return TYPES.TIMEOUT;
    if (NETWORK_CODES.has(code)) return TYPES.NETWORK;
    return TYPES.UNKNOWN;
};

/* A request that never produced an HTTP response. */
const fromTransport = (provider, model, error) => {
    const type = transportTypeOf(error);
    const code = (error && (error.code || (error.cause && error.cause.code))) || type;
    return new AIProviderError({ provider, model, type, code, raw: null, message: type === TYPES.UNKNOWN ? `${LABEL[provider] || provider}: ${redact(error && error.message) || 'request failed'}` : undefined });
};

/* OpenAI's Chat Completions error body, which DeepSeek mirrors:
 * { error: { message, type, param, code } } with x-request-id and retry-after headers. */
const fromOpenAiCompatible = (provider, model, error) => {
    if (isProviderError(error)) return error;
    const response = error && error.response;
    if (!response || !response.status) return fromTransport(provider, model, error);
    const { status, headers } = response;
    const body = (response.data && response.data.error) || null;
    const vendorCode = body && (body.code || body.type);
    const message = String((body && body.message) || '');
    let type = typeOfStatus(status);
    if (vendorCode === 'insufficient_quota' || (status === 429 && QUOTA_MESSAGE.test(message))) type = TYPES.QUOTA;
    else if (vendorCode === 'context_length_exceeded' || (status === 400 && CONTEXT_LENGTH.test(message))) type = TYPES.CONTEXT_LENGTH;
    else if (vendorCode === 'content_filter' || vendorCode === 'content_policy_violation') type = TYPES.CONTENT_FILTER;
    else if (vendorCode === 'model_not_found') type = TYPES.NOT_FOUND;
    else if (vendorCode === 'invalid_api_key') type = TYPES.AUTH;
    return new AIProviderError({
        provider, model, status, type,
        code: vendorCode || `http_${status}`,
        requestId: requestIdOf(headers),
        retryAfterMs: retryAfterMsOf(headers),
        raw: vendorRaw(body),
    });
};

module.exports = { AIProviderError, TYPES, TYPE_LIST, isProviderError, failureOf, headerValue, requestIdOf, retryAfterMsOf, vendorRaw, typeOfStatus, fromTransport, fromOpenAiCompatible, redact, CONTEXT_LENGTH, QUOTA_MESSAGE };
