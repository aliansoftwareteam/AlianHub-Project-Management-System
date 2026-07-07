/**
 * Auto-close inactive projects — helper layer (AHE-3798).
 *
 * Models on ScreenshotRetention (per-company policy on the global `companies`
 * master doc) + projectSetting/autoArchive (nightly per-company cron that
 * mutates tenant data). The company-level toggle lives on the master doc so
 * the cron can enumerate opted-in companies in one query without opening
 * every tenant DB.
 *
 * Rule: a project with NO activity for `inactiveMonths` months is set to its
 * "close"-type status (statusType 'close') — exactly what the manual
 * "Close Project" action does (project status + child tasks) — never deleted.
 * "Activity" = a logged time entry (TimeSheet) OR any task create/update
 * (tasks.updatedAt) in the window. Both quiet → the project is auto-closed.
 * Close is reversible (reopen), so — unlike screenshot deletion — no preview
 * or scary confirmation is needed.
 */

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const socketEmitter = require('../../event/socketEventEmitter');

let HandleHistory = null;
try {
    ({ HandleHistory } = require('../Tasks/helpers/mongo_helper'));
} catch (_e) {
    HandleHistory = null;
}

const LOG_PREFIX = '[autoCloseProjects]';
const COMPANY_CONCURRENCY = 5;
// Per-company per-run cap — a freshly-enabled rule on a huge backlog closes
// gradually instead of hammering one nightly run.
const MAX_PROJECTS_PER_RUN = 200;

// The inactivity window the UI offers, in MONTHS. Anything outside the set is
// rejected at the API layer so the toggle stays predictable.
const VALID_INACTIVE_MONTHS = [1, 2, 3, 6];
const DEFAULT_INACTIVE_MONTHS = 1;

const SYSTEM_USER = { id: 'auto-close', Employee_Name: 'Auto-close' };

// ----- policy read / write (global companies master doc) ------------------

function mapToObject(value) {
    if (!value) return null;
    if (value instanceof Map) return Object.fromEntries(value);
    return value;
}

function normalisePolicy(raw) {
    const policy = raw && typeof raw === 'object' ? raw : {};
    return {
        enabled: policy.enabled === true,
        inactiveMonths: VALID_INACTIVE_MONTHS.includes(Number(policy.inactiveMonths))
            ? Number(policy.inactiveMonths)
            : DEFAULT_INACTIVE_MONTHS,
        enabledAt: policy.enabledAt || null,
        enabledBy: policy.enabledBy || null,
        lastRunAt: policy.lastRunAt || null,
        lastRunStats: policy.lastRunStats || null,
    };
}

async function getCompanyPolicy(companyId) {
    const company = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
        type: SCHEMA_TYPE.COMPANIES,
        data: [{ _id: new mongoose.Types.ObjectId(companyId) }, { _id: 1, autoCloseProjects: 1 }],
    }, 'findOne');
    return normalisePolicy(mapToObject(company && company.autoCloseProjects));
}

async function updateCompanyPolicy(companyId, patch, opts = {}) {
    const setObj = {};
    if (patch.enabled !== undefined) setObj['autoCloseProjects.enabled'] = patch.enabled === true;
    if (patch.inactiveMonths !== undefined) {
        const n = Number(patch.inactiveMonths);
        if (!VALID_INACTIVE_MONTHS.includes(n)) throw new Error(`Invalid inactiveMonths ${patch.inactiveMonths}`);
        setObj['autoCloseProjects.inactiveMonths'] = n;
    }
    if (opts.markEnabled && opts.userId) {
        setObj['autoCloseProjects.enabledAt'] = new Date();
        setObj['autoCloseProjects.enabledBy'] = String(opts.userId);
    }
    if (Object.keys(setObj).length === 0) return getCompanyPolicy(companyId);
    await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
        type: SCHEMA_TYPE.COMPANIES,
        data: [{ _id: new mongoose.Types.ObjectId(companyId) }, { $set: setObj }, { new: true, useFindAndModify: false }],
    }, 'findOneAndUpdate');
    return getCompanyPolicy(companyId);
}

async function stampMasterField(companyId, setObj) {
    return MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
        type: SCHEMA_TYPE.COMPANIES,
        data: [{ _id: new mongoose.Types.ObjectId(companyId) }, { $set: setObj }, { new: true, useFindAndModify: false }],
    }, 'findOneAndUpdate');
}

/** now − N months, anchored to "now" so the boundary slides forward daily. */
function computeCutoff(inactiveMonths) {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - Number(inactiveMonths));
    return cutoff;
}

// ----- activity detection (per tenant) ------------------------------------

/**
 * Has this project seen ANY activity since `cutoff`? Activity = a logged time
 * entry OR a created/updated task. Either signal short-circuits to `true`.
 * TimeSheet.LogStartTime is epoch SECONDS; tasks.updatedAt is a Date.
 */
async function projectHasActivitySince(companyId, projectId, cutoff) {
    const cutoffSec = Math.floor(cutoff.getTime() / 1000);

    const loggedTime = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TIMESHEET,
        data: [{ ProjectId: String(projectId), LogStartTime: { $gte: cutoffSec } }, { _id: 1 }],
    }, 'findOne').catch(() => null);
    if (loggedTime) return true;

    const touchedTask = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [{ ProjectID: new mongoose.Types.ObjectId(projectId), updatedAt: { $gte: cutoff }, deletedStatusKey: { $in: [0, undefined] } }, { _id: 1 }],
    }, 'findOne').catch(() => null);
    if (touchedTask) return true;

    return false;
}

