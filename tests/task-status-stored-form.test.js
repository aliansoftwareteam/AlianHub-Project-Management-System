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
const world = require('./fixtures/accessWorld');

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, T_OPEN, T_SECRET, T_PRIVATE, T_PERSONAL, settle } = world;
const { seed, task } = world.create(mockDb);

const T_NOWHERE = '6f0000000000000000000dff';
const PATCH = 'PATCH /api/v2/tasks';

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
    const req = { ...caller, method: 'PATCH', originalUrl: '/api/v2/tasks', url: '/api/v2/tasks', baseUrl: '', route: { path: '/api/v2/tasks' }, query: {}, headers: { companyid: CID }, aud: CID, ip: '1.1.1.1', body };
    const handlers = routes[PATCH];
    const step = (at) => Promise.resolve(handlers[at](req, res, () => step(at + 1)));
    step(0);
}).then(async (result) => { await settle(); return result; });

const setStatus = (caller, taskId, newStatus) => send(caller, { action: 'updateStatus', newStatus, prevStatus: { taskId }, projectData: {}, task: { _id: taskId }, isUpdateTask: true });
const sent = (key, name, type) => ({ status: { key, text: name, type, value: '' }, statusKey: key, statusType: type });
const held = (taskId) => { const { statusKey, statusType, status } = task(taskId); return { statusKey, statusType, text: status.text, type: status.type }; };
const PEOPLE = [['an owner', OWNER], ['an admin', ADMIN], ['a member', INSIDER], ['a member outside the private work', OUTSIDER], ['a guest', GUEST]];
const CALLERS = PEOPLE.flatMap(([label, uid]) => [[`${label}, signed in`, session(uid)], [`${label}, with a personal token`, personalToken(uid)]]);

beforeEach(() => { seed(); });

describe('the status a task is given', () => {
    it.each(CALLERS)('is stored for %s with the type and name its project has for that key', async (label, caller) => {
        const answer = await setStatus(caller, T_OPEN, sent(3, 'In Progress', 'active'));

        expect(answer.code).toBe(200);
        expect(held(T_OPEN)).toEqual({ statusKey: 3, statusType: 'close', text: 'Done', type: 'close' });
    });

    it('is stored as the web sends it when the body agrees with the project', async () => {
        expect((await setStatus(session(INSIDER), T_OPEN, sent(2, 'In Progress', 'active'))).code).toBe(200);
        expect(held(T_OPEN)).toEqual({ statusKey: 2, statusType: 'active', text: 'In Progress', type: 'active' });
    });

    it('takes the key in the form the project holds it', async () => {
        expect((await setStatus(session(OWNER), T_OPEN, sent('2', 'Whatever', 'close'))).code).toBe(200);
        expect(held(T_OPEN)).toEqual({ statusKey: 2, statusType: 'active', text: 'In Progress', type: 'active' });
    });

    it.each([
        ['a key the project does not have', sent(99, 'In Progress', 'active')],
        ['no key', { status: { text: 'Done', type: 'close' }, statusType: 'close' }],
        ['a key that is not a plain value', { status: { text: 'Done' }, statusKey: { $ne: 1 }, statusType: 'close' }],
    ])('is refused when it names %s, and the task keeps its status', async (label, newStatus) => {
        for (const caller of [session(OWNER), session(ADMIN), session(INSIDER), session(GUEST), personalToken(INSIDER)]) {
            const answer = await setStatus(caller, T_OPEN, newStatus);

            expect([label, answer.code]).toEqual([label, 400]);
            expect(answer.body.status).toBe(false);
            expect(held(T_OPEN)).toEqual({ statusKey: 1, statusType: 'default_active', text: 'To Do', type: undefined });
        }
    });

    it.each([
        ['a task in a project the caller cannot open', OUTSIDER, T_PRIVATE],
        ['a task on a list a guest is not on', GUEST, T_SECRET],
        ['a task on another person\'s personal list', OWNER, T_PERSONAL],
    ])('answers for %s as for a task that does not exist, whichever status it names', async (label, uid, taskId) => {
        for (const newStatus of [sent(3, 'Done', 'close'), sent(99, 'Nothing', 'active')]) {
            const answer = await setStatus(session(uid), taskId, newStatus);

            expect(answer).toEqual(await setStatus(session(uid), T_NOWHERE, newStatus));
            expect(answer.code).toBe(404);
        }
        expect(task(taskId).statusKey).toBe(1);
    });
});
