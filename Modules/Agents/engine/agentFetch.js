const pageAudit = require('./pageAudit');
const egressContext = require('./egressContext');
const fetcher = require('./safeFetch');
const taint = require('../taint');

const UA = 'AlianHub-Skill-Reader/1.0 (+https://alianhub.com)';

const hostOf = (url) => {
    try { return new URL(String(url)).hostname; } catch (e) { return ''; }
};

/* Agent code reads pages through here, never through pageAudit.js directly (tests/conventions/agent-egress-callers
 * holds that). With the flag on, a read that names no workspace would fall back to the open rules and skip that
 * workspace's list without a trace, so it is refused. The refusal is logged rather than audited: an audit row
 * lives in a workspace's database, and this call has none. The logger is required on refusal only, so a skill
 * that reads pages loads nothing new while the flag is off. */
const inWorkspace = (name) => async (url) => {
    if (egressContext.isOn() && !(egressContext.get() || {}).companyId) {
        require('../../../Config/loggerConfig').error(`agent egress: ${name} of ${hostOf(url) || 'an unreadable URL'} refused, no workspace in the egress context`);
        throw Object.assign(new Error('this fetch names no workspace, so its egress allowlist cannot apply and it was refused — run it inside egressContext.run({ companyId, actor })'), { code: 'no_workspace' });
    }
    return pageAudit[name](url);
};

const sourcesOf = (url, hops) => {
    const found = (Array.isArray(hops) && hops.length ? hops.map((hop) => `https://${hop.host}/`) : [url]).map(taint.fetched).filter(Boolean);
    return found.filter((source, i) => found.findIndex((other) => other.ref === source.ref) === i);
};

/* A data skill's declared read (skills/externalReads.js holds the rules). The allowlist is read live, never the
 * save-time answer; the credential is resolved here and lives only in the request header, which safeFetch drops
 * at the first hop to another origin. `fetcher.safeFetch` is looked up per call so a test server can stand in
 * for DNS. */
const readDeclared = async ({ companyId, actor, url, declaredHosts, credential, maxBytes, timeoutMs, maxRedirects }) => {
    const rules = require('../skills/externalReads');
    if (!companyId) throw Object.assign(new Error('a declared read names no workspace, so it was refused'), { code: 'no_workspace', deterministic: true });
    const target = new URL(String(url));
    const scope = { companyId, actor, declaredHosts, listed: await rules.listedHosts(companyId) };
    rules.admitHop(scope, target, 0);
    const secret = credential ? await rules.credentialFor(companyId, credential, target) : null;
    let res;
    try {
        res = await fetcher.safeFetch(target.href, {
            method: 'get',
            timeoutMs,
            maxBytes,
            maxRedirects,
            headers: { 'User-Agent': UA, ...(secret ? { [secret.header]: secret.sent } : {}) },
            sensitiveHeaders: secret ? [secret.header] : [],
            companyId,
            actor,
            beforeHop: (next, hop) => { if (hop > 0) rules.admitHop(scope, new URL(next), hop); },
        });
    } catch (e) {
        throw rules.readFailure(e, secret);
    }
    const found = sourcesOf(target.href, res.hops);
    found.forEach(taint.note);
    return { status: res.status, body: rules.scrub(res.body, secret), bytes: res.bytes, hops: res.hops || [], taint: found };
};

module.exports = { fetchPage: inWorkspace('fetchPage'), audit: inWorkspace('audit'), readDeclared };
