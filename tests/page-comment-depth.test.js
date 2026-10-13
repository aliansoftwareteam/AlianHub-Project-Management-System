const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    ...jest.requireActual('../utils/mongo-handler/mongoQueries'),
    MongoDbCrudOpration: (...a) => mockDb.crud(...a),
}));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({
    handleSingleNotification: jest.fn(async () => []),
    handleNotificationtFun: jest.fn(async () => ({ status: true })),
}));
jest.mock('../Modules/notification/docNotices', () => ({ ensureDocNoticeSection: jest.fn(async () => undefined) }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async (companyId, uid) => {
        if (String(companyId) !== mockIds.company || !mockMembers.includes(String(uid))) return null;
        return String(uid) === mockIds.admin ? 2 : 3;
    }),
    isPrivileged: (role) => role === 1 || role === 2,
}));
jest.mock('../Config/contentAccess', () => ({
    projectAccess: jest.fn(async (companyId, uid, projectId) => {
        const visible = String(companyId) === mockIds.company && (mockProjectReaders[String(projectId)] || []).includes(String(uid));
        return { visible, canEdit: visible, statusCode: visible ? 200 : 404 };
    }),
    isCompanyMember: jest.fn(async (companyId, uid) => String(companyId) === mockIds.company && mockMembers.includes(String(uid))),
    isCompanyAdmin: jest.fn(async (companyId, uid) => String(companyId) === mockIds.company && String(uid) === mockIds.admin),
    visibleProjectIds: jest.fn(async () => []),
}));

const mockIds = {
    company: '6f0000000000000000000c01',
    project: '6f0000000000000000000701',
    page: '6f0000000000000000000e01',
    companyPage: '6f0000000000000000000e03',
    author: '6f0000000000000000000a01',
    member: '6f0000000000000000000a02',
    replier: '6f0000000000000000000a03',
    outsider: '6f0000000000000000000a04',
    admin: '6f0000000000000000000a05',
    departed: '6f0000000000000000000a06',
    agent: '6f0000000000000000000a07',
};
const mockProjectReaders = {};
const mockMembers = [];

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { Notification_key, DOC_NOTICE_SECTION } = require('../Config/notificationKey');
const socketEmitter = require('../event/socketEventEmitter');
const { handleSingleNotification } = require('../Modules/notification/prepare-notification-data/controllerV2');
const { schema } = require('../utils/mongo-handler/schema');
const comments = require('../Modules/Pages/comments');
const threads = require('../Modules/Comments/threads');
const R = require('../Modules/Inbox/helpers/inboxRules');
const { commentNoticeEmail } = require('../Modules/notification/sendEmail/commentNoticeEmail');

const C = mockIds.company;
const oid = (id) => new mongoose.Types.ObjectId(id);
const settle = () => new Promise((resolve) => setImmediate(resolve));

const res = () => {
    const r = { code: 200, body: null };
    r.status = (code) => { r.code = code; return r; };
    r.json = (body) => { r.body = body; return r; };
    r.send = r.json;
    return r;
};
const call = async (handler, uid, { params = {}, body = {}, companyId = C } = {}) => {
    const r = res();
    await handler({ headers: { companyid: companyId }, aud: C, uid, params: { id: mockIds.page, ...params }, body, query: {} }, r);
    await settle();
    return r;
};

const stored = () => mockDb.store[SCHEMA_TYPE.PAGE_COMMENTS] || [];
const storedById = (id) => stored().find((row) => String(row._id) === String(id));
const notices = () => handleSingleNotification.mock.calls.map(([body]) => body);
const emits = () => socketEmitter.emit.mock.calls.filter(([, payload]) => payload && payload.module === 'pageComments').map(([type, payload]) => ({ type, ...payload }));

