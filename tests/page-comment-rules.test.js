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
        return mockRoles[String(uid)] || 3;
    }),
    isPrivileged: (role) => role === 1 || role === 2,
}));
jest.mock('../Config/contentAccess', () => ({
    projectAccess: jest.fn(async (companyId, uid, projectId) => {
        const visible = String(companyId) === mockIds.company && (mockProjectReaders[String(projectId)] || []).includes(String(uid));
        return { visible, canEdit: visible, statusCode: visible ? 200 : 404 };
    }),
    isCompanyMember: jest.fn(async (companyId, uid) => String(companyId) === mockIds.company && mockMembers.includes(String(uid))),
    isCompanyAdmin: jest.fn(async (companyId, uid) => String(companyId) === mockIds.company && [1, 2].includes(mockRoles[String(uid)])),
    visibleProjectIds: jest.fn(async () => []),
}));

const mockIds = {
    company: '6f0000000000000000000c01',
    otherCompany: '6f0000000000000000000c02',
    project: '6f0000000000000000000701',
    task: '6f0000000000000000000b01',
    page: '6f0000000000000000000e01',
    privatePage: '6f0000000000000000000e02',
    otherPage: '6f0000000000000000000e03',
    trashedPage: '6f0000000000000000000e04',
    author: '6f0000000000000000000a01',
    member: '6f0000000000000000000a02',
    outsider: '6f0000000000000000000a04',
    admin: '6f0000000000000000000a05',
    departed: '6f0000000000000000000a06',
    agent: '6f0000000000000000000a07',
    owner: '6f0000000000000000000a08',
};
const mockProjectReaders = {};
const mockMembers = [];
const mockRoles = { [mockIds.owner]: 1, [mockIds.admin]: 2 };

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const { handleSingleNotification } = require('../Modules/notification/prepare-notification-data/controllerV2');
const comments = require('../Modules/Pages/comments');
const threads = require('../Modules/Comments/threads');
const { isThreadFile, isDocCommentFile, mayCarryMedia } = require('../Modules/Comments/helpers/commentFileKeys');
const { LAYOUTS } = require('../Modules/storage/downloadScope');
const { RULES } = require('../Modules/storage/changeScope');

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

const seat = (userId, extra = {}) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, status: 2, ...extra });
const seedPage = (_id, extra = {}) => mockDb.seed(SCHEMA_TYPE.PAGES, {
    _id, title: 'Launch plan', ProjectID: oid(mockIds.project), createdBy: mockIds.author, visibility: 'project', deletedStatusKey: 0, content: {}, ...extra,
});
const post = (uid, body, params) => call(comments.createComment, uid, { body, params });
const thread = async (params) => String((await post(mockIds.author, { message: 'Please check the numbers' }, params)).body.data._id);
const assign = (uid, commentId, assigneeId, params = {}) => call(comments.assignComment, uid, { params: { commentId, ...params }, body: { assigneeId } });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((key) => { mockDb.store[key].length = 0; });
    jest.clearAllMocks();
    mockProjectReaders[mockIds.project] = [mockIds.author, mockIds.member, mockIds.admin, mockIds.owner, mockIds.departed, mockIds.agent];
    mockMembers.length = 0;
    mockMembers.push(mockIds.author, mockIds.member, mockIds.outsider, mockIds.admin, mockIds.owner, mockIds.agent);
    [mockIds.author, mockIds.member, mockIds.outsider, mockIds.admin, mockIds.owner].forEach((id) => seat(id));
    seat(mockIds.departed, { isDelete: true });
    seat(mockIds.agent, { isAgent: true });
    seedPage(mockIds.page);
    seedPage(mockIds.privatePage, { visibility: 'private' });
    seedPage(mockIds.otherPage, { title: 'Roadmap' });
    seedPage(mockIds.trashedPage, { deletedStatusKey: 1 });
});

describe('who a thread can be assigned to', () => {
    test.each([
        ['a member outside the doc’s project', () => mockIds.outsider],
        ['someone who left the company', () => mockIds.departed],
        ['an agent', () => mockIds.agent],
        ['nobody the company knows', () => '6f0000000000000000000aff'],
        ['a value that is not an id', () => '{"$ne":""}'],
    ])('%s is not', async (_label, who) => {
        const id = await thread();
        handleSingleNotification.mockClear();
        const r = await assign(mockIds.author, id, who());
        expect(r.body.status).toBe(false);
        expect(r.body.statusCode).toBe(400);
        expect(storedById(id).assigneeId).toBeUndefined();
        expect(notices()).toEqual([]);
    });

    test('a private doc’s thread goes to its author alone, whoever asks', async () => {
        const id = await thread({ id: mockIds.privatePage });
        for (const who of [mockIds.member, mockIds.admin, mockIds.owner]) {
            expect((await assign(mockIds.author, id, who, { id: mockIds.privatePage })).body.statusCode).toBe(400);
        }
        expect((await assign(mockIds.author, id, mockIds.author, { id: mockIds.privatePage })).body.status).toBe(true);
    });

    test('the same answer comes back whether or not the person exists', async () => {
        const id = await thread();
        const hidden = await assign(mockIds.author, id, mockIds.outsider);
        const missing = await assign(mockIds.author, id, '6f0000000000000000000aff');
        expect(hidden.body).toEqual(missing.body);
    });
});