// ----- close one project (mirrors the manual "Close Project" flow) ---------

/**
 * Set the project to its close-type status + move its active tasks to the
 * closed-project state (deletedStatusKey 8), same as the manual flow in
 * Item.vue. History + socket so open boards update live. Returns true on
 * close, false when skipped (no close-type status defined on the project).
 */
async function closeOneProject(companyId, project, inactiveMonths) {
    const closeStatus = Array.isArray(project.projectStatusData)
        ? project.projectStatusData.find((s) => s && s.type === 'close')
        : null;
    if (!closeStatus) {
        logger.warn(`${LOG_PREFIX} project ${project._id} has no close-type status — skipped`);
        return false;
    }

    const updated = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS,
        data: [
            { _id: project._id },
            { $set: { status: closeStatus.value, statusType: 'close' } },
            { returnDocument: 'after' },
        ],
    }, 'findOneAndUpdate');
    if (!updated) return false;

    // Move active tasks into the closed-project state (0 → 8), same as the
    // manual close's updateChildTasks(). Best-effort — the project is closed
    // regardless of the bulk task update.
    await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [
            { ProjectID: project._id, deletedStatusKey: 0 },
            { $set: { deletedStatusKey: 8 } },
        ],
    }, 'updateMany').catch((error) => {
        logger.error(`${LOG_PREFIX} child-task update failed for project ${project._id}: ${error.message}`);
    });

    socketEmitter.emit('update', {
        type: 'update', data: updated, updatedFields: { status: closeStatus.value, statusType: 'close' }, module: 'project',
    });

    if (HandleHistory) {
        HandleHistory('project', companyId, String(project._id), null, {
            key: 'Project_Name',
            message: `<b>Auto-close</b> closed this project — no activity for ${inactiveMonths} month${inactiveMonths === 1 ? '' : 's'}.`,
        }, SYSTEM_USER).catch((error) => {
            logger.error(`${LOG_PREFIX} history failed for project ${project._id}: ${error.message}`);
        });
    }
    return true;
}

// ----- per-company run -----------------------------------------------------

async function runAutoCloseForCompany(companyId, inactiveMonths) {
    const cutoff = computeCutoff(inactiveMonths);

    // Only OPEN projects (not already closed, not deleted) that are themselves
    // older than the window — a brand-new empty project must not auto-close.
    const projects = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS,
        data: [
            {
                statusType: { $ne: 'close' },
                deletedStatusKey: { $in: [0, undefined] },
                Created_At: { $lt: cutoff },
            },
            '_id ProjectName status statusType projectStatusData Created_At',
        ],
    }, 'find').catch((error) => {
        logger.error(`${LOG_PREFIX} could not list projects for company ${companyId}: ${error.message}`);
        return [];
    });

    let closedTotal = 0;
    const slice = (projects || []).slice(0, MAX_PROJECTS_PER_RUN);
    for (const project of slice) {
        // eslint-disable-next-line no-await-in-loop
        const active = await projectHasActivitySince(companyId, project._id, cutoff).catch(() => true);
        if (active) continue; // fail-safe: on a detection error, do NOT close
        // eslint-disable-next-line no-await-in-loop
        const done = await closeOneProject(companyId, project, inactiveMonths).catch((error) => {
            logger.error(`${LOG_PREFIX} close failed for project ${project._id}: ${error.message}`);
            return false;
        });
        if (done) closedTotal += 1;
    }
    return closedTotal;
}

// ----- nightly cron entry point -------------------------------------------

async function runAutoCloseForAllCompanies() {
    const startedAt = Date.now();
    let companies = [];
    try {
        companies = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
            type: SCHEMA_TYPE.COMPANIES,
            data: [{ 'autoCloseProjects.enabled': true }, { _id: 1, autoCloseProjects: 1 }],
        }, 'find');
    } catch (error) {
        logger.error(`${LOG_PREFIX} could not enumerate opted-in companies: ${error.message}`);
        return;
    }
    if (!companies.length) {
        logger.info(`${LOG_PREFIX} no companies have auto-close enabled — nothing to do`);
        return;
    }

    for (let i = 0; i < companies.length; i += COMPANY_CONCURRENCY) {
        const slice = companies.slice(i, i + COMPANY_CONCURRENCY);
        // eslint-disable-next-line no-await-in-loop
        await Promise.allSettled(slice.map(async (company) => {
            const companyId = String(company._id);
            const policy = normalisePolicy(mapToObject(company.autoCloseProjects));
            if (!policy.enabled) return;
            const startedCompany = Date.now();
            const closed = await runAutoCloseForCompany(companyId, policy.inactiveMonths);
            await stampMasterField(companyId, {
                'autoCloseProjects.lastRunAt': new Date(),
                'autoCloseProjects.lastRunStats': { closedCount: closed, durationMs: Date.now() - startedCompany },
            }).catch(() => {});
            if (closed > 0) logger.info(`${LOG_PREFIX} company ${companyId}: closed ${closed} inactive project(s)`);
        }));
    }
    logger.info(`${LOG_PREFIX} nightly run complete in ${Math.round((Date.now() - startedAt) / 1000)}s`);
}

module.exports = {
    getCompanyPolicy,
    updateCompanyPolicy,
    normalisePolicy,
    computeCutoff,
    projectHasActivitySince,
    closeOneProject,
    runAutoCloseForCompany,
    runAutoCloseForAllCompanies,
    VALID_INACTIVE_MONTHS,
    DEFAULT_INACTIVE_MONTHS,
};
