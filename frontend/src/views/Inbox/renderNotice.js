import { noticeTextOf } from "@/views/Ai/rateAlerts";
import { escapeHtml, notificationHtml } from "@/utils/notificationHtml";

const clip = (value, max = 200) => String(value === undefined || value === null ? "" : value).slice(0, max);

/* The HTML the Inbox shows for one row. Rows the app writes from data (AI alerts, agent client approval requests,
 * delegations to an outside agent) are rendered from an i18n string whose values are escaped; every other row's
 * stored message goes through notificationHtml, and only then are @mentions marked up. */
export const renderNotice = (it, { t, changeText }) => {
    const data = it.changeData && typeof it.changeData === "object" ? it.changeData : {};
    if (it.changeType === "agent_alert") {
        const notice = noticeTextOf(data);
        if (notice) return escapeHtml(t(notice.key, { ...notice.params, agent: notice.params.agent || t("AiAlerts.unnamed_agent") }));
    }
    if (it.changeType === "oauth_client_approval") {
        return escapeHtml(t("Inbox.oauth_client_approval", { client: data.clientName || t("Inbox.unnamed_client") }));
    }
    if (it.changeType === "agent_session_assigned" && data.clientName) {
        const task = [clip(data.taskKey, 40), clip(data.taskName)].filter(Boolean).join(" ");
        return escapeHtml(t("Inbox.agent_session_assigned", { agent: clip(data.clientName), task }));
    }
    return changeText(notificationHtml(it.message || ""));
};
