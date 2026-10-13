const store = require('./store');
const tokenHash = require('./tokenHash');
const metadataDocument = require('./metadataDocument');
const { validRedirectUris } = require('./redirectUri');
const { SCOPES } = require('./config');

const AUTH_METHODS = ['none', 'client_secret_basic', 'client_secret_post'];
const MAX_NAME_LENGTH = 200;

class ClientError extends Error {
    constructor(error, description) {
        super(description);
        this.name = 'ClientError';
        this.error = error;
    }
}

const invalidClient = (description) => new ClientError('invalid_client', description);
const invalidMetadata = (description) => new ClientError('invalid_client_metadata', description);

/* Pre-registered and dynamically registered clients are rows; a client ID metadata document is fetched
 * (and cached) at authorization. At the token endpoint such a client is always public, so its document is
 * not fetched again: the code or refresh token it presents already names it. */
async function resolve(clientId, { fetchDocument = true } = {}) {
    if (typeof clientId !== 'string' || !clientId) throw invalidClient('client_id is required');
    if (metadataDocument.isMetadataDocumentId(clientId)) {
        if (!fetchDocument) return { clientId, kind: 'metadata_document', tokenEndpointAuthMethod: 'none', scopes: [], companyId: null };
        try {
            return await metadataDocument.load(clientId);
        } catch (error) {
            if (error instanceof metadataDocument.MetadataDocumentError) throw invalidClient(error.message);
            throw error;
        }
    }
    if (!tokenHash.CLIENT_ID.test(clientId)) throw invalidClient('unknown client');
    const row = await store.clients.find(clientId);
    if (!row || row.revokedAt) throw invalidClient('unknown client');
    return row;
}

const decodeBasic = (header) => {
    const match = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(String(header || ''));
    if (!match) return null;
    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
    const at = decoded.indexOf(':');
    if (at < 0) return null;
    try {
        // RFC 6749 section 2.3.1: both halves are form-urlencoded before they are joined.
        return { clientId: decodeURIComponent(decoded.slice(0, at).replace(/\+/g, ' ')), secret: decodeURIComponent(decoded.slice(at + 1).replace(/\+/g, ' ')) };
    } catch (error) {
        return null;
    }
};

/* Client authentication at the token and revocation endpoints (OAuth 2.1 section 2.4): a public client
 * names itself and presents no secret; a confidential one presents its secret the one way it registered. */
async function authenticate(req) {
    const body = req.body || {};
    const basic = req.headers && req.headers.authorization ? decodeBasic(req.headers.authorization) : null;
    if (req.headers && req.headers.authorization && !basic) throw invalidClient('unsupported client authentication');
    if (basic && body.client_secret !== undefined) throw invalidClient('use one client authentication method');
    if (basic && body.client_id !== undefined && body.client_id !== basic.clientId) throw invalidClient('client_id does not match the authenticated client');
    const clientId = basic ? basic.clientId : body.client_id;
    const client = await resolve(typeof clientId === 'string' ? clientId : '', { fetchDocument: false });
    const method = client.tokenEndpointAuthMethod;
    if (method === 'none') {
        if (basic || body.client_secret !== undefined) throw invalidClient('this is a public client: it presents no secret');
        return client;
    }
    const secret = method === 'client_secret_basic' ? (basic && basic.secret) : (!basic && body.client_secret);
    if (typeof secret !== 'string' || !secret || !client.secretHash || !tokenHash.sameSecret(tokenHash.hashOf(secret), client.secretHash)) {
        throw invalidClient('client authentication failed');
    }
    return client;
}

const nameOf = (value) => (typeof value === 'string' && value.trim() && value.trim().length <= MAX_NAME_LENGTH ? value.trim() : '');

const scopesOf = (value) => {
    if (value === undefined || value === null || value === '') return [];
    const list = Array.isArray(value) ? value : String(value).split(' ').filter(Boolean);
    if (!list.every((scope) => SCOPES.includes(scope))) throw invalidMetadata(`scopes must be drawn from: ${SCOPES.join(' ')}`);
    return [...new Set(list)];
};

/* A dynamically registered client belongs to no workspace; a pre-registered one belongs to the workspace
 * whose owner or admin registered it, and can only be granted access to that workspace. */
async function register({ name, redirectUris, tokenEndpointAuthMethod, scopes, kind, companyId = null, createdBy = '' }) {
    const clientName = nameOf(name);
    if (!clientName) throw invalidMetadata(`client_name is required, up to ${MAX_NAME_LENGTH} characters`);
    if (!validRedirectUris(redirectUris)) throw new ClientError('invalid_redirect_uri', 'redirect_uris must be 1 to 10 https or loopback URIs without a fragment');
    const method = tokenEndpointAuthMethod === undefined ? 'client_secret_basic' : tokenEndpointAuthMethod;
    if (!AUTH_METHODS.includes(method)) throw invalidMetadata(`token_endpoint_auth_method must be one of: ${AUTH_METHODS.join(', ')}`);
    const secret = method === 'none' ? null : tokenHash.generate('secret');
    const row = {
        clientId: tokenHash.newClientId(),
        kind,
        name: clientName,
        redirectUris: [...redirectUris],
        tokenEndpointAuthMethod: method,
        ...(secret ? { secretHash: tokenHash.hashOf(secret) } : {}),
        scopes: scopesOf(scopes),
        companyId: companyId ? String(companyId) : null,
        createdBy: String(createdBy || ''),
        createdAt: new Date(),
        revokedAt: null,
    };
    await store.clients.save(row);
    return { client: row, secret };
}

const publicView = (row) => ({
    clientId: row.clientId,
    kind: row.kind,
    name: row.name,
    redirectUris: row.redirectUris,
    tokenEndpointAuthMethod: row.tokenEndpointAuthMethod,
    scopes: row.scopes || [],
    createdBy: row.createdBy || '',
    createdAt: row.createdAt,
    revokedAt: row.revokedAt || null,
});

module.exports = { ClientError, AUTH_METHODS, resolve, authenticate, register, publicView, decodeBasic };
