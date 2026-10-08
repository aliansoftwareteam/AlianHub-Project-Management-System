const mongoose = require('mongoose');
const { DateTime } = require('luxon');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const socketEmitter = require('../../event/socketEventEmitter');
const tools = require('../Automations/engine/tools');
const registry = require('./registry');
const groups = require('./registryGroups');
const { SCOPE, read, write } = require('./registryKit');
const permissions = require('./permissions');
const projectPolicy = require('./projectPolicy');
const taskReads = require('./taskReads');
const audit = require('./agentAudit');
const changeNotice = require('./changeNotice');
const { attribution, isAgent } = require('./actor');
const { shownAs } = require('./actingAgent');
const stepCredential = require('../Workflows/stepCredential');
const completionStore = require('../Tasks/helpers/completionStore');
const { sprintPlacementOf, followSprintMove, moveDescendants } = require('../Tasks/helpers/sprintPlacement');
const { pullOfLists } = require('../Tasks/helpers/taskExtraLists');
const { emitPageChange } = require('../Pages/helpers/pageEvents');
const { markdownToEditorData, blocksToHtml } = require('../Pages/helpers/pageContent');
const { cleanPageContent } = require('../Tasks/helpers/cleanRichText');
const { escapeCommentText } = require('../Comments/helpers/plainText');
const { isPeriodLocked } = require('../TimesheetApproval/helpers/lockGuard');
const { canPostToThread } = require('../Comments/helpers/threadWriteAccess');
const commentReplies = require('./commentReplies');
const { nonMembersOf, NOT_A_MEMBER } = require('../../Config/companyMembers');
const { cannotOpen, CANNOT_OPEN_PROJECT } = require('../../Config/projectPeople');
const { canCreatePageIn } = require('../Pages/helpers/pageAccess');
const { readableTaskIds, openProject, listOf } = require('../Tasks/helpers/taskWritePlacement');
const logger = require('../../Config/loggerConfig');

// The single place an agent's action is executed. MCP tools, approved proposals
// and workspace-agent runs all call perform(): registry check → pending audit
// row → tool layer → provenance → row marked applied with its undo descriptor.
// A human calling the same REST routes never passes through here; the guard
// only watches them.

class RefusedError extends Error {
    constructor(message, auditId) { super(message); this.name = 'RefusedError'; this.status = 403; this.auditId = auditId || null; }
}

const oid = tools.oid;
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const { LINK_KINDS } = require('./taskRequests');

// Risk rating per registry action, read by policy.js: at L2 an agent acts alone
// only on a reversible, task-scoped write with no money in it; everything else
// is proposed. `reversible` follows the registry's undoable flag so the rating
// and the Inbox's "reversible" badge never disagree.
const RATING_KEYS = Object.freeze(['write', 'reversible', 'scope', 'money']);
const RATINGS = Object.freeze({
    'tasks.next': read(SCOPE.WORKSPACE),
    'tasks.search': read(SCOPE.WORKSPACE),
    'task.get': read(SCOPE.TASK),
    'docs.read': read(SCOPE.PROJECT),
    'task.comment': write(SCOPE.TASK),
    'task.status.set': write(SCOPE.TASK),
    'task.link': write(SCOPE.TASK),
    'task.assign': write(SCOPE.TASK),
    'task.update': write(SCOPE.TASK),
    'aifield.fill': write(SCOPE.TASK),
    'subtask.create': write(SCOPE.TASK),
    'timelog.start': write(SCOPE.TASK),
    'timelog.stop': write(SCOPE.TASK),
    'task.sprint.move': write(SCOPE.PROJECT),
    'task.create': write(SCOPE.PROJECT),
    'page.draft': write(SCOPE.PROJECT),
    'chat.post': write(SCOPE.TASK, false),
    'reminder.create': write(SCOPE.TASK, false),
    'deploy.staging': write(SCOPE.WORKSPACE, false),
});

// Rated only while the registry holds them, so a flag that is off leaves no rating behind.
const FLAGGED_RATINGS = Object.freeze(Object.assign({}, ...groups.map((g) => g.ratings)));

const ratingTable = () => ({ ...RATINGS, ...Object.fromEntries(Object.entries(FLAGGED_RATINGS).filter(([k]) => registry.has(k))) });

const isCompleteRating = (r) => Boolean(r) && typeof r.write === 'boolean' && typeof r.reversible === 'boolean'
    && Object.values(SCOPE).includes(r.scope) && typeof r.money === 'boolean';
const rating = (key) => { const r = ratingTable()[String(key || '')]; return isCompleteRating(r) ? { ...r } : null; };
const ratings = () => Object.fromEntries(Object.entries(ratingTable()).map(([k, v]) => [k, { ...v }]));
const unrated = (keys = registry.keys()) => { const table = ratingTable(); return keys.filter((k) => !isCompleteRating(table[k])); };

