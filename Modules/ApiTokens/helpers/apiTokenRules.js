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

const EXPIRY_OVER_MAX = 'API_TOKEN_EXPIRY_OVER_MAX';

/* API_TOKEN_MAX_DAYS can only lower the owner's 365-day cap; anything else reads as unset. */
const configuredMaxDays = (raw = process.env.API_TOKEN_MAX_DAYS) => {
    const text = String(raw ?? '').trim();
    if (!/^\d+$/.test(text)) return null;
    const days = Number(text);
    return days >= MIN_EXPIRY_DAYS && days <= MAX_EXPIRY_DAYS ? days : null;
};

const maxLifetimeDays = () => configuredMaxDays() || MAX_EXPIRY_DAYS;

const maxDaysProblem = (raw = process.env.API_TOKEN_MAX_DAYS) => {
    if (raw === undefined || String(raw).trim() === '' || configuredMaxDays(raw)) return '';
    return `API_TOKEN_MAX_DAYS=${raw} is ignored: it must be a whole number of days from ${MIN_EXPIRY_DAYS} to ${MAX_EXPIRY_DAYS}, so tokens last at most ${MAX_EXPIRY_DAYS} days.`;
};

const maxExpiryDaysFor = ({ strict = isStrict() } = {}) => (strict ? maxLifetimeDays() : MAX_EXPIRY_DAYS);

const hasExpiryInput = (expiresInDays) => expiresInDays !== undefined && expiresInDays !== null && expiresInDays !== '';

/* Validate token creation input. Returns { valid, reason, code? }. */
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
        const maxDays = maxLifetimeDays();
        if (strict && Number.isInteger(days) && days > maxDays) {
            return { valid: false, reason: `An API token can last at most ${maxDays} days: choose an expiry of ${maxDays} days or less.`, code: EXPIRY_OVER_MAX, maxExpiryDays: maxDays };
        }
        if (!Number.isInteger(days) || days < MIN_EXPIRY_DAYS || days > MAX_EXPIRY_DAYS) {
            return { valid: false, reason: `expiresInDays must be an integer between ${MIN_EXPIRY_DAYS} and ${MAX_EXPIRY_DAYS}.` };
        }
    }
    if (strict && (!Array.isArray(scopes) || !scopes.length)) {
        return { valid: false, reason: `At least one scope is required: choose from ${SCOPES.join(', ')}.` };
    }
    if (strict && !hasExpiryInput(expiresInDays)) {
        return { valid: false, reason: `An expiry is required: expiresInDays between ${MIN_EXPIRY_DAYS} and ${maxLifetimeDays()}.` };
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

/* The grace runs from the later of when this instance first ran strict and when the
 * token was made, so a token minted while strict was off still gets its days. An
 * unknown start (the settings could not be read) counts as stopped: fail closed. */
const graceStanding = (tokenDoc, { strict = isStrict(), strictSince, now = new Date() } = {}) => {
    if (!strict || tokenDoc?.expiresAt) return { state: 'ok', deadline: null };
    if (!strictSince) return { state: 'stopped', deadline: null };
    const createdAt = tokenDoc?.createdAt ? new Date(tokenDoc.createdAt).getTime() : 0;
    const start = Math.max(new Date(strictSince).getTime(), Number.isFinite(createdAt) ? createdAt : 0);
    const deadline = new Date(start + STRICT_GRACE_DAYS * DAY_MS);
    return { state: now.getTime() < deadline.getTime() ? 'grace' : 'stopped', deadline };
};

const timeOf = (value) => {
    const ms = value ? new Date(value).getTime() : 0;
    return Number.isFinite(ms) ? ms : 0;
};

/* Only a token that outlives its creation by more than the maximum can be over it,
 * so the start of the cap is looked up for those alone. */
const mayExceedMaxLifetime = (tokenDoc, { strict = isStrict(), maxDays = maxLifetimeDays() } = {}) =>
    strict && Boolean(tokenDoc?.expiresAt) && timeOf(tokenDoc.expiresAt) > timeOf(tokenDoc.createdAt) + maxDays * DAY_MS;

/* A token whose expiry is further off than the maximum works for the maximum counted
 * from the later of when the cap first applied and its creation, like the grace for
 * tokens without an expiry. With the start unknown, a token that expires further off
 * than the maximum from now is over it whenever the cap began, so it counts as stopped. */
const lifetimeStanding = (tokenDoc, { strict = isStrict(), maxLifetimeSince, now = new Date(), maxDays = maxLifetimeDays() } = {}) => {
    if (!mayExceedMaxLifetime(tokenDoc, { strict, maxDays })) return { state: 'ok', deadline: null };
    if (!maxLifetimeSince) {
        return { state: timeOf(tokenDoc.expiresAt) > now.getTime() + maxDays * DAY_MS ? 'stopped' : 'ok', deadline: null };
    }
    const deadline = new Date(Math.max(timeOf(maxLifetimeSince), timeOf(tokenDoc.createdAt)) + maxDays * DAY_MS);
    if (timeOf(tokenDoc.expiresAt) <= deadline.getTime()) return { state: 'ok', deadline: null };
    return { state: now.getTime() < deadline.getTime() ? 'capped' : 'stopped', deadline };
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
    EXPIRY_OVER_MAX,
    STRICT_GRACE_DAYS,
    LAST_USED_WRITE_INTERVAL_MS,
    generateToken,
    hashToken,
    tokenPrefixOf,
    looksLikeToken,
    isStrict,
    maxLifetimeDays,
    maxDaysProblem,
    maxExpiryDaysFor,
    validateCreateInput,
    mayExceedMaxLifetime,
    lifetimeStanding,
    isExpired,
    effectiveScopes,
    hasScope,
    graceStanding,
    lastUsedIsStale,
};
