// Declared external reads (Sprint 11, ADR 003 phase 4): a data skill names the
// one host it reads and a path template. This slice checks the declaration at
// save; nothing is fetched until the run-time slice lands.

const { parseEntry, hostMatches } = require('../engine/egressRules');
const { isBlockedHostname } = require('../engine/safeFetch');
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
});

const enabled = () => ['on', 'true', '1', 'yes'].includes(String(process.env.SKILL_EXTERNAL_READS || 'off').trim().toLowerCase());

const isExternal = (reader) => READERS.includes(reader);

/* A wildcard is refused here although the allowlist accepts one: a skill reads
 * one host an admin reviewed, never every host under a suffix. */
const parseDeclaredHost = (raw) => {
    if (typeof raw !== 'string' || !raw.trim()) return { reason: 'invalid' };
    if (raw.includes('*')) return { reason: 'wildcard' };
    const { entry, reason } = parseEntry(raw, { isBlockedHostname });
    return reason ? { reason } : { entry };
};

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
    return '';
};

/* Every placeholder value is percent-encoded whole, so no value can add a "/",
 * "@", "\\", "?" or "#" and move the read off its declared origin. */
const buildUrl = ({ host, path }, { task = {}, input = {} } = {}) => {
    const { entry, reason } = parseDeclaredHost(host);
    if (!entry) throw new Error(`the declared host ${hostProblem(reason)}`);
    const problem = pathProblem(path);
    if (problem) throw new Error(`the declared path ${problem}`);
    const { renderString } = require('./skillTemplate');
    const ctx = require('./compile').contextOf(task, { input });
    const filled = path.replace(TAG, (tag) => encodeURIComponent(renderString(tag, ctx)));
    const origin = new URL(`https://${entry.host}${entry.port ? `:${entry.port}` : ''}`).origin;
    const url = new URL(`${origin}${filled}`);
    if (url.origin !== origin || url.username || url.password) throw new Error('the read left its declared host');
    return url.href;
};

const error = (field, code, message, extra = {}) => ({ field, code, message, ...extra });

const hostError = (at, host, reason) => error(`${at}.params.host`, CODE.HOST_NOT_ALLOWED,
    reason ? `"${host}" ${hostProblem(reason)}` : `"${host}" is not on this workspace's egress allowlist; an instance owner adds it under Instance > Egress`,
    { host, ...(reason ? { reason } : {}) });

const checkCredential = async (companyId, handle, at) => {
    let meta;
    try {
        meta = await secrets.describe({ companyId, handle });
    } catch (e) {
        return error(`${at}.params.credential`, CODE.CREDENTIAL_NOT_FOUND, e && e.code === 'store_off'
            ? 'the secrets store is off, so no credential can be named'
            : 'no live secret with this handle in this workspace');
    }
    if (meta.kind !== CREDENTIAL_KIND) {
        return error(`${at}.params.credential`, CODE.CREDENTIAL_WRONG_KIND, `the secret is of kind "${meta.kind}"; a skill reads only with a "${CREDENTIAL_KIND}" secret`);
    }
    return null;
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
        if (step.params.credential) {
            // eslint-disable-next-line no-await-in-loop
            const refused = await checkCredential(companyId, step.params.credential, at);
            if (refused) errors.push(refused);
        }
    }
    return errors;
};

const notAvailable = (skillKey) => Object.assign(
    new Error(`${CODE.NOT_AVAILABLE}: skill "${skillKey}" declares an external read, which this server does not run yet; nothing was fetched`),
    { code: CODE.NOT_AVAILABLE, deterministic: true },
);

module.exports = {
    FLAG, READERS, CREDENTIAL_KIND, HANDLE, MAX_PATH, CODE,
    enabled, isExternal, parseDeclaredHost, hostProblem, pathProblem, buildUrl, hostError, checkDeclaredReads, notAvailable,
};