/* The registry manifest with each action's rating — what GET /agents/registry serves. */
const manifest = () => {
    const m = registry.manifest();
    return { ...m, actions: m.actions.map((a) => ({ ...a, rating: rating(a.key) })), ratingKeys: [...RATING_KEYS], scopes: Object.values(SCOPE) };
};

const clampDepth = (depth) => Math.max(0, Number(depth) || 0);

const emitTask = (companyId, doc, updatedFields, actor, depth) => {
    socketEmitter.emit('update', {
        type: 'update', module: 'task', companyId, data: doc, updatedFields,
        actor: { kind: 'agent', userId: actor.userId || null, agentId: actor.agentId || null },
        depth: clampDepth(depth) + 1,
    });
};

/* What people read on a task, a time entry or a doc: "Claude, for Priya". The audit log keeps `label`. */
const nameShown = (actor, a) => (a.actorType === 'agent' ? shownAs(actor) : a.label);

const workEntry = (actor, hours = 0) => {
    const a = attribution(actor);
    return { actorId: a.actorId, actorType: a.actorType, agentId: a.agentId, viaAccount: a.viaAccount || 'workspace', hours };
};

// perform() writes the agent.action row (undo descriptor, attribution), so the
// tool layer must not add its automation.task.* row for the same change. `depth`
// is the originating event's; the tool layer emits at depth + 1 so the bus's
// loop guard keeps counting through an agent hop.
const context = (actor, action, depth) => {
    const a = attribution(actor);
    return {
        ruleId: null, ruleName: a.label, runId: actor.runId || null, action: `agent.${action}`, depth: clampDepth(depth),
        userId: String(actor.userId || a.actorId || ''), actingUserId: String(actor.userId || ''), actorType: a.actorType, agentId: a.agentId || null, viaAccount: a.viaAccount || null,
        agentName: a.actorType === 'agent' ? shownAs(actor) : null,
        auditedByCaller: true,
    };
};

const findRunningTimer = (companyId, taskId, userId) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.TIMESHEET,
    data: [{ TicketID: String(taskId), Loggeduser: String(userId), startTimeTracker: { $exists: true, $ne: null } }, null, { sort: { LogStartTime: -1 } }],
}, 'findOne');

/* ── the executors ─────────────────────────────────────────────────────────── */

/* The people a comment names are told the way the comment route tells them.
 * A delivery that fails is logged: the comment is already written. */
const announceMentions = async (companyId, commentId) => {
    try {
        const { resolveMentionIds, deliverMentions } = require('../Comments/helpers/commentNotifications');
        const { threadOf } = require('../Comments/helpers/threadWriteAccess');
        const comment = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMMENTS, data: [{ _id: oid(commentId) }] }, 'findOne');
        if (!comment) return [];
        const mentionIds = await resolveMentionIds(companyId, comment.userId, threadOf(comment), comment.message);
        if (!mentionIds.length) return [];
        await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMMENTS, data: [{ _id: oid(commentId) }, { $set: { mentionIds } }] }, 'updateOne');
        (await deliverMentions(companyId, comment, mentionIds)).forEach((error) => logger.error(`agent comment mention not delivered: ${(error && error.message) || error}`));
        return mentionIds;
    } catch (error) {
        logger.error(`agent comment mentions: ${error.message}`);
        return [];
    }
};

/* An agent that comments on its own answers to the project for the agents its comment names; one whose comment a
 * person approved starts them as that person's comment would. */
const startsNamedAgents = (companyId, actor, { taskId, body, depth, approvedBy }) => require('./triggers').fromComment(companyId, {
    authorId: actor.userId, taskId, message: body, depth: clampDepth(depth) + 1,
    ...(isAgent(actor) && !approvedBy ? { postedBy: actor, asked: true } : {}),
});

const NOT_TOLD = Object.freeze({
    self: 'is you, the person this comment is written for, so you were not notified',
    noAccess: 'cannot open this task, so was not notified',
});

/* A person the comment names who is not told is listed with the reason, the commenter's own name included. */
const mentionAnswer = (marked, notifiedIds, authorId) => {
    const notified = new Set(notifiedIds.map(String));
    const nameOf = new Map(marked.people.map((p) => [p.userId, p.name]));
    const row = (userId) => ({ userId, name: nameOf.get(userId) || '' });
    const notNotified = marked.named.map((p) => p.userId)
        .filter((userId) => !notified.has(userId))
        .map((userId) => ({ ...row(userId), reason: userId === String(authorId || '') ? NOT_TOLD.self : NOT_TOLD.noAccess }));
    return { mentioned: [...notified].map(row), notNotified, notFound: marked.notFound };
};

