const config = require('../../../Config/config');
const { Notification_key: { COMMENT_REPLY, COMMENT_ASSIGNED }, TemplateType } = require('../../../Config/notificationKey');
const { escapeHtml } = require('../../../utils/escapeHtml');
const { formatNotificationDate } = require('../../../utils/dateHelpers');
const { AI_ACTOR } = require('../../Comments/helpers/aiActor');
const { commentHtml, commentPlainText } = require('../../Comments/helpers/plainText');
const mainTemplate = require('../../Template/emailTemplate/main-template');

const COMMENT_NOTICE_TEXT = {
    [COMMENT_REPLY]: { headline: (who, task) => `${who} replied to a comment on ${task}` },
    [COMMENT_ASSIGNED]: { headline: (who, task) => `${who} assigned you a comment on ${task}` },
};
const SOMEONE = 'Someone';
const A_TASK = 'a task';
const OPEN_COMMENT = 'Open comment';

const isCommentNotice = (key) => Object.prototype.hasOwnProperty.call(COMMENT_NOTICE_TEXT, key);

const oneLine = (value) => commentPlainText(value).replace(/\s+/g, ' ').trim();

const segment = (value) => encodeURIComponent(String(value || ''));

/* The same place the bell opens a comment from: the task's comment tab, scrolled to the comment. */
const commentLink = ({ companyId, projectId, folderId, sprintId, taskId, comments_id: commentId }) => {
    const list = folderId ? `fs/${segment(folderId)}/${segment(sprintId)}` : `s/${segment(sprintId)}`;
    return `${config.WEBURL}/#/${segment(companyId)}/project/${segment(projectId)}/${list}/${segment(taskId)}?detailTab=comment#${segment(commentId)}`;
};

const trailOf = (task) => {
    const list = (task && task.sprintArray) || {};
    return [
        list.folderName ? { title: commentHtml(list.folderName), showFolder: true } : null,
        list.name ? { title: commentHtml(list.name), showFolder: false } : null,
    ].filter(Boolean);
};

/* Returns null when nothing should be sent: the AI answers under a shared author id and is nobody a person hears from. */
const commentNoticeEmail = ({ notification = {}, projects = [], tasks = [] }) => {
    const text = COMMENT_NOTICE_TEXT[notification.key];
    if (!text || String(notification.userId || '') === AI_ACTOR) return null;
    const project = projects[0] || {};
    const task = tasks[0] || {};
    const who = oneLine(notification.User_Employee_Name) || SOMEONE;
    const taskLabel = [task.TaskKey, task.TaskName].map(oneLine).filter(Boolean).join(' ') || A_TASK;
    const headline = text.headline(who, taskLabel);
    const html = mainTemplate.renderHTML({
        templateHeader: { title: commentHtml(project.ProjectName), description: trailOf(task) },
        templateBody: [{
            key: TemplateType.COMMENTS,
            title: escapeHtml(headline),
            data: [{
                name: escapeHtml(who),
                profile: escapeHtml(notification.User_Employee_profileImage || ''),
                date: notification.createdAt ? escapeHtml(formatNotificationDate(notification.createdAt)) : '',
                message: commentHtml(notification.message),
            }],
        }],
        action_url: escapeHtml(commentLink(notification)),
        action_label: OPEN_COMMENT,
    });
    return { subject: `${config.APP_NAME} - ${headline}`, html };
};

module.exports = { COMMENT_NOTICE_TEXT, isCommentNotice, commentLink, commentNoticeEmail };
