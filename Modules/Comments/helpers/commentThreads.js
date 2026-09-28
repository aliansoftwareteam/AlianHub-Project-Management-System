const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { ACTIVE_SEAT } = require('../../../Config/seatStatus');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { getRoleType, isPrivileged } = require('../../../Config/permissionGuard');
const { isPerson } = require('../../Users/helpers/reportingLine');
const { commentThreadAccess } = require('./threadAccess');
const { threadOf } = require('./threadWriteAccess');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const isId = (value) => OBJECT_ID.test(String(value || ''));
const oid = (id) => new mongoose.Types.ObjectId(String(id));

const ASSIGNMENT_FIELDS = ['assigneeId', 'assignedBy', 'assignedAt', 'resolved', 'resolvedBy', 'resolvedAt'];
const THREAD_STATE_FIELDS = ['parentId', ...ASSIGNMENT_FIELDS];
const PLACEMENT_FIELDS = ['projectId', 'sprintId', 'taskId', 'folderId', 'project'];

const INVALID = { allowed: false, statusCode: 400 };
const NOT_FOUND = { allowed: false, statusCode: 404 };

const without = (data, fields) => {
    if (!data || typeof data !== 'object') return data;
    const kept = { ...data };
    fields.forEach((field) => { delete kept[field]; });
    return kept;
};

/* Assignment only changes through its own routes, so a save or edit never carries it. */
const withoutAssignment = (data) => without(data, ASSIGNMENT_FIELDS);
const withoutThreadState = (data) => without(data, THREAD_STATE_FIELDS);

const findComment = (companyId, id) => (isId(id)
    ? MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMMENTS, data: [{ _id: oid(id), isDeleted: { $ne: true } }] }, 'findOne')
    : Promise.resolve(null));

const isTaskComment = (comment) => Boolean(comment) && isId(comment.taskId) && isId(comment.projectId);

/* A reply lives in its parent's thread: whatever thread the caller names, the ids are the parent's, so the
 * reply can be read and written by exactly the people who can read the parent. A reply to a reply joins the
 * same thread under the first comment. */
const placeReply = async (companyId, data) => {
    if (!Object.prototype.hasOwnProperty.call(data || {}, 'parentId')) return { allowed: true, data };
    const { parentId } = data;
    if (parentId === null || parentId === undefined || parentId === '') return { allowed: true, data: without(data, ['parentId']) };
    if (!isId(parentId)) return INVALID;
    const parent = await findComment(companyId, parentId);
    if (!parent) return NOT_FOUND;
    if (!isTaskComment(parent)) return INVALID;
    const placed = { ...data, parentId: parent.parentId ? oid(parent.parentId) : oid(parent._id) };
    PLACEMENT_FIELDS.forEach((field) => {
        if (parent[field] === undefined || parent[field] === null) delete placed[field];
        else placed[field] = parent[field];
    });
    return { allowed: true, data: placed, parent };
};

/* Someone a comment can be assigned to holds a live seat, is a person rather than an agent, and can open the task. */
const canBeAssigned = async (companyId, userId, comment) => {
    if (!isId(userId)) return false;
    const seat = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMPANY_USERS,
        data: [{ userId: String(userId), ...ACTIVE_SEAT }, { userId: 1, ghostUser: 1, isAgent: 1, isBot: 1, kind: 1, agentId: 1, apiTokenId: 1 }],
    }, 'findOne');
    if (!seat || !isPerson(seat)) return false;
    return (await commentThreadAccess(companyId, userId, threadOf(comment))).allowed;
};

const privileged = async (companyId, uid) => isPrivileged(await getRoleType(companyId, uid));

const same = (a, b) => Boolean(a) && String(a) === String(b);

/* An open comment can be assigned by anyone who may post in its thread; changing who holds it is for the people
 * already on it (author, assigner, assignee) and admins. */
const canReassign = async (companyId, uid, comment) => !comment.assigneeId
    || [comment.userId, comment.assignedBy, comment.assigneeId].some((id) => same(id, uid))
    || privileged(companyId, uid);

const canResolve = async (companyId, uid, comment) => Boolean(comment.assigneeId)
    && ([comment.assigneeId, comment.assignedBy].some((id) => same(id, uid)) || privileged(companyId, uid));

const assignmentChange = (uid, assigneeId, now = new Date()) => (assigneeId
    ? { $set: { assigneeId: String(assigneeId), assignedBy: String(uid), assignedAt: now, resolved: false }, $unset: { resolvedBy: '', resolvedAt: '' } }
    : { $unset: { assigneeId: '', assignedBy: '', assignedAt: '', resolved: '', resolvedBy: '', resolvedAt: '' } });

const resolutionChange = (uid, resolved, now = new Date()) => (resolved
    ? { $set: { resolved: true, resolvedBy: String(uid), resolvedAt: now } }
    : { $set: { resolved: false }, $unset: { resolvedBy: '', resolvedAt: '' } });

const OPEN_ASSIGNED = { assigneeId: { $exists: true, $nin: [null, ''] }, resolved: { $ne: true }, isDeleted: { $ne: true } };

module.exports = {
    ASSIGNMENT_FIELDS,
    THREAD_STATE_FIELDS,
    OPEN_ASSIGNED,
    withoutAssignment,
    withoutThreadState,
    findComment,
    isTaskComment,
    placeReply,
    canBeAssigned,
    canReassign,
    canResolve,
    assignmentChange,
    resolutionChange,
};
