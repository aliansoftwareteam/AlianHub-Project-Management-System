const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../utils/commonFunctions');
const logger = require('../../Config/loggerConfig');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const R = require('./helpers/integrationsRules');
const S = require('./helpers/slackRules');

// Secrets are sealed on every write (R.sealConfig) and stripped from every read (R.redact).

const OBJECT_ID = /^[a-f0-9]{24}$/i;

const companyOf = (req) => req.headers['companyid'] || (req.body && req.body.companyId) || (req.query && req.query.companyId);
const oid = (id) => (OBJECT_ID.test(String(id || '')) ? new mongoose.Types.ObjectId(String(id)) : null);

const refuse = (res, code, statusText, extra = {}) => res.status(code).send({ status: false, statusText, message: statusText, ...extra });

// Integrations hold company-wide credentials and data egress, so every write is
// an owner or admin act; the role is read from company_users, never the body.
const managerOrRefuse = async (req, res) => {
    const companyId = companyOf(req);
    if (!companyId) { refuse(res, 400, 'companyId is required.'); return null; }
    if (isPrivileged(await getRoleType(companyId, req.uid))) return companyId;
    refuse(res, 403, 'Only an owner or admin can manage integrations.');
    return null;
};

exports.listCatalog = async (req, res) => {
    try { return res.send({ status: true, data: R.getCatalog() }); }
    catch (e) { logger.error(`listCatalog: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

exports.listConnections = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return refuse(res, 400, 'companyId is required.');
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.INTEGRATION_CONNECTIONS, data: [{ deletedStatusKey: { $ne: 1 } }, {}, { sort: { updatedAt: -1 } }],
        }, 'find');
        return res.send({ status: true, data: (rows || []).map(R.redact) });
    } catch (e) { logger.error(`listConnections: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

exports.connect = async (req, res) => {
    try {
        const companyId = await managerOrRefuse(req, res);
        if (!companyId) return undefined;
        const check = R.validateConnection(req.body || {});
        if (!check.valid) return refuse(res, 400, check.reason, { field: check.field });
        const item = R.byKey(check.value.type);
        const config = R.sealConfig(check.value.type, check.value.config);
        if (item && !item.multiple) {
            const existing = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.INTEGRATION_CONNECTIONS, data: [{ type: check.value.type, deletedStatusKey: { $ne: 1 } }],
            }, 'findOne');
            if (existing) {
                const upd = await MongoDbCrudOpration(companyId, {
                    type: SCHEMA_TYPE.INTEGRATION_CONNECTIONS,
                    data: [{ _id: existing._id }, { $set: { config, name: check.value.name, status: 'connected', enabled: true, secretsVersion: R.SECRETS_VERSION, updatedBy: String(req.uid || '') } }, { returnDocument: 'after' }],
                }, 'findOneAndUpdate');
                removeCache(`integration_connections:${companyId}`);
                return res.send({ status: true, statusText: 'Updated.', data: R.redact(upd) });
            }
        }
        const data = {
            _id: new mongoose.Types.ObjectId(), type: check.value.type, name: check.value.name, config, secretsVersion: R.SECRETS_VERSION,
            status: 'connected', enabled: true, createdBy: String(req.uid || ''), connectedAt: new Date(), deletedStatusKey: 0,
        };
        const saved = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.INTEGRATION_CONNECTIONS, data }, 'save');
        removeCache(`integration_connections:${companyId}`);
        return res.send({ status: true, statusText: 'Connected.', data: R.redact(saved) });
    } catch (e) { logger.error(`connect: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

exports.updateConnection = async (req, res) => {
    try {
        const companyId = await managerOrRefuse(req, res);
        if (!companyId) return undefined;
        const _id = oid(req.params.id);
        if (!_id) return refuse(res, 400, 'A valid connection id is required.');
        const set = {};
        if (req.body.enabled !== undefined) set.enabled = !!req.body.enabled;
        if (!Object.keys(set).length) return refuse(res, 400, 'Nothing to update.');
        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.INTEGRATION_CONNECTIONS,
            data: [{ _id, deletedStatusKey: { $ne: 1 } }, { $set: { ...set, updatedBy: String(req.uid || '') } }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        if (!updated) return refuse(res, 404, 'Not found.');
        removeCache(`integration_connections:${companyId}`);
        return res.send({ status: true, statusText: 'Updated.', data: R.redact(updated) });
    } catch (e) { logger.error(`updateConnection: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

exports.disconnect = async (req, res) => {
    try {
        const companyId = await managerOrRefuse(req, res);
        if (!companyId) return undefined;
        const _id = oid(req.params.id);
        if (!_id) return refuse(res, 400, 'A valid connection id is required.');
        const removed = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.INTEGRATION_CONNECTIONS,
            data: [{ _id, deletedStatusKey: { $ne: 1 } }, { $set: { deletedStatusKey: 1, enabled: false, status: 'disconnected', updatedBy: String(req.uid || '') } }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        if (!removed) return refuse(res, 404, 'Not found.');
        removeCache(`integration_connections:${companyId}`);
        return res.send({ status: true, statusText: 'Disconnected.' });
    } catch (e) { logger.error(`disconnect: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

// Public route: authenticated by the per-workspace Slack verification token, not a JWT.
exports.slackCommand = async (req, res) => {
    try {
        const companyId = String(req.params.companyId || '');
        if (!companyId) return res.json(S.ephemeral('Missing workspace id.'));
        const conn = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.INTEGRATION_CONNECTIONS, data: [{ type: 'slack', deletedStatusKey: { $ne: 1 } }],
        }, 'findOne').catch(() => null);
        const verificationToken = conn && conn.config ? R.openConfig('slack', conn.config).verification_token : null;
        if (!conn || conn.enabled === false || !verificationToken) {
            return res.json(S.ephemeral('Slack isn’t connected for this workspace yet — add it in AlianHub → Integrations → Marketplace.'));
        }
        if (!S.verifyToken(verificationToken, req.body && req.body.token)) {
            return res.status(401).json(S.ephemeral('Verification failed.'));
        }
        const { sub } = S.parseCommand(req.body && req.body.text);
        if (sub === 'projects') {
            const projects = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: [{}, 'ProjectName', { limit: 50 }] }, 'find').catch(() => []);
            return res.json(S.ephemeral(S.projectsText((projects || []).map((p) => p.ProjectName).filter(Boolean))));
        }
        return res.json(S.ephemeral(S.helpText()));
    } catch (e) { logger.error(`slackCommand: ${e.message}`); return res.json(S.ephemeral('Something went wrong.')); }
};
