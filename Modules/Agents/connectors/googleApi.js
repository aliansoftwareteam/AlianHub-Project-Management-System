const agentFetch = require('../engine/agentFetch');
const egressContext = require('../engine/egressContext');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const HOST = 'oauth2.googleapis.com';
const TIMEOUT_MS = 8000;
const MAX_BYTES = 64 * 1024;
const ERROR_CODE = /^[a-z0-9_]{1,60}$/;
const MAX_SCOPES = 30;

const ERROR = Object.freeze({ UNREACHABLE: 'unreachable', RATE_LIMITED: 'rate_limited', BAD_RESPONSE: 'bad_response' });

const scrub = (text, hide) => hide.filter(Boolean).reduce((out, secret) => out.split(String(secret)).join('[hidden]'), String(text || ''));

/* One attempt, never a retry. Only an error code in Google's own format is passed on; its description and
 * anything else in a failed answer are dropped, so nothing sent can come back in an error. */
const post = async ({ companyId, actor, url, form, hide = [] }) => {
    let res;
    try {
        res = await egressContext.run(
            { companyId: String(companyId), actor: String(actor || '') },
            () => agentFetch.callProvider(url, { form, timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES }),
        );
    } catch (e) {
        return { ok: false, error: ERROR.UNREACHABLE, detail: scrub(e && e.message, hide).slice(0, 300) };
    }
    if (res.status === 429) return { ok: false, error: ERROR.RATE_LIMITED };
    let body = null;
    try { body = res.body ? JSON.parse(res.body) : {}; } catch (e) { body = null; }
    const answered = body && typeof body === 'object' && !Array.isArray(body);
    if (res.status >= 200 && res.status < 300) return answered ? { ok: true, body } : { ok: false, error: ERROR.BAD_RESPONSE };
    return { ok: false, error: answered && ERROR_CODE.test(String(body.error || '')) ? String(body.error) : `http_${res.status}` };
};

const consentUrl = ({ clientId, redirectUri, scopes, state, challenge }) => `${AUTH_URL}?${new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
})}`;

const exchange = ({ companyId, actor, client, code, verifier, redirectUri }) => post({
    companyId, actor, url: TOKEN_URL, hide: [client.secret, code, verifier],
    form: { grant_type: 'authorization_code', code, code_verifier: verifier, client_id: client.id, client_secret: client.secret, redirect_uri: redirectUri },
});

const refresh = ({ companyId, actor, client, refreshToken }) => post({
    companyId, actor, url: TOKEN_URL, hide: [client.secret, refreshToken],
    form: { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: client.id, client_secret: client.secret },
});

const revoke = ({ companyId, actor, token }) => post({ companyId, actor, url: REVOKE_URL, hide: [token], form: { token } });

const isGrantRefused = (code) => code === 'invalid_grant';

/* The ID token came straight from Google's token endpoint over TLS, in answer to this server's own client
 * secret, so its claims are read without checking a signature (OpenID Connect Core 3.1.3.7). */
const accountOf = (idToken) => {
    try {
        const claims = JSON.parse(Buffer.from(String(idToken || '').split('.')[1] || '', 'base64url').toString('utf8'));
        const email = typeof claims.email === 'string' && claims.email_verified !== false ? claims.email.slice(0, 254) : '';
        return { email, sub: typeof claims.sub === 'string' ? claims.sub.slice(0, 64) : '' };
    } catch (e) {
        return { email: '', sub: '' };
    }
};

const scopesOf = (granted) => String(granted || '').split(/\s+/).filter(Boolean).slice(0, MAX_SCOPES).map((scope) => scope.slice(0, 200));

module.exports = { AUTH_URL, TOKEN_URL, REVOKE_URL, HOST, ERROR, consentUrl, exchange, refresh, revoke, isGrantRefused, accountOf, scopesOf };
