const crypto = require('crypto');
const hostingMode = require('../../Config/hostingMode');
const logger = require('../../Config/loggerConfig');
const { logCall } = require('./platformAudit');
const { STATE_IDS, readState } = require('./platformState');

const KEY_HEADER = 'x-platform-key';
const FAILURE_WINDOW_MS = 60 * 1000;
const FAILURES_TO_BLOCK = 10;
const BLOCK_MS = 15 * 60 * 1000;
const KEYS_CACHE_MS = 30 * 1000;

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest();
const sha256Hex = (value) => sha256(value).toString('hex');

/* Both sides hashed first, so the comparison takes the same time whatever the length of the guess. */
const sameSecret = (given, expectedDigest) => expectedDigest.length === 32 && crypto.timingSafeEqual(sha256(given), expectedDigest);

let extraKeys = { rows: [], readAt: 0 };

async function rotatedKeys(now = Date.now()) {
    if (now - extraKeys.readAt < KEYS_CACHE_MS) return extraKeys.rows;
    try {
        const doc = await readState(STATE_IDS.KEYS);
        extraKeys = { rows: (doc && doc.extraKeys) || [], readAt: now };
    } catch (error) {
        logger.error(`[platform] rotated keys unreadable: ${error && error.message ? error.message : error}`);
        extraKeys = { rows: extraKeys.rows, readAt: now };
    }
    return extraKeys.rows;
}

async function keyMatches(given, now = Date.now()) {
    if (!given) return false;
    const envKey = process.env.PLATFORM_API_KEY || '';
    let match = envKey ? sameSecret(given, sha256(envKey)) : false;
    for (const row of await rotatedKeys(now)) {
        if (!row || !row.hash || new Date(row.expiresAt).getTime() <= now) continue;
        if (sameSecret(given, Buffer.from(String(row.hash), 'hex'))) match = true;
    }
    return match;
}

const failures = new Map();

const sourceOf = (req) => String((req.socket && req.socket.remoteAddress) || req.ip || 'unknown');

function blockedUntil(source, now) {
    const entry = failures.get(source);
    return entry && entry.blockedUntil > now ? entry.blockedUntil : 0;
}

/* Returns true when this failure is the one that blocks the source. */
function noteFailure(source, now) {
    const entry = failures.get(source) || { at: [], blockedUntil: 0 };
    entry.at = entry.at.filter((t) => now - t < FAILURE_WINDOW_MS).concat(now);
    let blocks = false;
    if (entry.at.length >= FAILURES_TO_BLOCK) {
        entry.blockedUntil = now + BLOCK_MS;
        entry.at = [];
        blocks = true;
    }
    failures.set(source, entry);
    return blocks;
}

const refusal = (status, statusText) => ({ status, statusText });

/* The three locks behind the edge's refusal of the path: hosted mode only, never through a proxy,
 * and the key. Null means the call may go on; req.platform then carries its request id. */
async function checkPlatformCall(req, now = Date.now()) {
    if (!hostingMode.isManaged()) return refusal(404, 'Not found.');
    const requestId = String(req.headers['x-request-id'] || '');
    const source = sourceOf(req);
    if (req.headers['x-forwarded-for'] !== undefined) {
        logCall({ action: 'platform.auth_forwarded', requestId, ok: false, summary: `forwarded call from ${source}` });
        return refusal(403, 'The platform API is not reachable through a proxy.');
    }
    if (blockedUntil(source, now)) return refusal(429, 'Too many failed attempts. Try again later.');
    if (!(await keyMatches(String(req.headers[KEY_HEADER] || ''), now))) {
        logCall({ action: 'platform.auth_failed', requestId, ok: false, summary: `${req.method} ${req.path} from ${source}` });
        if (noteFailure(source, now)) {
            logCall({ action: 'platform.auth_blocked', requestId, ok: false, summary: `${FAILURES_TO_BLOCK} failures/min from ${source}` });
        }
        return refusal(401, 'The platform key is missing or wrong.');
    }
    req.platform = { requestId };
    return null;
}

function requirePlatform(req, res, next) {
    return checkPlatformCall(req).then((refused) => {
        if (refused) return res.status(refused.status).send({ status: false, statusText: refused.statusText });
        return next();
    }).catch((error) => res.status(500).send({ status: false, statusText: error.message }));
}

const carriesPlatformKey = (req) => hostingMode.isManaged() && req.headers[KEY_HEADER] !== undefined;

module.exports = {
    KEY_HEADER, FAILURES_TO_BLOCK, BLOCK_MS, requirePlatform, checkPlatformCall, carriesPlatformKey, keyMatches, sha256Hex,
    forgetRotatedKeys: () => { extraKeys = { rows: [], readAt: 0 }; },
    _resetForTests: () => { failures.clear(); extraKeys = { rows: [], readAt: 0 }; },
};
