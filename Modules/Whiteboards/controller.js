const logger = require('../../Config/loggerConfig');
const { tenantOf, TenantError } = require('../../Config/tenant');
const visibility = require('../Mcp/visibility');
const { BoardRefused, MAX_ELEMENTS, MAX_NOTES, MAX_TEXT_LENGTH, isTask, parsePatch } = require('./boardRules');
const store = require('./boardStore');
const { boardAccess } = require('./boardAccess');

const NOT_FOUND = 'Whiteboard not found.';
const FORBIDDEN = 'You do not have permission to change this whiteboard.';

const refuse = (res, statusCode, statusText, extra = {}) => res.status(statusCode).json({ status: false, statusText, message: statusText, ...extra });

/* A card's title is the task's name as stored, sent as a JSON string and never as markup. It is read for the
 * viewer on every request and is not kept on the board, so a board cannot hand a task's name to someone who may
 * not open the task: they get the card's place and nothing else. */
const presentCard = (element, task, vis) => {
    const place = { id: element.id, type: element.type, x: element.x, y: element.y, z: element.z };
    return vis.allowsTask(task)
        ? { ...place, taskId: element.taskId, title: String(task.TaskName || ''), taskKey: String(task.TaskKey || '') }
        : { ...place, withheld: true };
};

/* A note or a text goes out as stored, to everyone who can read the board. */
const present = async ({ companyId, projectId, sprintId, vis, canEdit }, board) => {
    const elements = (board && board.elements) || [];
    const tasks = await store.tasksOnBoard(companyId, projectId, sprintId, elements);
    return {
        boardId: board ? String(board._id) : null,
        revision: board ? board.revision : 0,
        elements: elements
            .filter((element) => !isTask(element) || tasks.has(element.taskId))
            .map((element) => (isTask(element) ? presentCard(element, tasks.get(element.taskId), vis) : element)),
        savedBy: (board && board.updatedBy) || null,
        savedAt: (board && board.savedAt) || null,
        canEdit,
        limits: { elements: MAX_ELEMENTS, notes: MAX_NOTES, text: MAX_TEXT_LENGTH },
    };
};

/* Runs `handler` for a caller who can open the board; anyone else is told it does not exist.
 * `viewer` is off for an answer that names no task. */
const handled = (where, handler, { write = false, viewer = true } = {}) => async (req, res) => {
    try {
        const companyId = tenantOf(req);
        const uid = String(req.uid || '');
        if (!uid) return refuse(res, 401, 'Sign in to use whiteboards.');
        const { projectId, sprintId } = req.params || {};
        const access = await boardAccess(companyId, uid, projectId, sprintId);
        if (!access.visible) return refuse(res, 404, NOT_FOUND);
        if (write && !access.canEdit) return refuse(res, 403, FORBIDDEN);
        const vis = viewer ? await visibility.forCaller({ companyId, userId: uid, projectIds: [] }) : null;
        return await handler(req, res, { companyId, uid, projectId: String(projectId), sprintId: String(sprintId), canEdit: access.canEdit, vis });
    } catch (error) {
        if (error instanceof BoardRefused) return refuse(res, error.statusCode, 'Request refused', { message: error.message, field: error.field });
        if (error instanceof TenantError) return refuse(res, error.statusCode, error.message);
        logger.error(`[whiteboards] ${where}: ${error && error.message}`);
        return refuse(res, 500, 'Something went wrong with the whiteboard.');
    }
};

const answer = async (res, ctx, result, statusText) => {
    const data = await present(ctx, result.board);
    if (result.conflict) return refuse(res, 409, 'The whiteboard changed since this save was made.', { code: 'revision_conflict', data });
    return res.status(200).json({ status: true, statusText, data });
};

exports.readBoard = handled('read', async (req, res, ctx) => {
    const board = await store.readBoard(ctx.companyId, ctx.projectId, ctx.sprintId);
    return res.status(200).json({ status: true, statusText: 'Whiteboard fetched.', data: await present(ctx, board) });
});

exports.saveBoard = handled('save', async (req, res, ctx) => {
    const patch = parsePatch(req.body);
    const result = await store.saveBoard({ ...ctx, patch, admits: (task) => ctx.vis.allowsTask(task) });
    return answer(res, ctx, result, 'Whiteboard saved.');
}, { write: true });

exports.listHistory = handled('history', async (req, res, ctx) => res.status(200).json({
    status: true,
    statusText: 'Whiteboard history fetched.',
    data: await store.listHistory(ctx.companyId, ctx.projectId, ctx.sprintId),
}), { viewer: false });

exports.restoreBoard = handled('restore', async (req, res, ctx) => {
    const { revision } = req.body || {};
    if (!Number.isInteger(revision) || revision < 1) throw new BoardRefused('revision', 'Name the earlier state by its revision.');
    const result = await store.restoreBoard({ ...ctx, revision });
    if (result.missing) return refuse(res, 404, 'That earlier state is no longer kept.');
    return answer(res, ctx, result, 'Whiteboard restored.');
}, { write: true });