describe('a doc the caller cannot read', () => {
    const everyRoute = (uid, commentId, params) => [
        call(comments.listComments, uid, { params }),
        call(comments.listPeople, uid, { params }),
        post(uid, { message: 'Let me in' }, params),
        call(comments.assignComment, uid, { params: { ...params, commentId }, body: { assigneeId: uid } }),
        call(comments.reactToComment, uid, { params: { ...params, commentId }, body: { emoji: '👍' } }),
        call(comments.resolveComment, uid, { params: { ...params, commentId }, body: { resolved: true } }),
    ];

    test.each([
        ['a project doc, for a member outside the project', () => mockIds.page, () => mockIds.outsider],
        ['a private doc, for a member of its project', () => mockIds.privatePage, () => mockIds.member],
        ['a private doc, for an admin', () => mockIds.privatePage, () => mockIds.admin],
        ['a private doc, for an owner', () => mockIds.privatePage, () => mockIds.owner],
    ])('%s: answers as a doc that is not there, on every comment route', async (_label, page, who) => {
        const id = await thread({ id: page() });
        socketEmitter.emit.mockClear();
        const answers = await Promise.all(everyRoute(who(), id, { id: page() }));
        const missing = await Promise.all(everyRoute(who(), id, { id: '6f0000000000000000000eff' }));
        answers.forEach((r, index) => {
            expect(r.body.statusCode).toBe(404);
            expect(r.body).toEqual(missing[index].body);
        });
        expect(stored()).toHaveLength(1);
        expect(storedById(id)).toEqual(expect.not.objectContaining({ assigneeId: expect.anything() }));
        expect(storedById(id).reactions || []).toEqual([]);
        expect(socketEmitter.emit).not.toHaveBeenCalled();
    });

    test('a doc in the trash takes no assignment or reaction', async () => {
        const id = String(mockDb.seed(SCHEMA_TYPE.PAGE_COMMENTS, { pageId: oid(mockIds.trashedPage), userId: mockIds.author, message: 'Old' })._id);
        expect((await assign(mockIds.author, id, mockIds.member, { id: mockIds.trashedPage })).body.statusCode).toBe(404);
        expect((await call(comments.reactToComment, mockIds.author, { params: { id: mockIds.trashedPage, commentId: id }, body: { emoji: '👍' } })).body.statusCode).toBe(404);
    });

    test('a comment is reached only through its own doc', async () => {
        const id = await thread();
        const viaOther = { id: mockIds.otherPage, commentId: id };
        expect((await call(comments.assignComment, mockIds.member, { params: viaOther, body: { assigneeId: mockIds.member } })).body.statusCode).toBe(404);
        expect((await call(comments.reactToComment, mockIds.member, { params: viaOther, body: { emoji: '👍' } })).body.statusCode).toBe(404);
        expect(storedById(id).assigneeId).toBeUndefined();
    });

    test('another company reaches nothing', async () => {
        const id = await thread();
        const r = await call(comments.reactToComment, mockIds.member, { params: { commentId: id }, body: { emoji: '👍' }, companyId: mockIds.otherCompany });
        expect(r.body.status).toBe(false);
        expect(storedById(id).reactions || []).toEqual([]);
    });

    test('its people list and its mentions leave out whoever cannot read it', async () => {
        const people = await call(comments.listPeople, mockIds.member);
        expect(people.body.data).not.toEqual(expect.arrayContaining([mockIds.outsider]));
        expect(people.body.data).not.toEqual(expect.arrayContaining([mockIds.departed]));
        expect(people.body.data).not.toEqual(expect.arrayContaining([mockIds.agent]));
        expect((await call(comments.listPeople, mockIds.author, { params: { id: mockIds.privatePage } })).body.data).toEqual([mockIds.author]);

        handleSingleNotification.mockClear();
        const r = await post(mockIds.author, { message: `Hello @[Out](${mockIds.outsider}) @[Gone](${mockIds.departed})` });
        expect(storedById(r.body.data._id).mentionIds).toEqual([]);
        expect(notices()).toEqual([]);
    });
});

describe('someone who stops being able to read a doc', () => {
    test('no longer sees its comment in their assigned list, and gets no notice of it', async () => {
        const id = await thread();
        await assign(mockIds.author, id, mockIds.member);
        expect((await call(threads.assignedToMe, mockIds.member)).body.data).toHaveLength(1);

        mockProjectReaders[mockIds.project] = [mockIds.author];
        expect((await call(threads.assignedToMe, mockIds.member)).body.data).toEqual([]);

        mockDb.store[SCHEMA_TYPE.PAGES].find((page) => String(page._id) === mockIds.page).deletedStatusKey = 1;
        mockProjectReaders[mockIds.project] = [mockIds.author, mockIds.member];
        expect((await call(threads.assignedToMe, mockIds.member)).body.data).toEqual([]);
    });

    test('the assigned list is read from the caller’s company alone', async () => {
        const id = await thread();
        await assign(mockIds.author, id, mockIds.member);
        mockDb.calls.length = 0;
        const r = await call(threads.assignedToMe, mockIds.member, { companyId: mockIds.otherCompany });
        expect(r.body.data).toEqual([]);
        expect(mockDb.calls.every((c) => c.companyId === mockIds.otherCompany)).toBe(true);
    });
});

