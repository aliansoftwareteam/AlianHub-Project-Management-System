const verified = require('./fixtures/verifiedRequest');
const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));

const mockReached = (name) => jest.fn((req, res) => res.status(200).json({ status: true, reached: name }));
const mockModule = () => new Proxy({}, { get: (target, name) => { target[name] = target[name] || mockReached(String(name)); return target[name]; } });

jest.mock('../Modules/Project/controller/getProjectById', () => mockModule());
jest.mock('../Modules/Project/controller/getProjectList', () => mockModule());
jest.mock('../Modules/Project/controller/updateProject', () => mockModule());
jest.mock('../Modules/Project/controller/getSprintFolder', () => mockModule());
jest.mock('../Modules/Project/controller/updateSprint', () => mockModule());
jest.mock('../Modules/Project/controller/getProjectFilterData', () => mockModule());
jest.mock('../Modules/Project/controller/checklist', () => mockModule());
jest.mock('../Modules/Project/controller/tags', () => mockModule());
jest.mock('../Modules/Project/controller/getQueryFun', () => mockModule());
jest.mock('../Modules/Sprints/controller', () => mockModule());
jest.mock('../Modules/Sprints/burndown', () => mockModule());
jest.mock('../Modules/Sprints/hours', () => mockModule());
jest.mock('../Modules/Sprints/scrum', () => mockModule());

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const ADMIN = 'a00000000000000000000002';
const MEMBER = 'a00000000000000000000003';
const OTHER = 'a00000000000000000000004';
const MEMBER_ROLE = 3;

const oid = () => new mongoose.Types.ObjectId().toString();

const routesOf = (modulePath) => {
    const table = {};
    const register = (method) => (path, ...handlers) => { table[`${method} ${path}`] = handlers.flat(); };
    const app = { get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') };
    require(modulePath).init(app);
    return table;
};

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    res.send = res.json;
    res.set = jest.fn(() => res);
    return res;
};

const run = async (handlers, req) => {
    const res = response();
    for (const handler of handlers) {
        let advanced = false;
        await handler(req, res, () => { advanced = true; });
        if (!advanced) break;
    }
    await new Promise((resolve) => setImmediate(resolve));
    return res;
};

const SPRINTS = '../Modules/Sprints/routes';
const PROJECT = '../Modules/Project/routes';

const call = (modulePath, route, { uid = MEMBER, params = {}, body = {} } = {}) => run(routesOf(modulePath)[route], verified({ uid, params, body, query: {}, headers: { companyid: C } }));

const seedRules = (grants = {}) => {
    const parents = {};
    const parentOf = (section) => {
        if (!parents[section]) parents[section] = mockDb.seed(SCHEMA_TYPE.RULES, { key: section, isParent: true, roles: [{ key: MEMBER_ROLE, permission: true }] });
        return parents[section];
    };
    Object.entries(grants).forEach(([path, permission]) => {
        const [section, key] = path.split('.');
        mockDb.seed(SCHEMA_TYPE.RULES, { key, isParent: false, parentId: String(parentOf(section)._id), roles: [{ key: MEMBER_ROLE, permission }] });
    });
};

const MANAGES_CHAT = { 'chat.chat_channel': true, 'chat.chat_category': true };

const space = (doc = {}) => String(mockDb.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: oid(), ProjectName: 'CHANNELS', default: false, ...doc })._id);
const channelIn = (spaceId, doc = {}) => String(mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(), projectId: spaceId, name: 'general', private: false, deletedStatusKey: 0, ...doc })._id);
const categoryIn = (spaceId) => String(mockDb.seed(SCHEMA_TYPE.FOLDERS, { _id: oid(), projectId: spaceId, name: 'Teams', deletedStatusKey: 0 })._id);

beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: ADMIN, roleType: 2, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: MEMBER_ROLE, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OTHER, roleType: MEMBER_ROLE, status: 2, isDelete: false });
});

const PATCH_SPRINT = 'PATCH /api/v1/sprint/:id';

