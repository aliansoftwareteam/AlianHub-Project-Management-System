const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/CustomField/aiFields/controller', () => ({ preview: jest.fn(), apply: jest.fn(), startJob: jest.fn(), readJob: jest.fn() }));

const { EventEmitter } = require('events');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const world = require('./fixtures/accessWorld');

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, L_OPEN, L_SECRET, T_OPEN, T_SECRET, T_PRIVATE, T_PERSONAL, OPENS, settle } = world;
const { seed, task, setRule } = world.create(mockDb);

const COST = '6f0000000000000000000f01';
const TOTAL = '6f0000000000000000000f02';
const DOUBLE = '6f0000000000000000000f03';
const PRIVATE_TOTAL = '6f0000000000000000000f04';
const CHILD_OPEN = '6f0000000000000000000d11';
const CHILD_SECRET = '6f0000000000000000000d12';
const CHILD_OF_SECRET = '6f0000000000000000000d13';
const EVERY_TASK = [T_OPEN, T_SECRET, T_PRIVATE, T_PERSONAL];
const COMPUTE = 'POST /api/v2/custom-fields/compute';
const SCOPE = 'GET /api/v2/custom-fields/formula/scope';

const routes = {};
const register = (method) => (routePath, ...handlers) => { routes[`${method} ${routePath}`] = handlers; };
require('../Modules/CustomField/routes').init({ get: register('GET'), post: register('POST'), put: register('PUT') });

const send = (route, uid, { body = {}, query = {} } = {}) => new Promise((resolve) => {
    const [method, url] = route.split(' ');
    const res = new EventEmitter();
    res.statusCode = 200;
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (answer) => { res.emit('finish'); resolve({ code: res.statusCode, body: answer }); return res; };
    res.json = res.send;
    const req = { uid, method, originalUrl: url, baseUrl: '', route: { path: url }, query, headers: { companyid: CID }, aud: CID, body };
    const handlers = routes[route];
    const step = (at) => Promise.resolve(handlers[at](req, res, () => step(at + 1)));
    step(0);
}).then(async (result) => { await settle(); return result; });

const compute = (uid, taskIds, extra = {}) => send(COMPUTE, uid, { body: { taskIds, ...extra } });
const storedValue = (taskId, fieldId) => ((task(taskId).customField || {})[fieldId] || {}).fieldValue;
const told = () => socketEmitter.emit.mock.calls.filter(([event, payload]) => event === 'update' && payload.module === 'task').map(([, payload]) => String(payload.data._id)).sort();
const cost = (value) => ({ customField: { [COST]: { fieldValue: value } } });

beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.PERMISSION_ENFORCEMENT_MODE;
    const { seedTask } = seed();
    const field = (_id, fieldTitle, fieldType, extra = {}) => mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id, fieldTitle, fieldType, type: 'task', global: true, ...extra });
    field(COST, 'Cost', 'number');
    field(TOTAL, 'Total cost', 'rollup', { rollupFunction: 'sum', rollupSourceFieldId: COST });
    field(DOUBLE, 'Double cost', 'formula', { formulaExpression: '{cost} * 2' });
    field(PRIVATE_TOTAL, 'Private total', 'rollup', { global: false, projectId: [P_PRIVATE], rollupFunction: 'count', rollupSourceFieldId: '' });
    EVERY_TASK.forEach((taskId) => { task(taskId).customField = { [COST]: { fieldValue: 4 } }; });
    seedTask(CHILD_OPEN, 'Subtask on the open list', P_OPEN, L_OPEN, { isParentTask: false, ParentTaskId: T_OPEN, ...cost(10) });
    seedTask(CHILD_SECRET, 'Subtask on the private list', P_OPEN, L_SECRET, { isParentTask: false, ParentTaskId: T_OPEN, ...cost(5) });
    seedTask(CHILD_OF_SECRET, 'Open subtask of a task on the private list', P_OPEN, L_OPEN, { isParentTask: false, ParentTaskId: T_SECRET, ...cost(1) });
});
afterAll(() => { delete process.env.PERMISSION_ENFORCEMENT_MODE; });

