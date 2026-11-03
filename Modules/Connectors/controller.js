const { tenantOf, TenantError } = require('../../Config/tenant');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const store = require('../../Config/secrets');
const logger = require('../../Config/loggerConfig');
const { requestAddress } = require('../../utils/requestAddress');
const quotas = require('./quotas');
const apps = require('./apps');

const refuse = (res, code, statusText, extra = {}) => res.status(code).send({ status: false, statusText, ...extra });

const actorOf = (req) => ({ id: String(req.uid || ''), ip: requestAddress(req) });

/* Only the message of an error this module made itself is sent or logged; anything else is named by its type,
 * so a provider or transport error can never carry a request header into a response or a log line. */
const failed = (res, error, what) => {
    if (error instanceof apps.AppError) return refuse(res, error.statusCode, error.message, error.code ? { code: error.code } : {});
    if (error instanceof store.SecretsStoreError) return refuse(res, error.statusCode, error.message);
    logger.error(`ERROR in ${what}: ${(error && error.name) || 'Error'}`);
    return refuse(res, 500, 'Something went wrong.');
};

const handleQuotas = (what, statusText, run) => async (req, res) => {
    try {
        const companyId = tenantOf(req);
        if (req.apiToken) return refuse(res, 403, 'An API token cannot manage connectors.');
        if (!isPrivileged(await getRoleType(companyId, req.uid))) return refuse(res, 403, 'Only an owner or admin can manage connectors.');
        return res.send({ status: true, statusText, data: await run(companyId, req) });
    } catch (error) {
        if (error instanceof TenantError) return refuse(res, error.statusCode, error.message);
        if (error && error.expose) return refuse(res, error.status, error.message);
        return failed(res, error, what);
    }
};

exports.getQuotas = handleQuotas('read the connector limits', 'Limits fetched.', (companyId) => quotas.overview(companyId));

exports.setQuotas = handleQuotas('set the connector limits', 'Limits saved.', (companyId, req) => quotas.set(companyId, req.body || {}, actorOf(req)));

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