const seat = (userId, extra = {}) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, status: 2, ...extra });
const seedPage = (_id, extra = {}) => mockDb.seed(SCHEMA_TYPE.PAGES, {
    _id,
    title: 'Launch plan',
    ProjectID: oid(mockIds.project),
    createdBy: mockIds.author,
    visibility: 'project',
    deletedStatusKey: 0,
    content: { blocks: { blocks: [{ id: 'intro', type: 'paragraph', data: { text: 'Intro' } }] } },
    ...extra,
});
const post = (uid, body, params) => call(comments.createComment, uid, { body, params });
const thread = async (uid = mockIds.author, body = { message: 'Please check the numbers' }) => String((await post(uid, body)).body.data._id);
const assign = (uid, commentId, assigneeId) => call(comments.assignComment, uid, { params: { commentId }, body: { assigneeId } });
const resolve = (uid, commentId, resolved = true) => call(comments.resolveComment, uid, { params: { commentId }, body: { resolved } });
const react = (uid, commentId, emoji) => call(comments.reactToComment, uid, { params: { commentId }, body: { emoji } });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((key) => { mockDb.store[key].length = 0; });
    jest.clearAllMocks();
    mockProjectReaders[mockIds.project] = [mockIds.author, mockIds.member, mockIds.replier, mockIds.admin, mockIds.departed, mockIds.agent];
    mockMembers.length = 0;
    mockMembers.push(mockIds.author, mockIds.member, mockIds.replier, mockIds.outsider, mockIds.admin, mockIds.agent);
    [mockIds.author, mockIds.member, mockIds.replier, mockIds.outsider, mockIds.admin].forEach((id) => seat(id));
    seat(mockIds.departed, { isDelete: true });
    seat(mockIds.agent, { isAgent: true });
    seedPage(mockIds.page);
    seedPage(mockIds.companyPage, { ProjectID: undefined, title: 'Handbook' });
});

describe('what the collection stores', () => {
    test('declares the assignment, reaction and file fields, so the strict schema drops none', () => {
        const declared = Object.keys(schema.pageComments);
        ['assigneeId', 'assignedBy', 'assignedAt', 'reactions', 'mediaURL', 'mediaOriginalName', 'mediaSize']
            .forEach((field) => expect(declared).toContain(field));
    });
});

describe('assigning a thread', () => {
    test('anyone who can comment assigns an open thread, and the assignee is told', async () => {
        const id = await thread();
        handleSingleNotification.mockClear();
        const r = await assign(mockIds.member, id, mockIds.replier);
        expect(r.body.status).toBe(true);
        expect(storedById(id)).toEqual(expect.objectContaining({ assigneeId: mockIds.replier, assignedBy: mockIds.member, resolved: false }));
        expect(storedById(id).assignedAt).toBeInstanceOf(Date);
        expect(r.body.data.assigneeId).toBe(mockIds.replier);

        expect(notices()).toHaveLength(1);
        expect(notices()[0]).toEqual(expect.objectContaining({
            key: Notification_key.DOC_COMMENT_ASSIGNED,
            type: 'docs',
            companyId: C,
            projectId: mockIds.project,
            userId: mockIds.member,
            assigneeUsers: [mockIds.replier],
            directUsers: [mockIds.replier],
            changeType: 'doc_comment',
            changeData: expect.objectContaining({ pageId: mockIds.page, pageTitle: 'Launch plan', commentId: id, threadId: id }),
        }));
        expect(emits().at(-1)).toEqual(expect.objectContaining({ type: 'update', companyId: C }));
        expect(emits().at(-1).data.assigneeId).toBe(mockIds.replier);
    });

    test('assigning it to yourself tells nobody', async () => {
        const id = await thread();
        handleSingleNotification.mockClear();
        expect((await assign(mockIds.member, id, mockIds.member)).body.status).toBe(true);
        expect(notices()).toEqual([]);
    });

    test('only the people on it or an admin change who holds it', async () => {
        const id = await thread();
        await assign(mockIds.author, id, mockIds.member);
        handleSingleNotification.mockClear();

        const byBystander = await assign(mockIds.replier, id, mockIds.replier);
        expect(byBystander.body.statusCode).toBe(403);
        expect(storedById(id).assigneeId).toBe(mockIds.member);

        const byAdmin = await assign(mockIds.admin, id, mockIds.replier);
        expect(byAdmin.body.status).toBe(true);
        expect(storedById(id)).toEqual(expect.objectContaining({ assigneeId: mockIds.replier, assignedBy: mockIds.admin }));
        expect(notices().map((n) => n.assigneeUsers)).toEqual([[mockIds.replier]]);
    });

    test('saving the same assignee again sends no second notice', async () => {
        const id = await thread();
        await assign(mockIds.author, id, mockIds.member);
        handleSingleNotification.mockClear();
        expect((await assign(mockIds.author, id, mockIds.member)).body.status).toBe(true);
        expect(notices()).toEqual([]);
    });

    test('an empty assignee clears the assignment', async () => {
        const id = await thread();
        await assign(mockIds.author, id, mockIds.member);
        expect((await assign(mockIds.member, id, '')).body.status).toBe(true);
        const row = storedById(id);
        expect(row.assigneeId).toBeUndefined();
        expect(row.assignedBy).toBeUndefined();
        expect(row.assignedAt).toBeUndefined();
    });

    test('only a thread is assigned, not a reply', async () => {
        const id = await thread();
        const reply = await post(mockIds.member, { message: 'Reply', parentId: id });
        expect((await assign(mockIds.member, String(reply.body.data._id), mockIds.replier)).body.statusCode).toBe(400);
    });

    test('an edit of the text cannot set or change the assignment', async () => {
        const id = await thread();
        await call(comments.updateComment, mockIds.author, { params: { commentId: id }, body: { message: 'Edited', assigneeId: mockIds.replier, reactions: [{ emoji: '👍', userId: mockIds.replier }] } });
        expect(storedById(id).assigneeId).toBeUndefined();
        expect(storedById(id).reactions || []).toEqual([]);
    });
});

