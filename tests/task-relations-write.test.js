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

const world = require('./fixtures/accessWorld');

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, L_OPEN, T_OPEN, T_SECRET, T_PRIVATE, T_PERSONAL, OPENS, settle } = world;
const { seed, task } = world.create(mockDb);

const T_OPEN_2 = '6f0000000000000000000d09';
const T_UNLINKED = '6f0000000000000000000d0a';
const T_NOWHERE = '6f0000000000000000000dff';
const LINKED = [T_OPEN_2, T_SECRET, T_PRIVATE, T_PERSONAL];
const RELATIONS = 'POST /api/v2/tasks/relations';
const EVERYONE = [['an owner', OWNER], ['an admin', ADMIN], ['a member on the private work', INSIDER], ['a member outside it', OUTSIDER], ['a guest', GUEST]];

const routes = {};
const register = (method) => (routePath, ...handlers) => { routes[`${method} ${routePath}`] = handlers; };
require('../Modules/Tasks/routes').init({ get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') });

const ask = (uid, body) => new Promise((resolve) => {
    const res = { statusCode: 200, on: () => {} };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (answer) => { resolve({ code: res.statusCode, body: answer }); return res; };
    res.json = res.send;
    const req = { uid, method: 'POST', originalUrl: '/api/v2/tasks/relations', baseUrl: '', route: { path: '/api/v2/tasks/relations' }, query: {}, headers: { companyid: CID }, aud: CID, body };
    const handlers = routes[RELATIONS];
    const step = (at) => Promise.resolve(handlers[at](req, res, () => step(at + 1)));
    step(0);
}).then(async (result) => { await settle(); return result; });

const add = (uid, taskId, relatedTaskId) => ask(uid, { action: 'add', taskId, relatedTaskId, type: 'relates_to' });
const remove = (uid, taskId, relatedTaskId) => ask(uid, { action: 'remove', taskId, relatedTaskId });

const link = (taskId, type) => ({ taskId, type, createdBy: INSIDER, createdAt: new Date('2026-09-01T00:00:00.000Z') });
const answeredIds = (answer) => answer.body.data.relations.map((row) => String(row.taskId)).sort();
const storedIds = (taskId) => (task(taskId).relations || []).map((row) => String(row.taskId)).sort();
const openedBy = (uid) => LINKED.filter((id) => id === T_OPEN_2 || OPENS[uid].includes(id));
const stored = () => JSON.stringify(mockDb.store.tasks.map((row) => [row._id, row.relations || []]));

beforeEach(() => {
    const { seedTask } = seed();
    seedTask(T_OPEN_2, 'Second open task', P_OPEN, L_OPEN);
    seedTask(T_UNLINKED, 'Linked to nothing', P_OPEN, L_OPEN);
    task(T_OPEN).relations = LINKED.map((taskId) => link(taskId, 'blocked_by'));
    LINKED.forEach((taskId) => { task(taskId).relations = [link(T_OPEN, 'blocks')]; });
});

describe('the links a relations write answers with', () => {
    it.each(EVERYONE)('are, after %s adds one, the ones that person can open', async (label, uid) => {
        const answer = await add(uid, T_OPEN, T_UNLINKED);

        expect(answer.body.status).toBe(true);
        expect(answeredIds(answer)).toEqual([...openedBy(uid), T_UNLINKED].sort());
        expect(storedIds(T_OPEN)).toEqual([...LINKED, T_UNLINKED].sort());
    });

    it.each(EVERYONE)('are, after %s removes one, the ones that person can open', async (label, uid) => {
        const answer = await remove(uid, T_OPEN, T_OPEN_2);

        expect(answer.body.status).toBe(true);
        expect(answeredIds(answer)).toEqual(openedBy(uid).filter((id) => id !== T_OPEN_2).sort());
        expect(storedIds(T_OPEN)).toEqual(LINKED.filter((id) => id !== T_OPEN_2).sort());
        expect(storedIds(T_OPEN_2)).toEqual([]);
    });
});

describe('removing a link', () => {
    it.each([
        ['a task in a project the caller cannot open', OUTSIDER, T_PRIVATE],
        ['a task in a project a guest cannot open', GUEST, T_PRIVATE],
        ['a task on a list the caller is not on', OUTSIDER, T_SECRET],
        ['a task on another person\'s personal list', OWNER, T_PERSONAL],
        ['a task on another person\'s personal list, for an admin', ADMIN, T_PERSONAL],
    ])('to %s answers as two tasks that are not linked do, and removes nothing', async (label, uid, relatedTaskId) => {
        const before = stored();

        const answer = await remove(uid, T_OPEN, relatedTaskId);

        expect(answer).toEqual(await remove(uid, T_OPEN, T_UNLINKED));
        expect(answer).toEqual(await remove(uid, T_OPEN, T_NOWHERE));
        expect(answer.body).toEqual({ status: false, statusText: 'These tasks are not linked.' });
        expect(stored()).toBe(before);
    });

    it.each([
        ['a member on the private work', INSIDER, T_PRIVATE],
        ['a member on the private work', INSIDER, T_SECRET],
        ['the owner of a personal list', INSIDER, T_PERSONAL],
        ['an owner', OWNER, T_PRIVATE],
        ['an admin', ADMIN, T_SECRET],
    ])('goes through for %s, who can open both tasks', async (label, uid, relatedTaskId) => {
        const answer = await remove(uid, T_OPEN, relatedTaskId);

        expect(answer.body.status).toBe(true);
        expect(storedIds(T_OPEN)).toEqual(LINKED.filter((id) => id !== relatedTaskId).sort());
        expect(storedIds(relatedTaskId)).toEqual([]);
    });

    it.each([
        ['a member outside it', OUTSIDER, T_PRIVATE],
        ['a guest', GUEST, T_SECRET],
    ])('from a task %s cannot open answers as a missing task does', async (label, uid, taskId) => {
        const before = stored();

        const answer = await remove(uid, taskId, T_OPEN);

        expect(answer).toEqual(await remove(uid, T_NOWHERE, T_OPEN));
        expect(answer.code).toBe(404);
        expect(stored()).toBe(before);
    });
});

describe('adding a link', () => {
    it.each([
        ['a member outside it', OUTSIDER, T_PRIVATE],
        ['a guest', GUEST, T_SECRET],
        ['an owner', OWNER, T_PERSONAL],
    ])('to a task %s cannot open answers as a missing task does', async (label, uid, relatedTaskId) => {
        const before = stored();

        const answer = await add(uid, T_UNLINKED, relatedTaskId);

        expect(answer).toEqual(await add(uid, T_UNLINKED, T_NOWHERE));
        expect(answer.code).toBe(404);
        expect(stored()).toBe(before);
    });
});
