const mongoose = require('mongoose');
const { DateTime } = require('luxon');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const socketEmitter = require('../../event/socketEventEmitter');
const tools = require('../Automations/engine/tools');
const registry = require('./registry');
const audit = require('./agentAudit');
const { attribution, isAgent } = require('./actor');
const completionStore = require('../Tasks/helpers/completionStore');

// The single place an agent's action is executed. MCP tools, approved proposals
// and workspace-agent runs all call perform(): registry check → tool layer →
// provenance → audit row with an undo descriptor. A human calling the same REST
// routes never passes through here; the guard only watches them.

class RefusedError extends Error {
    constructor(message, auditId) { super(message); this.name = 'RefusedError'; this.status = 403; this.auditId = auditId || null; }
}

const oid = tools.oid;
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const LINK_KINDS = ['pr', 'branch', 'doc', 'url'];

const emitTask = (doc, updatedFields, actor) => {
    socketEmitter.emit('update', {
        type: 'update', module: 'task', data: doc, updatedFields,
        actor: { kind: 'agent', userId: actor.userId || null, agentId: actor.agentId || null },
        depth: 1,
    });
};

const workEntry = (actor, hours = 0) => {
    const a = attribution(actor);
    return { actorId: a.actorId, actorType: a.actorType, agentId: a.agentId, viaAccount: a.viaAccount || 'workspace', hours };
};

const context = (actor, action) => ({
    ruleId: null, ruleName: attribution(actor).label, runId: actor.runId || null, action: `agent.${action}`, depth: 0,
});

const findRunningTimer = (companyId, taskId, userId) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.TIMESHEET,
    data: [{ TicketID: String(taskId), Loggeduser: String(userId), startTimeTracker: { $exists: true, $ne: null } }, null, { sort: { LogStartTime: -1 } }],
}, 'findOne');

/* ── the executors ─────────────────────────────────────────────────────────── */

