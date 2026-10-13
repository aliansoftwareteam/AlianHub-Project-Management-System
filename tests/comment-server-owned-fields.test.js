process.env.STORAGE_TYPE = 'server';

const mockWrites = [];
let mockExisting = null;
const mockRoles = {};

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: async (companyId, { data }, method) => {
        if (method === 'findOne') return mockExisting;
        if (method === 'save') { mockWrites.push({ method, row: data }); return { _id: 'c1', ...data }; }
        if (method === 'findOneAndUpdate') { mockWrites.push({ method, set: data[1].$set, options: data[2] }); return { ...mockExisting, ...data[1].$set }; }
        return null;
    },
}));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => ({ handleTaskAttachmentsDuplicateFunctionality: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async (companyId, uid) => mockRoles[uid]), isPrivileged: (role) => role === 1 || role === 2 }));
jest.mock('../Modules/Comments/helpers/threadWriteAccess', () => ({
    ...jest.requireActual('../Modules/Comments/helpers/threadWriteAccess'),
    canPostToThread: async () => ({ allowed: true }),
    canChangeComment: async () => ({ allowed: true }),
}));
jest.mock('../Modules/Comments/helpers/commentThreads', () => ({
    ...jest.requireActual('../Modules/Comments/helpers/commentThreads'),
    placeReply: async (companyId, data) => ({ allowed: true, data }),
}));
jest.mock('../Modules/Comments/helpers/commentNotifications', () => ({
    resolveMentionIds: jest.fn(async () => []),
    deliverMentions: jest.fn(async () => []),
}));
jest.mock('../Modules/Comments/helpers/threadNotices', () => ({ notifyReply: jest.fn(async () => undefined) }));
jest.mock('../Modules/Comments/helpers/unreadBumps', () => ({ bumpUnreadCounts: jest.fn(async () => undefined) }));

const { save, update } = require('../Modules/Comments/controller');
const { SERVER_OWNED_FIELDS } = require('../Modules/Comments/helpers/serverOwnedFields');
const { schema } = require('../utils/mongo-handler/schema');

const C = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const MEMBER = '6f0000000000000000000003';
const GUEST = '6f0000000000000000000005';
const SOMEONE_ELSE = '6f0000000000000000000009';
const PROJECT = '6f0000000000000000000b01';
const SPRINT = '6f0000000000000000000d01';
const TASK = '6f0000000000000000000e01';
const COMMENT = '6f0000000000000000000f01';
Object.assign(mockRoles, { [OWNER]: 1, [ADMIN]: 2, [MEMBER]: 3, [GUEST]: 0 });

const LAST_YEAR = '2025-01-01T00:00:00.000Z';
const NOT_THE_CLIENTS = {
    _id: '6f0000000000000000000fff', __v: 7, createdAt: LAST_YEAR, updatedAt: LAST_YEAR,
    isAgent: true, agentName: 'Release bot', actorType: 'agent', agentId: 'agent-1', viaAccount: 'workspace', runId: 'run-1', automationName: 'Nightly',
    legacyId: 'old-1', reactions: [{ emoji: ':+1:', userIds: [SOMEONE_ELSE] }],
};
const THE_CLIENTS = { message: 'hello', type: 'text', project: false, isDeleted: false, hasReply: false, pinnedMessage: false, mediaURL: '', mediaName: '', mediaSize: 0 };
const PEOPLE = [['an owner', OWNER], ['an admin', ADMIN], ['a member', MEMBER], ['a guest', GUEST]];

const answer = () => {
    const r = { code: 200 };
    r.status = (code) => { r.code = code; return r; };
    r.json = (body) => { r.body = body; return r; };
    return r;
};
const post = async (uid, data) => {
    const r = answer();
    await save({ headers: { companyid: C }, uid, body: { data: { ...data, objId: { projectId: PROJECT, sprintId: SPRINT, taskId: TASK } } } }, r);
    return r;
};
const put = async (uid, body) => {
    const r = answer();
    await update({ headers: { companyid: C }, uid, body: { id: COMMENT, ...body } }, r);
    return r;
};

beforeEach(() => {
    mockWrites.length = 0;
    mockExisting = null;
});

describe('posting a comment', () => {
    it.each(PEOPLE)('stores what %s wrote, as that person, with nothing only the server writes', async (label, uid) => {
        const r = await post(uid, { ...THE_CLIENTS, ...NOT_THE_CLIENTS, userId: SOMEONE_ELSE });

        expect(r.code).toBe(200);
        const [{ row }] = mockWrites;
        expect(row).toMatchObject({ ...THE_CLIENTS, userId: uid });
        SERVER_OWNED_FIELDS.forEach((field) => expect(row).not.toHaveProperty(field));
    });

    it('stores a comment that carries none of them exactly as before', async () => {
        await post(MEMBER, THE_CLIENTS);

        expect(Object.keys(mockWrites[0].row).sort()).toEqual([...Object.keys(THE_CLIENTS), 'mentionIds', 'projectId', 'sprintId', 'taskId', 'userId'].sort());
    });
});

describe('editing a comment', () => {
    beforeEach(() => { mockExisting = { _id: COMMENT, userId: MEMBER, projectId: PROJECT, sprintId: SPRINT, taskId: TASK, message: 'hello' }; });

    it.each([
        ['its author', MEMBER],
        ['an owner', OWNER],
        ['an admin', ADMIN],
    ])('by %s changes the text, and nothing only the server writes', async (label, uid) => {
        const r = await put(uid, { data: { message: 'edited', ...NOT_THE_CLIENTS }, options: { timestamps: false } });

        expect(r.code).toBe(200);
        const [{ set }] = mockWrites;
        expect(set).toMatchObject({ message: 'edited' });
        SERVER_OWNED_FIELDS.forEach((field) => expect(set).not.toHaveProperty(field));
    });

    it.each([
        ['a member', SOMEONE_ELSE],
        ['a guest', GUEST],
    ])('by %s who did not write it is still refused, whatever it carries', async (label, uid) => {
        const r = await put(uid, { data: { pinnedMessage: true, createdAt: LAST_YEAR } });

        expect(r.code).toBe(403);
        expect(mockWrites).toEqual([]);
    });

    it('still lets any member pin it', async () => {
        const r = await put(SOMEONE_ELSE, { data: { pinnedMessage: true }, options: { timestamps: false } });

        expect(r.code).toBe(200);
        expect(mockWrites[0].set).toEqual({ pinnedMessage: true });
    });
});

describe('the fields only the server writes', () => {
    it('are fields the comment schema stores, or the ones the database keeps itself', () => {
        const kept = ['_id', '__v', 'createdAt', 'updatedAt'];

        SERVER_OWNED_FIELDS.filter((field) => !kept.includes(field)).forEach((field) => expect(schema.comments).toHaveProperty(field));
    });
});
