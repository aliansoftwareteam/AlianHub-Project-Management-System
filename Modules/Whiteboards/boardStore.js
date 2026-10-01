const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const socketEmitter = require('../../event/socketEventEmitter');
const { BoardRefused, MAX_SNAPSHOTS, applyPatch, reasonToKeep, snapshotOf } = require('./boardRules');

const SOCKET_MODULE = 'whiteboards';
const TASK_FIELDS = { ProjectID: 1, sprintId: 1, mainChat: 1, AssigneeUserId: 1, TaskName: 1, TaskKey: 1 };
const WITHOUT_HISTORY = { history: 0 };

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const crud = (companyId, data, method) => MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.WHITEBOARDS, data }, method);
const liveBoardOf = (projectId, sprintId) => ({ projectId: oid(projectId), sprintId: oid(sprintId), deletedStatusKey: 0 });

const readBoard = (companyId, projectId, sprintId) => crud(companyId, [liveBoardOf(projectId, sprintId), WITHOUT_HISTORY, { lean: true }], 'findOne');

/* The live tasks of this list among the cards' tasks, by id. A task that was deleted or moved to another list is
 * absent, so its card is neither shown nor kept. */
const tasksOnBoard = async (companyId, projectId, sprintId, elements) => {
    const ids = [...new Set((elements || []).map((element) => element.taskId).filter(Boolean))];
    if (!ids.length) return new Map();
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [{ _id: { $in: ids.map(oid) }, deletedStatusKey: { $ne: 1 } }, TASK_FIELDS, { lean: true }],
    }, 'find');
    return new Map((rows || [])
        .filter((task) => String(task.ProjectID) === String(projectId) && String(task.sprintId) === String(sprintId))
        .map((task) => [String(task._id), task]));
};

const announce = (companyId, projectId, sprintId, board) => socketEmitter.emit('update', {
    type: 'update',
    module: SOCKET_MODULE,
    companyId: String(companyId),
    projectId: String(projectId),
    sprintId: String(sprintId),
    boardId: String(board._id),
    revision: board.revision,
});

/* The write names the revision it read, so of two saves made on one revision only the first lands. */
const replaceScene = async ({ companyId, projectId, sprintId, uid, board, elements, kept, now }) => {
    const written = await crud(companyId, [
        { ...liveBoardOf(projectId, sprintId), revision: board.revision },
        {
            $set: { elements, revision: board.revision + 1, updatedBy: String(uid), savedAt: now, ...(kept ? { historyKeptAt: now } : {}) },
            ...(kept ? { $push: { history: { $each: [kept], $slice: -MAX_SNAPSHOTS } } } : {}),
        },
        { new: true, projection: WITHOUT_HISTORY, lean: true },
    ], 'findOneAndUpdate');
    if (!written) return null;
    announce(companyId, projectId, sprintId, written);
    return written;
};

const startBoard = async (companyId, projectId, sprintId, uid) => {
    try {
        await crud(companyId, [
            liveBoardOf(projectId, sprintId),
            { $setOnInsert: { elements: [], revision: 0, history: [], createdBy: String(uid) } },
            { upsert: true },
        ], 'updateOne');
    } catch (error) {
        if (error && error.code !== 11000) throw error;
    }
    return readBoard(companyId, projectId, sprintId);
};

const conflictWith = async (companyId, projectId, sprintId) => ({ conflict: true, board: await readBoard(companyId, projectId, sprintId) });

/* `admits(task)` says whether the writer may open a task; a new card is refused for a task they may not. */
const saveBoard = async ({ companyId, projectId, sprintId, uid, patch, admits = () => true, now = new Date() }) => {
    const current = await readBoard(companyId, projectId, sprintId);
    const revision = current ? current.revision : 0;
    if (patch.baseRevision !== revision) return { conflict: true, board: current };

    const held = new Set(((current && current.elements) || []).map((element) => element.id));
    const next = applyPatch(current ? current.elements : [], patch);
    const tasks = await tasksOnBoard(companyId, projectId, sprintId, next);
    const strangers = next.filter((element) => !held.has(element.id) && !(tasks.has(element.taskId) && admits(tasks.get(element.taskId))));
    if (strangers.length) throw new BoardRefused('upsert.taskId', 'A card must stand for a task in this list.');
    const elements = next.filter((element) => tasks.has(element.taskId));

    const board = current || await startBoard(companyId, projectId, sprintId, uid);
    if (!board || board.revision !== revision) return { conflict: true, board };
    const reason = reasonToKeep({ board, uid, patch, now });
    const written = await replaceScene({ companyId, projectId, sprintId, uid, board, elements, kept: reason ? snapshotOf(board, reason) : null, now });
    return written ? { saved: true, board: written } : conflictWith(companyId, projectId, sprintId);
};

const historyOf = async (companyId, projectId, sprintId) => {
    const board = await crud(companyId, [liveBoardOf(projectId, sprintId), { history: 1, revision: 1, elements: 1, updatedBy: 1, savedAt: 1 }, { lean: true }], 'findOne');
    return { board, history: (board && board.history) || [] };
};

const listHistory = async (companyId, projectId, sprintId) => (await historyOf(companyId, projectId, sprintId)).history
    .map((entry) => ({ revision: entry.revision, savedBy: entry.savedBy, savedAt: entry.savedAt, cards: (entry.elements || []).length, reason: entry.reason }))
    .sort((a, b) => b.revision - a.revision);

const restoreBoard = async ({ companyId, projectId, sprintId, uid, revision, now = new Date() }) => {
    const { board, history } = await historyOf(companyId, projectId, sprintId);
    const wanted = history.find((entry) => entry.revision === revision);
    if (!board || !wanted) return { missing: true };
    const tasks = await tasksOnBoard(companyId, projectId, sprintId, wanted.elements);
    const elements = (wanted.elements || []).filter((element) => tasks.has(element.taskId));
    const reason = reasonToKeep({ board, uid, now, restoring: true });
    const written = await replaceScene({ companyId, projectId, sprintId, uid, board, elements, kept: reason ? snapshotOf(board, reason) : null, now });
    return written ? { saved: true, board: written } : conflictWith(companyId, projectId, sprintId);
};

module.exports = { readBoard, saveBoard, listHistory, restoreBoard, tasksOnBoard };
