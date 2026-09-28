const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { Notification_key: { COMMENT_REPLY, COMMENT_ASSIGNED } } = require('../../../Config/notificationKey');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { activeMemberIds } = require('../../notification/activeMembers');
const { handleNotificationtFun } = require('../../notification/prepare-notification-data/controllerV2');
const { commentThreadAccess } = require('./threadAccess');
const { threadOf } = require('./threadWriteAccess');
const { ensureCommentNoticeItems } = require('./noticeItems');

const text = (value) => (value === undefined || value === null ? '' : String(value));

/* The people who may still read the thread: a live seat and the thread's own read rule. */
const readersAmong = async (companyId, thread, userIds) => {
    const active = await activeMemberIds(companyId, userIds);
    const decisions = await Promise.all(active.map((uid) => commentThreadAccess(companyId, uid, thread).catch(() => ({ allowed: false }))));
    return active.filter((uid, index) => decisions[index].allowed);
};

const noticeText = (comment) => text(comment.message) || text(comment.mediaOriginalName) || text(comment.mediaName) || '…';

const send = (companyId, key, comment, actorId, recipients) => handleNotificationtFun({ body: {
    key,
    type: 'tasks',
    message: noticeText(comment),
    companyId,
    projectId: text(comment.projectId),
    taskId: text(comment.taskId),
    sprintId: text(comment.sprintId),
    folderId: text(comment.folderId),
    userId: String(actorId),
    assigneeUsers: recipients,
    notSeen: recipients,
    directUsers: recipients,
    isSelected: false,
    changeType: key,
    comments_id: String(comment._id),
} });

const threadReplies = (companyId, parentId) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.COMMENTS,
    data: [{ parentId: new mongoose.Types.ObjectId(String(parentId)), isDeleted: { $ne: true } }, { userId: 1 }],
}, 'find');

/* The parent's author, whoever it is assigned to and everyone who replied before hear of a reply; the author of
 * the reply never does, and neither does anyone it mentions, who is told by the mention notice instead. */
const replyRecipients = async (companyId, reply, parent, mentionIds = []) => {
    const earlier = await threadReplies(companyId, parent._id);
    const skip = new Set([text(reply.userId), ...mentionIds.map(String)]);
    const named = [parent.userId, parent.assigneeId, ...(earlier || []).map((row) => row.userId)]
        .map(text).filter((id) => id && !skip.has(id));
    return readersAmong(companyId, threadOf(parent), [...new Set(named)]);
};

const notifyReply = async (companyId, reply, parent, mentionIds) => {
    const recipients = await replyRecipients(companyId, reply, parent, mentionIds);
    if (!recipients.length) return [];
    await ensureCommentNoticeItems(companyId, recipients);
    await send(companyId, COMMENT_REPLY, reply, reply.userId, recipients);
    return recipients;
};

const notifyAssigned = async (companyId, comment, actorId) => {
    const assignee = text(comment.assigneeId);
    if (!assignee || assignee === String(actorId)) return [];
    const recipients = await readersAmong(companyId, threadOf(comment), [assignee]);
    if (!recipients.length) return [];
    await ensureCommentNoticeItems(companyId, recipients);
    await send(companyId, COMMENT_ASSIGNED, comment, actorId, recipients);
    return recipients;
};

module.exports = { replyRecipients, notifyReply, notifyAssigned };