const executors = {
    async 'task.comment'({ companyId, actor, params }) {
        const r = await tools.addComment(companyId, params.taskId, params.body, context(actor, 'task.comment'));
        const a = attribution(actor);
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.COMMENTS,
            data: [{ _id: oid(r.commentId) }, { $set: { userId: String(actor.userId || a.actorId), actorType: a.actorType, agentId: a.agentId || null, viaAccount: a.viaAccount || null } }],
        }, 'updateOne').catch(() => {});
        return { result: { commentId: r.commentId }, undo: { kind: 'comment', commentId: r.commentId, taskId: String(params.taskId) }, entityId: params.taskId };
    },

    async 'task.status.set'({ companyId, actor, params }) {
        const task = await tools.getTask(companyId, params.taskId);
        const patch = await tools.resolveStatus(companyId, task.ProjectID, params.status.name || params.status.text);
        const check = registry.evaluate('task.status.set', { status: { statusType: patch.statusType, name: patch.status.text } });
        if (!check.allowed) throw new RefusedError(check.reason);
        const previous = { status: task.status, statusType: task.statusType, statusKey: task.statusKey };
        const completion = await completionStore.forStatusChange(companyId, task._id, {
            toStatus: { statusType: patch.statusType, name: patch.status.text }, actor: workEntry(actor),
        });
        const set = completion && !completion.error ? { ...patch, completion: completion.completion } : patch;
        const r = await tools.updateTask(companyId, task._id, set, context(actor, 'task.status.set'));
        return { result: { status: patch.status.text, statusType: patch.statusType }, undo: { kind: 'status', taskId: String(task._id), previous }, entityId: task._id, entityName: task.TaskName, task: r.task };
    },

    async 'task.link'({ companyId, actor, params }) {
        const task = await tools.getTask(companyId, params.taskId);
        const url = String(params.url || '').trim();
        if (!/^https?:\/\//i.test(url) || url.length > 2000) throw new tools.DeterministicError('a valid http(s) url is required');
        const a = attribution(actor);
        const link = {
            _id: new mongoose.Types.ObjectId(),
            url, kind: LINK_KINDS.includes(params.kind) ? params.kind : (/\/pull\/\d+|\/merge_requests\/\d+/.test(url) ? 'pr' : 'url'),
            label: String(params.label || '').slice(0, 200), addedBy: a.actorId, actorType: a.actorType, agentId: a.agentId || null, addedAt: new Date(),
        };
        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS, data: [{ _id: task._id }, { $push: { links: link } }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        emitTask(updated, { links: updated.links }, actor);
        return { result: { linkId: String(link._id), kind: link.kind }, undo: { kind: 'link', taskId: String(task._id), linkId: String(link._id) }, entityId: task._id, entityName: task.TaskName };
    },

    async 'task.assign'({ companyId, actor, params }) {
        const task = await tools.getTask(companyId, params.taskId);
        const ids = (Array.isArray(params.assigneeIds) ? params.assigneeIds : [params.assigneeId]).filter((v) => OBJECT_ID.test(String(v || ''))).map(String);
        if (!ids.length) throw new tools.DeterministicError('assigneeIds is required');
        const previous = (task.AssigneeUserId || []).map(String);
        const next = params.replace ? ids : [...new Set([...previous, ...ids])];
        const r = await tools.updateTask(companyId, task._id, { AssigneeUserId: next }, context(actor, 'task.assign'));
        return { result: { assignees: next }, undo: { kind: 'assign', taskId: String(task._id), previous }, entityId: task._id, entityName: task.TaskName, task: r.task };
    },

    async 'task.update'({ companyId, actor, params }) {
        const task = await tools.getTask(companyId, params.taskId);
        const fields = params.fields || {};
        const previous = {};
        Object.keys(fields).forEach((k) => { previous[k] = task[k] === undefined ? null : task[k]; });
        const r = await tools.updateTask(companyId, task._id, fields, context(actor, 'task.update'));
        return { result: { fields: Object.keys(fields) }, undo: { kind: 'update', taskId: String(task._id), previous }, entityId: task._id, entityName: task.TaskName, task: r.task };
    },

    async 'task.sprint.move'({ companyId, actor, params }) {
        const task = await tools.getTask(companyId, params.taskId);
        const target = oid(params.sprintId);
        if (!target) throw new tools.DeterministicError('a valid sprintId is required');
        const sprint = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.SPRINTS, data: [{ _id: target, projectId: task.ProjectID }] }, 'findOne');
        if (!sprint) throw new tools.DeterministicError('sprint not found in this project');
        const previous = { sprintId: task.sprintId, sprintArray: task.sprintArray };
        const r = await tools.updateTask(companyId, task._id, { sprintId: target, sprintArray: { _id: target, name: sprint.name } }, context(actor, 'task.sprint.move'));
        return { result: { sprintId: String(target), name: sprint.name }, undo: { kind: 'sprint', taskId: String(task._id), previous }, entityId: task._id, entityName: task.TaskName, task: r.task };
    },

    async 'subtask.create'({ companyId, actor, params }) {
        const r = await tools.createSubtask(companyId, params.taskId, { title: params.title, description: params.description || '' }, context(actor, 'subtask.create'));
        return { result: { subtaskId: r.subtaskId, title: r.title }, undo: { kind: 'subtask', subtaskId: r.subtaskId, parentTaskId: String(params.taskId) }, entityId: params.taskId };
    },

    async 'task.create'({ companyId, actor, params }) {
        const r = await tools.createTask(companyId, params.projectId, {
            title: params.title, description: params.description || '', sprintId: params.sprintId || '', priority: params.priority || 'MEDIUM',
            leaderId: actor.userId || '',
        }, context(actor, 'task.create'));
        return { result: { taskId: r.taskId, key: r.key, title: r.title }, undo: { kind: 'task', taskId: r.taskId, projectId: String(params.projectId) }, entityId: r.taskId, entityName: r.title };
    },

    async 'timelog.start'({ companyId, actor, params }) {
        const task = await tools.getTask(companyId, params.taskId);
        const userId = String(actor.userId || '');
        if (!OBJECT_ID.test(userId)) throw new tools.DeterministicError('timers need a person to log against');
        const running = await findRunningTimer(companyId, task._id, userId);
        if (running) return { result: { timesheetId: String(running._id), alreadyRunning: true }, undo: null, entityId: task._id, entityName: task.TaskName };
        const a = attribution(actor);
        const now = Math.floor(DateTime.utc().toSeconds());
        const saved = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TIMESHEET,
            data: {
                LogDescription: String(params.description || `${a.label} working on ${task.TaskKey || task.TaskName}`).slice(0, 500),
                Loggeduser: userId, TicketID: String(task._id), ProjectId: String(task.ProjectID),
                LogStartTime: now, LogEndTime: now, LogTimeDuration: 0, logAddType: 1, trackShots: [], startTimeTracker: now,
                billable: true, actorType: a.actorType, agentId: a.agentId || null, viaAccount: a.viaAccount || null, runId: actor.runId || null,
            },
        }, 'save');
        return { result: { timesheetId: String(saved._id), startedAt: now }, undo: { kind: 'timelog.start', timesheetId: String(saved._id), taskId: String(task._id) }, entityId: task._id, entityName: task.TaskName };
    },

    async 'timelog.stop'({ companyId, actor, params }) {
        const task = await tools.getTask(companyId, params.taskId);
        const running = params.timesheetId && OBJECT_ID.test(String(params.timesheetId))
            ? await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TIMESHEET, data: [{ _id: oid(params.timesheetId), TicketID: String(task._id) }] }, 'findOne')
            : await findRunningTimer(companyId, task._id, actor.userId);
        if (!running) throw new tools.DeterministicError('no running timer on this task');
        const now = Math.floor(DateTime.utc().toSeconds());
        const minutes = Math.max(0, Math.round((now - Number(running.LogStartTime || now)) / 60));
        const set = { LogEndTime: now, LogTimeDuration: minutes };
        if (params.description) set.LogDescription = String(params.description).slice(0, 500);
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TIMESHEET, data: [{ _id: running._id }, { $set: set, $unset: { startTimeTracker: 1 } }],
        }, 'updateOne');
        await completionStore.recordWork(companyId, task._id, workEntry(actor, 0));
        return { result: { timesheetId: String(running._id), minutes }, undo: { kind: 'timelog.stop', timesheetId: String(running._id), taskId: String(task._id), previousStart: running.LogStartTime }, entityId: task._id, entityName: task.TaskName };
    },

    async 'page.draft'({ companyId, actor, params }) {
        const a = attribution(actor);
        const title = String(params.title || '').trim().slice(0, 200);
        if (!title) throw new tools.DeterministicError('title is required');
        const linked = (params.taskId && oid(params.taskId)) ? [oid(params.taskId)] : [];
        const saved = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PAGES,
            data: { title, rawText: String(params.text || '').slice(0, 20000), content: params.content || { blocks: [] },
                    ProjectID: params.projectId && oid(params.projectId) ? oid(params.projectId) : undefined,
                    createdBy: String(actor.userId || a.actorId), linkedTasks: linked, visibility: 'project',
                    createdByAgent: true, agentName: a.label, agentStatus: 'draft', deletedStatusKey: 0 },
        }, 'save');
        return { result: { pageId: String(saved._id) }, undo: { kind: 'page', pageId: String(saved._id) }, entityType: 'page', entityId: saved._id, entityName: title };
    },

    async 'chat.post'({ companyId, actor, params }) {
        const r = await tools.addComment(companyId, params.taskId, params.body, context(actor, 'chat.post'));
        return { result: { commentId: r.commentId }, undo: { kind: 'comment', commentId: r.commentId, taskId: String(params.taskId) }, entityId: params.taskId };
    },
};

