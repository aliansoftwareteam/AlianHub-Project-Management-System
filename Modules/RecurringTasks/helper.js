// Recurring task definitions — pure logic: schedule math + instantiation.
// HTTP handlers live in controller.js; cron entry is runRecurringForAllCompanies().
const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { taskMongo } = require('../Tasks/helpers/task_class_Mongo');
const logger = require('../../Config/loggerConfig');
const rules = require('./recurrenceRules');

const COMPANY_CONCURRENCY = 5;
const LOG_PREFIX = '[recurringTasks]';

const computeNextRun = rules.computeNextRun;

// Clone the stored template into a fresh task `data` payload for taskMongo.create.
function buildInstanceData(def, companyId) {
    const t = Object.assign({}, def.templateSnapshot || {});
    const projectId = (def.projectSnapshot && def.projectSnapshot._id) || def.ProjectID;
    return Object.assign(t, {
        _id: new mongoose.Types.ObjectId(),
        TaskKey: '-',
        ProjectID: projectId,
        CompanyId: companyId,
        sprintId: def.sprintId,
        sprintArray: def.sprintArray || t.sprintArray,
        deletedStatusKey: 0,
        startDate: new Date(),
    });
}

async function isPreviousInstanceOpen(companyId, taskId) {
    if (!taskId) return false;
    try {
        const res = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [{ _id: new mongoose.Types.ObjectId(taskId) }, 'statusType deletedStatusKey'],
        }, 'findOne');
        if (!res) return false;
        return res.deletedStatusKey !== 1 && res.statusType !== 'close';
    } catch (e) {
        return false;
    }
}

// Push an open instance's due date to this occurrence instead of stacking a
// second copy of the same job on the assignee.
async function rollPreviousInstance(companyId, taskId, dueDate) {
    try {
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [{ _id: new mongoose.Types.ObjectId(taskId) }, { $set: { DueDate: dueDate } }],
        }, 'updateOne');
        return true;
    } catch (e) {
        logger.error(`${LOG_PREFIX} rolling ${taskId} forward failed: ${e.message}`);
        return false;
    }
}

// Create one task instance from a definition. Returns { created, id, skipped, rolled }.
async function instantiateOne(companyId, def, occurrenceDate) {
    const policy = rules.missedPolicyOf(def);
    if (policy !== 'create' && await isPreviousInstanceOpen(companyId, def.lastInstanceTaskId)) {
        if (rules.resolveOccurrence(policy, true) === 'roll') {
            const rolled = await rollPreviousInstance(companyId, def.lastInstanceTaskId, occurrenceDate || new Date());
            return { created: false, skipped: true, rolled };
        }
        return { created: false, skipped: true, rolled: false };
    }
    const data = buildInstanceData(def, companyId);
    const indexObj = { indexName: 'groupByStatusIndex', searchKey: 'statusKey', searchValue: String(data.statusKey || 1) };
    const result = await taskMongo.create({
        data,
        user: def.userSnapshot || { id: def.createdBy, Employee_Name: '', companyOwnerId: '' },
        projectData: def.projectSnapshot || { _id: data.ProjectID, CompanyId: companyId },
        indexObj,
    });
    return { created: !!(result && result.status), id: result && result.id, skipped: false, rolled: false };
}

// updateOne $set on a definition.
async function updateDef(companyId, id, patch) {
    return MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.RECURRING_TASKS,
        data: [{ _id: new mongoose.Types.ObjectId(id) }, { $set: patch }],
    }, 'updateOne');
}

// Process every due, enabled definition for one company.
async function processDueForCompany(companyId, now) {
    const ref = now ? new Date(now) : new Date();
    let defs = [];
    try {
        defs = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.RECURRING_TASKS,
            data: [{ enabled: true, deletedStatusKey: 0, nextRunAt: { $lte: ref } }],
        }, 'find');
    } catch (e) {
        logger.error(`${LOG_PREFIX} find-due failed for ${companyId}: ${e.message}`);
        return { processed: 0, created: 0 };
    }
    let created = 0;
    for (const def of (defs || [])) {
        try {
            if (def.until && new Date(def.until) < ref) {
                await updateDef(companyId, def._id, { enabled: false });
                continue;
            }
            const out = await instantiateOne(companyId, def, ref);
            if (out.created) created++;
            const next = computeNextRun(def, ref);
            const patch = {
                lastRunAt: ref,
                runCount: (Number(def.runCount) || 0) + (out.created ? 1 : 0),
                nextRunAt: next,
            };
            if (out.id) patch.lastInstanceTaskId = String(out.id);
            if (def.until && next > new Date(def.until)) patch.enabled = false;
            await updateDef(companyId, def._id, patch);
        } catch (e) {
            logger.error(`${LOG_PREFIX} instantiate failed (${companyId}/${def._id}): ${e.message}`);
        }
    }
    return { processed: (defs || []).length, created };
}

// Cron entry: scan every company for due definitions (bounded concurrency).
async function runRecurringForAllCompanies() {
    let companies = [];
    try {
        companies = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
            type: SCHEMA_TYPE.COMPANIES,
            data: [{}, '_id'],
        }, 'find');
    } catch (e) {
        logger.error(`${LOG_PREFIX} could not enumerate companies: ${e.message}`);
        return;
    }
    for (let i = 0; i < (companies || []).length; i += COMPANY_CONCURRENCY) {
        const slice = companies.slice(i, i + COMPANY_CONCURRENCY);
        await Promise.allSettled(slice.map((c) => processDueForCompany(String(c._id))));
    }
    logger.info(`${LOG_PREFIX} run complete across ${(companies || []).length} companies`);
}

module.exports = {
    computeNextRun,
    missedPolicyOf: rules.missedPolicyOf,
    buildInstanceData,
    instantiateOne,
    processDueForCompany,
    updateDef,
    runRecurringForAllCompanies,
};
