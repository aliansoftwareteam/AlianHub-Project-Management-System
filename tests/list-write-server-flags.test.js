const verified = require('./fixtures/verifiedRequest');
const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/notification-count/controller', () => ({ unsetAllCounts: jest.fn(async () => ({})), updateUnReadCommentsCount: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/helper', () => ({ HandleHistory: jest.fn(() => Promise.resolve()) }));
jest.mock('../Modules/Sprints/helpers/sprintHistory', () => ({
    storedNames: jest.fn(async () => ({ projectName: 'Launch', folderName: 'Q3' })),
    notifySprintCreated: jest.fn(() => Promise.resolve()),
    notifyFolderCreated: jest.fn(() => Promise.resolve()),
}));
jest.mock('../utils/planHelper', () => ({ getCachedCompanyData: jest.fn(async () => ({ data: {} })) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const controller = require('../Modules/Sprints/controller');
const { HandleHistory } = require('../Modules/Tasks/helpers/helper');
const { notifySprintCreated, notifyFolderCreated } = require('../Modules/Sprints/helpers/sprintHistory');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const oid = () => new mongoose.Types.ObjectId().toString();

const routes = () => {
    const table = {};
    const register = (method) => (path, ...handlers) => { table[`${method} ${path}`] = handlers.flat(); };
    require('../Modules/Sprints/routes').init({ get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') });
    return table;
};

const settle = async () => { for (let i = 0; i < 60; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

const run = async (route, { id, body }) => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((payload) => { res.body = payload; return res; });
    res.send = res.json;
    const req = verified({ uid: OWNER, params: { id }, body: { companyId: C, ...body }, query: {}, headers: { companyid: C } });
    for (const handler of routes()[route]) {
        let advanced = false;
        await handler(req, res, () => { advanced = true; });
        if (!advanced) break;
    }
    await settle();
    return res;
};

const sprints = () => mockDb.store[SCHEMA_TYPE.SPRINTS] || [];
const addList = (container, extra = {}) => run('POST /api/v1/sprint', { body: { projectId: container, sprintName: 'Backlog', folder: null, type: 'addSprint', ...extra } });

let project;
let space;
let perProjectLimit;

beforeEach(() => {
    myCache.flushAll();
    jest.clearAllMocks();
    mockDb = fakeMongo.create();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: OWNER, Employee_Name: 'Olivia' });
    project = String(mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Launch', isPrivateSpace: false, AssigneeUserId: [] })._id);
    space = String(mockDb.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: oid(), ProjectName: 'CHANNELS', default: false })._id);
    perProjectLimit = jest.spyOn(controller, 'getPerProjectCount').mockResolvedValue(true);
    jest.spyOn(controller, 'updateChannelsCounts').mockResolvedValue(true);
});
afterEach(() => jest.restoreAllMocks());

describe('a new list in a project', () => {
    it.each([
        ['nothing extra', {}],
        ['a seeding flag', { isPreCompany: true }],
        ['a chat flag', { mainChat: true }],
        ['both flags', { isPreCompany: true, mainChat: true }],
    ])('is held to the plan\'s lists per project when the request carries %s', async (_label, extra) => {
        perProjectLimit.mockResolvedValue(false);
        const res = await addList(project, extra);
        expect(res.body).toMatchObject({ status: false, isUpgrade: true });
        expect(sprints()).toHaveLength(0);
        expect(controller.updateChannelsCounts).not.toHaveBeenCalled();
    });

    it.each([
        ['nothing extra', {}],
        ['a seeding flag', { isPreCompany: true }],
        ['a chat flag', { mainChat: true }],
    ])('is written to the project\'s history and announced when the request carries %s', async (_label, extra) => {
        const res = await addList(project, extra);
        expect(res.body).toMatchObject({ status: true });
        expect(sprints()).toHaveLength(1);
        expect(sprints()[0]).not.toHaveProperty('sendMessage');
        expect(HandleHistory).toHaveBeenCalledTimes(1);
        expect(HandleHistory.mock.calls[0][5]).toMatchObject({ id: OWNER, Employee_Name: 'Olivia' });
        expect(notifySprintCreated).toHaveBeenCalledWith(expect.objectContaining({ projectId: project, actorId: OWNER }));
    });
});

describe('a new channel in a chat space', () => {
    it.each([
        ['the chat flag', { mainChat: true }],
        ['no flag', {}],
        ['a seeding flag', { isPreCompany: true }],
    ])('counts against the plan\'s channels and leaves no project history when the request carries %s', async (_label, extra) => {
        const res = await addList(space, { sendMessage: true, AssigneeUserId: [], ...extra });
        expect(res.body).toMatchObject({ status: true });
        expect(sprints()).toHaveLength(1);
        expect(controller.updateChannelsCounts).toHaveBeenCalledWith(C, false, 'inc');
        expect(perProjectLimit).not.toHaveBeenCalled();
        expect(HandleHistory).not.toHaveBeenCalled();
        expect(notifySprintCreated).not.toHaveBeenCalled();
    });
});

describe('a list or folder change in a project', () => {
    it('records a rename in the history whatever chat flag the request carries', async () => {
        const id = String(mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(), projectId: project, name: 'Sprint 1', private: false, deletedStatusKey: 0 })._id);
        const res = await run('PATCH /api/v1/sprint/:id', { id, body: { type: 'editSprintName', projectId: project, sprintName: 'Sprint one', mainChat: true } });
        expect(res.body).toMatchObject({ status: true });
        expect(HandleHistory).toHaveBeenCalledTimes(1);
    });

    it('announces a new folder whatever chat flag the request carries', async () => {
        const res = await run('POST /api/v1/folder', { body: { projectId: project, folderName: 'Q3', mainChat: true } });
        expect(res.body).toMatchObject({ status: true });
        expect(notifyFolderCreated).toHaveBeenCalledWith(expect.objectContaining({ projectId: project, actorId: OWNER }));
    });

    it('keeps the chat flag of a channel rename out of the project history', async () => {
        const id = String(mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(), projectId: space, name: 'general', private: false, deletedStatusKey: 0 })._id);
        const res = await run('PATCH /api/v1/sprint/:id', { id, body: { type: 'editSprintName', projectId: space, sprintName: 'everyone' } });
        expect(res.body).toMatchObject({ status: true });
        expect(HandleHistory).not.toHaveBeenCalled();
    });
});
