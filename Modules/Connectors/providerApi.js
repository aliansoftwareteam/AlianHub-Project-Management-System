const agentFetch = require('../Agents/engine/agentFetch');
const egressContext = require('../Agents/engine/egressContext');
const hosted = require('./hostedSignIn');

const TIMEOUT_MS = 8000;
const MAX_BYTES = 64 * 1024;
const ERROR_CODE = /^[a-z0-9_]{1,60}$/;
const MAX_SCOPES = 50;

const ERROR = Object.freeze({ UNREACHABLE: 'unreachable', RATE_LIMITED: 'rate_limited', BAD_RESPONSE: 'bad_response' });

/* Some providers (Slack) answer a refusal with 200 and the error inside the body. */
const errorIn = (definition, body) => {
    if (!definition || typeof definition.answerError !== 'function') return '';
    const code = definition.answerError(body);
    if (!code) return '';
    return ERROR_CODE.test(String(code)) ? String(code) : ERROR.BAD_RESPONSE;
};

const scrub = (text, hide) => hide.filter(Boolean).reduce((out, secret) => out.split(String(secret)).join('[hidden]'), String(text || ''));

/* One attempt, never a retry. Only an error code in the provider's own format is passed on; its description and
 * anything else in a failed answer are dropped, so nothing sent can come back in an error. The host is fixed in
 * the provider definition, and the call names a workspace, so that workspace's egress list applies. */
const post = async ({ definition, companyId, actor, url, form, hide = [], token }) => {
    let res;
    try {
        res = await egressContext.run(
            { companyId: String(companyId), actor: String(actor || '') },
            () => agentFetch.callProvider(url, { form, token, timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES }),
        );
    } catch (e) {
        return { ok: false, error: ERROR.UNREACHABLE, detail: scrub(e && e.message, hide).slice(0, 300) };
    }
    if (res.status === 429) return { ok: false, error: ERROR.RATE_LIMITED };
    let body = null;
    try { body = res.body ? JSON.parse(res.body) : {}; } catch (e) { body = null; }
    const answered = body && typeof body === 'object' && !Array.isArray(body);
    if (res.status >= 200 && res.status < 300) {
        if (!answered) return { ok: false, error: ERROR.BAD_RESPONSE };
        const refused = errorIn(definition, body);
        return refused ? { ok: false, error: refused } : { ok: true, body };
    }
    return { ok: false, error: answered && ERROR_CODE.test(String(body.error || '')) ? String(body.error) : `http_${res.status}` };
};

/* An MCP app that grants access without scopes is asked for none, rather than for an empty scope. */
const consentUrl = ({ definition, clientId, redirectUri, scopes, state, challenge }) => {
    const params = {
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        ...(scopes.length ? { [definition.auth.scopeParam || 'scope']: scopes.join(definition.auth.scopeSeparator || ' ') } : {}),
        state,
        ...(definition.auth.extraParams || {}),
    };
    if (definition.auth.pkce === 'S256') { params.code_challenge = challenge; params.code_challenge_method = 'S256'; }
    return `${definition.auth.authorizeUrl}?${new URLSearchParams(params)}`;
};

/* A client a server registered without a secret proves itself with PKCE alone; an empty secret is left out. */
const clientFields = (client) => ({ client_id: client.clientId, ...(client.clientSecret ? { client_secret: client.clientSecret } : {}) });

/* On a hosted instance the shared sign-in service holds the app secret and makes the token call; its answer is the
 * provider's own, read the same way. */
const fromService = (definition, out) => {
    if (!out.ok) return out;
    const refused = errorIn(definition, out.body);
    return refused ? { ok: false, error: refused } : out;
};

