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

const { escapeHtml } = require('../../../../utils/escapeHtml');
const { dbCollections } = require('../../../../Config/collections');
const { SCHEMA_TYPE } = require('../../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../../utils/mongo-handler/mongoQueries');
const { default: mongoose } = require('mongoose');
const logger = require('../../../../Config/loggerConfig');
const socketEmitter = require('../../../../event/socketEventEmitter');
const { HandleHistory } = require('../mongo_helper');
const { HandleBothNotification } = require('../handleNotification');
const { recordCompletion } = require('./recordCompletion.js');
const { escapeText, TaskWriteRefusal, statusInProject, NOT_A_PROJECT_STATUS } = require('../taskWriteFields');
const { projectHoldsTag, TAG_NOT_IN_PROJECT } = require('../taskItemHistory');
const { ancestorsOf, loadSubtree, canNest } = require('../taskTree');
const {
    taskAssigneeAdd, taskAssigneeRemove, taskAssigneeReplace,
    taskStatusChange, taskPriorityChange, shownStatus, shownPriority,
} = require('../notificationTemplate');

// convertToTask's inner failure path neither resolves nor rejects, so awaiting
// it can hang forever. Long enough that a slow-but-working conversion is never
// cut short, short enough that one bad task cannot hold a request open.
const CONVERT_DEADLINE_MS = 20000;

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
const emitTaskUpdate = (companyId, task, updatedFields) => {
    try {
        socketEmitter.emit('update', {
            type: 'update',
            data: mergeTaskUpdate(task, updatedFields),
            updatedFields: updatedFields || {},
            module: 'task',
            companyId,
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

/* Asks `judge` once for each project the tasks are in, and answers what it said for a task's project. */
async function judgedByProject(tasks, judge) {
    const verdicts = new Map();
    for (const task of tasks) {
        const projectId = String(task.ProjectID);
        if (!verdicts.has(projectId)) verdicts.set(projectId, await judge(projectId));
    }
    return (task) => verdicts.get(String(task.ProjectID));
}

/* The tasks `verdictOf` passes; the rest join `skipped` under `reason`. */
function keepJudged(found, verdictOf, skipped, reason) {
    found.filter((task) => !verdictOf(task)).forEach((task) => skipped.push({ taskId: String(task._id), reason }));
    return found.filter(verdictOf);
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

/* A Gantt move reaches its whole chain of dependants; past this the request is not one move. */
const MAX_DATE_ROWS = 500;

const readDate = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

function readDateRows(dates) {
    if (!Array.isArray(dates) || !dates.length) return { error: 'dates must list at least one task' };
    if (dates.length > MAX_DATE_ROWS) return { error: `dates may name at most ${MAX_DATE_ROWS} tasks` };
    const rows = new Map();
    for (const row of dates) {
        const taskId = String((row && row.taskId) || '').trim();
        if (!taskId) return { error: 'each row in dates needs a taskId' };
        if (rows.has(taskId)) return { error: 'each task may appear once in dates' };
        const startDate = readDate(row.startDate);
        const DueDate = readDate(row.DueDate);
        if (!startDate || !DueDate || DueDate < startDate) return { error: 'each row in dates needs a start date on or before its due date' };
        rows.set(taskId, { startDate, DueDate });
    }
    return { rows };
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

                const { tasks: found, skipped } = await loadScopedTasks(companyId, taskIds, { includeArchived: false });
                if (!found.length) {
                    return resolve(summarize({ updated: [], skipped, errors: [] }));
                }
                const loadProject = makeProjectLoader(companyId);
                const statusOf = await judgedByProject(found, async (projectId) => statusInProject(await loadProject(projectId), newStatus));
                const tasks = keepJudged(found, statusOf, skipped, 'status-not-in-project');
                if (!tasks.length) return reject(new TaskWriteRefusal(400, NOT_A_PROJECT_STATUS));
                const errors = [];

                try {
                    for (const projectId of new Set(tasks.map((t) => String(t.ProjectID)))) {
                        const inProject = tasks.filter((t) => String(t.ProjectID) === projectId);
                        await MongoDbCrudOpration(companyId, {
                            type: dbCollections.TASKS,
                            data: [
                                { _id: { $in: inProject.map((t) => t._id) } },
                                { $set: { ...statusOf(inProject[0]) }, $unset: { groupByStatusIndex: 1 } },
                            ],
                        }, 'updateMany');
                    }
                } catch (error) {
                    logger.error(`bulkUpdateStatus updateMany error: ${error.message}`);
                    return reject(error);
                }

                const updated = tasks.map((t) => String(t._id));
                for (const task of tasks) {
                    try {
                        const projectData = await loadProject(task.ProjectID);
                        const stored = statusOf(task);
                        const newStatusText = stored.status.text;
                        const prevStatusName = task?.status?.text || '';
                        const historyObj = {
                            key: 'Task_Status',
                            sprintId: task.sprintId,
                            message: `<b>${userData?.Employee_Name || ''}</b> has changed <b>Status</b> as <b>${escapeHtml(newStatusText)}</b>.`,
                        };
                        HandleHistory('task', companyId, projectData._id, task._id, historyObj, userData)
                            .catch((err) => logger.error(`bulkUpdateStatus history ${task._id}: ${err.message}`));

                        if (prevStatusName !== newStatusText) {
                            const notifContext = {
                                ProjectName: projectData.ProjectName,
                                taskName: task.TaskName,
                                ...shownStatus({ statusName: prevStatusName }, stored).template,
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

                        // Same provenance record the single-task path writes; without it a
                        // bulk close left no closedBy and the task showed no badge.
                        recordCompletion({ companyId, taskId: task._id, task, newStatus: stored, userData });

                        emitTaskUpdate(companyId, task, { ...stored });
                    } catch (error) {
                        logger.error(`bulkUpdateStatus task ${task._id}: ${error.message}`);
                        errors.push({ taskId: String(task._id), reason: error.message });
                    }
                }

                emitBulkSummary('bulkUpdateStatus', { taskIds: updated, newStatus: statusOf(tasks[0]) });
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
                            message: `<b>${userData?.Employee_Name || ''}</b> has changed <b>Priority</b> as <b>${escapeHtml(newPriorityName)}</b>.`,
                        };
                        HandleHistory('task', companyId, projectData._id, task._id, historyObj, userData)
                            .catch((err) => logger.error(`bulkUpdatePriority history ${task._id}: ${err.message}`));

                        const notifContext = {
                            ProjectName: projectData.ProjectName,
                            taskName: task.TaskName,
                            ...shownPriority({ priorityName: priorityObj?.priorityName || '', newPriorityName }).template,
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

                        emitTaskUpdate(companyId, task, { ...firebaseObj });
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
                        emitTaskUpdate(companyId, task, dueFields);
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

    async bulkUpdateDates({ companyId, userData, dates }) {
        if (!companyId) throw new Error('companyId required');
        const wanted = readDateRows(dates);
        if (wanted.error) throw new Error(wanted.error);

        const { tasks, skipped } = await loadScopedTasks(companyId, [...wanted.rows.keys()], { includeArchived: false });
        if (!tasks.length) return summarize({ updated: [], skipped, errors: [] });
        const fieldsOf = (task) => wanted.rows.get(String(task._id));

        try {
            await MongoDbCrudOpration(companyId, {
                type: dbCollections.TASKS,
                data: [tasks.map((task) => ({ updateOne: { filter: { _id: task._id }, update: { $set: fieldsOf(task) } } }))],
            }, 'bulkWrite');
        } catch (error) {
            logger.error(`bulkUpdateDates bulkWrite error: ${error.message}`);
            throw error;
        }

        tasks.forEach((task) => {
            emitTaskUpdate(companyId, task, fieldsOf(task));
            const historyObj = {
                key: 'Project_DueDate',
                sprintId: task.sprintId,
                message: `<b>${userData?.Employee_Name || ''}</b> rescheduled the task on the Gantt.`,
            };
            HandleHistory('task', companyId, task.ProjectID, task._id, historyObj, userData)
                .catch((err) => logger.error(`bulkUpdateDates history ${task._id}: ${err.message}`));
        });

        const updated = tasks.map((task) => String(task._id));
        emitBulkSummary('bulkUpdateDates', { taskIds: updated });
        return summarize({ updated, skipped, errors: [] });
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
    bulkUpdateAssignee({ companyId, userData, taskIds, employeeName: sentName, employeeId, type }) {
        return new Promise(async (resolve, reject) => {
            try {
                if (!companyId) return reject(new Error('companyId required'));
                const employeeName = Array.isArray(sentName) ? sentName.map(escapeText).join(',') : escapeText(sentName);
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
                                        employeeName: sentName,
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
                        emitTaskUpdate(companyId, task, { AssigneeUserId: nextAssignees });
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

                const { tasks: found, skipped } = await loadScopedTasks(companyId, taskIds, { includeArchived: false });
                if (!found.length) {
                    return resolve(summarize({ updated: [], skipped, errors: [] }));
                }
                // A tag the project no longer has can still be taken off its tasks.
                const holdsTag = operation === 'add'
                    ? await judgedByProject(found, (projectId) => projectHoldsTag(companyId, projectId, tagId))
                    : () => true;
                const tasks = keepJudged(found, holdsTag, skipped, 'tag-not-in-project');
                if (!tasks.length) return reject(new TaskWriteRefusal(400, TAG_NOT_IN_PROJECT));
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
                    emitTaskUpdate(companyId, task, { tagsArray: nextTags });
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

    // Same soft delete under the name the Trash page and bulk bar use.
    bulkTrash({ companyId, userData, taskIds }) {
        return this._bulkArchiveDelete({ companyId, userData, taskIds, deletedStatusKey: 1, action: 'bulkTrash', includeArchived: true });
    },

    _bulkArchiveDelete({ companyId, userData, taskIds, deletedStatusKey, action, includeArchived = false, includeDeleted = false }) {
        return new Promise(async (resolve, reject) => {
            try {
                if (!companyId) return reject(new Error('companyId required'));

                const { tasks: selected, skipped } = await loadScopedTasks(companyId, taskIds, { includeArchived, includeDeleted });
                const loadProject = makeProjectLoader(companyId);
                const updated = [];
                const errors = [];

                /* Archiving or deleting a live task carries its live subtree, so a live row
                 * selected together with a live task above it is left to that cascade. Handled
                 * on its own as well, it would race the cascade for its state and its count. */
                const liveSelected = new Set(selected.filter((t) => !t.deletedStatusKey).map((t) => String(t._id)));
                const carriedByAnother = (task) => deletedStatusKey !== 0 && !task.deletedStatusKey
                    && [String(task.ParentTaskId || ''), ...ancestorsOf(task)].some((above) => liveSelected.has(above));
                const tasks = selected.filter((task) => {
                    if (!carriedByAnother(task)) return true;
                    skipped.push({ taskId: String(task._id), reason: 'carried-with-its-parent' });
                    return false;
                });

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
    // payload: { companyId, userData, taskIds, sprintObj, projectData }
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
    //   • subtasks — a selected parent's subtasks travel with it, each
    //                        keeping its own assignees and watchers.
    bulkMove({ companyId, userData, taskIds, sprintObj, projectData }) {
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

                // A subtask lives in its parent's sprint and is only ever rendered
                // nested under it, so a parent that moves alone leaves its subtasks
                // somewhere nobody can reach: the destination looks them up by the
                // DESTINATION's sprintId and finds none, and the source list only
                // renders parents. The parent still advertises "2 subtasks" and opens
                // empty. Single-task move has always carried them — the sidebar sets
                // isSubTask whenever the task has any — and bulk passed false.
                //
                // They are enumerated here rather than handed to moveTask's own
                // isSubTask branch on purpose. That branch applies ONE
                // assignee/watcher pair across the whole family, which is right for
                // the single-task sidebar (a person picked them for this move) and
                // wrong here, where every task has to keep its own. So each task,
                // parent or subtask, moves on its own values.
                const selectedRoots = new Set(tasks.filter((t) => t.isParentTask === true).map((t) => String(t._id)));
                const queue = [];
                const queued = new Set();
                const enqueue = (task, carried) => {
                    const key = String(task._id);
                    if (queued.has(key)) return;
                    queued.add(key);
                    queue.push({ task, carried });
                };

                for (const task of tasks) {
                    if (task.isParentTask !== true) {
                        // The task it sits under, at any level, is selected too, so that
                        // task's pass below picks it up. Moving it here as well would
                        // move it twice.
                        if ([String(task.ParentTaskId || ''), ...ancestorsOf(task)].some((id) => selectedRoots.has(id))) continue;

                        // On its own, though, it does not move at all. A subtask has no
                        // existence outside its parent: the list renders subtasks nested
                        // under the parent and looks them up one sprint at a time, so a
                        // subtask sitting in a sprint its parent is not in appears in
                        // neither. The single-task action refuses this outright — a
                        // subtask's own Move opens a picker of PARENT TASKS, never a
                        // bare sprint. Bulk used to allow it and quietly produce exactly
                        // the state this whole change exists to stop.
                        //
                        // Giving a subtask a different parent is a real thing to want;
                        // it is just a different action, and the bar has it.
                        skipped.push({ taskId: String(task._id), reason: 'subtask-moves-with-its-parent' });
                        continue;
                    }

                    // Looked up BEFORE the parent is queued: a failed lookup must not
                    // quietly move the parent on its own and strand them, which is the
                    // bug being fixed.
                    //
                    // Deliberately NOT scoped to the parent's own sprint. A subtask in
                    // a different sprint from its parent renders in neither, so that
                    // state is only ever corruption — and every selection that has
                    // been bulk-moved before this fix has some. Matching on parentage
                    // alone means selecting the parent gathers them all back, which is
                    // the one way an already-stranded subtask can be reached at all.
                    const children = await loadSubtree(companyId, task._id, { filter: { deletedStatusKey: { $nin: [1] } } }).catch((error) => {
                        logger.error(`bulkMove subtasks of ${task._id}: ${error.message}`);
                        return null;
                    });

                    if (children === null) {
                        errors.push({ taskId: String(task._id), reason: 'could not read its subtasks' });
                        continue;
                    }
                    enqueue(task, false);
                    children.forEach((child) => enqueue(child, true));
                }

                // Sequential per single-task behavior to avoid sprint-count races.
                for (const { task, carried } of queue) {
                    try {
                        // No-op guard: already in the destination sprint/folder.
                        if (String(task.sprintId) === String(sprintObj.id) &&
                            String(task.folderObjId || '') === String(sprintObj.folderId || '')) {
                            if (!carried) skipped.push({ taskId: String(task._id), reason: 'already-in-target' });
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
                            // Each task moves as itself; the family was expanded above.
                            isSubTask: false,
                            rowOnly: true,
                            carried,
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

    // ---------------------- CONVERT TO SUBTASK ----------------------
    // payload: { companyId, userData, taskIds, parentTaskId }
    //
    // Makes every selected task a subtask of one chosen parent. The destination
    // sprint, folder and project are NOT parameters: a subtask lives where its
    // parent lives, so they are read off the parent and the existing
    // convertToSubTask path does the relocation.
    //
    // Reuses that path per task rather than reimplementing it, so history, the
    // parent's subTasks counter, comment counts, the per-task socket events and
    // the cross-project status/type remap all behave exactly as the single-task
    // action does.
    //
    // It does NOT inherit that path's reporting. convertToSubTask settles its
    // per-task promises with Promise.allSettled and then resolves success
    // regardless of what rejected inside, so a partial failure reads as a clean
    // run. Every conversion here is verified by re-reading the task, and only a
    // task that actually ended up under the parent is counted as updated.
    bulkConvertToSubTask({ companyId, userData, taskIds, parentTaskId }) {
        return new Promise(async (resolve, reject) => {
            try {
                if (!companyId) return reject(new Error('companyId required'));
                const parentObjId = toObjectId(parentTaskId);
                if (!parentObjId) return reject(new Error('a valid parentTaskId is required'));

                const parent = await MongoDbCrudOpration(companyId, {
                    type: dbCollections.TASKS,
                    data: [{ _id: parentObjId }],
                }, 'findOne');
                if (!parent) return reject(new Error('parent task not found'));
                if (parent.deletedStatusKey === 1) return reject(new Error('that parent task has been deleted'));
                const room = canNest(parent.ParentTaskId ? parent : { _id: parent._id });
                if (!room.ok) return reject(new TaskWriteRefusal(400, room.reason, room.code));

                const { tasks, skipped } = await loadScopedTasks(companyId, taskIds, { includeArchived: false });
                const updated = [];
                const errors = [];

                const loadProject = makeProjectLoader(companyId);
                const destProject = await loadProject(parent.ProjectID);
                if (!destProject) return reject(new Error('the parent task\'s project could not be read'));

                const destStatuses = Array.isArray(destProject.taskStatusData) ? destProject.taskStatusData : [];
                const destTypes = Array.isArray(destProject.taskTypeCounts) ? destProject.taskTypeCounts : [];
                const norm = (s) => String(s || '').trim().toLowerCase();
                const defaultStatus = destStatuses.find((s) => s.type !== 'close') || destStatuses[0] || null;
                const mapStatus = (srcStatus) => {
                    const pick = destStatuses.find((d) => norm(d.name) === norm(srcStatus?.name)) || defaultStatus;
                    return pick ? { key: pick.key, name: pick.name, type: pick.type, bgColor: pick.bgColor, textColor: pick.textColor } : null;
                };
                const mapType = (srcType) => {
                    const pick = destTypes.find((d) => norm(d.name) === norm(srcType?.name)) || destTypes[0] || null;
                    return pick ? { value: pick.value, key: pick.key, name: pick.name } : null;
                };

                // convertToSubTaskFunction reads the SOURCE project's lists and
                // applies the `.convertStatus`/`.convertType` grafted onto each
                // entry when the task crosses projects. Same shape bulkMove builds.
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

                const selectedIds = new Set(tasks.map((t) => String(t._id)));
                const candidates = [];
                for (const task of tasks) {
                    const id = String(task._id);
                    if (id === String(parent._id)) {
                        skipped.push({ taskId: id, reason: 'is-the-chosen-parent' });
                        continue;
                    }
                    if (String(task.ParentTaskId || '') === String(parent._id)) {
                        skipped.push({ taskId: id, reason: 'already-a-subtask-of-this-parent' });
                        continue;
                    }
                    // Converting a task carries its whole subtree across, so a
                    // subtask under another selected task is handled by that pass.
                    // Doing it again would reparent it twice and count it twice.
                    if (task.isParentTask !== true && [String(task.ParentTaskId || ''), ...ancestorsOf(task)].some((above) => selectedIds.has(above))) {
                        skipped.push({ taskId: id, reason: 'carried-with-its-parent' });
                        continue;
                    }
                    candidates.push(task);
                }

                // Sequential, per bulkMove: the sprint counters and the parent's
                // subTasks counter are read-modify-write and would race.
                for (const task of candidates) {
                    const id = String(task._id);
                    try {
                        const oldProject = await buildOldProject(task.ProjectID);
                        if (!oldProject) {
                            skipped.push({ taskId: id, reason: 'project-not-found' });
                            continue;
                        }
                        await this.convertToSubTask({
                            companyId,
                            projectData: { id: destProject._id, ProjectName: destProject.ProjectName },
                            sprintId: parent.sprintId,
                            selectedTaskId: id,
                            taskId: parent._id,
                            oldProject,
                            isSubTask: Number(task.subTasks || 0) > 0,
                            userData,
                        });

                        // Verified rather than trusted — see the note above.
                        const after = await MongoDbCrudOpration(companyId, {
                            type: dbCollections.TASKS,
                            data: [{ _id: task._id }, 'ParentTaskId isParentTask deletedStatusKey'],
                        }, 'findOne').catch(() => null);

                        if (after && after.isParentTask === false
                            && String(after.ParentTaskId || '') === String(parent._id)
                            && after.deletedStatusKey !== 1) {
                            updated.push(id);
                        } else {
                            errors.push({ taskId: id, reason: 'conversion did not take effect' });
                        }
                    } catch (error) {
                        logger.error(`bulkConvertToSubTask task ${id}: ${error.message}`);
                        errors.push({ taskId: id, reason: error.message });
                    }
                }

                emitBulkSummary('bulkConvertToSubTask', { taskIds: updated, parentTaskId: String(parent._id) });
                resolve(summarize({ updated, skipped, errors }));
            } catch (error) {
                logger.error(`bulkConvertToSubTask error: ${error.message}`);
                reject(error);
            }
        });
    },

    // ---------------------- CONVERT TO TASK ----------------------
    // payload: { companyId, userData, taskIds, sprintObj, projectData }
    //   sprintObj / projectData — where the promoted tasks land, same shape and
    //   same picker as bulkMove.
    //
    // Promotes selected subtasks to top-level tasks. Reuses the single-task
    // convertToTask per subtask, so the parent's subTasks counter, the sprint
    // counters, the comment count, the per-task socket events and the
    // cross-project status/type remap all behave as they do today.
    //
    // Two things about that path this has to defend against, both harmless once
    // and dangerous twenty times:
    //
    //   1. It marks the task deletedStatusKey:1 FIRST and rewrites it as
    //      top-level second. A failure in between leaves the task deleted —
    //      gone from the board. Every task is verified afterwards, and one left
    //      deleted is put back the way it was rather than reported as lost.
    //
    //   2. Its inner failure path only logs: it neither resolves nor rejects, so
    //      the promise never settles and an await on it hangs forever. One bad
    //      task would otherwise hang the whole request. Each call is raced
    //      against a deadline and judged on the task's actual state instead.
    bulkConvertToTask({ companyId, userData, taskIds, sprintObj, projectData }) {
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
                const defaultStatus = destStatuses.find((s) => s.type !== 'close') || destStatuses[0] || null;
                const mapStatus = (srcStatus) => {
                    const pick = destStatuses.find((d) => norm(d.name) === norm(srcStatus?.name)) || defaultStatus;
                    return pick ? { key: pick.key, name: pick.name, type: pick.type, bgColor: pick.bgColor, textColor: pick.textColor } : null;
                };
                const mapType = (srcType) => {
                    const pick = destTypes.find((d) => norm(d.name) === norm(srcType?.name)) || destTypes[0] || null;
                    return pick ? { value: pick.value, key: pick.key, name: pick.name } : null;
                };

                // convertToTask decides "is this cross-project?" with a plain !==
                // on these two ids. An ObjectId is never !== equal to another
                // ObjectId instance, so a same-project conversion would take the
                // remapping branch. Both sides are handed over as strings, which
                // is what the single-task callers pass.
                const destProjectId = String(destProject._id);
                const oldProjectCache = new Map();
                const buildOldProject = async (srcProjectId) => {
                    const key = String(srcProjectId);
                    if (oldProjectCache.has(key)) return oldProjectCache.get(key);
                    const src = await loadProject(srcProjectId);
                    const built = src ? {
                        id: String(src._id),
                        ProjectName: src.ProjectName,
                        taskStatusData: (Array.isArray(src.taskStatusData) ? src.taskStatusData : [])
                            .map((s) => ({ ...s, convertStatus: mapStatus(s) })),
                        taskTypeCounts: (Array.isArray(src.taskTypeCounts) ? src.taskTypeCounts : [])
                            .map((t) => ({ ...t, convertType: mapType(t) })),
                    } : null;
                    oldProjectCache.set(key, built);
                    return built;
                };

                const candidates = [];
                for (const task of tasks) {
                    if (task.isParentTask === true) {
                        skipped.push({ taskId: String(task._id), reason: 'already-a-top-level-task' });
                        continue;
                    }
                    candidates.push(task);
                }

                // Sequential, per bulkMove: the sprint counters and each parent's
                // subTasks counter are read-modify-write and would race.
                for (const task of candidates) {
                    const id = String(task._id);
                    const wasDeletedStatusKey = task.deletedStatusKey;
                    try {
                        const oldProject = await buildOldProject(task.ProjectID);
                        if (!oldProject) {
                            skipped.push({ taskId: id, reason: 'project-not-found' });
                            continue;
                        }

                        let timer = null;
                        const deadline = new Promise((settle) => {
                            timer = setTimeout(() => settle('timeout'), CONVERT_DEADLINE_MS);
                        });
                        try {
                            await Promise.race([
                                this.convertToTask({
                                    companyId,
                                    projectData: { id: destProjectId, ProjectName: destProject.ProjectName },
                                    taskId: id,
                                    sprintObj,
                                    parentTaskId: task.ParentTaskId,
                                    oldSprintObj: {
                                        id: task.sprintId,
                                        folderId: task.folderObjId || null,
                                        name: task.sprintArray?.name || '',
                                        folderName: task.sprintArray?.folderName || '',
                                    },
                                    oldProject,
                                    userData,
                                }).catch((error) => {
                                    logger.error(`bulkConvertToTask convert ${id}: ${error && error.message}`);
                                }),
                                deadline,
                            ]);
                        } finally {
                            if (timer) clearTimeout(timer);
                        }

                        // Judged on the task itself, never on what the call said.
                        const after = await MongoDbCrudOpration(companyId, {
                            type: dbCollections.TASKS,
                            data: [{ _id: task._id }, 'isParentTask ParentTaskId deletedStatusKey sprintId'],
                        }, 'findOne').catch(() => null);

                        const landed = after && after.isParentTask === true
                            && !String(after.ParentTaskId || '')
                            && after.deletedStatusKey !== 1;

                        if (landed) {
                            updated.push(id);
                            continue;
                        }

                        // Left mid-flight. Put it back on the board rather than
                        // leaving it deleted and calling it a failure.
                        if (after && after.deletedStatusKey === 1 && wasDeletedStatusKey !== 1) {
                            await MongoDbCrudOpration(companyId, {
                                type: dbCollections.TASKS,
                                data: [{ _id: task._id }, { $set: { deletedStatusKey: wasDeletedStatusKey } }, { returnDocument: 'after' }],
                            }, 'findOneAndUpdate').then((restored) => {
                                socketEmitter.emit('update', {
                                    type: 'update', data: restored,
                                    updatedFields: { deletedStatusKey: wasDeletedStatusKey }, module: 'task', companyId,
                                });
                            }).catch((error) => {
                                logger.error(`bulkConvertToTask restore ${id}: ${error && error.message}`);
                            });
                            errors.push({ taskId: id, reason: 'conversion failed; the task was restored where it was' });
                            continue;
                        }
                        errors.push({ taskId: id, reason: 'conversion did not take effect' });
                    } catch (error) {
                        logger.error(`bulkConvertToTask task ${id}: ${error.message}`);
                        errors.push({ taskId: id, reason: error.message });
                    }
                }

                emitBulkSummary('bulkConvertToTask', { taskIds: updated, targetSprintId: sprintObj?.id, targetProjectId: projectData?.id });
                resolve(summarize({ updated, skipped, errors }));
            } catch (error) {
                logger.error(`bulkConvertToTask error: ${error.message}`);
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
