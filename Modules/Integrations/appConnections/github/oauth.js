const crypto = require('crypto');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { buildCorsAllowList, isOriginAllowed } = require('../../../../utils/cors');

const CALLBACK_PATH = '/api/v1/github-connect/callback';
const STATE_AUDIENCE = 'alianhub:app-connections:github';
const STATE_TTL_SECONDS = 10 * 60;
/* GitHub OAuth Apps have no read-only scope for private repositories; `repo` is the smallest that lists their pull requests. */
const SCOPE = 'repo';

const clientId = () => String(process.env.GITHUB_CONNECT_CLIENT_ID || process.env.GITHUB_CLIENT_ID || '').trim();
const clientSecret = () => String(process.env.GITHUB_CONNECT_CLIENT_SECRET || process.env.GITHUB_CLIENT_SECRET || '').trim();
const oauthBase = () => String(process.env.GITHUB_BASE_OAUTH_URL || 'https://github.com/login/oauth').replace(/\/+$/, '');
const apiBase = () => String(process.env.APIURL || '').replace(/\/+$/, '');

const isConfigured = () => !!(clientId() && clientSecret() && apiBase());
const redirectUri = () => `${apiBase()}${CALLBACK_PATH}`;

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

const encodeState = ({ companyId, userId, returnOrigin = '' }, now = Date.now()) => jwt.sign(
    { companyId: String(companyId), userId: String(userId), nonce: crypto.randomBytes(16).toString('hex'), returnOrigin: String(returnOrigin || ''), iat: Math.floor(now / 1000) },
    stateSecret(),
    { algorithm: 'HS256', audience: STATE_AUDIENCE, expiresIn: STATE_TTL_SECONDS },
);

const decodeState = (token, now = Date.now()) => {
    try {
        const d = jwt.verify(String(token || ''), stateSecret(), { algorithms: ['HS256'], audience: STATE_AUDIENCE, clockTimestamp: Math.floor(now / 1000) });
        return d && /^[a-f0-9]{24}$/i.test(d.companyId) && d.userId && d.nonce ? d : null;
    } catch (e) {
        return null;
    }
};

/* One server remembers which states it has seen; across servers GitHub's code is single-use, so a replay fails at the exchange. */
const spent = new Map();
const spendNonce = (nonce, expSeconds, now = Date.now()) => {
    for (const [key, exp] of spent) if (exp * 1000 <= now) spent.delete(key);
    if (spent.has(nonce)) return false;
    spent.set(nonce, expSeconds);
    return true;
};

const authorizeUrl = (state) => {
    const params = new URLSearchParams({ client_id: clientId(), redirect_uri: redirectUri(), scope: SCOPE, state, allow_signup: 'false' });
    return `${oauthBase()}/authorize?${params.toString()}`;
};

async function exchangeCode(code, post = axios.post) {
    const res = await post(`${oauthBase()}/access_token`, {
        client_id: clientId(), client_secret: clientSecret(), code: String(code), redirect_uri: redirectUri(),
    }, { headers: { Accept: 'application/json' }, timeout: 20000 });
    const body = (res && res.data) || {};
    if (!body.access_token) throw new Error(body.error_description || body.error || 'GitHub did not return an access token.');
    return { token: String(body.access_token), scope: String(body.scope || '') };
}

module.exports = { CALLBACK_PATH, SCOPE, STATE_TTL_SECONDS, isConfigured, redirectUri, returnOriginOf, encodeState, decodeState, spendNonce, authorizeUrl, exchangeCode, apiBase };
