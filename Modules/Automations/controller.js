const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../utils/commonFunctions');
const logger = require('../../Config/loggerConfig');
const R = require('./helpers/automationRules');
const registry = require('./engine/registry');
const matcher = require('./engine/matcher');
const { updateTask } = require('./engine/tools');
const V2 = require('./helpers/ruleSchemaV2');
const { escapeRegex } = require('../../utils/escapeRegex');
const sentences = require('./helpers/sentenceRules');
const access = require('./helpers/ruleAccess');
const { canEditProject } = require('../AIProjectGenerator/projectAccess');

const NOT_FOUND = 'Not found.';
const APPLY_REFUSED = 'You cannot edit every task this automation targets.';
const V2_NOT_APPLIABLE = 'This automation runs on events and cannot be applied in bulk.';

const companyOf = (req) => req.headers['companyid'];
const oid = (id) => (/^[0-9a-fA-F]{24}$/.test(String(id || '')) ? new mongoose.Types.ObjectId(String(id)) : null);
const refuse = (res, code, statusText) => res.status(code).send({ status: false, statusText });

const rulesChanged = (companyId) => {
    removeCache(`automation_rules:${companyId}`);
    matcher.invalidate(companyId);
};

const findLiveRule = (companyId, id) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.AUTOMATION_RULES, data: [{ _id: id, deletedStatusKey: { $ne: 1 } }],
}, 'findOne');

/* Loads the rule and runs the management check on it. Answers the response itself
 * and returns null when the caller may not touch it. */
const ruleForWrite = async (req, res, companyId, extraRule) => {
    const id = oid(req.params.id);
    if (!id) { refuse(res, 404, NOT_FOUND); return null; }
    if (!(await access.canManageRules(companyId, req.uid))) { refuse(res, 403, access.MANAGE_REFUSED); return null; }
    const rule = await findLiveRule(companyId, id);
    if (!rule) { refuse(res, 404, NOT_FOUND); return null; }
    for (const candidate of [rule, extraRule].filter(Boolean)) {
        const denied = await access.refuseRuleWrite({ companyId, uid: req.uid, rule: candidate });
        if (denied) { refuse(res, denied.code, denied.statusText); return null; }
    }
    return { id, rule };
};

const visibleOnly = async (companyId, uid, match) => ({
    $and: [match, { ProjectID: { $in: await access.visibleProjectIds(companyId, uid) } }],
});

