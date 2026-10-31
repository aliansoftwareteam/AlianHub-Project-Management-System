const { tenantOf, TenantError } = require('../../Config/tenant');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const store = require('../../Config/secrets');
const logger = require('../../Config/loggerConfig');
const { requestAddress } = require('../../utils/requestAddress');
const flag = require('../Agents/connectors/flag');
const slack = require('../Agents/connectors/slackConnection');
const apps = require('./apps');

const refuse = (res, code, statusText, extra = {}) => res.status(code).send({ status: false, statusText, ...extra });

/* The tenant is the verified header, the role the live seat, and a token never manages a connector; only then
 * does the flag's own state matter, so a member learns nothing about whether the connector is set up. */
const managerOrRefuse = async (req, res, { whenOff } = {}) => {
    let companyId;
    try {
        companyId = tenantOf(req);
    } catch (error) {
        if (!(error instanceof TenantError)) throw error;
        refuse(res, error.statusCode, error.message);
        return '';
    }
    if (req.apiToken) { refuse(res, 403, 'An API token cannot manage connectors.'); return ''; }
    if (!isPrivileged(await getRoleType(companyId, req.uid))) { refuse(res, 403, 'Only an owner or admin can manage connectors.'); return ''; }
    const state = flag.status('slack');
    if (!state.requested) { refuse(res, 404, 'The Slack connector is off.'); return ''; }
    if (!state.on && whenOff) { whenOff(state); return ''; }
    if (!state.on) {
        refuse(res, 409, `The Slack connector stays off: ${state.problems.map((p) => p.text).join('; ')}.`, { problems: state.problems.map((p) => p.code) });
        return '';
    }
    return companyId;
};

const actorOf = (req) => ({ id: String(req.uid || ''), ip: requestAddress(req) });

/* Only the message of an error this module made itself is sent or logged; anything else is named by its type,
 * so a provider or transport error can never carry a request header into a response or a log line. */
const failed = (res, error, what) => {
    if (error instanceof slack.ConnectionError) return refuse(res, error.status, error.message, error.code ? { code: error.code } : {});
    if (error instanceof apps.AppError) return refuse(res, error.statusCode, error.message, error.code ? { code: error.code } : {});
    if (error instanceof store.SecretsStoreError) return refuse(res, error.statusCode, error.message);
    logger.error(`ERROR in ${what}: ${(error && error.name) || 'Error'}`);
    return refuse(res, 500, 'Something went wrong.');
};

const handle = (what, statusText, run, { answersWhenOff = false } = {}) => async (req, res) => {
    try {
        const whenOff = answersWhenOff ? (state) => res.send({ status: true, statusText, data: { on: false, problems: state.problems.map((p) => p.code) } }) : undefined;
        const companyId = await managerOrRefuse(req, res, { whenOff });
        if (!companyId) return undefined;
        return res.send({ status: true, statusText, data: await run(companyId, req) });
    } catch (error) {
        return failed(res, error, what);
    }
};

/* The one route that answers while the connector is named but off, so the screen can say why to an owner or admin. */
exports.getSlack = handle('get the Slack connector', 'Slack connector fetched.', async (companyId) => ({ on: true, problems: [], ...(await slack.describe(companyId)) }), { answersWhenOff: true });

exports.saveSlackSecrets = handle('save the Slack connector secrets', 'Slack connector saved.', (companyId, req) => {
    const body = req.body || {};
    return slack.saveSecrets(companyId, { botToken: body.botToken, signingSecret: body.signingSecret }, actorOf(req));
});

exports.removeSlackSecret = handle('remove a Slack connector secret', 'Removed.', (companyId, req) => slack.removeSecret(companyId, req.params.key, actorOf(req)));

exports.refreshSlackChannels = handle('refresh the Slack channel list', 'Channel list refreshed.', (companyId, req) => slack.refreshChannels(companyId, actorOf(req)));

exports.setSlackChannels = handle('set the Slack channel allow-list', 'Allowed channels saved.', (companyId, req) => {
    const body = req.body || {};
    return slack.setAllowedChannels(companyId, body.channels !== undefined ? body.channels : body.channelIds, actorOf(req));
});

/* A company's own OAuth app is not tied to one connector flag: an owner or admin sets it for any provider the
 * registry knows, and the handler's own validation refuses an unknown one. */
const managerForApps = async (req, res) => {
    let companyId;
    try {
        companyId = tenantOf(req);
    } catch (error) {
        if (!(error instanceof TenantError)) throw error;
        refuse(res, error.statusCode, error.message);
        return '';
    }
    if (req.apiToken) { refuse(res, 403, 'An API token cannot manage connectors.'); return ''; }
    if (!isPrivileged(await getRoleType(companyId, req.uid))) { refuse(res, 403, 'Only an owner or admin can manage connectors.'); return ''; }
    return companyId;
};

const handleApps = (what, statusText, run) => async (req, res) => {
    try {
        const companyId = await managerForApps(req, res);
        if (!companyId) return undefined;
        return res.send({ status: true, statusText, data: await run(companyId, req) });
    } catch (error) {
        return failed(res, error, what);
    }
};

exports.getApps = handleApps('list connector apps', 'Connector apps fetched.', (companyId) => apps.describeApps(companyId));

exports.setApp = handleApps('set a connector app', 'Connector app saved.', (companyId, req) => {
    const body = req.body || {};
    return apps.setApp({ companyId, provider: req.params.provider, clientId: body.clientId, clientSecret: body.clientSecret, extra: body.extra, actor: actorOf(req) });
});

exports.removeApp = handleApps('remove a connector app', 'Connector app removed.', (companyId, req) => apps.removeApp({ companyId, provider: req.params.provider, actor: actorOf(req) }));
