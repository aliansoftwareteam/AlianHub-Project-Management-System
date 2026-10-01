/* What an import finds already in the project: the tasks an earlier import made from the same ClickUp ids, the comments
 * they hold, and the update of those tasks from the file when the person asks for it. */
const mongoose = require('mongoose');
const logger = require('../../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const socketEmitter = require('../../../event/socketEventEmitter');
const { descriptionBlockFrom } = require('../../Tasks/helpers/descriptionBlock');
const { storableFieldValues } = require('../../CustomField/helpers/fieldValueWrite');
const { storedCommentKeys } = require('./importComments');
const { SKIP, UPDATE } = require('./clickupPlan');

const TRASHED = 1;

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

const statusFields = (status) => (status ? { status: { text: status.name, key: status.key, type: status.type }, statusKey: status.key, statusType: status.type } : {});

/* A cell the file fills replaces what the task holds; an empty cell leaves the task as it is, so work done here on a
 * field the file says nothing about is not lost. */
const fieldsFrom = (row, { statusByName, customField }) => ({
    TaskName: row.TaskName,
    ...(row.emptyCells.includes('status') ? {} : statusFields(statusByName.get(row.status))),
    ...(row.emptyCells.includes('priority') ? {} : { Task_Priority: row.Task_Priority }),
    ...(row.DueDate ? { DueDate: new Date(row.DueDate) } : {}),
    ...(row.startDate ? { startDate: new Date(row.startDate) } : {}),
    ...(Array.isArray(row.AssigneeUserId) && row.AssigneeUserId.length ? { AssigneeUserId: row.AssigneeUserId } : {}),
    ...(Array.isArray(row.tagsArray) && row.tagsArray.length ? { tagsArray: row.tagsArray } : {}),
    ...(row.rawDescription ? { rawDescription: row.rawDescription, descriptionBlock: descriptionBlockFrom(row.rawDescription) } : {}),
    ...Object.fromEntries(Object.entries(customField).map(([fieldId, detail]) => [`customField.${fieldId}`, detail])),
});

/* Written straight to each task, as the rest of an import is: no history line, no notice. Open boards hear of it through
 * the task's update event. Answers how many tasks were updated and how many field values did not fit. */
const updateStoredTasks = async (companyId, { rows, projectId, statusArray }) => {
    const statusByName = new Map(statusArray.map((status) => [status.name, status]));
    let updated = 0;
    let droppedFieldValues = 0;
    for (const row of rows) {
        try {
            const kept = await storableFieldValues({ companyId, task: { _id: row.storedTask.id, ProjectID: projectId, customField: row.customField || {} } });
            droppedFieldValues += kept.dropped.length;
            const set = fieldsFrom(row, { statusByName, customField: kept.customField });
            const task = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.TASKS,
                data: [{ _id: oid(row.storedTask.id) }, { $set: set }, { returnDocument: 'after' }],
            }, 'findOneAndUpdate');
            if (!task) continue;
            updated += 1;
            socketEmitter.emit('update', { type: 'update', data: task, updatedFields: set, module: 'task', companyId });
        } catch (error) {
            logger.error(`[importers] task ${row.storedTask.id} not updated: ${(error && error.message) || error}`);
        }
    }
    return { updated, droppedFieldValues };
};

module.exports = { storedTasksOf, existingIn, updateStoredTasks };
