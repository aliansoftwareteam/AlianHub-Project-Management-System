const crypto = require('crypto');
const { safeFetch } = require('../Agents/engine/safeFetch');

const TIMEOUT_MS = 8000;
const MAX_BYTES = 64 * 1024;
const APPS_TTL_MS = 10 * 60 * 1000;
const MIN_KEY_LENGTH = 32;
const MAX_CLIENT_ID = 400;
const ERROR_CODE = /^[a-z0-9_]{1,60}$/;
const ERROR = Object.freeze({ UNREACHABLE: 'service_unreachable', BAD_RESPONSE: 'bad_response' });

class HostedSignInError extends Error {
    constructor(code, message) { super(message); this.name = 'HostedSignInError'; this.code = code; }
}

/* Read on every call, like the connector flags: the platform sets these when it provisions a hosted instance. */
const config = () => ({
    managed: String(process.env.HOSTING_MODE || '').trim().toLowerCase() === 'managed',
    url: String(process.env.CONNECTOR_SIGNIN_URL || '').trim().replace(/\/+$/, ''),
    instanceId: String(process.env.INSTANCE_ID || '').trim(),
    key: String(process.env.PLATFORM_API_KEY || ''),
    providers: String(process.env.CONNECTOR_SIGNIN_PROVIDERS || '').split(/[\s,]+/).map((p) => p.trim().toLowerCase()).filter(Boolean),
});

const isOn = () => {
    const c = config();
    return c.managed && /^https:\/\//.test(c.url) && !!c.instanceId && c.key.length >= MIN_KEY_LENGTH;
};

const offers = (provider) => isOn() && config().providers.includes(String(provider));

const hmac = (key, text) => crypto.createHmac('sha256', key).update(text).digest('base64url');

/* The instance proves itself with the key it shares with the platform; the timestamp keeps a captured request from
 * being replayed later. The app secret is added by the service and never reaches this instance. */
const send = async (path, payload) => {
    const c = config();
    const body = payload === undefined ? '' : JSON.stringify(payload);
    const timestamp = String(Date.now());
    let res;
    try {
        res = await safeFetch(`${c.url}${path}`, {
            method: payload === undefined ? 'get' : 'post',
            data: payload === undefined ? undefined : body,
            timeoutMs: TIMEOUT_MS,
            maxBytes: MAX_BYTES,
            maxRedirects: 0,
            headers: {
                Accept: 'application/json',
                ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
                'X-Instance-Id': c.instanceId,
                'X-Timestamp': timestamp,
                'X-Signature': hmac(c.key, `${timestamp}.${path}.${body}`),
            },
            sensitiveHeaders: ['X-Signature'],
        });
    } catch (e) {
        return { ok: false, error: ERROR.UNREACHABLE };
    }
    let parsed = null;
    try { parsed = res.body ? JSON.parse(res.body) : {}; } catch (e) { parsed = null; }
    const answered = parsed && typeof parsed === 'object' && !Array.isArray(parsed);
    if (res.status >= 200 && res.status < 300) return answered ? { ok: true, body: parsed } : { ok: false, error: ERROR.BAD_RESPONSE };
    if (res.status >= 500) return { ok: false, error: ERROR.UNREACHABLE };
    return { ok: false, error: answered && ERROR_CODE.test(String(parsed.error || '')) ? String(parsed.error) : `http_${res.status}` };
};

let apps = { at: 0, byProvider: {} };

const appsFromService = async (now) => {
    if (now - apps.at < APPS_TTL_MS) return apps.byProvider;
    const out = await send('/v1/apps');
    if (!out.ok) throw new HostedSignInError(ERROR.UNREACHABLE, 'The sign-in service cannot be reached right now. Try again in a few minutes.');
    const { url } = config();
    const byProvider = {};
    Object.entries((out.body && out.body.apps) || {}).forEach(([provider, app]) => {
        const clientId = app && typeof app.clientId === 'string' ? app.clientId.trim() : '';
        const redirectUri = app && typeof app.redirectUri === 'string' ? app.redirectUri : '';
        if (clientId && clientId.length <= MAX_CLIENT_ID && redirectUri.startsWith(`${url}/`)) byProvider[provider] = { clientId, redirectUri };
    });
    apps = { at: now, byProvider };
    return byProvider;
};

/* The app this hosted instance signs in with for one provider: Alian's, registered once for every hosted instance
 * with the service's own callback, so no instance or custom domain is ever registered at a provider. */
const appFor = async (provider, now = Date.now()) => {
    if (!offers(provider)) return null;
    const found = (await appsFromService(now))[String(provider)];
    return found ? { source: 'hosted', appId: null, clientId: found.clientId, clientSecret: '', redirectUri: found.redirectUri } : null;
};

/* The service learns which instance to send the person back to from this envelope, checked with the instance's key
 * and its own instance list; the instance's own signed state rides inside, untouched. */
const wrapState = (state) => {
    const c = config();
    const payload = Buffer.from(JSON.stringify({ i: c.instanceId, s: String(state) })).toString('base64url');
    return `${payload}.${hmac(c.key, payload)}`;
};

const exchange = ({ provider, code, verifier, redirectUri }) => send('/v1/token', {
    provider, grantType: 'authorization_code', code, redirectUri, ...(verifier ? { codeVerifier: verifier } : {}),
});

const refresh = ({ provider, refreshToken }) => send('/v1/token', { provider, grantType: 'refresh_token', refreshToken });

const revoke = ({ provider, token }) => send('/v1/revoke', { provider, token });

const forget = () => { apps = { at: 0, byProvider: {} }; };

module.exports = { HostedSignInError, ERROR, isOn, offers, appFor, wrapState, exchange, refresh, revoke, forget };