describe('computing the formula and rollup fields of tasks', () => {
    it.each([
        ['an owner', OWNER],
        ['an admin', ADMIN],
        ['a member on the private work', INSIDER],
        ['a member outside it', OUTSIDER],
        ['a guest', GUEST],
    ])('for %s computes, stores and answers the tasks that person can open, and no other', async (label, uid) => {
        const answer = await compute(uid, EVERY_TASK);

        expect(answer.body.status).toBe(true);
        expect(Object.keys(answer.body.data.values).sort()).toEqual([...OPENS[uid]].sort());
        expect(answer.body.data.updated).toBe(OPENS[uid].length);
        expect(told()).toEqual([...OPENS[uid]].sort());
        EVERY_TASK.forEach((taskId) => expect([taskId, storedValue(taskId, DOUBLE)]).toEqual([taskId, OPENS[uid].includes(taskId) ? 8 : undefined]));
    });

    it('does not climb to a task above that the caller cannot open', async () => {
        const answer = await compute(OUTSIDER, [CHILD_OF_SECRET]);

        expect(Object.keys(answer.body.data.values)).toEqual([CHILD_OF_SECRET]);
        expect(storedValue(T_SECRET, TOTAL)).toBeUndefined();

        await compute(OWNER, [CHILD_OF_SECRET]);
        expect(storedValue(T_SECRET, TOTAL)).toBe(1);
    });

    it('stores a rollup as the whole number over every subtask, and answers numbers alone', async () => {
        const answer = await compute(OUTSIDER, [T_OPEN]);

        expect(answer.body.data.values).toEqual({ [T_OPEN]: { [TOTAL]: 15, [DOUBLE]: 8 } });
        expect(storedValue(T_OPEN, TOTAL)).toBe(15);
        expect(JSON.stringify(answer.body)).not.toMatch(new RegExp(`${CHILD_SECRET}|${CHILD_OPEN}|Subtask`));
        expect(storedValue(CHILD_SECRET, DOUBLE)).toBeUndefined();
    });

    it('computes a task with the fields of its own project, whatever project the request names', async () => {
        await compute(OWNER, [T_OPEN, T_PRIVATE], { projectId: P_PRIVATE });

        expect(storedValue(T_PRIVATE, PRIVATE_TOTAL)).toBe(0);
        expect(task(T_OPEN).customField).not.toHaveProperty(PRIVATE_TOTAL);
        expect(storedValue(T_OPEN, DOUBLE)).toBe(8);
    });

    it('needs what editing a field value needs, where the workspace enforces its permissions', async () => {
        process.env.PERMISSION_ENFORCEMENT_MODE = 'enforce';
        setRule('task_custom_field', false);

        for (const uid of [INSIDER, GUEST]) {
            const refused = await compute(uid, [T_OPEN]);
            expect(refused.code).toBe(403);
            expect(refused.body.permission).toBe('task.task_custom_field');
        }
        expect(storedValue(T_OPEN, DOUBLE)).toBeUndefined();
        expect(told()).toEqual([]);

        expect((await compute(OWNER, [T_OPEN])).code).toBe(200);
        setRule('task_custom_field', true);
        expect((await compute(INSIDER, [T_SECRET])).body.data.updated).toBe(1);
    });
});

describe('the names a formula may reference', () => {
    const valueOf = (answer, name) => answer.body.data.names.find((entry) => entry.name === name).value;
    const scope = (uid, taskId) => send(SCOPE, uid, { query: taskId ? { taskId } : {} });

    it.each([
        ['a task in a project the caller cannot open', OUTSIDER, T_PRIVATE],
        ['a task on a list the caller is not on', GUEST, T_SECRET],
        ['a task on another person\'s personal list', OWNER, T_PERSONAL],
    ])('carry no value of %s', async (label, uid, taskId) => {
        const answer = await scope(uid, taskId);

        expect(answer.body.status).toBe(true);
        expect(answer.body).toEqual((await scope(uid, null)).body);
        expect(valueOf(answer, 'cost')).toBeUndefined();
    });

    it.each([
        ['an owner', OWNER, T_PRIVATE],
        ['a member on the private work', INSIDER, T_PERSONAL],
        ['a member outside it', OUTSIDER, T_OPEN],
        ['a guest', GUEST, T_OPEN],
    ])('carry, for %s, the values of a task that person can open', async (label, uid, taskId) => {
        expect(valueOf(await scope(uid, taskId), 'cost')).toBe(4);
    });
});
