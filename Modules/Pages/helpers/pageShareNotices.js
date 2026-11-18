'use strict';

const { Notification_key: { DOC_SHARED }, DOC_NOTICE_SECTION } = require('../../../Config/notificationKey');
const { ensureDocNoticeSection } = require('../../notification/docNotices');
const notices = require('../../notification/prepare-notification-data/controllerV2');

const TITLE_MAX = 200;

const toldOf = (page) => (Array.isArray(page && page.sharesTold) ? page.sharesTold.map(String) : []);

/* Whether naming this person is news to them: nobody is told of their own share, or told twice of one doc. */
const owedNotice = (page, actorId, userId) => String(userId) !== String(actorId || '') && !toldOf(page).includes(String(userId));

/* The project is left off the notice: a share gives the doc, not the project it is filed under. */
const notifyShared = async ({ companyId, page, actorId, userId, role }) => {
    const reader = String(userId || '');
    if (!reader || !page) return;
    await ensureDocNoticeSection(companyId, [reader]);
    const pageTitle = String(page.title || '').slice(0, TITLE_MAX);
    await notices.handleSingleNotification({
        key: DOC_SHARED,
        type: DOC_NOTICE_SECTION.key,
        message: pageTitle,
        companyId: String(companyId),
        userId: String(actorId || ''),
        assigneeUsers: [reader],
        notSeen: [reader],
        directUsers: [reader],
        isSelected: false,
        changeType: DOC_SHARED,
        changeData: { pageId: String(page._id), pageTitle, role: String(role || '') },
    });
};

module.exports = { toldOf, owedNotice, notifyShared };
