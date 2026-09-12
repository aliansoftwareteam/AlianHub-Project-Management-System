const logger = require('../../../Config/loggerConfig');
const { metered } = require('../spend');
const { isProviderError } = require('../providerError');
const { resolveModel, routerEnabled } = require('./normalise');
const health = require('./health');
const rateLimit = require('./rateLimit');

/* What turns a list of configured providers into one answered call: the
 * breaker decides who may be asked, the token bucket decides how fast, retry
 * covers a blip and failover covers an outage.
 *
 * None of it applies while AI_MODEL_ROUTER is off. Then `observed()` is the
 * whole story — one adapter, one attempt, the outcome written to the health
 * window so the console has something to show — which is today's behaviour
 * with a counter next to it. */

const LOG_PREFIX = '[ai-router]';

const num = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const attempts = () => Math.max(1, num(process.env.AI_ROUTER_MAX_ATTEMPTS, 2));
const baseBackoffMs = () => num(process.env.AI_ROUTER_BACKOFF_MS, 500);
const maxBackoffMs = () => num(process.env.AI_ROUTER_BACKOFF_MAX_MS, 8000);

const sleep = (ms) => (ms > 0 ? new Promise((resolve) => { setTimeout(resolve, ms).unref?.(); }) : Promise.resolve());

/* Exponential with full jitter, so a hundred steps released by the same
 * recovery do not all come back in the same millisecond. A retry hint from the
 * vendor replaces the computed delay, capped so a long one becomes failover. */
function backoffFor(attempt, error) {
    const ceiling = maxBackoffMs();
    const hint = isProviderError(error) && error.retryAfterMs !== null ? error.retryAfterMs : null;
    if (hint !== null) return Math.min(ceiling, hint);
    const window = Math.min(ceiling, baseBackoffMs() * (2 ** (attempt - 1)));
    return Math.round(Math.random() * window);
}

const typeOf = (error) => (isProviderError(error) ? error.type : null);

/* A caller's mistake travels with the prompt: another provider would refuse it
 * too, so it is rethrown rather than retried or failed over. */
const worthAnotherProvider = (error) => isProviderError(error) && !health.CALLER_FAILURES.has(error.type);
const worthAnotherAttempt = (error) => isProviderError(error) && error.retryable === true;

async function runOnce(adapter, opts, probe) {
    const model = resolveModel(adapter, opts);
    const startedAt = Date.now();
    try {
        const result = await metered(adapter).chat(opts);
        health.record({ provider: adapter.name, model, ok: true, durationMs: Date.now() - startedAt, probe });
        return result;
    } catch (error) {
        const type = typeOf(error);
        if (type === null) throw error;
        health.record({ provider: adapter.name, model, ok: false, durationMs: Date.now() - startedAt, errorType: type, probe });
        if (type === 'rate_limit') rateLimit.tighten(adapter.name, error.retryAfterMs !== null ? error.retryAfterMs : rateLimit.MINUTE_MS);
        throw error;
    }
}

/* One adapter, one attempt, no breaker and no bucket: the flag-off path. */
const observedCache = new WeakMap();

function observed(adapter) {
    const cached = observedCache.get(adapter);
    if (cached) return cached;
    const metre = metered(adapter);
    const provider = {
        get name() { return adapter.name; },
        get isConfigured() { return adapter.isConfigured; },
        get model() { return adapter.model; },
        get capabilities() { return adapter.capabilities; },
        async chat(opts) {
            const model = resolveModel(adapter, opts);
            const startedAt = Date.now();
            try {
                const result = await metre.chat(opts);
                health.record({ provider: adapter.name, model, ok: true, durationMs: Date.now() - startedAt });
                return result;
            } catch (error) {
                const type = typeOf(error);
                if (type !== null) health.record({ provider: adapter.name, model, ok: false, durationMs: Date.now() - startedAt, errorType: type });
                throw error;
            }
        },
    };
    observedCache.set(adapter, provider);
    return provider;
}

/* A short wait for a token is cheaper than a worse model; a long one is not. */
async function waitForToken(name) {
    const first = rateLimit.take(name);
    if (first.allowed) return true;
    if (first.waitMs > rateLimit.waitMs()) return false;
    await sleep(first.waitMs);
    return rateLimit.take(name).allowed;
}

async function callCandidate(adapter, opts, reasons) {
    const model = resolveModel(adapter, opts);
    const maxAttempts = attempts();
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (!(await waitForToken(adapter.name))) {
            reasons.push({ provider: adapter.name, model, reason: 'rate_limited' });
            return { ok: false, error: lastError };
        }
        const admission = health.admit(adapter.name, model);
        if (!admission.allowed) {
            reasons.push({ provider: adapter.name, model, reason: `breaker_${admission.state}` });
            return { ok: false, error: lastError };
        }
        try {
            return { ok: true, result: await runOnce(adapter, opts, admission.probe) };
        } catch (error) {
            lastError = error;
            if (!worthAnotherProvider(error)) throw error;
            if (attempt < maxAttempts && worthAnotherAttempt(error)) {
                await sleep(backoffFor(attempt, error));
                continue;
            }
            reasons.push({ provider: adapter.name, model, reason: typeOf(error) });
            return { ok: false, error };
        }
    }
    return { ok: false, error: lastError };
}

/* The registry's insertion order is the fallback preference; the provider the
 * caller (or LLM_PROVIDER) chose goes first. A candidate that is not the
 * primary drops the caller's model, because a model id belongs to one vendor. */
function candidatesFor(primary, registry) {
    const rest = registry.configuredNames()
        .filter((name) => name !== primary.name)
        .map((name) => registry.ADAPTERS[name]);
    return [primary, ...rest];
}

function routed(primary, registry) {
    const candidates = candidatesFor(primary, registry);
    return {
        get name() { return primary.name; },
        get isConfigured() { return primary.isConfigured; },
        get model() { return primary.model; },
        get capabilities() { return primary.capabilities; },
        async chat(opts) {
            const reasons = [];
            let lastError = null;
            for (const adapter of candidates) {
                const forThis = adapter === primary ? opts : { ...opts, model: undefined, provider: adapter.name };
                const outcome = await callCandidate(adapter, forThis, reasons);
                if (outcome.ok) {
                    if (adapter !== primary) logger.warn(`${LOG_PREFIX} ${primary.name} was skipped or failed; ${adapter.name} answered (${reasons.map((r) => `${r.provider}: ${r.reason}`).join('; ')})`);
                    return outcome.result;
                }
                if (outcome.error) lastError = outcome.error;
            }
            if (lastError) {
                lastError.routerReasons = reasons;
                throw lastError;
            }
            const exhausted = new Error(`No LLM provider could take the call: ${reasons.map((r) => `${r.provider} (${r.reason})`).join(', ') || 'none configured'}`);
            exhausted.routerReasons = reasons;
            exhausted.retryable = true;
            throw exhausted;
        },
    };
}

/** The provider every call goes through: routed while the flag is on, observed otherwise. */
function resilient(adapter, registry) {
    return routerEnabled() ? routed(adapter, registry) : observed(adapter);
}

module.exports = { resilient, routed, observed, candidatesFor, backoffFor, attempts };
