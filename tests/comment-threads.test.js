process.env.STORAGE_TYPE = 'server';

const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => ({ handleTaskAttachmentsDuplicateFunctionality: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn(async () => ({ status: true })) }));
jest.mock('../Modules/Comments/helpers/commentNotifications', () => ({
    resolveMentionIds: jest.fn(async () => []),
    deliverMentions: jest.fn(async () => []),
}));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async (companyId, uid) => (uid === mockIds.admin ? 2 : 3)),
    isPrivileged: (role) => role === 1 || role === 2,
}));
jest.mock('../Modules/Comments/helpers/threadAccess', () => ({
    ...jest.requireActual('../Modules/Comments/helpers/threadAccess'),
    commentThreadAccess: jest.fn(async (companyId, uid, thread) => (
        String(companyId) === mockIds.company && (mockReaders[String(thread && thread.taskId)] || []).includes(String(uid))
            ? { allowed: true, match: {} }
            : { allowed: false, statusCode: 404 })),
}));

const mockIds = {
    company: '6f0000000000000000000c01',
    otherCompany: '6f0000000000000000000c02',
    project: '6f0000000000000000000701',
    sprint: '6f0000000000000000000801',
    task: '6f0000000000000000000b01',
    hiddenTask: '6f0000000000000000000b02',
    author: '6f0000000000000000000a01',
    member: '6f0000000000000000000a02',
    replier: '6f0000000000000000000a03',
    outsider: '6f0000000000000000000a04',
    admin: '6f0000000000000000000a05',
    departed: '6f0000000000000000000a06',
    agent: '6f0000000000000000000a07',
    mentioned: '6f0000000000000000000a08',
};
const mockReaders = {};

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const { removeCache } = require('../utils/commonFunctions');
const { handleNotificationtFun } = require('../Modules/notification/prepare-notification-data/controllerV2');
const { resolveMentionIds } = require('../Modules/Comments/helpers/commentNotifications');
const { save, update, getPaginatedMessages } = require('../Modules/Comments/controller');
const threads = require('../Modules/Comments/threads');
const { ensureCommentNoticeItems, forgetHealed } = require('../Modules/Comments/helpers/noticeItems');
const { holdNarrowedToken } = require('../Config/narrowedTokenRoutes');
const R = require('../Modules/Inbox/helpers/inboxRules');

const C = mockIds.company;
const oid = (id) => new mongoose.Types.ObjectId(id);

const res = () => {
    const r = { code: 200, body: null };
    r.status = (code) => { r.code = code; return r; };
    r.json = (body) => { r.body = body; return r; };
    r.send = r.json;
    return r;
};
const call = async (handler, uid, { body, query, companyId = C } = {}) => {
    const r = res();
    await handler({ headers: { companyid: companyId }, uid, body: body || {}, query: query || {}, params: {} }, r);
    return r;
};

const rows = (type) => mockDb.store[type] || [];
const comments = () => rows(SCHEMA_TYPE.COMMENTS);
const commentById = (id) => comments().find((c) => String(c._id) === String(id));
const notices = () => handleNotificationtFun.mock.calls.map(([{ body }]) => body);
const settle = () => new Promise((resolve) => setImmediate(resolve));

const seat = (userId, extra = {}) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, status: 2, ...extra });
const seedComment = (extra = {}) => mockDb.seed(SCHEMA_TYPE.COMMENTS, {
    projectId: oid(mockIds.project),
    sprintId: oid(mockIds.sprint),
    taskId: oid(mockIds.task),
    project: false,
    type: 'text',
    message: 'Please check the numbers',
    userId: mockIds.author,
    createdAt: new Date('2026-09-20T10:00:00Z'),
    ...extra,
});
const replyBody = (parentId, extra = {}) => ({ body: {
    data: {
        parentId,
        message: 'On it',
        type: 'text',
        project: false,
        objId: { projectId: mockIds.project, sprintId: mockIds.sprint, taskId: mockIds.task },
        ...extra,
    },
} });

let parent;

beforeEach(() => {
    Object.keys(mockDb.store).forEach((key) => { mockDb.store[key].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    forgetHealed();
    mockReaders[mockIds.task] = [mockIds.author, mockIds.member, mockIds.replier, mockIds.admin, mockIds.departed, mockIds.agent, mockIds.mentioned];
    mockReaders[mockIds.hiddenTask] = [mockIds.author, mockIds.admin];
    [mockIds.author, mockIds.member, mockIds.replier, mockIds.outsider, mockIds.admin, mockIds.mentioned].forEach((id) => seat(id));
    seat(mockIds.departed, { isDelete: true });
    seat(mockIds.agent, { isAgent: true });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: mockIds.sprint, projectId: oid(mockIds.project) });
    parent = seedComment();
});