describe('resolving an assigned thread', () => {
    test('is for the assignee, whoever assigned it, or an admin', async () => {
        const id = await thread();
        await assign(mockIds.author, id, mockIds.member);

        expect((await resolve(mockIds.replier, id)).body.statusCode).toBe(403);
        expect(storedById(id).resolved).toBe(false);

        expect((await resolve(mockIds.member, id)).body.status).toBe(true);
        expect(storedById(id)).toEqual(expect.objectContaining({ resolved: true, resolvedBy: mockIds.member }));
        expect((await resolve(mockIds.author, id, false)).body.status).toBe(true);
        expect((await resolve(mockIds.admin, id)).body.status).toBe(true);
    });

    test('a thread nobody holds is still resolved by anyone who can comment', async () => {
        const id = await thread();
        expect((await resolve(mockIds.replier, id)).body.status).toBe(true);
    });

    test('assigning a resolved thread again reopens it', async () => {
        const id = await thread();
        await assign(mockIds.author, id, mockIds.member);
        await resolve(mockIds.member, id);
        await assign(mockIds.author, id, mockIds.replier);
        expect(storedById(id).resolved).toBe(false);
        expect(storedById(id).resolvedBy).toBeUndefined();
    });
});

describe('reactions', () => {
    test('one per person per emoji, counted from who reacted', async () => {
        const id = await thread();
        const first = await react(mockIds.member, id, '👍');
        expect(first.body.status).toBe(true);
        expect(first.body.data.reactions).toEqual([expect.objectContaining({ emoji: '👍', userId: mockIds.member })]);
        await react(mockIds.replier, id, '👍');
        await react(mockIds.replier, id, '🎉');
        expect(storedById(id).reactions.map((r) => `${r.emoji}${r.userId}`).sort())
            .toEqual([`👍${mockIds.member}`, `👍${mockIds.replier}`, `🎉${mockIds.replier}`].sort());

        const again = await react(mockIds.member, id, '👍');
        expect(again.body.statusText).toBe('Reaction removed.');
        expect(storedById(id).reactions.filter((r) => r.emoji === '👍').map((r) => r.userId)).toEqual([mockIds.replier]);
    });

    test('the reactor is the caller, never the body', async () => {
        const id = await thread();
        await call(comments.reactToComment, mockIds.member, { params: { commentId: id }, body: { emoji: '👍', userId: mockIds.admin } });
        expect(storedById(id).reactions.map((r) => r.userId)).toEqual([mockIds.member]);
    });

    test('an emoji outside the shared set is refused', async () => {
        const id = await thread();
        expect((await react(mockIds.member, id, '🦄')).body.statusCode).toBe(400);
        expect((await react(mockIds.member, id, '<script>')).body.statusCode).toBe(400);
        expect(storedById(id).reactions || []).toEqual([]);
    });

    test('a reply takes reactions too, and the change goes out live without marking the comment edited', async () => {
        const id = await thread();
        const reply = String((await post(mockIds.member, { message: 'Reply', parentId: id })).body.data._id);
        socketEmitter.emit.mockClear();
        expect((await react(mockIds.author, reply, '🚀')).body.status).toBe(true);
        expect(storedById(reply).editedAt).toBeUndefined();
        const [sent] = emits();
        expect(sent).toEqual(expect.objectContaining({ type: 'update', companyId: C }));
        expect(sent.data.reactions).toEqual([expect.objectContaining({ emoji: '🚀', userId: mockIds.author })]);
        expect(String(sent.data.pageId)).toBe(mockIds.page);
    });
});

