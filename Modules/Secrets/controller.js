const { tenantOf, TenantError } = require('../../Config/tenant');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const store = require('../../Config/secrets');
const logger = require('../../Config/loggerConfig');
const { rotateProblem } = require('./helpers/rotateRules');
const externalReads = require('../Agents/skills/externalReads');

const refuse = (res, code, statusText) => res.status(code).send({ status: false, statusText });

/* The tenant is the verified header, the role the live seat, and a token never manages secrets; only then
 * does the store's own state matter, so a member learns nothing about whether it is on. The list is what the
 * Integrations screen probes on every load for an owner or admin, so an off store answers it with 200 and
 * status false: a 404 there is a console error in the browser of every default install. */
const managerOrRefuse = async (req, res, { probe = false } = {}) => {
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
    if (!cfg.requested && probe) { res.send({ status: false, statusText: 'The secrets store is off.', storeOff: true }); return ''; }
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
        const companyId = await managerOrRefuse(req, res, { probe: true });
        if (!companyId) return undefined;
        const data = await store.list({ companyId });
        return res.send({ status: true, statusText: 'Secrets fetched.', data, keyId: store.config().keyId, skillReads: externalReads.enabled() });
    } catch (error) {
        return failed(res, error, 'list secrets');
    }
};

/* Only a skill's read credential is made here: integration and webhook secrets are made by the connection
 * that holds them. */
exports.createSecret = async (req, res) => {
    try {
        const companyId = await managerOrRefuse(req, res);
        if (!companyId) return undefined;
        if (!externalReads.enabled()) return refuse(res, 404, 'Read credentials are not available on this server.');
        const body = req.body || {};
        if (body.kind !== store.READ_KIND) return refuse(res, 400, `Only a ${store.READ_KIND} secret can be created here.`);
        if (typeof body.value !== 'string' || !body.value.trim()) return refuse(res, 400, 'A value is required.');
        const data = await store.create({ companyId, name: body.name, kind: body.kind, value: body.value, hosts: body.hosts, header: body.header, actor: actorOf(req) });
        return res.status(201).send({ status: true, statusText: 'Secret created.', data });
    } catch (error) {
        return failed(res, error, 'create secret');
    }
};

exports.rotateSecret = async (req, res) => {
    try {
        const companyId = await managerOrRefuse(req, res);
        if (!companyId) return undefined;
        const body = req.body || {};
        const { value } = body;
        if (typeof value !== 'string' || !value.trim()) return refuse(res, 400, 'A new value is required.');
        const binding = body.hosts !== undefined || body.header !== undefined;
        if (binding && !externalReads.enabled()) return refuse(res, 400, 'Read credentials are not available on this server, so no hosts can be set.');
        const secret = await store.describe({ companyId, handle: req.params.handle });
        const problem = await rotateProblem({ companyId, secret, value });
        if (problem) return refuse(res, problem.statusCode, problem.message);
        const data = await store.rotate({ companyId, handle: req.params.handle, value, hosts: body.hosts, header: body.header, actor: actorOf(req) });
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
