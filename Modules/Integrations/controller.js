const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../utils/commonFunctions');
const logger = require('../../Config/loggerConfig');
const R = require('./helpers/integrationsRules');
const S = require('./helpers/slackRules'); // AUTO-06

// AUTO-04 — generic integration connections registry (per-company). Backs the
// marketplace (AUTO-05), Slack (AUTO-06) and custom iframe apps (AUTO-07).
// Secrets are stored in config but never returned (redact()).

const companyOf = (req) => req.headers['companyid'] || (req.body && req.body.companyId) || (req.query && req.query.companyId);
const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };

// GET /api/v1/integrations/catalog — static list of connectable integrations.
exports.listCatalog = async (req, res) => {
    try { return res.send({ status: true, data: R.getCatalog() }); }
    catch (e) { logger.error(`listCatalog: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

// GET /api/v1/integrations/connections — this company's connections (secrets redacted).
exports.listConnections = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.INTEGRATION_CONNECTIONS, data: [{ deletedStatusKey: { $ne: 1 } }, {}, { sort: { updatedAt: -1 } }],
        }, 'find');
        return res.send({ status: true, data: (rows || []).map(R.redact) });
    } catch (e) { logger.error(`listConnections: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

// POST /api/v1/integrations/connections  { type, config }
exports.connect = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        const check = R.validateConnection(req.body || {});
        if (!check.valid) return res.send({ status: false, statusText: check.reason });
        const item = R.byKey(check.value.type);
        // Single-instance integrations update in place rather than duplicate.
        if (item && !item.multiple) {
            const existing = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.INTEGRATION_CONNECTIONS, data: [{ type: check.value.type, deletedStatusKey: { $ne: 1 } }],
            }, 'findOne');
            if (existing) {
                const upd = await MongoDbCrudOpration(companyId, {
                    type: SCHEMA_TYPE.INTEGRATION_CONNECTIONS,
                    data: [{ _id: existing._id }, { $set: { config: check.value.config, name: check.value.name, status: 'connected', enabled: true } }, { returnDocument: 'after' }],
                }, 'findOneAndUpdate');
                removeCache(`integration_connections:${companyId}`);
                return res.send({ status: true, statusText: 'Updated.', data: R.redact(upd) });
            }
        }
        const data = {
            _id: new mongoose.Types.ObjectId(), type: check.value.type, name: check.value.name, config: check.value.config,
            status: 'connected', enabled: true, createdBy: String(req.uid || ''), connectedAt: new Date(), deletedStatusKey: 0,
        };
        const saved = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.INTEGRATION_CONNECTIONS, data }, 'save');
        removeCache(`integration_connections:${companyId}`);
        return res.send({ status: true, statusText: 'Connected.', data: R.redact(saved) });
    } catch (e) { logger.error(`connect: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

// PUT /api/v1/integrations/connections/:id  { enabled }
exports.updateConnection = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        const set = {};
        if (req.body.enabled !== undefined) set.enabled = !!req.body.enabled;
        if (!Object.keys(set).length) return res.send({ status: false, statusText: 'Nothing to update.' });
        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.INTEGRATION_CONNECTIONS, data: [{ _id: oid(req.params.id) }, { $set: set }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        if (!updated) return res.send({ status: false, statusText: 'Not found.' });
        removeCache(`integration_connections:${companyId}`);
        return res.send({ status: true, statusText: 'Updated.', data: R.redact(updated) });
    } catch (e) { logger.error(`updateConnection: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

// DELETE /api/v1/integrations/connections/:id — disconnect (soft delete).
exports.disconnect = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.INTEGRATION_CONNECTIONS, data: [{ _id: oid(req.params.id) }, { $set: { deletedStatusKey: 1, enabled: false, status: 'disconnected' } }],
        }, 'updateOne');
        removeCache(`integration_connections:${companyId}`);
        return res.send({ status: true, statusText: 'Disconnected.' });
    } catch (e) { logger.error(`disconnect: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

// POST /api/v1/slack/command/:companyId — PUBLIC Slack slash-command handler.
// Authenticated by the per-workspace verification token on the slack connection.
// Read-only commands (help, projects); always replies with an ephemeral message.
exports.slackCommand = async (req, res) => {
    try {
        const companyId = String(req.params.companyId || '');
        if (!companyId) return res.json(S.ephemeral('Missing workspace id.'));
        const conn = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.INTEGRATION_CONNECTIONS, data: [{ type: 'slack', deletedStatusKey: { $ne: 1 } }],
        }, 'findOne').catch(() => null);
        if (!conn || conn.enabled === false || !conn.config || !conn.config.verification_token) {
            return res.json(S.ephemeral('Slack isn’t connected for this workspace yet — add it in AlianHub → Integrations → Marketplace.'));
        }
        if (!S.verifyToken(conn.config.verification_token, req.body && req.body.token)) {
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
