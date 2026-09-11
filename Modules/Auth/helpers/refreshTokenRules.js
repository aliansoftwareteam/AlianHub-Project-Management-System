const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const REFRESH_TOKEN_TYPE = 'refresh';
const TOKEN_TAIL_LENGTH = 6;
const DEFAULT_REUSE_GRACE_SECONDS = 10;
// Tokens minted before subject/jti were added carry only these claims.
const LEGACY_CLAIMS = ['iat', 'exp'];

const sessionLifetimeSeconds = () => Number(process.env.SESSIONEXPIREDTIME || 172800);

// Parallel requests (or two tabs sharing the cookie) can send the same token
// before the first rotation lands; inside this window the repeat is refused
// without revoking the session.
const reuseGraceSeconds = () => {
    const raw = Number(process.env.REFRESH_TOKEN_REUSE_GRACE_SECONDS);
    return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_REUSE_GRACE_SECONDS;
};

const hashRefreshToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

const tokenTailOf = (token) => String(token || '').slice(-TOKEN_TAIL_LENGTH);

const signRefreshToken = ({ userId, sessionId, expiresAt }) => {
    const exp = expiresAt || Math.floor(Date.now() / 1000) + sessionLifetimeSeconds();
    const jti = crypto.randomUUID();
    const token = jwt.sign(
        { sub: String(userId), sid: String(sessionId), typ: REFRESH_TOKEN_TYPE, exp },
        process.env.JWT_SECRET,
        { algorithm: process.env.JWT_ALGORITHM, jwtid: jti }
    );
    return { token, jti, exp };
};

const isLegacyPayload = (payload) => Object.keys(payload).every((claim) => LEGACY_CLAIMS.includes(claim));

const isCurrentPayload = (payload) => payload.typ === REFRESH_TOKEN_TYPE
    && typeof payload.sub === 'string' && payload.sub
    && typeof payload.sid === 'string' && payload.sid
    && typeof payload.jti === 'string' && payload.jti;

const readRefreshToken = (token) => {
    if (!token || typeof token !== 'string') return { valid: false, reason: 'missing' };
    let payload;
    try {
        payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
        return { valid: false, reason: error.name === 'TokenExpiredError' ? 'expired' : 'invalid' };
    }
    if (!payload || typeof payload !== 'object') return { valid: false, reason: 'invalid' };
    if (isCurrentPayload(payload)) return { valid: true, legacy: false, payload };
    if (isLegacyPayload(payload)) return { valid: true, legacy: true, payload };
    return { valid: false, reason: 'invalid' };
};

const sessionTokenQuery = (token) => ({
    $or: [{ refreshTokenHash: hashRefreshToken(token) }, { refreshToken: String(token) }],
});

module.exports = {
    REFRESH_TOKEN_TYPE,
    hashRefreshToken,
    tokenTailOf,
    signRefreshToken,
    readRefreshToken,
    reuseGraceSeconds,
    sessionLifetimeSeconds,
    sessionTokenQuery,
};
