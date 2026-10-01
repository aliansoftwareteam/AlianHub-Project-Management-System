const config = require('../../../Config/config');
const {
    Notification_key: { COMMENT_REPLY, COMMENT_ASSIGNED, DOC_COMMENT_MENTION, DOC_COMMENT_REPLY },
    TemplateType,
} = require('../../../Config/notificationKey');
const { formatNotificationDate } = require('../../../utils/dateHelpers');
const { AI_ACTOR } = require('../../Comments/helpers/aiActor');
const { CHAT_THREAD_REPLY, chatThreadPath } = require('../../Comments/helpers/chatThreads');
const { subjectText, urlSegment } = require('../../Template/emailText');
const mainTemplate = require('../../Template/emailTemplate/main-template');
const { docLink } = require('./docMentionEmail');

const COMMENT_NOTICE_TEXT = {
    [COMMENT_REPLY]: { headline: (who, task) => `${who} replied to a comment on ${task}` },
    [COMMENT_ASSIGNED]: { headline: (who, task) => `${who} assigned you a comment on ${task}` },
    [DOC_COMMENT_MENTION]: { headline: (who, doc) => `${who} mentioned you in a comment on ${doc}` },
    [DOC_COMMENT_REPLY]: { headline: (who, doc) => `${who} replied to a comment on ${doc}` },
};
const DOC_KEYS = [DOC_COMMENT_MENTION, DOC_COMMENT_REPLY];
const SOMEONE = 'Someone';
const A_TASK = 'a task';
const A_DOC = 'a doc';
const CHAT = 'Chat';
const chatThreadHeadline = (who) => `${who} replied in a chat thread`;
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

/* The doc open with its comments showing, where the Inbox opens it from. */
const docCommentLink = ({ companyId, changeData = {} }) => `${docLink(companyId, changeData.pageId)}?comment=${urlSegment(changeData.commentId)}`;

const placeOf = (notification, projects, tasks) => {
    if (notification.changeType === CHAT_THREAD_REPLY) {
        return { headline: chatThreadHeadline, header: { title: CHAT, description: [] }, link: `${config.WEBURL}/#/${chatThreadPath(notification)}` };
    }
    if (DOC_KEYS.includes(notification.key)) {
        const title = (notification.changeData && notification.changeData.pageTitle) || '';
        return { label: subjectText(title) || A_DOC, header: { title, description: [] }, link: docCommentLink(notification) };
    }
    const project = projects[0] || {};
    const task = tasks[0] || {};
    return {
        label: [task.TaskKey, task.TaskName].map(subjectText).filter(Boolean).join(' ') || A_TASK,
        header: { title: project.ProjectName, description: trailOf(task) },
        link: commentLink(notification),
    };
};

/* Returns null when nothing should be sent: the AI answers under a shared author id and is nobody a person hears from. */
const commentNoticeEmail = ({ notification = {}, projects = [], tasks = [] }) => {
    const text = COMMENT_NOTICE_TEXT[notification.key];
    if (!text || String(notification.userId || '') === AI_ACTOR) return null;
    const place = placeOf(notification, projects, tasks);
    const who = subjectText(notification.User_Employee_Name) || SOMEONE;
    const headline = place.headline ? place.headline(who) : text.headline(who, place.label);
    const html = mainTemplate.renderHTML({
        templateHeader: place.header,
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
        action_url: place.link,
        action_label: OPEN_COMMENT,
    });
    return { subject: subjectText(`${config.APP_NAME} - ${headline}`), html };
};

module.exports = { COMMENT_NOTICE_TEXT, isCommentNotice, commentLink, docCommentLink, commentNoticeEmail };
