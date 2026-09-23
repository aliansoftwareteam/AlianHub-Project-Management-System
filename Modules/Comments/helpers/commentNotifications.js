const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { ACTIVE_SEAT } = require('../../../Config/seatStatus');
const { Notification_key: { COMMENTS_IM_MENTIONS_IN } } = require('../../../Config/notificationKey');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { isPerson } = require('../../Users/helpers/reportingLine');
const { activeMemberIds } = require('../../notification/activeMembers');
const { HandleBothNotification } = require('../../Tasks/helpers/handleNotification');
const { projectActor } = require('../../Project/helpers/projectHistory');
const { parseMentionIds, mentionsEveryone } = require('./parseMentions');
const { commentThreadAccess } = require('./threadAccess');
const { threadOf } = require('./threadWriteAccess');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const ACCESS_BATCH = 20;

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

/* "everyone" means the people who can open the thread, never the author. */
const resolveMentionIds = async (companyId, authorId, thread, message) => {
    const named = parseMentionIds(message);
    const everyone = mentionsEveryone(message) ? (await companyPeople(companyId)).filter((uid) => uid !== String(authorId || '')) : [];
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

const notifyCommentThread = async (companyId, comment, mentionIds) => {
    const thread = threadOf(comment);
    const { type, isGroupChat } = await noticeTypeOf(companyId, thread);
    await HandleBothNotification({
        type,
        isGroupChat,
        companyId,
        projectId: thread.projectId,
        ...(type === 'project' ? {} : { taskId: thread.taskId, sprintId: thread.sprintId, folderId: comment.folderId ? String(comment.folderId) : '' }),
        object: { key: COMMENTS_IM_MENTIONS_IN, message: comment.message || '' },
        userData: await projectActor(companyId, comment.userId),
        comments_id: String(comment._id),
        mentionUserId: mentionIds,
        keepRecipients: (userIds) => activeThreadReaders(companyId, thread, userIds),
    });
};

module.exports = { resolveMentionIds, notifyCommentThread };
