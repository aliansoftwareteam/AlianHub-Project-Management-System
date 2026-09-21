const config = require('./config');
const clients = require('./clients');
const grants = require('./grants');
const consent = require('./consent');
const { matchesRegistered } = require('./redirectUri');
const logger = require('../../Config/loggerConfig');

const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const TOKEN_ERROR_STATUS = { invalid_client: 401, unauthorized_client: 400 };

const single = (value) => (typeof value === 'string' ? value : undefined);

const noStore = (res) => res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });

const oauthError = (res, status, error, description) => noStore(res).status(status).json({ error, error_description: description });

const failed = (res, error, what) => {
    logger.error(`oauth ${what}: ${error.message}`);
    return oauthError(res, 500, 'server_error', 'the authorization server could not complete the request');
};

/* RFC 8414. client_id_metadata_document_supported is the name the MCP 2025-11-25 spec gives the flag. */
exports.metadata = (req, res) => {
    const endpoints = config.endpoints();
    res.json({
        issuer: config.issuer(),
        authorization_endpoint: endpoints.authorization,
        token_endpoint: endpoints.token,
        revocation_endpoint: endpoints.revocation,
        ...(config.dcrOn() ? { registration_endpoint: endpoints.registration } : {}),
        response_types_supported: ['code'],
        response_modes_supported: ['query'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: clients.AUTH_METHODS,
        revocation_endpoint_auth_methods_supported: clients.AUTH_METHODS,
        scopes_supported: config.SCOPES,
        client_id_metadata_document_supported: true,
        authorization_response_iss_parameter_supported: true,
    });
};

const redirectWith = (res, redirectUri, params) => {
    const url = new URL(redirectUri);
    for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, value);
    return noStore(res).redirect(302, url.toString());
};

const parseScopes = (value) => {
    if (typeof value !== 'string' || !value.trim()) return null;
    const list = [...new Set(value.split(' ').filter(Boolean))];
    return list.every((scope) => config.SCOPES.includes(scope)) ? list : null;
};

/* OAuth 2.1 section 4.1.2.1: until the client and its redirect URI are known good, an error is shown to
 * the user and never sent to the URI; after that, it goes back to the client with its state. */
exports.authorize = async (req, res) => {
    try {
        const q = req.query || {};
        const clientId = single(q.client_id);
        const redirectUri = single(q.redirect_uri);
        let client;
        try {
            client = await clients.resolve(clientId);
        } catch (error) {
            if (error instanceof clients.ClientError) return oauthError(res, 400, error.error, error.message);
            throw error;
        }
        if (!matchesRegistered(client, redirectUri)) return oauthError(res, 400, 'invalid_request', 'redirect_uri is not registered for this client');

        const state = single(q.state);
        const back = (params) => redirectWith(res, redirectUri, { ...params, state, iss: config.issuer() });
        const refuse = (error, description) => back({ error, error_description: description });

        const repeated = ['response_type', 'client_id', 'redirect_uri', 'scope', 'state', 'code_challenge', 'code_challenge_method', 'resource'].find((key) => Array.isArray(q[key]));
        if (repeated) return refuse('invalid_request', `${repeated} is given more than once`);
        if (q.response_type !== 'code') return refuse('unsupported_response_type', 'response_type must be code');
        if (q.code_challenge_method !== 'S256') return refuse('invalid_request', 'PKCE with code_challenge_method S256 is required');
        if (typeof q.code_challenge !== 'string' || !CHALLENGE_PATTERN.test(q.code_challenge)) return refuse('invalid_request', 'code_challenge must be a base64url SHA-256 digest');
        if (!config.canonicalResource(q.resource)) return refuse('invalid_target', `resource must be ${config.resource()}`);
        const scopes = parseScopes(q.scope);
        if (!scopes) return refuse('invalid_scope', `scope must be drawn from: ${config.SCOPES.join(' ')}`);
        if (client.scopes && client.scopes.length && !scopes.every((scope) => client.scopes.includes(scope))) return refuse('invalid_scope', 'this client may not ask for that scope');

        const answer = await consent.testConsent(req, res);
        if (answer && answer.answered) return undefined;
        if (!answer) return refuse('temporarily_unavailable', 'user consent is not available on this server yet');
        if (!answer.approved) return refuse('access_denied', 'the user declined');
        if (client.companyId && client.companyId !== answer.companyId) return refuse('access_denied', 'this client is registered to another workspace');

        const { code } = await grants.issueCode({
            client, companyId: answer.companyId, userId: answer.userId, scopes, redirectUri, codeChallenge: q.code_challenge,
        });
        return back({ code });
    } catch (error) {
        return failed(res, error, 'authorize');
    }
};

