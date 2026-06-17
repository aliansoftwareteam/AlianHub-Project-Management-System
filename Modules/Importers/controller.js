const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { dbCollections, settingsCollectionDocs } = require("../../Config/collections");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose");
const logger = require("../../Config/loggerConfig");
const { taskMongo } = require('../Tasks/helpers/task_class_Mongo');
const { validateImportInput, transformJiraRows } = require('./helpers/jiraRules');
const { validateCsvInput, transformCsvRows } = require('./helpers/csvRules');
const { validateTrelloInput, parseTrelloBoard } = require('./helpers/trelloRules');

// Jira importer. The client parses the Jira CSV export (the xlsx lib reads
// CSV) and posts plain rows; the server maps statuses/priorities and feeds
// the existing createMultipleTasks pipeline so keys, counters and sockets
// all behave exactly like a native bulk import. Every run is recorded in
// importJobs.

/* POST /api/v2/imports/jira
 * body: { rows, projectId, sprintId, sprintName?, folderId?, folderName?, userData } */
exports.importFromJira = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { rows, projectId, sprintId, sprintName, folderId, folderName, userData } = req.body || {};
        const userId = userData && (userData.id || userData._id) ? String(userData.id || userData._id) : '';
        const check = validateImportInput({ companyId, projectId, sprintId, rows, userId });
        if (!check.valid) return res.send({ status: false, statusText: check.reason });

        const ctx = await loadImportContext(companyId, projectId);
        if (ctx.error) return res.send({ status: false, statusText: ctx.error });

        const { tasks, skipped } = transformJiraRows({ rows, statusNames: ctx.statusArray.map((status) => status.name), leaderId: userId });
        if (!tasks.length) return res.send({ status: false, statusText: 'No importable rows found (a Summary column is required).' });

        const out = await finishImport(companyId, { source: 'jira', project: ctx.project, sprintId, sprintName, folderId, folderName, userData, statusArray: ctx.statusArray, tasks, skipped });
        return res.send(out);
    } catch (error) {
        logger.error(`ERROR in jira import: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* GET /api/v2/imports?uid= — caller's import history. */
exports.listImports = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const userId = String(req.query?.uid || '');
        if (!companyId || !userId) {
            return res.send({ status: false, statusText: 'companyId and uid are required.' });
        }
        const jobs = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.IMPORT_JOBS,
            data: [{ userId }, 'source status total processed created errorList createdAt', { sort: { createdAt: -1 }, limit: 20 }],
        }, 'find');
        return res.send({ status: true, statusText: 'Imports fetched.', data: jobs || [] });
    } catch (error) {
        logger.error(`ERROR in list imports: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

// ── Shared pipeline for the CSV + Trello importers (mirrors importFromJira) ──

const STATUS_FALLBACK_TYPE = 'default_active';

/* Load the project + a usable task-status list. Prefer the PROJECT's own
 * taskStatusData (it matches the board, including any custom statuses); fall back
 * to the company task-status template only if the project has none. Every entry
 * is normalized so it always carries a type/key — otherwise createMultipleTasks
 * builds a task with an empty statusType and the task schema (statusType is
 * required) rejects the whole import. Returns { project, statusArray } or { error }. */
const loadImportContext = async (companyId, projectId) => {
    const project = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS,
        data: [{ _id: new mongoose.Types.ObjectId(projectId) }],
    }, 'findOne');
    if (!project) return { error: 'Project not found.' };

    let source = Array.isArray(project.taskStatusData) ? project.taskStatusData : [];
    if (!source.length) {
        const statusDocs = await MongoDbCrudOpration(companyId, {
            type: dbCollections.SETTINGS,
            data: [{ name: settingsCollectionDocs.TASK_STATUS }],
        }, 'find');
        source = (statusDocs && statusDocs[0] && statusDocs[0].settings) || [];
    }
    const statusArray = source
        .filter((status) => status && status.name !== undefined && status.name !== null && String(status.name).trim() !== '')
        .map((status, idx) => ({
            name: status.name,
            key: (status.key !== undefined && status.key !== null) ? status.key : idx + 1,
            type: status.type || STATUS_FALLBACK_TYPE,
        }));
    if (!statusArray.length) return { error: 'No task statuses configured for this project.' };
    return { project, statusArray };
};

/* Record the job, feed the bulk-create pipeline, update the job. Returns the
 * response envelope. Identical create path to the Jira importer. */
