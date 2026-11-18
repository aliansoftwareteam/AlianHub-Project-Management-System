const config = require('../../../Config/config');
const { Notification_key: { DOC_MENTION, DOC_SHARED }, TemplateType } = require('../../../Config/notificationKey');
const { formatNotificationDate } = require('../../../utils/dateHelpers');
const { subjectText, urlSegment } = require('../../Template/emailText');
const mainTemplate = require('../../Template/emailTemplate/main-template');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const SOMEONE = 'Someone';
const A_DOC = 'a doc';
const OPEN_DOC = 'Open doc';

const HEADLINES = {
    [DOC_MENTION]: (who, doc) => `${who} mentioned you in ${doc}`,
    [DOC_SHARED]: (who, doc) => `${who} shared ${doc} with you`,
};

const isDocMention = (key) => Object.prototype.hasOwnProperty.call(HEADLINES, key);

const docLink = (companyId, pageId) => `${config.WEBURL}/#/${urlSegment(companyId)}/pages/${urlSegment(pageId)}`;

/* Returns null when the notice names no doc it could link to. */
const docMentionEmail = ({ notification = {} }) => {
    const change = notification.changeData && typeof notification.changeData === 'object' ? notification.changeData : {};
    const pageId = String(change.pageId || '');
    if (!OBJECT_ID.test(pageId)) return null;
    const who = subjectText(notification.User_Employee_Name) || SOMEONE;
    const doc = subjectText(change.pageTitle) || A_DOC;
    const headline = (HEADLINES[notification.key] || HEADLINES[DOC_MENTION])(who, doc);
    const html = mainTemplate.renderHTML({
        templateHeader: { title: change.pageTitle || A_DOC, description: [] },
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
        action_url: docLink(notification.companyId, pageId),
        action_label: OPEN_DOC,
    });
    return { subject: subjectText(`${config.APP_NAME} - ${headline}`), html };
};

module.exports = { isDocMention, docMentionEmail, docLink };