describe('a private channel is its members\' and the admins\'', () => {
    it.each([
        ['renaming it', () => ({ type: 'editSprintName', sprintName: 'mine now', mainChat: true })],
        ['deleting it', () => ({ type: 'deleteChannel', mainChat: true })],
        ['joining it', () => ({ type: 'updateSprint', mainChat: true, updateObject: { $addToSet: { AssigneeUserId: MEMBER, watchers: MEMBER } } })],
        ['opening it to everyone', () => ({ type: 'updateSprint', mainChat: true, updateObject: { $set: { private: false } } })],
    ])('answers 404 to a member who is not on it %s', async (_label, bodyFor) => {
        seedRules(MANAGES_CHAT);
        const id = channelIn(space(), { private: true, AssigneeUserId: [OTHER] });
        const res = await call(SPRINTS, PATCH_SPRINT, { params: { id }, body: bodyFor(id) });
        expect(res.statusCode).toBe(404);
        expect(mockDb.crud.mock.calls.some(([, { type }, method]) => type === SCHEMA_TYPE.SPRINTS && method === 'findOneAndUpdate')).toBe(false);
    });

    it('lets a member on it, the owner and an admin manage it', async () => {
        seedRules(MANAGES_CHAT);
        const id = channelIn(space(), { private: true, AssigneeUserId: [MEMBER] });
        for (const uid of [MEMBER, OWNER, ADMIN]) {
            const res = await call(SPRINTS, PATCH_SPRINT, { uid, params: { id }, body: { type: 'editSprintName', sprintName: 'renamed', mainChat: true } });
            expect(res.body).toMatchObject({ status: true, reached: 'editSprintName' });
        }
    });

    it('does not let a member favourite a private channel they are not on', async () => {
        seedRules(MANAGES_CHAT);
        const id = channelIn(space(), { private: true, AssigneeUserId: [OTHER] });
        const res = await call(PROJECT, 'PUT /api/v1/project/sprint/:id', { params: { id }, body: { key: '$addToSet', updateObject: { favouriteTasks: { userId: MEMBER } } } });
        expect(res.statusCode).toBe(404);
    });
});

describe('managing channels takes the chat channel permission', () => {
    it('refuses a member without it', async () => {
        seedRules({ 'chat.chat_channel': false });
        const id = channelIn(space());
        const res = await call(SPRINTS, PATCH_SPRINT, { params: { id }, body: { type: 'deleteChannel', mainChat: true } });
        expect(res.statusCode).toBe(403);
        expect(res.body).toMatchObject({ status: false, permission: 'chat.chat_channel' });
    });

    it('lets a member holding it manage a public channel', async () => {
        seedRules(MANAGES_CHAT);
        const id = channelIn(space());
        const res = await call(SPRINTS, PATCH_SPRINT, { params: { id }, body: { type: 'deleteChannel', mainChat: true } });
        expect(res.body).toMatchObject({ status: true, reached: 'deleteChannel' });
    });

    it('refuses creating a channel without it, and lets a holder create one', async () => {
        seedRules({ 'chat.chat_channel': false });
        const spaceId = space();
        const body = { projectId: spaceId, sprintName: 'random', mainChat: true, AssigneeUserId: [MEMBER] };
        const refused = await call(SPRINTS, 'POST /api/v1/sprint', { body });
        expect(refused.statusCode).toBe(403);
        expect(refused.body).toMatchObject({ permission: 'chat.chat_channel' });

        const allowed = await call(SPRINTS, 'POST /api/v1/sprint', { uid: OWNER, body: { ...body, AssigneeUserId: [OWNER] } });
        expect(allowed.body).toMatchObject({ status: true, reached: 'addSprint' });
    });

    it('lets a member keep favourites on a public channel without it', async () => {
        seedRules({ 'chat.chat_channel': false });
        const id = channelIn(space());
        const res = await call(PROJECT, 'PUT /api/v1/project/sprint/:id', { params: { id }, body: { key: '$addToSet', updateObject: { favouriteTasks: { userId: MEMBER } } } });
        expect(res.body).toMatchObject({ status: true });
    });
});

describe('chat categories take the chat category permission', () => {
    it('refuses renaming a category, or adding one, without it', async () => {
        seedRules({ 'chat.chat_category': false, 'chat.chat_channel': true });
        const spaceId = space();
        const renamed = await call(SPRINTS, 'PATCH /api/v1/folder/:id', { params: { id: categoryIn(spaceId) }, body: { type: 'editFolderName', folderName: 'x', mainChat: true } });
        expect(renamed.statusCode).toBe(403);
        expect(renamed.body).toMatchObject({ permission: 'chat.chat_category' });
        const added = await call(SPRINTS, 'POST /api/v1/folder', { body: { projectId: spaceId, folderName: 'x', mainChat: true } });
        expect(added.statusCode).toBe(403);
    });

    it('lets a holder rename a category', async () => {
        seedRules(MANAGES_CHAT);
        const res = await call(SPRINTS, 'PATCH /api/v1/folder/:id', { params: { id: categoryIn(space()) }, body: { type: 'editFolderName', folderName: 'x', mainChat: true } });
        expect(res.body).toMatchObject({ status: true, reached: 'editFolderName' });
    });
});

describe('containers that are neither a project nor a channel space', () => {
    it('refuses writing into the direct-message space', async () => {
        seedRules(MANAGES_CHAT);
        const direct = space({ ProjectName: 'one to one', default: true });
        const id = channelIn(direct, { name: 'defaultSprint' });
        const res = await call(SPRINTS, PATCH_SPRINT, { uid: OWNER, params: { id }, body: { type: 'deleteChannel', mainChat: true } });
        expect(res.statusCode).toBe(404);
    });

    it('refuses a container that does not exist', async () => {
        seedRules(MANAGES_CHAT);
        const res = await call(SPRINTS, 'POST /api/v1/sprint', { uid: OWNER, body: { projectId: oid(), sprintName: 'orphan' } });
        expect(res.statusCode).toBe(404);
    });
});
