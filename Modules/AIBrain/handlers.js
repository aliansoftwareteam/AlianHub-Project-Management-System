// AHE-3792 — real action handlers for the AI Brain's "hands".
//
// Each handler is company-scoped and reuses AlianHub's OWN write paths so the
// agent's actions behave exactly like a human's: same collections, same
// Socket.io events, same history/notifications. The action registry
// (actionRegistry.js) points its wired actions at these functions; the
// dispatcher calls them through runAction() and audits the outcome.
//
// Handler contract:  async (companyId, params, ctx) => resultObject
//   ctx carries { actionKey, projectId, taskId, reason, actorUserId, ... }.
//   Throw on failure — the dispatcher records it as a failed action.
//
// The actor is whoever ran the skill / approved the inbox item (ctx.actorUserId),
// but every change is attributed to "AI Brain" in history and every comment is
// prefixed 🤖 so it's always obvious the agent did it, not a person.

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const socketEmitter = require('../../event/socketEventEmitter');
const { taskMongo } = require('../Tasks/helpers/task_class_Mongo');

const isOid = (v) => v && mongoose.Types.ObjectId.isValid(String(v));
const oid = (v) => new mongoose.Types.ObjectId(String(v));

// Every agent-authored comment / history entry carries this marker.
const AI_TAG = '🤖 AI Brain';

// --- shared lookups (company db) -----------------------------------------

async function getTask(companyId, taskId) {
    if (!isOid(taskId)) throw new Error('a valid taskId is required');
    const task = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [{ _id: oid(taskId) }],
    }, 'findOne');
    if (!task) throw new Error(`task ${taskId} not found`);
    return task;
}

async function getProject(companyId, projectId) {
    if (!isOid(projectId)) throw new Error('a valid projectId is required');
    const project = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS,
        data: [{ _id: oid(projectId) }],
    }, 'findOne');
    if (!project) throw new Error(`project ${projectId} not found`);
    return project;
}

// Synthetic actor identity for the task helpers — attributes the change to the
// agent in history/notifications while keeping the triggering user's id.
const aiUser = (actorUserId) => ({
    id: String(actorUserId || ''),
    _id: String(actorUserId || ''),
    Employee_Name: AI_TAG,
});

// --- comments (post_task_comment / nudge_stale_task) ----------------------
// A task comment is a plain document in the `comments` collection scoped by
// projectId + taskId + sprintId (that's how the task chat fetches it), with
// project:false (project:true marks main-chat). Plus the same `insert` socket
// event the human comment path emits, so open chats update live. No cache.

async function writeTaskComment(companyId, task, userId, message) {
    const doc = {
        projectId: task.ProjectID,
        taskId: task._id,
        sprintId: task.sprintId,
        userId: String(userId || ''),
        project: false,
        type: 'text',
        message: String(message || ''),
        isDeleted: false,
        // Media/reply fields default to empty so the doc matches a human text
        // comment exactly — the comment renderer reads e.g. mediaURL.includes(...)
        // and would crash on an undefined field.
        hasReply: false,
        mediaURL: '',
        mediaName: '',
        mediaOriginalName: '',
        mediaSize: 0,
        mentionIds: [],
        reply_id: '',
        reply_userId: '',
        reply_message: '',
        reply_type: '',
        reply_mediaURL: '',
        reply_mediaName: '',
        reply_mediaSize: 0,
    };
    const saved = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMMENTS, data: doc }, 'save');
    if (task.ProjectID && task._id && task.sprintId) {
        socketEmitter.emit('insert', { type: 'insert', data: saved, updatedFields: {}, module: 'comments' });
    }
    return saved;
}

async function postTaskComment(companyId, params, ctx) {
    const task = await getTask(companyId, (ctx && ctx.taskId) || (params && params.taskId));
    const text = String((params && params.text) || '').trim();
    if (!text) throw new Error('post_task_comment requires params.text');
    const saved = await writeTaskComment(companyId, task, ctx && ctx.actorUserId, `${AI_TAG}: ${text}`);
    return { commented: true, commentId: String((saved && saved._id) || ''), taskId: String(task._id) };
}

