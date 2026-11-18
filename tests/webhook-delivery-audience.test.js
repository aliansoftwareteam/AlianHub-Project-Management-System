const { EventEmitter } = require('events');
const verified = require('./fixtures/verifiedRequest');

const mockDb = require('./fixtures/fakeMongo').create();
const mockEmitter = new EventEmitter();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => mockEmitter);
jest.mock('../Modules/Agents/engine/safeFetch', () => ({
    safeFetch: jest.fn(async () => ({ status: 200, data: 'ok' })),
    resolvePublic: jest.fn(async () => ({})),
}));
jest.mock('../Modules/Tasks/helpers/taskListProjects', () => require('./fixtures/taskListRules').taskListHeldEverywhere());
jest.mock('../Modules/Webhooks/helpers/signingSecret', () => ({
    signingSecretOf: jest.fn(async () => 's'.repeat(40)),
    storeSigningSecret: jest.fn(async () => ({ secret: 's'.repeat(40) })),
    revokeSigningSecret: jest.fn(async () => undefined),
    NEEDS_ATTENTION: 'needs attention',
}));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { safeFetch } = require('../Modules/Agents/engine/safeFetch');
const dispatcher = require('../Modules/Webhooks/dispatcher');
const ctrl = require('../Modules/Webhooks/controller');

const C = '6f00000000000000000000c1';
const OWNER = '6f00000000000000000000a1';
const MEMBER = '6f00000000000000000000a3';
const INSIDER = '6f00000000000000000000a4';
const GONE = '6f00000000000000000000a5';
const oid = () => new mongoose.Types.ObjectId().toString();

const hookOf = (createdBy, name) => mockDb.seed(SCHEMA_TYPE.WEBHOOKS, {
    _id: oid(), name, url: `https://hooks.example.test/${name}`, events: ['*'], secret: 's'.repeat(40), format: 'json', active: true,
    ...(createdBy === undefined ? {} : { createdBy }),
});

const taskIn = (projectId, extra = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, {
    _id: oid(), CompanyId: C, TaskKey: 'T-1', TaskName: 'Quarter numbers', Task_Priority: 'HIGH', ProjectID: projectId, deletedStatusKey: 0, createdAt: new Date('2026-01-01T00:00:00Z'), ...extra,
});

const announce = async (task) => {
    mockEmitter.emit('task:update', { data: { ...task }, updatedFields: { Task_Priority: task.Task_Priority } });
    await jest.advanceTimersByTimeAsync(2500);
    for (let i = 0; i < 50; i += 1) await Promise.resolve();
};

const reached = () => safeFetch.mock.calls.map(([url]) => String(url).split('/').pop()).sort();

let open;
let hidden;

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    myCache.flushAll();
    [[OWNER, 1], [MEMBER, 3], [INSIDER, 3]].forEach(([userId, roleType]) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false }));
    open = String(mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Launch', isPrivateSpace: false, AssigneeUserId: [] })._id);
    hidden = String(mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Board', isPrivateSpace: true, AssigneeUserId: [INSIDER] })._id);
});

describe('a webhook carries the tasks its maker can open', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        dispatcher.invalidateCompanyCache(C);
        dispatcher.start();
        hookOf(OWNER, 'owner');
        hookOf(MEMBER, 'member');
        hookOf(INSIDER, 'insider');
        hookOf(GONE, 'gone');
    });
    afterEach(() => jest.useRealTimers());

    it('sends a task of a shared project to every member\'s webhook, and to nobody who left', async () => {
        await announce(taskIn(open));
        expect(reached()).toEqual(['insider', 'member', 'owner']);
    });

    it('sends a task of a private project to the people on it and the owner only', async () => {
        await announce(taskIn(hidden));
        expect(reached()).toEqual(['insider', 'owner']);
    });

    it('keeps a task of a private list from a member who is not on the list', async () => {
        const list = mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(), projectId: open, name: 'Pay review', private: true, AssigneeUserId: [INSIDER], deletedStatusKey: 0 });
        await announce(taskIn(open, { sprintId: String(list._id) }));
        expect(reached()).toEqual(['insider', 'owner']);
    });
});

describe('a webhook with no recorded maker is looked after by owners and admins', () => {
    const call = async (handler, { uid, params = {}, body = {}, query = {} } = {}) => {
        const res = { statusCode: 200, body: undefined };
        res.status = jest.fn((code) => { res.statusCode = code; return res; });
        res.json = jest.fn((payload) => { res.body = payload; return res; });
        res.send = res.json;
        await handler(verified({ uid, params, body, query, headers: { companyid: C } }), res);
        return res;
    };

    it('is listed to the owner and not to a member', async () => {
        hookOf(undefined, 'legacy');
        hookOf(MEMBER, 'mine');
        expect((await call(ctrl.listWebhooks, { uid: MEMBER })).body.data.map((h) => h.name)).toEqual(['mine']);
        expect((await call(ctrl.listWebhooks, { uid: OWNER })).body.data.map((h) => h.name).sort()).toEqual(['legacy']);
    });

    it('is not changed, read or removed by a member', async () => {
        const legacy = hookOf('', 'legacy');
        const params = { id: String(legacy._id) };
        expect((await call(ctrl.updateWebhook, { uid: MEMBER, params, body: { url: 'https://elsewhere.example.test/in' } })).body).toMatchObject({ status: false });
        expect((await call(ctrl.updateWebhook, { uid: MEMBER, params, body: { active: false } })).body).toMatchObject({ status: false });
        expect((await call(ctrl.listWebhookLogs, { uid: MEMBER, params })).body).toMatchObject({ status: false });
        expect((await call(ctrl.deleteWebhook, { uid: MEMBER, params })).body).toMatchObject({ status: false });
        expect(mockDb.store[SCHEMA_TYPE.WEBHOOKS][0]).toMatchObject({ url: 'https://hooks.example.test/legacy', active: true });
    });

    it('is switched off and removed by the owner', async () => {
        const legacy = hookOf(undefined, 'legacy');
        const params = { id: String(legacy._id) };
        expect((await call(ctrl.updateWebhook, { uid: OWNER, params, body: { active: false } })).body).toMatchObject({ status: true });
        expect((await call(ctrl.deleteWebhook, { uid: OWNER, params })).body).toMatchObject({ status: true });
        expect(mockDb.store[SCHEMA_TYPE.WEBHOOKS]).toHaveLength(0);
    });
});
