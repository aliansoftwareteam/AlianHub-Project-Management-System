const pageAudit = require('./pageAudit');
const egressContext = require('./egressContext');

const hostOf = (url) => {
    try { return new URL(String(url)).hostname; } catch (e) { return ''; }
};

/* Agent code reads pages through here, never through pageAudit.js directly (tests/conventions/agent-egress-callers
 * holds that). With the flag on, a read that names no workspace would fall back to the open rules and skip that
 * workspace's list without a trace, so it is refused. The refusal is logged rather than audited: an audit row
 * lives in a workspace's database, and this call has none. The logger is required on refusal only, so a skill
 * that reads pages loads nothing new while the flag is off. */
const inWorkspace = (name) => async (url, ...rest) => {
    if (egressContext.isOn() && !(egressContext.get() || {}).companyId) {
        require('../../../Config/loggerConfig').error(`agent egress: ${name} of ${hostOf(url) || 'an unreadable URL'} refused, no workspace in the egress context`);
        throw Object.assign(new Error('this fetch names no workspace, so its egress allowlist cannot apply and it was refused — run it inside egressContext.run({ companyId, actor })'), { code: 'no_workspace' });
    }
    return pageAudit[name](url, ...rest);
};

module.exports = { fetchPage: inWorkspace('fetchPage'), audit: inWorkspace('audit'), postJson: inWorkspace('postJson') };