const commentOn = async ({ companyId, actor, params, depth, approvedBy }, action, written) => {
    const marked = params.notifyMentions ? await require('../Comments/helpers/namedMentions').markMentions(companyId, written) : null;
    const body = marked ? marked.message : written;
    const reply = params.replyTo ? await commentReplies.repliedTo(companyId, params.taskId, params.replyTo) : null;
    const r = await tools.addComment(companyId, params.taskId, body, context(actor, action, depth), { replyTo: reply ? String(reply.comment._id) : '' });
    const a = attribution(actor);
    await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMMENTS,
        data: [{ _id: oid(r.commentId) }, { $set: { userId: String(actor.userId || a.actorId), actorType: a.actorType, agentId: a.agentId || null, viaAccount: a.viaAccount || null } }],
    }, 'updateOne').catch(() => {});
    if (!actor.runId) await startsNamedAgents(companyId, actor, { taskId: params.taskId, body, depth, approvedBy });
    const mentioned = params.notifyMentions ? await announceMentions(companyId, r.commentId) : null;
    if (reply) await commentReplies.announceReply(companyId, r.commentId, reply.comment, mentioned);
    return {
        result: { commentId: r.commentId, ...(reply ? { threadOf: reply.rootId } : {}), ...(mentioned ? mentionAnswer(marked, mentioned, actor.userId) : {}) },
        undo: { kind: 'comment', commentId: r.commentId, taskId: String(params.taskId) }, entityId: params.taskId,
    };
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_LOG_MINUTES = 24 * 60;

/* The entry the manual log form writes (Modules/LogTime manualLogtime), for the person behind the agent only. */
const timelogEntry = (params) => {
    const minutes = Number(params.minutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_LOG_MINUTES) throw new tools.DeterministicError(`The time must be a whole number of minutes from 1 to ${MAX_LOG_MINUTES}.`);
    const day = params.date ? String(params.date) : DateTime.utc().toISODate();
    const clock = params.startTime ? String(params.startTime) : '09:00';
    if (!DAY.test(day) || !CLOCK.test(clock)) throw new tools.DeterministicError('The date must be written YYYY-MM-DD and the start time HH:MM (UTC).');
    const start = DateTime.fromISO(`${day}T${clock}`, { zone: 'utc' });
    if (!start.isValid || start.toISODate() !== day) throw new tools.DeterministicError(`${day} is not a real date.`);
    if (start.startOf('day') > DateTime.utc().plus({ days: 1 }).startOf('day')) throw new tools.DeterministicError('Time cannot be logged on a day that has not come yet.');
    return { start: Math.floor(start.toSeconds()), minutes };
};

/* The editor opens a page from `content`, so a draft saved as text alone would open empty. */
const contentOfText = (text) => {
    const blocks = markdownToEditorData(String(text || '').slice(0, 20000));
    return { html: blocksToHtml(blocks), blocks };
};

const DRAFT_ELSEWHERE = 'a doc drafted for a task is saved in that task\'s project, so do not name another project';

/* Where a draft is saved. One written for a task is filed in the task's project, and is its author's alone when the
 * task's list is private: a project doc is read by everyone on the project, a private list's tasks are not.
 * null when the task has no project, or the draft names another one. */
const draftPlaceOf = async (companyId, params) => {
    const named = params.projectId && oid(params.projectId) ? String(params.projectId) : '';
    const taskId = params.taskId && oid(params.taskId);
    if (!taskId) return { projectId: named, visibility: 'project', linkedTasks: [] };
    const task = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id: taskId }, { ProjectID: 1, sprintId: 1 }] }, 'findOne');
    const projectId = task && oid(task.ProjectID) ? String(task.ProjectID) : '';
    if (!projectId || (named && named !== projectId)) return null;
    const list = oid(task.sprintId)
        ? await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.SPRINTS, data: [{ _id: oid(task.sprintId) }, { private: 1 }] }, 'findOne')
        : null;
    return { projectId, visibility: list && list.private === true ? 'private' : 'project', linkedTasks: [taskId] };
};

