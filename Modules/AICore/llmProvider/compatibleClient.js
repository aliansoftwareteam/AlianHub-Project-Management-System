const dns = require('dns');
const net = require('net');
const axios = require('axios');
const { isNeverAllowedAddress } = require('../../Webhooks/helpers/privateHostAllowlist');

/* The only client that calls the OpenAI-compatible AI endpoint the instance owner configured,
 * for model calls, speech-to-text and "Test connection". Loopback and private addresses are allowed
 * on purpose: a self-hosted model lives on the owner's network, and the URL comes from the
 * instance settings or the environment, never from a workspace user. Agent fetches and webhooks
 * keep their own SSRF rules (Agents/engine/safeFetch); nothing here relaxes them.
 *
 * What stays refused even for the owner: link-local and cloud metadata addresses (no model is
 * served there, and they hold instance credentials), credentials or a query in the URL, and any
 * redirect, so the key is only ever sent to the host that was configured. The resolved address is
 * checked and pinned, so a DNS answer cannot change between the check and the connection. */

const ENDPOINT_REFUSED = 'endpoint_refused';
const INVALID_BASE_URL = 'invalid_base_url';
const ENDPOINT_REDIRECT = 'endpoint_redirect';
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const MAX_REQUEST_BYTES = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10000;

const METADATA_HOSTS = new Set(['metadata.google.internal', 'metadata.goog', 'metadata']);

const canonicalHost = (host) => String(host || '').trim().toLowerCase().replace(/\.+$/, '').replace(/^\[|\]$/g, '');

/* The same never-allowed list as the webhook private-host allowlist: link-local and the cloud metadata services. */
const isForbiddenAddress = (ip) => net.isIP(canonicalHost(ip).replace(/%.*$/, '')) !== 0 && isNeverAllowedAddress(ip);

const refused = (message) => Object.assign(new Error(message), { code: ENDPOINT_REFUSED });
const invalid = (message, reason) => Object.assign(new Error(message), { code: INVALID_BASE_URL, reason });

/* null when the base URL is usable, otherwise the reason the settings form shows. */
function baseUrlError(raw) {
    let u;
    try { u = new URL(String(raw || '').trim()); } catch (e) { return 'url'; }
    if (!/^https?:$/.test(u.protocol)) return 'protocol';
    if (u.username || u.password) return 'credentials';
    if (u.search || u.hash) return 'query';
    return null;
}

const REASON_TEXT = {
    url: 'is not a valid URL',
    protocol: 'must start with http:// or https://',
    credentials: 'must not carry a user name or password; put the key in the API key field',
    query: 'must not carry a query string or fragment',
};

function normaliseBaseUrl(raw) {
    const reason = baseUrlError(raw);
    if (reason) throw invalid(`The base URL ${REASON_TEXT[reason]}.`, reason);
    return String(raw).trim().replace(/\/+$/, '');
}

const withTimeout = (promise, ms, what) => {
    let timer;
    const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(`${what} timed out after ${ms} ms`), { code: 'ETIMEDOUT' })), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

async function resolveTarget(u, timeoutMs) {
    const host = canonicalHost(u.hostname);
    if (METADATA_HOSTS.has(host) || isForbiddenAddress(host)) {
        throw refused(`${host} is a link-local or cloud metadata address; an AI endpoint cannot be served from there.`);
    }
    const answers = await withTimeout(dns.promises.lookup(host, { all: true, verbatim: true }), timeoutMs, `Resolving ${host}`);
    if (!answers || !answers.length) throw Object.assign(new Error(`Could not resolve ${host}.`), { code: 'ENOTFOUND' });
    const bad = answers.find((a) => isForbiddenAddress(a.address));
    if (bad) throw refused(`${host} resolves to a link-local or cloud metadata address (${bad.address}); an AI endpoint cannot be served from there.`);
    return { address: answers[0].address, family: answers[0].family || net.isIP(answers[0].address) };
}

const pinnedLookup = ({ address, family }) => (hostname, options, cb) => {
    if (options && options.all) return cb(null, [{ address, family }]);
    return cb(null, address, family);
};

/**
 * One request to `<baseUrl><path>`. Rejects with the axios error for an HTTP failure, so the
 * provider layer can type it like any vendor's, and with a plain error for a refused URL.
 * @param {{method?: 'get'|'post', baseUrl: string, path: string, body?: any, apiKey?: string, timeoutMs?: number, headers?: object}} opts
 */
async function request({ method = 'post', baseUrl, path, body, apiKey, timeoutMs = DEFAULT_TIMEOUT_MS, headers = {} }) {
    const base = normaliseBaseUrl(baseUrl);
    const url = new URL(`${base}${path}`);
    const target = await resolveTarget(url, timeoutMs);
    const config = {
        headers: { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), ...headers },
        timeout: timeoutMs,
        maxRedirects: 0,
        maxContentLength: MAX_RESPONSE_BYTES,
        maxBodyLength: MAX_REQUEST_BYTES,
        lookup: pinnedLookup(target),
        proxy: false,
        validateStatus: (status) => status >= 200 && status < 300,
    };
    try {
        return method === 'get' ? await axios.get(url.toString(), config) : await axios.post(url.toString(), body, config);
    } catch (error) {
        const status = error && error.response && error.response.status;
        if (status >= 300 && status < 400) {
            throw Object.assign(new Error(`The endpoint answered with a redirect (${status}); set the base URL it redirects to instead.`), { code: ENDPOINT_REDIRECT });
        }
        throw error;
    }
}

async function listModels({ baseUrl, apiKey, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    const response = await request({ method: 'get', baseUrl, path: '/models', apiKey, timeoutMs });
    const rows = response && response.data && response.data.data;
    if (!Array.isArray(rows)) throw new Error('The endpoint answered, but not with an OpenAI-style model list (GET /models).');
    return { models: rows.map((row) => row && row.id).filter((id) => typeof id === 'string' && id) };
}

/* A sentence for the person who pressed "Test connection". Never includes the key. */
function describeFailure(error, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (!error) return 'The request failed.';
    if ([ENDPOINT_REFUSED, INVALID_BASE_URL, ENDPOINT_REDIRECT].includes(error.code)) return error.message;
    const status = error.response && error.response.status;
    if (status === 401 || status === 403) return 'The endpoint rejected the API key.';
    if (status === 404) return 'The endpoint answered 404: check that the base URL ends where the OpenAI API starts (often /v1).';
    if (status) return `The endpoint answered ${status}.`;
    const code = error.code || (error.cause && error.cause.code);
    if (code === 'ECONNREFUSED') return 'Could not reach the endpoint: the connection was refused. Is the server running and listening on that port?';
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Could not reach the endpoint: the host name did not resolve.';
    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || /timeout/i.test(String(error.message))) return `Could not reach the endpoint: no answer within ${Math.round(timeoutMs / 1000)} s (timed out).`;
    return `Could not reach the endpoint: ${String(error.message || 'request failed').replace(/Bearer\s+\S+/g, 'Bearer [redacted]')}`;
}

module.exports = {
    ENDPOINT_REFUSED,
    INVALID_BASE_URL,
    ENDPOINT_REDIRECT,
    DEFAULT_TIMEOUT_MS,
    baseUrlError,
    normaliseBaseUrl,
    isForbiddenAddress,
    request,
    listModels,
    describeFailure,
};