describe('a file on a comment', () => {
    const key = `Pages/${mockIds.page}/Comments/1234_brief.pdf`;

    test('is stored with its name and size, on a thread or a reply', async () => {
        const root = await post(mockIds.member, { message: 'See attached', mediaURL: key, mediaOriginalName: 'brief.pdf', mediaSize: 2048 });
        expect(root.body.status).toBe(true);
        expect(storedById(root.body.data._id)).toEqual(expect.objectContaining({ mediaURL: key, mediaOriginalName: 'brief.pdf', mediaSize: 2048 }));
        const reply = await post(mockIds.replier, { message: 'And this', parentId: String(root.body.data._id), mediaURL: key, mediaOriginalName: 'brief.pdf', mediaSize: 2048 });
        expect(storedById(reply.body.data._id).mediaURL).toBe(key);
    });

    test('can stand in for the text', async () => {
        const r = await post(mockIds.member, { message: '', mediaURL: key, mediaOriginalName: 'brief.pdf', mediaSize: 2048 });
        expect(r.body.status).toBe(true);
        expect(storedById(r.body.data._id).message).toBe('');
        expect((await post(mockIds.member, { message: '' })).body.statusCode).toBe(400);
    });

    test('keeps a file name that is plain text of a sane length', async () => {
        const r = await post(mockIds.member, { message: 'x', mediaURL: key, mediaOriginalName: `${'<b>'.repeat(200)}.pdf`, mediaSize: -5 });
        const row = storedById(r.body.data._id);
        expect(row.mediaOriginalName.length).toBeLessThanOrEqual(255);
        expect(row.mediaOriginalName).not.toMatch(/[<>]/);
        expect(row.mediaSize).toBe(0);
    });
});

describe('the comment limit', () => {
    const fill = (n) => {
        for (let i = 0; i < n; i += 1) {
            mockDb.seed(SCHEMA_TYPE.PAGE_COMMENTS, { pageId: oid(mockIds.page), userId: mockIds.author, message: `c${i}`, createdAt: new Date(2026, 0, 1, 0, 0, i) });
        }
    };

    test('a full doc refuses another comment in plain words', async () => {
        fill(500);
        const r = await post(mockIds.member, { message: 'One more' });
        expect(r.body.status).toBe(false);
        expect(r.body.statusCode).toBe(409);
        expect(r.body.statusText).toMatch(/500 comments/);
        expect(stored()).toHaveLength(500);
    });

    test('the list says how many a doc holds and whether it is full', async () => {
        fill(3);
        const some = await call(comments.listComments, mockIds.member);
        expect(some.body).toEqual(expect.objectContaining({ limit: 500, atLimit: false }));
        fill(497);
        const full = await call(comments.listComments, mockIds.member);
        expect(full.body).toEqual(expect.objectContaining({ limit: 500, atLimit: true }));
        expect(full.body.data).toHaveLength(500);
    });

    test('deleted comments do not count', async () => {
        fill(499);
        mockDb.seed(SCHEMA_TYPE.PAGE_COMMENTS, { pageId: oid(mockIds.page), userId: mockIds.author, message: 'gone', isDeleted: true });
        expect((await post(mockIds.member, { message: 'Fits' })).body.status).toBe(true);
    });
});

