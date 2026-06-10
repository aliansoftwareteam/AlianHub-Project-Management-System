const logger = require("../../../../Config/loggerConfig");
const { SCHEMA_TYPE } = require('../../../../Config/schemaType');
const { MongoDbCrudOpration } = require("../../../../utils/mongo-handler/mongoQueries");
const { default: mongoose } = require("mongoose");
const socketEmitter = require('../../../../event/socketEventEmitter');
const { HandleHistory } = require("../mongo_helper");
const { INVERSE_RELATION, RELATION_LABELS, validateTaskRef, validateRelationPair, validateRelationInput } = require('./relationRules');

// Task-to-task relations (blocks / blocked_by / duplicates / duplicated_by /
// relates_to). A link is stored on BOTH task documents as an entry in the
// `relations` array — `{ taskId, type, createdBy, createdAt }` — with the
// inverse type on the related side, so reading either task shows the link
// without a join. One link per task pair; changing its type is remove + add.

module.exports = {

    /* -------------- ADD A RELATION BETWEEN TWO TASKS -----------------*/
    // payload: { companyId, taskId, relatedTaskId, type, userData }
    addTaskRelation({ companyId, taskId, relatedTaskId, type, userData }) {
        return new Promise(async (resolve, reject) => {
            try {
                const check = validateRelationInput({ companyId, taskId, relatedTaskId, type });
                if (!check.valid) {
                    return reject(new Error(check.reason));
                }

                const taskObjId = new mongoose.Types.ObjectId(taskId);
                const relatedObjId = new mongoose.Types.ObjectId(relatedTaskId);
                const [task, relatedTask] = await Promise.all([
                    this.findRelationTask(companyId, taskObjId),
                    this.findRelationTask(companyId, relatedObjId),
                ]);
                if (!task || !relatedTask) {
                    return reject(new Error('Task not found.'));
                }
                const alreadyLinked = (task.relations || []).some((rel) => String(rel.taskId) === String(relatedTaskId));
                if (alreadyLinked) {
                    return reject(new Error(`Tasks ${task.TaskKey} and ${relatedTask.TaskKey} are already linked.`));
                }

                const createdAt = new Date();
                const createdBy = userData && (userData.id || userData._id) ? String(userData.id || userData._id) : '';
                const inverseType = INVERSE_RELATION[type];

                const [updatedTask, updatedRelated] = await Promise.all([
                    this.pushRelationEntry(companyId, taskObjId, { taskId: relatedObjId, type, createdBy, createdAt }),
                    this.pushRelationEntry(companyId, relatedObjId, { taskId: taskObjId, type: inverseType, createdBy, createdAt }),
                ]);

                socketEmitter.emit('update', { type: "update", data: updatedTask, updatedFields: { relations: updatedTask?.relations || [] }, module: 'task' });
                socketEmitter.emit('update', { type: "update", data: updatedRelated, updatedFields: { relations: updatedRelated?.relations || [] }, module: 'task' });

                this.addRelationHistory({ companyId, task, otherKey: relatedTask.TaskKey, type, userData });
                this.addRelationHistory({ companyId, task: relatedTask, otherKey: task.TaskKey, type: inverseType, userData });

                resolve({
                    status: true,
                    statusText: `${task.TaskKey} now ${RELATION_LABELS[type]} ${relatedTask.TaskKey}.`,
                    data: { taskId, relatedTaskId, type, relations: updatedTask?.relations || [] },
                });
            } catch (error) {
                logger.error(`ERROR in add task relation: ${error.message}`);
                reject(error);
            }
        })
    },

    /* -------------- REMOVE A RELATION BETWEEN TWO TASKS -----------------*/
    // payload: { companyId, taskId, relatedTaskId, userData }
    removeTaskRelation({ companyId, taskId, relatedTaskId, userData }) {
        return new Promise(async (resolve, reject) => {
            try {
                const check = validateRelationPair({ companyId, taskId, relatedTaskId });
                if (!check.valid) {
                    return reject(new Error(check.reason));
                }

                const taskObjId = new mongoose.Types.ObjectId(taskId);
                const relatedObjId = new mongoose.Types.ObjectId(relatedTaskId);
                const [task, relatedTask] = await Promise.all([
                    this.findRelationTask(companyId, taskObjId),
                    this.findRelationTask(companyId, relatedObjId),
                ]);
                if (!task) {
                    return reject(new Error('Task not found.'));
                }
                const existing = (task.relations || []).some((rel) => String(rel.taskId) === String(relatedTaskId));
                if (!existing) {
                    return reject(new Error('These tasks are not linked.'));
                }

                // Pull both sides. The related task may have been deleted in
                // the meantime — pulling from a missing document is a no-op.
                const [updatedTask, updatedRelated] = await Promise.all([
                    this.pullRelationEntry(companyId, taskObjId, relatedObjId),
                    this.pullRelationEntry(companyId, relatedObjId, taskObjId),
                ]);

                if (updatedTask) {
                    socketEmitter.emit('update', { type: "update", data: updatedTask, updatedFields: { relations: updatedTask.relations || [] }, module: 'task' });
                }
                if (updatedRelated) {
                    socketEmitter.emit('update', { type: "update", data: updatedRelated, updatedFields: { relations: updatedRelated.relations || [] }, module: 'task' });
                }

                this.removeRelationHistory({ companyId, task, otherKey: relatedTask ? relatedTask.TaskKey : 'a deleted task', userData });
                if (relatedTask) {
                    this.removeRelationHistory({ companyId, task: relatedTask, otherKey: task.TaskKey, userData });
                }

                resolve({
                    status: true,
                    statusText: 'Task link removed successfully.',
                    data: { taskId, relatedTaskId, relations: updatedTask?.relations || [] },
                });
            } catch (error) {
                logger.error(`ERROR in remove task relation: ${error.message}`);
                reject(error);
            }
        })
    },

    /* -------------- LIST RELATIONS OF A TASK (WITH TASK SUMMARIES) -----------------*/
    // payload: { companyId, taskId }
    getTaskRelations({ companyId, taskId }) {
        return new Promise(async (resolve, reject) => {
            try {
                const check = validateTaskRef({ companyId, taskId });
                if (!check.valid) {
                    return reject(new Error(check.reason));
                }

                const task = await this.findRelationTask(companyId, new mongoose.Types.ObjectId(taskId));
                if (!task) {
                    return reject(new Error('Task not found.'));
                }
                const relations = task.relations || [];
                if (!relations.length) {
                    return resolve({ status: true, statusText: 'No linked tasks.', data: [] });
                }

                const relatedIds = relations.map((rel) => new mongoose.Types.ObjectId(rel.taskId));
                const summaryQuery = {
                    type: SCHEMA_TYPE.TASKS,
                    data: [
                        { _id: { $in: relatedIds } },
                        'TaskName TaskKey status statusKey statusType ProjectID sprintId folderObjId AssigneeUserId deletedStatusKey isParentTask Task_Priority DueDate',
                    ],
                };
                const relatedDocs = await MongoDbCrudOpration(companyId, summaryQuery, 'find');
                const docById = new Map((relatedDocs || []).map((doc) => [String(doc._id), doc]));

                const data = relations.map((rel) => ({
                    taskId: String(rel.taskId),
                    type: rel.type,
                    label: RELATION_LABELS[rel.type] || rel.type,
                    createdBy: rel.createdBy || '',
                    createdAt: rel.createdAt || null,
                    task: docById.get(String(rel.taskId)) || null,
                }));

                resolve({ status: true, statusText: 'Linked tasks fetched successfully.', data });
            } catch (error) {
                logger.error(`ERROR in get task relations: ${error.message}`);
                reject(error);
            }
        })
    },

    /* -------------- INTERNAL HELPERS (RELATIONS) -----------------*/

    findRelationTask(companyId, taskObjId) {
        const query = {
            type: SCHEMA_TYPE.TASKS,
            data: [{ _id: taskObjId, deletedStatusKey: { $ne: 1 } }],
        };
        return MongoDbCrudOpration(companyId, query, 'findOne');
    },

    pushRelationEntry(companyId, taskObjId, entry) {
        const query = {
            type: SCHEMA_TYPE.TASKS,
            data: [
                { _id: taskObjId },
                { $push: { relations: entry } },
                { returnDocument: 'after' },
            ],
        };
        return MongoDbCrudOpration(companyId, query, 'findOneAndUpdate');
    },

    pullRelationEntry(companyId, taskObjId, relatedObjId) {
        const query = {
            type: SCHEMA_TYPE.TASKS,
            data: [
                { _id: taskObjId },
                { $pull: { relations: { taskId: relatedObjId } } },
                { returnDocument: 'after' },
            ],
        };
        return MongoDbCrudOpration(companyId, query, 'findOneAndUpdate');
    },

    addRelationHistory({ companyId, task, otherKey, type, userData }) {
        const historyObj = {
            key: 'Task_Relation',
            message: `<b>${userData?.Employee_Name || 'Someone'}</b> has linked this task — it now <b>${RELATION_LABELS[type]}</b> <b>${otherKey}</b>.`,
            sprintId: task.sprintId,
        };
        HandleHistory('task', companyId, task.ProjectID, task._id, historyObj, userData)
        .catch((error) => {
            logger.error(`ERROR in task relation history: ${error.message}`);
        });
    },

    removeRelationHistory({ companyId, task, otherKey, userData }) {
        const historyObj = {
            key: 'Task_Relation',
            message: `<b>${userData?.Employee_Name || 'Someone'}</b> has removed the link with <b>${otherKey}</b>.`,
            sprintId: task.sprintId,
        };
        HandleHistory('task', companyId, task.ProjectID, task._id, historyObj, userData)
        .catch((error) => {
            logger.error(`ERROR in task relation history: ${error.message}`);
        });
    },
};
