const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { recordAudit } = require('../../Audit/recorder');
const socketEmitter = require('../../../event/socketEventEmitter');

// The only way an action is allowed to touch data.
//
// Every function here takes companyId FIRST, exactly like MongoDbCrudOpration.
// That is not a style preference: CLAUDE.md requires all data to be scoped to
// companyId, and a rule you have to remember is a rule that gets broken. An
// action physically cannot reach another tenant because it is never handed a
// database handle — only these functions.
//
// Writes here re-emit on socketEmitter with actor.kind:'automation' and depth+1,
// which is what lets the event bus recognise automation-authored changes and
// refuse to let rule A wake rule B wake rule A forever.

const oid = (id) => {
    try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; }
};

/* Thrown for failures that retrying cannot fix — a missing task, a status that
 * does not exist in this project. The runner uses the distinction: transient
 * errors back off and retry, deterministic ones fail the run immediately,
 * because a retry storm against a permanent error costs real money. */
class DeterministicError extends Error {
    constructor(message) { super(message); this.name = 'DeterministicError'; this.deterministic = true; }
}

const getTask = async (companyId, taskId) => {
    const _id = oid(taskId);
    if (!_id) throw new DeterministicError(`invalid task id "${taskId}"`);
    const task = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id }] }, 'findOne');
    if (!task || !task._id) throw new DeterministicError(`task ${taskId} not found`);
    if (String(task.CompanyId) !== String(companyId)) {
        // Defence in depth: the query is already scoped, so reaching here means
        // something upstream is wrong. Fail loudly rather than mutate.
        throw new DeterministicError('task does not belong to this company');
    }
    return task;
};

const emitAutomationUpdate = (doc, updatedFields, depth) => {
    socketEmitter.emit('update', {
        type: 'update',
        module: 'task',
        data: doc,
        updatedFields,
        actor: { kind: 'automation', userId: null },
        depth: (Number(depth) || 0) + 1,
    });
};

/* Apply a $set to a task and announce it. `context` carries the run and the
 * originating event's depth so the audit row can point back at the rule and the
 * loop guard keeps counting. */
const updateTask = async (companyId, taskId, set, context = {}) => {
    const _id = oid(taskId);
    if (!_id) throw new DeterministicError(`invalid task id "${taskId}"`);
    if (!set || !Object.keys(set).length) return { changed: false };

    const updated = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [{ _id }, { $set: set }, { returnDocument: 'after' }],
    }, 'findOneAndUpdate');

    if (!updated || !updated._id) throw new DeterministicError(`task ${taskId} not found`);

    emitAutomationUpdate(updated, set, context.depth);
    recordAudit(companyId, {
        actorId: context.ruleId ? `rule:${context.ruleId}` : 'automation',
        actorName: context.ruleName || 'Automation',
        action: context.action || 'automation.task.update',
        entityType: 'task',
        entityId: String(taskId),
        entityName: updated.TaskName || '',
        meta: { runId: context.runId || null, ruleId: context.ruleId || null, fields: Object.keys(set) },
    });

    return { changed: true, task: updated };
};

const addComment = async (companyId, taskId, body, context = {}) => {
    const task = await getTask(companyId, taskId);
    const text = String(body || '').trim();
    if (!text) throw new DeterministicError('comment body is empty');

    const projectId = oid(task.ProjectID);
    if (!projectId) throw new DeterministicError(`task ${taskId} has no usable project id`);

    // Field names follow the comments schema exactly: `message` (not Comment),
    // `taskId` / `projectId` lowercase, and `project:false` marking this as a task
    // comment rather than a project-level one.
    //
    // taskId MUST be an ObjectId, not a string. The schema types it as Mixed so a
    // string writes without complaint, but every read path casts
    // (`{ taskId: new mongoose.Types.ObjectId(taskId) }` in Comments/controller.js),
    // and in Mongo a string never equals an ObjectId — so a string-keyed comment is
    // stored successfully and is then invisible in the task's Comments tab forever.
    const saved = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMMENTS,
        data: {
            project: false,
            projectId,
            taskId: oid(taskId),
            sprintId: task.sprintId || undefined,
            userId: context.userId || (context.ruleId ? `automation:${context.ruleId}` : 'automation'),
            type: 'text',
            message: text,
            isDeleted: false,
            // Attribution written with the row: the post-insert update the agent path
            // used to rely on never applied, so agent comments read as "automation".
            ...(context.actorType ? { actorType: context.actorType, agentId: context.agentId || null, viaAccount: context.viaAccount || null, runId: context.runId || null } : {}),
        },
    }, 'save');

    recordAudit(companyId, {
        actorId: context.ruleId ? `rule:${context.ruleId}` : 'automation',
        actorName: context.ruleName || 'Automation',
        action: 'automation.task.comment',
        entityType: 'task',
        entityId: String(taskId),
        entityName: task.TaskName || '',
        meta: { runId: context.runId || null, ruleId: context.ruleId || null },
    });

    return { changed: true, commentId: saved && saved._id ? String(saved._id) : null };
};

