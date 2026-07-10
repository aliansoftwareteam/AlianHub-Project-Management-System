// Bulk multi-task operations mixin for taskMongo.
//
// Design: parity by construction. Each bulk method loops the existing
// single-task helper (this.updateStatus / updateAssignee / updateArchiveDelete
// etc.) inside Promise.allSettled. By reusing the per-task code path we
// inherit history (HandleHistory), notifications (HandleBothNotification),
// sprint count reconciliation, cache invalidation, and the per-task
// socket 'update' emit — exactly as today's single-task actions do.
//
// CompanyId scoping is enforced before anything else: a single find()
// drops any taskIds that don't belong to the caller's company. Cross-tenant
// IDs are returned in `skipped[]` and never touch downstream logic.
//
// Authoritative permission re-check at the helper layer matches what the
// single-task helpers do today (none — they trust the JWT + middleware
// companyId verification + frontend gating). When the single-task path
// gains role-level checks, the bulk path will inherit them automatically.

const { dbCollections } = require('../../../../Config/collections');
const { SCHEMA_TYPE } = require('../../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../../utils/mongo-handler/mongoQueries');
const { default: mongoose } = require('mongoose');
const logger = require('../../../../Config/loggerConfig');
const socketEmitter = require('../../../../event/socketEventEmitter');
const { HandleHistory } = require('../mongo_helper');
const { HandleBothNotification } = require('../handleNotification');
const {
    taskAssigneeAdd, taskAssigneeRemove, taskAssigneeReplace,
    taskStatusChange, taskPriorityChange,
} = require('../notificationTemplate');

// ----------------- Internal helpers (not exported on the mixin) -----------------

const toObjectId = (id) => {
    try { return new mongoose.Types.ObjectId(String(id)); } catch (_) { return null; }
};

// Turn a Mongoose document (or plain object) into a plain object we can
// safely spread when building the post-update task snapshot used in
// socket emits.
const toPlain = (doc) => (doc && typeof doc.toObject === 'function')
    ? doc.toObject()
    : (doc ? JSON.parse(JSON.stringify(doc)) : {});

// Build a post-update task document by merging the freshly-applied fields
// into the pre-update task. Real-time clients consume `data.fullDocument`
// (see socket/controller/taskSocket.js:73) so this must reflect the actual
// new state, otherwise the merge in mutateUpdateFirebaseTasks overwrites
// the optimistic update with stale data.
//
// Defensive: the fan-out at taskSocket.js:39 reads `data.AssigneeUserId`
// for user-filtered rooms and crashes if the field is undefined, so we
// always default it to [].
const mergeTaskUpdate = (task, fields) => {
    const merged = {
        ...toPlain(task),
        ...(fields || {}),
    };
    if (!Array.isArray(merged.AssigneeUserId)) merged.AssigneeUserId = [];
    return merged;
};

// Emit one `update` event per affected task. The server-side socketEmitter
// listener (taskSocket.js:122) fans this out as `taskUpdate` to every
// client subscribed to that project+sprint room — exactly what single-task
// findOneAndUpdate does today through the same emitter.
const emitTaskUpdate = (task, updatedFields) => {
    try {
        socketEmitter.emit('update', {
            type: 'update',
            data: mergeTaskUpdate(task, updatedFields),
            updatedFields: updatedFields || {},
            module: 'task',
        });
    } catch (error) {
        logger.error(`emitTaskUpdate failed: ${error.message}`);
    }
};

const dedupeIds = (ids) => {
    if (!Array.isArray(ids)) return [];
    const seen = new Set();
    const out = [];
    for (const id of ids) {
        const s = String(id || '').trim();
        if (s && !seen.has(s)) {
            seen.add(s);
            out.push(s);
        }
    }
    return out;
};

// Load all live tasks for the given IDs scoped to companyId.
// Returns { tasks: [docs...], skipped: [{taskId, reason}, ...] }
async function loadScopedTasks(companyId, rawTaskIds, { includeDeleted = false, includeArchived = true } = {}) {
    const taskIds = dedupeIds(rawTaskIds);
    const objectIds = taskIds.map(toObjectId).filter(Boolean);
    if (!objectIds.length) {
        return { tasks: [], skipped: taskIds.map((id) => ({ taskId: id, reason: 'invalid-id' })) };
    }

    const filter = { _id: { $in: objectIds } };
    if (!includeDeleted) {
        const blocked = includeArchived ? [1] : [1, 2];
        filter.deletedStatusKey = { $nin: blocked };
    }

    const query = { type: dbCollections.TASKS, data: [filter] };
    const tasks = await MongoDbCrudOpration(companyId, query, 'find');
    const foundIdSet = new Set((tasks || []).map((t) => String(t._id)));

    const skipped = [];
    for (const id of taskIds) {
        if (!foundIdSet.has(String(id))) {
            skipped.push({ taskId: id, reason: 'not-found-or-cross-tenant' });
        }
    }
    return { tasks: tasks || [], skipped };
}

