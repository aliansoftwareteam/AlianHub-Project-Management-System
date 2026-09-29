const config = require('../../../Config/config');
const { Notification_key: { COMMENT_REPLY, COMMENT_ASSIGNED }, TemplateType } = require('../../../Config/notificationKey');
const { formatNotificationDate } = require('../../../utils/dateHelpers');
const { AI_ACTOR } = require('../../Comments/helpers/aiActor');
const { subjectText, urlSegment } = require('../../Template/emailText');
const mainTemplate = require('../../Template/emailTemplate/main-template');

const COMMENT_NOTICE_TEXT = {
    [COMMENT_REPLY]: { headline: (who, task) => `${who} replied to a comment on ${task}` },
    [COMMENT_ASSIGNED]: { headline: (who, task) => `${who} assigned you a comment on ${task}` },
};
const SOMEONE = 'Someone';
const A_TASK = 'a task';
const OPEN_COMMENT = 'Open comment';

const isCommentNotice = (key) => Object.prototype.hasOwnProperty.call(COMMENT_NOTICE_TEXT, key);

/* The same place the bell opens a comment from: the task's comment tab, scrolled to the comment. */
const commentLink = ({ companyId, projectId, folderId, sprintId, taskId, comments_id: commentId }) => {
    const list = folderId ? `fs/${urlSegment(folderId)}/${urlSegment(sprintId)}` : `s/${urlSegment(sprintId)}`;
    return `${config.WEBURL}/#/${urlSegment(companyId)}/project/${urlSegment(projectId)}/${list}/${urlSegment(taskId)}?detailTab=comment#${urlSegment(commentId)}`;
};

const trailOf = (task) => {
    const list = (task && task.sprintArray) || {};
    return [
        list.folderName ? { title: list.folderName, showFolder: true } : null,
        list.name ? { title: list.name, showFolder: false } : null,
    ].filter(Boolean);
};

/* Returns null when nothing should be sent: the AI answers under a shared author id and is nobody a person hears from. */
const commentNoticeEmail = ({ notification = {}, projects = [], tasks = [] }) => {
    const text = COMMENT_NOTICE_TEXT[notification.key];
    if (!text || String(notification.userId || '') === AI_ACTOR) return null;
    const project = projects[0] || {};
    const task = tasks[0] || {};
    const who = subjectText(notification.User_Employee_Name) || SOMEONE;
    const taskLabel = [task.TaskKey, task.TaskName].map(subjectText).filter(Boolean).join(' ') || A_TASK;
    const headline = text.headline(who, taskLabel);
    const html = mainTemplate.renderHTML({
        templateHeader: { title: project.ProjectName, description: trailOf(task) },
        templateBody: [{
            key: TemplateType.COMMENTS,
            title: headline,
            data: [{
                name: who,
                profile: notification.User_Employee_profileImage || '',
                date: notification.createdAt ? formatNotificationDate(notification.createdAt) : '',
                message: notification.message,
            }],
        }],
        action_url: commentLink(notification),
        action_label: OPEN_COMMENT,
    });
    return { subject: subjectText(`${config.APP_NAME} - ${headline}`), html };
};

module.exports = { COMMENT_NOTICE_TEXT, isCommentNotice, commentLink, commentNoticeEmail };