const executors = {
    async 'task.comment'(args) {
        return commentOn(args, 'task.comment', args.params.body);
    },

    async 'comment.create'(args) {
        return commentOn(args, 'comment.create', escapeCommentText(String(args.params.body || '')));
    },

    async 'timelog.create'({ companyId, actor, params }) {
        const task = await tools.getTask(companyId, params.taskId);
        const userId = String(actor.userId || '');
        if (!OBJECT_ID.test(userId)) throw new tools.DeterministicError('Time can only be logged for a person. Ask the person to connect you again.');
        const { start, minutes } = timelogEntry(params);
        if (await isPeriodLocked({ companyId, userId, date: new Date(start * 1000) })) {
            throw new tools.DeterministicError('That day is in a timesheet period a person already approved, so no time can be added to it. Ask the person to have it reopened.');
        }
        const a = attribution(actor);
        const saved = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TIMESHEET,
            data: {
                LogDescription: String(params.description || `${nameShown(actor, a)} on ${task.TaskKey || task.TaskName}`).slice(0, 500),
                Loggeduser: userId, TicketID: String(task._id), ProjectId: String(task.ProjectID),
                LogStartTime: start, LogEndTime: start + minutes * 60, LogTimeDuration: minutes, logAddType: 0, trackShots: [],
                billable: params.billable !== false, actorType: a.actorType, agentId: a.agentId || null, viaAccount: a.viaAccount || null, runId: actor.runId || null,
            },
        }, 'save');
        return { result: { timesheetId: String(saved._id), minutes }, undo: { kind: 'timelog.create', timesheetId: String(saved._id), taskId: String(task._id) }, entityId: task._id, entityName: task.TaskName };
    },

    async 'task.status.set'({ companyId, actor, params, depth }) {
        const task = await tools.getTask(companyId, params.taskId);
        const patch = await tools.resolveStatus(companyId, task.ProjectID, params.status.name || params.status.text);
        const check = registry.evaluate('task.status.set', { status: { statusType: patch.statusType, name: patch.status.text } });
        if (!check.allowed) throw new RefusedError(check.reason);
        const previous = { status: task.status, statusType: task.statusType, statusKey: task.statusKey };
        const completion = await completionStore.forStatusChange(companyId, task._id, {
            toStatus: { statusType: patch.statusType, name: patch.status.text }, actor: workEntry(actor),
        });
        const set = completion && !completion.error ? { ...patch, completion: completion.completion } : patch;
        const r = await tools.updateTask(companyId, task._id, set, context(actor, 'task.status.set', depth));
        return { result: { status: patch.status.text, statusType: patch.statusType }, undo: { kind: 'status', taskId: String(task._id), previous }, entityId: task._id, entityName: task.TaskName, task: r.task };
    },

    async 'task.link'({ companyId, actor, params, depth }) {
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
        emitTask(companyId, updated, { links: updated.links }, actor, depth);
        return { result: { linkId: String(link._id), kind: link.kind }, undo: { kind: 'link', taskId: String(task._id), linkId: String(link._id) }, entityId: task._id, entityName: task.TaskName };
    },

    async 'task.assign'({ companyId, actor, params, depth }) {
        const task = await tools.getTask(companyId, params.taskId);
        const ids = (Array.isArray(params.assigneeIds) ? params.assigneeIds : [params.assigneeId]).filter((v) => OBJECT_ID.test(String(v || ''))).map(String);
        if (!ids.length) throw new tools.DeterministicError('assigneeIds is required');
        const previous = (task.AssigneeUserId || []).map(String);
        const added = ids.filter((id) => !previous.includes(id));
        if ((await nonMembersOf(companyId, added)).length) throw new tools.DeterministicError(`assigneeIds: ${NOT_A_MEMBER}`);
        if (await cannotOpen(companyId, String(task.ProjectID), added)) throw new tools.DeterministicError(`assigneeIds: ${CANNOT_OPEN_PROJECT}`);
        const next = params.replace ? ids : [...new Set([...previous, ...ids])];
        const r = await tools.updateTask(companyId, task._id, { AssigneeUserId: next }, context(actor, 'task.assign', depth));
        return { result: { assignees: next }, undo: { kind: 'assign', taskId: String(task._id), previous }, entityId: task._id, entityName: task.TaskName, task: r.task };
    },

    async 'task.update'({ companyId, actor, params, depth }) {
        const task = await tools.getTask(companyId, params.taskId);
        const fields = params.fields || {};
        const previous = {};
        Object.keys(fields).forEach((k) => { previous[k] = task[k] === undefined ? null : task[k]; });
        const r = await tools.updateTask(companyId, task._id, fields, context(actor, 'task.update', depth));
        return { result: { fields: Object.keys(fields) }, undo: { kind: 'update', taskId: String(task._id), previous }, entityId: task._id, entityName: task.TaskName, task: r.task };
    },

    /* Run as the person behind the agent through the AI-field fill, so its access checks, prompt, caps and spend ledger apply. */
    async 'aifield.fill'({ companyId, actor, params }) {
        const aiFields = require('../CustomField/aiFields/fill');
        const task = await tools.getTask(companyId, params.taskId);
        let outcome;
        let definition;
        try {
            const loaded = await aiFields.loadDefinition(companyId, params.fieldId);
            definition = loaded.definition;
            outcome = await aiFields.fillTask({ companyId, uid: String(actor.userId || ''), definition, config: loaded.config, taskId: String(task._id), trigger: aiFields.TRIGGER.AGENT });
        } catch (e) {
            if (e instanceof aiFields.AiFieldError) throw new tools.DeterministicError(e.message);
            throw e;
        }
        const fieldId = String(definition._id);
        if (outcome.outcome !== 'filled') throw new tools.DeterministicError(`${definition.fieldTitle || 'the AI field'} was not filled: ${outcome.reason || outcome.outcome}`);
        const was = (group) => (task[group] && task[group][fieldId] !== undefined ? task[group][fieldId] : null);
        const previous = { [`customField.${fieldId}`]: was('customField'), [`aiFieldFills.${fieldId}`]: was('aiFieldFills') };
        return { result: { fieldId }, undo: { kind: 'update', taskId: String(task._id), previous }, entityId: task._id, entityName: task.TaskName };
    },

    async 'task.sprint.move'({ companyId, actor, params, depth }) {
        const task = await tools.getTask(companyId, params.taskId);
        if (task.ParentTaskId) throw new tools.DeterministicError('A subtask moves with its parent. Move the top-level task instead.');
        const target = oid(params.sprintId);
        if (!target) throw new tools.DeterministicError('a valid list id is required');
        const sprint = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.SPRINTS, data: [{ _id: target, projectId: task.ProjectID }] }, 'findOne');
        if (!sprint) throw new tools.DeterministicError('That list was not found in this project. Check sprints.list or ask the person which list they mean.');
        const previous = { sprintId: task.sprintId, sprintArray: task.sprintArray, folderObjId: task.folderObjId || null };
        const placement = await sprintPlacementOf(companyId, sprint);
        const r = await tools.updateTask(companyId, task._id, placement.set, context(actor, 'task.sprint.move', depth), placement.unset, pullOfLists([target]));
        await followSprintMove(companyId, { taskId: task._id, projectId: task.ProjectID, fromSprintId: task.sprintId, toSprintId: target });
        await moveDescendants(companyId, task._id, placement, target);
        return { result: { sprintId: String(target), name: sprint.name }, undo: { kind: 'sprint', taskId: String(task._id), previous }, entityId: task._id, entityName: task.TaskName, task: r.task };
    },

    async 'subtask.create'({ companyId, actor, params, depth }) {
        const r = await tools.createSubtask(companyId, params.taskId, { title: params.title, description: params.description || '' }, context(actor, 'subtask.create', depth));
        return { result: { subtaskId: r.subtaskId, key: r.key || '', title: r.title }, undo: { kind: 'subtask', subtaskId: r.subtaskId, parentTaskId: String(params.taskId) }, entityId: params.taskId };
    },

    async 'task.create'({ companyId, actor, params, depth }) {
        const r = await tools.createTask(companyId, params.projectId, {
            title: params.title, description: params.description || '', sprintId: params.sprintId || '', priority: params.priority || 'MEDIUM',
            leaderId: actor.userId || '',
        }, context(actor, 'task.create', depth));
        return { result: { taskId: r.taskId, key: r.key, title: r.title }, undo: { kind: 'task', taskId: r.taskId, projectId: String(params.projectId) }, entityId: r.taskId, entityName: r.title };
    },

    async 'timelog.start'({ companyId, actor, params }) {
        const task = await tools.getTask(companyId, params.taskId);
        const userId = String(actor.userId || '');
        if (!OBJECT_ID.test(userId)) throw new tools.DeterministicError('A timer can only run for a person. Ask the person to connect you again.');
        const running = await findRunningTimer(companyId, task._id, userId);
        if (running) return { result: { timesheetId: String(running._id), alreadyRunning: true }, undo: null, entityId: task._id, entityName: task.TaskName };
        const a = attribution(actor);
        const now = Math.floor(DateTime.utc().toSeconds());
        if (await isPeriodLocked({ companyId, userId, date: new Date(now * 1000) })) {
            throw new tools.DeterministicError('Today is in a timesheet period a person already approved, so a timer cannot start. Ask the person to have it reopened.');
        }
        const saved = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TIMESHEET,
            data: {
                LogDescription: String(params.description || `${nameShown(actor, a)} working on ${task.TaskKey || task.TaskName}`).slice(0, 500),
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
        if (!running) throw new tools.DeterministicError('No timer is running on this task, so there is nothing to stop.');
        const startedAt = new Date((Number(running.LogStartTime) || 0) * 1000);
        if (await isPeriodLocked({ companyId, userId: running.Loggeduser || actor.userId, date: startedAt })) {
            throw new tools.DeterministicError('The timer started in a timesheet period a person already approved, so it cannot be saved. Ask the person to have it reopened.');
        }
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
        const place = await draftPlaceOf(companyId, params);
        if (!place) throw new tools.DeterministicError(DRAFT_ELSEWHERE);
        const saved = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PAGES,
            data: { title, rawText: String(params.text || '').slice(0, 20000), content: cleanPageContent(params.content || contentOfText(params.text)),
                    ProjectID: place.projectId ? oid(place.projectId) : undefined,
                    createdBy: String(actor.userId || a.actorId), linkedTasks: place.linkedTasks, visibility: place.visibility,
                    createdByAgent: true, agentName: nameShown(actor, a), agentStatus: 'draft', deletedStatusKey: 0 },
        }, 'save');
        emitPageChange(companyId, 'insert', saved);
        return { result: { pageId: String(saved._id) }, undo: { kind: 'page', pageId: String(saved._id) }, entityType: 'page', entityId: saved._id, entityName: title };
    },

    async 'slack.message.post'({ companyId, actor, params }) {
        return require('./connectors/slackPost').post({ companyId, actor, params });
    },

    /* For the person behind the agent, on the task named: the reminder the task screen sets. */
    async 'reminder.create'({ companyId, actor, params }) {
        const task = await tools.getTask(companyId, params.taskId);
        const userId = String(actor.userId || '');
        if (!OBJECT_ID.test(userId)) throw new tools.DeterministicError('a reminder needs a person to remind');
        const reminderAt = new Date(params.reminderAt || NaN);
        if (Number.isNaN(reminderAt.getTime())) throw new tools.DeterministicError('reminderAt is not a valid date');
        const saved = await require('../Reminders/helper').createReminder(companyId, userId, {
            taskId: task._id, projectId: task.ProjectID, reminderAt, reminderText: String(params.reminderText || '').slice(0, 500),
        });
        return { result: { reminderId: String(saved._id) }, undo: null, entityId: task._id, entityName: task.TaskName };
    },

    async 'chat.post'({ companyId, actor, params, depth }) {
        const r = await tools.addComment(companyId, params.taskId, params.body, context(actor, 'chat.post', depth));
        return { result: { commentId: r.commentId }, undo: { kind: 'comment', commentId: r.commentId, taskId: String(params.taskId) }, entityId: params.taskId };
    },

    /* Only a comment an agent wrote for this person, on the task named; the edit itself is the comment route's. */
    async 'comment.update'({ companyId, actor, params }) {
        const uid = String(actor.userId || '');
        const comment = OBJECT_ID.test(String(params.commentId || ''))
            ? await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMMENTS, data: [{ _id: oid(params.commentId), isDeleted: { $ne: true } }] }, 'findOne')
            : null;
        const own = comment && comment.actorType === 'agent' && String(comment.userId) === uid && String(comment.taskId) === String(params.taskId);
        if (!own) throw new tools.DeterministicError('You can change only a comment an agent wrote for the person on this task, and this is not one.');
        const body = String(params.body || '').trim();
        if (!body) throw new tools.DeterministicError('The comment is empty. Write some text.');
        const answer = await require('./pageRequests').answerOf(require('../Comments/controller').update, { companyId, uid, body: { id: String(comment._id), data: { message: body } } });
        if (!answer || answer.status !== true) throw new tools.DeterministicError((answer && answer.message) || 'The comment was not changed. Try again, or tell the person.');
        return { result: { commentId: String(comment._id) }, undo: { kind: 'commentText', commentId: String(comment._id), taskId: String(params.taskId), previous: comment.message || '' }, entityId: params.taskId };
    },

    /* The group record of a batch: the changes are the actions it names, each checked and audited on its own. */
    async 'tasks.batch'({ params }) {
        const auditIds = (Array.isArray(params.auditIds) ? params.auditIds : []).map(String);
        return { result: { applied: auditIds.length }, undo: auditIds.length ? { kind: 'batch', auditIds } : null, entityId: params.taskId || '' };
    },

    ...require('./taskRequests').executors,
    ...require('./pageRequests').executors,
    ...require('./workRequests').executors,
    ...require('./goalRequests').executors,
    ...require('./manager/workQueue').executors,
};