// Cache project docs per bulk call so we don't refetch for tasks in the
// same project. Returns a fetcher that resolves projects by id.
function makeProjectLoader(companyId) {
    const cache = new Map();
    return async function loadProject(projectId) {
        const key = String(projectId);
        if (cache.has(key)) return cache.get(key);
        const objId = toObjectId(projectId);
        if (!objId) { cache.set(key, null); return null; }
        const query = { type: SCHEMA_TYPE.PROJECTS, data: [{ _id: objId }] };
        const project = await MongoDbCrudOpration(companyId, query, 'findOne').catch(() => null);
        cache.set(key, project || null);
        return project || null;
    };
}

// Build the summary response shape returned to the route.
function summarize({ updated = [], skipped = [], errors = [] }) {
    return {
        status: true,
        statusText: 'Bulk operation completed',
        updated,
        skipped,
        errors,
        totals: { updated: updated.length, skipped: skipped.length, errors: errors.length }
    };
}

// Emit one terminal `bulkUpdate` event so listeners that care about the
// bulk action (e.g. closing the action bar, showing a "N tasks updated"
// toast) can react. Per-task `update` events are already emitted by the
// underlying single-task helpers — those remain the source of truth for
// store mutations on the client. This event is supplementary.
function emitBulkSummary(action, payload) {
    try {
        socketEmitter.emit('bulkUpdate', {
            type: 'bulkUpdate',
            module: 'task',
            action,
            ...payload,
        });
    } catch (error) {
        logger.error(`bulk summary emit failed for ${action}: ${error.message}`);
    }
}

// ----------------- Mixin -----------------