/* Run one action for an actor. Refusals are audited and thrown as RefusedError. */
const perform = async ({ companyId, actor, action, params = {}, reason = '', cost = null, ip = '', allowedActions }) => {
    const check = registry.evaluate(action, params, { allowedActions });
    if (!check.allowed) {
        const auditId = await audit.recordRefusal(companyId, actor, { action, reason: check.reason, params, entityId: params.taskId, ip });
        throw new RefusedError(check.reason, auditId);
    }
    if (!check.action.write) return { result: null, auditId: null, undo: null };
    const exec = executors[action];
    if (!exec) throw new tools.DeterministicError(`${action} has no executor`);

    const out = await exec({ companyId, actor, params });
    if (isAgent(actor) && params.taskId && action !== 'timelog.stop' && action !== 'task.status.set') {
        await completionStore.recordWork(companyId, params.taskId, workEntry(actor, 0));
    }
    const auditId = await audit.recordAction(companyId, actor, {
        action, reason, params, cost, undo: out.undo, ip,
        entityType: out.entityType || 'task', entityId: out.entityId, entityName: out.entityName,
    });
    return { result: out.result, auditId, undo: out.undo, task: out.task || null };
};

/* Reads still go through the registry so a refusal is logged the same way. */
const authorizeRead = async ({ companyId, actor, action, params = {}, ip = '', allowedActions }) => {
    const check = registry.evaluate(action, params, { allowedActions });
    if (check.allowed) return true;
    const auditId = await audit.recordRefusal(companyId, actor, { action, reason: check.reason, params, entityId: params.taskId, ip });
    throw new RefusedError(check.reason, auditId);
};

module.exports = { perform, authorizeRead, RefusedError, executors, workEntry };
