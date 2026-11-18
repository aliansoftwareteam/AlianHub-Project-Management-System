const { TYPES } = require('../providerError');

/* Health and the circuit breaker, per provider and model.
 *
 * State lives in this process and nowhere else. A multi-node install therefore
 * has one health window and one breaker per node: each node learns a provider
 * is down from its own failures, and the console shows the node that answered
 * the request. That is deliberate — a shared store would put a database write
 * on the hot path of every model call, and the cost of the local view is only
 * that n nodes each spend a few calls discovering the same outage. A restart
 * starts closed, which fails towards trying the provider rather than away. */

const STATES = Object.freeze({ CLOSED: 'closed', OPEN: 'open', HALF_OPEN: 'half_open' });

/* A failure that says something about the provider. The rest — a malformed
 * request, a prompt over the context window, a content filter — says something
 * about the call, and would say it again on every other provider. */
const PROVIDER_FAILURES = new Set([
    TYPES.TIMEOUT, TYPES.NETWORK, TYPES.SERVER, TYPES.OVERLOADED,
    TYPES.AUTH, TYPES.QUOTA, TYPES.PERMISSION, TYPES.NOT_FOUND, TYPES.UNKNOWN,
]);
const CALLER_FAILURES = new Set([TYPES.INVALID_REQUEST, TYPES.CONTEXT_LENGTH, TYPES.CONTENT_FILTER]);

const num = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const settings = () => ({
    windowMs: num(process.env.AI_ROUTER_HEALTH_WINDOW_MS, 300000),
    samples: Math.max(1, num(process.env.AI_ROUTER_HEALTH_SAMPLES, 50)),
    volume: Math.max(1, num(process.env.AI_ROUTER_BREAKER_VOLUME, 5)),
    threshold: Math.min(1, Math.max(0.01, num(process.env.AI_ROUTER_BREAKER_THRESHOLD, 0.5))),
    cooldownMs: Math.max(1, num(process.env.AI_ROUTER_BREAKER_COOLDOWN_MS, 30000)),
    maxCooldownMs: Math.max(1, num(process.env.AI_ROUTER_BREAKER_MAX_COOLDOWN_MS, 300000)),
});

const entries = new Map();

const keyOf = (provider, model) => `${String(provider || 'unknown')}:${String(model || 'default')}`;

const blank = (provider, model) => ({
    provider: String(provider || 'unknown'),
    model: model ? String(model) : null,
    calls: [],
    state: STATES.CLOSED,
    openedAt: null,
    retryAt: null,
    cooldownMs: 0,
    probeInFlight: false,
    consecutiveFailures: 0,
    lastErrorType: null,
    lastErrorAt: null,
    lastSuccessAt: null,
    trips: 0,
});

function entryOf(provider, model) {
    const key = keyOf(provider, model);
    let entry = entries.get(key);
    if (!entry) {
        entry = blank(provider, model);
        entries.set(key, entry);
    }
    return entry;
}

const prune = (entry, config, now) => {
    const floor = now - config.windowMs;
    while (entry.calls.length && entry.calls[0].at < floor) entry.calls.shift();
    while (entry.calls.length > config.samples) entry.calls.shift();
};

const quantile = (sorted, q) => (sorted.length ? sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)] : null);

/* A rate limit is a queue, not an outage, so on its own it must not open the
 * breaker — the token bucket is what answers it. It counts only when nothing
 * at all is getting through, which is a provider that has stopped serving us. */
function tally(calls) {
    const succeeded = calls.filter((c) => c.ok).length;
    const provider = calls.filter((c) => !c.ok && PROVIDER_FAILURES.has(c.type)).length;
    const limited = calls.filter((c) => !c.ok && c.type === TYPES.RATE_LIMIT).length;
    return { succeeded, counted: provider + (succeeded === 0 ? limited : 0), limited, provider };
}

function open(entry, config, now) {
    entry.cooldownMs = Math.min(config.maxCooldownMs, entry.cooldownMs ? entry.cooldownMs * 2 : config.cooldownMs);
    entry.state = STATES.OPEN;
    entry.openedAt = now;
    entry.retryAt = now + entry.cooldownMs;
    entry.probeInFlight = false;
    entry.trips += 1;
}

function openIfSustained(entry, config, now) {
    const { counted } = tally(entry.calls);
    const eligible = entry.calls.filter((c) => c.ok || !CALLER_FAILURES.has(c.type)).length;
    if (eligible < config.volume || counted / eligible < config.threshold) return;
    open(entry, config, now);
}

function close(entry) {
    entry.state = STATES.CLOSED;
    entry.openedAt = null;
    entry.retryAt = null;
    entry.cooldownMs = 0;
    entry.probeInFlight = false;
    entry.consecutiveFailures = 0;
    entry.calls = [];
}

/**
 * The outcome of one real call. Recorded whether or not the router flag is on:
 * with the flag off the numbers are observation, and nothing reads the breaker.
 * @param {{provider: string, model?: string|null, ok: boolean, durationMs?: number,
 *          errorType?: string|null, probe?: boolean}} outcome
 */
