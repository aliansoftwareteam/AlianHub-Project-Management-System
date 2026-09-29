jest.mock('../Config/config', () => ({
    APP_NAME: 'AlianHub',
    WEBURL: 'https://hub.example.test',
    APIURL: 'https://api.example.test/',
    USERPROFILEBUCKET: 'bucket',
}));
jest.mock('../Config/aws.js', () => ({ region: 'eu-central-1' }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/service.js', () => ({ SendNotificationEmail: jest.fn((subject, html, to, isHtml, cb) => cb({ status: true })) }));
jest.mock('../Modules/notification/notification-middleware/push-controllerV2', () => ({
    removeDocument: jest.fn(async () => undefined),
    UpdateDocument: jest.fn(async () => undefined),
}));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => []) }));
jest.mock('../Modules/notification/activeMembers', () => ({ activeMemberIds: jest.fn(async (companyId, ids) => ids.map(String)) }));
jest.mock('../Modules/Comments/helpers/threadAccess', () => ({ commentThreadAccess: jest.fn(async () => ({ allowed: true, match: {} })) }));
jest.mock('../Modules/Comments/helpers/noticeItems', () => ({ ensureCommentNoticeItems: jest.fn(async () => undefined) }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn(async () => ({ status: true })) }));

const { SendNotificationEmail } = require('../Modules/service.js');
const { handleNotificationtFun } = require('../Modules/notification/prepare-notification-data/controllerV2');
const { sendEmailHandlerSingle } = require('../Modules/notification/sendEmail/controllerV2');
const { notifyReply } = require('../Modules/Comments/helpers/threadNotices');

const ids = {
    company: '6f0000000000000000000c01',
    project: '6f0000000000000000000701',
    folder: '6f0000000000000000000901',
    sprint: '6f0000000000000000000801',
    task: '6f0000000000000000000b01',
    comment: '6f0000000000000000000d01',
    parent: '6f0000000000000000000d02',
    actor: '6f0000000000000000000a01',
    receiver: '6f0000000000000000000a02',
    replier: '6f0000000000000000000a03',
};

const noticeOf = (key, extra = {}) => ({
    _id: '6f0000000000000000000e01',
    notificationId: '6f0000000000000000000e02',
    key,
    type: 'tasks',
    notificationType: 'email',
    companyId: ids.company,
    projectId: ids.project,
    sprintId: ids.sprint,
    folderId: '',
    taskId: ids.task,
    comments_id: ids.comment,
    userId: ids.actor,
    receiverID: ids.receiver,
    message: 'The totals on row 4 look off',
    Employee_Email: 'receiver@example.test',
    User_Employee_Name: 'Priya Shah',
    User_Employee_profileImage: '',
    createdAt: new Date('2026-09-20T10:00:00Z'),
    ...extra,
});

const detailsOf = (notification, task = {}) => ({
    notification,
    companies: [],
    projects: [{ _id: ids.project, ProjectName: 'Billing' }],
    tasks: [{ _id: ids.task, TaskKey: 'BIL-42', TaskName: 'Fix invoice totals', isParentTask: true, sprintArray: { name: 'Sprint 7' }, ...task }],
    comments: [],
});

const sentMail = () => {
    expect(SendNotificationEmail).toHaveBeenCalledTimes(1);
    const [subject, html, to] = SendNotificationEmail.mock.calls[0];
    return { subject, html, to };
};

beforeEach(() => jest.clearAllMocks());

