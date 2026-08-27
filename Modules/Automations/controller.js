const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../utils/commonFunctions');
const logger = require('../../Config/loggerConfig');
const R = require('./helpers/automationRules');

// AUTO-03 — automation rules. companyId-scoped. Apply is on-demand (a safe bulk
// update of matching tasks); event-triggered execution is stored on the rule but
// not wired into core task-event flows (documented extension) so automations can
// never disrupt live task mutations.

const companyOf = (req) => req.headers['companyid'] || (req.body && req.body.companyId) || (req.query && req.query.companyId);
const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };

// POST /api/v1/automations
exports.createRule = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        const check = R.validateRule(req.body || {});
        if (!check.valid) return res.send({ status: false, statusText: check.errors.join('; ') });
        const data = { _id: new mongoose.Types.ObjectId(), ...check.value, enabled: true, lastRunCount: 0, createdBy: String(req.uid || ''), deletedStatusKey: 0 };
        const saved = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AUTOMATION_RULES, data }, 'save');
        removeCache(`automation_rules:${companyId}`);
        return res.send({ status: true, statusText: 'Automation created.', data: saved });
    } catch (e) { logger.error(`createRule: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

// GET /api/v1/automations
exports.listRules = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AUTOMATION_RULES, data: [{ deletedStatusKey: { $ne: 1 } }, {}, { sort: { updatedAt: -1 } }],
        }, 'find');
        return res.send({ status: true, data: (rows || []).map((r) => ({ ...(r.toObject ? r.toObject() : r), summary: R.describe(r) })) });
    } catch (e) { logger.error(`listRules: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

// PUT /api/v1/automations/:id
exports.updateRule = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        const set = {};
        if (req.body.enabled !== undefined) set.enabled = !!req.body.enabled;
        if (['name', 'conditions', 'actions', 'trigger'].some((k) => req.body[k] !== undefined)) {
            const check = R.validateRule(req.body || {});
            if (!check.valid) return res.send({ status: false, statusText: check.errors.join('; ') });
            Object.assign(set, check.value);
        }
        if (!Object.keys(set).length) return res.send({ status: false, statusText: 'Nothing to update.' });
        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AUTOMATION_RULES, data: [{ _id: oid(req.params.id) }, { $set: set }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        if (!updated) return res.send({ status: false, statusText: 'Not found.' });
        removeCache(`automation_rules:${companyId}`);
        return res.send({ status: true, statusText: 'Automation updated.', data: updated });
    } catch (e) { logger.error(`updateRule: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

// DELETE /api/v1/automations/:id
exports.deleteRule = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AUTOMATION_RULES, data: [{ _id: oid(req.params.id) }, { $set: { deletedStatusKey: 1, enabled: false } }],
        }, 'updateOne');
        removeCache(`automation_rules:${companyId}`);
        return res.send({ status: true, statusText: 'Automation removed.' });
    } catch (e) { logger.error(`deleteRule: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

// POST /api/v1/automations/preview  { conditions } — count + sample matching tasks (no mutation).
exports.preview = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        const conditions = (req.body && req.body.conditions) || {};
        const match = R.buildMatch(conditions, oid);
        const tasks = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [match, 'TaskName TaskKey Task_Priority', { limit: 10 }] }, 'find');
        const count = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [match] }, 'countDocuments').catch(() => null);
        return res.send({
            status: true,
            data: {
                count: (typeof count === 'number') ? count : (tasks || []).length,
                sample: (tasks || []).map((t) => ({ id: t._id, name: t.TaskName, key: t.TaskKey, priority: t.Task_Priority })),
            },
        });
    } catch (e) { logger.error(`preview: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

// POST /api/v1/automations/:id/apply — apply the rule's actions to matching tasks now.
exports.applyRule = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        const rule = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AUTOMATION_RULES, data: [{ _id: oid(req.params.id) }] }, 'findOne');
        if (!rule || rule.deletedStatusKey === 1) return res.send({ status: false, statusText: 'Not found.' });
        const match = R.buildMatch(rule.conditions || {}, oid);
        const pr = (rule.actions || []).find((a) => a.type === 'set_priority');
        let modified = 0;
        if (pr) {
            const r = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [match, { $set: { Task_Priority: pr.value } }] }, 'updateMany');
            modified = (r && (r.modifiedCount != null ? r.modifiedCount : r.nModified)) || 0;
        }
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AUTOMATION_RULES, data: [{ _id: oid(req.params.id) }, { $set: { lastRunAt: new Date(), lastRunCount: modified } }],
        }, 'updateOne').catch(() => {});
        return res.send({ status: true, statusText: `Applied to ${modified} task(s).`, data: { modified } });
    } catch (e) { logger.error(`applyRule: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

// GET /api/v1/automations/writeback — per-project agent write-back switches (default on).
exports.listWriteback = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PROJECTS,
            data: [{ deletedStatusKey: { $ne: 1 }, status: { $ne: 'close' } }, 'ProjectName aiWritebackEnabled', { sort: { ProjectName: 1 } }],
        }, 'find');
        const data = (rows || []).map((row) => {
            const plain = row && row.toObject ? row.toObject() : row;
            return {
                _id: plain._id,
                ProjectName: plain.ProjectName || '',
                enabled: plain.aiWritebackEnabled !== false,
            };
        });
        return res.send({ status: true, data });
    } catch (e) { logger.error(`listWriteback: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

// PUT /api/v1/automations/writeback/:projectId  { enabled }
exports.setWriteback = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const projectId = oid(req.params.projectId);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        if (!projectId) return res.send({ status: false, statusText: 'A valid project id is required.' });
        const enabled = req.body && req.body.enabled !== false && req.body.enabled !== 'false';
        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PROJECTS,
            data: [
                { _id: projectId, deletedStatusKey: { $ne: 1 } },
                { $set: { aiWritebackEnabled: enabled } },
                { returnDocument: 'after' },
            ],
        }, 'findOneAndUpdate');
        if (!updated) return res.send({ status: false, statusText: 'Not found.' });
        removeCache('UserProjectData:', true);
        return res.send({
            status: true,
            statusText: enabled ? 'Write-back on for this project.' : 'Write-back off for this project.',
            data: {
                _id: updated._id,
                ProjectName: updated.ProjectName || '',
                enabled: updated.aiWritebackEnabled !== false,
            },
        });
    } catch (e) { logger.error(`setWriteback: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};
