const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const socketEmitter = require('../../event/socketEventEmitter');
const { commentThreadAccess, refuseThread } = require('./helpers/threadAccess');
const { threadOf, canPostToThread } = require('./helpers/threadWriteAccess');
const { taskIdMatch } = require('./helpers/taskIdMatch');
const T = require('./helpers/commentThreads');
const { notifyAssigned } = require('./helpers/threadNotices');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const isId = (value) => OBJECT_ID.test(String(value || ''));
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const MAX_ITEMS = 100;
const MAX_MINE = 50;

const companyOf = (req) => String(req.headers.companyid || '');
const refuse = (res, statusCode, message) => res.status(statusCode).json({ status: false, statusText: message, message });
const notFound = (res) => refuse(res, 404, 'Comment not found.');
const failed = (res, name, error) => {
    logger.error(`[comments] ${name}: ${(error && error.message) || error}`);
    return res.status(500).json({ status: false, statusText: 'Internal Server Error', message: 'Internal Server Error' });
};

const emitChange = (companyId, comment) => socketEmitter.emit('update', { type: 'update', data: comment, updatedFields: {}, module: 'comments', companyId });

/* The comment an assignment or resolve acts on, provided the caller can read its task. */
const readableTaskComment = async (companyId, uid, id) => {
    const comment = await T.findComment(companyId, id);
    if (!T.isTaskComment(comment)) return null;
    const access = await commentThreadAccess(companyId, uid, threadOf(comment));
    return access.allowed ? comment : null;
};

const saveChange = (companyId, comment, change) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.COMMENTS,
    data: [{ _id: oid(comment._id), isDeleted: { $ne: true } }, change, { returnDocument: 'after' }],
}, 'findOneAndUpdate');

exports.listReplies = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const { parentId } = req.query;
        if (!isId(parentId)) return refuse(res, 400, 'A valid parent comment id is required.');
        const parent = await T.findComment(companyId, parentId);
        if (!T.isTaskComment(parent)) return notFound(res);
        const access = await commentThreadAccess(companyId, req.uid, threadOf(parent));
        if (!access.allowed) return refuseThread(res, access);
        const replies = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.COMMENTS,
            data: [{ parentId: oid(parent._id), isDeleted: { $ne: true } }, {}, { sort: { createdAt: 1, _id: 1 } }],
        }, 'find');
        return res.status(200).json({ status: true, data: replies || [] });
    } catch (error) {
        return failed(res, 'listReplies', error);
    }
};

exports.assign = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const { id } = req.body || {};
        const assigneeId = req.body && req.body.assigneeId ? String(req.body.assigneeId) : '';
        if (!isId(id)) return refuse(res, 400, 'A valid comment id is required.');
        const comment = await T.findComment(companyId, id);
        if (!T.isTaskComment(comment)) return notFound(res);
        const access = await canPostToThread(companyId, req.uid, threadOf(comment));
        if (!access.allowed) return notFound(res);
        if (!(await T.canReassign(companyId, req.uid, comment))) return refuse(res, 403, 'Only the people on this comment or an admin can change who it is assigned to.');
        if (assigneeId && !(await T.canBeAssigned(companyId, assigneeId, comment))) {
            return refuse(res, 400, 'Assign the comment to an active member who can see this task.');
        }
        const updated = await saveChange(companyId, comment, T.assignmentChange(req.uid, assigneeId));
        if (!updated) return notFound(res);
        emitChange(companyId, updated);
        if (assigneeId && assigneeId !== String(comment.assigneeId || '')) {
            notifyAssigned(companyId, updated, req.uid).catch((error) => logger.error(`[comments] assign notice failed: ${error.message}`));
        }
        return res.status(200).json({ status: true, data: updated });
    } catch (error) {
        return failed(res, 'assign', error);
    }
};

exports.resolve = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const { id } = req.body || {};
        const resolved = req.body && req.body.resolved !== false && req.body.resolved !== 'false';
        if (!isId(id)) return refuse(res, 400, 'A valid comment id is required.');
        const comment = await readableTaskComment(companyId, req.uid, id);
        if (!comment) return notFound(res);
        if (!comment.assigneeId) return refuse(res, 400, 'Only an assigned comment can be resolved.');
        if (!(await T.canResolve(companyId, req.uid, comment))) return refuse(res, 403, 'Only the assignee, the person who assigned it or an admin can resolve this comment.');
        const updated = await saveChange(companyId, comment, T.resolutionChange(req.uid, resolved));
        if (!updated) return notFound(res);
        emitChange(companyId, updated);
        return res.status(200).json({ status: true, data: updated });
    } catch (error) {
        return failed(res, 'resolve', error);
    }
};

exports.actionItems = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const { projectId, sprintId, taskId } = req.query;
        if (!isId(taskId)) return refuse(res, 400, 'A valid task id is required.');
        const access = await commentThreadAccess(companyId, req.uid, { projectId, sprintId, taskId });
        if (!access.allowed) return refuseThread(res, access);
        const items = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.COMMENTS,
            data: [
                { projectId: oid(projectId), taskId: taskIdMatch(taskId), ...T.OPEN_ASSIGNED },
                {},
                { sort: { createdAt: 1, _id: 1 }, limit: MAX_ITEMS },
            ],
        }, 'find');
        return res.status(200).json({ status: true, data: items || [] });
    } catch (error) {
        return failed(res, 'actionItems', error);
    }
};

const threadKey = (comment) => Object.values(threadOf(comment)).join('|');

/* Open comments assigned to the caller, limited to the tasks they can still open. */
exports.assignedToMe = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const uid = String(req.uid || '');
        if (!isId(uid)) return refuse(res, 400, 'An authenticated user is required.');
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.COMMENTS,
            data: [{ ...T.OPEN_ASSIGNED, assigneeId: uid }, {}, { sort: { assignedAt: -1, _id: -1 }, limit: MAX_ITEMS }],
        }, 'find');
        const decisions = new Map();
        const visible = [];
        for (const row of (rows || []).filter(T.isTaskComment)) {
            const key = threadKey(row);
            if (!decisions.has(key)) decisions.set(key, (await commentThreadAccess(companyId, uid, threadOf(row))).allowed);
            if (decisions.get(key)) visible.push(row);
            if (visible.length === MAX_MINE) break;
        }
        const taskIds = [...new Set(visible.map((row) => String(row.taskId)))].map(oid);
        const tasks = taskIds.length ? await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [{ _id: { $in: taskIds } }, { TaskName: 1, TaskKey: 1 }],
        }, 'find') : [];
        const names = new Map((tasks || []).map((task) => [String(task._id), task]));
        const data = visible.map((row) => {
            const plain = typeof row.toObject === 'function' ? row.toObject() : row;
            const task = names.get(String(row.taskId)) || {};
            return { ...plain, taskName: task.TaskName || '', taskKey: task.TaskKey || '' };
        });
        return res.status(200).json({ status: true, data });
    } catch (error) {
        return failed(res, 'assignedToMe', error);
    }
};
