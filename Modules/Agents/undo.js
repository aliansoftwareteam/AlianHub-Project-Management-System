const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const socketEmitter = require('../../event/socketEventEmitter');
const audit = require('./agentAudit');

// Undo replays the inverse action and logs it as the person who pressed Undo.
// Only the descriptors perform() wrote are understood; anything else is
// "not undoable" rather than a guess.

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

/* Undo one audit row. Returns { ok, reason, result }. */
const undoAuditRow = async (companyId, row, actor, ip) => {
    if (!row || row.action !== audit.ACTION_DONE) return { ok: false, reason: 'Only agent actions can be undone.' };
    if (row.meta && row.meta.undoneAt) return { ok: false, reason: 'Already undone.' };
    const u = row.meta && row.meta.undo;
    if (!u || !inverses[u.kind]) return { ok: false, reason: 'not undoable' };
    const result = await inverses[u.kind](companyId, u);
    await audit.markUndone(companyId, row._id, actor.userId);
    await audit.recordUndo(companyId, actor, { originalId: row._id, action: row.meta.action, entityType: row.entityType, entityId: row.entityId, ip });
    return { ok: true, reason: '', result };
};

module.exports = { undoAuditRow, isUndoable, inverses };