describe('replies follow the parent comment', () => {
    it('are stored in the parent thread whatever thread the caller names', async () => {
        const r = await call(save, mockIds.member, replyBody(String(parent._id), {
            objId: { projectId: '6f0000000000000000000799', sprintId: '6f0000000000000000000899', taskId: mockIds.hiddenTask },
        }));
        expect(r.code).toBe(200);
        const stored = commentById(r.body.data._id);
        expect(String(stored.parentId)).toBe(String(parent._id));
        expect(String(stored.projectId)).toBe(mockIds.project);
        expect(String(stored.sprintId)).toBe(mockIds.sprint);
        expect(String(stored.taskId)).toBe(mockIds.task);
        expect(stored.userId).toBe(mockIds.member);
        expect(socketEmitter.emit).toHaveBeenCalledWith('insert', expect.objectContaining({ module: 'comments', companyId: C }));
    });

    it('are refused to someone who cannot open the parent task, even when they name a thread they can', async () => {
        const hidden = seedComment({ taskId: oid(mockIds.hiddenTask) });
        const before = comments().length;
        const r = await call(save, mockIds.member, replyBody(String(hidden._id), {
            objId: { projectId: mockIds.project, sprintId: mockIds.sprint, taskId: mockIds.task },
        }));
        expect(r.code).toBe(404);
        expect(comments()).toHaveLength(before);
    });

    it('are read only by the people who can read the parent', async () => {
        await call(save, mockIds.member, replyBody(String(parent._id), { message: 'first' }));
        await call(save, mockIds.replier, replyBody(String(parent._id), { message: 'second' }));

        const seen = await call(threads.listReplies, mockIds.author, { query: { parentId: String(parent._id) } });
        expect(seen.code).toBe(200);
        expect(seen.body.data.map((reply) => reply.message)).toEqual(['first', 'second']);

        const refused = await call(threads.listReplies, mockIds.outsider, { query: { parentId: String(parent._id) } });
        expect(refused.code).toBe(404);
        expect(refused.body.data).toBeUndefined();
    });

    it('join the first comment when they answer a reply', async () => {
        const first = await call(save, mockIds.member, replyBody(String(parent._id)));
        const nested = await call(save, mockIds.replier, replyBody(String(first.body.data._id), { message: 'nested' }));
        expect(String(commentById(nested.body.data._id).parentId)).toBe(String(parent._id));
    });

    it('need a live task comment to answer', async () => {
        const projectComment = seedComment({ taskId: undefined, sprintId: undefined, project: true });
        expect((await call(save, mockIds.member, replyBody(String(projectComment._id)))).code).toBe(400);
        const deleted = seedComment({ isDeleted: true });
        expect((await call(save, mockIds.member, replyBody(String(deleted._id)))).code).toBe(404);
        expect((await call(save, mockIds.member, replyBody('not-an-id'))).code).toBe(400);
    });

    it('stay out of the main comment list, which counts them on their parent', async () => {
        await call(save, mockIds.member, replyBody(String(parent._id)));
        await call(save, mockIds.replier, replyBody(String(parent._id)));
        const r = await call(getPaginatedMessages, mockIds.author, { query: { projectId: mockIds.project, sprintId: mockIds.sprint, taskId: mockIds.task } });
        expect(r.code).toBe(200);
        expect(r.body.data).toHaveLength(1);
        expect(r.body.data[0]).toMatchObject({ replyCount: 2 });
    });
});

