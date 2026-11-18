// The shape of a workspace egress allowlist entry and how a hostname matches
// one: the one copy, read by the server (safeFetch, the instance console) and
// by the console page through the `@egressRules` alias. Pure and dependency-free
// so it can be bundled; the server passes its stricter host check in, the
// browser falls back to the literal private names and address spellings below.

const MAX_HOSTS = 200;

const REASON = Object.freeze({
    INVALID: 'invalid',
    ADDRESS: 'address',
    PRIVATE: 'private',
    SCHEME: 'scheme',
    PATH: 'path',
    WILDCARD: 'wildcard',
    PUBLIC_SUFFIX: 'public_suffix',
    WILDCARD_DNS: 'wildcard_dns',
    PORT: 'port',
    TOO_MANY: 'too_many',
});

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
// A URL parser reads a host whose last label is a number as an IPv4 address, or refuses it: never a name.
const ENDS_IN_NUMBER = /(^|\.)(\d+|0x[0-9a-f]*)$/;
const PRIVATE_NAMES = ['localhost', 'local', 'internal'];

/* Suffixes anyone can register a name under, so `*.suffix` would admit every tenant of it, an attacker's
 * included. The tree has no public-suffix package and the browser bundles this file, so this is a short list
 * of the well-known ones, not the Public Suffix List: a wildcard on a suffix missing here is accepted. An
 * exact host under any of them is always accepted.
 *
 * - country-code second levels, by shape: one of the registry labels below on a two-letter TLD (co.uk, com.au);
 * - hosting platforms that hand out one label under the suffix (acme.github.io). A wildcard below a tenant's own
 *   name (*.acme.pages.dev, the preview deployments) stays accepted;
 * - cloud suffixes whose deeper levels are shared too (s3.amazonaws.com, blob.core.windows.net, a.run.app):
 *   a wildcard anywhere at or under them is refused. */
const REGISTRY_LABELS = ['ac', 'co', 'com', 'edu', 'gov', 'ltd', 'me', 'mil', 'ne', 'net', 'nom', 'or', 'org', 'plc', 'sch'];
const SHARED_SUFFIXES = [
    'github.io', 'gitlab.io', 'pages.dev', 'workers.dev', 'vercel.app', 'netlify.app', 'herokuapp.com', 'onrender.com', 'fly.dev',
    'web.app', 'firebaseapp.com', 'azurewebsites.net', 'blogspot.com', 'wordpress.com', 'glitch.me', 'replit.app', 'replit.dev',
    'ngrok.io', 'ngrok.app', 'ngrok-free.app', 'trycloudflare.com', 'deno.dev', 'surge.sh', 'uk.com', 'us.com', 'eu.org',
    'ngrok.dev', 'loca.lt', 'github.dev', 'myshopify.com', 'readthedocs.io', 'azurestaticapps.net', 'firebaseio.com',
];
const SHARED_AT_ANY_DEPTH = [
    'amazonaws.com', 'amazonaws.com.cn', 'cloudfront.net', 'elasticbeanstalk.com', 'windows.net', 'azureedge.net', 'cloudapp.azure.com',
    'appspot.com', 'run.app', 'cloudfunctions.net', 'googleusercontent.com', 'digitaloceanspaces.com', 'r2.dev',
];

/* Wildcard-DNS services answer any name under them with the address written into it (10.0.0.1.nip.io) or with
 * loopback, so a wildcard at any depth under one admits every address and makes the list pointless. An exact host
 * is still accepted: the resolved-address check refuses it if it lands somewhere private. */
const WILDCARD_DNS_SUFFIXES = ['nip.io', 'sslip.io', 'xip.io', 'traefik.me', 'localtest.me', 'lvh.me', 'backname.io', 'nip.direct'];

const underWildcardDns = (host) => WILDCARD_DNS_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));

const isPublicSuffix = (host) => {
    const labels = host.split('.');
    if (labels.length === 2 && labels[1].length === 2 && REGISTRY_LABELS.includes(labels[0])) return true;
    if (SHARED_SUFFIXES.includes(host)) return true;
    return SHARED_AT_ANY_DEPTH.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
};

const normalizeHost = (host) => String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');

const isAddressLike = (host) => host.includes(':') || ENDS_IN_NUMBER.test(host);

