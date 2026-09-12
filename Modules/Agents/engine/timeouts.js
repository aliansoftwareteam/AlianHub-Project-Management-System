// Every timeout that has to agree with another one lives here, so the Agenda
// lock, the model call and the HTTP/Mongo layers cannot drift apart again
// (defect 13: a 5-minute lock under a 10-minute model call re-delivered runs).

const MINUTE = 60 * 1000;

const ms = (raw, fallback) => {
    if (raw === undefined || raw === null || raw === '') return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const LLM_TIMEOUT_MS = ms(process.env.LLM_TIMEOUT_MS, 10 * MINUTE);
const CHAT_MODEL_TIMEOUT_MS = Math.min(4 * MINUTE, LLM_TIMEOUT_MS);

const PROVIDER_OVERRIDES = Object.freeze({
    anthropic: process.env.ANTHROPIC_TIMEOUT_MS,
    openai: process.env.OPENAI_TIMEOUT_MS,
    deepseek: process.env.DEEPSEEK_TIMEOUT_MS,
    google: process.env.GOOGLE_TIMEOUT_MS,
});

/* Reasoning models get the full budget; classic chat models answer well inside
 * four minutes, and a hung one should fail sooner. A provider override wins
 * over both. */
const providerTimeoutMs = (provider, { reasoning = true } = {}) =>
    ms(PROVIDER_OVERRIDES[provider], reasoning ? LLM_TIMEOUT_MS : CHAT_MODEL_TIMEOUT_MS);

const MODEL_TIMEOUT_MS = Math.max(LLM_TIMEOUT_MS, ...Object.keys(PROVIDER_OVERRIDES).map((p) => providerTimeoutMs(p)));

const ACT_BUDGET_MS = ms(process.env.AGENT_ACT_BUDGET_MS, 5 * MINUTE);
const LOCK_MARGIN_MS = 2 * MINUTE;
const RUN_LOCK_MS = MODEL_TIMEOUT_MS + ACT_BUDGET_MS + LOCK_MARGIN_MS;

/* Keep-alive must outlive the idle timeout of any proxy in front (AWS ALB and
 * most others default to 60s), and Node requires headersTimeout to exceed it. */
const SERVER_KEEP_ALIVE_TIMEOUT_MS = ms(process.env.SERVER_KEEP_ALIVE_TIMEOUT_MS, 65 * 1000);
const SERVER_HEADERS_TIMEOUT_MS = Math.max(ms(process.env.SERVER_HEADERS_TIMEOUT_MS, 66 * 1000), SERVER_KEEP_ALIVE_TIMEOUT_MS + 1000);
const SERVER_REQUEST_TIMEOUT_MS = ms(process.env.SERVER_REQUEST_TIMEOUT_MS, 5 * MINUTE);

const MONGO_CONNECT_TIMEOUT_MS = ms(process.env.MONGO_CONNECT_TIMEOUT_MS, 60 * 1000);
const MONGO_SERVER_SELECTION_TIMEOUT_MS = ms(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS, 60 * 1000);
const MONGO_SOCKET_TIMEOUT_MS = ms(process.env.MONGO_SOCKET_TIMEOUT_MS, 5 * MINUTE);

const mongoTimeoutOptions = () => ({
    connectTimeoutMS: MONGO_CONNECT_TIMEOUT_MS,
    serverSelectionTimeoutMS: MONGO_SERVER_SELECTION_TIMEOUT_MS,
    socketTimeoutMS: MONGO_SOCKET_TIMEOUT_MS,
});

const applyServerTimeouts = (server) => {
    server.keepAliveTimeout = SERVER_KEEP_ALIVE_TIMEOUT_MS;
    server.headersTimeout = SERVER_HEADERS_TIMEOUT_MS;
    server.requestTimeout = SERVER_REQUEST_TIMEOUT_MS;
    return server;
};

/* A server-sent event stream is a response that legitimately never ends; the
 * socket must not be reaped by any idle timeout while it is open. */
const keepStreamOpen = (req) => {
    if (req && typeof req.setTimeout === 'function') req.setTimeout(0);
    if (req && req.socket && typeof req.socket.setTimeout === 'function') req.socket.setTimeout(0);
};

module.exports = {
    MINUTE,
    LLM_TIMEOUT_MS,
    CHAT_MODEL_TIMEOUT_MS,
    MODEL_TIMEOUT_MS,
    ACT_BUDGET_MS,
    LOCK_MARGIN_MS,
    RUN_LOCK_MS,
    SERVER_KEEP_ALIVE_TIMEOUT_MS,
    SERVER_HEADERS_TIMEOUT_MS,
    SERVER_REQUEST_TIMEOUT_MS,
    MONGO_CONNECT_TIMEOUT_MS,
    MONGO_SERVER_SELECTION_TIMEOUT_MS,
    MONGO_SOCKET_TIMEOUT_MS,
    providerTimeoutMs,
    mongoTimeoutOptions,
    applyServerTimeouts,
    keepStreamOpen,
};
