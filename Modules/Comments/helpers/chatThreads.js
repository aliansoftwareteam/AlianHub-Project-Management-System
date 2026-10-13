const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const socketEmitter = require('../../../event/socketEventEmitter');
const { taskIdMatch } = require('./taskIdMatch');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const isId = (value) => OBJECT_ID.test(String(value || ''));
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);

const CHANNEL_TASK = 'default';
const CHAT_THREAD_REPLY = 'chat_thread_reply';
/* Its own module name: the count reaches the conversation's sockets as a comment update, and nothing that listens
 * for comment edits (webhooks, the event log) takes it for one. */
const THREAD_MODULE = 'comments_thread';
const LAST_REPLIERS = 3;
const REPLY_ROWS = 'replyRows';
const PLACEHOLDER_FIELDS = [
    '_id', 'projectId', 'sprintId', 'taskId', 'folderId', 'project', 'userId', 'actorType', 'isAgent', 'agentId', 'agentName',
    'createdAt', 'updatedAt', 'replyCount', 'lastReplyAt', 'replierIds',
];

const segment = (value) => encodeURIComponent(String(value === undefined || value === null ? '' : value));

/* Where a thread reply notice opens: the conversation, with the thread beside it. */
const chatThreadPath = ({ companyId, projectId, taskId, changeData }) => (
    `${segment(companyId)}/chat/${segment(projectId)}/${segment(taskId)}?thread=${segment(changeData && changeData.threadId)}`
);

const findOne = (companyId, type, filter, fields) => MongoDbCrudOpration(companyId, { type, data: [filter, fields || {}] }, 'findOne');

const isChannelMessage = (comment) => Boolean(comment) && String(comment.taskId) === CHANNEL_TASK
    && isId(comment.projectId) && isId(comment.sprintId);

/* A channel message carries the task id 'default'; a direct message hangs off a task row marked mainChat. */
const isChatMessage = async (companyId, comment) => {
    if (isChannelMessage(comment)) return true;
    if (!comment || !isId(comment.taskId)) return false;
    const task = await findOne(companyId, SCHEMA_TYPE.TASKS, { _id: oid(comment.taskId) }, { mainChat: 1 });
    return Boolean(task) && task.mainChat === true;
};

const holdsThreads = (taskId) => isId(taskId) || String(taskId) === CHANNEL_TASK;

const replyLookup = {
    $lookup: {
        from: SCHEMA_TYPE.COMMENTS,
        localField: '_id',
        foreignField: 'parentId',
        as: REPLY_ROWS,
        pipeline: [{ $match: { isDeleted: { $ne: true } } }, { $project: { userId: 1, createdAt: 1 } }],
    },
};

const timeOf = (value) => new Date(value).getTime() || 0;

const withThreadSummary = (row) => {
    if (!row || !Array.isArray(row[REPLY_ROWS])) return row;
    const { [REPLY_ROWS]: replies, ...rest } = row;
    const newestFirst = [...replies].sort((a, b) => timeOf(b.createdAt) - timeOf(a.createdAt));
    if (!newestFirst.length) return { ...rest, replyCount: 0 };
    return {
        ...rest,
        replyCount: replies.length,
        lastReplyAt: newestFirst[0].createdAt,
        replierIds: [...new Set(newestFirst.map((reply) => String(reply.userId)))].slice(0, LAST_REPLIERS),
    };
};

/* What is left of a deleted message that still has replies: who wrote it and when, never what it said. */
const placeholder = (row) => ({
    ...Object.fromEntries(PLACEHOLDER_FIELDS.filter((key) => row[key] !== undefined).map((key) => [key, row[key]])),
    isDeleted: true,
    type: 'text',
    message: '',
});

const readable = (row) => (row && row.isDeleted === true ? placeholder(row) : row);

const hasLiveReply = async (companyId, rootId) => Boolean(await findOne(companyId, SCHEMA_TYPE.COMMENTS,
    { parentId: oid(rootId), isDeleted: { $ne: true } }, { _id: 1 }));

const keptRoot = async (companyId, id) => {
    if (!isId(id)) return null;
    const row = plain(await findOne(companyId, SCHEMA_TYPE.COMMENTS, { _id: oid(id), isDeleted: true, parentId: null }));
    if (!row || !(await isChatMessage(companyId, row)) || !(await hasLiveReply(companyId, row._id))) return null;
    return row;
};

/* The deleted messages of a conversation that still have replies. Two reads sized by how many messages were
 * deleted there, so the page query keeps its own sort, skip and limit. */
const keptRootIds = async (companyId, { projectId, sprintId, taskId }) => {
    if (!isId(projectId)) return [];
    const deleted = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMMENTS,
        data: [{
            projectId: oid(projectId), ...(isId(sprintId) ? { sprintId: oid(sprintId) } : {}), taskId: taskIdMatch(taskId),
            parentId: null, isDeleted: true,
        }, { _id: 1 }],
    }, 'find');
    if (!deleted || !deleted.length) return [];
    const replies = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMMENTS,
        data: [{ parentId: { $in: deleted.map((row) => oid(row._id)) }, isDeleted: { $ne: true } }, { parentId: 1 }],
    }, 'find');
    return [...new Set((replies || []).map((row) => String(row.parentId)))].map(oid);
};

const threadRoot = async (companyId, rootId) => {
    if (!isId(rootId)) return null;
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMMENTS,
        data: [[{ $match: { _id: oid(rootId) } }, replyLookup]],
    }, 'aggregate');
    return rows && rows[0] ? readable(withThreadSummary(rows[0])) : null;
};

const announceThread = async (companyId, rootId) => {
    const root = await threadRoot(companyId, rootId);
    if (root) socketEmitter.emit('update', { type: 'update', data: root, updatedFields: {}, module: THREAD_MODULE, companyId });
    return root;
};

module.exports = {
    CHANNEL_TASK,
    CHAT_THREAD_REPLY,
    THREAD_MODULE,
    chatThreadPath,
    isChannelMessage,
    isChatMessage,
    holdsThreads,
    replyLookup,
    withThreadSummary,
    readable,
    keptRoot,
    keptRootIds,
    announceThread,
};
