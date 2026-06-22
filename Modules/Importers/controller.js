const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { dbCollections, settingsCollectionDocs } = require("../../Config/collections");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose");
const logger = require("../../Config/loggerConfig");
const { taskMongo } = require('../Tasks/helpers/task_class_Mongo');
const { validateImportInput, transformJiraRows } = require('./helpers/jiraRules');
const { validateCsvInput, transformCsvRows } = require('./helpers/csvRules');
const { validateTrelloInput, parseTrelloBoard } = require('./helpers/trelloRules');
const { validateAsanaInput, parseAsanaExport } = require('./helpers/asanaRules');
const { validateMondayInput, parseMondayExport } = require('./helpers/mondayRules');

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

/* Map the parser's rich card data onto each task into the shapes the task
 * create path persists (S3-01): resolve member emails → assignees, build
 * checklistArray + attachment link-references, and fold Trello labels into the
 * description (there is no programmatic tag-create path). Mutates `tasks`; a
 * no-op for CSV/Jira tasks, which carry none of these fields. */
const enrichImportTasks = async (companyId, tasks) => {
    const emails = Array.from(new Set(
        tasks.flatMap((t) => (Array.isArray(t.memberEmails) ? t.memberEmails : [])).filter(Boolean),
    ));
    const emailToId = {};
    if (emails.length) {
        try {
            const users = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
                type: SCHEMA_TYPE.USERS,
                data: [{ Employee_Email: { $in: emails } }, { _id: 1, Employee_Email: 1 }],
            }, 'find');
            (users || []).forEach((u) => {
                if (u && u.Employee_Email) emailToId[String(u.Employee_Email).toLowerCase()] = String(u._id);
            });
        } catch (error) {
            logger.error(`[importers] member email resolve failed: ${error.message}`);
        }
    }

    tasks.forEach((task) => {
        if (Array.isArray(task.memberEmails) && task.memberEmails.length) {
            const ids = task.memberEmails.map((e) => emailToId[String(e).toLowerCase()]).filter(Boolean);
            if (ids.length) task.AssigneeUserId = Array.from(new Set([...(task.AssigneeUserId || []), ...ids]));
        }
        if (Array.isArray(task.checklists) && task.checklists.length) {
            task.checklistArray = task.checklists.map((cl) => ({
                id: new mongoose.Types.ObjectId().toString(),
                name: cl.name || 'Checklist',
                items: (Array.isArray(cl.items) ? cl.items : []).map((it) => ({ name: it.name, isChecked: !!it.isChecked })),
            }));
        }
        if (Array.isArray(task.attachments) && task.attachments.length) {
            task.attachments = task.attachments.map((att) => ({
                id: new mongoose.Types.ObjectId().toString(),
                filename: att.name || att.url,
                mediaURL: att.url,
                size: att.bytes || 0,
                type: 'link',
            }));
        }
        if (Array.isArray(task.labels) && task.labels.length) {
            const names = task.labels.map((l) => l && l.name).filter(Boolean);
            if (names.length) {
                task.rawDescription = `${task.rawDescription || ''}${task.rawDescription ? '\n\n' : ''}Labels: ${names.join(', ')}`.slice(0, 10000);
            }
        }
    });
};

/* Create the parsed Trello comments on the freshly-created tasks. Each input
 * task was stamped with `createdTaskId` by createMultipleTasks. Best-effort:
 * a failed comment never fails the import. */
const createImportComments = async (companyId, projectData, sprintId, folderId, tasks, userId) => {
    for (const task of tasks) {
        if (!task.createdTaskId || !Array.isArray(task.comments) || !task.comments.length) continue;
        for (const c of task.comments) {
            if (!c || !c.text) continue;
            const body = `${c.author ? c.author + ': ' : ''}${c.text}`.slice(0, 10000);
            try {
                await MongoDbCrudOpration(companyId, {
                    type: SCHEMA_TYPE.COMMENTS,
                    data: {
                        message: body,
                        userId,
                        type: 'text',
                        projectId: new mongoose.Types.ObjectId(projectData._id),
                        taskId: new mongoose.Types.ObjectId(task.createdTaskId),
                        sprintId: new mongoose.Types.ObjectId(sprintId),
                        project: false,
                        ...(folderId ? { folderId: new mongoose.Types.ObjectId(folderId) } : {}),
                    },
                }, 'save');
            } catch (error) {
                logger.error(`[importers] comment import failed for task ${task.createdTaskId}: ${error.message}`);
            }
        }
    }
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
    // S3-01: fold Trello rich data (checklists, attachments, members, labels)
    // onto each task before creation; comments are added after (they need ids).
    await enrichImportTasks(companyId, tasks);
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
        await createImportComments(companyId, projectData, sprintId, folderId, tasksWithSprint, userId)
            .catch((commentErr) => logger.error(`[importers] comment import error: ${commentErr.message}`));
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

/* POST /api/v2/imports/asana
 * body: { asana, projectId, sprintId, sprintName?, folderId?, folderName?, userData } */
exports.importFromAsana = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { asana, projectId, sprintId, sprintName, folderId, folderName, userData } = req.body || {};
        const userId = userData && (userData.id || userData._id) ? String(userData.id || userData._id) : '';
        const check = validateAsanaInput({ companyId, projectId, sprintId, asana, userId });
        if (!check.valid) return res.send({ status: false, statusText: check.reason });

        const ctx = await loadImportContext(companyId, projectId);
        if (ctx.error) return res.send({ status: false, statusText: ctx.error });

        const { tasks, skipped } = parseAsanaExport({ asana, statusNames: ctx.statusArray.map((status) => status.name), leaderId: userId });
        if (!tasks.length) return res.send({ status: false, statusText: 'No importable tasks found.' });

        const out = await finishImport(companyId, { source: 'asana', project: ctx.project, sprintId, sprintName, folderId, folderName, userData, statusArray: ctx.statusArray, tasks, skipped });
        return res.send(out);
    } catch (error) {
        logger.error(`ERROR in asana import: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* POST /api/v2/imports/monday
 * body: { rows, mapping?, projectId, sprintId, sprintName?, folderId?, folderName?, userData } */
exports.importFromMonday = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { rows, mapping, projectId, sprintId, sprintName, folderId, folderName, userData } = req.body || {};
        const userId = userData && (userData.id || userData._id) ? String(userData.id || userData._id) : '';
        const check = validateMondayInput({ companyId, projectId, sprintId, rows, userId });
        if (!check.valid) return res.send({ status: false, statusText: check.reason });

        const ctx = await loadImportContext(companyId, projectId);
        if (ctx.error) return res.send({ status: false, statusText: ctx.error });

        const { tasks, skipped } = parseMondayExport({ rows, mapping, statusNames: ctx.statusArray.map((status) => status.name), leaderId: userId });
        if (!tasks.length) return res.send({ status: false, statusText: 'No importable rows found (a task-name column is required).' });

        const out = await finishImport(companyId, { source: 'monday', project: ctx.project, sprintId, sprintName, folderId, folderName, userData, statusArray: ctx.statusArray, tasks, skipped });
        return res.send(out);
    } catch (error) {
        logger.error(`ERROR in monday import: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};
