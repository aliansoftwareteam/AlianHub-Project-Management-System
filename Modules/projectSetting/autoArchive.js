const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');
const socketEmitter = require('../../event/socketEventEmitter');
const { HandleHistory } = require('../Tasks/helpers/mongo_helper');

// Per-project auto-archive rule: completed tasks (status type 'close') that
// haven't been touched for `afterDays` days get archived (deletedStatusKey 2,
// same lifecycle as manual archive) by a nightly cron. The rule lives on the
// project document as `autoArchive: { enabled, afterDays }`.

const { normaliseRule, DEFAULT_AFTER_DAYS, MIN_AFTER_DAYS, MAX_AFTER_DAYS } = require('./autoArchiveRules');

const LOG_PREFIX = '[autoArchive]';
const COMPANY_CONCURRENCY = 5;
// Per-project per-run cap — a backstop so a freshly-enabled rule on a huge
// backlog archives gradually instead of hammering one nightly run.
const MAX_TASKS_PER_PROJECT_RUN = 200;

const SYSTEM_USER = { id: 'auto-archive', Employee_Name: 'Auto-archive' };

/* GET /api/v1/projectSetting/autoArchive/:pid */
async function getAutoArchive(req, res) {
    try {
        const companyId = req.headers['companyid'] || '';
        const { pid } = req.params;
        if (!companyId || !pid) {
            return res.send({ status: false, statusText: 'companyId and projectId are required.' });
        }
        const project = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PROJECTS,
            data: [{ _id: new mongoose.Types.ObjectId(pid) }, 'autoArchive'],
        }, 'findOne');
        if (!project) {
            return res.send({ status: false, statusText: 'Project not found.' });
        }
        return res.send({ status: true, statusText: 'Auto-archive rule fetched.', data: normaliseRule(project.autoArchive) });
    } catch (error) {
        logger.error(`${LOG_PREFIX} get failed: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
}

/* POST /api/v1/projectSetting/autoArchive  body: { projectId, enabled, afterDays } */
async function setAutoArchive(req, res) {
    try {
        const companyId = req.headers['companyid'] || '';
        const { projectId, enabled, afterDays } = req.body || {};
        if (!companyId || !projectId) {
            return res.send({ status: false, statusText: 'companyId and projectId are required.' });
        }
        const rule = normaliseRule({ enabled, afterDays });
        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PROJECTS,
            data: [
                { _id: new mongoose.Types.ObjectId(projectId) },
                { $set: { autoArchive: rule } },
                { returnDocument: 'after' },
            ],
        }, 'findOneAndUpdate');
        if (!updated) {
            return res.send({ status: false, statusText: 'Project not found.' });
        }
        return res.send({ status: true, statusText: rule.enabled ? `Completed tasks will auto-archive after ${rule.afterDays} days.` : 'Auto-archive disabled.', data: rule });
    } catch (error) {
        logger.error(`${LOG_PREFIX} set failed: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
}

/* Archive one parent task: children first, then the task itself, then the
 * sprint counters (same fields the manual archive flow maintains), history,
 * and a socket emit so open boards drop the task live. */
async function archiveOneTask(companyId, task, afterDays) {
    const childCount = (task.subTasks || 0);

    await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [
            { ParentTaskId: String(task._id), deletedStatusKey: 0 },
            { $set: { deletedStatusKey: 2 } },
        ],
    }, 'updateMany');

    const updated = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [
            { _id: task._id, deletedStatusKey: 0 },
            { $set: { deletedStatusKey: 2 } },
            { returnDocument: 'after' },
        ],
    }, 'findOneAndUpdate');
    if (!updated) {
        return false;
    }

    // Sprint counters mirror the manual archive flow (structural.js):
    // archived tasks move from `tasks` into `archiveTaskCount`.
    if (task.sprintId) {
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.SPRINTS,
            data: [
                { _id: task.sprintId },
                { $inc: { archiveTaskCount: childCount + 1, tasks: -1 * (childCount + 1) } },
            ],
        }, 'updateOne').catch((error) => {
            logger.error(`${LOG_PREFIX} sprint counter update failed for task ${task._id}: ${error.message}`);
        });
    }

    socketEmitter.emit('update', { type: "update", data: updated, updatedFields: { deletedStatusKey: 2 }, module: 'task' });

    HandleHistory('task', companyId, task.ProjectID, task._id, {
        key: 'Task_Archive',
        message: `<b>Auto-archive</b> archived this task — completed and untouched for ${afterDays} days.`,
        sprintId: task.sprintId,
    }, SYSTEM_USER).catch((error) => {
        logger.error(`${LOG_PREFIX} history failed for task ${task._id}: ${error.message}`);
    });

    return true;
}

/* Run the rule for every opted-in project of one company. */
async function runAutoArchiveForCompany(companyId) {
    const projects = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS,
        data: [{ 'autoArchive.enabled': true, deletedStatusKey: { $in: [0, undefined] } }, '_id ProjectName autoArchive'],
    }, 'find');

    let archivedTotal = 0;
    for (const project of (projects || [])) {
        const rule = normaliseRule(project.autoArchive);
        if (!rule.enabled) continue;
        const cutoff = new Date(Date.now() - rule.afterDays * 24 * 60 * 60 * 1000);

        const candidates = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [
                {
                    ProjectID: project._id,
                    isParentTask: true,
                    deletedStatusKey: 0,
                    statusType: 'close',
                    updatedAt: { $lt: cutoff },
                },
                '_id TaskKey ProjectID sprintId subTasks',
            ],
        }, 'find');

        const slice = (candidates || []).slice(0, MAX_TASKS_PER_PROJECT_RUN);
        for (const task of slice) {
            // eslint-disable-next-line no-await-in-loop
            const done = await archiveOneTask(companyId, task, rule.afterDays).catch((error) => {
                logger.error(`${LOG_PREFIX} task ${task._id} failed: ${error.message}`);
                return false;
            });
            if (done) archivedTotal++;
        }
    }
    if (archivedTotal > 0) {
        logger.info(`${LOG_PREFIX} company ${companyId}: archived ${archivedTotal} tasks`);
    }
    return archivedTotal;
}

/* Nightly entry point — iterates every company in bounded batches, one
 * tenant's failure never poisons the rest (same pattern as
 * ScreenshotRetention.runRetentionForAllCompanies). */
async function runAutoArchiveForAllCompanies() {
    const startedAt = Date.now();
    let companies = [];
    try {
        companies = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
            type: SCHEMA_TYPE.COMPANIES,
            data: [{}, '_id'],
        }, 'find');
    } catch (error) {
        logger.error(`${LOG_PREFIX} could not enumerate companies: ${error.message}`);
        return;
    }

    for (let i = 0; i < companies.length; i += COMPANY_CONCURRENCY) {
        const slice = companies.slice(i, i + COMPANY_CONCURRENCY);
        // eslint-disable-next-line no-await-in-loop
        await Promise.allSettled(slice.map((company) => runAutoArchiveForCompany(String(company._id))));
    }

    logger.info(`${LOG_PREFIX} nightly run complete in ${Math.round((Date.now() - startedAt) / 1000)}s`);
}

module.exports = {
    normaliseRule,
    getAutoArchive,
    setAutoArchive,
    runAutoArchiveForCompany,
    runAutoArchiveForAllCompanies,
    DEFAULT_AFTER_DAYS,
    MIN_AFTER_DAYS,
    MAX_AFTER_DAYS,
};
