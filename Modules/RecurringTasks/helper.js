// Recurring task definitions — pure logic: schedule math + instantiation.
// HTTP handlers live in controller.js; cron entry is runRecurringForAllCompanies().
const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { taskMongo } = require('../Tasks/helpers/task_class_Mongo');
const logger = require('../../Config/loggerConfig');

const COMPANY_CONCURRENCY = 5;
const LOG_PREFIX = '[recurringTasks]';

function atHour(year, month, day, hour) {
    return new Date(year, month, day, hour, 0, 0, 0);
}

// The next run strictly after `fromDate`, per the definition's schedule.
function computeNextRun(def, fromDate) {
    const from = fromDate ? new Date(fromDate) : new Date();
    const hour = Number.isFinite(Number(def.runHour)) ? Number(def.runHour) : 9;
    const interval = Math.max(1, Number(def.interval) || 1);

    if (def.freq === 'weekly') {
        const days = (Array.isArray(def.byweekday) && def.byweekday.length) ? def.byweekday.map(Number) : [from.getDay()];
        for (let i = 1; i <= 7 * interval + 7; i++) {
            const c = atHour(from.getFullYear(), from.getMonth(), from.getDate() + i, hour);
            if (days.includes(c.getDay())) return c;
        }
        return atHour(from.getFullYear(), from.getMonth(), from.getDate() + 7, hour);
    }
    if (def.freq === 'monthly') {
        // cap at 28 so we never overflow into the next month on short months
        const dom = Math.min(28, Math.max(1, Number(def.monthday) || from.getDate()));
        let c = atHour(from.getFullYear(), from.getMonth(), dom, hour);
        while (c <= from) {
            c = atHour(c.getFullYear(), c.getMonth() + interval, dom, hour);
        }
        return c;
    }
    // daily (default)
    return atHour(from.getFullYear(), from.getMonth(), from.getDate() + interval, hour);
}

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

// Create one task instance from a definition. Returns { created, id, skipped }.
async function instantiateOne(companyId, def) {
    if (def.skipIfOpen && await isPreviousInstanceOpen(companyId, def.lastInstanceTaskId)) {
        return { created: false, skipped: true };
    }
    const data = buildInstanceData(def, companyId);
    const indexObj = { indexName: 'groupByStatusIndex', searchKey: 'statusKey', searchValue: String(data.statusKey || 1) };
    const result = await taskMongo.create({
        data,
        user: def.userSnapshot || { id: def.createdBy, Employee_Name: '', companyOwnerId: '' },
        projectData: def.projectSnapshot || { _id: data.ProjectID, CompanyId: companyId },
        indexObj,
    });
    return { created: !!(result && result.status), id: result && result.id, skipped: false };
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
            const out = await instantiateOne(companyId, def);
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
    buildInstanceData,
    instantiateOne,
    processDueForCompany,
    updateDef,
    runRecurringForAllCompanies,
};
