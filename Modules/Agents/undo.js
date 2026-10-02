const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const socketEmitter = require('../../event/socketEventEmitter');
const audit = require('./agentAudit');
const budget = require('./budget');
const scope = require('./scope');
const { emitPageChange } = require('../Pages/helpers/pageEvents');
const knowledgeEvents = require('../Knowledge/ingest/events');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const { canReadTask } = require('../Tasks/helpers/taskReadAccess');
const { canChangeComment } = require('../Comments/helpers/threadWriteAccess');
const { canSeeSprintById } = require('../Sprints/helpers/sprintVisibility');
const { followSprintMove, moveDescendants } = require('../Tasks/helpers/sprintPlacement');
const { pullOfLists, opensList } = require('../Tasks/helpers/taskExtraLists');
const { canUsePage } = require('../Pages/helpers/pageAccess');

// Undo replays the inverse action and logs it as the person who pressed Undo.
// Only the descriptors perform() wrote are understood; anything else is
// "not undoable" rather than a guess. Every path that undoes — a single audit
// row, a proposal, a whole run — goes through undoStateOf, so the company's
// undo window and the caller's view of the project and the target are checked exactly once.

const HOUR_MS = 60 * 60 * 1000;
const REASON = Object.freeze({
    WINDOW_PASSED: 'undo_window_passed', NOT_VISIBLE: 'project_not_visible', TARGET_NOT_VISIBLE: 'target_not_visible', ALREADY_UNDONE: 'already_undone', NOT_UNDOABLE: 'not_undoable',
    PENDING: 'action_pending', FAILED: 'action_failed', UNRECORDABLE: 'undo_unrecordable',
});
const MESSAGES = {
    [REASON.WINDOW_PASSED]: (s) => `The undo window closed at ${s.undoUntil}.`,
    [REASON.NOT_VISIBLE]: () => 'You cannot see the project this action touched.',
    [REASON.TARGET_NOT_VISIBLE]: () => 'You cannot see what this action touched.',
    [REASON.ALREADY_UNDONE]: () => 'Already undone.',
    [REASON.NOT_UNDOABLE]: () => 'not undoable',
    [REASON.PENDING]: () => 'The action was never confirmed in the audit log; reconcile it by hand before undoing.',
    [REASON.FAILED]: () => 'The action failed and changed nothing.',
    [REASON.UNRECORDABLE]: () => 'This undo could not be recorded in the audit log right now, so it was not run.',
};
const STATUS_OF = { [REASON.WINDOW_PASSED]: 410, [REASON.NOT_VISIBLE]: 403, [REASON.TARGET_NOT_VISIBLE]: 403, [REASON.UNRECORDABLE]: 503 };
const AUDITED_REFUSALS = [REASON.WINDOW_PASSED, REASON.NOT_VISIBLE, REASON.TARGET_NOT_VISIBLE];

const LIST_KINDS = Object.freeze(['list', 'listName', 'listFolder', 'listSprint']);
/* A goal belongs to no project: whoever can edit the goal may undo a change to it. */
const GOAL_KINDS = Object.freeze(['goalValue', 'goalSource']);
/* A field, a view, a whole setup, a folder, or the project or the copy of one an agent asked for is the project's own: seeing the project is seeing it, and the route that takes it back asks the rest. */
const SETUP_KINDS = Object.freeze(['fields', 'view', 'setup', 'project', 'projectCopy', 'folder']);
/* A rule is taken back by the Automations page's own delete, which asks whether the person undoing may. */
const AUTOMATION_KIND = 'automation';
const work = () => require('./workRequests');
const goalWork = () => require('./goalRequests');
const setupWork = () => require('./setupRequests');
const undoer = (actor) => require('./taskRequests').whoOf(actor);

const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };

const setTask = async (companyId, taskId, set, unset, pull) => {
    const update = { $set: set };
    if (unset) update.$unset = unset;
    if (pull) update.$pull = pull;
    const updated = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS, data: [{ _id: oid(taskId) }, update, { returnDocument: 'after' }],
    }, 'findOneAndUpdate');
    if (updated) socketEmitter.emit('update', { type: 'update', module: 'task', companyId, data: updated, updatedFields: set, actor: { kind: 'user' }, depth: 1 });
    return updated;
};