describe('assigning a comment', () => {
    const assign = (uid, assigneeId, id = parent._id) => call(threads.assign, uid, { body: { id: String(id), assigneeId } });

    it('assigns it to a member who can open the task, tells them and the open clients', async () => {
        const r = await assign(mockIds.member, mockIds.replier);
        expect(r.code).toBe(200);
        expect(commentById(parent._id)).toMatchObject({ assigneeId: mockIds.replier, assignedBy: mockIds.member, resolved: false });
        expect(socketEmitter.emit).toHaveBeenCalledWith('update', expect.objectContaining({ module: 'comments', companyId: C }));
        await settle();
        expect(notices()).toHaveLength(1);
        expect(notices()[0]).toMatchObject({ key: 'comment_assigned', type: 'tasks', companyId: C, userId: mockIds.member, assigneeUsers: [mockIds.replier], taskId: mockIds.task });
    });

    it.each([
        ['someone who cannot open the task', 'outsider'],
        ['a removed member', 'departed'],
        ['an agent', 'agent'],
        ['someone outside the company', 'otherCompany'],
    ])('refuses %s', async (label, who) => {
        const r = await assign(mockIds.member, mockIds[who]);
        expect(r.code).toBe(400);
        expect(commentById(parent._id).assigneeId).toBeUndefined();
        expect(handleNotificationtFun).not.toHaveBeenCalled();
    });

    it('answers not found to a caller who cannot open the task', async () => {
        expect((await assign(mockIds.outsider, mockIds.member)).code).toBe(404);
        expect(commentById(parent._id).assigneeId).toBeUndefined();
    });

    it('lets only the people on it or an admin change who holds it', async () => {
        await assign(mockIds.author, mockIds.replier);
        expect((await assign(mockIds.member, mockIds.member)).code).toBe(403);
        expect(commentById(parent._id).assigneeId).toBe(mockIds.replier);
        expect((await assign(mockIds.admin, mockIds.member)).code).toBe(200);
        expect(commentById(parent._id).assigneeId).toBe(mockIds.member);
        expect((await assign(mockIds.member, '')).code).toBe(200);
        expect(commentById(parent._id).assigneeId).toBeUndefined();
    });

    it('cannot be set or cleared through a plain save or edit', async () => {
        const saved = await call(save, mockIds.member, { body: { data: {
            message: 'new', type: 'text', project: false, assigneeId: mockIds.member, resolved: true,
            objId: { projectId: mockIds.project, sprintId: mockIds.sprint, taskId: mockIds.task },
        } } });
        const stored = commentById(saved.body.data._id);
        expect(stored.assigneeId).toBeUndefined();
        expect(stored.resolved).toBeUndefined();

        await assign(mockIds.author, mockIds.replier);
        await call(update, mockIds.author, { body: { id: String(parent._id), data: { message: 'edited', assigneeId: mockIds.author, resolved: true, parentId: String(stored._id) } } });
        expect(commentById(parent._id)).toMatchObject({ message: 'edited', assigneeId: mockIds.replier, resolved: false });
        expect(commentById(parent._id).parentId).toBeUndefined();
    });
});

describe('resolving an assigned comment', () => {
    const resolve = (uid, resolved = true) => call(threads.resolve, uid, { body: { id: String(parent._id), resolved } });

    beforeEach(async () => {
        await call(threads.assign, mockIds.author, { body: { id: String(parent._id), assigneeId: mockIds.replier } });
    });

    it('is open to the assignee, both ways', async () => {
        expect((await resolve(mockIds.replier)).code).toBe(200);
        expect(commentById(parent._id)).toMatchObject({ resolved: true, resolvedBy: mockIds.replier });
        expect((await resolve(mockIds.replier, false)).code).toBe(200);
        expect(commentById(parent._id).resolved).toBe(false);
        expect(commentById(parent._id).resolvedBy).toBeUndefined();
    });

    it('is open to the person who assigned it and to admins', async () => {
        expect((await resolve(mockIds.author)).code).toBe(200);
        expect((await resolve(mockIds.admin, false)).code).toBe(200);
    });

    it('is refused to other members and hidden from people who cannot open the task', async () => {
        expect((await resolve(mockIds.member)).code).toBe(403);
        expect((await resolve(mockIds.outsider)).code).toBe(404);
        expect(commentById(parent._id).resolved).toBe(false);
    });

    it('needs an assignment', async () => {
        const open = seedComment();
        expect((await call(threads.resolve, mockIds.admin, { body: { id: String(open._id) } })).code).toBe(400);
    });
});

describe('action items and the assigned list', () => {
    beforeEach(async () => {
        const second = seedComment({ message: 'second' });
        const hidden = seedComment({ taskId: oid(mockIds.hiddenTask), message: 'hidden' });
        const done = seedComment({ message: 'done' });
        mockDb.seed(SCHEMA_TYPE.TASKS, { _id: mockIds.task, TaskName: 'Launch', TaskKey: 'AH-1' });
        await call(threads.assign, mockIds.author, { body: { id: String(parent._id), assigneeId: mockIds.replier } });
        await call(threads.assign, mockIds.author, { body: { id: String(second._id), assigneeId: mockIds.member } });
        await call(threads.assign, mockIds.author, { body: { id: String(done._id), assigneeId: mockIds.replier } });
        await call(threads.resolve, mockIds.replier, { body: { id: String(done._id) } });
        mockDb.store[SCHEMA_TYPE.COMMENTS].find((c) => c._id === hidden._id).assigneeId = mockIds.replier;
    });

    it('lists the open assigned comments of a task', async () => {
        const r = await call(threads.actionItems, mockIds.member, { query: { projectId: mockIds.project, sprintId: mockIds.sprint, taskId: mockIds.task } });
        expect(r.code).toBe(200);
        expect(r.body.data.map((c) => c.message)).toEqual(['Please check the numbers', 'second']);
        expect((await call(threads.actionItems, mockIds.outsider, { query: { projectId: mockIds.project, sprintId: mockIds.sprint, taskId: mockIds.task } })).code).toBe(404);
    });

    it("lists only the caller's open comments on tasks they can still open", async () => {
        const r = await call(threads.assignedToMe, mockIds.replier);
        expect(r.code).toBe(200);
        expect(r.body.data.map((c) => c.message)).toEqual(['Please check the numbers']);
        expect(r.body.data[0]).toMatchObject({ taskName: 'Launch', taskKey: 'AH-1' });
    });

    it('reads and writes only the company named on the request', async () => {
        const r = await call(threads.assignedToMe, mockIds.replier, { companyId: mockIds.otherCompany });
        expect(r.body.data).toEqual([]);
        expect(mockDb.calls.every((c) => [C, mockIds.otherCompany].includes(c.companyId))).toBe(true);
        const foreign = await call(threads.resolve, mockIds.replier, { body: { id: String(parent._id) }, companyId: mockIds.otherCompany });
        expect(foreign.code).toBe(404);
    });
});

