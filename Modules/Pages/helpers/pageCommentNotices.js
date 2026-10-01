const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { ACTIVE_SEAT } = require('../../../Config/seatStatus');
const { Notification_key: { DOC_COMMENT_MENTION, DOC_COMMENT_REPLY }, DOC_NOTICE_SECTION } = require('../../../Config/notificationKey');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { isPerson } = require('../../Users/helpers/reportingLine');
const notices = require('../../notification/prepare-notification-data/controllerV2');
const { ensureDocNoticeSection } = require('../../notification/docNotices');
const { parseMentionIds } = require('../../Comments/helpers/parseMentions');
const { canUsePage } = require('./pageAccess');

const DOC_COMMENT_CHANGE = 'doc_comment';
const MAX_TITLE = 200;

const text = (value) => (value === undefined || value === null ? '' : String(value));

/* The people among these who hold a live seat and can still read the doc: nobody hears of a doc they cannot open. */
const readersOf = async (companyId, page, userIds) => {
    const ids = [...new Set(userIds.map(text).filter(Boolean))];
    if (!ids.length) return [];
    const seats = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMPANY_USERS,
        data: [{ userId: { $in: ids }, ...ACTIVE_SEAT }, { userId: 1, ghostUser: 1, isAgent: 1, isBot: 1, kind: 1, agentId: 1, apiTokenId: 1 }],
    }, 'find');
    const people = new Set((seats || []).filter(isPerson).map((seat) => text(seat.userId)));
    const candidates = ids.filter((id) => people.has(id));
    const decisions = await Promise.all(candidates.map((uid) => canUsePage(companyId, page, uid).catch(() => false)));
    return candidates.filter((uid, index) => decisions[index]);
};

const mentionedReaders = (companyId, page, authorId, message) => readersOf(
    companyId,
    page,
    parseMentionIds(message).filter((uid) => uid !== text(authorId)),
);

/* Sent as a doc notice, the way a doc mention is: the row names the doc in changeData, and carries a project only
 * when the doc has one. */
const send = async (companyId, key, page, comment, recipients) => {
    if (!recipients.length) return;
    await ensureDocNoticeSection(companyId, recipients);
    await notices.handleSingleNotification({
        key,
        type: DOC_NOTICE_SECTION.key,
        changeType: DOC_COMMENT_CHANGE,
        changeData: {
            pageId: text(page._id),
            pageTitle: text(page.title).slice(0, MAX_TITLE),
            commentId: text(comment._id),
            threadId: text(comment.parentId || comment._id),
            blockId: text(comment.blockId),
        },
        message: text(comment.message),
        companyId: text(companyId),
        projectId: page.ProjectID ? text(page.ProjectID) : undefined,
        userId: text(comment.userId),
        assigneeUsers: recipients,
        notSeen: recipients,
        directUsers: recipients,
        isSelected: false,
    });
};

const earlierRepliers = async (companyId, threadId) => {
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PAGE_COMMENTS,
        data: [{ parentId: new mongoose.Types.ObjectId(String(threadId)), isDeleted: { $ne: true } }, { userId: 1 }],
    }, 'find');
    return (rows || []).map((row) => text(row.userId));
};

/* The thread's author and everyone who replied before hear of a reply; its author never does, and neither does
 * anyone it mentions, who hears of the mention instead. */
const replyRecipients = async (companyId, page, reply, thread, mentioned) => {
    const skip = new Set([text(reply.userId), ...mentioned]);
    const named = [thread.userId, ...(await earlierRepliers(companyId, thread._id))].map(text).filter((id) => id && !skip.has(id));
    return readersOf(companyId, page, named);
};

const deliverDocCommentNotices = async (companyId, page, comment, { mentioned = [], thread = null } = {}) => {
    await send(companyId, DOC_COMMENT_MENTION, page, comment, mentioned);
    if (thread) await send(companyId, DOC_COMMENT_REPLY, page, comment, await replyRecipients(companyId, page, comment, thread, mentioned));
};

module.exports = { DOC_COMMENT_CHANGE, mentionedReaders, deliverDocCommentNotices };
