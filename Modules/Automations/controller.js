const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../utils/commonFunctions');
const logger = require('../../Config/loggerConfig');
const R = require('./helpers/automationRules');
const registry = require('./engine/registry');
const matcher = require('./engine/matcher');
const V2 = require('./helpers/ruleSchemaV2');

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
        matcher.invalidate(companyId);
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
        matcher.invalidate(companyId);
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
        matcher.invalidate(companyId);
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

// GET /api/v2/automations/registry
//
// The builder UI renders itself from this. Shipping a new action must stay "one
// file in engine/actions + one line in the registry, zero frontend changes" —
// the moment an action needs a hand-written Vue form, the action library stops
// growing.
exports.getRegistry = async (req, res) => {
    try {
        return res.send({ status: true, data: registry.manifest() });
    } catch (e) {
        logger.error(`getRegistry: ${e.message}`);
        return res.send({ status: false, statusText: e.message });
    }
};

// ---------------------------------------------------------------------------
// v2 rules — event-triggered, multi-step. The v1 endpoints stay exactly as they
// are: they still serve rules created before this existed, and the on-demand
// bulk `apply` has no v2 equivalent.
// ---------------------------------------------------------------------------

const v2Summary = (r) => {
    const raw = r.toObject ? r.toObject() : r;
    return { ...raw, summary: V2.describeV2(raw) };
};

// GET /api/v2/automations
exports.listRulesV2 = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AUTOMATION_RULES,
            data: [{ deletedStatusKey: { $ne: 1 }, version: 2 }, {}, { sort: { updatedAt: -1 } }],
        }, 'find');
        return res.send({ status: true, data: (rows || []).map(v2Summary) });
    } catch (e) { logger.error(`listRulesV2: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

// POST /api/v2/automations
exports.createRuleV2 = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        const check = V2.validateRuleV2(req.body || {});
        if (!check.valid) return res.send({ status: false, statusText: check.errors[0], errors: check.errors });

        // New rules start disabled. A rule that begins mutating tasks the instant
        // it is saved gives the author no chance to look at it first.
        const data = {
            _id: new mongoose.Types.ObjectId(), ...check.value,
            enabled: req.body.enabled === true,
            createdBy: String(req.uid || ''), lastRunCount: 0, deletedStatusKey: 0,
        };
        const saved = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AUTOMATION_RULES, data }, 'save');
        matcher.invalidate(companyId);
        return res.send({ status: true, statusText: 'Automation created.', data: v2Summary(saved) });
    } catch (e) { logger.error(`createRuleV2: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

// PUT /api/v2/automations/:id
exports.updateRuleV2 = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const id = oid(req.params.id);
        if (!companyId || !id) return res.send({ status: false, statusText: 'companyId and a valid id are required.' });
        const check = V2.validateRuleV2(req.body || {});
        if (!check.valid) return res.send({ status: false, statusText: check.errors[0], errors: check.errors });

        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AUTOMATION_RULES,
            data: [{ _id: id }, { $set: check.value }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        matcher.invalidate(companyId);
        return res.send({ status: true, statusText: 'Automation updated.', data: updated ? v2Summary(updated) : null });
    } catch (e) { logger.error(`updateRuleV2: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

// PATCH /api/v2/automations/:id/enabled
//
// Its own endpoint rather than a full save: the list screen toggles rules, and
// making that round-trip the whole document means a stale list can silently
// revert an edit made in another tab.
exports.setRuleEnabled = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const id = oid(req.params.id);
        if (!companyId || !id) return res.send({ status: false, statusText: 'companyId and a valid id are required.' });
        const enabled = req.body && req.body.enabled === true;
        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AUTOMATION_RULES,
            data: [{ _id: id }, { $set: { enabled } }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        matcher.invalidate(companyId);
        return res.send({ status: true, statusText: enabled ? 'Automation on.' : 'Automation off.', data: updated ? v2Summary(updated) : null });
    } catch (e) { logger.error(`setRuleEnabled: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

// GET /api/v2/automations/:id/runs
exports.listRuns = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const id = req.params.id;
        if (!companyId || !id) return res.send({ status: false, statusText: 'companyId and id are required.' });
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AUTOMATION_RUNS,
            data: [{ ruleId: String(id) }, {}, { sort: { startedAt: -1 }, limit: 50 }],
        }, 'find');
        return res.send({ status: true, data: rows || [] });
    } catch (e) { logger.error(`listRuns: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};