const COMMENT_ACTIONS = new Set(['task.comment', 'comment.create', 'chat.post', 'comment.update']);
const WRITES_OWN_COMPLETION = new Set(['timelog.stop', 'task.status.set', 'task.status.change', 'tasks.batch']);

/* A task that does not exist is left to the executor, which reports it as not found. */
const threadMay = async (companyId, actor, action, params) => {
    if (!COMMENT_ACTIONS.has(action) || !OBJECT_ID.test(String(params.taskId || ''))) return true;
    const task = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id: oid(params.taskId) }, { ProjectID: 1, sprintId: 1 }] }, 'findOne');
    if (!task) return true;
    return (await canPostToThread(companyId, actor && actor.userId, tools.commentThreadOf(task))).allowed;
};
const THREAD_REFUSAL = 'not_visible: that task was not found, or the person cannot open its comments. Ask the person which task they mean.';
const TASK_REFUSAL = 'not_visible: that task was not found, or the person cannot open it. Ask the person which task they mean.';
const PROJECT_REFUSAL = 'not_visible: that project was not found, or the person cannot open it. Ask the person which project they mean.';
const LIST_REFUSAL = 'not_visible: that list was not found in that project, or the person cannot open it. Ask the person which list they mean.';

/* These reach their task, project or list through the automation tool layer, which asks nothing about a person, so
 * the task routes' read rule is asked here. Every other executor runs a route's handler or a check of its own. */
