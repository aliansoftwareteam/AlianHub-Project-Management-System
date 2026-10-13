const fs = require("fs");
const { ownOrNotPersonal } = require('../PersonalList/ownership');
const path = require("path");
const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose");
const logger = require("../../Config/loggerConfig");
const { taskListProjectIds } = require('../Tasks/helpers/taskListProjects');
const { canSeeSprintById, hiddenSprintFilter } = require('../Sprints/helpers/sprintVisibility');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const { pinSessionTenant } = require('../../Config/tenant');
const { FORMATS, WORKSPACE, validateExportInput, buildFileName, treeRows, taskRows, workspaceTaskRow, rowsToCsv } = require('./helpers/exportRules');

// Files stay on the server and only stream back through the download endpoint,
// so a job's path is never handed to the client.
const EXPORT_DIR = path.join(process.cwd(), 'wasabiUploadsLocal', 'exports');

const TASK_FIELDS = 'TaskKey TaskName ParentTaskId status statusType Task_Priority AssigneeUserId DueDate totalEstimatedTime createdAt updatedAt';

async function projectRows(companyId, job) {
    const filter = {
        ProjectID: new mongoose.Types.ObjectId(job.filters.projectId),
        deletedStatusKey: { $ne: 1 },
        mainChat: { $ne: true },
    };
    if (job.filters.sprintId) {
        filter.sprintId = new mongoose.Types.ObjectId(job.filters.sprintId);
    } else {
        /* The job runs detached from the request, so the private sprints are excluded
         * again here against the person the export belongs to. */
        Object.assign(filter, await hiddenSprintFilter(companyId, job.userId, [String(job.filters.projectId)]));
    }
    const tasks = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [filter, TASK_FIELDS],
    }, 'find');
    return taskRows(tasks || []);
}

/* The job runs detached from the request: a person who lost the owner or admin role since starting it gets nothing. */
async function workspaceRows(companyId, userId) {
    if (!isPrivileged(await getRoleType(companyId, userId))) throw new Error('Only an owner or admin can export the workspace.');
    const projects = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS,
        data: [{ deletedStatusKey: { $nin: [1] }, ...ownOrNotPersonal(userId) }, 'ProjectName ProjectCode'],
    }, 'find');
    const byId = new Map((projects || []).map((project) => [String(project._id), project]));
    if (!byId.size) return [];
    const tasks = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [{ ProjectID: { $in: [...byId.keys()].map((id) => new mongoose.Types.ObjectId(id)) }, deletedStatusKey: { $ne: 1 }, mainChat: { $ne: true } }, `ProjectID ${TASK_FIELDS}`],
    }, 'find');
    return treeRows(tasks || []).map(({ task, ...place }) => workspaceTaskRow(task, byId.get(String(task.ProjectID)), place));
}

async function processJob(companyId, jobId) {
    const jobObjId = new mongoose.Types.ObjectId(jobId);
    const setStatus = (update) => MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.EXPORT_JOBS,
        data: [{ _id: jobObjId }, { $set: update }],
    }, 'updateOne');

    try {
        const job = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.EXPORT_JOBS,
            data: [{ _id: jobObjId }],
        }, 'findOne');
        if (!job) return;
        await setStatus({ status: 'processing' });

        const rows = job.type === WORKSPACE ? await workspaceRows(companyId, job.userId) : await projectRows(companyId, job);
        await fs.promises.mkdir(EXPORT_DIR, { recursive: true });
        const filePath = path.join(EXPORT_DIR, `${jobId}.${job.format}`);

        if (job.format === 'csv') {
            await fs.promises.writeFile(filePath, '﻿' + rowsToCsv(rows), 'utf8');
        } else {
            // Lazy require: a missing optional lib must fail THIS job with a
            // clear error, never the whole process at boot (staging 502 root
            // cause on 2026-06-10 — xlsx was a frontend-only dependency).
            const XLSX = require('xlsx');
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Tasks');
            XLSX.writeFile(workbook, filePath);
        }

        await setStatus({ status: 'done', total: rows.length, processed: rows.length, filePath });
        logger.info(`[exports] job ${jobId} done — ${rows.length} rows`);
    } catch (error) {
        logger.error(`[exports] job ${jobId} failed: ${error.message}`);
        await setStatus({ status: 'failed', error: String(error.message || error).slice(0, 300) }).catch(() => {});
    }
}

