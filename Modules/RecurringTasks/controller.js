// Recurring tasks — HTTP handlers. CRUD on definitions + a manual run-now /
// run-due (the scheduled job in cron.js runs production-only, so these let the
// feature be exercised in dev). Definitions and instances are company-scoped.
const mongoose = require('mongoose');
const helper = require('./helper');
const rules = require('./recurrenceRules');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');

// Build a valid task `data` template from the request (mirrors the defaults in
// taskMongo.createSubTaskWithAi so taskMongo.create accepts it).
function buildTemplateFromBody(body) {
    const project = body.projectData || {};
    return {
        TaskName: body.taskName,
        TaskKey: '-',
        AssigneeUserId: Array.isArray(body.assignees) ? body.assignees : [],
        watchers: [],
        DueDate: '',
        dueDateDeadLine: [],
        TaskType: body.taskType || 'task',
        TaskTypeKey: Number(body.taskTypeKey) || 1,
        ParentTaskId: '',
        ProjectID: project._id,
        CompanyId: project.CompanyId,
        status: { text: 'To Do', key: 1, type: 'default_active' },
        isParentTask: true,
        Task_Leader: (body.userData && body.userData.id) || '',
        Task_Priority: body.priority || 'MEDIUM',
        deletedStatusKey: 0,
        statusType: 'default_active',
        statusKey: 1,
        points: (body.points === undefined || body.points === null || body.points === '') ? null : Number(body.points),
        rawDescription: body.rawDescription || '',
        descriptionBlock: body.descriptionBlock || {},
    };
}

exports.createDefinition = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const b = req.body || {};
        if (!companyId || !b.name || !b.taskName || !b.projectData || !b.projectData._id || !b.freq) {
            return res.send({ status: false, statusText: 'Missing required fields (name, taskName, projectData, freq)' });
        }
        const def = {
            _id: new mongoose.Types.ObjectId(),
            name: b.name,
            ProjectID: new mongoose.Types.ObjectId(b.projectData._id),
            sprintId: b.sprintId || (b.sprintArray && (b.sprintArray.id || b.sprintArray._id)) || '',
            enabled: true,
            freq: b.freq,
            interval: Math.max(1, Number(b.interval) || 1),
            byweekday: Array.isArray(b.byweekday) ? b.byweekday.map(Number) : [],
            monthday: b.monthday ? Number(b.monthday) : undefined,
            runHour: Number.isFinite(Number(b.runHour)) ? Number(b.runHour) : 9,
            skipIfOpen: !!b.skipIfOpen,
            missedPolicy: rules.MISSED_POLICIES.includes(b.missedPolicy) ? b.missedPolicy : (b.skipIfOpen ? 'skip' : 'create'),
            until: b.until ? new Date(b.until) : undefined,
            runCount: 0,
            templateSnapshot: buildTemplateFromBody(b),
            projectSnapshot: {
                _id: b.projectData._id,
                CompanyId: b.projectData.CompanyId,
                ProjectCode: b.projectData.ProjectCode,
                ProjectName: b.projectData.ProjectName,
            },
            userSnapshot: {
                id: b.userData && b.userData.id,
                Employee_Name: b.userData && b.userData.Employee_Name,
                companyOwnerId: b.userData && b.userData.companyOwnerId,
            },
            sprintArray: b.sprintArray || {},
            createdBy: (b.userData && b.userData.id) || '',
            deletedStatusKey: 0,
        };
        def.nextRunAt = helper.computeNextRun(def, new Date());
        const saved = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.RECURRING_TASKS, data: def }, 'save');
        res.send({ status: true, statusText: 'Recurring task created', data: saved });
    } catch (error) {
        logger.error(`[recurringTasks] create failed: ${error.message}`);
        res.send({ status: false, statusText: error.message });
    }
};

exports.listByProject = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const projectId = req.params.pid;
        const defs = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.RECURRING_TASKS,
            data: [{ ProjectID: new mongoose.Types.ObjectId(projectId), deletedStatusKey: 0 }],
        }, 'find');
        res.send({ status: true, data: defs || [] });
    } catch (error) {
        logger.error(`[recurringTasks] list failed: ${error.message}`);
        res.send({ status: false, statusText: error.message });
    }
};

exports.updateDefinition = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const id = req.params.id;
        const b = req.body || {};
        const patch = {};
        ['name', 'enabled', 'freq', 'interval', 'byweekday', 'monthday', 'runHour', 'skipIfOpen'].forEach((k) => {
            if (b[k] !== undefined) patch[k] = b[k];
        });
        if (b.missedPolicy !== undefined && rules.MISSED_POLICIES.includes(b.missedPolicy)) patch.missedPolicy = b.missedPolicy;
        if (b.until !== undefined) patch.until = b.until ? new Date(b.until) : null;

        // If the schedule changed, recompute nextRunAt from the merged definition.
        const scheduleChanged = ['freq', 'interval', 'byweekday', 'monthday', 'runHour'].some((k) => b[k] !== undefined);
        if (scheduleChanged) {
            const existing = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.RECURRING_TASKS,
                data: [{ _id: new mongoose.Types.ObjectId(id) }],
            }, 'findOne');
            if (existing) {
                patch.nextRunAt = helper.computeNextRun(Object.assign({}, existing.toObject ? existing.toObject() : existing, patch), new Date());
            }
        }
        await helper.updateDef(companyId, id, patch);
        res.send({ status: true, statusText: 'Updated' });
    } catch (error) {
        logger.error(`[recurringTasks] update failed: ${error.message}`);
        res.send({ status: false, statusText: error.message });
    }
};

exports.deleteDefinition = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const id = req.params.id;
        await helper.updateDef(companyId, id, { deletedStatusKey: 1, enabled: false });
        res.send({ status: true, statusText: 'Deleted' });
    } catch (error) {
        logger.error(`[recurringTasks] delete failed: ${error.message}`);
        res.send({ status: false, statusText: error.message });
    }
};

// Instantiate one task right now from a definition (testing / manual trigger).
exports.runNow = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const id = req.params.id;
        const def = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.RECURRING_TASKS,
            data: [{ _id: new mongoose.Types.ObjectId(id) }],
        }, 'findOne');
        if (!def) return res.send({ status: false, statusText: 'Definition not found' });
        const out = await helper.instantiateOne(companyId, def);
        const patch = { lastRunAt: new Date(), runCount: (Number(def.runCount) || 0) + (out.created ? 1 : 0) };
        if (out.id) patch.lastInstanceTaskId = String(out.id);
        await helper.updateDef(companyId, id, patch);
        res.send({
            status: !!(out.created || out.skipped),
            statusText: out.skipped ? 'Skipped — previous instance still open' : 'Task created',
            data: { id: out.id || null, skipped: !!out.skipped },
        });
    } catch (error) {
        logger.error(`[recurringTasks] runNow failed: ${error.message}`);
        res.send({ status: false, statusText: error.message });
    }
};

// Process all due definitions for the caller's company (manual trigger; the
// cron does this for every company in production).
exports.runDueForCompany = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const result = await helper.processDueForCompany(companyId);
        res.send({ status: true, statusText: 'Processed due recurring tasks', data: result });
    } catch (error) {
        logger.error(`[recurringTasks] runDue failed: ${error.message}`);
        res.send({ status: false, statusText: error.message });
    }
};

// Cron entry (all companies) — consumed by cron.js.
exports.runRecurringForAllCompanies = helper.runRecurringForAllCompanies;
