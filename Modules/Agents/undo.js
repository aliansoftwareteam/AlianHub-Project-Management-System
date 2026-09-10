const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const socketEmitter = require('../../event/socketEventEmitter');
const audit = require('./agentAudit');
const budget = require('./budget');
const scope = require('./scope');

// Undo replays the inverse action and logs it as the person who pressed Undo.
// Only the descriptors perform() wrote are understood; anything else is
// "not undoable" rather than a guess. Every path that undoes — a single audit
// row, a proposal, a whole run — goes through undoStateOf, so the company's
// undo window and the caller's project visibility are checked exactly once.

const HOUR_MS = 60 * 60 * 1000;
const REASON = Object.freeze({
    WINDOW_PASSED: 'undo_window_passed', NOT_VISIBLE: 'project_not_visible', ALREADY_UNDONE: 'already_undone', NOT_UNDOABLE: 'not_undoable',
    PENDING: 'action_pending', FAILED: 'action_failed',
});
const MESSAGES = {
    [REASON.WINDOW_PASSED]: (s) => `The undo window closed at ${s.undoUntil}.`,
    [REASON.NOT_VISIBLE]: () => 'You cannot see the project this action touched.',
    [REASON.ALREADY_UNDONE]: () => 'Already undone.',
    [REASON.NOT_UNDOABLE]: () => 'not undoable',
    [REASON.PENDING]: () => 'The action was never confirmed in the audit log; reconcile it by hand before undoing.',
    [REASON.FAILED]: () => 'The action failed and changed nothing.',
};
const STATUS_OF = { [REASON.WINDOW_PASSED]: 410, [REASON.NOT_VISIBLE]: 403 };

const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };

const setTask = async (companyId, taskId, set, unset) => {
    const update = { $set: set };
    if (unset) update.$unset = unset;
    const updated = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS, data: [{ _id: oid(taskId) }, update, { returnDocument: 'after' }],
    }, 'findOneAndUpdate');
    if (updated) socketEmitter.emit('update', { type: 'update', module: 'task', data: updated, updatedFields: set, actor: { kind: 'user' }, depth: 1 });
    return updated;
};

const inverses = {
    async comment(companyId, u) {
        await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMMENTS, data: [{ _id: oid(u.commentId) }, { $set: { isDeleted: true } }] }, 'updateOne');
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
        await setTask(companyId, u.taskId, { sprintId: u.previous.sprintId, sprintArray: u.previous.sprintArray });
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
    async 'timelog.stop'(companyId, u) {
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TIMESHEET,
            data: [{ _id: oid(u.timesheetId) }, { $set: { LogTimeDuration: 0, startTimeTracker: u.previousStart, LogEndTime: u.previousStart } }],
        }, 'updateOne');
        return { timesheetId: u.timesheetId, resumed: true };
    },
    async page(companyId, u) {
        await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PAGES, data: [{ _id: oid(u.pageId) }, { $set: { deletedStatusKey: 1 } }] }, 'updateOne');
        return { pageId: u.pageId, deleted: true };
    },
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
    if (!projectId || !full.visibleProjectIds.includes(projectId)) return state(REASON.NOT_VISIBLE, undoUntil, projectId);
    if (Date.now() >= undoUntil.getTime()) return state(REASON.WINDOW_PASSED, undoUntil, projectId);
    return state('', undoUntil, projectId);
};

const messageOf = (state) => (MESSAGES[state.reason] || (() => state.reason))(state);
const statusOf = (reason) => STATUS_OF[reason] || 409;

const refuse = async (companyId, actor, state, { entityType, entityId, action, ip }) => {
    if (state.reason === REASON.WINDOW_PASSED || state.reason === REASON.NOT_VISIBLE) {
        await audit.recordRefusal(companyId, actor, { action: action || 'undo', reason: state.reason, params: { undoUntil: state.undoUntil }, entityType, entityId, path: '', ip });
    }
    return { ok: false, reason: state.reason, message: messageOf(state), undoUntil: state.undoUntil, status: statusOf(state.reason) };
};

/* Undo one audit row. Returns { ok, reason, result } or, refused, { ok:false, reason, message, undoUntil, status }. */
const undoAuditRow = async (companyId, row, actor, ip, ctx) => {
    if (!row || row.action !== audit.ACTION_DONE) return { ok: false, reason: 'Only agent actions can be undone.' };
    const state = await undoStateOf(companyId, row, actor, ctx);
    if (!state.undoable) return refuse(companyId, actor, state, { entityType: row.entityType, entityId: row.entityId, action: row.meta && row.meta.action, ip });
    const u = row.meta.undo;
    const result = await inverses[u.kind](companyId, u);
    await audit.markUndone(companyId, row._id, actor.userId);
    await audit.recordUndo(companyId, actor, { originalId: row._id, action: row.meta.action, entityType: row.entityType, entityId: row.entityId, ip });
    return { ok: true, reason: '', result, undoUntil: state.undoUntil };
};

module.exports = { undoAuditRow, undoStateOf, undoContext, undoUntilOf, messageOf, statusOf, refuse, isUndoable, inverses, REASON };
