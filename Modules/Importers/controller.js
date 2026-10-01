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
const { adjustedReport, adjustedSentences } = require('./helpers/importTree');
const { mapStatusName } = require('./helpers/jiraRules');
const { planClickUpImport, prepareClickUpDetails, previewClickUpPlan } = require('./helpers/clickupImport');
const { saveImportedComments } = require('./helpers/importComments');
const { importTargetAccess, previewAccess, refuseImport, canAddDetails } = require('./helpers/importAccess');
const { undoImportJob } = require('./helpers/undoImport');
const { UPDATE, SKIP } = require('./helpers/clickupPlan');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const { findCompanyMembers, activeMemberIdSet } = require('./helpers/companyMembers');
const { sessionActor } = require('../Tasks/helpers/taskWriteFields');
const { sprintPlacementOf } = require('../Tasks/helpers/sprintPlacement');
const { pinSessionTenant } = require('../../Config/tenant');

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

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const DUPLICATE = 'duplicate';

/* POST /api/v2/imports/:id/undo
 * body: { keepEdited? } — see helpers/undoImport. */
exports.undoImport = async (req, res) => {
    try {
        const companyId = pinSessionTenant(req, res);
        if (!companyId) return undefined;
        const id = String((req.params && req.params.id) || '');
        if (!req.uid) return res.status(401).send({ status: false, statusText: 'A signed-in user is required.' });
        const job = OBJECT_ID.test(id)
            ? await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.IMPORT_JOBS, data: [{ _id: new mongoose.Types.ObjectId(id), source: { $ne: DUPLICATE } }] }, 'findOne')
            : null;
        if (!job) return res.status(404).send({ status: false, statusText: 'Import not found.' });

        const out = await undoImportJob(companyId, { job, actor: await sessionActor(req), keepEdited: Boolean(req.body && req.body.keepEdited) });
        if (out.refused) {
            const { statusCode, ...refusal } = out.refused;
            return res.status(statusCode).send({ status: false, ...refusal });
        }
        return res.send({ status: true, statusText: `${out.trashed} imported task(s) moved to the trash.`, data: out });
    } catch (error) {
        logger.error(`ERROR in undo import: ${error.message}`);
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
        const projectId = req.query && OBJECT_ID.test(String(req.query.projectId || '')) ? String(req.query.projectId) : '';
        const everyones = isPrivileged(await getRoleType(companyId, userId));
        // The task copy of a duplicated project keeps its progress in this collection too (Modules/ProjectDuplicate).
        const jobs = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.IMPORT_JOBS,
            data: [
                { ...(everyones ? {} : { userId }), ...(projectId ? { projectId: new mongoose.Types.ObjectId(projectId) } : {}), source: { $ne: DUPLICATE } },
                'userId source projectId status total processed created updated errorList createdAt undoneAt',
                { sort: { createdAt: -1 }, limit: 20 },
            ],
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

const checklistRow = (row) => ({ id: new mongoose.Types.ObjectId().toString(), AssigneeUserId: [], isExpand: false, ...row });

/* The task panel reads a checklist as one flat list: a row for the checklist, then its items naming it as their parent. */
const checklistRows = (checklists) => checklists.flatMap((checklist) => {
    const items = (Array.isArray(checklist.items) ? checklist.items : []).filter((item) => item && item.name);
    const head = checklistRow({ name: checklist.name || 'Checklist', isChecked: items.length > 0 && items.every((item) => item.isChecked) });
    return [head, ...items.map((item) => checklistRow({ name: item.name, isChecked: !!item.isChecked, parentId: head.id }))];
});

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
        if (Array.isArray(task.checklists) && task.checklists.length) task.checklistArray = checklistRows(task.checklists);
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

const startImportJob = (companyId, { source, project, sprint, actor, total }) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.IMPORT_JOBS,
    data: {
        userId: actor.id,
        source,
        projectId: project._id,
        sprintId: new mongoose.Types.ObjectId(sprint.id),
        status: 'processing',
        total,
        processed: 0,
        created: 0,
        errorList: [],
    },
}, 'save');

