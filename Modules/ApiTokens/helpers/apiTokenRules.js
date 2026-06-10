// API-token rules. Pure (node crypto only) — shared by controller,
// public-API middleware and tests.

const crypto = require('crypto');

const TOKEN_PREFIX = 'ahp_';
const TOKEN_BYTES = 24; // 48 hex chars
const PREFIX_LENGTH = 12;
const MAX_NAME_LENGTH = 80;
const SCOPES = Object.freeze(['read', 'write']);
const MIN_EXPIRY_DAYS = 1;
const MAX_EXPIRY_DAYS = 365;

const generateToken = () => TOKEN_PREFIX + crypto.randomBytes(TOKEN_BYTES).toString('hex');

const hashToken = (rawToken) => crypto.createHash('sha256').update(String(rawToken)).digest('hex');

const tokenPrefixOf = (rawToken) => String(rawToken).slice(0, PREFIX_LENGTH);

const looksLikeToken = (rawToken) => typeof rawToken === 'string' && rawToken.startsWith(TOKEN_PREFIX) && rawToken.length === TOKEN_PREFIX.length + TOKEN_BYTES * 2;

/* Validate token creation input. Returns { valid, reason }. */
const validateCreateInput = ({ name, scopes, expiresInDays }) => {
    if (!name || !String(name).trim() || String(name).length > MAX_NAME_LENGTH) {
        return { valid: false, reason: `A name up to ${MAX_NAME_LENGTH} characters is required.` };
    }
    if (scopes !== undefined) {
        if (!Array.isArray(scopes) || scopes.some((scope) => !SCOPES.includes(scope))) {
            return { valid: false, reason: `scopes must be an array drawn from: ${SCOPES.join(', ')}.` };
        }
    }
    if (expiresInDays !== undefined && expiresInDays !== null && expiresInDays !== '') {
        const days = Number(expiresInDays);
        if (!Number.isInteger(days) || days < MIN_EXPIRY_DAYS || days > MAX_EXPIRY_DAYS) {
            return { valid: false, reason: `expiresInDays must be an integer between ${MIN_EXPIRY_DAYS} and ${MAX_EXPIRY_DAYS}.` };
        }
    }
    return { valid: true, reason: '' };
};

const isExpired = (tokenDoc, now = new Date()) =>
    Boolean(tokenDoc?.expiresAt) && new Date(tokenDoc.expiresAt).getTime() < now.getTime();

/* Does a token authorize this scope? Empty scopes = full access. */
const hasScope = (tokenDoc, scope) => {
    const scopes = tokenDoc?.scopes || [];
    return scopes.length === 0 || scopes.includes(scope);
};

module.exports = {
    TOKEN_PREFIX,
    PREFIX_LENGTH,
    MAX_NAME_LENGTH,
    SCOPES,
    generateToken,
    hashToken,
    tokenPrefixOf,
    looksLikeToken,
    validateCreateInput,
    isExpired,
    hasScope,
};
