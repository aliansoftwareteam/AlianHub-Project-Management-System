const { tenantOf, TenantError } = require('../../Config/tenant');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const store = require('../../Config/secrets');
const keys = require('../AICore/providerKeys');
const providerContext = require('../AICore/providerContext');
const logger = require('../../Config/loggerConfig');

const refuse = (res, code, statusText) => res.status(code).send({ status: false, statusText });

/* Owners and admins only, never an API token; only then the flags, so a
 * member learns nothing about the store. The list is what the settings
 * screen probes on every load, so a flag-off store answers it with 200 and
 * status false instead of a console-filling 404. */
const managerOrRefuse = async (req, res, { probe = false } = {}) => {
    let companyId;
    try {
        companyId = tenantOf(req);
    } catch (error) {
        if (!(error instanceof TenantError)) throw error;
        refuse(res, error.statusCode, error.message);
        return '';
    }
    if (req.apiToken) { refuse(res, 403, 'An API token cannot manage provider keys.'); return ''; }
    if (!isPrivileged(await getRoleType(companyId, req.uid))) { refuse(res, 403, 'Only an owner or admin can manage provider keys.'); return ''; }
    if (!providerContext.flagOn()) {
        if (probe) { res.send({ status: false, statusText: 'Workspace provider keys are off.', storeOff: true }); return ''; }
        refuse(res, 404, 'Workspace provider keys are off.');
        return '';
    }
    const cfg = store.config();
    if (!cfg.requested) { refuse(res, 404, 'The secrets store is off.'); return ''; }
    if (!cfg.keyValid) { refuse(res, 503, cfg.error); return ''; }
    return companyId;
};

const actorOf = (req) => ({ id: String(req.uid || ''), ip: String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0] });

const failed = (res, error, what) => {
    if (error instanceof store.SecretsStoreError) return refuse(res, error.statusCode, error.message);
    logger.error(`ERROR in ${what}: ${error.message}`);
    return refuse(res, 500, 'Something went wrong.');
};

exports.listProviderKeys = async (req, res) => {
    try {
        const companyId = await managerOrRefuse(req, res, { probe: true });
        if (!companyId) return undefined;
        const data = await keys.listKeys({ companyId });
        return res.send({ status: true, statusText: 'Provider keys fetched.', data });
    } catch (error) {
        return failed(res, error, 'list provider keys');
    }
};

exports.setProviderKey = async (req, res) => {
    try {
        const companyId = await managerOrRefuse(req, res);
        if (!companyId) return undefined;
        const value = req.body && req.body.value;
        if (typeof value !== 'string' || !value.trim()) return refuse(res, 400, 'A new value is required.');
        const data = await keys.setKey({ companyId, provider: req.params.provider, value, actor: actorOf(req) });
        return res.send({ status: true, statusText: 'Provider key saved.', data });
    } catch (error) {
        return failed(res, error, 'set provider key');
    }
};

exports.clearProviderKey = async (req, res) => {
    try {
        const companyId = await managerOrRefuse(req, res);
        if (!companyId) return undefined;
        const data = await keys.clearKey({ companyId, provider: req.params.provider, actor: actorOf(req) });
        return res.send({ status: true, statusText: 'Provider key cleared.', data });
    } catch (error) {
        return failed(res, error, 'clear provider key');
    }
};