async function nudgeStaleTask(companyId, params, ctx) {
    const task = await getTask(companyId, (ctx && ctx.taskId) || (params && params.taskId));
    const text = String((params && params.text) || '').trim()
        || `This task hasn't moved in a while — could we get a quick status update on "${task.TaskName}"?`;
    const saved = await writeTaskComment(companyId, task, ctx && ctx.actorUserId, `${AI_TAG}: ${text}`);
    return { nudged: true, commentId: String((saved && saved._id) || ''), taskId: String(task._id) };
}

// --- assign_task (reuse taskMongo.updateAssignee) -------------------------
// Requires an explicit target user (params.assigneeUserId) — the agent never
// guesses an owner. Adds (does not replace) via 'assigneeAdd'; the helper emits
// the socket update, updates watchers, and records history/notifications.

async function assignTask(companyId, params, ctx) {
    const assigneeUserId = String((params && params.assigneeUserId) || '').trim();
    if (!assigneeUserId) throw new Error('assign_task requires params.assigneeUserId');
    const task = await getTask(companyId, (ctx && ctx.taskId) || (params && params.taskId));
    const project = await getProject(companyId, (ctx && ctx.projectId) || task.ProjectID);
    const result = await taskMongo.updateAssignee({
        firebaseObj: { AssigneeUserId: assigneeUserId },
        projectData: { CompanyId: project.CompanyId, _id: project._id, ProjectName: project.ProjectName },
        taskData: { _id: task._id, TaskName: task.TaskName, sprintId: task.sprintId, folderObjId: task.folderObjId },
        employeeName: String((params && params.assigneeName) || 'a teammate'),
        type: 'assigneeAdd',
        userData: aiUser(ctx && ctx.actorUserId),
        isUpdateTask: true,
    });
    return { assigned: true, taskId: String(task._id), assigneeUserId, result };
}

// --- set_task_status (reuse taskMongo.updateStatus) -----------------------
// Resolves the target status from the project's OWN status template
// (taskStatusData) by statusKey (preferred) or statusType, so the task's status
// object matches what the board expects. updateStatus writes status/statusType/
// statusKey, clears the board index, emits the socket update, and records
// history/notifications.

async function setTaskStatus(companyId, params, ctx) {
    const task = await getTask(companyId, (ctx && ctx.taskId) || (params && params.taskId));
    const project = await getProject(companyId, (ctx && ctx.projectId) || task.ProjectID);
    const list = Array.isArray(project.taskStatusData) ? project.taskStatusData : [];

    let target = null;
    if (params && params.statusKey !== undefined && params.statusKey !== null && String(params.statusKey) !== '') {
        target = list.find((s) => Number(s.key) === Number(params.statusKey));
    }
    if (!target && params && params.statusType) {
        target = list.find((s) => String(s.type) === String(params.statusType));
    }
    if (!target) {
        throw new Error('set_task_status needs a params.statusKey (or statusType) that exists in this project');
    }

    const newStatus = {
        status: { text: target.text || target.name || '', key: target.key, value: target.value, type: target.type },
        statusType: target.type,
        statusKey: target.key,
    };
    const result = await taskMongo.updateStatus({
        newStatus,
        prevStatus: {
            taskId: String(task._id),
            taskName: task.TaskName,
            name: task.statusType,                     // old status (gates the notification)
            updatedTaskName: newStatus.status.text,     // new status text (history message)
            statusName: (task.status && (task.status.text || task.status.name)) || task.statusType || '',
        },
        projectData: { CompanyId: project.CompanyId, _id: project._id, ProjectName: project.ProjectName },
        task: { sprintId: task.sprintId, folderObjId: task.folderObjId },
        userData: aiUser(ctx && ctx.actorUserId),
        isUpdateTask: true,
    });
    return { statusChanged: true, taskId: String(task._id), statusType: newStatus.statusType, statusKey: newStatus.statusKey, result };
}

module.exports = { postTaskComment, nudgeStaleTask, assignTask, setTaskStatus };
