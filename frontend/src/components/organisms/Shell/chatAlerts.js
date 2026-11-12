export const CHAT_ROUTE = "chat_project_channel";

/* Whether the page shows the conversation a notice is about. */
export function isLookingAt(route, notice) {
    if (!route || route.name !== CHAT_ROUTE || !notice) return false;
    const params = route.params || {};
    return String(params.pid) === String(notice.projectId) && String(params.sid) === String(notice.conversationId);
}

/* The words a pop-up and a browser notification show for a notice. */
export function describeNotice(notice, { t, senderName = "", image = "" }) {
    const sender = notice.senderName || senderName || t("Chat.alert_someone");
    const title = notice.channel && notice.channelName
        ? t("Chat.alert_in_channel", { name: sender, channel: notice.channelName })
        : sender;
    let body = notice.preview || "";
    if (!body) body = notice.fileName ? t("Chat.alert_sent_file", { name: notice.fileName }) : t("Chat.alert_new_message");
    return {
        commentId: notice.commentId,
        projectId: notice.projectId,
        conversationId: notice.conversationId,
        sender,
        image,
        title,
        body,
    };
}
