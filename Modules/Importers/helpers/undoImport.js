/* Undoing an import: every task it created goes to the trash, the way a person sends a task there, and the custom fields
 * it created are switched off when no task left uses them. Statuses and tags stay. A task the import only updated is
 * not its own, and is left alone. */
const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../../utils/commonFunctions');
const { getRoleType, isPrivileged } = require('../../../Config/permissionGuard');
const { announceFields } = require('../../CustomField/helpers/fieldProjects');

const TRASHED = 1;
const CREATED_KEY = 'Task_Created';
const MAX_LISTED = 50;
const NOT_TRASHED = { $ne: TRASHED };

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);
const find = async (companyId, type, filter, fields) => ((await MongoDbCrudOpration(companyId, { type, data: [filter, fields] }, 'find')) || []).map(plain);
const eitherForm = (ids) => [...ids, ...ids.map(oid)];
const listed = (tasks) => tasks.slice(0, MAX_LISTED).map((task) => ({ id: String(task._id), name: task.TaskName }));

const mayUndo = async (companyId, uid, job) => String(job.userId) === String(uid) || isPrivileged(await getRoleType(companyId, uid));

/* The imported tasks someone has worked on since: a history line other than its creation, a comment that no import
 * brought, or a subtask the import did not make. */
const editedAmong = async (companyId, jobId, tasks) => {
    const ids = tasks.map((task) => String(task._id));
    const [history, comments, children] = await Promise.all([
        find(companyId, SCHEMA_TYPE.HISTORY, { TaskId: { $in: eitherForm(ids) }, Key: { $ne: CREATED_KEY } }, { TaskId: 1 }),
        find(companyId, SCHEMA_TYPE.COMMENTS, { taskId: { $in: ids.map(oid) }, importedFrom: { $exists: false } }, { taskId: 1 }),
        find(companyId, SCHEMA_TYPE.TASKS, { ParentTaskId: { $in: eitherForm(ids) }, importJobId: { $ne: oid(jobId) }, deletedStatusKey: NOT_TRASHED }, { ParentTaskId: 1 }),
    ]);
    const edited = new Set([...history.map((row) => String(row.TaskId)), ...comments.map((row) => String(row.taskId)), ...children.map((row) => String(row.ParentTaskId))]);
    return tasks.filter((task) => edited.has(String(task._id)));
};

/* Trashing a task carries the tasks under it, so a task that is kept keeps every task above it. */
const keptWith = (tasks, edited) => {
    const kept = new Set(edited.flatMap((task) => [String(task._id), ...(task.ancestors || []).map(String)]));
    return tasks.filter((task) => kept.has(String(task._id)));
};

const trash = async (companyId, { tasks, project, actor }) => {
    // Required at call time: the task class pulls in most of the app.
    const { taskMongo } = require('../../Tasks/helpers/task_class_Mongo');
    const going = new Set(tasks.map((task) => String(task._id)));
    const tops = tasks.filter((task) => !going.has(String(task.ParentTaskId || '')));
    for (const task of tops) {
        await taskMongo.updateArchiveDelete({ companyId, projectData: project, task: { _id: String(task._id) }, userData: actor, deletedStatusKey: TRASHED, quiet: true });
    }
};

const isUsed = async (companyId, fieldId) => Boolean(await MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.TASKS,
    data: [{ [`customField.${fieldId}`]: { $exists: true }, deletedStatusKey: NOT_TRASHED }, { _id: 1 }],
}, 'findOne'));

/* A field the import created is switched off, as the field form does it, once no task outside the trash holds a value. */
const removeUnusedFields = async (companyId, jobId) => {
    const created = (await find(companyId, SCHEMA_TYPE.CUSTOM_FIELDS, { importJobId: oid(jobId) }, { fieldTitle: 1, isDelete: 1 })).filter((field) => field.isDelete !== false);
    const removed = [];
    const kept = [];
    for (const field of created) {
        if (await isUsed(companyId, String(field._id))) {
            kept.push(field.fieldTitle);
            continue;
        }
        await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.CUSTOM_FIELDS, data: [{ _id: oid(field._id) }, { $set: { isDelete: false, updatedAt: new Date() } }] }, 'updateOne');
        removed.push(field.fieldTitle);
    }
    if (removed.length) {
        announceFields(companyId, 'update');
        removeCache(`customField:${companyId}`);
        removeCache(`aiFieldAutoRefill:${companyId}`);
    }
    return { fieldsRemoved: removed, fieldsKept: kept };
};

/* Answers `{ refused }` with the status code and reason, or what was done. `keepEdited` is the person's word that the
 * tasks someone worked on may stay; without it an import with such tasks is not undone at all. */
const undoImportJob = async (companyId, { job, actor, keepEdited = false }) => {
    if (!(await mayUndo(companyId, actor.id, job))) return { refused: { statusCode: 403, code: 'NOT_ALLOWED', statusText: 'Only the person who ran an import, an owner or an admin can undo it.' } };
    if (job.status === 'undone') return { refused: { statusCode: 409, code: 'ALREADY_UNDONE', statusText: 'This import has already been undone.' } };

    const tasks = await find(companyId, SCHEMA_TYPE.TASKS, { importJobId: oid(job._id), deletedStatusKey: NOT_TRASHED }, { TaskName: 1, ParentTaskId: 1, ancestors: 1 });
    if (!tasks.length) return { refused: { statusCode: 409, code: 'NOTHING_TO_UNDO', statusText: 'Nothing this import created is left to undo.' } };

    const edited = await editedAmong(companyId, job._id, tasks);
    if (edited.length && !keepEdited) {
        return { refused: { statusCode: 409, code: 'EDITED', statusText: `${edited.length} of the imported tasks have been worked on since.`, data: { edited: listed(edited), editedCount: edited.length } } };
    }

    const kept = keptWith(tasks, edited);
    const keptIds = new Set(kept.map((task) => String(task._id)));
    const going = tasks.filter((task) => !keptIds.has(String(task._id)));
    const project = plain(await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: [{ _id: oid(job.projectId) }, { ProjectName: 1 }] }, 'findOne')) || {};
    await trash(companyId, { tasks: going, project, actor });
    const fields = await removeUnusedFields(companyId, job._id);
    await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.IMPORT_JOBS,
        data: [{ _id: oid(job._id) }, { $set: { status: 'undone', undoneAt: new Date(), undoneBy: String(actor.id) } }],
    }, 'updateOne');
    return { trashed: going.length, kept: listed(kept), keptCount: kept.length, ...fields };
};

module.exports = { undoImportJob, mayUndo };