/* Rules name a status by label; the project owns the list.
 *
 * A task denormalises its status three ways — the `status` subdoc, `statusType`
 * and `statusKey` — and every existing write path sets all three together (see
 * Modules/Tasks/helpers/taskMongo/structural.js). An action that set only
 * statusType would leave a task the board renders in one column and the filters
 * find in another, so this returns the whole patch and set_status applies it
 * atomically.
 *
 * An unknown label fails deterministically: writing a status the project does
 * not define is worse than not moving the task. */
const resolveStatus = async (companyId, projectId, statusName) => {
    const wanted = String(statusName || '').trim().toLowerCase();
    if (!wanted) throw new DeterministicError('status is required');

    const pid = oid(projectId);
    if (!pid) throw new DeterministicError(`invalid project id "${projectId}"`);

    // Transient read errors propagate as-is so the runner retries them; only a
    // genuine "no such status" is deterministic.
    const project = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS,
        data: [{ _id: pid }],
    }, 'findOne');

    if (!project || !project._id) throw new DeterministicError(`project ${projectId} not found`);

    // Real projects store each status FLAT: { key, name, type, bgColor, textColor }.
    // Some code paths (project creation from a template, structural.js) pass the
    // same values nested under `convertStatus`, so accept either rather than
    // failing on whichever shape happens to be on disk.
    const statuses = Array.isArray(project.taskStatusData) ? project.taskStatusData : [];
    const hit = statuses
        .map((row) => (row && row.convertStatus ? row.convertStatus : row))
        .find((cs) => cs && String(cs.name || '').trim().toLowerCase() === wanted);

    if (!hit) {
        const available = statuses.map((r) => (r && (r.convertStatus ? r.convertStatus.name : r.name))).filter(Boolean);
        throw new DeterministicError(`status "${statusName}" does not exist in this project (has: ${available.join(', ') || 'none'})`);
    }

    return {
        status: { key: hit.key, value: '', text: hit.name, type: hit.type },
        statusType: hit.type,
        statusKey: hit.key,
    };
};

/* Create a subtask under a task.
 *
 * A subtask is a normal task row with isParentTask:false and ParentTaskId set,
 * inheriting the parent's project, sprint, type and status so it lands on the
 * board in the right column. The parent's `subTasks` counter is incremented in
 * the same call — the list view reads that number, so skipping it shows "0
 * subtasks" above a list of subtasks. */
const createSubtask = async (companyId, parentTaskId, { title, description = '' }, context = {}) => {
    const parent = await getTask(companyId, parentTaskId);
    const name = String(title || '').trim();
    if (!name) throw new DeterministicError('subtask title is empty');

    // A new subtask starts in the project's OPENING status, never the parent's.
    // Inheriting the parent's status means a QA agent that files findings on a
    // task just marked Done creates seven subtasks that are already "Complete" —
    // the board shows 100% done above a list of untouched defects.
    const project = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS, data: [{ _id: oid(parent.ProjectID) }],
    }, 'findOne').catch(() => null);
    const statuses = (project && Array.isArray(project.taskStatusData) ? project.taskStatusData : [])
        .map((row) => (row && row.convertStatus ? row.convertStatus : row))
        .filter(Boolean);
    const opening = statuses.find((s) => s.type === 'default_active') || statuses[0] || null;
    const startStatus = opening
        ? { status: { key: opening.key, value: '', text: opening.name, type: opening.type }, statusType: opening.type, statusKey: opening.key }
        : { status: parent.status, statusType: parent.statusType, statusKey: parent.statusKey };

    const _id = new mongoose.Types.ObjectId();
    const saved = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: {
            _id,
            TaskName: name.slice(0, 200),
            TaskKey: `${parent.TaskKey || 'TASK'}-${Date.now().toString(36).slice(-4)}`,
            description: String(description || '').slice(0, 4000),
            rawDescription: String(description || '').slice(0, 4000),
            CompanyId: String(companyId),
            ProjectID: parent.ProjectID,
            sprintId: parent.sprintId,
            sprintArray: parent.sprintArray || {},
            ParentTaskId: String(parentTaskId),
            isParentTask: false,
            TaskType: parent.TaskType || 'task',
            TaskTypeKey: parent.TaskTypeKey || 1,
            ...startStatus,
            Task_Priority: 'MEDIUM',
            Task_Leader: parent.Task_Leader || '',
            AssigneeUserId: [],
            deletedStatusKey: 0,
        },
    }, 'save');

    await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [{ _id: oid(parentTaskId) }, { $inc: { subTasks: 1 } }, { returnDocument: 'after' }],
    }, 'findOneAndUpdate').catch(() => {});

    emitAutomationUpdate(saved, { ParentTaskId: String(parentTaskId) }, context.depth);
    recordAudit(companyId, {
        actorId: context.ruleId ? `rule:${context.ruleId}` : 'automation',
        actorName: context.ruleName || 'Automation',
        action: 'automation.task.create_subtask',
        entityType: 'task',
        entityId: String(saved._id),
        entityName: name,
        meta: { runId: context.runId || null, parentTaskId: String(parentTaskId) },
    });

    return { changed: true, subtaskId: String(saved._id), title: name };
};

