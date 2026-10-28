const hostingMode = require('../../Config/hostingMode');
const logger = require('../../Config/loggerConfig');
const { verifyEntitlementsToken } = require('./entitlementsToken');
const { STATE_IDS, readState, writeState } = require('./platformState');

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;
const PULL_TIMEOUT_MS = 10 * 1000;

/* Starter, baked into the image: what a hosted instance runs with before the platform's first push.
 * Never unlimited. Numbers follow architecture §12 and change with it. */
const DEFAULT_ENTITLEMENTS = Object.freeze({
    instanceId: '',
    version: 0,
    issuedAt: null,
    plan: 'starter',
    lifecycle: 'active',
    limits: Object.freeze({ seats: 10, guests: 5, workspaces: 1, storageBytes: 20 * GB, maxFileBytes: 50 * MB, emailsPerDay: 500 }),
    features: Object.freeze({ timeTracker: Object.freeze({ enabled: false, seats: 0 }), customDomain: false, ownSmtp: false, sso: false }),
    graceUntil: null,
    portalUrl: '',
});

let stored = null;
let loaded = false;
let missingLogged = false;

const storedEntitlements = () => stored;
const currentEntitlements = () => (stored && stored.payload) || { ...DEFAULT_ENTITLEMENTS, instanceId: process.env.INSTANCE_ID || '' };
const storedVersion = () => (stored && Number(stored.version)) || 0;

async function loadEntitlements() {
    stored = await readState(STATE_IDS.ENTITLEMENTS);
    loaded = true;
    return stored;
}

/* 064 owns enforcement. Until Modules/Entitlements exists the document is only stored. */
async function applyDownstream(payload) {
    let entitlementsModule;
    try {
        entitlementsModule = require('../Entitlements');
    } catch (error) {
        if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('Entitlements')) {
            if (!missingLogged) logger.info('[platform] entitlements stored; nothing enforces them yet (Modules/Entitlements is not installed)');
            missingLogged = true;
            return false;
        }
        throw error;
    }
    if (typeof entitlementsModule.applyEntitlements !== 'function') return false;
    await entitlementsModule.applyEntitlements(payload);
    return true;
}

const refused = (verdict) => Object.assign(new Error(verdict.message), { code: verdict.code, statusCode: 400 });

/* A version at or below the stored one is not an error: the platform retries, and a push and a
 * pull can cross. The stored document is replaced only by a newer verified one. */
async function acceptEntitlementsToken(token, { source = 'push', now = Date.now() } = {}) {
    const verdict = verifyEntitlementsToken(token, { now });
    if (!verdict.ok) throw refused(verdict);
    if (!loaded) await loadEntitlements();
    const { payload, header } = verdict;
    if (payload.version <= storedVersion()) return { applied: false, version: storedVersion() };
    stored = await writeState(STATE_IDS.ENTITLEMENTS, { token: String(token), payload, version: payload.version, source, kid: header.kid ? String(header.kid) : '', appliedAt: new Date(now) });
    await applyDownstream(payload);
    return { applied: true, version: payload.version };
}

const pullUrl = () => `${String(process.env.PLATFORM_URL || '').replace(/\/+$/, '')}/api/v1/instances/${encodeURIComponent(process.env.INSTANCE_ID || '')}/entitlements`;

/* At boot and every 6 hours, so a push that never arrived still lands. The platform being down
 * changes nothing: the stored document, or the Starter defaults, stay in force. */
async function pullEntitlements({ fetchImpl = global.fetch, timeoutMs = PULL_TIMEOUT_MS } = {}) {
    if (!hostingMode.isManaged()) return { ok: false, reason: 'self-hosted' };
    const keep = (reason) => {
        logger.warn(`[platform] entitlements pull failed, keeping version ${storedVersion()}: ${reason}`);
        return { ok: false, reason, version: storedVersion() };
    };
    let body;
    try {
        const res = await fetchImpl(pullUrl(), {
            headers: { 'x-platform-key': process.env.PLATFORM_API_KEY || '', accept: 'application/json' },
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) return keep(`HTTP ${res.status}`);
        body = await res.json();
    } catch (error) {
        return keep(error && error.message ? error.message : String(error));
    }
    const token = body && (body.token || (body.data && body.data.token));
    if (!token) return keep('no token in the answer');
    try {
        return { ok: true, ...(await acceptEntitlementsToken(token, { source: 'pull' })) };
    } catch (error) {
        return keep(`${error.code || 'error'}: ${error.message}`);
    }
}

module.exports = {
    DEFAULT_ENTITLEMENTS, currentEntitlements, storedEntitlements, storedVersion, loadEntitlements, acceptEntitlementsToken, pullEntitlements, applyDownstream,
    _resetForTests: () => { stored = null; loaded = false; missingLogged = false; },
};