/* A verifier goes only where the consent sent its challenge: Slack refuses one it was not asked to check. */
const exchange = ({ definition, companyId, actor, client, code, verifier, redirectUri }) => {
    const sentVerifier = verifier && definition.auth.pkce === 'S256' ? verifier : undefined;
    if (client.source === 'hosted') return hosted.exchange({ provider: definition.id, code, verifier: sentVerifier, redirectUri }).then((out) => fromService(definition, out));
    return post({
        definition, companyId, actor, url: definition.auth.tokenUrl, hide: [client.clientSecret, code, verifier],
        form: { grant_type: 'authorization_code', code, ...(sentVerifier ? { code_verifier: sentVerifier } : {}), ...clientFields(client), redirect_uri: redirectUri },
    });
};

const refresh = ({ definition, companyId, actor, client, refreshToken }) => {
    if (client.source === 'hosted') return hosted.refresh({ provider: definition.id, refreshToken }).then((out) => fromService(definition, out));
    return post({
        definition, companyId, actor, url: definition.auth.tokenUrl, hide: [client.clientSecret, refreshToken],
        form: { grant_type: 'refresh_token', refresh_token: refreshToken, ...clientFields(client) },
    });
};

const callJson = async ({ companyId, actor, url, method = 'get', json, token, hosts, hide = [] }) => {
    let res;
    try {
        res = await egressContext.run(
            { companyId: String(companyId), actor: String(actor || '') },
            () => agentFetch.callApi(url, { method, json, token, hosts, timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES }),
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

/* Dynamic client registration (RFC 7591), as a public client bound by PKCE unless the app's token endpoint takes
 * only confidential clients (`auth.registrationAuth`), in which case the secret it sends back is kept. */
const register = ({ definition, companyId, actor, redirectUri }) => callJson({
    companyId, actor, url: definition.auth.registrationUrl, method: 'post', hosts: definition.egressHosts,
    json: {
        client_name: 'AlianHub', redirect_uris: [redirectUri], grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'], token_endpoint_auth_method: definition.auth.registrationAuth || 'none',
    },
});

/* The account a token belongs to, for a provider whose token answer does not name one, and for a pasted token. */
const readAccountWith = async ({ definition, companyId, actor, token }) => {
    const out = await callJson({ companyId, actor, url: definition.account.url, token, hosts: definition.egressHosts, hide: [token] });
    if (!out.ok) return out;
    try {
        const read = definition.account.read(out.body) || {};
        return { ok: true, account: { id: String(read.id || ''), label: String(read.label || '').slice(0, 254) } };
    } catch (e) {
        return { ok: false, error: ERROR.BAD_RESPONSE };
    }
};

/* A provider without a revoke endpoint cannot be told; disconnect still retires the secrets and closes the row.
 * Most providers (Google, Slack) take the token to revoke as a form field; some (Dropbox) authenticate the revoke
 * call with the token in the Authorization header and an empty body — `auth.revokeAuth: 'bearer'` selects that. */
const revoke = ({ definition, companyId, actor, token, viaService = false }) => {
    if (!definition.auth.revokeUrl) return Promise.resolve({ ok: true, body: {}, skipped: true });
    if (viaService) return hosted.revoke({ provider: definition.id, token }).then((out) => fromService(definition, out));
    const base = { definition, companyId, actor, url: definition.auth.revokeUrl, hide: [token] };
    return definition.auth.revokeAuth === 'bearer'
        ? post({ ...base, token, form: {} })
        : post({ ...base, form: { token } });
};

const isGrantRefused = (definition, code) => (definition.deadGrantErrors || ['invalid_grant']).includes(String(code));

const scopesOf = (granted) => String(granted || '').split(/[\s,]+/).filter(Boolean).slice(0, MAX_SCOPES).map((scope) => scope.slice(0, 200));

/* The token fields of a token or refresh answer; Slack nests a user token under `authed_user`. */
const tokensOf = (definition, body) => {
    const found = typeof definition.auth.tokenAnswer === 'function' ? definition.auth.tokenAnswer(body) : body;
    return found && typeof found === 'object' ? found : {};
};

module.exports = { ERROR, consentUrl, exchange, refresh, revoke, register, readAccountWith, isGrantRefused, scopesOf, tokensOf, errorIn };
