const socketEmitter = require('../../../event/socketEventEmitter');
const { getNotificationSetttings } = require('../../notification/prepare-notification-data/settings-controllerV2');
const { employeeNameOf } = require('../../Tasks/helpers/taskWriteFields');
const { CHANNEL_THREAD } = require('./conversation');
const { commentPlainText } = require('./plainText');
const { threadOf } = require('./threadWriteAccess');

const PREVIEW_LENGTH = 140;
const MESSAGE_CREATE = 'message_create';
const CHAT_NOTICE_EVENT = 'chatNotice';

const previewOf = (message) => {
    const text = commentPlainText(message).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH - 1)}…` : text;
};

/* A person without a settings document has every chat notice on, as the settings page shows them. */
const browserTurnedOff = async (companyId, userIds) => {
    const settings = await getNotificationSetttings(userIds, companyId).catch(() => []);
    return new Set((settings || []).filter((row) => {
        const items = row && row.chat && Array.isArray(row.chat.items) ? row.chat.items : [];
        const item = items.find((entry) => entry && entry.key === MESSAGE_CREATE);
        return Boolean(item) && item.browser === false;
    }).map((row) => String(row.userId)));
};

/* `reached` is what bumpUnreadCounts resolves with: a notice goes to exactly the people whose unread count rose,
 * and only for a conversation kept in a chat space, the one place the Chat page opens. */
const tellChatRecipients = async (companyId, comment, reached) => {
    if (!reached || !reached.chatSpace || !Array.isArray(reached.userIds) || !reached.userIds.length) return;
    const thread = threadOf(comment);
    const channel = thread.taskId === CHANNEL_THREAD;
    const [senderName, turnedOff] = await Promise.all([
        employeeNameOf(String(comment.userId)).catch(() => ''),
        browserTurnedOff(companyId, reached.userIds),
    ]);
    const notice = {
        commentId: String(comment._id),
        projectId: thread.projectId,
        sprintId: thread.sprintId,
        conversationId: channel ? thread.sprintId : thread.taskId,
        channel,
        channelName: channel ? reached.channelName || '' : '',
        senderId: String(comment.userId),
        senderName: senderName || '',
        preview: previewOf(comment.message),
        fileName: comment.mediaOriginalName ? String(comment.mediaOriginalName) : '',
    };
    socketEmitter.emit(CHAT_NOTICE_EVENT, {
        companyId: String(companyId),
        deliveries: reached.userIds.map((userId) => ({ userId: String(userId), notice: { ...notice, browser: !turnedOff.has(String(userId)) } })),
    });
};

module.exports = { tellChatRecipients, previewOf, CHAT_NOTICE_EVENT };
