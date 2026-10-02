/* A stand-in for Google's OAuth endpoints behind safeFetch. `consent` plays the person approving the consent
 * screen and hands back the code Google would redirect with; the token endpoint then checks the client, the
 * redirect address and the PKCE verifier as Google does. Every token is random and made here, never a real one. */

const crypto = require('crypto');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

const random = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');
const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const json = (status, body, headers = {}) => ({ status, headers, body: typeof body === 'string' ? body : JSON.stringify(body), bytes: 0, hops: [] });

const create = ({ clientId, clientSecret }) => {
    const google = { calls: [], web: [], consents: [], issued: [], answers: {}, codes: new Map(), grants: new Map() };

    const issue = (prefix) => {
        const token = [prefix, random()].join('');
        google.issued.push(token);
        return token;
    };

    google.consent = (authUrl, { email = 'person@example.test', sub = '1100', scope, offline } = {}) => {
        const url = new URL(authUrl);
        if (`${url.origin}${url.pathname}` !== AUTH_URL) throw new Error(`fake Google: ${url.origin}${url.pathname} is not the consent address`);
        const asked = Object.fromEntries(url.searchParams);
        google.consents.push(asked);
        const code = ['4/', random()].join('');
        google.codes.set(code, {
            clientId: asked.client_id, redirectUri: asked.redirect_uri, challenge: asked.code_challenge, method: asked.code_challenge_method,
            scope: scope || asked.scope, email, sub, offline: offline === undefined ? asked.access_type === 'offline' : offline,
        });
        return { code, state: asked.state, asked };
    };

    const exchange = (form) => {
        const grant = google.codes.get(form.code);
        google.codes.delete(form.code);
        if (!grant || grant.clientId !== form.client_id || grant.redirectUri !== form.redirect_uri) return json(400, { error: 'invalid_grant' });
        const challenged = grant.method === 'S256' && form.code_verifier
            && crypto.createHash('sha256').update(form.code_verifier).digest('base64url') === grant.challenge;
        if (!challenged) return json(400, { error: 'invalid_grant', error_description: 'Missing code verifier.' });
        const access = issue('ya29.');
        const refresh = grant.offline ? issue('1//') : undefined;
        if (refresh) google.grants.set(refresh, { ...grant, revoked: false });
        const idToken = [part({ alg: 'none' }), part({ email: grant.email, email_verified: true, sub: grant.sub }), random(8)].join('.');
        google.issued.push(idToken);
        return json(200, { access_token: access, expires_in: 3599, scope: grant.scope, token_type: 'Bearer', id_token: idToken, ...(refresh ? { refresh_token: refresh } : {}) });
    };

    const refreshed = (form) => {
        const grant = google.grants.get(form.refresh_token);
        if (!grant || grant.revoked) return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
        return json(200, { access_token: issue('ya29.'), expires_in: 3599, scope: grant.scope, token_type: 'Bearer' });
    };

    const token = (form) => {
        if (form.client_id !== clientId || form.client_secret !== clientSecret) return json(401, { error: 'invalid_client' });
        if (form.grant_type === 'authorization_code') return exchange(form);
        if (form.grant_type === 'refresh_token') return refreshed(form);
        return json(400, { error: 'unsupported_grant_type' });
    };

    const revoke = (form) => {
        const grant = google.grants.get(form.token);
        if (!grant || grant.revoked) return json(400, { error: 'invalid_token' });
        grant.revoked = true;
        return json(200, {});
    };

    const ENDPOINTS = { [TOKEN_URL]: ['token', token], [REVOKE_URL]: ['revoke', revoke] };

    google.fetch = async (url, opts = {}) => {
        const target = String(url);
        if (!ENDPOINTS[target]) {
            google.web.push(target);
            return json(200, '<html><head><title>A page</title></head><body>Hello</body></html>');
        }
        const [endpoint, handler] = ENDPOINTS[target];
        const form = Object.fromEntries(new URLSearchParams(opts.data || ''));
        google.calls.push({
            url: target, endpoint, form, verb: opts.method, redirects: opts.maxRedirects,
            authorization: (opts.headers || {}).Authorization,
            workspace: (require('../../Modules/Agents/engine/egressContext').get() || {}).companyId,
        });
        const answer = google.answers[endpoint];
        if (answer instanceof Error) throw answer;
        if (answer) return json(...(({ status = 200, body = {}, headers = {} }) => [status, body, headers])(typeof answer === 'function' ? answer(form) : answer));
        return handler(form);
    };

    google.reset = () => {
        ['calls', 'web', 'consents', 'issued'].forEach((key) => { google[key].length = 0; });
        google.codes.clear();
        google.grants.clear();
        google.answers = {};
    };

    google.endpoints = () => google.calls.map((c) => `${c.endpoint}:${c.form.grant_type || 'revoke'}`);

    return google;
};

module.exports = { create, AUTH_URL, TOKEN_URL, REVOKE_URL };