const failImportJob = (companyId, job, error) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.IMPORT_JOBS,
    data: [{ _id: job._id }, { $set: { status: 'failed', errorList: [String((error && error.message) || error).slice(0, 300)] } }],
}, 'updateOne').catch(() => {});

/* Record the job, feed the bulk-create pipeline, update the job. Returns the
 * response envelope. Identical create path to the Jira importer. `details`
 * writes what needs the created task ids and answers the import's summary.
 * Every task and comment the import creates is marked with the job, so the
 * import can be found again and undone. `updates` are rows whose task is
 * already in the project; `storedParents` lets a new row go under such a task. */
const finishImport = async (companyId, { source, project, sprint, actor, statusArray, tasks, skipped, addsTags = false, report = null, details = null, job: started = null, updates = [], storedParents = new Map() }) => {
    const userId = actor.id;
    const sprintId = sprint.id;
    const job = started || await startImportJob(companyId, { source, project, sprint, actor, total: tasks.length });

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
    await applyImportTags(companyId, project, [...tasks, ...updates], { create: addsTags });
    const tasksWithSprint = tasks.map((task) => ({ ...task, sprintId, sprintArray: sprint }));

    try {
        const result = tasks.length
            ? await taskMongo.createMultipleTasks({
                tasks: tasksWithSprint,
                userData: actor,
                projectData,
                indexObj: {},
                statusArray,
                sprint,
                importMark: { jobId: String(job._id) },
                storedParents,
            })
            : { createdTasks: [], data: [], adjusted: [] };
        // The create path stamps the rows it was handed, or the copies it made of them when it also defined fields.
        const createdRows = Array.isArray(result?.createdTasks) ? result.createdTasks : tasksWithSprint;
        const summary = details
            ? await details.afterCreate({ createdRows, droppedFieldValues: result?.droppedFieldValues || 0 })
            : await saveImportedComments(companyId, { source, project: projectData, sprint, rows: createdRows, actorId: userId, jobId: job._id })
                .then(() => null)
                .catch((commentErr) => logger.error(`[importers] comment import error: ${commentErr.message}`));
        const droppedFieldValues = summary ? summary.fields.valuesDropped : (result?.droppedFieldValues || 0);
        const createdCount = Array.isArray(result?.data) ? result.data.length : tasks.length;
        const updatedCount = summary && summary.existing ? summary.existing.updated : 0;
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.IMPORT_JOBS,
            data: [{ _id: job._id }, { $set: { status: 'done', processed: tasks.length + updates.length, created: createdCount, ...(updates.length ? { updated: updatedCount } : {}) } }],
        }, 'updateOne');
        const detail = report ? { skippedRows: report.skippedRows, unmatchedAssignees: [...unmatchedEmails, ...report.unnamedAssignees] } : {};
        const adjusted = adjustedReport(result?.adjusted);
        const statusText = [`Imported ${createdCount} tasks from ${source} (${skipped} skipped).`, ...adjustedSentences(adjusted), ...(updatedCount ? [`${updatedCount} task(s) that were already here were updated.`] : [])].join(' ');
        return { status: true, statusText, data: { jobId: job._id, projectId: String(project._id), created: createdCount, skipped, ...detail, ...(adjusted ? { adjusted } : {}), ...(droppedFieldValues ? { droppedFieldValues } : {}), ...(summary ? { summary } : {}) } };
    } catch (creationError) {
        logger.error(`[importers] ${source} job ${job._id} failed: ${creationError.message}`);
        await failImportJob(companyId, job, creationError);
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

const withoutRow = ({ row, ...entry }) => entry;

/* `existingMode` says what happens to a row whose ClickUp id a task of the project already holds: it is left alone, or
 * its task takes the file's values. Either way no task is created twice. */
const runClickUpImport = async (req, { companyId, userId, project, sprint, statusArray, rows, addsDetails, existingMode = SKIP, dayFirst }) => {
    const context = await clickUpStatusContext(companyId, project, statusArray, rows, addsDetails);
    const { tasks, fields, skipped, skippedRows, unreadDates, unnamedAssignees } = transformClickUpRows({ rows, statusFor: context.statusFor, leaderId: userId, dayFirst });
    if (!tasks.length) return { status: false, statusText: 'No importable tasks found (every row needs a task name).' };
    const actor = await sessionActor(req);
    const plan = await planClickUpImport(companyId, { actor, project, tasks, columns: fields, unnamedAssignees, addsTags: addsDetails, existingMode });
    const alreadyImported = plan.summary.existing.skipped;
    const read = { skippedRows, unreadDates: unreadDates.map(withoutRow), alreadyImported };
    if (!plan.fresh.length && !plan.updates.length) {
        return { status: true, statusText: `Every task of this list is already here (${alreadyImported}). Nothing was imported.`, data: { projectId: String(project._id), created: 0, updated: 0, skipped, ...read, unmatchedAssignees: [], summary: plan.summary } };
    }

    const job = await startImportJob(companyId, { source: 'clickup', project, sprint, actor, total: plan.fresh.length + plan.updates.length });
    let details;
    try {
        details = await prepareClickUpDetails(companyId, { plan, project, sprint, statusArray: context.statusArray, jobId: job._id });
    } catch (error) {
        await failImportJob(companyId, job, error);
        throw error;
    }
    const out = await finishImport(companyId, {
        source: 'clickup',
        project,
        sprint,
        actor,
        statusArray: context.statusArray,
        tasks: plan.fresh,
        skipped,
        addsTags: addsDetails,
        report: { skippedRows, unnamedAssignees: details.unmatchedPeople },
        details,
        job,
        updates: plan.updates,
        storedParents: plan.storedParents,
    });
    return out.status ? { ...out, data: { ...out.data, ...read, updated: out.data.summary.existing.updated } } : out;
};

const existingModeOf = (options) => (options && options.existing === UPDATE ? UPDATE : SKIP);

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

        const out = await runClickUpImport(req, {
            companyId, userId, project: ctx.project, sprint: target.sprint, statusArray: ctx.statusArray, rows, addsDetails, existingMode: existingModeOf(options), dayFirst: options.dayFirst,
        });
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
 * body: { rows, projectId?, options? } — what the file holds, per list, and what importing it
 * would bring in and leave out, with nothing written. */
exports.previewClickUp = async (req, res) => {
    try {
        const companyId = pinSessionTenant(req, res);
        if (!companyId) return undefined;
        const { rows, projectId } = req.body || {};
        const options = (req.body && req.body.options) || {};
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
        const { plan, alreadyImported } = await previewClickUpPlan(companyId, String(req.uid || ''), {
            rows,
            lists: preview.lists,
            project: project ? project.project : null,
            addsTags: Boolean(options.createMissingStatuses),
            existingMode: existingModeOf(options),
        });

        return res.send({
            status: true,
            statusText: 'Preview ready.',
            data: {
                ...preview,
                lists: preview.lists.map((list, at) => ({ ...list, alreadyImported: alreadyImported[at] })),
                alreadyImported: alreadyImported.reduce((sum, count) => sum + count, 0),
                canAddDetails: project ? await canAddDetails(companyId, req.uid, projectId) : true,
                newStatuses: project ? resolveStatuses({ wanted: preview.statuses, existing: project.statusArray }).missing : preview.statuses,
                newTags: preview.tags.filter((tag) => !knownTags.has(lowerName(tag))),
                matchedAssignees: preview.assigneeEmails.filter((email) => matched.has(email)),
                unmatchedAssignees: [...preview.assigneeEmails.filter((email) => !matched.has(email)), ...preview.unnamedAssignees],
                plan,
            },
        });
    } catch (error) {
        logger.error(`ERROR in clickup preview: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};
