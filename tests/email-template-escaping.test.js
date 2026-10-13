jest.mock('../Config/config', () => ({
    APP_NAME: 'AlianHub',
    WEBURL: 'https://hub.example.test',
    APIURL: 'https://api.example.test/',
    USERPROFILEBUCKET: 'bucket',
    NODEMAILER_HOST: 'smtp.example.test',
    NODEMAILER_EMAIL: 'hub@example.test',
}));
jest.mock('../Config/aws.js', () => ({ region: 'eu-central-1' }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/service.js', () => ({
    SendNotificationEmail: jest.fn((subject, html, to, isHtml, cb) => cb({ status: true })),
    SendEmail: jest.fn((subject, html, to, isHtml, cb) => cb({ status: true })),
}));
jest.mock('../Modules/notification/notification-middleware/push-controllerV2', () => ({
    removeDocument: jest.fn(async () => undefined),
    UpdateDocument: jest.fn(async () => undefined),
}));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: jest.fn(async (db, obj, op) => (op === 'findOne' ? { Employee_Email: 'owner@example.test' } : { id: 'n1' })),
}));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/notification-count/controller', () => ({ updateUnReadCommentsCountFun: jest.fn(async () => ({})) }));
jest.mock('../Modules/Agents/registry', () => ({ has: jest.fn(() => false), mayActDirectly: jest.fn(() => false) }));
jest.mock('../Modules/Agents/schedules/ownerAccess', () => ({ ownerSeesTask: jest.fn(), ownerSeesProject: jest.fn(), sharedScopeFor: jest.fn() }));

const { SendNotificationEmail, SendEmail } = require('../Modules/service.js');
const { escapeHtml } = require('../utils/escapeHtml');
const { Notification_key, ChangeTypes } = require('../Config/notificationKey');
const { sendEmailHandlerSingle } = require('../Modules/notification/sendEmail/controllerV2');
const sendInvitationMail = require('../Modules/Template/sendEmailInvitation');
const securityAlertMail = require('../Modules/Template/securityAlertMail');
const forgotPasswordMail = require('../Modules/Template/forgotPassword');
const ptoRules = require('../Modules/Pto/helpers/ptoRules');
const { reminderHtml } = require('../Modules/TimeSheet/helpers/reminderRules');
const scheduleRules = require('../Modules/ScheduledReports/helpers/scheduleRules');
const generalReminderRules = require('../Modules/GeneralReminders/generalReminderRules');
const agentDelivery = require('../Modules/Agents/schedules/delivery');

const RAW = [
    '<a href="https://evil">x</a>',
    '<img src=x onerror=alert(1)>',
    '"><script>alert(1)</script>',
];
const MENTION = '@[Sam Lee](6f0000000000000000000a09)';
const MENTION_HTML = '<b class="mentioned">@Sam Lee</b>';