const PRIORITIES = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];

/* A top-level task made the way the UI makes one — the project's own key counter,
 * opening status and status-group index — so it shows on the List at once and
 * reads as AR-27, not a made-up suffix. Always the opening status and never
 * assigned: an agent files work it found, it does not decide who does it. */
const createTask = async (companyId, projectId, { title, description = '', sprintId = '', priority = 'MEDIUM', leaderId = '' } = {}, context = {}) => {
    const name = String(title || '').trim();
    if (!name) throw new DeterministicError('task title is empty');
    const _pid = oid(projectId);
    if (!_pid) throw new DeterministicError(`invalid project id "${projectId}"`);
    const project = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS, data: [{ _id: _pid, deletedStatusKey: { $ne: 1 } }],
    }, 'findOne');
    if (!project || !project._id || String(project.CompanyId) !== String(companyId)) {
        throw new DeterministicError(`project ${projectId} not found`);
    }

    const statuses = (Array.isArray(project.taskStatusData) ? project.taskStatusData : [])
        .map((row) => (row && row.convertStatus ? row.convertStatus : row))
        .filter(Boolean);
    const opening = statuses.find((s) => s.type === 'default_active') || statuses[0];
    if (!opening) throw new DeterministicError('project has no statuses');
    const taskType = (Array.isArray(project.taskTypeCounts) && project.taskTypeCounts[0]) || { name: 'task', key: 1 };

    // The schema requires a leader. For an agent that is the person whose token
    // it acts under; failing that, whoever owns the project.
    const leader = String(leaderId || project.userId || project.createdBy || project.ProjectLeader || '').trim();
    if (!leader) throw new DeterministicError('no one to record as task leader');

    let sprint = {};
    if (sprintId) {
        const _sid = oid(sprintId);
        const s = _sid ? await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.SPRINTS, data: [{ _id: _sid }] }, 'findOne').catch(() => null) : null;
        const owner = s && (s.projectId || s.ProjectID || s.ProjectId);
        if (!s || (owner && String(owner) !== String(project._id))) throw new DeterministicError(`sprint ${sprintId} is not in this project`);
        sprint = { sprintId: String(s._id), sprintArray: { id: String(s._id), name: s.sprintName || s.name || '' } };
    } else {
        // The schema requires a list; without a choice the task goes into the project's oldest live one.
        const lists = await Promise.resolve(MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.SPRINTS,
            data: [{ $or: [{ projectId: project._id }, { projectId: String(project._id) }, { ProjectID: project._id }], deletedStatusKey: { $in: [0, null] } }, {}, { sort: { createdAt: 1 }, limit: 1 }],
        }, 'find')).catch(() => null);
        const s = Array.isArray(lists) ? lists[0] : null;
        if (s) sprint = { sprintId: String(s._id), sprintArray: { id: String(s._id), name: s.sprintName || s.name || '' } };
    }


    const wanted = String(priority || '').toUpperCase();
    const _id = new mongoose.Types.ObjectId();
    const saved = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: {
            _id,
            TaskName: name.slice(0, 250),
            TaskKey: '--',
            description: String(description || '').slice(0, 4000),
            rawDescription: String(description || '').slice(0, 4000),
            CompanyId: String(companyId),
            ProjectID: String(project._id),
            ParentTaskId: '',
            isParentTask: true,
            TaskType: taskType.name,
            TaskTypeKey: taskType.key,
            status: { key: opening.key, value: opening.value || '', text: opening.name, type: opening.type },
            statusType: opening.type,
            statusKey: opening.key,
            Task_Priority: PRIORITIES.includes(wanted) ? wanted : 'MEDIUM',
            Task_Leader: leader,
            AssigneeUserId: [],
            watchers: [leader],
            deletedStatusKey: 0,
            ...sprint,
        },
    }, 'save');

    // Required lazily: the Tasks helpers pull in LogTime, which must not load
    // just because the automation engine did.
    const internals = require('../../Tasks/helpers/taskMongo/internals.js');
    await internals.updateTaskKey({
        companyId, projectCode: project.ProjectCode || 'TASK', projectId: project._id, taskId: saved._id,
        taskTypeKey: taskType.key, sprintId: sprint.sprintId || '', isParentTask: true,
        indexObj: { indexName: 'groupByStatusIndex', searchKey: 'statusKey', searchValue: opening.key },
    });
    const task = await getTask(companyId, saved._id);

    emitAutomationUpdate(task, { created: true }, context.depth);
    recordAudit(companyId, {
        actorId: context.ruleId ? `rule:${context.ruleId}` : 'automation',
        actorName: context.ruleName || 'Automation',
        action: 'automation.task.create',
        entityType: 'task',
        entityId: String(task._id),
        entityName: name,
        meta: { runId: context.runId || null, projectId: String(project._id) },
    });

    return { changed: true, taskId: String(task._id), key: task.TaskKey || '', title: name };
};

module.exports = { DeterministicError, getTask, updateTask, addComment, createSubtask, createTask, resolveStatus, oid };
