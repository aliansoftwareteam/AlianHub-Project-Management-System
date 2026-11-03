const agentFetch = require('../Agents/engine/agentFetch');
const egressContext = require('../Agents/engine/egressContext');

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

const consentUrl = ({ definition, clientId, redirectUri, scopes, state, challenge }) => {
    const params = {
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        [definition.auth.scopeParam || 'scope']: scopes.join(definition.auth.scopeSeparator || ' '),
        state,
        ...(definition.auth.extraParams || {}),
    };
    if (definition.auth.pkce === 'S256') { params.code_challenge = challenge; params.code_challenge_method = 'S256'; }
    return `${definition.auth.authorizeUrl}?${new URLSearchParams(params)}`;
};

/* A verifier goes only where the consent sent its challenge: Slack refuses one it was not asked to check. */
const exchange = ({ definition, companyId, actor, client, code, verifier, redirectUri }) => post({
    definition, companyId, actor, url: definition.auth.tokenUrl, hide: [client.clientSecret, code, verifier],
    form: {
        grant_type: 'authorization_code', code, ...(verifier && definition.auth.pkce === 'S256' ? { code_verifier: verifier } : {}),
        client_id: client.clientId, client_secret: client.clientSecret, redirect_uri: redirectUri,
    },
});

const refresh = ({ definition, companyId, actor, client, refreshToken }) => post({
    definition, companyId, actor, url: definition.auth.tokenUrl, hide: [client.clientSecret, refreshToken],
    form: { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: client.clientId, client_secret: client.clientSecret },
});

/* A provider without a revoke endpoint cannot be told; disconnect still retires the secrets and closes the row.
 * Most providers (Google, Slack) take the token to revoke as a form field; some (Dropbox) authenticate the revoke
 * call with the token in the Authorization header and an empty body — `auth.revokeAuth: 'bearer'` selects that. */
const revoke = ({ definition, companyId, actor, token }) => {
    if (!definition.auth.revokeUrl) return Promise.resolve({ ok: true, body: {}, skipped: true });
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

module.exports = { ERROR, consentUrl, exchange, refresh, revoke, isGrantRefused, scopesOf, tokensOf, errorIn };