// POST /api/v1/automations
exports.createRule = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return refuse(res, 400, 'companyId is required.');
        const check = R.validateRule(req.body || {});
        if (!check.valid) return res.send({ status: false, statusText: check.errors.join('; ') });
        const denied = await access.refuseRuleWrite({ companyId, uid: req.uid, rule: check.value });
        if (denied) return refuse(res, denied.code, denied.statusText);
        const data = { _id: new mongoose.Types.ObjectId(), ...check.value, enabled: req.body.enabled === true, lastRunCount: 0, createdBy: String(req.uid || ''), deletedStatusKey: 0 };
        const saved = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AUTOMATION_RULES, data }, 'save');
        rulesChanged(companyId);
        return res.send({ status: true, statusText: 'Automation created.', data: saved });
    } catch (e) { logger.error(`createRule: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

// GET /api/v1/automations
exports.listRules = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return refuse(res, 400, 'companyId is required.');
        // v2 rules are excluded: they carry `steps`, not `actions`, so R.describe
        // reads them as empty and `lastRunCount` — which only the bulk apply below
        // ever writes — reads as "0 tasks affected" for a rule that has been firing.
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AUTOMATION_RULES, data: [{ deletedStatusKey: { $ne: 1 }, version: { $ne: 2 } }, {}, { sort: { updatedAt: -1 } }],
        }, 'find');
        return res.send({ status: true, data: (rows || []).map((r) => ({ ...(r.toObject ? r.toObject() : r), summary: R.describe(r) })) });
    } catch (e) { logger.error(`listRules: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

// PUT /api/v1/automations/:id
exports.updateRule = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return refuse(res, 400, 'companyId is required.');
        const set = {};
        if (req.body.enabled !== undefined) set.enabled = !!req.body.enabled;
        if (['name', 'conditions', 'actions', 'trigger'].some((k) => req.body[k] !== undefined)) {
            const check = R.validateRule(req.body || {});
            if (!check.valid) return res.send({ status: false, statusText: check.errors.join('; ') });
            Object.assign(set, check.value);
        }
        if (!Object.keys(set).length) return res.send({ status: false, statusText: 'Nothing to update.' });
        const target = await ruleForWrite(req, res, companyId, set.conditions ? set : null);
        if (!target) return undefined;
        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AUTOMATION_RULES, data: [{ _id: target.id, deletedStatusKey: { $ne: 1 } }, { $set: set }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        if (!updated) return refuse(res, 404, NOT_FOUND);
        rulesChanged(companyId);
        return res.send({ status: true, statusText: 'Automation updated.', data: updated });
    } catch (e) { logger.error(`updateRule: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

// DELETE /api/v1/automations/:id and /api/v2/automations/:id
exports.deleteRule = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return refuse(res, 400, 'companyId is required.');
        const target = await ruleForWrite(req, res, companyId);
        if (!target) return undefined;
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AUTOMATION_RULES, data: [{ _id: target.id }, { $set: { deletedStatusKey: 1, enabled: false } }],
        }, 'updateOne');
        rulesChanged(companyId);
        return res.send({ status: true, statusText: 'Automation removed.' });
    } catch (e) { logger.error(`deleteRule: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

// POST /api/v1/automations/preview  { conditions }
exports.preview = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return refuse(res, 400, 'companyId is required.');
        const conditions = (req.body && req.body.conditions) || {};
        const match = await visibleOnly(companyId, req.uid, R.buildMatch(conditions, oid));
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

/* POST /api/v1/automations/:id/apply
 * All or nothing: one target the caller may not edit refuses the whole batch, so a
 * rule cannot be used to reach into a project through the tasks it happens to match. */
exports.applyRule = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return refuse(res, 400, 'companyId is required.');
        const target = await ruleForWrite(req, res, companyId);
        if (!target) return undefined;
        const { id, rule } = target;
        // A v2 rule keeps its work in `steps`, so this would find no action, touch
        // nothing, and still answer "Applied to 0 task(s)" while stamping a zero
        // over the counter.
        if (Number(rule.version) === 2) return refuse(res, 400, V2_NOT_APPLIABLE);
        const pr = (rule.actions || []).find((a) => a.type === 'set_priority');
        const tasks = pr
            ? await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [R.buildMatch(rule.conditions || {}, oid), 'ProjectID Task_Priority'] }, 'find')
            : [];
        const projectIds = [...new Set((tasks || []).map((t) => String(t.ProjectID)))];
        for (const projectId of projectIds) {
            const allowed = await canEditProject({ companyId, uid: req.uid, projectId, permissions: ['task.task_priority'] });
            if (!allowed.projectId) return refuse(res, 403, APPLY_REFUSED);
        }
        let modified = 0;
        for (const task of (tasks || []).filter((t) => t.Task_Priority !== pr.value)) {
            await updateTask(companyId, task._id, { Task_Priority: pr.value }, { action: 'automation.rule.apply', ruleId: String(id), ruleName: rule.name || '' });
            modified += 1;
        }
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AUTOMATION_RULES, data: [{ _id: id }, { $set: { lastRunAt: new Date(), lastRunCount: modified } }],
        }, 'updateOne').catch(() => {});
        rulesChanged(companyId);
        return res.send({ status: true, statusText: `Applied to ${modified} task(s).`, data: { modified } });
    } catch (e) { logger.error(`applyRule: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

// GET /api/v2/automations/registry
exports.getRegistry = async (req, res) => {
    try {
        return res.send({ status: true, data: registry.manifest() });
    } catch (e) {
        logger.error(`getRegistry: ${e.message}`);
        return res.send({ status: false, statusText: e.message });
    }
};

const V1_APPLY_FIELDS = ['lastRunAt', 'lastRunCount'];

/* Those two belong to the v1 bulk apply and are dropped here: the schema default
 * would otherwise report "never run, 0 tasks" for a rule the engine has been firing
 * on every matching event. */
const v2Summary = (r) => {
    const raw = r.toObject ? r.toObject() : r;
    const summarised = { ...raw, summary: V2.describeV2(raw), sentence: sentences.describeRule(raw) };
    V1_APPLY_FIELDS.forEach((field) => delete summarised[field]);
    return summarised;
};

// GET /api/v2/automations
exports.listRulesV2 = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return refuse(res, 400, 'companyId is required.');
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AUTOMATION_RULES,
            data: [{ deletedStatusKey: { $ne: 1 }, version: 2 }, {}, { sort: { updatedAt: -1 } }],
        }, 'find');
        // Lifetime, every run the rule has ever started, and one run per matched
        // event whatever its outcome — so it is not the number of comments posted
        // today, and `failedCount` is what says the difference.
        const fired = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AUTOMATION_RUNS,
            data: [[{
                $group: {
                    _id: '$ruleId',
                    runs: { $sum: 1 },
                    failures: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
                    lastAt: { $max: '$startedAt' },
                },
            }]],
        }, 'aggregate').catch(() => []);
        const byRule = {};
        (fired || []).forEach((f) => { byRule[String(f._id)] = f; });
        return res.send({
            status: true,
            data: (rows || []).map((r) => {
                const stats = byRule[String(r._id)] || {};
                return { ...v2Summary(r), firedCount: Number(stats.runs || 0), failedCount: Number(stats.failures || 0), lastFiredAt: stats.lastAt || null };
            }),
        });
    } catch (e) { logger.error(`listRulesV2: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

// POST /api/v2/automations
exports.createRuleV2 = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return refuse(res, 400, 'companyId is required.');
        const check = V2.validateRuleV2(req.body || {});
        if (!check.valid) return res.send({ status: false, statusText: check.errors[0], errors: check.errors });
        const denied = await access.refuseRuleWrite({ companyId, uid: req.uid, rule: check.value });
        if (denied) return refuse(res, denied.code, denied.statusText);

        // A rule that mutates tasks the instant it is saved gives the author no chance to look at it first.
        // No lastRunCount: that counter belongs to the v1 bulk apply, and seeding it
        // here puts a permanent 0 next to a rule the event engine does fire.
        const data = {
            _id: new mongoose.Types.ObjectId(), ...check.value,
            enabled: req.body.enabled === true,
            createdBy: String(req.uid || ''), deletedStatusKey: 0,
        };
        const saved = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AUTOMATION_RULES, data }, 'save');
        rulesChanged(companyId);
        return res.send({ status: true, statusText: 'Automation created.', data: v2Summary(saved) });
    } catch (e) { logger.error(`createRuleV2: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

// PUT /api/v2/automations/:id
exports.updateRuleV2 = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return refuse(res, 400, 'companyId is required.');
        const check = V2.validateRuleV2(req.body || {});
        if (!check.valid) return res.send({ status: false, statusText: check.errors[0], errors: check.errors });
        const target = await ruleForWrite(req, res, companyId, check.value);
        if (!target) return undefined;
        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AUTOMATION_RULES,
            data: [{ _id: target.id, deletedStatusKey: { $ne: 1 } }, { $set: check.value }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        if (!updated) return refuse(res, 404, NOT_FOUND);
        rulesChanged(companyId);
        return res.send({ status: true, statusText: 'Automation updated.', data: v2Summary(updated) });
    } catch (e) { logger.error(`updateRuleV2: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

/* PATCH /api/v2/automations/:id/enabled
 * Its own endpoint rather than a full save: a stale list toggling a rule must not
 * silently revert an edit made in another tab. */
exports.setRuleEnabled = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return refuse(res, 400, 'companyId is required.');
        const target = await ruleForWrite(req, res, companyId);
        if (!target) return undefined;
        const enabled = req.body && req.body.enabled === true;
        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AUTOMATION_RULES,
            data: [{ _id: target.id, deletedStatusKey: { $ne: 1 } }, { $set: { enabled } }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        if (!updated) return refuse(res, 404, NOT_FOUND);
        rulesChanged(companyId);
        return res.send({ status: true, statusText: enabled ? 'Automation on.' : 'Automation off.', data: v2Summary(updated) });
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

/* POST /api/v2/automations/compile  body: { sentence?, rule?, name? }
 * Deterministic, no model call: what the user reads is what the engine will run. */
exports.compileSentence = async (req, res) => {
    try {
        const { sentence, rule, name } = req.body || {};
        if (rule && !sentence) {
            const check = V2.validateRuleV2({ name: name || 'Automation', ...rule });
            return res.send({
                status: true,
                data: { sentence: sentences.describeRule(rule), rule, errors: check.errors, ambiguities: [], grammar: sentences.grammar() },
            });
        }
        if (!String(sentence || '').trim()) return res.send({ status: false, statusText: 'A sentence is required.' });
        const parsed = sentences.parseSentence(sentence, { name });
        const check = parsed.rule ? V2.validateRuleV2(parsed.rule) : { valid: false, errors: [] };
        return res.send({
            status: true,
            data: {
                sentence: parsed.rule ? sentences.describeRule(parsed.rule) : String(sentence),
                rule: parsed.rule,
                errors: parsed.errors.concat(check.errors || []),
                ambiguities: parsed.ambiguities,
                grammar: sentences.grammar(),
            },
        });
    } catch (e) { logger.error(`compileSentence: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

const WINDOW_DAYS = 30;

/* Change operators are skipped deliberately: a "changed to" clause needs a
 * before/after that no longer exists on the task, and counting it as matched would
 * overstate the number. */
const backtestMatch = (node) => {
    if (!node || !node.op) return {};
    if (node.op === 'and') return { $and: (node.args || []).map(backtestMatch).filter((m) => Object.keys(m).length) };
    if (node.op === 'or') return { $or: (node.args || []).map(backtestMatch).filter((m) => Object.keys(m).length) };
    const field = String(node.field || '').split('.').pop();
    if (!field) return {};
    switch (node.op) {
        case 'eq': case 'changedTo': return { [field]: node.value };
        case 'neq': return { [field]: { $ne: node.value } };
        case 'in': return { [field]: { $in: [].concat(node.value) } };
        case 'notIn': return { [field]: { $nin: [].concat(node.value) } };
        case 'contains': return { [field]: { $regex: escapeRegex(String(node.value || '')), $options: 'i' } };
        case 'empty': return { $or: [{ [field]: { $exists: false } }, { [field]: null }, { [field]: '' }, { [field]: [] }] };
        case 'notEmpty': return { [field]: { $nin: [null, '', []] } };
        default: return {};
    }
};

/* POST /api/v2/automations/backtest  body: { rule }
 * Counts tasks touched in the window that the conditions match today. It does not
 * replay the event stream, and says so in `basis`. Only projects the caller can
 * open are searched, whatever scope the rule names. */
exports.backtest = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return refuse(res, 400, 'companyId is required.');
        const rule = (req.body && req.body.rule) || {};
        const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
        const conditionMatch = backtestMatch(rule.conditions);
        const match = { deletedStatusKey: { $ne: 1 }, updatedAt: { $gte: since } };
        if (Object.keys(conditionMatch).length) Object.assign(match, conditionMatch);
        let projectIds = await access.visibleProjectIds(companyId, req.uid);
        if (rule.scope && rule.scope.allProjects === false && (rule.scope.projectIds || []).length) {
            const wanted = new Set(rule.scope.projectIds.map(String));
            projectIds = projectIds.filter((id) => wanted.has(String(id)));
        }
        const scoped = { $and: [match, { ProjectID: { $in: projectIds } }] };
        const [count, sample] = await Promise.all([
            MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [scoped] }, 'countDocuments').catch(() => 0),
            MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [scoped, 'TaskName TaskKey', { limit: 5, sort: { updatedAt: -1 } }] }, 'find').catch(() => []),
        ]);
        return res.send({
            status: true,
            data: {
                windowDays: WINDOW_DAYS,
                matched: Number(count) || 0,
                sample: (sample || []).map((t) => ({ id: String(t._id), key: t.TaskKey || '', name: t.TaskName || '' })),
                basis: `tasks touched in the last ${WINDOW_DAYS} days whose current state matches these conditions`,
            },
        });
    } catch (e) { logger.error(`backtest: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};
