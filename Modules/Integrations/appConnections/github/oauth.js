const crypto = require('crypto');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { buildCorsAllowList, isOriginAllowed } = require('../../../../utils/cors');
const secretField = require('../../../../utils/secretField');

const CALLBACK_PATH = '/api/v1/github-connect/callback';
const STATE_AUDIENCE = 'alianhub:app-connections:github';
const STATE_TTL_SECONDS = 10 * 60;
const MAX_STATE_LENGTH = 2000;
const MAX_CODE_LENGTH = 512;
/* GitHub OAuth Apps have no read-only scope for private repositories; `repo` is the smallest that lists their pull requests. */
const SCOPE = 'repo';
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const clientId = () => String(process.env.GITHUB_CONNECT_CLIENT_ID || process.env.GITHUB_CLIENT_ID || '').trim();
const clientSecret = () => String(process.env.GITHUB_CONNECT_CLIENT_SECRET || process.env.GITHUB_CLIENT_SECRET || '').trim();
const oauthBase = () => String(process.env.GITHUB_BASE_OAUTH_URL || 'https://github.com/login/oauth').replace(/\/+$/, '');
const apiBase = () => String(process.env.APIURL || '').replace(/\/+$/, '');
const fallbackOrigin = () => String(process.env.WEBURL || '').split(',').map((entry) => entry.trim().replace(/\/+$/, '')).find(Boolean) || apiBase();

const isConfigured = () => !!(clientId() && clientSecret() && apiBase());
const redirectUri = () => `${apiBase()}${CALLBACK_PATH}`;
const hash = (text) => crypto.createHash('sha256').update(String(text)).digest('hex');
const challengeOf = (verifier) => crypto.createHash('sha256').update(String(verifier)).digest('base64url');

/* The JWT secret is suffixed so a state can never pass as a session token, nor a session token as a state. */
const stateSecret = () => {
    const secret = String(process.env.JWT_SECRET || '');
    if (!secret) throw new Error('JWT_SECRET is not set.');
    return `${secret}::app-connections-github-state`;
};

/* The origin is checked against the CORS allow-list before it is signed, so the callback cannot become an open redirect. */
const returnOriginOf = (req) => {
    const headers = (req && req.headers) || {};
    const fromReferer = (() => { try { return new URL(String(headers.referer || '')).origin; } catch (e) { return ''; } })();
    const allowList = buildCorsAllowList();
    for (const candidate of [headers.origin, fromReferer]) {
        const value = String(candidate || '').replace(/\/+$/, '');
        if (value && /^https?:\/\//i.test(value) && isOriginAllowed(value, allowList)) return value;
    }
    return '';
};

/* The PKCE verifier rides in the state encrypted, so the state passes through GitHub and the address bar without revealing it. */
const encodeState = ({ companyId, userId, sessionId = '', returnOrigin = '' }, now = Date.now()) => {
    const verifier = crypto.randomBytes(48).toString('base64url');
    const state = jwt.sign(
        {
            companyId: String(companyId), userId: String(userId), sid: hash(sessionId || ''), nonce: crypto.randomBytes(16).toString('hex'),
            pkce: secretField.encrypt(verifier), returnOrigin: String(returnOrigin || ''), iat: Math.floor(now / 1000),
        },
        stateSecret(),
        { algorithm: 'HS256', audience: STATE_AUDIENCE, expiresIn: STATE_TTL_SECONDS },
    );
    return { state, challenge: challengeOf(verifier) };
};

const decodeState = (token, now = Date.now()) => {
    if (typeof token !== 'string' || !token || token.length > MAX_STATE_LENGTH) return null;
    try {
        const d = jwt.verify(token, stateSecret(), { algorithms: ['HS256'], audience: STATE_AUDIENCE, clockTimestamp: Math.floor(now / 1000) });
        return d && OBJECT_ID.test(String(d.companyId)) && OBJECT_ID.test(String(d.userId)) && d.nonce && d.pkce ? d : null;
    } catch (e) {
        return null;
    }
};

const verifierOf = (claims) => secretField.decrypt(claims.pkce) || '';
const sessionMatches = (claims, sessionId) => claims.sid === hash(sessionId || '');
const usableCode = (code) => (typeof code === 'string' && code && code.length <= MAX_CODE_LENGTH ? code : '');

/* Each server remembers the states it has completed; across servers GitHub's code and PKCE verifier are single-use, so a repeat fails at the exchange. */
const spent = new Map();
const spendNonce = (nonce, expSeconds, now = Date.now()) => {
    for (const [key, exp] of spent) if (exp * 1000 <= now) spent.delete(key);
    if (spent.has(nonce)) return false;
    spent.set(nonce, expSeconds);
    return true;
};

const authorizeUrl = ({ state, challenge }) => {
    const params = new URLSearchParams({
        client_id: clientId(), redirect_uri: redirectUri(), scope: SCOPE, state, allow_signup: 'false', code_challenge: challenge, code_challenge_method: 'S256',
    });
    return `${oauthBase()}/authorize?${params.toString()}`;
};

async function exchangeCode({ code, verifier }, post = axios.post) {
    const res = await post(`${oauthBase()}/access_token`, {
        client_id: clientId(), client_secret: clientSecret(), code: String(code), redirect_uri: redirectUri(), code_verifier: verifier,
    }, { headers: { Accept: 'application/json' }, timeout: 20000 });
    const body = (res && res.data) || {};
    if (!body.access_token) throw new Error('GitHub did not return an access token.');
    return { token: String(body.access_token), scope: String(body.scope || '') };
}

/* Best effort: a grant GitHub will not revoke is logged by the caller and never stops the person's own action. */
async function revokeToken(token, del = axios.delete) {
    if (!token || !clientId() || !clientSecret()) return false;
    const res = await del(`https://api.github.com/applications/${encodeURIComponent(clientId())}/token`, {
        auth: { username: clientId(), password: clientSecret() },
        data: { access_token: token },
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'AlianHub' },
        timeout: 15000,
        validateStatus: () => true,
    });
    return res.status === 204;
}

module.exports = {
    CALLBACK_PATH, SCOPE, STATE_TTL_SECONDS, MAX_STATE_LENGTH, MAX_CODE_LENGTH,
    isConfigured, redirectUri, fallbackOrigin, returnOriginOf, encodeState, decodeState, verifierOf, sessionMatches, usableCode, spendNonce,
    authorizeUrl, exchangeCode, revokeToken,
};
