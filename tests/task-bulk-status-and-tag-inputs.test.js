process.env.STORAGE_TYPE = 'server';
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
const mockStub = () => new Proxy({}, {
    get: (target, name) => {
        if (name === 'then' || name === '__esModule') return undefined;
        target[name] = target[name] || jest.fn(() => Promise.resolve({}));
        return target[name];
    },
});
jest.mock('../Modules/Sprints/controller', () => mockStub());
jest.mock('../Modules/Tasks/helpers/handleNotification', () => mockStub());
jest.mock('../Modules/Company/eventController', () => mockStub());
jest.mock('../Modules/Company/controller/updateCompany', () => mockStub());
jest.mock('../Modules/notification-count/controller', () => mockStub());
jest.mock('../Modules/Comments/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());
jest.mock('../Modules/CustomField/controller', () => mockStub());
jest.mock('../utils/planHelper', () => mockStub());
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../common-storage/common-server.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));

const { EventEmitter } = require('events');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/accessWorld');

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, T_OPEN, T_SECRET, T_PRIVATE, T_PERSONAL, settle } = world;
const { seed, rows, task } = world.create(mockDb);

const T_NOWHERE = '6f0000000000000000000dff';
const BULK = 'POST /api/v2/tasks/bulk';
const TAG = 'tag-open-1';
const TAG_ELSEWHERE = 'tag-private-1';

