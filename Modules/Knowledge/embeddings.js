const llmProvider = require('../AICore/llmProvider');
const { FEATURES } = require('../AICore/features');
const { BUDGET_EXHAUSTED } = require('../AICore/reservation');
const logger = require('../../Config/loggerConfig');
const flag = require('./flag');

// Every embedding the knowledge module asks for goes through here: one model for the whole
// instance, one feature tag on the ledger, the provider layer's meter around the call, and a
// pause per company when the provider keeps refusing or the workspace budget is spent, so a
// bad key or an exhausted month costs a handful of calls rather than one per write.

const DEFAULT_MODEL = 'text-embedding-3-small';
const QUERY_TIMEOUT_MS_DEFAULT = 2000;
const BREAKER_FAILURES = 5;
const BREAKER_COOLDOWN_MS = 10 * 60 * 1000;
const EMBED_TIMED_OUT = 'embed_timed_out';

const model = () => String(process.env.KNOWLEDGE_EMBEDDING_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;

const queryTimeoutMs = () => {
    const ms = Number(process.env.KNOWLEDGE_EMBED_QUERY_TIMEOUT_MS);
    return Number.isFinite(ms) && ms > 0 ? ms : QUERY_TIMEOUT_MS_DEFAULT;
};

const configured = () => llmProvider.isEmbeddingConfigured();

const isBudgetRefusal = (error) => Boolean(error) && error.code === BUDGET_EXHAUSTED;

const breakers = new Map();

const breakerState = (companyId) => {
    const breaker = breakers.get(String(companyId)) || { failures: 0, until: 0, reason: null };
    return { failures: breaker.failures, until: breaker.until, reason: breaker.reason, open: breaker.until > Date.now() };
};

const paused = (companyId) => breakerState(companyId).open;

const resetBreaker = () => breakers.clear();

const succeeded = (companyId) => { breakers.delete(String(companyId)); };

/* A budget refusal pauses at once: the month will not clear in a minute. Provider failures
 * pause after a run of them, for as long as the vendor asked or ten minutes. Logged once per
 * pause, since every write in the window would otherwise say the same thing. */
const failed = (companyId, error) => {
    const key = String(companyId);
    const breaker = breakers.get(key) || { failures: 0, until: 0, reason: null };
    const budget = isBudgetRefusal(error);
    if (!budget) breaker.failures += 1;
    if (budget || breaker.failures >= BREAKER_FAILURES) {
        const wait = !budget && error && Number.isFinite(error.retryAfterMs) && error.retryAfterMs > 0 ? error.retryAfterMs : BREAKER_COOLDOWN_MS;
        breaker.until = Date.now() + wait;
        breaker.reason = budget ? 'budget' : 'failures';
        breaker.failures = 0;
        logger.warn(`knowledge embeddings: paused for company ${key} for ${Math.round(wait / 1000)}s (${budget ? 'workspace budget spent' : `${BREAKER_FAILURES} failures in a row`}): ${error && error.message}`);
    }
    breakers.set(key, breaker);
};

/* What the question side may do: nothing without a key, nothing while paused. */
const readiness = (companyId) => {
    if (!configured()) return 'unconfigured';
    return paused(companyId) ? 'paused' : 'ready';
};

/* Whether this company's chunks carry vectors: the hybrid mode of the retrieval switch, an
 * instance key to embed with, and no pause in force. */
const planFor = async (companyId) => ((await flag.hybridFor(companyId)) && readiness(companyId) === 'ready' ? { model: model() } : null);

const spendFor = (companyId, userId) => ({ feature: FEATURES.KNOWLEDGE_EMBED, companyId: String(companyId), ...(userId ? { userId: String(userId) } : {}) });

/* One provider call for a batch of texts; the vectors come back in the order of the texts. The
 * model recorded beside a vector is the one configured here, which is what a search filters on,
 * while the ledger keeps whatever dated alias the vendor billed. */
const embedTexts = async (companyId, texts, { userId, timeoutMs } = {}) => {
    const wanted = model();
    try {
        const result = await llmProvider.embeddingProvider().embed({ texts, model: wanted, ...(timeoutMs ? { timeoutMs } : {}), spend: spendFor(companyId, userId) });
        succeeded(companyId);
        return { vectors: result.embeddings, model: wanted };
    } catch (error) {
        failed(companyId, error);
        throw error;
    }
};

/* A question waits its own short time for a vector, never the chat timeout: a hung endpoint
 * costs the asker two seconds and a lexical answer. The request itself is cut at the same
 * time, and a late failure is swallowed rather than left unhandled. */
const embedQuery = (companyId, query, { userId } = {}) => {
    const ms = queryTimeoutMs();
    let timer;
    const attempt = embedTexts(companyId, [String(query)], { userId, timeoutMs: ms });
    attempt.catch(() => {});
    const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(`embedding the question took longer than ${ms} ms`), { code: EMBED_TIMED_OUT })), ms);
    });
    return Promise.race([attempt, timeout])
        .then(({ vectors, model: used }) => ({ vector: vectors[0] || [], model: used }))
        .finally(() => clearTimeout(timer));
};

module.exports = {
    DEFAULT_MODEL,
    QUERY_TIMEOUT_MS_DEFAULT,
    BREAKER_FAILURES,
    BREAKER_COOLDOWN_MS,
    EMBED_TIMED_OUT,
    model,
    queryTimeoutMs,
    configured,
    readiness,
    isBudgetRefusal,
    breakerState,
    resetBreaker,
    planFor,
    embedTexts,
    embedQuery,
};