describe.each([
    ['comment_reply', /Priya Shah replied/],
    ['comment_assigned', /Priya Shah assigned you a comment/],
])('the %s email', (key, headline) => {
    it('names who acted and the task in the subject', async () => {
        await sendEmailHandlerSingle(detailsOf(noticeOf(key)));
        const { subject, to } = sentMail();
        expect(subject).toMatch(headline);
        expect(subject).toContain('BIL-42');
        expect(subject).toContain('Fix invoice totals');
        expect(to).toEqual(['receiver@example.test']);
    });

    it('shows the comment text, the task key and title in the body', async () => {
        await sendEmailHandlerSingle(detailsOf(noticeOf(key)));
        const { html } = sentMail();
        expect(html).toMatch(headline);
        expect(html).toContain('The totals on row 4 look off');
        expect(html).toContain('BIL-42');
        expect(html).toContain('Fix invoice totals');
    });

    it('links to the task with the comment focused', async () => {
        await sendEmailHandlerSingle(detailsOf(noticeOf(key)));
        const { html } = sentMail();
        expect(html).toContain(`href="https://hub.example.test/#/${ids.company}/project/${ids.project}/s/${ids.sprint}/${ids.task}?detailTab=comment#${ids.comment}"`);
    });

    it('links through the folder when the list sits in one', async () => {
        await sendEmailHandlerSingle(detailsOf(noticeOf(key, { folderId: ids.folder }), { sprintArray: { name: 'Sprint 7', folderName: 'Q3' } }));
        const { html } = sentMail();
        expect(html).toContain(`/#/${ids.company}/project/${ids.project}/fs/${ids.folder}/${ids.sprint}/${ids.task}?detailTab=comment#${ids.comment}"`);
    });
});

describe('HTML in a comment notice email', () => {
    it('is escaped, whether the comment was stored raw or entity-escaped', async () => {
        await sendEmailHandlerSingle(detailsOf(noticeOf('comment_reply', {
            message: '<img src=x onerror=alert(1)> and &lt;script&gt;alert(2)&lt;/script&gt;',
        })));
        const { html } = sentMail();
        expect(html).not.toMatch(/<img src=x/);
        expect(html).not.toMatch(/<script/);
        expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
        expect(html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;');
        expect(html).not.toContain('&amp;lt;');
    });

    it('escapes the actor name and the task title too', async () => {
        await sendEmailHandlerSingle(detailsOf(
            noticeOf('comment_assigned', { User_Employee_Name: '<b>Eve</b>' }),
            { TaskName: '<i>Totals</i>' },
        ));
        const { html, subject } = sentMail();
        expect(html).not.toMatch(/<b>Eve<\/b>|<i>Totals<\/i>/);
        expect(html).toContain('&lt;b&gt;Eve&lt;/b&gt;');
        expect(html).toContain('&lt;i&gt;Totals&lt;/i&gt;');
        expect(subject).toContain('<i>Totals</i>');
    });

    it('keeps a mention readable', async () => {
        await sendEmailHandlerSingle(detailsOf(noticeOf('comment_reply', { message: 'Thanks @[Sam Lee](6f0000000000000000000a09)' })));
        const { html } = sentMail();
        expect(html).toContain('<b class="mentioned">@Sam Lee</b>');
    });
});

describe('an AI-authored reply', () => {
    const parent = {
        _id: ids.parent,
        userId: ids.receiver,
        projectId: ids.project,
        sprintId: ids.sprint,
        taskId: ids.task,
    };
    const aiReply = {
        _id: ids.comment,
        parentId: ids.parent,
        userId: 'ai',
        actorType: 'ai',
        message: 'The totals come from the tax table.',
        projectId: ids.project,
        sprintId: ids.sprint,
        taskId: ids.task,
    };

    it('raises no reply notice, so no email can follow', async () => {
        await expect(notifyReply(ids.company, aiReply, parent, [])).resolves.toEqual([]);
        expect(handleNotificationtFun).not.toHaveBeenCalled();
    });

    it('a person replying still notifies the parent author', async () => {
        await notifyReply(ids.company, { ...aiReply, userId: ids.replier, actorType: undefined }, parent, []);
        expect(handleNotificationtFun).toHaveBeenCalledTimes(1);
        expect(handleNotificationtFun.mock.calls[0][0].body).toMatchObject({ key: 'comment_reply', userId: ids.replier, assigneeUsers: [ids.receiver] });
    });

    it('sends no email even if a notice row names the AI as the actor', async () => {
        await sendEmailHandlerSingle(detailsOf(noticeOf('comment_reply', { userId: 'ai', User_Employee_Name: '' })));
        expect(SendNotificationEmail).not.toHaveBeenCalled();
    });
});