const expectEscaped = (html, payload) => {
    expect(html).not.toContain(payload);
    expect(html).toContain(escapeHtml(payload));
};
const expectNoLiveMarkup = (html) => {
    expect(html).not.toMatch(/<script|<img src=x|<a href="https:\/\/evil|onerror="|onmouseover="/);
};
const expectNotDoubled = (html) => expect(html).not.toMatch(/&amp;(lt|gt|quot|#39|#039|amp);/);

const ids = {
    company: '6f0000000000000000000c01',
    project: '6f0000000000000000000701',
    sprint: '6f0000000000000000000801',
    task: '6f0000000000000000000b01',
    comment: '6f0000000000000000000d01',
};

const notificationOf = (key, extra = {}) => ({
    _id: '6f0000000000000000000e01',
    key,
    type: 'tasks',
    companyId: ids.company,
    projectId: ids.project,
    sprintId: ids.sprint,
    folderId: '',
    taskId: ids.task,
    comments_id: ids.comment,
    userId: '6f0000000000000000000a01',
    message: 'Priya mentioned you',
    Employee_Email: 'receiver@example.test',
    User_Employee_Name: 'Priya Shah',
    User_Employee_profileImage: '',
    createdAt: new Date('2026-09-20T10:00:00Z'),
    ...extra,
});

const detailsOf = (notification, { project = {}, task = {}, comments = [], withTask = true } = {}) => ({
    notification,
    companies: [],
    projects: [{ _id: ids.project, ProjectName: 'Billing', ...project }],
    tasks: withTask ? [{ _id: ids.task, TaskKey: 'BIL-42', TaskName: 'Fix totals', isParentTask: true, sprintArray: { name: 'Sprint 7' }, ...task }] : [],
    comments,
});

const send = async (details) => {
    SendNotificationEmail.mockClear();
    await sendEmailHandlerSingle(details);
    expect(SendNotificationEmail).toHaveBeenCalledTimes(1);
    const [subject, html] = SendNotificationEmail.mock.calls[0];
    return { subject, html };
};

beforeEach(() => jest.clearAllMocks());

describe('the @mention email', () => {
    const mentionMail = (message, extra = {}) => send(detailsOf(
        notificationOf(Notification_key.COMMENTS_IM_MENTIONS_IN, extra.notification),
        { comments: [{ comment_message: message }], ...extra },
    ));

    it.each(RAW)('escapes a comment stored raw: %s', async (payload) => {
        const { html } = await mentionMail(`see ${payload}`);
        expectEscaped(html, payload);
        expectNoLiveMarkup(html);
    });

    it.each(RAW)('does not escape an entity-escaped comment twice: %s', async (payload) => {
        const { html } = await mentionMail(`see ${escapeHtml(payload)}`);
        expect(html).toContain(escapeHtml(payload));
        expectNotDoubled(html);
    });

    it('still renders the mention', async () => {
        const { html } = await mentionMail(`Thanks ${MENTION} <b>now</b>`);
        expect(html).toContain(MENTION_HTML);
        expect(html).toContain('&lt;b&gt;now&lt;/b&gt;');
    });

    it.each(RAW)('escapes the project, folder, list and actor names: %s', async (payload) => {
        const { html } = await send(detailsOf(
            notificationOf(Notification_key.COMMENTS_IM_MENTIONS_IN, { User_Employee_Name: `Eve ${payload}` }),
            {
                project: { ProjectName: `Proj ${payload}` },
                task: { TaskKey: `K ${payload}`, sprintArray: { name: `List ${payload}`, folderName: `Folder ${payload}` } },
                comments: [{ comment_message: 'hi' }],
            },
        ));
        for (const label of ['Proj', 'List', 'Folder', 'Eve', 'K']) expectEscaped(html, `${label} ${payload}`);
        expectNoLiveMarkup(html);
    });

    it('keeps the profile image an image and nothing more', async () => {
        const { html } = await mentionMail('hi', { notification: { User_Employee_profileImage: 'https://img.example.test/a.png" onerror="alert(1)' } });
        expectNoLiveMarkup(html);
    });

    it('builds the open link from encoded ids', async () => {
        const { html } = await mentionMail('hi', { notification: { folderId: '"><script>alert(1)</script>', sprintId: 'a/b?c' } });
        expectNoLiveMarkup(html);
        expect(html).toContain(`/fs/${encodeURIComponent('"><script>alert(1)</script>')}/${encodeURIComponent('a/b?c')}/${ids.task}`);
    });
});

describe('update emails', () => {
    const updateMail = (key, changeType, changeData) => send(detailsOf(notificationOf(key, { changeType, changeData })));

    it.each(RAW)('escapes old and new status names: %s', async (payload) => {
        const { html } = await updateMail(Notification_key.TASK_STATUS, ChangeTypes.STATUS, {
            statusName: `Old ${payload}`, newStatusName: `New ${payload}`,
            backColor: '#1abc9c', color: '#ffffff', bgColor: 'red;" onmouseover="alert(1)', textColor: 'rgb(0, 0, 0)',
        });
        expectEscaped(html, `Old ${payload}`);
        expectEscaped(html, `New ${payload}`);
        expectNoLiveMarkup(html);
        expect(html).toContain('background-color:#1abc9c');
        expect(html).toContain('color: rgb(0, 0, 0)');
    });

    it.each(RAW)('escapes old and new task names: %s', async (payload) => {
        const { html } = await updateMail(Notification_key.TASK_NAME, ChangeTypes.NAME, { previousTaskName: `Was ${payload}`, TaskName: `Now ${payload}` });
        expectEscaped(html, `Was ${payload}`);
        expectEscaped(html, `Now ${payload}`);
        expectNoLiveMarkup(html);
    });

    it.each(RAW)('does not escape an entity-escaped description twice: %s', async (payload) => {
        const { html } = await updateMail(Notification_key.TASK_DESCRIPTION, ChangeTypes.DESCRIPTION, {
            previousDiscriptionText: escapeHtml(payload), textSimple: `raw ${payload}`,
        });
        expect(html).toContain(escapeHtml(payload));
        expectEscaped(html, `raw ${payload}`);
        expectNotDoubled(html);
        expectNoLiveMarkup(html);
    });

    it('keeps the priority icon an image and nothing more', async () => {
        const { html } = await updateMail(Notification_key.TASK_PRIORITY, ChangeTypes.PRIORITY, {
            priorityName: 'Low', newPriorityName: 'High', statusImage: 'x" onerror="alert(1)', newStatusImage: 'https://img.example.test/high.png',
        });
        expectNoLiveMarkup(html);
        expect(html).toContain('src="https://img.example.test/high.png"');
    });
});

describe('create emails', () => {
    it.each(RAW)('escapes the list and project names: %s', async (payload) => {
        const { html } = await send(detailsOf(notificationOf(Notification_key.PROJECT_SPRINT_CREATE, {
            type: 'project',
            changeType: ChangeTypes.SPRINT_CREATE,
            changeData: { sprintName: `List ${payload}`, ProjectName: `Proj ${payload}` },
        }), { project: { ProjectName: `Proj ${payload}` }, withTask: false }));
        expectEscaped(html, `List ${payload}`);
        expectEscaped(html, `Proj ${payload}`);
        expectNoLiveMarkup(html);
    });
});

describe('the plain notification email', () => {
    it('keeps the message emphasis and escapes everything else', async () => {
        const { html } = await send(detailsOf(notificationOf('some_other_key', {
            message: `<p><strong>Ann</strong> renamed it to <b>${RAW.join(' ')}</b> ${MENTION}</p>`,
        })));
        expect(html).toContain('<p><strong>Ann</strong> renamed it to <b>');
        RAW.forEach((payload) => expectEscaped(html, payload));
        expectNoLiveMarkup(html);
        expect(html).toContain(MENTION_HTML);
    });

    it('does not escape an entity-escaped message twice', async () => {
        const { html } = await send(detailsOf(notificationOf('some_other_key', { message: `<b>Ann</b> ${escapeHtml(RAW[1])}` })));
        expect(html).toContain(escapeHtml(RAW[1]));
        expectNotDoubled(html);
    });
});

describe('comment notice subjects', () => {
    it('are one line of plain text', async () => {
        const { subject } = await send(detailsOf(
            notificationOf('comment_reply', { User_Employee_Name: `Priya\n${MENTION}` }),
            { task: { TaskName: 'Fix &lt;i&gt;totals&lt;/i&gt;\r\n &amp; tax' } },
        ));
        expect(subject).toBe('AlianHub - Priya @Sam Lee replied to a comment on BIL-42 Fix <i>totals</i> & tax');
        expect(subject).not.toMatch(/&(lt|gt|amp|quot);|<b class|[\r\n]/);
    });
});

describe('account emails', () => {
    it.each(RAW)('the invitation escapes the company name: %s', (payload) => {
        const mail = sendInvitationMail('https://hub.example.test/#/invitation?token=t', `Acme ${payload}`, 'AlianHub');
        expectEscaped(mail.mail, `Acme ${payload}`);
        expectNoLiveMarkup(mail.mail);
    });

    it('the invitation subject is plain text', () => {
        const mail = sendInvitationMail('https://hub.example.test/#/invitation?token=t', 'Acme', 'Acme &amp; Co\n');
        expect(mail.subject).toBe('Acme & Co have sent you an invitation');
    });

    it.each(RAW)('the security alert escapes the user name: %s', (payload) => {
        const mail = securityAlertMail(`Eve ${payload}`, '203.0.113.9', 'AlianHub');
        expectEscaped(mail.mail, `Eve ${payload}`);
        expectNoLiveMarkup(mail.mail);
    });

    it('the reset mail escapes the address it names', () => {
        const mail = forgotPasswordMail('"><script>alert(1)</script>@example.test', 'https://hub.example.test/#/reset-password/t', 'AlianHub');
        expectEscaped(mail.mail, '"><script>alert(1)</script>@example.test');
        expectNoLiveMarkup(mail.mail);
    });
});

describe('standalone emails', () => {
    it.each(RAW)('the time-off decision escapes both names: %s', (payload) => {
        const html = ptoRules.decisionEmailHtml({ name: `Eve ${payload}`, message: `Your leave was approved by Ann ${payload}.` });
        expectEscaped(html, `Eve ${payload}`);
        expectEscaped(html, `Ann ${payload}`);
        expectNoLiveMarkup(html);
    });

    it('the time reminder escapes the name', () => {
        const html = reminderHtml('<script>alert(1)</script> Eve');
        expectEscaped(html, '<script>alert(1)</script>');
        expectNoLiveMarkup(html);
    });

    it.each(RAW)('the scheduled report does not escape an entity-escaped name twice: %s', (payload) => {
        const html = scheduleRules.reportEmailHtml({ name: escapeHtml(payload), rows: [{ label: payload, value: 1 }], total: 1 });
        expect(html).toContain(escapeHtml(payload));
        expectNotDoubled(html);
        expectNoLiveMarkup(html);
    });

    it('the scheduled report subject is plain text', () => {
        expect(scheduleRules.reportEmailSubject('Q3 &amp; Q4\n totals')).toBe('AlianHub report: Q3 & Q4 totals');
    });

    it.each(RAW)('the general reminder escapes its text once: %s', (payload) => {
        const html = generalReminderRules.reminderEmailHtml({ title: escapeHtml(payload), description: payload }, `Eve ${payload}`);
        expect(html).toContain(escapeHtml(payload));
        expectEscaped(html, `Eve ${payload}`);
        expectNotDoubled(html);
        expectNoLiveMarkup(html);
    });

    it('the general reminder subject is plain text', () => {
        expect(generalReminderRules.reminderEmailSubject({ title: 'Pay &amp; file\n taxes' })).toBe('Reminder: Pay & file taxes');
    });

    it('the agent report subject is plain text', async () => {
        await agentDelivery.deliver(ids.company, {
            run: { _id: 'r1' },
            agent: { _id: 'a1', name: 'Ops &amp; Bot\n' },
            schedule: { ownerId: '6f0000000000000000000a01', deliver: { email: true } },
            report: { title: 'Weekly &lt;digest&gt;', key: 'k', counts: {} },
            text: 'body',
        });
        expect(SendEmail).toHaveBeenCalledTimes(1);
        expect(SendEmail.mock.calls[0][0]).toBe('Weekly <digest> from Ops & Bot');
    });
});