describe('reply notices', () => {
    it('reach the parent author, the assignee and earlier repliers who can still read the thread', async () => {
        await call(threads.assign, mockIds.author, { body: { id: String(parent._id), assigneeId: mockIds.member } });
        await call(save, mockIds.departed, replyBody(String(parent._id)));
        await call(save, mockIds.mentioned, replyBody(String(parent._id)));
        await settle();
        handleNotificationtFun.mockClear();
        resolveMentionIds.mockResolvedValueOnce([mockIds.mentioned]);

        await call(save, mockIds.replier, replyBody(String(parent._id), { message: `@[M](${mockIds.mentioned}) done` }));
        await settle();
        const sent = notices().filter((n) => n.key === 'comment_reply');
        expect(sent).toHaveLength(1);
        expect(sent[0].assigneeUsers.sort()).toEqual([mockIds.author, mockIds.member].sort());
        expect(sent[0]).toMatchObject({ type: 'tasks', userId: mockIds.replier, taskId: mockIds.task, directUsers: sent[0].assigneeUsers });
    });

    it('are not sent for a comment that is not a reply', async () => {
        await call(save, mockIds.member, { body: { data: { message: 'top', type: 'text', project: false, objId: { projectId: mockIds.project, sprintId: mockIds.sprint, taskId: mockIds.task } } } });
        await settle();
        expect(notices().filter((n) => n.key === 'comment_reply')).toHaveLength(0);
    });

    it('bring older settings documents the new preferences, switched on, once', async () => {
        const older = mockDb.seed(SCHEMA_TYPE.NOTIFICATIONS_SETTINGS, { userId: mockIds.author, tasks: { key: 'tasks', items: [{ key: 'task_status', browser: true }] } });
        await ensureCommentNoticeItems(C, [mockIds.author]);
        await ensureCommentNoticeItems(C, [mockIds.author]);
        expect(older.tasks.items.map((i) => i.key)).toEqual(['task_status', 'comment_reply', 'comment_assigned', 'doc_comment_mention', 'doc_comment_reply']);
        expect(older.tasks.items[1]).toMatchObject({ browser: true, mobile: true, email: false });
        expect(removeCache).toHaveBeenCalledWith(`notification:${mockIds.author}:${C}`);
    });
});

describe('API tokens limited to projects', () => {
    it.each([
        ['GET', '/api/v1/comments/replies'],
        ['GET', '/api/v1/comments/action-items'],
        ['GET', '/api/v1/comments/assigned-to-me'],
        ['POST', '/api/v1/comments/assign'],
        ['POST', '/api/v1/comments/resolve'],
    ])('cannot call %s %s', (method, path) => {
        const r = res();
        const next = jest.fn();
        holdNarrowedToken({ method, originalUrl: path, apiToken: { projectIds: [mockIds.project] }, headers: { companyid: C }, query: {} }, r, next);
        expect(next).not.toHaveBeenCalled();
        expect(r.code).toBe(403);
    });
});

describe('Inbox kind "assigned"', () => {
    it('reads assigned comment notices, which updates leave out', () => {
        expect(R.KINDS).toContain('assigned');
        expect(R.kindOf({ sourceType: 'notification', key: 'comment_assigned' })).toBe('assigned');
        const assigned = R.notificationMatch('u1', { tab: 'primary', kind: 'assigned' }).$and;
        expect(assigned).toContainEqual({ key: 'comment_assigned' });
        const updates = R.notificationMatch('u1', { tab: 'primary', kind: 'update' }).$and;
        expect(updates).toContainEqual({ key: { $nin: ['general_reminder', 'comment_assigned'] } });
        expect(R.planFor('primary', 'all', 'assigned')).toMatchObject({ notifications: true, mentions: false });
    });
});
