const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { dbCollections, settingsCollectionDocs } = require("../../Config/collections");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose");
const logger = require("../../Config/loggerConfig");
const { taskMongo } = require('../Tasks/helpers/task_class_Mongo');
const { validateImportInput, transformJiraRows } = require('./helpers/jiraRules');
const { validateCsvInput, validateCsvRows, transformCsvRows, TARGETS } = require('./helpers/csvRules');
const { validateTrelloInput, parseTrelloBoard } = require('./helpers/trelloRules');
const { validateAsanaInput, parseAsanaExport } = require('./helpers/asanaRules');
const { validateMondayInput, parseMondayExport } = require('./helpers/mondayRules');
const { validateClickUpInput, validateClickUpRows, transformClickUpRows, previewClickUpRows, clickUpStatuses, resolveStatuses, DEFAULT_LIST } = require('./helpers/clickupRules');
const { STATUS_FALLBACK_TYPE, appendStatuses, applyImportTags } = require('./helpers/projectDetails');
const { mapStatusName } = require('./helpers/jiraRules');
const { importTargetAccess, previewAccess, refuseImport } = require('./helpers/importAccess');
const { findCompanyMembers, activeMemberIdSet } = require('./helpers/companyMembers');
const { sessionActor } = require('../Tasks/helpers/taskWriteFields');
const { sprintPlacementOf } = require('../Tasks/helpers/sprintPlacement');
const { pinSessionTenant } = require('../../Config/tenant');
const socketEmitter = require('../../event/socketEventEmitter');
const { updateUnReadCommentsCountFun } = require('../notification-count/controller');

// Jira importer. The client parses the Jira CSV export (the xlsx lib reads
// CSV) and posts plain rows; the server maps statuses/priorities and feeds
// the existing createMultipleTasks pipeline so keys, counters and sockets
// all behave exactly like a native bulk import. Every run is recorded in
// importJobs.

/* POST /api/v2/imports/jira
 * body: { rows, projectId, sprintId } */