/* The first values a set of fields was given, newest first, each put back as undoing one field value puts it back.
 * One on a task the person undoing cannot open stays, and so does the field that holds it. */
const putBackValues = async (companyId, values, actor) => {
    const kept = [];
    let restored = 0;
    for (const value of [...values].reverse()) {
        const key = `customField.${value.fieldId}`;
        if (!(await taskReadable(companyId, actor.userId, value.taskId))) {
            const field = await findRow(companyId, SCHEMA_TYPE.CUSTOM_FIELDS, value.fieldId, { fieldTitle: 1 });
            kept.push({ field: (field && field.fieldTitle) || '', reason: 'it is on a task you cannot open' });
        } else {
            const empty = value.previous === null || value.previous === undefined;
            await setTask(companyId, value.taskId, empty ? {} : { [key]: value.previous }, empty ? { [key]: 1 } : undefined);
            restored += 1;
        }
    }
    return { restored, kept };
};

const inverses = {
    async comment(companyId, u) {
        await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMMENTS, data: [{ _id: oid(u.commentId) }, { $set: { isDeleted: true } }] }, 'updateOne');
        knowledgeEvents.publishCommentChanged(companyId, u.commentId, 'deleted');
        return { commentId: u.commentId, deleted: true };
    },
    async status(companyId, u) {
        await setTask(companyId, u.taskId, { status: u.previous.status, statusType: u.previous.statusType, statusKey: u.previous.statusKey });
        return { taskId: u.taskId, restored: u.previous.statusType };
    },
    async assign(companyId, u) {
        await setTask(companyId, u.taskId, { AssigneeUserId: u.previous || [] });
        return { taskId: u.taskId, restored: u.previous };
    },
    async update(companyId, u) {
        const set = {}; const unset = {};
        Object.entries(u.previous || {}).forEach(([k, v]) => { if (v === null) unset[k] = 1; else set[k] = v; });
        await setTask(companyId, u.taskId, set, Object.keys(unset).length ? unset : undefined);
        return { taskId: u.taskId, restored: Object.keys(u.previous || {}) };
    },
    async sprint(companyId, u) {
        const before = await findRow(companyId, SCHEMA_TYPE.TASKS, u.taskId, { ProjectID: 1, sprintId: 1 });
        const set = { sprintId: u.previous.sprintId, sprintArray: u.previous.sprintArray };
        let unset;
        if (u.previous.folderObjId) set.folderObjId = u.previous.folderObjId;
        else if ('folderObjId' in u.previous) unset = { folderObjId: '' };
        await setTask(companyId, u.taskId, set, unset, pullOfLists([u.previous.sprintId]));
        if (before) await followSprintMove(companyId, { taskId: before._id, projectId: before.ProjectID, fromSprintId: before.sprintId, toSprintId: u.previous.sprintId });
        await moveDescendants(companyId, u.taskId, { set, unset }, u.previous.sprintId);
        return { taskId: u.taskId, restored: String(u.previous.sprintId) };
    },
    async link(companyId, u) {
        await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id: oid(u.taskId) }, { $pull: { links: { _id: oid(u.linkId) } } }] }, 'updateOne');
        return { taskId: u.taskId, removedLink: u.linkId };
    },
    async task(companyId, u) {
        await setTask(companyId, u.taskId, { deletedStatusKey: 1 });
        return { taskId: u.taskId, deleted: true };
    },
    async subtask(companyId, u) {
        await setTask(companyId, u.subtaskId, { deletedStatusKey: 1 });
        await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id: oid(u.parentTaskId) }, { $inc: { subTasks: -1 } }] }, 'updateOne').catch(() => {});
        return { subtaskId: u.subtaskId, deleted: true };
    },
    async 'timelog.start'(companyId, u) {
        await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TIMESHEET, data: [{ _id: oid(u.timesheetId), LogTimeDuration: 0 }] }, 'deleteOne');
        return { timesheetId: u.timesheetId, deleted: true };
    },
    async 'timelog.create'(companyId, u) {
        await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TIMESHEET, data: [{ _id: oid(u.timesheetId), TicketID: String(u.taskId) }] }, 'deleteOne');
        return { timesheetId: u.timesheetId, deleted: true };
    },
    async 'timelog.stop'(companyId, u) {
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TIMESHEET,
            data: [{ _id: oid(u.timesheetId) }, { $set: { LogTimeDuration: 0, startTimeTracker: u.previousStart, LogEndTime: u.previousStart } }],
        }, 'updateOne');
        return { timesheetId: u.timesheetId, resumed: true };
    },
    async page(companyId, u) {
        await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PAGES, data: [{ _id: oid(u.pageId) }, { $set: { deletedStatusKey: 1 } }] }, 'updateOne');
        emitPageChange(companyId, 'update', { _id: String(u.pageId), deletedStatusKey: 1, deleted: 1, ids: [String(u.pageId)] });
        return { pageId: u.pageId, deleted: true };
    },
    async commentText(companyId, u) {
        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.COMMENTS, data: [{ _id: oid(u.commentId) }, { $set: { message: u.previous } }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        if (updated) socketEmitter.emit('update', { type: 'update', data: updated, updatedFields: {}, module: 'comments', companyId });
        return { commentId: u.commentId, restored: true };
    },
    async pageVersion(companyId, u, actor) {
        await require('./pageRequests').restoreVersion({ companyId, uid: String((actor && actor.userId) || ''), pageId: u.pageId, versionId: u.versionId });
        return { pageId: u.pageId, restored: u.versionId };
    },
    /* Newest first, each through its own undo, so each is checked for the person undoing; one that cannot be undone is reported and the rest go on. */
    async batch(companyId, u, actor) {
        const items = [];
        for (const auditId of [...(u.auditIds || [])].reverse()) {
            const row = await audit.findById(companyId, auditId);
            const out = row ? await undoAuditRow(companyId, row, actor) : { ok: false, reason: REASON.NOT_UNDOABLE };
            items.push({ auditId, ok: out.ok === true, ...(out.ok === true ? {} : { reason: out.reason }) });
        }
        return { undone: items.filter((item) => item.ok).length, items };
    },
    async statusChange(companyId, u, actor) {
        const requests = require('./taskRequests');
        await requests.setStatus({ companyId, who: requests.whoOf(actor), taskId: u.taskId, name: u.previous });
        return { taskId: u.taskId, restored: u.previous };
    },
    /* Tags, links, lists and doc comments are put back by the handlers that changed them, as the person undoing. */
    async tag(companyId, u, actor) {
        await work().setTag({ companyId, who: undoer(actor), taskId: u.taskId, tag: u.tagId, operation: u.operation === 'add' ? 'remove' : 'add' });
        return { taskId: u.taskId, tagId: u.tagId, restored: true };
    },
    async relation(companyId, u, actor) {
        await work().unlinkTasks({ companyId, who: undoer(actor), taskId: u.taskId, relatedTaskId: u.relatedTaskId });
        return { taskId: u.taskId, unlinked: u.relatedTaskId };
    },
    async relationRemoved(companyId, u, actor) {
        await work().linkTasks({ companyId, who: undoer(actor), taskId: u.taskId, relatedTaskId: u.relatedTaskId, type: u.type });
        return { taskId: u.taskId, linked: u.relatedTaskId };
    },
    async extraList(companyId, u, actor) {
        await work().setExtraList({ companyId, who: undoer(actor), taskId: u.taskId, listProjectId: u.listProjectId, sprintId: u.sprintId, operation: u.operation === 'add' ? 'remove' : 'add' });
        return { taskId: u.taskId, sprintId: u.sprintId, restored: true };
    },
    async list(companyId, u, actor) {
        await work().withdrawList({ companyId, who: undoer(actor), projectId: u.projectId, sprintId: u.sprintId });
        return { sprintId: u.sprintId, deleted: true };
    },
    async listName(companyId, u, actor) {
        await work().renameList({ companyId, who: undoer(actor), projectId: u.projectId, sprintId: u.sprintId, name: u.previous });
        return { sprintId: u.sprintId, restored: u.previous };
    },
    async listFolder(companyId, u, actor) {
        await work().moveList({ companyId, who: undoer(actor), projectId: u.projectId, sprintId: u.sprintId, folderId: u.previous });
        return { sprintId: u.sprintId, restored: u.previous || null };
    },
    async pageComment(companyId, u, actor) {
        await require('../Pages/comments').withdrawComment(companyId, u.pageId, u.commentId, String((actor && actor.userId) || ''));
        return { commentId: u.commentId, deleted: true };
    },
    async pageCommentAssign(companyId, u, actor) {
        await work().assignPageComment({ companyId, uid: String((actor && actor.userId) || ''), pageId: u.pageId, commentId: u.commentId, assigneeId: u.previous });
        return { commentId: u.commentId, restored: u.previous || null };
    },
    /* A target's value and what it counts are put back through the goal routes, as the person undoing. */
    async goalValue(companyId, u, actor) {
        await goalWork().setValue({ companyId, uid: undoer(actor).uid, goalId: u.goalId, targetId: u.targetId, value: u.previous });
        return { goalId: u.goalId, targetId: u.targetId, restored: u.previous };
    },
    async goalSource(companyId, u, actor) {
        await goalWork().changeSources({
            companyId, uid: undoer(actor).uid, goalId: u.goalId, targetId: u.targetId, kind: u.sourceKind, sourceId: u.sourceId, operation: u.operation === 'add' ? 'remove' : 'add',
        });
        return { goalId: u.goalId, targetId: u.targetId, restored: true };
    },
    /* Archiving carries the subtasks and the list's counts, so it is put back by the handler that made it, as the person undoing. */
    async archive(companyId, u, actor) {
        const requests = require('./taskRequests');
        await requests.setArchived({ companyId, who: requests.whoOf(actor), taskId: u.taskId, to: u.previous });
        return { taskId: u.taskId, restored: u.previous };
    },
    /* Fields and views are taken back through the field and project routes, as the person undoing. A field that
     * holds a value or is on another project now stays, and the answer names it. */
    async fields(companyId, u, actor) {
        const values = Array.isArray(u.values) ? await putBackValues(companyId, u.values, actor) : null;
        const out = await setupWork().withdrawFields({ companyId, who: undoer(actor), projectId: u.projectId, fieldIds: u.fieldIds });
        return { projectId: u.projectId, ...out, ...(values ? { values } : {}) };
    },
    async view(companyId, u, actor) {
        const out = await setupWork().withdrawView({ companyId, who: undoer(actor), projectId: u.projectId, viewId: u.viewId });
        return { projectId: u.projectId, viewId: u.viewId, ...out };
    },
    ...require('./manager/workQueue').inverses,
    ...require('./projectSetup').inverses,
    ...require('./projectCreate').inverses,
    ...require('./projectDuplicate').inverses,
    ...require('./listSetup').inverses,
    ...require('./automationRequests').inverses,
};

