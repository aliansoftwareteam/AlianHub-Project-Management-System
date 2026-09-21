// Declared external reads (Sprint 11, ADR 003 phase 4): a data skill names the
// one host it reads and a path template. The declaration is checked at save, and
// every rule again at run time against the live allowlist and secret.

const { parseEntry, hostMatches, underWildcardDns, normalizeHost } = require('../engine/egressRules');
const secrets = require('../../../Config/secrets');

const FLAG = 'SKILL_EXTERNAL_READS';
const READERS = Object.freeze(['url', 'api']);
const CREDENTIAL_KIND = 'skill_read';
const HANDLE = secrets.HANDLE;
const MAX_PATH = 2000;
const HTTPS_PORT = 443;
const TAG = /\{\{\s*[^{}]+?\s*\}\}/g;

const CODE = Object.freeze({
    HOST_NOT_ALLOWED: 'host_not_allowed',
    INVALID_PATH: 'invalid_path',
    CREDENTIAL_INVALID: 'credential_invalid',
    CREDENTIAL_NOT_FOUND: 'credential_not_found',
    CREDENTIAL_WRONG_KIND: 'credential_wrong_kind',
    CREDENTIAL_REVOKED: 'credential_revoked',
    CREDENTIAL_STORE_OFF: 'credential_store_off',
    CREDENTIAL_STORE_UNAVAILABLE: 'credential_store_unavailable',
    CREDENTIAL_HOST_NOT_BOUND: 'credential_host_not_bound',
    CREDENTIAL_UNAVAILABLE: 'credential_unavailable',
    HOST_NOT_DECLARED: 'host_not_declared',
    READ_FAILED: 'read_failed',
    ALLOWLIST_UNREADABLE: 'allowlist_unreadable',
    SECRET_IN_BODY: 'secret_in_body',
    NOT_AVAILABLE: 'external_reads_not_available',
});

const HOST_REASON = Object.freeze({
    invalid: 'is not a host name',
    address: 'is an address; declare a host name',
    private: 'is a private, local or internal host',
    scheme: 'must be a bare host, without a scheme',
    path: 'must be a bare host, without a path',
    wildcard: 'must be one exact host, not a wildcard',
    port: 'has a port outside 1 to 65535',
    wildcard_dns: 'is under a wildcard-DNS service that answers any address written into the name',
});

/* Names reserved for private networks, testing or documentation (RFC 6761,
 * RFC 8375 and common intranet suffixes). Held here, not in the shared egress
 * rules, so agent page fetches keep today's behaviour. */
const RESERVED_SUFFIXES = Object.freeze(['home.arpa', 'lan', 'corp', 'intranet', 'localdomain', 'test', 'example', 'invalid']);

const underReservedSuffix = (host) => RESERVED_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));

const enabled = () => ['on', 'true', '1', 'yes'].includes(String(process.env.SKILL_EXTERNAL_READS || 'off').trim().toLowerCase());

const isExternal = (reader) => READERS.includes(reader);

/* A wildcard is refused here although the allowlist accepts one: a skill reads
 * one host an admin reviewed, never every host under a suffix. */
const parseDeclaredHost = (raw) => {
    if (typeof raw !== 'string' || !raw.trim()) return { reason: 'invalid' };
    if (raw.includes('*')) return { reason: 'wildcard' };
    const { entry, reason } = parseEntry(raw);
    if (reason) return { reason };
    if (underWildcardDns(entry.host)) return { reason: 'wildcard_dns' };
    if (underReservedSuffix(entry.host)) return { reason: 'private' };
    return { entry };
};

const DOT_SEGMENT = /^\.{0,2}$/;

/* Decoded until stable, so ".", "%2e" and "%252e" all read as the dot they
 * would become somewhere along the way. */
const decodedFully = (text) => {
    let current = String(text);
    for (let i = 0; i < 5; i += 1) {
        let next;
        try { next = decodeURIComponent(current); } catch (e) { return current; }
        if (next === current) return current;
        current = next;
    }
    return current;
};

const isDotSegment = (text) => DOT_SEGMENT.test(decodedFully(text));

const pathPartOf = (path) => path.split('?')[0];

const hostProblem = (reason) => HOST_REASON[reason] || HOST_REASON.invalid;

/* The URL is built as https://<declared host><path>, so a path that does not
 * start with exactly one "/" would let the template choose the authority. */
