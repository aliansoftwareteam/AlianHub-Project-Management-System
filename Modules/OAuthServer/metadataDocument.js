const { safeFetch } = require('../Agents/engine/safeFetch');
const { validRedirectUris } = require('./redirectUri');
const config = require('./config');

/* OAuth Client ID Metadata Documents (draft-ietf-oauth-client-id-metadata-document-00), as the MCP
 * 2025-11-25 authorization spec adopts them: the client_id is an https URL and the document behind it
 * is the registration. The URL comes from whoever calls /oauth/authorize, so it is fetched through the
 * agents' SSRF-safe fetch (resolved address checked and pinned), and never through a redirect: the URL is
 * the client's identity, so a document that is not served at it is not that client's document. */

const FETCH = Object.freeze({ timeoutMs: 5000, maxBytes: 5 * 1024, maxRedirects: 0 });
// Anyone can call /oauth/authorize with any URL: one fetch per URL at a time, and a failed URL rests briefly.
const FAILURE_BACKOFF_MS = 5000;
const MAX_CACHE_MS = 24 * 60 * 60 * 1000;
const MAX_CACHED = 1000;
const MAX_NAME_LENGTH = 200;
const ALLOWED_GRANTS = ['authorization_code', 'refresh_token'];

class MetadataDocumentError extends Error {
    constructor(message) {
        super(message);
        this.name = 'MetadataDocumentError';
    }
}

const refuse = (message) => { throw new MetadataDocumentError(message); };

const isMetadataDocumentId = (clientId) => {
    if (typeof clientId !== 'string' || clientId.length > 2000) return false;
    let url;
    try { url = new URL(clientId); } catch (error) { return false; }
    if (url.protocol !== 'https:' || url.href !== clientId) return false;
    if (url.hash || clientId.includes('#') || url.username || url.password) return false;
    if (url.pathname === '/' || url.pathname.split('/').some((segment) => segment === '.' || segment === '..')) return false;
    return true;
};

const cache = new Map();

const cacheMsOf = (headers = {}) => {
    const control = String(headers['cache-control'] || '').toLowerCase();
    if (/(^|[,\s])(no-store|no-cache)([,\s]|$)/.test(control)) return 0;
    const maxAge = control.match(/(?:^|[,\s])max-age=(\d+)/);
    if (maxAge) return Math.min(Number(maxAge[1]) * 1000, MAX_CACHE_MS);
    return config.metadataCacheMs();
};

const remember = (clientId, client, ms) => {
    if (!(ms > 0)) return;
    if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value);
    cache.set(clientId, { client, until: Date.now() + ms });
};

// RFC 7591 section 2 "scope". A document serves many servers, so names this one does not define are ignored.
const scopesOf = (value) => (typeof value === 'string'
    ? [...new Set(value.split(' ').filter((scope) => config.SCOPES.includes(scope)))]
    : []);

const clientOf = (clientId, doc) => {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) refuse('the client metadata document is not a JSON object');
    if (doc.client_id !== clientId) refuse('the client metadata document names another client_id');
    if (typeof doc.client_name !== 'string' || !doc.client_name.trim() || doc.client_name.length > MAX_NAME_LENGTH) refuse('the client metadata document has no usable client_name');
    if (!validRedirectUris(doc.redirect_uris)) refuse('the client metadata document redirect_uris must be https or loopback URIs without a fragment');
    const method = doc.token_endpoint_auth_method === undefined ? 'none' : doc.token_endpoint_auth_method;
    if (method !== 'none') refuse('a client metadata document client must be a public client (token_endpoint_auth_method "none")');
    if (doc.client_secret !== undefined) refuse('a client metadata document must not carry a client_secret');
    if (doc.grant_types !== undefined && !(Array.isArray(doc.grant_types) && doc.grant_types.every((g) => ALLOWED_GRANTS.includes(g)))) refuse('the client metadata document asks for an unsupported grant type');
    if (doc.response_types !== undefined && !(Array.isArray(doc.response_types) && doc.response_types.every((t) => t === 'code'))) refuse('the client metadata document asks for an unsupported response type');
    return {
        clientId,
        kind: 'metadata_document',
        name: doc.client_name.trim(),
        redirectUris: [...doc.redirect_uris],
        tokenEndpointAuthMethod: 'none',
        scopes: scopesOf(doc.scope),
        companyId: null,
        revokedAt: null,
    };
};

const inFlight = new Map();
const failures = new Map();

const noteFailure = (clientId, message) => {
    if (failures.size >= MAX_CACHED) failures.delete(failures.keys().next().value);
    failures.set(clientId, { message, until: Date.now() + FAILURE_BACKOFF_MS });
};

async function fetchDocument(clientId) {
    let res;
    try {
        res = await safeFetch(clientId, { ...FETCH, headers: { accept: 'application/json' } });
    } catch (error) {
        return refuse(`the client metadata document could not be fetched: ${error.message}`);
    }
    if (res.status !== 200) refuse(`the client metadata document answered ${res.status}`);
    if (res.url !== clientId) refuse('the client metadata document was not served at its client_id');
    let doc;
    try { doc = JSON.parse(res.body); } catch (error) { return refuse('the client metadata document is not JSON'); }
    const client = clientOf(clientId, doc);
    remember(clientId, client, cacheMsOf(res.headers));
    return client;
}

async function load(clientId) {
    if (!isMetadataDocumentId(clientId)) refuse('client_id is not an https URL with a path');
    const hit = cache.get(clientId);
    if (hit && hit.until > Date.now()) return hit.client;
    cache.delete(clientId);
    const failed = failures.get(clientId);
    if (failed && failed.until > Date.now()) refuse(failed.message);
    failures.delete(clientId);
    if (!inFlight.has(clientId)) {
        const pending = fetchDocument(clientId)
            .catch((error) => {
                if (error instanceof MetadataDocumentError) noteFailure(clientId, error.message);
                throw error;
            })
            .finally(() => inFlight.delete(clientId));
        inFlight.set(clientId, pending);
    }
    return inFlight.get(clientId);
}

const forget = () => {
    cache.clear();
    failures.clear();
};

module.exports = { load, isMetadataDocumentId, cacheMsOf, forget, MetadataDocumentError, FETCH, FAILURE_BACKOFF_MS };