const isPrivateName = (host) => PRIVATE_NAMES.some((name) => host === name || host.endsWith(`.${name}`));

const isHostname = (host) => host.length <= 253 && host.split('.').every((label) => LABEL.test(label));

/* One entry: `host`, `*.host`, either with `:port`. Returns { entry } or { reason }. */
function parseEntry(raw, { isBlockedHostname } = {}) {
    const text = String(raw).trim().toLowerCase();
    if (!text || /\s/.test(text) || text.includes('@')) return { reason: REASON.INVALID };
    if (/^[a-z][a-z0-9+.-]*:\/\//.test(text)) return { reason: REASON.SCHEME };
    if (/[/?#]/.test(text)) return { reason: isAddressLike(normalizeHost(text.split(/[/?#]/)[0].replace(/:\d+$/, ''))) ? REASON.ADDRESS : REASON.PATH };

    let host = text.replace(/\.$/, '');
    let port = null;
    const portAt = host.lastIndexOf(':');
    if (portAt !== -1 && !host.includes(']') && !host.slice(0, portAt).includes(':')) {
        const portText = host.slice(portAt + 1);
        host = host.slice(0, portAt);
        if (!/^\d{1,5}$/.test(portText)) return { reason: REASON.INVALID };
        port = Number(portText);
        if (port < 1 || port > 65535) return { reason: REASON.PORT };
    }

    let suffix = false;
    if (host.startsWith('*.')) {
        suffix = true;
        host = host.slice(2);
    }
    if (host.includes('*')) return { reason: REASON.WILDCARD };

    const bare = normalizeHost(host);
    if (!bare) return { reason: REASON.INVALID };
    if (isAddressLike(bare)) return { reason: REASON.ADDRESS };
    if (!isHostname(bare)) return { reason: REASON.INVALID };
    if (isPrivateName(bare) || (typeof isBlockedHostname === 'function' && isBlockedHostname(bare))) return { reason: REASON.PRIVATE };
    // A single label resolves through the local search domain, and a suffix on one would cover a whole top-level domain.
    if (!bare.includes('.')) return { reason: suffix ? REASON.WILDCARD : REASON.PRIVATE };
    if (suffix && underWildcardDns(bare)) return { reason: REASON.WILDCARD_DNS };
    if (suffix && isPublicSuffix(bare)) return { reason: REASON.PUBLIC_SUFFIX };

    return { entry: { text: `${suffix ? '*.' : ''}${bare}${port ? `:${port}` : ''}`, host: bare, suffix, port } };
}

/* A list as the console sends it: canonical strings, deduplicated, with one error per refused entry. */
function validateHosts(list, opts = {}) {
    if (!Array.isArray(list)) return { hosts: [], errors: [{ entry: '', reason: REASON.INVALID }] };
    const hosts = [];
    const errors = [];
    for (const raw of list) {
        if (raw === null || raw === undefined) continue;
        if (typeof raw !== 'string') { errors.push({ entry: '', reason: REASON.INVALID }); continue; }
        const trimmed = raw.trim();
        if (!trimmed) continue;
        const { entry, reason } = parseEntry(trimmed, opts);
        if (reason) { errors.push({ entry: trimmed, reason }); continue; }
        if (hosts.includes(entry.text)) continue;
        if (hosts.length >= MAX_HOSTS) { errors.push({ entry: trimmed, reason: REASON.TOO_MANY }); continue; }
        hosts.push(entry.text);
    }
    return { hosts, errors };
}

const compiled = (text) => {
    const { entry } = parseEntry(text);
    return entry || null;
};

/* Whether a hostname (as a URL parser gives it) on a port is admitted by a list of canonical entries. */
function hostMatches(hosts, hostname, port) {
    const host = normalizeHost(hostname);
    if (!host) return false;
    const wanted = Number(port);
    return (hosts || []).some((text) => {
        const entry = compiled(text);
        if (!entry) return false;
        if (entry.port && entry.port !== wanted) return false;
        return entry.suffix ? host.endsWith(`.${entry.host}`) : host === entry.host;
    });
}

module.exports = { MAX_HOSTS, REASON, normalizeHost, parseEntry, validateHosts, hostMatches, underWildcardDns };
