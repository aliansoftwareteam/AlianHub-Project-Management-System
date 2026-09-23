const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { ACTIVE_SEAT } = require('../../../Config/seatStatus');
const { Notification_key: { COMMENTS_IM_MENTIONS_IN } } = require('../../../Config/notificationKey');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { isPerson } = require('../../Users/helpers/reportingLine');
const { activeMemberIds } = require('../../notification/activeMembers');
const { HandleBothNotification } = require('../../Tasks/helpers/handleNotification');
const { handleNotificationtFun } = require('../../notification/prepare-notification-data/controllerV2');
const { projectActor } = require('../../Project/helpers/projectHistory');
const { parseMentionIds, mentionsEveryone } = require('./parseMentions');
const { commentThreadAccess } = require('./threadAccess');
const { threadOf } = require('./threadWriteAccess');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const ACCESS_BATCH = 20;
const COPIED_COMMENT_FIELDS = [
    'message', 'mediaName', 'mediaOriginalName', 'mediaSize', 'mediaURL',
    'reply_id', 'reply_message', 'reply_type', 'reply_userId', 'reply_mediaName', 'reply_mediaOriginalName', 'reply_mediaSize', 'reply_mediaURL',
];

const companyPeople = async (companyId) => {
    const seats = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMPANY_USERS,
        data: [{ ...ACTIVE_SEAT }, { userId: 1, ghostUser: 1, isAgent: 1, isBot: 1, kind: 1, agentId: 1, apiTokenId: 1 }],
    }, 'find');
    return (seats || []).filter(isPerson).map((seat) => String(seat.userId || '')).filter(Boolean);
};

const threadReaders = async (companyId, thread, userIds) => {
    const readers = [];
    for (let start = 0; start < userIds.length; start += ACCESS_BATCH) {
        const batch = userIds.slice(start, start + ACCESS_BATCH);
        const decisions = await Promise.all(batch.map((uid) => commentThreadAccess(companyId, uid, thread).catch(() => ({ allowed: false }))));
        batch.forEach((uid, index) => { if (decisions[index].allowed) readers.push(uid); });
    }
    return readers;
};

const activeThreadReaders = async (companyId, thread, userIds) => threadReaders(companyId, thread, await activeMemberIds(companyId, userIds));

/* "everyone" means the people who can open the thread; the author is never a recipient. */
const resolveMentionIds = async (companyId, authorId, thread, message) => {
    const author = String(authorId || '');
    const named = parseMentionIds(message).filter((uid) => uid !== author);
    const everyone = mentionsEveryone(message) ? (await companyPeople(companyId)).filter((uid) => uid !== author) : [];
    if (!named.length && !everyone.length) return [];
    return activeThreadReaders(companyId, thread, [...named, ...everyone]);
};

/* A sprint channel is stored with the literal task id "default"; a thread under no project is a chat space. */
const noticeTypeOf = async (companyId, thread) => {
    if (thread.taskId === 'default') return { type: 'chat', isGroupChat: true };
    const project = OBJECT_ID.test(thread.projectId)
        ? await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: [{ _id: new mongoose.Types.ObjectId(thread.projectId) }, { _id: 1 }] }, 'findOne')
        : null;
    if (!project) return { type: 'chat', isGroupChat: false };
    return { type: OBJECT_ID.test(thread.taskId) ? 'tasks' : 'project' };
};

const folderOf = (comment) => (comment.folderId ? String(comment.folderId) : '');

const recordMentions = (companyId, comment, thread, notice, mentionIds) => {
    const copied = Object.fromEntries(COPIED_COMMENT_FIELDS
        .filter((key) => comment[key] !== undefined && comment[key] !== null)
        .map((key) => [`comment_${key}`, comment[key]]));
    return MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.MENTIONS,
        data: {
            ...copied,
            comment_type: comment.type || 'text',
            comment_id: String(comment._id),
            mentionIds,
            notSeen: mentionIds,
            userId: String(comment.userId),
            projectId: thread.projectId,
            sprintId: thread.sprintId,
            taskId: thread.taskId,
            folderId: folderOf(comment),
            type: thread.taskId ? 'task' : 'project',
            mainChat: notice.type === 'chat',
        },
    }, 'save');
};

/* Settings group each key under a notice type, so an unknown type finds no preference and sends
 * nothing. A sprint channel's chat link names the sprint, as the thread notice does. */
const notifyMentioned = (companyId, comment, thread, notice, mentionIds) => handleNotificationtFun({ body: {
    key: COMMENTS_IM_MENTIONS_IN,
    type: notice.type,
    message: comment.message || '',
    companyId,
    projectId: thread.projectId,
    ...(notice.type === 'project' ? {} : {
        taskId: thread.taskId === 'default' ? thread.sprintId : thread.taskId,
        sprintId: thread.sprintId,
        folderId: folderOf(comment),
    }),
    userId: String(comment.userId),
    assigneeUsers: mentionIds,
    notSeen: mentionIds,
    isSelected: false,
    changeType: 'mention',
    comments_id: String(comment._id),
} });

/* The mentioned members are told directly, so the thread notice leaves them out rather than repeat it. */
const notifyCommentThread = async (companyId, comment, thread, notice, mentionIds) => {
    const mentioned = new Set(mentionIds.map(String));
    await HandleBothNotification({
        type: notice.type,
        isGroupChat: notice.isGroupChat,
        companyId,
        projectId: thread.projectId,
        ...(notice.type === 'project' ? {} : { taskId: thread.taskId, sprintId: thread.sprintId, folderId: folderOf(comment) }),
        object: { key: COMMENTS_IM_MENTIONS_IN, message: comment.message || '' },
        userData: await projectActor(companyId, comment.userId),
        comments_id: String(comment._id),
        mentionUserId: mentionIds,
        keepRecipients: async (userIds) => (await activeThreadReaders(companyId, thread, userIds)).filter((uid) => !mentioned.has(String(uid))),
    });
};

/* Resolves with the failures, so one failed delivery never stops the others. */
const deliverMentions = async (companyId, comment, mentionIds) => {
    const thread = threadOf(comment);
    const notice = await noticeTypeOf(companyId, thread);
    const outcomes = await Promise.allSettled([
        recordMentions(companyId, comment, thread, notice, mentionIds),
        notifyMentioned(companyId, comment, thread, notice, mentionIds),
        notifyCommentThread(companyId, comment, thread, notice, mentionIds),
    ]);
    return outcomes.filter((outcome) => outcome.status === 'rejected').map((outcome) => outcome.reason);
};

module.exports = { resolveMentionIds, deliverMentions };
