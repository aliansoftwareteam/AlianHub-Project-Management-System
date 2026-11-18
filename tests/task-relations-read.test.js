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
const { seed } = world.create(mockDb);

const T_OPEN_2 = '6f0000000000000000000d09';
const T_HIDDEN_LINKS_ONLY = '6f0000000000000000000d0a';
const T_NO_LINKS = '6f0000000000000000000d0b';
const LINKED = [T_OPEN_2, T_SECRET, T_PRIVATE, T_PERSONAL];
const RELATIONS = 'POST /api/v2/tasks/relations';

const routes = {};
const register = (method) => (routePath, ...handlers) => { routes[`${method} ${routePath}`] = handlers; };
require('../Modules/Tasks/routes').init({ get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') });

const ask = (uid, action, taskId) => new Promise((resolve) => {
    const res = { statusCode: 200, on: () => {} };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (answer) => { resolve({ code: res.statusCode, body: answer }); return res; };
    res.json = res.send;
    const req = { uid, method: 'POST', originalUrl: '/api/v2/tasks/relations', baseUrl: '', route: { path: '/api/v2/tasks/relations' }, query: {}, headers: { companyid: CID }, aud: CID, body: { action, taskId } };
    const handlers = routes[RELATIONS];
    const step = (at) => Promise.resolve(handlers[at](req, res, () => step(at + 1)));
    step(0);
}).then(async (result) => { await settle(); return result; });

const link = (taskId, type) => ({ taskId, type, createdBy: INSIDER, createdAt: new Date('2026-09-01T00:00:00.000Z') });
const linkedIds = (answer) => answer.body.data.map((row) => row.taskId).sort();
const openedBy = (uid) => LINKED.filter((id) => id === T_OPEN_2 || OPENS[uid].includes(id)).sort();

beforeEach(() => {
    const { seedTask } = seed();
    seedTask(T_OPEN_2, 'Second open task', P_OPEN, L_OPEN);
    seedTask(T_HIDDEN_LINKS_ONLY, 'Linked to private work only', P_OPEN, L_OPEN, { relations: [link(T_PRIVATE, 'blocked_by'), link(T_PERSONAL, 'relates_to')] });
    seedTask(T_NO_LINKS, 'Linked to nothing', P_OPEN, L_OPEN);
    mockDb.store.tasks.find((task) => task._id === T_OPEN).relations = LINKED.map((taskId) => link(taskId, 'blocked_by'));
});

describe('the linked tasks of a task', () => {
    it.each([
        ['an owner', OWNER],
        ['an admin', ADMIN],
        ['a member on the private work', INSIDER],
        ['a member outside it', OUTSIDER],
        ['a guest', GUEST],
    ])('are, for %s, the ones that person can open', async (label, uid) => {
        const answer = await ask(uid, 'list', T_OPEN);

        expect(answer.body.status).toBe(true);
        expect(linkedIds(answer)).toEqual(openedBy(uid));
        answer.body.data.forEach((row) => expect(row.task).toMatchObject({ TaskName: expect.any(String) }));
        expect(JSON.stringify(answer.body)).not.toMatch(LINKED.filter((id) => !openedBy(uid).includes(id)).join('|') || 'nothing is hidden');
    });

    it.each([
        ['an owner', OWNER],
        ['a member on the private work', INSIDER],
        ['a member outside it', OUTSIDER],
        ['a guest', GUEST],
    ])('count as open blockers, for %s, only where that person can open them', async (label, uid) => {
        const answer = await ask(uid, 'openBlockers', T_OPEN);

        expect(linkedIds(answer)).toEqual(openedBy(uid));
        expect(answer.body.statusText).toBe(`${openedBy(uid).length} open blocker(s).`);
    });

    it('read the same for a task linked only to work the reader cannot open as for a task linked to nothing', async () => {
        const hidden = await ask(OUTSIDER, 'list', T_HIDDEN_LINKS_ONLY);
        const none = await ask(OUTSIDER, 'list', T_NO_LINKS);

        expect(hidden).toEqual(none);
        expect(await ask(OUTSIDER, 'openBlockers', T_HIDDEN_LINKS_ONLY)).toEqual(await ask(OUTSIDER, 'openBlockers', T_NO_LINKS));
        expect(linkedIds(await ask(INSIDER, 'list', T_HIDDEN_LINKS_ONLY))).toEqual([T_PRIVATE, T_PERSONAL].sort());
    });

    it.each([
        ['a task in a project the reader cannot open', OUTSIDER, T_PRIVATE],
        ['a task on a list the reader is not on', GUEST, T_SECRET],
        ['a task on another person\'s personal list', OWNER, T_PERSONAL],
    ])('are not listed for %s', async (label, uid, taskId) => {
        expect((await ask(uid, 'list', taskId)).code).toBe(404);
        expect((await ask(uid, 'openBlockers', taskId)).code).toBe(404);
    });
});