const pathProblem = (path) => {
    if (typeof path !== 'string' || !path) return 'is required';
    if (path.length > MAX_PATH) return `must be ${MAX_PATH} characters or fewer`;
    if (!path.startsWith('/') || path.startsWith('//')) return 'must start with a single "/": the host is declared on its own';
    if (/\{\{\s*[#^/]/.test(path)) return 'takes plain placeholders only, not sections';
    const literal = path.replace(TAG, '');
    if (literal.includes('\\')) return 'must not contain a backslash';
    if ([...literal].some((ch) => /\s/.test(ch) || ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)) return 'must not contain whitespace or control characters';
    if (literal.includes('#')) return 'must not contain "#"';
    const segments = pathPartOf(path).replace(TAG, 'x').split('/').slice(1);
    if (segments.some((segment, i) => segment !== '' && isDotSegment(segment)) || segments.slice(0, -1).some((segment) => segment === '')) return 'must not contain empty, "." or ".." dot segments';
    return '';
};

/* Every placeholder value is percent-encoded whole, so no value can add a "/",
 * "@", "\\", "?" or "#" and move the read off its declared origin. */
const segmentsOf = (pathname) => pathname.split('/').map(decodedFully);

/* The parser resolves dot segments and re-encodes some characters, so the built
 * path is compared segment by segment with the one that was meant. */
const assertBuilt = (url, { origin, pathname }) => {
    if (url.origin !== origin || url.username || url.password) throw new Error('the read left its declared origin');
    const got = segmentsOf(url.pathname);
    const meant = segmentsOf(pathname);
    if (got.length !== meant.length || got.some((segment, i) => segment !== meant[i])) throw new Error('the read path changed when parsed');
};

const buildUrl = ({ host, path }, { task = {}, input = {} } = {}) => {
    const { entry, reason } = parseDeclaredHost(host);
    if (!entry) throw new Error(`the declared host ${hostProblem(reason)}`);
    const problem = pathProblem(path);
    if (problem) throw new Error(`the declared path ${problem}`);
    const { renderString } = require('./skillTemplate');
    const ctx = require('./compile').contextOf(task, { input });
    const queryAt = path.indexOf('?');
    let filled = '';
    let last = 0;
    path.replace(TAG, (tag, at) => {
        const value = renderString(tag, ctx);
        if ((queryAt === -1 || at < queryAt) && isDotSegment(value)) throw new Error('a value would fill a path segment with nothing, "." or ".."');
        filled += path.slice(last, at) + encodeURIComponent(value);
        last = at + tag.length;
        return tag;
    });
    filled += path.slice(last);
    const origin = new URL(`https://${entry.host}${entry.port ? `:${entry.port}` : ''}`).origin;
    const url = new URL(`${origin}${filled}`);
    assertBuilt(url, { origin, pathname: pathPartOf(filled) });
    return url.href;
};

const error = (field, code, message, extra = {}) => ({ field, code, message, ...extra });

const hostError = (at, host, reason) => error(`${at}.params.host`, CODE.HOST_NOT_ALLOWED,
    reason ? `"${host}" ${hostProblem(reason)}` : `"${host}" is not on this workspace's egress allowlist; an instance owner adds it under Instance > Egress`,
    { host, ...(reason ? { reason } : {}) });

const CREDENTIAL_REFUSAL = Object.freeze({
    not_found: [CODE.CREDENTIAL_NOT_FOUND, 'no secret with this handle in this workspace'],
    revoked: [CODE.CREDENTIAL_REVOKED, 'this secret is revoked; choose a live one'],
    store_off: [CODE.CREDENTIAL_STORE_OFF, 'the secrets store is off, so no credential can be named'],
});

/* Exact host and port: a secret or a declaration without a port means https on 443. */
const namesHost = (list, hostname, port) => (Array.isArray(list) ? list : []).some((text) => {
    const { entry } = parseDeclaredHost(text);
    return Boolean(entry) && entry.host === normalizeHost(hostname) && (entry.port || HTTPS_PORT) === port;
});

const portOf = (u) => Number(u.port || (u.protocol === 'https:' ? HTTPS_PORT : 80));

/* The credential rules at save and at run: a live skill_read secret of this workspace that names the host. */
const credentialProblem = async (companyId, handle, { host, port }) => {
    let meta;
    try {
        meta = await secrets.describe({ companyId, handle });
    } catch (e) {
        const known = CREDENTIAL_REFUSAL[e && e.code];
        if (known) return { code: known[0], message: known[1] };
        return { code: CODE.CREDENTIAL_STORE_UNAVAILABLE, message: 'the secrets store could not be read, so the credential was not checked; try again', retryable: true };
    }
    if (meta.kind !== CREDENTIAL_KIND) {
        return { code: CODE.CREDENTIAL_WRONG_KIND, message: `the secret is of kind "${meta.kind}"; a skill reads only with a "${CREDENTIAL_KIND}" secret` };
    }
    if (!namesHost(meta.hosts, host, port)) {
        return { code: CODE.CREDENTIAL_HOST_NOT_BOUND, message: `the secret may not be sent to ${host}${port === HTTPS_PORT ? '' : `:${port}`}; an admin adds the host to the secret under Settings > Integrations > Secrets` };
    }
    return { meta };
};

const checkCredential = async (companyId, handle, at, entry) => {
    const found = await credentialProblem(companyId, handle, { host: entry.host, port: entry.port || HTTPS_PORT });
    if (found.meta) return null;
    return error(`${at}.params.credential`, found.code, found.message, found.retryable ? { retryable: true } : {});
};

/* The save-time half of the check: the live allowlist of this workspace, an
 * empty one included, and each credential handle. */
const checkDeclaredReads = async (companyId, value) => {
    const steps = (value.gather || []).map((step, i) => ({ step, at: `gather[${i}]` })).filter(({ step }) => isExternal(step.reader));
    if (!steps.length) return [];
    let listed;
    try {
        listed = await require('../engine/egressAllowlist').hostsFor(companyId);
    } catch (e) {
        return [error('gather', CODE.ALLOWLIST_UNREADABLE, 'the workspace egress allowlist could not be read, so the declared reads could not be checked; try again')];
    }
    const errors = [];
    for (const { step, at } of steps) {
        const { entry, reason } = parseDeclaredHost(step.params.host);
        if (!entry) errors.push(hostError(at, step.params.host, reason));
        else if (!hostMatches(listed, entry.host, entry.port || HTTPS_PORT)) errors.push(hostError(at, entry.text));
        if (entry && step.params.credential) {
            // eslint-disable-next-line no-await-in-loop
            const refused = await checkCredential(companyId, step.params.credential, at, entry);
            if (refused) errors.push(refused);
        }
    }
    return errors;
};

const refusal = (code, message, extra = {}) => Object.assign(new Error(`${code}: ${message}`), { code, deterministic: true, ...extra });

const listedHosts = async (companyId) => {
    try {
        return await require('../engine/egressAllowlist').hostsFor(companyId);
    } catch (e) {
        throw refusal(CODE.ALLOWLIST_UNREADABLE, 'the workspace egress allowlist could not be read, so nothing was fetched');
    }
};

/* Every hop of a declared read, the first included: https, one of the skill's declared hosts, and on the
 * workspace allowlist as it stands now, an empty list refusing everything. */
const admitHop = ({ companyId, actor, declaredHosts, listed }, target, hop) => {
    const port = portOf(target);
    if (target.protocol !== 'https:') throw refusal(CODE.HOST_NOT_DECLARED, `refused a redirect from https to http (${target.host}); a declared read stays on https`);
    if (!namesHost(declaredHosts, target.hostname, port)) throw refusal(CODE.HOST_NOT_DECLARED, `${target.host} is not a host this skill declares, so it was not fetched`);
    if (!hostMatches(listed, target.hostname, port)) {
        require('../engine/egressAllowlist').recordRefusal(companyId, { actor, host: normalizeHost(target.hostname), port, reason: 'unlisted', hop });
        throw refusal(CODE.HOST_NOT_ALLOWED, `${target.host} is not on this workspace's egress allowlist; an instance owner adds it under Instance > Egress`);
    }
};

/* The header the secret names, the value as stored; a bare token in Authorization is sent as a bearer token. */
const credentialFor = async (companyId, handle, target) => {
    const found = await credentialProblem(companyId, handle, { host: target.hostname, port: portOf(target) });
    if (!found.meta) throw refusal(found.code, found.message);
    let value = null;
    try { value = await secrets.resolve({ companyId, handle }); } catch (e) { value = null; }
    if (!value) throw refusal(CODE.CREDENTIAL_UNAVAILABLE, 'the credential could not be read, so nothing was fetched');
    const header = found.meta.header || 'authorization';
    const sent = header === 'authorization' && !/^[A-Za-z][A-Za-z0-9-]*\s+\S/.test(value) ? `Bearer ${value}` : value;
    return { header, sent, values: [...new Set([sent, value])] };
};

const REDACTED = '[redacted]';

const scrub = (text, secret) => (secret ? secret.values.reduce((out, value) => out.split(value).join(REDACTED), String(text)) : String(text));

/* A failed read is rethrown as a new error carrying only a scrubbed message: an HTTP client error holds the
 * request config, headers and all. */
const readFailure = (e, secret) => {
    const message = scrub((e && e.message) || 'the read failed', secret);
    if (e && e.deterministic && Object.values(CODE).includes(e.code)) return refusal(e.code, message.replace(new RegExp(`^${e.code}: `), ''));
    return Object.assign(new Error(message), { code: CODE.READ_FAILED });
};

const notAvailable = (skillKey) => Object.assign(
    new Error(`${CODE.NOT_AVAILABLE}: skill "${skillKey}" declares an external read, which this server does not run yet; nothing was fetched`),
    { code: CODE.NOT_AVAILABLE, deterministic: true },
);

module.exports = {
    FLAG, READERS, CREDENTIAL_KIND, HANDLE, MAX_PATH, CODE,
    enabled, isExternal, parseDeclaredHost, hostProblem, pathProblem, assertBuilt, buildUrl, hostError, checkDeclaredReads, notAvailable,
    namesHost, listedHosts, admitHop, credentialFor, scrub, readFailure, refusal,
};