describe('the file a comment names', () => {
    const own = `Pages/${mockIds.page}/Comments/1234_brief.pdf`;

    test.each([
        ['another doc’s comment folder', `Pages/${mockIds.privatePage}/Comments/1234_secret.pdf`],
        ['the doc’s own image folder', `Pages/${mockIds.page}/0a1b2c3d4e5f60718293a4b5.png`],
        ['a task comment folder', `Project/${mockIds.project}/${mockIds.project}/${mockIds.task}/Comments/photo.png`],
        ['a project attachment', `Project/${mockIds.project}/ProjectAttachment/brief.pdf`],
        ['a clip of the writer’s own', `Clips/${mockIds.company}/${mockIds.member}/clip.webm`],
        ['a link', 'https://files.example/brief.pdf'],
        ['a folder below the comment folder', `Pages/${mockIds.page}/Comments/deeper/brief.pdf`],
        ['a path that climbs out of the folder', `Pages/${mockIds.page}/Comments/../../${mockIds.privatePage}/secret.png`],
        ['a parent folder name', `Pages/${mockIds.page}/Comments/..`],
        ['a key that only starts like the folder', `Pages/${mockIds.page}/Comments`],
    ])('is refused when it is %s', async (_label, key) => {
        const r = await post(mockIds.member, { message: 'See attached', mediaURL: key, mediaOriginalName: 'brief.pdf', mediaSize: 10 });
        expect(r.body.status).toBe(false);
        expect(r.body.statusCode).toBe(400);
        expect(stored()).toHaveLength(0);
    });

    test('is refused when it is not text', async () => {
        const r = await post(mockIds.member, { message: 'See attached', mediaURL: { $ne: '' } });
        expect(r.body.statusCode).toBe(400);
        expect(stored()).toHaveLength(0);
    });

    test('is kept when it sits in the comment folder of the doc the comment is written on', async () => {
        expect((await post(mockIds.member, { message: 'See attached', mediaURL: own })).body.status).toBe(true);
    });

    test('cannot be swapped by an edit', async () => {
        const id = String((await post(mockIds.member, { message: 'See attached', mediaURL: own })).body.data._id);
        await call(comments.updateComment, mockIds.member, { params: { commentId: id }, body: { message: 'Edited', mediaURL: `Pages/${mockIds.privatePage}/Comments/1234_secret.pdf` } });
        expect(storedById(id).mediaURL).toBe(own);
    });

    test('a doc folder is matched against the doc the write was checked on, not against the request', () => {
        expect(isDocCommentFile(mockIds.page, own)).toBe(true);
        expect(isDocCommentFile(oid(mockIds.page), own.toUpperCase().replace('PAGES', 'Pages').replace('COMMENTS', 'Comments'))).toBe(true);
        expect(isDocCommentFile(mockIds.otherPage, own)).toBe(false);
        expect(isDocCommentFile('', own)).toBe(false);
        expect(isDocCommentFile(undefined, own)).toBe(false);
    });

    test('a task comment cannot carry a doc comment’s file, even one that names a doc', async () => {
        const taskComment = { projectId: mockIds.project, sprintId: mockIds.project, taskId: mockIds.task, pageId: mockIds.page };
        expect(isThreadFile(taskComment, own)).toBe(false);
        expect(await mayCarryMedia(C, mockIds.member, taskComment, own)).toBe(false);
    });
});

describe('where a doc comment file is stored', () => {
    test('is a layout of its own, with a rule for reading, adding and removing', () => {
        const entry = LAYOUTS.find((layout) => layout.type === 'doc_comment_file');
        expect(entry.pattern.test(`Pages/${mockIds.page}/Comments/1234_brief.pdf`)).toBe(true);
        expect(entry.enforced).toBe(true);
        expect(LAYOUTS.filter((layout) => layout.pattern.test(`Pages/${mockIds.page}/Comments/1234_brief.pdf`)).map((layout) => layout.type)).toEqual(['doc_comment_file']);
        expect(Object.keys(RULES.doc_comment_file).sort()).toEqual(['remove', 'upload']);
    });
});

describe('a doc opened through a share link', () => {
    test('is rendered without reading its comments', () => {
        const dir = path.join(__dirname, '..', 'Modules', 'PublicShares');
        const sources = ['publicRenderer.js', 'controller.js', 'routes.js', 'helpers/shareAccess.js', 'helpers/shareRules.js']
            .map((file) => fs.readFileSync(path.join(dir, file), 'utf8')).join('\n');
        expect(sources).not.toMatch(/PAGE_COMMENTS|pageComments|Pages\/comments/);
    });
});