const isUndoable = (row) => Boolean(row && row.meta && row.meta.undo && inverses[row.meta.undo.kind] && !row.meta.undoneAt);

const runOf = async (companyId, row) => {
    const runId = row && row.meta && row.meta.runId;
    if (!runId || !oid(runId)) return null;
    return MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_RUNS, data: [{ _id: oid(runId) }] }, 'findOne').catch(() => null);
};

/* A run's actions share one deadline, counted from when the run finished;
 * a row outside any run counts from the row itself. */
const undoUntilOf = (row, run, undoHours) => {
    const anchor = (run && run.finishedAt) || row.createdAt || Date.now();
    return new Date(new Date(anchor).getTime() + undoHours * HOUR_MS);
};

const projectIdOfRow = async (companyId, row, run) => {
    const m = row.meta || {};
    const direct = row.projectId || (run && run.projectId) || (m.params && m.params.projectId) || (m.undo && m.undo.projectId);
    if (direct) return String(direct);
    const entityId = row.entityId && oid(row.entityId);
    if (entityId && row.entityType === 'task') {
        const task = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id: entityId }, { ProjectID: 1 }] }, 'findOne').catch(() => null);
        return task && task.ProjectID ? String(task.ProjectID) : '';
    }
    return '';
};

const findRow = (companyId, type, id, fields) => (oid(id)
    ? MongoDbCrudOpration(companyId, { type, data: [{ _id: oid(id) }, fields] }, 'findOne')
    : null);

