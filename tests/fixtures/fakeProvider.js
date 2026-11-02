/* A stand-in for the fake provider's OAuth endpoints behind safeFetch. `consent` plays the person approving the
 * consent screen and hands back the code the provider would redirect with; the token endpoint checks the client,
 * the redirect address and the PKCE verifier. Every token is random and made here, never a real one. The account
 * fields are returned in the token response itself, which the fake provider's readAccount reads. */

const crypto = require('crypto');
const fake = require('./connectors/fake');

const AUTH_URL = fake.auth.authorizeUrl;
const TOKEN_URL = fake.auth.tokenUrl;
const REVOKE_URL = fake.auth.revokeUrl;

const random = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');
const json = (status, body, headers = {}) => ({ status, headers, body: typeof body === 'string' ? body : JSON.stringify(body), bytes: 0, hops: [] });

const create = ({ clientId, clientSecret }) => {
    const provider = { calls: [], web: [], consents: [], issued: [], answers: {}, codes: new Map(), grants: new Map() };

    const issue = (prefix) => {
        const token = [prefix, random()].join('');
        provider.issued.push(token);
        return token;
    };

    provider.consent = (authUrl, { accountId = 'acc-1', email = 'person@example.test', scope, offline = true } = {}) => {
        const url = new URL(authUrl);
        if (`${url.origin}${url.pathname}` !== AUTH_URL) throw new Error(`fake provider: ${url.origin}${url.pathname} is not the consent address`);
        const asked = Object.fromEntries(url.searchParams);
        provider.consents.push(asked);
        const code = ['code-', random()].join('');
        provider.codes.set(code, {
            clientId: asked.client_id, redirectUri: asked.redirect_uri, challenge: asked.code_challenge, method: asked.code_challenge_method,
            scope: scope || asked.scope, accountId, email, offline,
        });
        return { code, state: asked.state, asked };
    };

    const exchange = (form) => {
        const grant = provider.codes.get(form.code);
        provider.codes.delete(form.code);
        if (!grant || grant.clientId !== form.client_id || grant.redirectUri !== form.redirect_uri) return json(400, { error: 'invalid_grant' });
        const challenged = grant.method === 'S256' && form.code_verifier
            && crypto.createHash('sha256').update(form.code_verifier).digest('base64url') === grant.challenge;
        if (!challenged) return json(400, { error: 'invalid_grant', error_description: 'Missing code verifier.' });
        const access = issue('at-');
        const refresh = grant.offline ? issue('rt-') : undefined;
        if (refresh) provider.grants.set(refresh, { ...grant, revoked: false });
        return json(200, {
            access_token: access, expires_in: 3599, scope: grant.scope, token_type: 'Bearer',
            account_id: grant.accountId, email: grant.email, ...(refresh ? { refresh_token: refresh } : {}),
        });
    };

    const refreshed = (form) => {
        const grant = provider.grants.get(form.refresh_token);
        if (!grant || grant.revoked) return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
        return json(200, { access_token: issue('at-'), expires_in: 3599, scope: grant.scope, token_type: 'Bearer' });
    };

    const token = (form) => {
        if (form.client_id !== clientId || form.client_secret !== clientSecret) return json(401, { error: 'invalid_client' });
        if (form.grant_type === 'authorization_code') return exchange(form);
        if (form.grant_type === 'refresh_token') return refreshed(form);
        return json(400, { error: 'unsupported_grant_type' });
    };

    const revoke = (form) => {
        const grant = provider.grants.get(form.token);
        if (!grant || grant.revoked) return json(400, { error: 'invalid_token' });
        grant.revoked = true;
        return json(200, {});
    };

    const ENDPOINTS = { [TOKEN_URL]: ['token', token], [REVOKE_URL]: ['revoke', revoke] };

    provider.fetch = async (url, opts = {}) => {
        const target = String(url);
        if (!ENDPOINTS[target]) {
            provider.web.push(target);
            return json(200, '<html><head><title>A page</title></head><body>Hello</body></html>');
        }
        const [endpoint, handler] = ENDPOINTS[target];
        const form = Object.fromEntries(new URLSearchParams(opts.data || ''));
        provider.calls.push({
            url: target, endpoint, form, verb: opts.method, redirects: opts.maxRedirects,
            authorization: (opts.headers || {}).Authorization,
            workspace: (require('../../Modules/Agents/engine/egressContext').get() || {}).companyId,
        });
        const answer = provider.answers[endpoint];
        if (answer instanceof Error) throw answer;
        if (answer) return json(...(({ status = 200, body = {}, headers = {} }) => [status, body, headers])(typeof answer === 'function' ? answer(form) : answer));
        return handler(form);
    };

    provider.reset = () => {
        ['calls', 'web', 'consents', 'issued'].forEach((key) => { provider[key].length = 0; });
        provider.codes.clear();
        provider.grants.clear();
        provider.answers = {};
    };

    provider.endpoints = () => provider.calls.map((c) => `${c.endpoint}:${c.form.grant_type || 'revoke'}`);

    return provider;
};

module.exports = { create, AUTH_URL, TOKEN_URL, REVOKE_URL };
