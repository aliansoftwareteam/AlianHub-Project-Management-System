import { noticeTextOf } from "@/views/Ai/rateAlerts";
import { escapeHtml, notificationHtml } from "@/utils/notificationHtml";

/* The HTML the Inbox shows for one row. Rows the app writes from data (AI alerts, agent client approval requests)
 * are rendered from an i18n string whose values are escaped; every other row's stored message goes through
 * notificationHtml, and only then are @mentions marked up. */
export const renderNotice = (it, { t, changeText }) => {
    const data = it.changeData && typeof it.changeData === "object" ? it.changeData : {};
    if (it.changeType === "agent_alert") {
        const notice = noticeTextOf(data);
        if (notice) return escapeHtml(t(notice.key, { ...notice.params, agent: notice.params.agent || t("AiAlerts.unnamed_agent") }));
    }
    if (it.changeType === "oauth_client_approval") {
        return escapeHtml(t("Inbox.oauth_client_approval", { client: data.clientName || t("Inbox.unnamed_client") }));
    }
    return changeText(notificationHtml(it.message || ""));
};