const sessionUid = (req) => (req.uid ? String(req.uid) : '');
const asksForAnotherUser = (req) => Boolean(req.query && req.query.uid) && String(req.query.uid) !== sessionUid(req);
const stampNow = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

exports.workspaceRows = workspaceRows;

exports.createExport = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const userId = sessionUid(req);
        const { format, projectId, sprintId, projectName } = req.body || {};
        const check = validateExportInput({ companyId, format, projectId, sprintId, userId });
        if (!check.valid) {
            return res.send({ status: false, statusText: check.reason });
        }
        const listable = await taskListProjectIds(companyId, userId);
        if (!listable.includes(String(projectId))) {
            return res.status(404).send({ status: false, statusText: 'Project not found.' });
        }
        if (sprintId && !(await canSeeSprintById(companyId, userId, sprintId))) {
            return res.status(404).send({ status: false, statusText: 'Sprint not found.' });
        }

        const job = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.EXPORT_JOBS,
            data: {
                userId,
                type: 'tasks',
                format,
                filters: { projectId, sprintId: sprintId || null },
                status: 'queued',
                fileName: buildFileName({ projectName, format, stamp: stampNow() }),
                total: 0,
                processed: 0,
            },
        }, 'save');

        setImmediate(() => { processJob(companyId, String(job._id)); });
        return res.send({ status: true, statusText: 'Export started.', data: job });
    } catch (error) {
        logger.error(`ERROR in create export: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* POST /api/v2/exports/workspace — every project's tasks, for an owner or admin. */
exports.createWorkspaceExport = async (req, res) => {
    try {
        const companyId = pinSessionTenant(req, res);
        if (!companyId) return undefined;
        const userId = sessionUid(req);
        if (!userId) return res.status(401).send({ status: false, statusText: 'A signed-in user is required.' });
        const format = (req.body && req.body.format) || 'xlsx';
        if (!FORMATS.includes(format)) return res.status(400).send({ status: false, statusText: `format must be one of: ${FORMATS.join(', ')}.` });
        if (!isPrivileged(await getRoleType(companyId, userId))) {
            return res.status(403).send({ status: false, statusText: 'Only an owner or admin can export the workspace.' });
        }

        const job = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.EXPORT_JOBS,
            data: {
                userId,
                type: WORKSPACE,
                format,
                filters: {},
                status: 'queued',
                fileName: buildFileName({ projectName: 'workspace', format, stamp: stampNow() }),
                total: 0,
                processed: 0,
            },
        }, 'save');

        setImmediate(() => { processJob(companyId, String(job._id)); });
        return res.send({ status: true, statusText: 'Export started.', data: { _id: job._id, type: job.type, format: job.format, status: job.status, fileName: job.fileName, createdAt: job.createdAt } });
    } catch (error) {
        logger.error(`ERROR in create workspace export: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

exports.listExports = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const userId = sessionUid(req);
        if (!companyId || !userId) {
            return res.send({ status: false, statusText: 'companyId and a session are required.' });
        }
        if (asksForAnotherUser(req)) {
            return res.status(403).send({ status: false, statusText: 'You can only list your own exports.' });
        }
        const jobs = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.EXPORT_JOBS,
            data: [{ userId }, 'type format status fileName total processed error createdAt', { sort: { createdAt: -1 }, limit: 20 }],
        }, 'find');
        return res.send({ status: true, statusText: 'Exports fetched.', data: jobs || [] });
    } catch (error) {
        logger.error(`ERROR in list exports: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

exports.downloadExport = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const userId = sessionUid(req);
        const { id } = req.params;
        if (!companyId || !userId || !/^[0-9a-fA-F]{24}$/.test(String(id))) {
            return res.status(400).send({ status: false, statusText: 'companyId, a session and a valid job id are required.' });
        }
        const job = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.EXPORT_JOBS,
            data: [{ _id: new mongoose.Types.ObjectId(id), userId }],
        }, 'findOne');
        if (!job || job.status !== 'done' || !job.filePath) {
            return res.status(404).send({ status: false, statusText: 'Export not ready.' });
        }
        if (job.type === WORKSPACE && !isPrivileged(await getRoleType(companyId, userId))) {
            return res.status(404).send({ status: false, statusText: 'Export not ready.' });
        }
        return res.download(job.filePath, job.fileName);
    } catch (error) {
        logger.error(`ERROR in download export: ${error.message}`);
        return res.status(500).send({ status: false, statusText: error.message });
    }
};