const taskReadable = async (companyId, uid, taskId) => canReadTask(companyId, uid,
    await findRow(companyId, SCHEMA_TYPE.TASKS, taskId, { ProjectID: 1, sprintId: 1, mainChat: 1, AssigneeUserId: 1 }));

/* The project on the row is the one the action was filed under, which need not be where the target
 * sits, so the target is read again: a comment by its thread, a page as the doc editor would, everything else
 * by its task. Moving a task back also lands it in its previous sprint. */
const targetVisible = async (companyId, uid, u) => {
    if (u.kind === 'comment') {
        const comment = await findRow(companyId, SCHEMA_TYPE.COMMENTS, u.commentId, { projectId: 1, sprintId: 1, taskId: 1 });
        return Boolean(comment) && (await canChangeComment(companyId, uid, comment)).allowed;
    }
    if (u.kind === 'commentText') {
        const comment = await findRow(companyId, SCHEMA_TYPE.COMMENTS, u.commentId, { projectId: 1, sprintId: 1, taskId: 1 });
        return Boolean(comment) && (await canChangeComment(companyId, uid, comment)).allowed;
    }
    if (u.kind === 'batch' || SETUP_KINDS.includes(u.kind)) return true;
    if (u.kind === AUTOMATION_KIND) return true;
    if (u.kind === 'page' || u.kind === 'pageVersion') {
        const page = await findRow(companyId, SCHEMA_TYPE.PAGES, u.pageId, { visibility: 1, createdBy: 1, ProjectID: 1, sharedWith: 1, deletedStatusKey: 1 });
        /* Undoing a page takes it to the trash, which a person the doc is only shared with may not do; putting
         * a version back is an edit of its text. */
        return Boolean(page) && Number(page.deletedStatusKey || 0) !== 1
            && canUsePage(companyId, page, uid, { edit: true, named: u.kind === 'pageVersion' });
    }
    if (u.kind === 'pageComment' || u.kind === 'pageCommentAssign') {
        const page = await findRow(companyId, SCHEMA_TYPE.PAGES, u.pageId, { visibility: 1, createdBy: 1, ProjectID: 1, deletedStatusKey: 1 });
        return Boolean(page) && Number(page.deletedStatusKey || 0) === 0 && canUsePage(companyId, page, uid);
    }
    if (GOAL_KINDS.includes(u.kind)) {
        const goal = await goalWork().goalFor({ companyId, uid, goalId: u.goalId });
        return Boolean(goal) && goal.canEdit === true;
    }
    if (LIST_KINDS.includes(u.kind)) return isPrivileged(await getRoleType(companyId, uid)) || canSeeSprintById(companyId, uid, u.sprintId);
    if (u.kind === 'relation' || u.kind === 'relationRemoved') return (await taskReadable(companyId, uid, u.taskId)) && taskReadable(companyId, uid, u.relatedTaskId);
    if (u.kind === 'subtask') return taskReadable(companyId, uid, u.subtaskId);
    if (u.kind === 'extraList') return (await taskReadable(companyId, uid, u.taskId)) && opensList(companyId, uid, u.sprintId);
    if (!(await taskReadable(companyId, uid, u.taskId))) return false;
    if (u.kind !== 'sprint' || isPrivileged(await getRoleType(companyId, uid))) return true;
    return canSeeSprintById(companyId, uid, u.previous && u.previous.sprintId);
};

