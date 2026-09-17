// No database or module dependencies, so Config/jwt.js can require this at load time.

const crypto = require('crypto');

const TOKEN_PREFIX = 'ahp_';
const TOKEN_BYTES = 24; // 48 hex chars
const PREFIX_LENGTH = 12;
const MAX_NAME_LENGTH = 80;
const SCOPES = Object.freeze(['read', 'write']);
const MIN_EXPIRY_DAYS = 1;
const MAX_EXPIRY_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;
const STRICT_GRACE_DAYS = 30;
const LAST_USED_WRITE_INTERVAL_MS = 5 * 60 * 1000;
const STRICT_ON = ['true', '1', 'on', 'yes'];

const generateToken = () => TOKEN_PREFIX + crypto.randomBytes(TOKEN_BYTES).toString('hex');

const hashToken = (rawToken) => crypto.createHash('sha256').update(String(rawToken)).digest('hex');

const tokenPrefixOf = (rawToken) => String(rawToken).slice(0, PREFIX_LENGTH);

const looksLikeToken = (rawToken) => typeof rawToken === 'string' && rawToken.startsWith(TOKEN_PREFIX) && rawToken.length === TOKEN_PREFIX.length + TOKEN_BYTES * 2;

const isStrict = () => STRICT_ON.includes(String(process.env.API_TOKEN_STRICT || 'false').trim().toLowerCase());

const hasExpiryInput = (expiresInDays) => expiresInDays !== undefined && expiresInDays !== null && expiresInDays !== '';

/* Validate token creation input. Returns { valid, reason }. */
const validateCreateInput = ({ name, scopes, expiresInDays }, { strict = isStrict() } = {}) => {
    if (!name || !String(name).trim() || String(name).length > MAX_NAME_LENGTH) {
        return { valid: false, reason: `A name up to ${MAX_NAME_LENGTH} characters is required.` };
    }
    if (scopes !== undefined) {
        if (!Array.isArray(scopes) || scopes.some((scope) => !SCOPES.includes(scope))) {
            return { valid: false, reason: `scopes must be an array drawn from: ${SCOPES.join(', ')}.` };
        }
    }
    if (hasExpiryInput(expiresInDays)) {
        const days = Number(expiresInDays);
        if (!Number.isInteger(days) || days < MIN_EXPIRY_DAYS || days > MAX_EXPIRY_DAYS) {
            return { valid: false, reason: `expiresInDays must be an integer between ${MIN_EXPIRY_DAYS} and ${MAX_EXPIRY_DAYS}.` };
        }
    }
    if (strict && (!Array.isArray(scopes) || !scopes.length)) {
        return { valid: false, reason: `At least one scope is required: choose from ${SCOPES.join(', ')}.` };
    }
    if (strict && !hasExpiryInput(expiresInDays)) {
        return { valid: false, reason: `An expiry is required: expiresInDays between ${MIN_EXPIRY_DAYS} and ${MAX_EXPIRY_DAYS}.` };
    }
    return { valid: true, reason: '' };
};

const isExpired = (tokenDoc, now = new Date()) =>
    Boolean(tokenDoc?.expiresAt) && new Date(tokenDoc.expiresAt).getTime() < now.getTime();

/* Every scope check in the product asks for read or write, so empty scopes
 * ("full access") never granted more than both; strict mode names them. */
const effectiveScopes = (tokenDoc, { strict = isStrict() } = {}) => {
    const scopes = tokenDoc?.scopes || [];
    return strict && !scopes.length ? [...SCOPES] : scopes;
};

const hasScope = (tokenDoc, scope, { strict = isStrict() } = {}) => {
    const scopes = effectiveScopes(tokenDoc, { strict });
    return (!strict && scopes.length === 0) || scopes.includes(scope);
};

/* The grace is counted from when this instance first ran strict, not from the
 * token's age, so every token without an expiry shares one deadline. */
const graceStanding = (tokenDoc, { strict = isStrict(), strictSince, now = new Date() } = {}) => {
    if (!strict || tokenDoc?.expiresAt || !strictSince) return { state: 'ok', deadline: null };
    const deadline = new Date(new Date(strictSince).getTime() + STRICT_GRACE_DAYS * DAY_MS);
    return { state: now.getTime() < deadline.getTime() ? 'grace' : 'stopped', deadline };
};

const lastUsedIsStale = (tokenDoc, now = new Date()) =>
    !tokenDoc?.lastUsedAt || now.getTime() - new Date(tokenDoc.lastUsedAt).getTime() >= LAST_USED_WRITE_INTERVAL_MS;

module.exports = {
    TOKEN_PREFIX,
    PREFIX_LENGTH,
    MAX_NAME_LENGTH,
    SCOPES,
    MIN_EXPIRY_DAYS,
    MAX_EXPIRY_DAYS,
    STRICT_GRACE_DAYS,
    LAST_USED_WRITE_INTERVAL_MS,
    generateToken,
    hashToken,
    tokenPrefixOf,
    looksLikeToken,
    isStrict,
    validateCreateInput,
    isExpired,
    effectiveScopes,
    hasScope,
    graceStanding,
    lastUsedIsStale,
};
