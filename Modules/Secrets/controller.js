const { tenantOf, TenantError } = require('../../Config/tenant');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const store = require('../../Config/secrets');
const logger = require('../../Config/loggerConfig');

const refuse = (res, code, statusText) => res.status(code).send({ status: false, statusText });

/* The tenant is the verified header, the role the live seat, and a token never manages secrets; only then
 * does the store's own state matter, so a member learns nothing about whether it is on. */
const managerOrRefuse = async (req, res) => {
    let companyId;
    try {
        companyId = tenantOf(req);
    } catch (error) {
        if (!(error instanceof TenantError)) throw error;
        refuse(res, error.statusCode, error.message);
        return '';
    }
    if (req.apiToken) { refuse(res, 403, 'An API token cannot manage secrets.'); return ''; }
    if (!isPrivileged(await getRoleType(companyId, req.uid))) { refuse(res, 403, 'Only an owner or admin can manage secrets.'); return ''; }
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

exports.listSecrets = async (req, res) => {
    try {
        const companyId = await managerOrRefuse(req, res);
        if (!companyId) return undefined;
        const data = await store.list({ companyId });
        return res.send({ status: true, statusText: 'Secrets fetched.', data, keyId: store.config().keyId });
    } catch (error) {
        return failed(res, error, 'list secrets');
    }
};

exports.rotateSecret = async (req, res) => {
    try {
        const companyId = await managerOrRefuse(req, res);
        if (!companyId) return undefined;
        const value = req.body && req.body.value;
        if (typeof value !== 'string' || !value.trim()) return refuse(res, 400, 'A new value is required.');
        const data = await store.rotate({ companyId, handle: req.params.handle, value, actor: actorOf(req) });
        return res.send({ status: true, statusText: 'Secret rotated.', data });
    } catch (error) {
        return failed(res, error, 'rotate secret');
    }
};

exports.revokeSecret = async (req, res) => {
    try {
        const companyId = await managerOrRefuse(req, res);
        if (!companyId) return undefined;
        const data = await store.revoke({ companyId, handle: req.params.handle, actor: actorOf(req) });
        return res.send({ status: true, statusText: 'Secret revoked.', data });
    } catch (error) {
        return failed(res, error, 'revoke secret');
    }
};
