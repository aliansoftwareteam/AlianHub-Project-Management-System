jest.mock('../Config/config', () => ({
    APP_NAME: 'AlianHub',
    WEBURL: 'https://hub.example.test',
    APIURL: 'https://api.example.test/',
    USERPROFILEBUCKET: 'bucket',
}));
jest.mock('../Config/aws.js', () => ({ region: 'eu-central-1' }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/service.js', () => ({ SendNotificationEmail: jest.fn((subject, html, to, isHtml, cb) => cb({ status: true })) }));
jest.mock('../Modules/notification/notification-middleware/sendNotification', () => ({ sendFCMNotification: jest.fn(async () => ({ ok: true })) }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => []) }));

const mongoose = require('mongoose');
const { SendNotificationEmail } = require('../Modules/service.js');
const { sendFCMNotification } = require('../Modules/notification/notification-middleware/sendNotification');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { sendEmailHandlerSingle } = require('../Modules/notification/sendEmail/controllerV2');
const push = require('../Modules/notification/notification-middleware/push-controllerV2');
const inbox = require('../Modules/Inbox/controller');
const { notificationsSchema, notificationsSettingsSchema } = require('../utils/mongo-handler/createSchema');

const ids = {
    company: '6f0000000000000000000c01',
    page: '6f0000000000000000000d01',
    actor: '6f0000000000000000000a01',
    receiver: '6f0000000000000000000a02',
};

const noticeOf = (extra = {}) => ({
    _id: '6f0000000000000000000e01',
    notificationId: '6f0000000000000000000e02',
    key: 'doc_mention',
    type: 'docs',
    changeType: 'doc_mention',
    changeData: { pageId: ids.page, pageTitle: 'Launch plan' },
    notificationType: 'email',
    companyId: ids.company,
    userId: ids.actor,
    receiverID: ids.receiver,
    assigneeUsers: [ids.receiver],
    notSeen: [ids.receiver],
    uniqueId: 'u1',
    message: 'Can @Ann check the totals?',
    Employee_Email: 'receiver@example.test',
    User_Employee_Name: 'Priya Shah',
    User_Employee_profileImage: '',
    webTokens: ['token-1'],
    createdAt: new Date('2026-09-20T10:00:00Z'),
    ...extra,
});

const sentMail = () => {
    expect(SendNotificationEmail).toHaveBeenCalledTimes(1);
    const [subject, html, to] = SendNotificationEmail.mock.calls[0];
    return { subject, html, to };
};

beforeEach(() => jest.clearAllMocks());

describe('the doc mention email', () => {
    it('names who mentioned the reader and the doc', async () => {
        await sendEmailHandlerSingle({ notification: noticeOf(), companies: [], projects: [], tasks: [], comments: [] });
        const { subject, html, to } = sentMail();
        expect(subject).toBe('AlianHub - Priya Shah mentioned you in Launch plan');
        expect(to).toEqual(['receiver@example.test']);
        expect(html).toContain('Can @Ann check the totals?');
        expect(html).toContain(`href="https://hub.example.test/#/${ids.company}/pages/${ids.page}"`);
    });

    it('escapes the doc title, the actor and the line', async () => {
        await sendEmailHandlerSingle({
            notification: noticeOf({
                User_Employee_Name: '<b>Eve</b>',
                changeData: { pageId: ids.page, pageTitle: '<i>Plan</i>' },
                message: '<img src=x onerror=alert(1)>',
            }),
            companies: [], projects: [], tasks: [], comments: [],
        });
        const { html } = sentMail();
        expect(html).not.toMatch(/<b>Eve<\/b>|<i>Plan<\/i>|<img src=x/);
        expect(html).toContain('&lt;b&gt;Eve&lt;/b&gt;');
        expect(html).toContain('&lt;i&gt;Plan&lt;/i&gt;');
        expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });

    it('keeps a doc id out of the link path it cannot belong to', async () => {
        await sendEmailHandlerSingle({
            notification: noticeOf({ changeData: { pageId: '../../evil', pageTitle: 'Plan' } }),
            companies: [], projects: [], tasks: [], comments: [],
        });
        expect(SendNotificationEmail).not.toHaveBeenCalled();
    });
});

describe('the doc mention push', () => {
    it('opens the doc', async () => {
        await push.sendNotificationBody(noticeOf({ notificationType: 'push' }));
        expect(sendFCMNotification).toHaveBeenCalledTimes(1);
        const [{ notification }] = sendFCMNotification.mock.calls[0];
        expect(notification.click_action).toBe(`https://hub.example.test/#/${ids.company}/pages/${ids.page}`);
        expect(notification.title).toMatch(/Docs Notification$/);
    });
});

describe('the doc mention in the Inbox', () => {
    it('carries the doc it names, so the row can open it', async () => {
        MongoDbCrudOpration.mockImplementation(async () => [{ ...noticeOf({ notificationType: 'push' }), _id: new mongoose.Types.ObjectId() }]);
        const [row] = await inbox.__internals.readNotifications(ids.company, ids.receiver, { limit: 10 });
        expect(row.changeType).toBe('doc_mention');
        expect(row.changeData).toEqual({ pageId: ids.page, pageTitle: 'Launch plan' });
    });
});

describe('the notification schemas', () => {
    const Notice = mongoose.models.DocMentionNotice || mongoose.model('DocMentionNotice', notificationsSchema);
    const Settings = mongoose.models.DocMentionSettings || mongoose.model('DocMentionSettings', notificationsSettingsSchema);
    const withoutId = (notice) => Object.fromEntries(Object.entries(notice).filter(([field]) => field !== '_id'));

    it('accept a doc notice that belongs to no project', () => {
        expect(new Notice(withoutId(noticeOf({ notificationType: 'push' }))).validateSync()).toBeUndefined();
    });

    it('still require a project on a task notice', () => {
        expect(new Notice(withoutId(noticeOf({ type: 'tasks', key: 'task_status', notificationType: 'push' }))).validateSync().errors.projectId).toBeDefined();
    });

    it('keep the docs section of a person\'s settings', () => {
        const settings = new Settings({ userId: ids.receiver, before: {}, project: {}, tasks: {}, chat: {}, docs: { key: 'docs', items: [] } });
        expect(settings.toObject().docs).toEqual({ key: 'docs', items: [] });
    });
});