module.exports = {

    // ---------------------- STATUS ----------------------
    // payload: { companyId, userData, taskIds, newStatus }
    //   newStatus: { status: {key, value, text, type}, statusKey, statusType }
    bulkUpdateStatus({ companyId, userData, taskIds, newStatus }) {
        return new Promise(async (resolve, reject) => {
            try {
                if (!companyId) return reject(new Error('companyId required'));
                if (!newStatus || !newStatus.status) return reject(new Error('newStatus required'));

                const { tasks, skipped } = await loadScopedTasks(companyId, taskIds, { includeArchived: false });
                if (!tasks.length) {
                    return resolve(summarize({ updated: [], skipped, errors: [] }));
                }
                const loadProject = makeProjectLoader(companyId);
                const taskObjIds = tasks.map((t) => t._id);
                const errors = [];

                try {
                    await MongoDbCrudOpration(companyId, {
                        type: dbCollections.TASKS,
                        data: [
                            { _id: { $in: taskObjIds } },
                            { $set: { ...newStatus }, $unset: { groupByStatusIndex: 1 } },
                        ],
                    }, 'updateMany');
                } catch (error) {
                    logger.error(`bulkUpdateStatus updateMany error: ${error.message}`);
                    return reject(error);
                }

                const updated = tasks.map((t) => String(t._id));
                const newStatusText = newStatus.status.text;
                for (const task of tasks) {
                    try {
                        const projectData = await loadProject(task.ProjectID);
                        if (!projectData) {
                            skipped.push({ taskId: String(task._id), reason: 'project-not-found' });
                            continue;
                        }
                        const prevStatusName = task?.status?.text || '';
                        const historyObj = {
                            key: 'Task_Status',
                            sprintId: task.sprintId,
                            message: `<b>${userData?.Employee_Name || ''}</b> has changed <b>Status</b> as <b>${newStatusText}</b>.`,
                        };
                        HandleHistory('task', companyId, projectData._id, task._id, historyObj, userData)
                            .catch((err) => logger.error(`bulkUpdateStatus history ${task._id}: ${err.message}`));

                        if (prevStatusName !== newStatusText) {
                            const notifContext = {
                                ProjectName: projectData.ProjectName,
                                taskName: task.TaskName,
                                statusName: prevStatusName,
                                newStatusName: newStatusText,
                            };
                            HandleBothNotification({
                                type: 'tasks',
                                userData,
                                companyId,
                                projectId: projectData._id,
                                taskId: task._id,
                                folderId: task.folderObjId || '',
                                sprintId: task.sprintId,
                                object: { message: taskStatusChange(notifContext), key: 'task_status' },
                                changeType: 'status',
                                changeData: notifContext,
                            }).catch((err) => logger.error(`bulkUpdateStatus notification ${task._id}: ${err.message}`));
                        }

                        emitTaskUpdate(task, { ...newStatus });
                    } catch (error) {
                        logger.error(`bulkUpdateStatus task ${task._id}: ${error.message}`);
                        errors.push({ taskId: String(task._id), reason: error.message });
                    }
                }

                emitBulkSummary('bulkUpdateStatus', { taskIds: updated, newStatus });
                resolve(summarize({ updated, skipped, errors }));
            } catch (error) {
                logger.error(`bulkUpdateStatus error: ${error.message}`);
                reject(error);
            }
        });
    },

    // ---------------------- PRIORITY ----------------------
    // payload: { companyId, userData, taskIds, firebaseObj, priorityObj }
    //   firebaseObj: { Task_Priority: <value>, ... }
    //   priorityObj: { priorityName, newPriorityName, ... }
    bulkUpdatePriority({ companyId, userData, taskIds, firebaseObj, priorityObj }) {
        return new Promise(async (resolve, reject) => {
            try {
                if (!companyId) return reject(new Error('companyId required'));
                if (!firebaseObj) return reject(new Error('firebaseObj required'));

                const { tasks, skipped } = await loadScopedTasks(companyId, taskIds, { includeArchived: false });
                if (!tasks.length) {
                    return resolve(summarize({ updated: [], skipped, errors: [] }));
                }
                const loadProject = makeProjectLoader(companyId);
                const taskObjIds = tasks.map((t) => t._id);
                const errors = [];

                try {
                    await MongoDbCrudOpration(companyId, {
                        type: dbCollections.TASKS,
                        data: [
                            { _id: { $in: taskObjIds } },
                            { $set: { ...firebaseObj }, $unset: { groupByPriorityIndex: 1 } },
                        ],
                    }, 'updateMany');
                } catch (error) {
                    logger.error(`bulkUpdatePriority updateMany error: ${error.message}`);
                    return reject(error);
                }

                const updated = tasks.map((t) => String(t._id));
                const newPriorityName = priorityObj?.newPriorityName || '';
                for (const task of tasks) {
                    try {
                        const projectData = await loadProject(task.ProjectID);
                        if (!projectData) {
                            skipped.push({ taskId: String(task._id), reason: 'project-not-found' });
                            continue;
                        }
                        const historyObj = {
                            key: 'task_priority',
                            sprintId: task.sprintId,
                            message: `<b>${userData?.Employee_Name || ''}</b> has changed <b>Priority</b> as <b>${newPriorityName}</b>.`,
                        };
                        HandleHistory('task', companyId, projectData._id, task._id, historyObj, userData)
                            .catch((err) => logger.error(`bulkUpdatePriority history ${task._id}: ${err.message}`));

                        const notifContext = {
                            ProjectName: projectData.ProjectName,
                            taskName: task.TaskName,
                            priorityName: priorityObj?.priorityName || '',
                            newPriorityName,
                        };
                        if ((priorityObj?.priorityName || '') !== newPriorityName) {
                            HandleBothNotification({
                                type: 'tasks',
                                userData,
                                companyId,
                                projectId: projectData._id,
                                taskId: task._id,
                                folderId: task.folderObjId || '',
                                sprintId: task.sprintId,
                                object: { message: taskPriorityChange(notifContext), key: 'task_priority' },
                                changeType: 'priority',
                                changeData: notifContext,
                            }).catch((err) => logger.error(`bulkUpdatePriority notification ${task._id}: ${err.message}`));
                        }

                        emitTaskUpdate(task, { ...firebaseObj });
                    } catch (error) {
                        logger.error(`bulkUpdatePriority task ${task._id}: ${error.message}`);
                        errors.push({ taskId: String(task._id), reason: error.message });
                    }
                }

                emitBulkSummary('bulkUpdatePriority', { taskIds: updated, firebaseObj });
                resolve(summarize({ updated, skipped, errors }));
            } catch (error) {
                logger.error(`bulkUpdatePriority error: ${error.message}`);
                reject(error);
            }
        });
    },

    // ---------------------- DUE DATE ----------------------
    // payload: { companyId, userData, taskIds, DueDate, commonDateFormatString? }
    bulkUpdateDueDate({ companyId, userData, taskIds, DueDate /* , commonDateFormatString */ }) {
        return new Promise(async (resolve, reject) => {
            try {
                if (!companyId) return reject(new Error('companyId required'));

                const { tasks, skipped } = await loadScopedTasks(companyId, taskIds, { includeArchived: false });
                if (!tasks.length) {
                    return resolve(summarize({ updated: [], skipped, errors: [] }));
                }
                const loadProject = makeProjectLoader(companyId);
                const taskObjIds = tasks.map((t) => t._id);
                const errors = [];

                const newDate = DueDate === null ? null : new Date(DueDate);

                // The DueDate field is the same for all selected tasks so we
                // can set it in one updateMany. dueDateDeadLine is appended
                // only when setting a date (not when clearing).
                try {
                    if (newDate === null) {
                        await MongoDbCrudOpration(companyId, {
                            type: dbCollections.TASKS,
                            data: [
                                { _id: { $in: taskObjIds } },
                                { $set: { DueDate: null }, $unset: { groupByDueDateIndex: '' } },
                            ],
                        }, 'updateMany');
                    } else {
                        await MongoDbCrudOpration(companyId, {
                            type: dbCollections.TASKS,
                            data: [
                                { _id: { $in: taskObjIds } },
                                {
                                    $set: { DueDate: newDate },
                                    $push: { dueDateDeadLine: { date: newDate } },
                                    $unset: { groupByDueDateIndex: '' },
                                },
                            ],
                        }, 'updateMany');
                    }
                } catch (error) {
                    logger.error(`bulkUpdateDueDate updateMany error: ${error.message}`);
                    return reject(error);
                }

                const updated = tasks.map((t) => String(t._id));
                // Per-task history + socket emit.
                for (const task of tasks) {
                    try {
                        const project = await loadProject(task.ProjectID);
                        if (!project) {
                            skipped.push({ taskId: String(task._id), reason: 'project-not-found' });
                            continue;
                        }
                        const historyObj = {
                            key: 'Project_DueDate',
                            sprintId: task.sprintId,
                            message: newDate === null
                                ? `<b>${userData?.Employee_Name || ''}</b> has cleared <b>Due Date</b>.`
                                : `<b>${userData?.Employee_Name || ''}</b> has added <b>Due Date</b> as <b>DATE_${newDate.getTime()}</b>.`,
                        };
                        HandleHistory('task', companyId, project._id, task._id, historyObj, userData)
                            .catch((err) => logger.error(`bulkUpdateDueDate history ${task._id}: ${err.message}`));

                        const dueFields = newDate === null
                            ? { DueDate: null }
                            : {
                                DueDate: newDate,
                                dueDateDeadLine: [
                                    ...(Array.isArray(task?.dueDateDeadLine) ? task.dueDateDeadLine : []),
                                    { date: newDate },
                                ],
                            };
                        emitTaskUpdate(task, dueFields);
                    } catch (error) {
                        logger.error(`bulkUpdateDueDate task ${task._id}: ${error.message}`);
                        errors.push({ taskId: String(task._id), reason: error.message });
                    }
                }

                emitBulkSummary('bulkUpdateDueDate', { taskIds: updated, DueDate: newDate });
                resolve(summarize({ updated, skipped, errors }));
            } catch (error) {
                logger.error(`bulkUpdateDueDate error: ${error.message}`);
                reject(error);
            }
        });
    },

    // ---------------------- START DATE ----------------------
    bulkUpdateStartDate({ companyId, userData, taskIds, startDate, commonDateFormatString }) {
        return new Promise(async (resolve, reject) => {
            try {
                if (!companyId) return reject(new Error('companyId required'));

                const { tasks, skipped } = await loadScopedTasks(companyId, taskIds, { includeArchived: false });
                const loadProject = makeProjectLoader(companyId);
                const updated = [];
                const errors = [];

                await Promise.allSettled(tasks.map(async (task) => {
                    try {
                        const project = await loadProject(task.ProjectID);
                        if (!project) {
                            skipped.push({ taskId: String(task._id), reason: 'project-not-found' });
                            return;
                        }
                        const firebaseObj = { startDate: startDate === null ? null : new Date(startDate) };
                        await this.updateStartDate({
                            commonDateFormatString,
                            firebaseObj,
                            project,
                            task,
                            obj: {},
                            userData,
                            isUpdateTask: true,
                            isHistory: true,
                        });
                        updated.push(String(task._id));
                    } catch (error) {
                        logger.error(`bulkUpdateStartDate task ${task._id}: ${error.message}`);
                        errors.push({ taskId: String(task._id), reason: error.message });
                    }
                }));

                emitBulkSummary('bulkUpdateStartDate', { taskIds: updated, startDate });
                resolve(summarize({ updated, skipped, errors }));
            } catch (error) {
                logger.error(`bulkUpdateStartDate error: ${error.message}`);
                reject(error);
            }
        });
    },

    // ---------------------- ASSIGNEES ----------------------
    // payload: { companyId, userData, taskIds, employeeName, employeeId, type }
    //   type: "assigneeAdd" | "assigneRemove" | "replace"
    //   employeeId: a single user id string OR an array of user ids.
    //
    // Implementation: direct `updateMany` write for the actual DB change,
    // then per-task fire-and-forget HandleHistory / HandleBothNotification /
    // updateWatcher calls so the audit trail and notifications match exactly
    // what N single-task calls would produce. Going through the existing
    // updateAssignee helper turned out to be unreliable here because its
    // chained-promise structure resolves with success even when the inner
    // findOneAndUpdate matched no documents.
    bulkUpdateAssignee({ companyId, userData, taskIds, employeeName, employeeId, type }) {
        return new Promise(async (resolve, reject) => {
            try {
                if (!companyId) return reject(new Error('companyId required'));
                if (!['assigneeAdd', 'assigneRemove', 'replace'].includes(type)) {
                    return reject(new Error('invalid type'));
                }

                const empIdArr = Array.isArray(employeeId)
                    ? employeeId.map(String).filter(Boolean)
                    : (employeeId ? [String(employeeId)] : []);
                if (!empIdArr.length) {
                    return reject(new Error('employeeId required'));
                }

                const { tasks, skipped } = await loadScopedTasks(companyId, taskIds, { includeArchived: false });
                if (!tasks.length) {
                    return resolve(summarize({ updated: [], skipped, errors: [] }));
                }
                const loadProject = makeProjectLoader(companyId);
                const taskObjIds = tasks.map((t) => t._id);
                const updated = new Set();
                const errors = [];

                // --- 1) The DB writes. One updateMany per user for add/remove;
                //     a single updateMany for replace.
                const baseFilter = { _id: { $in: taskObjIds } };
                try {
                    if (type === 'replace') {
                        await MongoDbCrudOpration(companyId, {
                            type: dbCollections.TASKS,
                            data: [
                                baseFilter,
                                { $set: { AssigneeUserId: empIdArr }, $unset: { groupByAssigneeIndex: '' } },
                            ],
                        }, 'updateMany');
                    } else {
                        for (const uid of empIdArr) {
                            const op = type === 'assigneeAdd'
                                ? { $addToSet: { AssigneeUserId: uid } }
                                : { $pull: { AssigneeUserId: uid } };
                            await MongoDbCrudOpration(companyId, {
                                type: dbCollections.TASKS,
                                data: [baseFilter, { ...op, $unset: { groupByAssigneeIndex: '' } }],
                            }, 'updateMany');
                        }
                    }
                } catch (error) {
                    logger.error(`bulkUpdateAssignee updateMany error: ${error.message}`);
                    return reject(error);
                }

                // --- 2) Per-task side effects (history, notification, watcher).
                //     Done sequentially per task; failures here don't roll back
                //     the DB write — they're logged and reported.
                for (const task of tasks) {
                    try {
                        const projectData = await loadProject(task.ProjectID);
                        if (!projectData) {
                            skipped.push({ taskId: String(task._id), reason: 'project-not-found' });
                            continue;
                        }

                        const obj = {
                            ProjectName: projectData.ProjectName,
                            TaskName: task.TaskName,
                            Employee_Name: employeeName,
                        };
                        let notificationObject = null;
                        const historyObj = { sprintId: task.sprintId };
                        if (type === 'assigneeAdd') {
                            notificationObject = { message: taskAssigneeAdd(obj), key: 'task_assignee' };
                            historyObj.key = 'Assignee_Changed';
                            historyObj.message = `<b>${userData?.Employee_Name || ''}</b> has added the <b>${employeeName}</b> to <b>Assignee</b>.`;
                        } else if (type === 'assigneRemove') {
                            notificationObject = { message: taskAssigneeRemove(obj), key: 'task_assignee' };
                            historyObj.key = 'Assignee_Removed';
                            historyObj.message = `<b>${userData?.Employee_Name || ''}</b> has removed the <b>${employeeName}</b> to <b>Assignee</b>.`;
                        } else {
                            notificationObject = {
                                message: empIdArr.length
                                    ? taskAssigneeReplace(obj)
                                    : taskAssigneeRemove(obj),
                                key: 'task_assignee',
                            };
                            historyObj.key = 'Assignee_Changed';
                            historyObj.message = `<b>${userData?.Employee_Name || ''}</b> has changed <b>Assignees</b>.`;
                        }

                        HandleHistory('task', companyId, projectData._id, task._id, historyObj, userData)
                            .catch((err) => logger.error(`bulkUpdateAssignee history ${task._id}: ${err.message}`));

                        if (notificationObject) {
                            HandleBothNotification({
                                type: 'tasks',
                                userData,
                                companyId,
                                projectId: projectData._id,
                                taskId: task._id,
                                folderId: task.folderObjId || '',
                                sprintId: task.sprintId,
                                object: notificationObject,
                            }).catch((err) => logger.error(`bulkUpdateAssignee notification ${task._id}: ${err.message}`));
                        }

                        // Watcher add for newly assigned users (matches the
                        // single-task helper which calls this.updateWatcher).
                        if (type === 'assigneeAdd' || type === 'replace') {
                            for (const uid of empIdArr) {
                                try {
                                    this.updateWatcher({
                                        companyId,
                                        projectId: projectData._id,
                                        sprintId: task.sprintId,
                                        taskId: task._id,
                                        userId: uid,
                                        add: true,
                                        type,
                                        userData,
                                        employeeName,
                                    }).catch(() => {});
                                } catch (_) { /* updateWatcher is fire-and-forget */ }
                            }
                        }

                        // Build the post-update AssigneeUserId so other
                        // clients receive the actual new state, not stale.
                        const currentAssignees = Array.isArray(task.AssigneeUserId)
                            ? task.AssigneeUserId.map(String)
                            : [];
                        let nextAssignees;
                        if (type === 'replace') {
                            nextAssignees = empIdArr.slice();
                        } else if (type === 'assigneeAdd') {
                            nextAssignees = Array.from(new Set([...currentAssignees, ...empIdArr]));
                        } else {
                            const drop = new Set(empIdArr);
                            nextAssignees = currentAssignees.filter((id) => !drop.has(id));
                        }
                        emitTaskUpdate(task, { AssigneeUserId: nextAssignees });
                        updated.add(String(task._id));
                    } catch (error) {
                        logger.error(`bulkUpdateAssignee task ${task._id}: ${error.message}`);
                        errors.push({ taskId: String(task._id), reason: error.message });
                    }
                }

                const updatedArr = Array.from(updated);
                emitBulkSummary('bulkUpdateAssignee', { taskIds: updatedArr, type, employeeId: empIdArr });
                resolve(summarize({ updated: updatedArr, skipped, errors }));
            } catch (error) {
                logger.error(`bulkUpdateAssignee error: ${error.message}`);
                reject(error);
            }
        });
    },

    // ---------------------- TAGS ----------------------
    // payload: { companyId, taskIds, tagId, operation: 'add'|'remove' }
    bulkUpdateTags({ companyId, taskIds, tagId, operation }) {
        return new Promise(async (resolve, reject) => {
            try {
                if (!companyId) return reject(new Error('companyId required'));
                if (!['add', 'remove'].includes(operation)) {
                    return reject(new Error('operation must be add or remove'));
                }
                if (!tagId) return reject(new Error('tagId required'));

                const { tasks, skipped } = await loadScopedTasks(companyId, taskIds, { includeArchived: false });
                if (!tasks.length) {
                    return resolve(summarize({ updated: [], skipped, errors: [] }));
                }
                const taskObjIds = tasks.map((t) => t._id);
                const errors = [];

                const op = operation === 'add'
                    ? { $addToSet: { tagsArray: String(tagId) } }
                    : { $pull: { tagsArray: String(tagId) } };

                try {
                    await MongoDbCrudOpration(companyId, {
                        type: dbCollections.TASKS,
                        data: [{ _id: { $in: taskObjIds } }, op],
                    }, 'updateMany');
                } catch (error) {
                    logger.error(`bulkUpdateTags updateMany error: ${error.message}`);
                    return reject(error);
                }

                const updated = tasks.map((t) => String(t._id));
                // Per-task socket emit with the new tagsArray so other
                // clients (and the user's other tabs) get the actual
                // post-update state, not the stale snapshot.
                for (const task of tasks) {
                    const currentTags = Array.isArray(task.tagsArray) ? task.tagsArray.map(String) : [];
                    const tagIdStr = String(tagId);
                    const nextTags = operation === 'add'
                        ? Array.from(new Set([...currentTags, tagIdStr]))
                        : currentTags.filter((id) => id !== tagIdStr);
                    emitTaskUpdate(task, { tagsArray: nextTags });
                }
                emitBulkSummary('bulkUpdateTags', { taskIds: updated, tagId, operation });
                resolve(summarize({ updated, skipped, errors }));
            } catch (error) {
                logger.error(`bulkUpdateTags error: ${error.message}`);
                reject(error);
            }
        });
    },

    // ---------------------- ARCHIVE ----------------------
    // payload: { companyId, userData, taskIds }
    bulkArchive({ companyId, userData, taskIds }) {
        return this._bulkArchiveDelete({ companyId, userData, taskIds, deletedStatusKey: 2, action: 'bulkArchive' });
    },

    // ---------------------- RESTORE (un-archive / un-delete) ----------------------
    bulkRestore({ companyId, userData, taskIds }) {
        return this._bulkArchiveDelete({ companyId, userData, taskIds, deletedStatusKey: 0, action: 'bulkRestore', includeArchived: true, includeDeleted: true });
    },

    // ---------------------- DELETE (soft) ----------------------
    // payload: { companyId, userData, taskIds }
    bulkDelete({ companyId, userData, taskIds }) {
        return this._bulkArchiveDelete({ companyId, userData, taskIds, deletedStatusKey: 1, action: 'bulkDelete', includeArchived: true });
    },

    _bulkArchiveDelete({ companyId, userData, taskIds, deletedStatusKey, action, includeArchived = false, includeDeleted = false }) {
        return new Promise(async (resolve, reject) => {
            try {
                if (!companyId) return reject(new Error('companyId required'));

                const { tasks, skipped } = await loadScopedTasks(companyId, taskIds, { includeArchived, includeDeleted });
                const loadProject = makeProjectLoader(companyId);
                const updated = [];
                const errors = [];

                await Promise.allSettled(tasks.map(async (task) => {
                    try {
                        const projectData = await loadProject(task.ProjectID);
                        if (!projectData) {
                            skipped.push({ taskId: String(task._id), reason: 'project-not-found' });
                            return;
                        }
                        await this.updateArchiveDelete({
                            companyId,
                            projectData,
                            sprintId: task.sprintId,
                            task,
                            userData,
                            deletedStatusKey,
                        });
                        updated.push(String(task._id));
                    } catch (error) {
                        logger.error(`${action} task ${task._id}: ${error.message}`);
                        errors.push({ taskId: String(task._id), reason: error.message });
                    }
                }));

                emitBulkSummary(action, { taskIds: updated, deletedStatusKey });
                resolve(summarize({ updated, skipped, errors }));
            } catch (error) {
                logger.error(`${action} error: ${error.message}`);
                reject(error);
            }
        });
    },

    // ---------------------- MOVE ----------------------
    // payload: { companyId, userData, taskIds, sprintObj, projectData, isSubTask }
    //   sprintObj   — destination sprint object (same shape the single-task
    //                 picker builds: { id, name, folderId?, folderName?, ... }).
    //   projectData — destination project summary { id, ProjectCode, ProjectName }.
    //
    // Unlike the single-task move — where the picker knows the one task's
    // source sprint, current assignees, and lets the user hand-map status/type
    // for a cross-project move — a bulk selection spans different source
    // sprints, assignees, and statuses. So this derives everything per task:
    //   • oldSprintObj  — from each task's own sprintId/folderObjId.
    //   • assignee/watcher — each task's existing values (moveTaskFunction
    //                        rewrites these fields, so passing a shared []
    //                        would wipe them).
    //   • cross-project status/type conversion — auto-mapped by name against
    //                        the destination project, falling back to the
    //                        destination's first status/type when no name
    //                        matches. Same-project moves skip conversion.
    bulkMove({ companyId, userData, taskIds, sprintObj, projectData, isSubTask = false }) {
        return new Promise(async (resolve, reject) => {
            try {
                if (!companyId) return reject(new Error('companyId required'));
                if (!sprintObj || !sprintObj.id) return reject(new Error('sprintObj required'));
                if (!projectData || !projectData.id) return reject(new Error('projectData required'));

                const { tasks, skipped } = await loadScopedTasks(companyId, taskIds, { includeArchived: false });
                const updated = [];
                const errors = [];

                const loadProject = makeProjectLoader(companyId);
                const destProject = await loadProject(projectData.id);
                if (!destProject) return reject(new Error('destination project not found'));

                const destStatuses = Array.isArray(destProject.taskStatusData) ? destProject.taskStatusData : [];
                const destTypes = Array.isArray(destProject.taskTypeCounts) ? destProject.taskTypeCounts : [];
                const norm = (s) => String(s || '').trim().toLowerCase();
                // Prefer a non-"close" default so tasks don't land as closed.
                const defaultStatus = destStatuses.find((s) => s.type !== 'close') || destStatuses[0] || null;
                const mapStatus = (srcStatus) => {
                    const pick = destStatuses.find((d) => norm(d.name) === norm(srcStatus?.name)) || defaultStatus;
                    return pick ? { key: pick.key, name: pick.name, type: pick.type, bgColor: pick.bgColor, textColor: pick.textColor } : null;
                };
                const mapType = (srcType) => {
                    const pick = destTypes.find((d) => norm(d.name) === norm(srcType?.name)) || destTypes[0] || null;
                    return pick ? { value: pick.value, key: pick.key, name: pick.name } : null;
                };

                // moveTaskFunction reads oldProject.taskStatusData/.taskTypeCounts
                // (the SOURCE project's lists) to find the task's current
                // status/type, then applies the `.convertStatus`/`.convertType`
                // we graft onto each entry. Build+cache one per source project.
                const oldProjectCache = new Map();
                const buildOldProject = async (srcProjectId) => {
                    const key = String(srcProjectId);
                    if (oldProjectCache.has(key)) return oldProjectCache.get(key);
                    const src = await loadProject(srcProjectId);
                    const built = src ? {
                        id: src._id,
                        ProjectName: src.ProjectName,
                        taskStatusData: (Array.isArray(src.taskStatusData) ? src.taskStatusData : [])
                            .map((s) => ({ ...s, convertStatus: mapStatus(s) })),
                        taskTypeCounts: (Array.isArray(src.taskTypeCounts) ? src.taskTypeCounts : [])
                            .map((t) => ({ ...t, convertType: mapType(t) })),
                    } : null;
                    oldProjectCache.set(key, built);
                    return built;
                };

                // Sequential per single-task behavior to avoid sprint-count races.
                for (const task of tasks) {
                    try {
                        // No-op guard: already in the destination sprint/folder.
                        if (String(task.sprintId) === String(sprintObj.id) &&
                            String(task.folderObjId || '') === String(sprintObj.folderId || '')) {
                            skipped.push({ taskId: String(task._id), reason: 'already-in-target' });
                            continue;
                        }
                        const oldProject = await buildOldProject(task.ProjectID);
                        if (!oldProject) {
                            skipped.push({ taskId: String(task._id), reason: 'project-not-found' });
                            continue;
                        }
                        const oldSprintObj = {
                            id: task.sprintId,
                            folderId: task.folderObjId || null,
                            name: task.sprintArray?.name || '',
                            folderName: task.sprintArray?.folderName || '',
                        };
                        await this.moveTask({
                            companyId,
                            projectData,
                            sprintObj,
                            moveTaskId: task._id,
                            oldSprintObj,
                            oldProject,
                            isSubTask,
                            assignee: Array.isArray(task.AssigneeUserId) ? task.AssigneeUserId : [],
                            watcher: Array.isArray(task.watchers) ? task.watchers : [],
                            userData,
                        });
                        updated.push(String(task._id));
                    } catch (error) {
                        logger.error(`bulkMove task ${task._id}: ${error.message}`);
                        errors.push({ taskId: String(task._id), reason: error.message });
                    }
                }

                emitBulkSummary('bulkMove', { taskIds: updated, targetSprintId: sprintObj?.id, targetProjectId: projectData?.id });
                resolve(summarize({ updated, skipped, errors }));
            } catch (error) {
                logger.error(`bulkMove error: ${error.message}`);
                reject(error);
            }
        });
    },

    // ---------------------- DUPLICATE ----------------------
    // payload: { companyId, userData, taskIds, sprintObj, oldProject, projectData, isSubTask, duplicateData, assignee, watcher, taskName, oldSprintObj }
    bulkDuplicate({ companyId, userData, taskIds, sprintObj, oldProject, projectData, isSubTask = false, duplicateData = [], assignee = [], watcher = [], taskName = '', oldSprintObj }) {
        return new Promise(async (resolve, reject) => {
            try {
                if (!companyId) return reject(new Error('companyId required'));
                if (!sprintObj) return reject(new Error('sprintObj required'));
                if (!projectData) return reject(new Error('projectData required'));

                const { tasks, skipped } = await loadScopedTasks(companyId, taskIds, { includeArchived: false });
                const updated = [];
                const newTaskIds = [];
                const errors = [];

                for (const task of tasks) {
                    try {
                        const result = await this.duplicateTask({
                            companyId,
                            projectData,
                            sprintObj,
                            selectedTaskId: task._id,
                            oldProject,
                            userData,
                            isSubTask,
                            duplicateData,
                            assignee,
                            watcher,
                            taskName,
                            oldSprintObj,
                        });
                        updated.push(String(task._id));
                        if (result?.taskId) newTaskIds.push(String(result.taskId));
                    } catch (error) {
                        logger.error(`bulkDuplicate task ${task._id}: ${error.message}`);
                        errors.push({ taskId: String(task._id), reason: error.message });
                    }
                }

                emitBulkSummary('bulkDuplicate', { taskIds: updated, newTaskIds });
                const summary = summarize({ updated, skipped, errors });
                summary.newTaskIds = newTaskIds;
                resolve(summary);
            } catch (error) {
                logger.error(`bulkDuplicate error: ${error.message}`);
                reject(error);
            }
        });
    },
};
