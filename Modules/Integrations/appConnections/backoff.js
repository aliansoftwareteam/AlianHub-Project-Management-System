const POLL_MS = 5 * 60 * 1000;
const MAX_DELAY_MS = 6 * 60 * 60 * 1000;
const LEASE_MS = 4 * 60 * 1000;
const ERROR_MAX = 300;

const delayAfter = (failures) => Math.min(MAX_DELAY_MS, POLL_MS * 2 ** Math.max(0, Number(failures) - 1));

const isDue = (sync, now) => !sync || !sync.nextAttemptAt || new Date(sync.nextAttemptAt).getTime() <= now;

/* A thrown message can echo a request: the token is cut out before anything is stored or shown. */
const cleanError = (error, secrets = []) => {
    let text = String((error && error.message) || error || 'Unknown error');
    for (const secret of secrets.filter((s) => s && String(s).length > 3)) text = text.split(String(secret)).join('…');
    return text.replace(/\s+/g, ' ').slice(0, ERROR_MAX);
};

module.exports = { POLL_MS, MAX_DELAY_MS, LEASE_MS, delayAfter, isDue, cleanError };