const TASK_WRITES = new Set(['task.status.set', 'task.link', 'task.assign', 'task.update', 'task.sprint.move', 'subtask.create', 'timelog.create', 'timelog.start', 'timelog.stop', 'reminder.create']);

const targetRefusal = async (companyId, actor, action, params) => {
    const uid = String((actor && actor.userId) || '');
    if (action === 'task.create') {
        if (!(await openProject(companyId, uid, params.projectId))) return PROJECT_REFUSAL;
        return !params.sprintId || await listOf(companyId, uid, params.projectId, params.sprintId) ? '' : LIST_REFUSAL;
    }
    if (!TASK_WRITES.has(action)) return '';
    const taskId = String(params.taskId || '');
    if (!(await readableTaskIds(companyId, uid, [taskId])).includes(taskId)) return TASK_REFUSAL;
    if (action !== 'task.sprint.move') return '';
    const task = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id: oid(taskId) }, { ProjectID: 1 }] }, 'findOne');
    return await listOf(companyId, uid, task.ProjectID, params.sprintId) ? '' : LIST_REFUSAL;
};

/* page.draft saves its doc without the create route, so the route's rule is asked here: a task the person behind
 * the agent can open to hang it on, and a place where they may start a doc. Returns the refusal, or ''. */
const draftRefusal = async (companyId, actor, action, params) => {
    if (action !== 'page.draft') return '';
    const uid = String((actor && actor.userId) || '');
    const linked = params.taskId && oid(params.taskId) ? [String(params.taskId)] : [];
    if ((await readableTaskIds(companyId, uid, linked)).length !== linked.length) return TASK_REFUSAL;
    const place = await draftPlaceOf(companyId, params);
    if (!place) return `permission_denied: ${DRAFT_ELSEWHERE}`;
    const start = await canCreatePageIn(companyId, uid, place.projectId);
    if (start.allowed) return '';
    return start.statusCode === 403 ? 'permission_denied: the person you act for is not allowed to add a doc here. Ask them to do it in AlianHub, or to name another place.' : PROJECT_REFUSAL;
};

