const crypto = require('crypto');

const MODES = ['self', 'managed'];
const INSTANCE_ID_PATTERN = /^ins_[a-z0-9]{20,32}$/;
const MIN_KEY_LENGTH = 32;
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const BASE64_PATTERN = /^[A-Za-z0-9+/_-]+={0,2}$/;

let cachedMode = null;
let portalOverride = '';

const modeOf = (env) => (String(env.HOSTING_MODE || '').trim().toLowerCase() === 'managed' ? 'managed' : 'self');

/* Read once: every branch that differs between hosted and self-hosted asks this, and a value
 * that changed under a running process would leave half the app in each mode. */
function mode() {
    if (!cachedMode) cachedMode = modeOf(process.env);
    return cachedMode;
}

const isManaged = () => mode() === 'managed';

function platform(env = process.env) {
    return { instanceId: env.INSTANCE_ID || '', url: env.PLATFORM_URL || '', publicKey: env.PLATFORM_PUBLIC_KEY || '' };
}

/* PEM, or base64/base64url of either the raw 32-byte key or its SPKI DER. */
function ed25519PublicKey(text) {
    const value = String(text || '').trim();
    if (!value) return null;
    try {
        let key;
        if (value.includes('BEGIN PUBLIC KEY')) key = crypto.createPublicKey(value);
        else {
            if (!BASE64_PATTERN.test(value)) return null;
            const der = Buffer.from(value, 'base64');
            key = crypto.createPublicKey({ key: der.length === 32 ? Buffer.concat([ED25519_SPKI_PREFIX, der]) : der, format: 'der', type: 'spki' });
        }
        return key.asymmetricKeyType === 'ed25519' ? key : null;
    } catch {
        return null;
    }
}

const isHttpsUrl = (value) => {
    try {
        return new URL(String(value || '')).protocol === 'https:';
    } catch {
        return false;
    }
};

/* Values are never echoed: two of them are secrets, and the line lands in container logs. */
function bootProblems(env = process.env) {
    const raw = String(env.HOSTING_MODE || '').trim();
    if (raw && !MODES.includes(raw.toLowerCase())) return ['HOSTING_MODE must be "self" or "managed"'];
    if (modeOf(env) !== 'managed') return [];
    const problems = [];
    if (!env.INSTANCE_ID) problems.push('INSTANCE_ID is not set');
    else if (!INSTANCE_ID_PATTERN.test(env.INSTANCE_ID)) problems.push('INSTANCE_ID must be "ins_" followed by 20 to 32 lowercase letters or digits');
    if (String(env.PLATFORM_API_KEY || '').length < MIN_KEY_LENGTH) problems.push(`PLATFORM_API_KEY must be at least ${MIN_KEY_LENGTH} characters`);
    if (!ed25519PublicKey(env.PLATFORM_PUBLIC_KEY)) problems.push('PLATFORM_PUBLIC_KEY is not an Ed25519 public key (PEM, or base64 of the raw key or of its SPKI DER)');
    if (!isHttpsUrl(env.PLATFORM_URL)) problems.push('PLATFORM_URL must be an https:// URL');
    if (!isHttpsUrl(env.WEBURL)) problems.push('WEBURL must be an https:// URL');
    if (String(env.JWT_SECRET || '').length < MIN_KEY_LENGTH) problems.push(`JWT_SECRET must be at least ${MIN_KEY_LENGTH} characters`);
    return problems;
}

/* Exits before anything listens or touches the database, so a hosted stack with a broken .env
 * never serves an open setup wizard. */
function refuseBadBoot({ env = process.env, log = console.error, exit = (code) => process.exit(code) } = {}) {
    const problems = bootProblems(env);
    if (!problems.length) return true;
    log(`[FATAL] hosting-mode: refusing to start: ${problems.join('; ')}`);
    exit(1);
    return false;
}

const setPortalUrl = (url) => { portalOverride = String(url || ''); };

function portalUrl() {
    if (!isManaged()) return '';
    return portalOverride || process.env.PLATFORM_URL || '';
}

module.exports = {
    MODES, mode, isManaged, platform, ed25519PublicKey, bootProblems, refuseBadBoot, setPortalUrl, portalUrl,
    _resetForTests: () => { cachedMode = null; portalOverride = ''; },
};
