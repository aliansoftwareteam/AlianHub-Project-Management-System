import { noticeTextOf } from "@/views/Ai/rateAlerts";
import { escapeHtml, notificationHtml } from "@/utils/notificationHtml";
import { REPORT_KEYS } from "@/views/Ai/agentSchedule";
import { commentPlainText } from "@/utils/commentHtml";

const clip = (value, max = 200) => String(value === undefined || value === null ? "" : value).slice(0, max);
const DOC_COMMENT_KEYS = ["doc_comment_mention", "doc_comment_reply", "doc_comment_assigned"];

/* The HTML the Inbox shows for one row. Rows the app writes from data (AI alerts, agent client approval requests,
 * delegations to an outside agent, notices an automation sends) are rendered from an i18n string whose values are escaped; every other row's
 * stored message goes through notificationHtml, and only then are @mentions marked up. */
export const renderNotice = (it, { t, changeText }) => {
    const data = it.changeData && typeof it.changeData === "object" ? it.changeData : {};
    if (it.changeType === "agent_alert") {
        const notice = noticeTextOf(data);
        if (notice) return escapeHtml(t(notice.key, { ...notice.params, agent: notice.params.agent || t("AiAlerts.unnamed_agent") }));
    }
    if (it.changeType === "agent_report" && REPORT_KEYS.includes(data.report)) {
        return escapeHtml(t("Inbox.agent_report", { agent: clip(data.agentName) || t("AiAlerts.unnamed_agent"), report: t(`Ai.report_${data.report}`) }));
    }
    if (it.changeType === "oauth_client_approval") {
        return escapeHtml(t("Inbox.oauth_client_approval", { client: data.clientName || t("Inbox.unnamed_client") }));
    }
    if (it.changeType === "doc_comment" && DOC_COMMENT_KEYS.includes(it.key)) {
        return escapeHtml(t(`Inbox.${it.key}`, { doc: clip(data.pageTitle) || t("Docs.untitled"), text: clip(commentPlainText(it.message), 160) }));
    }
    if (it.changeType === "agent_session_assigned" && data.clientName) {
        const task = [clip(data.taskKey, 40), clip(data.taskName)].filter(Boolean).join(" ");
        return escapeHtml(t("Inbox.agent_session_assigned", { agent: clip(data.clientName), task }));
    }
    if (it.changeType === "automation_notify" && data.text) {
        return escapeHtml(t("Inbox.automation_notify", { rule: clip(data.ruleName) || t("Inbox.automation_unnamed"), text: clip(data.text, 1000) }));
    }
    if (it.changeType === "doc_mention") {
        const doc = escapeHtml(t("Inbox.doc_mention", { doc: clip(data.pageTitle) || t("Docs.untitled") }));
        return it.message ? `${doc}: ${escapeHtml(it.message)}` : doc;
    }
    if (it.changeType === "doc_shared") {
        return escapeHtml(t("Inbox.doc_shared", { doc: clip(data.pageTitle) || t("Docs.untitled") }));
    }
    return changeText(notificationHtml(it.message || ""));
};
