'use strict';

const { Notification_key: { DOC_MENTION }, DOC_NOTICE_SECTION } = require('../../../Config/notificationKey');
const { activeMemberIds } = require('../../notification/activeMembers');
const { ensureDocNoticeSection } = require('../../notification/docNotices');
const notices = require('../../notification/prepare-notification-data/controllerV2');
const { canUsePage } = require('./pageAccess');
const { newUserMentions, mentionExcerpt } = require('./pageMentions');

const TITLE_MAX = 200;

const readersAmong = async (companyId, page, userIds) => {
    const members = await activeMemberIds(companyId, userIds);
    const allowed = await Promise.all(members.map((uid) => canUsePage(companyId, page, uid).catch(() => false)));
    return members.filter((uid, index) => allowed[index]);
};

/* Only those who may open the doc hear of it: the notice names it. */
const notifyMentioned = async ({ companyId, page, actorId, named: everyone, content: after }) => {
    const actor = String(actorId || '');
    const named = (everyone || []).filter((uid) => uid !== actor);
    if (!named.length || !page) return [];
    const readers = await readersAmong(companyId, page, named);
    if (!readers.length) return [];
    await ensureDocNoticeSection(companyId, readers);
    const pageTitle = String(page.title || '').slice(0, TITLE_MAX);
    await notices.handleSingleNotification({
        key: DOC_MENTION,
        type: DOC_NOTICE_SECTION.key,
        message: mentionExcerpt(after, readers[0]) || pageTitle || '@',
        companyId: String(companyId),
        projectId: page.ProjectID ? String(page.ProjectID) : undefined,
        userId: actor,
        assigneeUsers: readers,
        notSeen: readers,
        directUsers: readers,
        isSelected: false,
        changeType: DOC_MENTION,
        changeData: { pageId: String(page._id), pageTitle },
    });
    return readers;
};

const notifyNewMentions = ({ companyId, page, actorId, before, after }) => notifyMentioned({
    companyId, page, actorId, named: newUserMentions(before, after), content: after,
});

module.exports = { notifyMentioned, notifyNewMentions };
