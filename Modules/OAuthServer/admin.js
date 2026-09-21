const { tenantOf, TenantError } = require('../../Config/tenant');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const { recordAudit } = require('../Audit/recorder');
const clients = require('./clients');
const grants = require('./grants');
const store = require('./store');
const logger = require('../../Config/loggerConfig');

const refuse = (res, code, statusText) => res.status(code).send({ status: false, statusText });

/* A pre-registered client belongs to the workspace that registered it, so it is managed the way the
 * workspace's other integrations are (webhooks, secrets, provider keys): an owner or admin of that
 * workspace, signed in, never an API token. */
const managerOrRefuse = async (req, res) => {
    let companyId;
    try {
        companyId = tenantOf(req);
    } catch (error) {
        if (!(error instanceof TenantError)) throw error;
        refuse(res, error.statusCode, error.message);
        return '';
    }
    if (req.apiToken) { refuse(res, 403, 'An API token cannot manage OAuth clients.'); return ''; }
    if (!isPrivileged(await getRoleType(companyId, req.uid))) { refuse(res, 403, 'Only an owner or admin can manage OAuth clients.'); return ''; }
    return companyId;
};

const actorOf = (req) => ({ id: String(req.uid || ''), ip: String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0] });

const audit = (companyId, req, action, client) => {
    const actor = actorOf(req);
    recordAudit(companyId, {
        actorId: actor.id,
        actorName: '',
        ...(actor.ip ? { ip: actor.ip } : {}),
        action,
        entityType: 'oauth_client',
        entityId: client.clientId,
        entityName: client.name,
        meta: { redirectUris: client.redirectUris, tokenEndpointAuthMethod: client.tokenEndpointAuthMethod, scopes: client.scopes || [] },
    });
};

const failed = (res, error, what) => {
    if (error instanceof clients.ClientError) return refuse(res, 400, error.message);
    logger.error(`ERROR in ${what}: ${error.message}`);
    return refuse(res, 500, 'Something went wrong.');
};

exports.list = async (req, res) => {
    try {
        const companyId = await managerOrRefuse(req, res);
        if (!companyId) return undefined;
        const data = (await store.clients.listFor(companyId)).map(clients.publicView);
        return res.send({ status: true, statusText: 'OAuth clients fetched.', data });
    } catch (error) {
        return failed(res, error, 'list oauth clients');
    }
};

// The secret is in this one response and nowhere else: only its hash is kept.
exports.create = async (req, res) => {
    try {
        const companyId = await managerOrRefuse(req, res);
        if (!companyId) return undefined;
        const body = req.body || {};
        const { client, secret } = await clients.register({
            kind: 'preregistered',
            name: body.name,
            redirectUris: body.redirectUris,
            tokenEndpointAuthMethod: body.tokenEndpointAuthMethod,
            scopes: body.scopes,
            companyId,
            createdBy: req.uid,
        });
        audit(companyId, req, 'oauth.client_registered', client);
        return res.status(201).send({ status: true, statusText: 'OAuth client registered.', data: { ...clients.publicView(client), ...(secret ? { clientSecret: secret } : {}) } });
    } catch (error) {
        return failed(res, error, 'register oauth client');
    }
};

exports.revoke = async (req, res) => {
    try {
        const companyId = await managerOrRefuse(req, res);
        if (!companyId) return undefined;
        const now = new Date();
        const client = await store.clients.revoke({ clientId: req.params.clientId, companyId, by: req.uid, at: now });
        if (!client) return refuse(res, 404, 'No such OAuth client in this workspace.');
        await grants.revokeClientGrants(client.clientId, now);
        audit(companyId, req, 'oauth.client_revoked', client);
        return res.send({ status: true, statusText: 'OAuth client revoked.', data: clients.publicView({ ...client, revokedAt: now }) });
    } catch (error) {
        return failed(res, error, 'revoke oauth client');
    }
};