/* ctx lets a caller that already holds the run, the settings or the caller's
 * visible projects pass them in instead of re-reading them per row. */
const undoContext = async (companyId, actor, ctx = {}) => ({
    undoHours: ctx.undoHours !== undefined ? ctx.undoHours : (await budget.settings(companyId)).undoHours,
    visibleProjectIds: ctx.visibleProjectIds || (await scope.visibleProjectIds(companyId, actor.userId)).map(String),
    run: ctx.run,
});

const undoStateOf = async (companyId, row, actor, ctx = {}) => {
    const state = (reason, undoUntil, projectId) => ({ undoable: !reason, reason: reason || '', undoUntil: undoUntil ? undoUntil.toISOString() : null, projectId: projectId || '' });
    if (!row || row.action !== audit.ACTION_DONE) return state(REASON.NOT_UNDOABLE);
    if (row.meta && row.meta.undoneAt) return state(REASON.ALREADY_UNDONE);
    if (row.meta && row.meta.state === audit.STATE.PENDING) return state(REASON.PENDING);
    if (row.meta && row.meta.state === audit.STATE.FAILED) return state(REASON.FAILED);
    const full = await undoContext(companyId, actor, ctx);
    const run = full.run !== undefined ? full.run : await runOf(companyId, row);
    const undoUntil = undoUntilOf(row, run, full.undoHours);
    const projectId = await projectIdOfRow(companyId, row, run);
    if (!isUndoable(row)) return state(REASON.NOT_UNDOABLE, undoUntil, projectId);
    const inAProject = !GOAL_KINDS.includes(row.meta.undo.kind);
    if (inAProject && (!projectId || !full.visibleProjectIds.includes(projectId))) return state(REASON.NOT_VISIBLE, undoUntil, projectId);
    if (Date.now() >= undoUntil.getTime()) return state(REASON.WINDOW_PASSED, undoUntil, projectId);
    if (!(await targetVisible(companyId, actor.userId, row.meta.undo))) return state(REASON.TARGET_NOT_VISIBLE, undoUntil, projectId);
    return state('', undoUntil, projectId);
};