const finishImport = async (companyId, { source, project, sprintId, sprintName, folderId, folderName, userData, statusArray, tasks, skipped }) => {
    const userId = String((userData && (userData.id || userData._id)) || '');
    const job = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.IMPORT_JOBS,
        data: {
            userId,
            source,
            projectId: project._id,
            sprintId: new mongoose.Types.ObjectId(sprintId),
            status: 'processing',
            total: tasks.length,
            processed: 0,
            created: 0,
            errorList: [],
        },
    }, 'save');

    const projectData = {
        _id: project._id,
        CompanyId: companyId,
        ProjectName: project.ProjectName,
        ProjectCode: project.ProjectCode,
        lastTaskId: project.lastTaskId,
    };
    const sprint = { id: sprintId, name: sprintName || '' };
    if (folderId) {
        sprint.folderId = folderId;
        sprint.folderName = folderName || '';
    }
    const tasksWithSprint = tasks.map((task) => ({ ...task, sprintId, sprintArray: sprint }));

    try {
        const result = await taskMongo.createMultipleTasks({
            tasks: tasksWithSprint,
            userData: { id: userId, Employee_Name: (userData && userData.Employee_Name) || '', companyOwnerId: (userData && userData.companyOwnerId) || '' },
            projectData,
            indexObj: {},
            statusArray,
            sprint,
        });
        const createdCount = Array.isArray(result?.data) ? result.data.length : tasks.length;
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.IMPORT_JOBS,
            data: [{ _id: job._id }, { $set: { status: 'done', processed: tasks.length, created: createdCount } }],
        }, 'updateOne');
        return { status: true, statusText: `Imported ${createdCount} tasks from ${source} (${skipped} skipped).`, data: { jobId: job._id, created: createdCount, skipped } };
    } catch (creationError) {
        logger.error(`[importers] ${source} job ${job._id} failed: ${creationError.message}`);
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.IMPORT_JOBS,
            data: [{ _id: job._id }, { $set: { status: 'failed', errorList: [String(creationError.message || creationError).slice(0, 300)] } }],
        }, 'updateOne').catch(() => {});
        return { status: false, statusText: `Import failed: ${creationError.message}` };
    }
};

/* POST /api/v2/imports/csv
 * body: { rows, mapping?, projectId, sprintId, sprintName?, folderId?, folderName?, userData } */
exports.importFromCsv = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { rows, mapping, projectId, sprintId, sprintName, folderId, folderName, userData } = req.body || {};
        const userId = userData && (userData.id || userData._id) ? String(userData.id || userData._id) : '';
        const check = validateCsvInput({ companyId, projectId, sprintId, rows, userId });
        if (!check.valid) return res.send({ status: false, statusText: check.reason });

        const ctx = await loadImportContext(companyId, projectId);
        if (ctx.error) return res.send({ status: false, statusText: ctx.error });

        const { tasks, skipped } = transformCsvRows({ rows, mapping, statusNames: ctx.statusArray.map((status) => status.name), leaderId: userId });
        if (!tasks.length) return res.send({ status: false, statusText: 'No importable rows found (a task-name column is required).' });

        const out = await finishImport(companyId, { source: 'csv', project: ctx.project, sprintId, sprintName, folderId, folderName, userData, statusArray: ctx.statusArray, tasks, skipped });
        return res.send(out);
    } catch (error) {
        logger.error(`ERROR in csv import: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* POST /api/v2/imports/trello
 * body: { board, projectId, sprintId, sprintName?, folderId?, folderName?, userData } */
exports.importFromTrello = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { board, projectId, sprintId, sprintName, folderId, folderName, userData } = req.body || {};
        const userId = userData && (userData.id || userData._id) ? String(userData.id || userData._id) : '';
        const check = validateTrelloInput({ companyId, projectId, sprintId, board, userId });
        if (!check.valid) return res.send({ status: false, statusText: check.reason });

        const ctx = await loadImportContext(companyId, projectId);
        if (ctx.error) return res.send({ status: false, statusText: ctx.error });

        const { tasks, skipped } = parseTrelloBoard({ board, statusNames: ctx.statusArray.map((status) => status.name), leaderId: userId });
        if (!tasks.length) return res.send({ status: false, statusText: 'No importable cards found.' });

        const out = await finishImport(companyId, { source: 'trello', project: ctx.project, sprintId, sprintName, folderId, folderName, userData, statusArray: ctx.statusArray, tasks, skipped });
        return res.send(out);
    } catch (error) {
        logger.error(`ERROR in trello import: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};