const tokenFailure = (res, error, what) => {
    if (error instanceof clients.ClientError || error instanceof grants.GrantError) {
        if (error.error === 'invalid_client' && res.req.headers.authorization) res.set('WWW-Authenticate', 'Basic realm="alianhub-oauth"');
        return oauthError(res, TOKEN_ERROR_STATUS[error.error] || 400, error.error, error.message);
    }
    return failed(res, error, what);
};

exports.token = async (req, res) => {
    try {
        const body = req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : {};
        req.body = body;
        const client = await clients.authenticate(req);
        const resource = config.canonicalResource(single(body.resource));
        if (!resource) return oauthError(res, 400, 'invalid_target', `resource must be ${config.resource()}`);
        let issued;
        if (body.grant_type === 'authorization_code') {
            issued = await grants.exchangeCode({
                client, code: single(body.code), codeVerifier: single(body.code_verifier), redirectUri: single(body.redirect_uri), resource,
            });
        } else if (body.grant_type === 'refresh_token') {
            issued = await grants.refresh({ client, refreshToken: single(body.refresh_token), scope: single(body.scope), resource });
        } else {
            return oauthError(res, 400, 'unsupported_grant_type', 'grant_type must be authorization_code or refresh_token');
        }
        return noStore(res).json(issued);
    } catch (error) {
        return tokenFailure(res, error, 'token');
    }
};

exports.revoke = async (req, res) => {
    try {
        const body = req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : {};
        req.body = body;
        const client = await clients.authenticate(req);
        const token = single(body.token);
        if (!token) return oauthError(res, 400, 'invalid_request', 'token is required');
        await grants.revoke({ client, token });
        return noStore(res).status(200).end();
    } catch (error) {
        return tokenFailure(res, error, 'revoke');
    }
};

/* RFC 7591, only while MCP_OAUTH_DCR is on. The MCP spec keeps it for older clients. */
exports.register = async (req, res) => {
    try {
        const body = req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : {};
        const grantTypes = body.grant_types === undefined ? ['authorization_code'] : body.grant_types;
        if (!Array.isArray(grantTypes) || !grantTypes.every((g) => ['authorization_code', 'refresh_token'].includes(g))) {
            return oauthError(res, 400, 'invalid_client_metadata', 'grant_types may only name authorization_code and refresh_token');
        }
        if (body.response_types !== undefined && !(Array.isArray(body.response_types) && body.response_types.every((t) => t === 'code'))) {
            return oauthError(res, 400, 'invalid_client_metadata', 'response_types may only name code');
        }
        const { client, secret } = await clients.register({
            kind: 'dynamic',
            name: body.client_name,
            redirectUris: body.redirect_uris,
            tokenEndpointAuthMethod: body.token_endpoint_auth_method,
            scopes: body.scope,
        });
        return noStore(res).status(201).json({
            client_id: client.clientId,
            client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
            ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
            client_name: client.name,
            redirect_uris: client.redirectUris,
            token_endpoint_auth_method: client.tokenEndpointAuthMethod,
            grant_types: grantTypes,
            response_types: ['code'],
            ...(client.scopes.length ? { scope: client.scopes.join(' ') } : {}),
        });
    } catch (error) {
        if (error instanceof clients.ClientError) return oauthError(res, 400, error.error, error.message);
        return failed(res, error, 'register');
    }
};
