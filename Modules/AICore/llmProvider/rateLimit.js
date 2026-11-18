/* A token bucket per provider, holding requests per minute.
 *
 * Like the health window this is per process: the limit configured is what one
 * node will spend, so a multi-node install shares the vendor's real limit
 * between its nodes rather than enforcing it centrally. The bucket is a brake,
 * not the authority — the vendor's own 429 is — and a 429 tightens the bucket
 * by draining it for as long as the retry hint asks. */

const MINUTE_MS = 60000;

const num = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const defaultRpm = () => num(process.env.AI_ROUTER_DEFAULT_RPM, 0);

/* `AI_ROUTER_RATE_LIMITS="openai:500,anthropic:200"` — requests per minute per
 * provider. A provider with no entry falls back to AI_ROUTER_DEFAULT_RPM, and
 * 0 means no bucket at all, which is the default and today's behaviour. */
function configuredLimits() {
    const raw = String(process.env.AI_ROUTER_RATE_LIMITS || '').trim();
    const limits = {};
    if (!raw) return limits;
    raw.split(',').forEach((pair) => {
        const [name, value] = pair.split(':');
        const provider = String(name || '').trim().toLowerCase();
        const rpm = Number(String(value || '').trim());
        if (provider && Number.isFinite(rpm) && rpm >= 0) limits[provider] = rpm;
    });
    return limits;
}

const limitFor = (provider) => {
    const limits = configuredLimits();
    const named = limits[String(provider || '').toLowerCase()];
    return Number.isFinite(named) ? named : defaultRpm();
};

const buckets = new Map();

function bucketOf(provider, now) {
    const key = String(provider || 'unknown').toLowerCase();
    let bucket = buckets.get(key);
    if (!bucket) {
        bucket = { provider: key, tokens: 0, capacity: 0, filledAt: now, blockedUntil: null, waits: 0, refusals: 0 };
        buckets.set(key, bucket);
    }
    const capacity = limitFor(key);
    if (bucket.capacity !== capacity) {
        bucket.capacity = capacity;
        bucket.tokens = capacity;
        bucket.filledAt = now;
    }
    if (capacity > 0) {
        const earned = ((now - bucket.filledAt) / MINUTE_MS) * capacity;
        if (earned > 0) {
            bucket.tokens = Math.min(capacity, bucket.tokens + earned);
            bucket.filledAt = now;
        }
    }
    return bucket;
}

/**
 * @returns {{allowed: boolean, waitMs: number, limitPerMinute: number}}
 *          `waitMs` is how long until one token exists, so the caller can
 *          decide between waiting briefly and taking the next candidate.
 */
function take(provider, now = Date.now()) {
    const bucket = bucketOf(provider, now);
    if (!bucket.capacity) return { allowed: true, waitMs: 0, limitPerMinute: 0 };
    if (bucket.blockedUntil !== null && now < bucket.blockedUntil) {
        bucket.refusals += 1;
        return { allowed: false, waitMs: bucket.blockedUntil - now, limitPerMinute: bucket.capacity };
    }
    if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return { allowed: true, waitMs: 0, limitPerMinute: bucket.capacity };
    }
    bucket.refusals += 1;
    return { allowed: false, waitMs: Math.ceil(((1 - bucket.tokens) / bucket.capacity) * MINUTE_MS), limitPerMinute: bucket.capacity };
}

/* The vendor said we are over its limit: stop spending this bucket until its
 * retry hint has passed, so the next call does not earn another 429. */
function tighten(provider, retryAfterMs, now = Date.now()) {
    const bucket = bucketOf(provider, now);
    const until = now + Math.max(0, Number(retryAfterMs) || 0);
    bucket.tokens = 0;
    bucket.filledAt = now;
    if (bucket.blockedUntil === null || until > bucket.blockedUntil) bucket.blockedUntil = until;
    bucket.waits += 1;
    return bucket.blockedUntil;
}

function budget(provider, now = Date.now()) {
    const bucket = bucketOf(provider, now);
    return {
        provider: bucket.provider,
        limitPerMinute: bucket.capacity,
        available: bucket.capacity ? Math.floor(bucket.tokens) : null,
        blockedUntil: bucket.blockedUntil && bucket.blockedUntil > now ? new Date(bucket.blockedUntil).toISOString() : null,
        refusals: bucket.refusals,
    };
}

const waitMs = () => num(process.env.AI_ROUTER_RATE_WAIT_MS, 2000);

const reset = () => buckets.clear();

module.exports = { take, tighten, budget, limitFor, configuredLimits, waitMs, reset, MINUTE_MS };