/* Why the person behind `actor` may not make this change themselves, or '' when they may: the right, the thread,
 * the task, project or list, and the place of a doc. An approval asks it of the approver before anything is claimed. */
const personRefusal = async (companyId, actor, action, params = {}) => {
    const holder = await permissions.holderMay(companyId, actor, action, params);
    if (!holder.allowed) return holder.reason;
    if (!(await threadMay(companyId, actor, action, params))) return THREAD_REFUSAL;
    return await targetRefusal(companyId, actor, action, params) || draftRefusal(companyId, actor, action, params);
};

const refusal = async (companyId, actor, { action, params, reason, ip, entityType, entityId, taint }) => {
    const auditId = await audit.recordRefusal(companyId, actor, { action, reason, params, entityType, entityId: entityId || params.taskId, ip, taint });
    return new RefusedError(reason, auditId);
};

/* The credential grants nothing on its own: the registry and the holder's
 * permissions still follow it. */
const liveStep = async (companyId, actor, { action, params, ip, taint }) => {
    if (actor && actor.stepScoped && !actor.stepCredential) {
        throw await refusal(companyId, actor, { action, params, reason: `${stepCredential.REFUSAL_PREFIX}: ${stepCredential.REFUSAL.MISSING}`, ip, taint });
    }
    if (!actor || !actor.stepCredential) return;
    const live = await stepCredential.check(companyId, actor.stepCredential, { action, actor });
    if (!live.ok) throw await refusal(companyId, actor, { action, params, reason: live.reason, ip, taint });
};

/* A change that could only be proposed, in a project where agents are paused, could not be proposed either: the pause is the answer. */
const pauseOverProposal = async (companyId, actor, { action, params, approved, check }) => {
    if (check.code !== 'propose_only') return check.reason;
    const rule = await projectPolicy.ask({ companyId, actor, action, params, approved });
    return rule.paused ? rule.reason : check.reason;
};