describe('who can be mentioned or assigned', () => {
    test('the people list holds the people with a live seat who can read the doc', async () => {
        const r = await call(comments.listPeople, mockIds.member);
        expect(r.body.status).toBe(true);
        expect([...r.body.data].sort()).toEqual([mockIds.author, mockIds.member, mockIds.replier, mockIds.admin].sort());
    });

    test('a company doc offers every company member who is a person', async () => {
        const r = await call(comments.listPeople, mockIds.member, { params: { id: mockIds.companyPage } });
        expect([...r.body.data].sort()).toEqual([mockIds.author, mockIds.member, mockIds.replier, mockIds.outsider, mockIds.admin].sort());
    });
});

describe('mentions of docs and tasks', () => {
    test('are kept in the comment and read as plain names in the notice', async () => {
        const message = `See @[Launch plan](doc_${mockIds.companyPage}) and @[AH-1 Fix it](task_${mockIds.project}) @[Member](${mockIds.member})`;
        const r = await post(mockIds.author, { message });
        expect(storedById(r.body.data._id).message).toBe(message);
        expect(storedById(r.body.data._id).mentionIds).toEqual([mockIds.member]);
        expect(notices()[0].message).toBe(`See @Launch plan and @AH-1 Fix it @[Member](${mockIds.member})`);
    });
});

describe('Home and Inbox', () => {
    test('the assigned list holds the open doc comments assigned to the caller, with the doc they sit on', async () => {
        const open = await thread();
        const done = await thread(mockIds.author, { message: 'Done already' });
        const theirs = await thread(mockIds.author, { message: 'For someone else' });
        await assign(mockIds.author, open, mockIds.member);
        await assign(mockIds.author, done, mockIds.member);
        await resolve(mockIds.member, done);
        await assign(mockIds.author, theirs, mockIds.replier);

        const r = await call(threads.assignedToMe, mockIds.member);
        expect(r.code).toBe(200);
        expect(r.body.data).toHaveLength(1);
        expect(r.body.data[0]).toEqual(expect.objectContaining({ kind: 'doc', pageId: mockIds.page, pageTitle: 'Launch plan', message: 'Please check the numbers', assignedBy: mockIds.author }));
        expect(String(r.body.data[0]._id)).toBe(open);
    });

    test('an assigned doc comment is an "assigned" row of the Inbox', () => {
        expect(R.kindOf({ sourceType: 'notification', key: 'doc_comment_assigned' })).toBe('assigned');
        expect(R.kindOf({ sourceType: 'notification', key: 'comment_assigned' })).toBe('assigned');
        const assigned = R.notificationMatch('u1', { tab: 'primary', kind: 'assigned' }).$and;
        expect(assigned).toContainEqual({ key: { $in: ['comment_assigned', 'doc_comment_assigned'] } });
        const updates = R.notificationMatch('u1', { tab: 'primary', kind: 'update' }).$and;
        expect(updates).toContainEqual({ key: { $nin: ['general_reminder', 'comment_assigned', 'doc_comment_assigned'] } });
    });

    test('the notice has its own switch in the Docs settings section, push on and email off', () => {
        const item = DOC_NOTICE_SECTION.items.find((entry) => entry.key === Notification_key.DOC_COMMENT_ASSIGNED);
        expect(item).toMatchObject({ browser: true, mobile: true, email: false });
    });

    test('its email names the doc and opens the comment', () => {
        const mail = commentNoticeEmail({ notification: {
            key: 'doc_comment_assigned', companyId: C, userId: mockIds.author, User_Employee_Name: 'Priya Shah', message: 'Please check',
            changeData: { pageId: mockIds.page, pageTitle: 'Launch plan', commentId: mockIds.companyPage },
        } });
        expect(mail.subject).toMatch(/Priya Shah assigned you a comment on Launch plan/);
        expect(mail.html).toContain(`/pages/${mockIds.page}?comment=${mockIds.companyPage}`);
    });
});
