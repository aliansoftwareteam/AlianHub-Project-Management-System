/* What an import finds already in the project: the tasks an earlier import made from the same ClickUp ids, the comments
 * they hold, and the update of those tasks from the file when the person asks for it. */
const mongoose = require('mongoose');
const logger = require('../../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const socketEmitter = require('../../../event/socketEventEmitter');
const { descriptionBlockFrom } = require('../../Tasks/helpers/descriptionBlock');
const { storableFieldValues } = require('../../CustomField/helpers/fieldValueWrite');
const { importActorOf } = require('../../Tasks/helpers/importMark');
const { storedCommentKeys } = require('./importComments');
const { SKIP, UPDATE } = require('./clickupPlan');

const TRASHED = 1;
const UNKNOWN_STATUS = 'UNKNOWN_STATUS';
const STATUS_NOT_SAVED = 'STATUS_NOT_SAVED';
const MAX_CELL = 200;

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);
const timeOf = (task) => new Date(task.createdAt || 0).getTime();

/* The live tasks of the project by the ClickUp id an import gave them. Where two hold the same id, the older one. */
const storedTasksOf = async (companyId, projectId, sourceIds) => {
    const ids = [...new Set(sourceIds.filter(Boolean).map(String))];
    const stored = new Map();
    if (!projectId || !ids.length) return stored;
    const found = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [
            { ProjectID: oid(projectId), importSourceId: { $in: ids }, deletedStatusKey: { $ne: TRASHED } },
            { importSourceId: 1, ancestors: 1, sprintId: 1, folderObjId: 1, createdAt: 1 },
        ],
    }, 'find');
    (found || []).map(plain).sort((a, b) => timeOf(a) - timeOf(b)).forEach((task) => {
        if (stored.has(task.importSourceId)) return;
        stored.set(task.importSourceId, {
            id: String(task._id),
            ancestors: (task.ancestors || []).map(String),
            sprintId: task.sprintId ? String(task.sprintId) : '',
            folderId: task.folderObjId ? String(task.folderObjId) : '',
        });
    });
    return stored;
};

/* What the plan of an import needs to know about the project: see planClickUpList. */
const existingIn = async (companyId, projectId, tasks, mode) => {
    const stored = await storedTasksOf(companyId, projectId, tasks.map((task) => task.importSourceId));
    const updates = mode === UPDATE;
    const commentKeys = updates ? await storedCommentKeys(companyId, [...stored.values()].map((task) => task.id)) : new Map();
    return { mode: updates ? UPDATE : SKIP, stored, commentKeys };
};

const statusFields = (status) => ({ status: { text: status.name, key: status.key, type: status.type }, statusKey: status.key, statusType: status.type });

const skippedStatus = (row, code) => ({ name: row.TaskName, column: 'status', value: String(row.statusCell).slice(0, MAX_CELL), code });

/* What the file's status cell asks of a task that is already here. An empty cell and the status the task holds ask
 * nothing. A status the project lacks is skipped and named: a new task with such a status goes on the project's first
 * one, and a task someone has since moved must not be sent back there. */
const statusChangeOf = (row, task, { statusByName, knowsStatus }) => {
    if (row.emptyCells.includes('status')) return {};
    const status = knowsStatus(row.statusCell) ? statusByName.get(row.status) : null;
    if (!status) return { skipped: skippedStatus(row, UNKNOWN_STATUS) };
    return String(status.key) === String(task.statusKey) ? {} : { status };
};

/* A cell the file fills replaces what the task holds; an empty cell leaves the task as it is, so work done here on a
 * field the file says nothing about is not lost. The status is not among them: see moveStatus. */
const fieldsFrom = (row, customField) => ({
    TaskName: row.TaskName,
    ...(row.emptyCells.includes('priority') ? {} : { Task_Priority: row.Task_Priority }),
    ...(row.DueDate ? { DueDate: new Date(row.DueDate) } : {}),
    ...(row.startDate ? { startDate: new Date(row.startDate) } : {}),
    ...(Array.isArray(row.AssigneeUserId) && row.AssigneeUserId.length ? { AssigneeUserId: row.AssigneeUserId } : {}),
    ...(Array.isArray(row.tagsArray) && row.tagsArray.length ? { tagsArray: row.tagsArray } : {}),
    ...(row.rawDescription ? { rawDescription: row.rawDescription, descriptionBlock: descriptionBlockFrom(row.rawDescription) } : {}),
    ...Object.fromEntries(Object.entries(customField).map(([fieldId, detail]) => [`customField.${fieldId}`, detail])),
});

/* The status goes the way a person's change of it does, so the task leaves its place on the board, who closed it is
 * recorded and the history says so. Quiet: no one is notified and no automation answers. Answers whether it was saved. */
const moveStatus = async (companyId, { task, status, project, actor }) => {
    // Required at call time: the task class pulls in most of the app.
    const { taskMongo } = require('../../Tasks/helpers/task_class_Mongo');
    const id = String(task._id);
    const held = task.status || {};
    const out = await taskMongo.updateStatus({
        newStatus: statusFields(status),
        prevStatus: { taskId: id, statusName: held.text || '', updatedTaskName: status.name },
        projectData: { _id: String(project._id), CompanyId: companyId, ProjectName: project.ProjectName },
        task: { _id: id, sprintId: task.sprintId, folderObjId: task.folderObjId || '', statusType: task.statusType || '', status: held },
        userData: actor,
        isUpdateTask: true,
        quiet: true,
    });
    return Boolean(out && out.status);
};

/* Every field but the status is written straight to the task, as the rest of an import is: no history line, no notice.
 * Open boards hear of it through the task's update event. `knowsStatus` says whether the project has a status for what
 * a status cell holds. Answers how many tasks were updated, how many field values did not fit, and the cells that were
 * skipped. */
const updateStoredTasks = async (companyId, { rows, project, actor, statusArray, knowsStatus }) => {
    const statusByName = new Map(statusArray.map((status) => [status.name, status]));
    const projectId = String(project._id);
    const skippedCells = [];
    let updated = 0;
    let droppedFieldValues = 0;
    for (const row of rows) {
        try {
            const kept = await storableFieldValues({ companyId, task: { _id: row.storedTask.id, ProjectID: projectId, customField: row.customField || {} } });
            droppedFieldValues += kept.dropped.length;
            const set = fieldsFrom(row, kept.customField);
            const task = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.TASKS,
                data: [{ _id: oid(row.storedTask.id) }, { $set: set }, { returnDocument: 'after' }],
            }, 'findOneAndUpdate');
            if (!task) continue;
            updated += 1;
            socketEmitter.emit('update', { type: 'update', data: task, updatedFields: set, module: 'task', companyId, actor: importActorOf(actor) });

            const change = statusChangeOf(row, plain(task), { statusByName, knowsStatus });
            if (change.skipped) skippedCells.push(change.skipped);
            if (!change.status) continue;
            const moved = await moveStatus(companyId, { task: plain(task), status: change.status, project, actor }).catch((error) => {
                logger.error(`[importers] status of task ${row.storedTask.id} not saved: ${(error && error.message) || error}`);
                return false;
            });
            if (!moved) skippedCells.push(skippedStatus(row, STATUS_NOT_SAVED));
        } catch (error) {
            logger.error(`[importers] task ${row.storedTask.id} not updated: ${(error && error.message) || error}`);
        }
    }
    return { updated, droppedFieldValues, skippedCells };
};

module.exports = { storedTasksOf, existingIn, updateStoredTasks };
