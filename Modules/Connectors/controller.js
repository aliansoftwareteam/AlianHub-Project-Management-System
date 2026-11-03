const { tenantOf, TenantError } = require('../../Config/tenant');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const store = require('../../Config/secrets');
const logger = require('../../Config/loggerConfig');
const { requestAddress } = require('../../utils/requestAddress');
const quotas = require('./quotas');
const apps = require('./apps');
const registry = require('./registry');
const connection = require('./connection');
const flag = require('../Agents/connectors/flag');

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

/* The providers a company app can be set for, with the display name, whether the instance already has an app,
 * whether this company has set one, and the exact redirect URI to register at the provider. Read-only: the screen
 * (072) cannot be drawn without it, and no write path reads it. */
const appCatalog = (configured) => {
    const set = new Set(configured.map((app) => app.provider));
    return registry.list()
        .filter((definition) => flag.named().includes(definition.id))
        .map((definition) => ({
            provider: definition.id,
            name: definition.name,
            hasInstanceApp: Boolean(apps.instanceApp(definition.id)),
            companyAppSet: set.has(definition.id),
            redirectUri: connection.redirectUri(definition.id),
        }));
};

exports.getApps = handleApps('list connector apps', 'Connector apps fetched.', async (companyId) => {
    const configured = await apps.describeApps(companyId);
    return { apps: configured, catalog: appCatalog(configured) };
});

exports.setApp = handleApps('set a connector app', 'Connector app saved.', (companyId, req) => {
    const body = req.body || {};
    return apps.setApp({ companyId, provider: req.params.provider, clientId: body.clientId, clientSecret: body.clientSecret, extra: body.extra, actor: actorOf(req) });
});

exports.removeApp = handleApps('remove a connector app', 'Connector app removed.', (companyId, req) => apps.removeApp({ companyId, provider: req.params.provider, actor: actorOf(req) }));
