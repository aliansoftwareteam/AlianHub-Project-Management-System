const { isProviderError } = require('../AICore/providerError');
const { backoffLadder } = require('./flag');

// Is this failure worth trying again?
//
// A deterministic failure — no such action, no such status, a rejected request —
// fails identically forever, so a retry only multiplies the cost of a broken
// step. A transient one — a dropped socket, a 5xx, a Mongo timeout, a vendor
// rate limit — is worth backing off for.
//
// A provider error already knows the answer: AICore classified it at the vendor
// boundary and `retryable` is that classification, so this reads it rather than
// guessing again from the message.

const DETERMINISTIC_NAMES = new Set(['DeterministicError', 'ValidationError', 'CastError', 'StrictModeError', 'TypeError', 'ReferenceError']);
const TRANSIENT_NAMES = new Set(['MongoNetworkError', 'MongoServerSelectionError', 'MongoTimeoutError', 'MongoNotConnectedError']);
const TRANSIENT_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNABORTED', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH', 'ERR_NETWORK']);

const classify = (error) => {
    if (isProviderError(error)) {
        return { deterministic: !error.retryable, type: error.type, code: error.code, retryAfterMs: error.retryAfterMs || null };
    }
    const name = String((error && error.name) || '');
    const code = error && error.code !== undefined && error.code !== null ? String(error.code) : null;
    // An explicit flag from the caller wins over every heuristic below.
    if (error && typeof error.deterministic === 'boolean') {
        return { deterministic: error.deterministic, type: error.deterministic ? 'deterministic' : 'transient', code: code || name || null, retryAfterMs: null };
    }
    if (TRANSIENT_NAMES.has(name) || (code && TRANSIENT_CODES.has(code))) {
        return { deterministic: false, type: 'transient', code: code || name, retryAfterMs: null };
    }
    if (DETERMINISTIC_NAMES.has(name)) {
        return { deterministic: true, type: 'deterministic', code: code || name, retryAfterMs: null };
    }
    // An unrecognised failure is treated as transient, which is what the
    // automation runner has always done: an unclassified error retried three
    // times is cheaper than a recoverable one abandoned on the first blip.
    return { deterministic: false, type: 'unknown', code: code || name || null, retryAfterMs: null };
};

/* Jitter so a burst of steps that failed together does not come back together. */
const backoffMs = (attempt, { retryAfterMs = null, jitter = Math.random } = {}) => {
    if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) return Math.round(retryAfterMs);
    const ladder = backoffLadder();
    const base = ladder[Math.min(Math.max(attempt, 1) - 1, ladder.length - 1)];
    return Math.round(base * (0.9 + 0.2 * jitter()));
};

/* The one decision a failed step makes: give up, or come back at `runAt`. */
const decide = (error, { attempt, maxAttempts }) => {
    const failure = classify(error);
    if (failure.deterministic) return { retry: false, reason: 'deterministic', failure };
    if (attempt >= maxAttempts) return { retry: false, reason: 'attempts_exhausted', failure };
    return { retry: true, reason: 'transient', failure, delayMs: backoffMs(attempt, { retryAfterMs: failure.retryAfterMs }) };
};

module.exports = { classify, backoffMs, decide, DETERMINISTIC_NAMES, TRANSIENT_NAMES, TRANSIENT_CODES };
