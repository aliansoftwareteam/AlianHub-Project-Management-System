const fs = require("fs");
const path = require("path");
const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose");
const logger = require("../../Config/loggerConfig");
const { validateExportInput, buildFileName, taskToRow, rowsToCsv } = require('./helpers/exportRules');

// Async task exports. Jobs are persisted (queued → processing → done|failed)
// and processed in-process right after creation; files land under
// wasabiUploadsLocal/exports and stream back through the download endpoint
// (auth headers apply — the file path never leaves the server).

const EXPORT_DIR = path.join(process.cwd(), 'wasabiUploadsLocal', 'exports');

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

        const filter = {
            ProjectID: new mongoose.Types.ObjectId(job.filters.projectId),
            deletedStatusKey: { $ne: 1 },
        };
        if (job.filters.sprintId) {
            filter.sprintId = new mongoose.Types.ObjectId(job.filters.sprintId);
        }
        const tasks = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [filter, 'TaskKey TaskName status statusType Task_Priority AssigneeUserId DueDate totalEstimatedTime createdAt updatedAt'],
        }, 'find');

        const rows = (tasks || []).map(taskToRow);
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

/* POST /api/v2/exports  body: { format, projectId, sprintId?, projectName?, userData } */
exports.createExport = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { format, projectId, sprintId, projectName, userData } = req.body || {};
        const userId = userData && (userData.id || userData._id) ? String(userData.id || userData._id) : '';
        const check = validateExportInput({ companyId, format, projectId, sprintId, userId });
        if (!check.valid) {
            return res.send({ status: false, statusText: check.reason });
        }

        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        const job = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.EXPORT_JOBS,
            data: {
                userId,
                type: 'tasks',
                format,
                filters: { projectId, sprintId: sprintId || null },
                status: 'queued',
                fileName: buildFileName({ projectName, format, stamp }),
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

/* GET /api/v2/exports?uid= — caller's jobs, newest first. */
exports.listExports = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const userId = String(req.query?.uid || '');
        if (!companyId || !userId) {
            return res.send({ status: false, statusText: 'companyId and uid are required.' });
        }
        const jobs = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.EXPORT_JOBS,
            data: [{ userId }, 'format status fileName total processed error createdAt', { sort: { createdAt: -1 }, limit: 20 }],
        }, 'find');
        return res.send({ status: true, statusText: 'Exports fetched.', data: jobs || [] });
    } catch (error) {
        logger.error(`ERROR in list exports: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* GET /api/v2/exports/:id/download?uid= */
exports.downloadExport = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const userId = String(req.query?.uid || '');
        const { id } = req.params;
        if (!companyId || !userId || !/^[0-9a-fA-F]{24}$/.test(String(id))) {
            return res.status(400).send({ status: false, statusText: 'companyId, uid and a valid job id are required.' });
        }
        const job = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.EXPORT_JOBS,
            data: [{ _id: new mongoose.Types.ObjectId(id), userId }],
        }, 'findOne');
        if (!job || job.status !== 'done' || !job.filePath) {
            return res.status(404).send({ status: false, statusText: 'Export not ready.' });
        }
        return res.download(job.filePath, job.fileName);
    } catch (error) {
        logger.error(`ERROR in download export: ${error.message}`);
        return res.status(500).send({ status: false, statusText: error.message });
    }
};