const routes = {};
const register = (method) => (routePath, ...handlers) => { routes[`${method} ${routePath}`] = handlers; };
require('../Modules/Tasks/routes').init({ get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') });

const session = (uid) => ({ uid });
const personalToken = (uid) => ({ uid, apiToken: { _id: '6f0000000000000000000102', name: 'A script', userId: uid, scopes: ['read', 'write'] } });

const send = (caller, body) => new Promise((resolve) => {
    const res = new EventEmitter();
    res.statusCode = 200;
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (answer) => { res.emit('finish'); resolve({ code: res.statusCode, body: answer }); return res; };
    res.json = res.send;
    const req = { ...caller, method: 'POST', originalUrl: '/api/v2/tasks/bulk', url: '/api/v2/tasks/bulk', baseUrl: '', route: { path: '/api/v2/tasks/bulk' }, query: {}, headers: { companyid: CID }, aud: CID, ip: '1.1.1.1', body };
    const handlers = routes[BULK];
    const step = (at) => Promise.resolve(handlers[at](req, res, () => step(at + 1)));
    step(0);
}).then(async (result) => { await settle(); return result; });

const setStatus = (caller, taskIds, newStatus) => send(caller, { action: 'bulkUpdateStatus', companyId: CID, taskIds, newStatus });
const tag = (caller, taskIds, tagId, operation = 'add') => send(caller, { action: 'bulkUpdateTags', companyId: CID, taskIds, tagId, operation });
const sent = (key, name, type) => ({ status: { key, text: name, type, value: '' }, statusKey: key, statusType: type });
const held = (taskId) => { const { statusKey, statusType, status } = task(taskId); return { statusKey, statusType, text: status.text, type: status.type }; };
const project = (id) => rows(SCHEMA_TYPE.PROJECTS).find((row) => String(row._id) === id);
const UNTOUCHED = { statusKey: 1, statusType: 'default_active', text: 'To Do', type: undefined };
const PEOPLE = [['an owner', OWNER], ['an admin', ADMIN], ['a member', INSIDER], ['a member outside the private work', OUTSIDER], ['a guest', GUEST]];
const CALLERS = PEOPLE.flatMap(([label, uid]) => [[`${label}, signed in`, session(uid)], [`${label}, with a personal token`, personalToken(uid)]]);
const HIDDEN = [
    ['a task in a project the caller cannot open', OUTSIDER, T_PRIVATE],
    ['a task on a list a guest is not on', GUEST, T_SECRET],
    ['a task on another person\'s personal list', OWNER, T_PERSONAL],
];

beforeEach(() => {
    seed();
    project(P_OPEN).tagsArray = [{ uid: TAG, tagName: 'Urgent' }];
    project(P_PRIVATE).tagsArray = [{ uid: TAG_ELSEWHERE, tagName: 'Internal' }];
    project(P_PRIVATE).taskStatusData = [{ key: 1, name: 'To Do', type: 'default_active' }, { key: 2, name: 'Reviewing', type: 'active' }];
});

describe('the status many tasks are given at once', () => {
    it.each(CALLERS)('is stored for %s with the type and name the project has for that key', async (label, caller) => {
        const answer = await setStatus(caller, [T_OPEN], sent(3, 'In Progress', 'active'));

        expect(answer.code).toBe(200);
        expect(answer.body.data.updated).toEqual([T_OPEN]);
        expect(held(T_OPEN)).toEqual({ statusKey: 3, statusType: 'close', text: 'Done', type: 'close' });
    });

    it('is stored as the web sends it when the body agrees with the project', async () => {
        expect((await setStatus(session(INSIDER), [T_OPEN, T_SECRET], sent(2, 'In Progress', 'active'))).body.data.updated).toEqual([T_OPEN, T_SECRET]);
        expect(held(T_OPEN)).toEqual({ statusKey: 2, statusType: 'active', text: 'In Progress', type: 'active' });
        expect(held(T_SECRET)).toEqual({ statusKey: 2, statusType: 'active', text: 'In Progress', type: 'active' });
    });

    it('takes the key in the form the project holds it', async () => {
        expect((await setStatus(session(OWNER), [T_OPEN], sent('2', 'Whatever', 'close'))).code).toBe(200);
        expect(held(T_OPEN)).toEqual({ statusKey: 2, statusType: 'active', text: 'In Progress', type: 'active' });
    });

    it.each([
        ['a key the project does not have', sent(99, 'In Progress', 'active')],
        ['no key', { status: { text: 'Done', type: 'close' }, statusType: 'close' }],
        ['a key that is not a plain value', { status: { text: 'Done' }, statusKey: { $ne: 1 }, statusType: 'close' }],
    ])('is refused when it names %s, and the tasks keep their status', async (label, newStatus) => {
        for (const caller of [session(OWNER), session(ADMIN), session(INSIDER), session(GUEST), personalToken(INSIDER)]) {
            const answer = await setStatus(caller, [T_OPEN], newStatus);

            expect([label, answer.code]).toEqual([label, 400]);
            expect(answer.body.status).toBe(false);
            expect(held(T_OPEN)).toEqual(UNTOUCHED);
        }
    });

    it('gives each task the status as its own project has it', async () => {
        const answer = await setStatus(session(INSIDER), [T_OPEN, T_PRIVATE], sent(2, 'In Progress', 'active'));

        expect(answer.body.data.updated).toEqual([T_OPEN, T_PRIVATE]);
        expect(held(T_OPEN)).toEqual({ statusKey: 2, statusType: 'active', text: 'In Progress', type: 'active' });
        expect(held(T_PRIVATE)).toEqual({ statusKey: 2, statusType: 'active', text: 'Reviewing', type: 'active' });
    });

    it('leaves out the tasks whose project does not have the key, and says so', async () => {
        const answer = await setStatus(session(INSIDER), [T_OPEN, T_PRIVATE], sent(3, 'Done', 'close'));

        expect(answer.code).toBe(200);
        expect(answer.body.data.updated).toEqual([T_OPEN]);
        expect(answer.body.data.skipped).toEqual([{ taskId: T_PRIVATE, reason: 'status-not-in-project' }]);
        expect(held(T_OPEN)).toEqual({ statusKey: 3, statusType: 'close', text: 'Done', type: 'close' });
        expect(held(T_PRIVATE)).toEqual(UNTOUCHED);
    });

    it.each(HIDDEN)('answers for %s as for a task that does not exist, whichever status it names', async (label, uid, taskId) => {
        for (const newStatus of [sent(2, 'In Progress', 'active'), sent(99, 'Nothing', 'active')]) {
            expect(await setStatus(session(uid), [taskId], newStatus)).toEqual(await setStatus(session(uid), [T_NOWHERE], newStatus));
        }
        expect(held(taskId)).toEqual(UNTOUCHED);
    });
});

describe('a tag put on many tasks at once', () => {
    it.each(CALLERS)('is stored for %s when it is one of the project\'s tags', async (label, caller) => {
        const answer = await tag(caller, [T_OPEN], TAG);

        expect(answer.code).toBe(200);
        expect(answer.body.data.updated).toEqual([T_OPEN]);
        expect(task(T_OPEN).tagsArray).toEqual([TAG]);
    });

    it.each([
        ['a tag no project has', 'tag-of-nothing'],
        ['a tag of another project', TAG_ELSEWHERE],
        ['a number', 7],
        ['a truth value', true],
        ['an empty text', ''],
        ['an object', { $ne: null }],
        ['a list', [TAG]],
    ])('is refused when it is %s, and nothing is stored', async (label, tagId) => {
        for (const caller of [session(OWNER), session(ADMIN), session(INSIDER), session(GUEST), personalToken(INSIDER)]) {
            const answer = await tag(caller, [T_OPEN, T_SECRET], tagId);

            expect([label, answer.body.status]).toEqual([label, false]);
            expect(task(T_OPEN).tagsArray).toBeUndefined();
            expect(task(T_SECRET).tagsArray).toBeUndefined();
        }
    });

    it.each([['a tag no project has', 'tag-of-nothing'], ['a tag of another project', TAG_ELSEWHERE]])('answers 400 for %s', async (label, tagId) => {
        expect((await tag(session(OWNER), [T_OPEN], tagId)).code).toBe(400);
    });

    it('leaves out the tasks whose project does not have the tag, and says so', async () => {
        const answer = await tag(session(INSIDER), [T_OPEN, T_PRIVATE], TAG);

        expect(answer.code).toBe(200);
        expect(answer.body.data.updated).toEqual([T_OPEN]);
        expect(answer.body.data.skipped).toEqual([{ taskId: T_PRIVATE, reason: 'tag-not-in-project' }]);
        expect(task(T_OPEN).tagsArray).toEqual([TAG]);
        expect(task(T_PRIVATE).tagsArray).toBeUndefined();
    });

    it('can still be taken off after the project dropped it', async () => {
        task(T_OPEN).tagsArray = ['dropped-tag', TAG];
        task(T_SECRET).tagsArray = ['dropped-tag'];

        expect((await tag(session(INSIDER), [T_OPEN, T_SECRET], 'dropped-tag', 'remove')).body.data.updated).toEqual([T_OPEN, T_SECRET]);
        expect(task(T_OPEN).tagsArray).toEqual([TAG]);
        expect(task(T_SECRET).tagsArray).toEqual([]);
    });

    it.each(HIDDEN)('answers for %s as for a task that does not exist, whichever tag it names', async (label, uid, taskId) => {
        for (const tagId of [TAG, TAG_ELSEWHERE, 'tag-of-nothing']) {
            expect(await tag(session(uid), [taskId], tagId)).toEqual(await tag(session(uid), [T_NOWHERE], tagId));
        }
        expect(task(taskId).tagsArray).toBeUndefined();
    });
});