exports.importFromJira = async (req, res) => {
    try {
        const companyId = pinSessionTenant(req, res);
        if (!companyId) return undefined;
        const { rows, projectId, sprintId } = req.body || {};
        const userId = String(req.uid || '');
        const check = validateImportInput({ companyId, projectId, sprintId, rows, userId });
        if (!check.valid) return res.send({ status: false, statusText: check.reason });

        const target = await importTargetAccess(companyId, userId, { projectId, sprintId });
        if (!target.allowed) return refuseImport(res, target);

        const ctx = await loadImportContext(companyId, projectId);
        if (ctx.error) return res.send({ status: false, statusText: ctx.error });

        const { tasks, skipped } = transformJiraRows({ rows, statusNames: ctx.statusArray.map((status) => status.name), leaderId: userId });
        if (!tasks.length) return res.send({ status: false, statusText: 'No importable rows found (a Summary column is required).' });

        const out = await finishImport(companyId, { source: 'jira', project: ctx.project, sprint: target.sprint, actor: await sessionActor(req), statusArray: ctx.statusArray, tasks, skipped });
        return res.send(out);
    } catch (error) {
        logger.error(`ERROR in jira import: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

exports.listImports = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const userId = req.uid ? String(req.uid) : '';
        if (!companyId || !userId) {
            return res.send({ status: false, statusText: 'companyId and a session are required.' });
        }
        if (req.query && req.query.uid && String(req.query.uid) !== userId) {
            return res.status(403).send({ status: false, statusText: 'You can only list your own imports.' });
        }
        // The task copy of a duplicated project keeps its progress in this collection too (Modules/ProjectDuplicate).
        const jobs = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.IMPORT_JOBS,
            data: [{ userId, source: { $ne: 'duplicate' } }, 'source status total processed created errorList createdAt', { sort: { createdAt: -1 }, limit: 20 }],
        }, 'find');
        return res.send({ status: true, statusText: 'Imports fetched.', data: jobs || [] });
    } catch (error) {
        logger.error(`ERROR in list imports: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

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

// A CSV person mapping carries user ids chosen by the client.
const keepMemberAssignees = async (companyId, tasks) => {
    const assigned = tasks.flatMap((task) => (Array.isArray(task.AssigneeUserId) ? task.AssigneeUserId : []));
    if (!assigned.length) return;
    let members = new Set();
    try {
        members = await activeMemberIdSet(companyId, assigned);
    } catch (error) {
        logger.error(`[importers] assignee membership check failed: ${error.message}`);
    }
    tasks.forEach((task) => {
        if (Array.isArray(task.AssigneeUserId)) task.AssigneeUserId = task.AssigneeUserId.filter((id) => members.has(String(id)));
    });
};

/* Map the parser's rich card data onto each task into the shapes the task
 * create path persists (S3-01): resolve member emails → assignees, build
 * checklistArray + attachment link-references, and fold Trello labels into the
 * description (there is no programmatic tag-create path). Mutates `tasks`.
 * Every assignee, whatever the source, must hold an active seat in the company. */
const enrichImportTasks = async (companyId, tasks) => {
    const emails = Array.from(new Set(
        tasks.flatMap((t) => (Array.isArray(t.memberEmails) ? t.memberEmails : [])).filter(Boolean),
    ));
    const emailToId = {};
    if (emails.length) {
        try {
            const users = await findCompanyMembers(companyId, { Employee_Email: { $in: emails } }, { _id: 1, Employee_Email: 1 });
            users.forEach((u) => {
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
    });
    await keepMemberAssignees(companyId, tasks);
    const unmatchedEmails = emails.filter((email) => !emailToId[String(email).toLowerCase()]);

    tasks.forEach((task) => {
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
    return { unmatchedEmails };
};

/* The people a comment written in the app counts for: the task's watchers and assignees, other than its author. */
const countImportedComments = async (companyId, { projectId, sprintId, taskId, authorId, count }) => {
    const task = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [{ _id: new mongoose.Types.ObjectId(taskId) }, { watchers: 1, AssigneeUserId: 1, ParentTaskId: 1 }],
    }, 'findOne');
    if (!task) return;
    const people = [...(task.watchers || []), ...(task.AssigneeUserId || [])].map(String).filter((id) => id !== String(authorId));
    const userIds = [...await activeMemberIdSet(companyId, people)];
    if (!userIds.length) return;
    await updateUnReadCommentsCountFun({ body: {
        companyId, key: 2, projectId: String(projectId), sprintId: String(sprintId), taskId: String(taskId), userIds, messageCount: count,
        ...(task.ParentTaskId ? { parentTaskId: String(task.ParentTaskId) } : {}),
    } });
};

/* Create the parsed Trello comments on the freshly-created tasks. Each input
 * task was stamped with `createdTaskId` by createMultipleTasks. Best-effort:
 * a failed comment never fails the import. */
const createImportComments = async (companyId, projectData, sprintId, folderId, tasks, userId) => {
    for (const task of tasks) {
        if (!task.createdTaskId || !Array.isArray(task.comments) || !task.comments.length) continue;
        let saved = 0;
        for (const c of task.comments) {
            if (!c || !c.text) continue;
            const body = `${c.author ? c.author + ': ' : ''}${c.text}`.slice(0, 10000);
            try {
                const comment = await MongoDbCrudOpration(companyId, {
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
                saved += 1;
                socketEmitter.emit('insert', { type: 'insert', data: comment, updatedFields: {}, module: 'comments', companyId });
            } catch (error) {
                logger.error(`[importers] comment import failed for task ${task.createdTaskId}: ${error.message}`);
            }
        }
        if (!saved) continue;
        await countImportedComments(companyId, { projectId: projectData._id, sprintId, taskId: task.createdTaskId, authorId: userId, count: saved })
            .catch((error) => logger.error(`[importers] comment count failed for task ${task.createdTaskId}: ${error.message || error.statusText || error}`));
    }
};

/* Record the job, feed the bulk-create pipeline, update the job. Returns the
 * response envelope. Identical create path to the Jira importer. */
const finishImport = async (companyId, { source, project, sprint, actor, statusArray, tasks, skipped, addsTags = false, report = null }) => {
    const userId = actor.id;
    const sprintId = sprint.id;
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
    // S3-01: fold Trello rich data (checklists, attachments, members, labels)
    // onto each task before creation; comments are added after (they need ids).
    const { unmatchedEmails } = await enrichImportTasks(companyId, tasks);
    await applyImportTags(companyId, project, tasks, { create: addsTags });
    const tasksWithSprint = tasks.map((task) => ({ ...task, sprintId, sprintArray: sprint }));

    try {
        const result = await taskMongo.createMultipleTasks({
            tasks: tasksWithSprint,
            userData: actor,
            projectData,
            indexObj: {},
            statusArray,
            sprint,
        });
        await createImportComments(companyId, projectData, sprintId, sprint.folderId, tasksWithSprint, userId)
            .catch((commentErr) => logger.error(`[importers] comment import error: ${commentErr.message}`));
        const createdCount = Array.isArray(result?.data) ? result.data.length : tasks.length;
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.IMPORT_JOBS,
            data: [{ _id: job._id }, { $set: { status: 'done', processed: tasks.length, created: createdCount } }],
        }, 'updateOne');
        const detail = report ? { skippedRows: report.skippedRows, unmatchedAssignees: [...unmatchedEmails, ...report.unnamedAssignees] } : {};
        return { status: true, statusText: `Imported ${createdCount} tasks from ${source} (${skipped} skipped).`, data: { jobId: job._id, projectId: String(project._id), created: createdCount, skipped, ...detail } };
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
 * body: { rows, mapping?, projectId, sprintId } */
exports.importFromCsv = async (req, res) => {
    try {
        const companyId = pinSessionTenant(req, res);
        if (!companyId) return undefined;
        const { rows, mapping, projectId, sprintId } = req.body || {};
        const userId = String(req.uid || '');
        const check = validateCsvInput({ companyId, projectId, sprintId, rows, userId });
        if (!check.valid) return res.send({ status: false, statusText: check.reason });

        const options = req.body.options || {};
        const target = await importTargetAccess(companyId, userId, { projectId, sprintId, addsStatuses: Boolean(options.createMissingStatuses) });
        if (!target.allowed) return refuseImport(res, target);

        const ctx = await loadImportContext(companyId, projectId);
        if (ctx.error) return res.send({ status: false, statusText: ctx.error });

        const directory = await loadUserDirectory(companyId, rows, mapping);
        const statusArray = options.createMissingStatuses
            ? await createMissingStatuses(companyId, ctx.project, ctx.statusArray, rows, mapping)
            : ctx.statusArray;
        const { tasks, skipped } = transformCsvRows({
            rows,
            mapping,
            statusNames: statusArray.map((status) => status.name),
            leaderId: userId,
            users: directory,
            options,
        });
        if (!tasks.length) return res.send({ status: false, statusText: 'No importable rows found (a task-name column is required).' });

        const out = await finishImport(companyId, { source: 'csv', project: ctx.project, sprint: target.sprint, actor: await sessionActor(req), statusArray, tasks, skipped, addsTags: Boolean(options.createMissingStatuses) });
        return res.send(out);
    } catch (error) {
        logger.error(`ERROR in csv import: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* POST /api/v2/imports/trello
 * body: { board, projectId, sprintId } */
exports.importFromTrello = async (req, res) => {
    try {
        const companyId = pinSessionTenant(req, res);
        if (!companyId) return undefined;
        const { board, projectId, sprintId } = req.body || {};
        const userId = String(req.uid || '');
        const check = validateTrelloInput({ companyId, projectId, sprintId, board, userId });
        if (!check.valid) return res.send({ status: false, statusText: check.reason });

        const target = await importTargetAccess(companyId, userId, { projectId, sprintId });
        if (!target.allowed) return refuseImport(res, target);

        const ctx = await loadImportContext(companyId, projectId);
        if (ctx.error) return res.send({ status: false, statusText: ctx.error });

        const { tasks, skipped } = parseTrelloBoard({ board, statusNames: ctx.statusArray.map((status) => status.name), leaderId: userId });
        if (!tasks.length) return res.send({ status: false, statusText: 'No importable cards found.' });

        const out = await finishImport(companyId, { source: 'trello', project: ctx.project, sprint: target.sprint, actor: await sessionActor(req), statusArray: ctx.statusArray, tasks, skipped });
        return res.send(out);
    } catch (error) {
        logger.error(`ERROR in trello import: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* POST /api/v2/imports/asana
 * body: { asana, projectId, sprintId } */
exports.importFromAsana = async (req, res) => {
    try {
        const companyId = pinSessionTenant(req, res);
        if (!companyId) return undefined;
        const { asana, projectId, sprintId } = req.body || {};
        const userId = String(req.uid || '');
        const check = validateAsanaInput({ companyId, projectId, sprintId, asana, userId });
        if (!check.valid) return res.send({ status: false, statusText: check.reason });

        const target = await importTargetAccess(companyId, userId, { projectId, sprintId });
        if (!target.allowed) return refuseImport(res, target);

        const ctx = await loadImportContext(companyId, projectId);
        if (ctx.error) return res.send({ status: false, statusText: ctx.error });

        const { tasks, skipped } = parseAsanaExport({ asana, statusNames: ctx.statusArray.map((status) => status.name), leaderId: userId });
        if (!tasks.length) return res.send({ status: false, statusText: 'No importable tasks found.' });

        const out = await finishImport(companyId, { source: 'asana', project: ctx.project, sprint: target.sprint, actor: await sessionActor(req), statusArray: ctx.statusArray, tasks, skipped });
        return res.send(out);
    } catch (error) {
        logger.error(`ERROR in asana import: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* POST /api/v2/imports/monday
 * body: { rows, mapping?, projectId, sprintId } */
exports.importFromMonday = async (req, res) => {
    try {
        const companyId = pinSessionTenant(req, res);
        if (!companyId) return undefined;
        const { rows, mapping, projectId, sprintId } = req.body || {};
        const userId = String(req.uid || '');
        const check = validateMondayInput({ companyId, projectId, sprintId, rows, userId });
        if (!check.valid) return res.send({ status: false, statusText: check.reason });

        const target = await importTargetAccess(companyId, userId, { projectId, sprintId });
        if (!target.allowed) return refuseImport(res, target);

        const ctx = await loadImportContext(companyId, projectId);
        if (ctx.error) return res.send({ status: false, statusText: ctx.error });

        const { tasks, skipped } = parseMondayExport({ rows, mapping, statusNames: ctx.statusArray.map((status) => status.name), leaderId: userId });
        if (!tasks.length) return res.send({ status: false, statusText: 'No importable rows found (a task-name column is required).' });

        const out = await finishImport(companyId, { source: 'monday', project: ctx.project, sprint: target.sprint, actor: await sessionActor(req), statusArray: ctx.statusArray, tasks, skipped });
        return res.send(out);
    } catch (error) {
        logger.error(`ERROR in monday import: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* The people a CSV names, resolved among the company's members so the mapping
 * step can say which ones it could not match. */
const loadUserDirectory = async (companyId, rows, mapping) => {
    const column = mapping && mapping.assignee;
    const wanted = new Set();
    (rows || []).forEach((row) => {
        const raw = column ? row[column] : (row.Assignee || row.assignee || row['Assigned To']);
        const value = raw === undefined || raw === null ? '' : String(raw).trim();
        if (value) wanted.add(value.toLowerCase());
    });
    if (!wanted.size) return [];
    try {
        const users = await findCompanyMembers(companyId, { $or: [{ Employee_Email: { $in: [...wanted] } }, { Employee_Name: { $in: [...wanted] } }] }, { _id: 1, Employee_Email: 1, Employee_Name: 1 });
        return users.map((user) => ({ id: String(user._id), email: user.Employee_Email || '', name: user.Employee_Name || '' }));
    } catch (error) {
        logger.error(`[importers] user directory lookup failed: ${error.message}`);
        return [];
    }
};

/* POST /api/v2/imports/csv/preview
 * body: { rows, mapping?, projectId, options? }
 * Step 3 of the wizard: per-row validation with nothing written. */
exports.previewCsv = async (req, res) => {
    try {
        const companyId = pinSessionTenant(req, res);
        if (!companyId) return undefined;
        const { rows, mapping, projectId, options } = req.body || {};
        if (!Array.isArray(rows) || !rows.length) return res.send({ status: false, statusText: 'rows must be a non-empty array.' });

        const project = await previewAccess(companyId, req.uid, projectId);
        if (!project.allowed) return refuseImport(res, project);

        const ctx = await loadImportContext(companyId, projectId);
        if (ctx.error) return res.send({ status: false, statusText: ctx.error });

        const directory = await loadUserDirectory(companyId, rows, mapping);
        const report = validateCsvRows({
            rows,
            mapping,
            statusNames: ctx.statusArray.map((status) => status.name),
            users: directory,
            options: options || {},
        });

        return res.send({
            status: true,
            statusText: 'Preview ready.',
            data: {
                ...report,
                targets: TARGETS.map((target) => ({ key: target.key, label: target.label, parse: target.parse, required: !!target.required })),
                statuses: ctx.statusArray.map((status) => status.name),
                matchedUsers: directory,
            },
        });
    } catch (error) {
        logger.error(`ERROR in csv preview: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* "Create missing" on the mapping step: any status the file uses that the
 * project does not have is appended to the project's own status list before the
 * tasks are created, so those rows keep their status instead of collapsing onto
 * the first one. Returns the status list to import against. */
const createMissingStatuses = async (companyId, project, statusArray, rows, mapping) => {
    const column = mapping && mapping.status;
    const wanted = (rows || []).map((row) => {
        const raw = column ? row[column] : (row.Status || row.status);
        return { name: raw === undefined || raw === null ? '' : String(raw).trim(), type: STATUS_FALLBACK_TYPE };
    });
    try {
        return await appendStatuses(companyId, project, statusArray, wanted);
    } catch (error) {
        logger.error(`[importers] could not add statuses to project ${project._id}: ${error.message}`);
        return statusArray;
    }
};

const lowerName = (value) => String(value === undefined || value === null ? '' : value).trim().toLowerCase();

/* The project statuses a ClickUp file lands on, adding the missing ones when allowed. */
const clickUpStatusContext = async (companyId, project, statusArray, rows, addsStatuses) => {
    const { mapping, missing } = resolveStatuses({ wanted: clickUpStatuses(rows), existing: statusArray });
    let statuses = statusArray;
    if (missing.length && addsStatuses) {
        try {
            statuses = await appendStatuses(companyId, project, statusArray, missing);
        } catch (error) {
            logger.error(`[importers] could not add statuses to project ${project._id}: ${error.message}`);
        }
    }
    const names = statuses.map((status) => status.name);
    const statusFor = (raw) => {
        const mapped = mapping[lowerName(raw)];
        return names.includes(mapped) ? mapped : mapStatusName(raw, names);
    };
    return { statusArray: statuses, statusFor };
};

const runClickUpImport = async (req, { companyId, userId, project, sprint, statusArray, rows, addsDetails }) => {
    const context = await clickUpStatusContext(companyId, project, statusArray, rows, addsDetails);
    const { tasks, skipped, skippedRows, unnamedAssignees } = transformClickUpRows({ rows, statusFor: context.statusFor, leaderId: userId });
    if (!tasks.length) return { status: false, statusText: 'No importable tasks found (every row needs a task name).' };
    return finishImport(companyId, {
        source: 'clickup',
        project,
        sprint,
        actor: await sessionActor(req),
        statusArray: context.statusArray,
        tasks,
        skipped,
        addsTags: addsDetails,
        report: { skippedRows, unnamedAssignees },
    });
};

/* POST /api/v2/imports/clickup
 * body: { rows, projectId, sprintId, options: { createMissingStatuses } } */
exports.importFromClickUp = async (req, res) => {
    try {
        const companyId = pinSessionTenant(req, res);
        if (!companyId) return undefined;
        const { rows, projectId, sprintId } = req.body || {};
        const options = (req.body && req.body.options) || {};
        const userId = String(req.uid || '');
        const check = validateClickUpInput({ companyId, projectId, sprintId, rows, userId });
        if (!check.valid) return res.send({ status: false, statusText: check.reason });

        const addsDetails = Boolean(options.createMissingStatuses);
        const target = await importTargetAccess(companyId, userId, { projectId, sprintId, addsStatuses: addsDetails });
        if (!target.allowed) return refuseImport(res, target);

        const ctx = await loadImportContext(companyId, projectId);
        if (ctx.error) return res.send({ status: false, statusText: ctx.error });

        const out = await runClickUpImport(req, { companyId, userId, project: ctx.project, sprint: target.sprint, statusArray: ctx.statusArray, rows, addsDetails });
        return res.send(out);
    } catch (error) {
        logger.error(`ERROR in clickup import: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

// Required at call time: the orchestrator pulls in the agent engine.
const orchestrator = () => require('../AIProjectGenerator/orchestrator');
const sprints = () => require('../Sprints/controller');

const createListProject = async ({ companyId, userId, actor, name }) => {
    const plan = {
        project: {
            ProjectName: name,
            description: 'Imported from ClickUp.',
            projectIcon: { type: 'color', data: '#7B68EE' },
            isPrivateSpace: false,
            source: 'other',
            skills: [],
            LeadUserId: [userId],
            taskTypeCounts: [{ name: 'Task', value: 'task', key: 1 }],
            projectStatusData: [],
            taskStatusData: [],
        },
        sprints: [],
    };
    const created = await orchestrator().executePlan({ plan, companyId, uid: userId, userData: actor, jobId: `import_clickup_${companyId}_${Date.now()}` });
    if (!created || !created.ok || !created.projectId) throw new Error((created && created.error) || 'The project could not be created.');

    const sprint = await sprints().addSprintFun({
        body: { companyId, projectId: String(created.projectId), sprintName: name, userData: actor, projectName: name, isPreCompany: true, mainChat: false, private: false, sendMessage: false },
    });
    if (!sprint || !sprint.data || !sprint.data._id) throw new Error('The list could not be created in the new project.');
    return { projectId: String(created.projectId), sprint: (await sprintPlacementOf(companyId, { _id: sprint.data._id, name })).set.sprintArray };
};

/* POST /api/v2/imports/clickup/project
 * body: { rows, listName } — one ClickUp list becomes a new project with one sprint. */
exports.importClickUpAsProject = async (req, res) => {
    try {
        const companyId = pinSessionTenant(req, res);
        if (!companyId) return undefined;
        const { rows } = req.body || {};
        const userId = String(req.uid || '');
        if (!userId) return res.status(401).send({ status: false, statusText: 'A signed-in user is required.' });
        const check = validateClickUpRows(rows);
        if (!check.valid) return res.send({ status: false, statusText: check.reason });
        const name = String((req.body && req.body.listName) || '').trim().slice(0, 100) || DEFAULT_LIST;

        const actor = await sessionActor(req);
        const { projectId, sprint } = await createListProject({ companyId, userId, actor, name });
        const ctx = await loadImportContext(companyId, projectId);
        if (ctx.error) return res.send({ status: false, statusText: ctx.error });

        const out = await runClickUpImport(req, { companyId, userId, project: ctx.project, sprint, statusArray: ctx.statusArray, rows, addsDetails: true });
        return res.send(out.status ? out : { ...out, data: { projectId } });
    } catch (error) {
        logger.error(`ERROR in clickup project import: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* POST /api/v2/imports/clickup/preview
 * body: { rows, projectId? } — what the file holds, per list, with nothing written. */
exports.previewClickUp = async (req, res) => {
    try {
        const companyId = pinSessionTenant(req, res);
        if (!companyId) return undefined;
        const { rows, projectId } = req.body || {};
        const check = validateClickUpRows(rows);
        if (!check.valid) return res.send({ status: false, statusText: check.reason });

        const preview = previewClickUpRows(rows);
        let project = null;
        if (projectId) {
            const access = await previewAccess(companyId, req.uid, projectId);
            if (!access.allowed) return refuseImport(res, access);
            project = await loadImportContext(companyId, projectId);
            if (project.error) return res.send({ status: false, statusText: project.error });
        }

        const members = preview.assigneeEmails.length
            ? await findCompanyMembers(companyId, { Employee_Email: { $in: preview.assigneeEmails } }, { _id: 1, Employee_Email: 1 }).catch(() => [])
            : [];
        const matched = new Set(members.map((member) => lowerName(member.Employee_Email)));
        const knownTags = new Set(((project && project.project.tagsArray) || []).map((tag) => lowerName(tag && tag.tagName)));

        return res.send({
            status: true,
            statusText: 'Preview ready.',
            data: {
                ...preview,
                newStatuses: project ? resolveStatuses({ wanted: preview.statuses, existing: project.statusArray }).missing : preview.statuses,
                newTags: preview.tags.filter((tag) => !knownTags.has(lowerName(tag))),
                matchedAssignees: preview.assigneeEmails.filter((email) => matched.has(email)),
                unmatchedAssignees: [...preview.assigneeEmails.filter((email) => !matched.has(email)), ...preview.unnamedAssignees],
            },
        });
    } catch (error) {
        logger.error(`ERROR in clickup preview: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};