const messageOf = (state) => (MESSAGES[state.reason] || (() => state.reason))(state);
const statusOf = (reason) => STATUS_OF[reason] || 409;

const refuse = async (companyId, actor, state, { entityType, entityId, action, ip }) => {
    if (AUDITED_REFUSALS.includes(state.reason)) {
        await audit.recordRefusal(companyId, actor, { action: action || 'undo', reason: state.reason, params: { undoUntil: state.undoUntil }, entityType, entityId, path: '', ip });
    }
    return { ok: false, reason: state.reason, message: messageOf(state), undoUntil: state.undoUntil, status: statusOf(state.reason) };
};

/* Undo one audit row. Returns { ok, reason, result } or, refused, { ok:false, reason, message, undoUntil, status }. */
const undoAuditRow = async (companyId, row, actor, ip, ctx) => {
    if (!row || row.action !== audit.ACTION_DONE) return { ok: false, reason: 'Only agent actions can be undone.' };
    const state = await undoStateOf(companyId, row, actor, ctx);
    const refusal = { entityType: row.entityType, entityId: row.entityId, action: row.meta && row.meta.action, ip };
    if (!state.undoable) return refuse(companyId, actor, state, refusal);
    // An inverse that ran before a failed mark must not run again, and one that could not be marked must not run at all.
    if (await audit.undoneBefore(companyId, row)) return refuse(companyId, actor, { ...state, undoable: false, reason: REASON.ALREADY_UNDONE }, refusal);
    if (!(await audit.canRecordChange(companyId, row))) return refuse(companyId, actor, { ...state, undoable: false, reason: REASON.UNRECORDABLE }, refusal);
    const u = row.meta.undo;
    const result = await inverses[u.kind](companyId, u, actor);
    const unmarked = await audit.markUndone(companyId, row._id, actor.userId).then(() => null, (error) => error);
    await audit.recordUndo(companyId, actor, { originalId: row._id, action: row.meta.action, entityType: row.entityType, entityId: row.entityId, ip });
    if (unmarked) throw unmarked;
    return { ok: true, reason: '', result, undoUntil: state.undoUntil };
};

module.exports = { undoAuditRow, undoStateOf, undoContext, undoUntilOf, messageOf, statusOf, refuse, isUndoable, inverses, REASON };
