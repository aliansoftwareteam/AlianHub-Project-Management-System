import { noticeTextOf } from '@/views/Ai/rateAlerts';

export const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');

const clip = (value, max = 200) => String(value === undefined || value === null ? '' : value).slice(0, max);

const sessionNoticeOf = (changeData) => {
    if (!changeData || typeof changeData !== 'object' || !changeData.clientName) return null;
    const task = [clip(changeData.taskKey, 40), clip(changeData.taskName)].filter(Boolean).join(' ');
    return { key: 'Inbox.agent_session_assigned', params: { agent: clip(changeData.clientName), task } };
};

/* Rows whose words come from outside text (an agent's or a task's name) are built from their values through i18n and
 * escaped whole, because the Inbox renders the line as HTML. */
export const renderNotice = (it, { t, changeText }) => {
    let notice = null;
    if (it.changeType === 'agent_alert') {
        notice = noticeTextOf(it.changeData);
        if (notice) notice = { ...notice, params: { ...notice.params, agent: notice.params.agent || t('AiAlerts.unnamed_agent') } };
    }
    if (it.changeType === 'agent_session_assigned') notice = sessionNoticeOf(it.changeData);
    if (!notice) return changeText(String(it.message || ''));
    return escapeHtml(t(notice.key, notice.params));
};
