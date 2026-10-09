const POLL_MS = 5 * 60 * 1000;
const MAX_DELAY_MS = 6 * 60 * 60 * 1000;
const LEASE_MS = 4 * 60 * 1000;
const ERROR_MAX = 300;

const delayAfter = (failures) => Math.min(MAX_DELAY_MS, POLL_MS * 2 ** Math.max(0, Number(failures) - 1));

/* A rate-limited service says when to come back: Retry-After (seconds or a date) first, then the reset of its window
 * (epoch seconds). That time wins over the general backoff, within the same ceiling. */
const namedRetryAt = (retry, now) => {
    if (!retry) return null;
    if (retry.after !== undefined && retry.after !== null) {
        const seconds = Number(retry.after);
        const at = Number.isFinite(seconds) ? now + seconds * 1000 : Date.parse(retry.after);
        if (Number.isFinite(at)) return at;
    }
    const reset = Number(retry.reset);
    return Number.isFinite(reset) && reset > 0 ? reset * 1000 : null;
};

const nextAttempt = (error, failures, now) => {
    const named = namedRetryAt(error && error.retry, now);
    if (named !== null && named > now) return Math.min(named, now + MAX_DELAY_MS);
    return now + delayAfter(failures);
};

const isDue = (sync, now) => !sync || !sync.nextAttemptAt || new Date(sync.nextAttemptAt).getTime() <= now;

/* A thrown message can echo a request: the token is cut out before anything is stored or shown. */
const cleanError = (error, secrets = []) => {
    let text = String((error && error.message) || error || 'Unknown error');
    for (const secret of secrets.filter((s) => s && String(s).length > 3)) text = text.split(String(secret)).join('…');
    return text.replace(/\s+/g, ' ').slice(0, ERROR_MAX);
};

module.exports = { POLL_MS, MAX_DELAY_MS, LEASE_MS, delayAfter, nextAttempt, isDue, cleanError };