function record({ provider, model = null, ok, durationMs = null, errorType = null, probe = false }, now = Date.now()) {
    const config = settings();
    const entry = entryOf(provider, model);
    const type = ok ? null : (errorType || TYPES.UNKNOWN);
    entry.calls.push({ at: now, ok: Boolean(ok), type, ms: Number.isFinite(Number(durationMs)) ? Number(durationMs) : null });
    prune(entry, config, now);
    const wasProbe = probe && entry.probeInFlight;
    if (probe) entry.probeInFlight = false;

    if (ok) {
        entry.lastSuccessAt = now;
        entry.consecutiveFailures = 0;
        if (entry.state !== STATES.CLOSED) close(entry);
        return entry;
    }

    entry.lastErrorType = type;
    entry.lastErrorAt = now;
    if (CALLER_FAILURES.has(type)) return entry;
    entry.consecutiveFailures += 1;

    if (wasProbe || entry.state === STATES.HALF_OPEN) {
        open(entry, config, now);
        return entry;
    }
    if (entry.state === STATES.CLOSED) openIfSustained(entry, config, now);
    return entry;
}

/* Reads the breaker forward in time: an open breaker whose cooldown has passed
 * becomes half-open here rather than on a timer. */
function stateOf(provider, model, now = Date.now()) {
    const entry = entries.get(keyOf(provider, model));
    if (!entry) return STATES.CLOSED;
    if (entry.state === STATES.OPEN && entry.retryAt !== null && now >= entry.retryAt) entry.state = STATES.HALF_OPEN;
    return entry.state;
}

/**
 * May this candidate take the call? Half-open admits one probe at a time; the
 * caller must report its outcome with `probe: true` so the next one is let in.
 * @returns {{allowed: boolean, state: string, probe: boolean, retryAt: number|null}}
 */
function admit(provider, model, now = Date.now()) {
    const state = stateOf(provider, model, now);
    if (state === STATES.CLOSED) return { allowed: true, state, probe: false, retryAt: null };
    const entry = entryOf(provider, model);
    if (state === STATES.OPEN || entry.probeInFlight) return { allowed: false, state, probe: false, retryAt: entry.retryAt };
    entry.probeInFlight = true;
    return { allowed: true, state, probe: true, retryAt: entry.retryAt };
}

/* A probe that never reached the provider (no rate-limit token, say) must not
 * hold the half-open slot shut until the process restarts. */
function releaseProbe(provider, model) {
    const entry = entries.get(keyOf(provider, model));
    if (entry) entry.probeInFlight = false;
}

const emptySnapshot = (provider, model) => ({
    provider: String(provider), model: model ? String(model) : null, calls: 0, successes: 0, failures: 0,
    successRate: null, failureRate: null, rateLimited: 0, latencyMs: { p50: null, p95: null },
    lastErrorType: null, lastErrorAt: null, lastSuccessAt: null,
    breaker: { state: STATES.CLOSED, openedAt: null, retryAt: null, cooldownMs: 0, consecutiveFailures: 0, trips: 0 },
});

function snapshot(provider, model, now = Date.now()) {
    const entry = entries.get(keyOf(provider, model));
    if (!entry) return emptySnapshot(provider, model);
    const config = settings();
    prune(entry, config, now);
    const state = stateOf(provider, model, now);
    const calls = entry.calls.length;
    const { succeeded, limited } = tally(entry.calls);
    const latencies = entry.calls.filter((c) => c.ok && c.ms !== null).map((c) => c.ms).sort((a, b) => a - b);
    return {
        provider: entry.provider,
        model: entry.model,
        calls,
        successes: succeeded,
        failures: calls - succeeded,
        successRate: calls ? succeeded / calls : null,
        failureRate: calls ? (calls - succeeded) / calls : null,
        rateLimited: limited,
        latencyMs: { p50: quantile(latencies, 0.5), p95: quantile(latencies, 0.95) },
        lastErrorType: entry.lastErrorType,
        lastErrorAt: entry.lastErrorAt ? new Date(entry.lastErrorAt).toISOString() : null,
        lastSuccessAt: entry.lastSuccessAt ? new Date(entry.lastSuccessAt).toISOString() : null,
        breaker: {
            state,
            openedAt: entry.openedAt ? new Date(entry.openedAt).toISOString() : null,
            retryAt: entry.retryAt ? new Date(entry.retryAt).toISOString() : null,
            cooldownMs: entry.cooldownMs,
            consecutiveFailures: entry.consecutiveFailures,
            trips: entry.trips,
        },
    };
}

const reset = () => entries.clear();

const policy = () => ({ ...settings(), scope: 'process' });

module.exports = { STATES, PROVIDER_FAILURES, CALLER_FAILURES, record, admit, releaseProbe, stateOf, snapshot, reset, policy, keyOf };