/* Run one action for an actor. Refusals are audited and thrown as RefusedError.
 * This is the one place every agent's change passes, so "changed since you read it" (./taskReads) is asked here,
 * last, with nothing written yet.
 * A policy `decision` of refuse is honoured before the registry check, so a
 * policy refusal leaves the same audit row as a registry one. `approved` is an
 * argument and never read from `params`, so only the approval of a proposal sets it; `approvedBy` is the person who
 * approved, for an executor that holds each of its parts to that person's rights too. `within` is what this call was
 * held to, for an executor that runs a part of its change as an action of its own. */
const perform = async ({ companyId, actor, action, params = {}, reason = '', cost = null, ip = '', allowedActions, decision = null, depth = 0, taint = null, approved = false, approvedBy = '' }) => {
    await liveStep(companyId, actor, { action, params, ip, taint });
    if (decision && decision.decision === 'refuse') throw await refusal(companyId, actor, { action, params, reason: decision.reason, ip, taint });
    const check = registry.evaluate(action, params, { allowedActions });
    if (!check.allowed) throw await refusal(companyId, actor, { action, params, reason: await pauseOverProposal(companyId, actor, { action, params, approved, check }), ip, taint });
    const closed = await personRefusal(companyId, actor, action, params);
    if (closed) throw await refusal(companyId, actor, { action, params, reason: closed, ip, taint });
    const rule = await projectPolicy.ask({ companyId, actor, action, params, approved, taint, standing: true, applying: true });
    if (rule.decision !== projectPolicy.DECISION.ACT) {
        const held = rule.decision === projectPolicy.DECISION.PROPOSE ? `${rule.reason}, so it waits for a person's approval` : rule.reason;
        throw await refusal(companyId, actor, { action, params, reason: held, ip, taint });
    }
    if (!check.action.write) return { result: null, auditId: null, undo: null };
    const exec = executors[action];
    if (!exec) throw new tools.DeterministicError(`${action} is not ready to be used yet, so nothing was changed.`);

    const turn = await taskReads.turnFor({ companyId, actor, action, params, approved });
    if (turn.refusal) throw await refusal(companyId, actor, { action, params, reason: turn.refusal, ip, taint });
    let changed = false;
    try {
        const standing = rule.standing || null;
        const auditId = await audit.openAction(companyId, actor, {
            action, params, cost, ip, entityId: params.taskId, taint, standing,
            reason: standing ? `${reason || action} (standing approval ${standing.id}, made by ${standing.madeBy})` : reason,
        });
        let out;
        try {
            out = await exec({ companyId, actor, params, depth: clampDepth(depth), approvedBy: approved ? String(approvedBy || '') : '', within: { allowedActions, ip, taint } });
        } catch (e) {
            await audit.failAction(companyId, auditId, e.message);
            throw e;
        }
        changed = true;
        if (isAgent(actor) && params.taskId && !WRITES_OWN_COMPLETION.has(action)) {
            await completionStore.recordWork(companyId, params.taskId, workEntry(actor, 0));
        }
        await audit.applyAction(companyId, auditId, { undo: out.undo, entityType: out.entityType || 'task', entityId: out.entityId, entityName: out.entityName });
        if (standing) {
            await require('./standingApprovals').recordUse(companyId, standing, { action, params, auditId, reason })
                .catch((e) => logger.error(`[standing-approval] ${standing.id} applied ${action} (audit ${auditId}) but its use was not recorded: ${e.message}`));
        }
        if (!approved) changeNotice.announce(companyId, actor, auditId);
        return { result: out.result, auditId, undo: out.undo, task: out.task || null, ...(standing ? { standing } : {}) };
    } finally {
        await turn.end(changed);
    }
};

/* Reads still go through the registry so a refusal is logged the same way. */
const authorizeRead = async ({ companyId, actor, action, params = {}, ip = '', allowedActions, opens = null }) => {
    await liveStep(companyId, actor, { action, params, ip });
    const check = registry.evaluate(action, params, { allowedActions });
    if (!check.allowed) throw await refusal(companyId, actor, { action, params, reason: check.reason, ip });
    // `opens` says whether the caller can open what `params` names. What it cannot open is judged as an id that names nothing is.
    const holder = await permissions.holderMay(companyId, actor, action, params, { byWorkspaceRules: Boolean(opens) && !(await opens()) });
    if (!holder.allowed) throw await refusal(companyId, actor, { action, params, reason: holder.reason, ip });
    return true;
};

module.exports = { perform, authorizeRead, personRefusal, refusal, RefusedError, executors, workEntry, SCOPE, RATING_KEYS, RATINGS, rating, ratings, unrated, isCompleteRating, manifest };
