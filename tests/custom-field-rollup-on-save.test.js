const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/CustomField/helpers/customFieldHistory', () => ({
    recordFieldCreated: jest.fn(() => Promise.resolve()),
    recordFieldRenamed: jest.fn(() => Promise.resolve()),
}));

const { ObjectId } = require('mongodb');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const { insertCustomField, updateCustomField, ROLLUP_FILL_LIMIT } = require('../Modules/CustomField/controller');

const CID = '6f00000000000000000000c1';
const PROJECT = '6f0000000000000000000b01';
const ELSEWHERE = '6f0000000000000000000b02';
const OWNER = '6f00000000000000000000a1';
const COST = '6f0000000000000000000f01';
const id = (n) => `6f00000000000000000000${String(n).padStart(2, '0')}`;
const ROOT = id(1);
const CHILD = id(2);
const GRANDCHILD = id(3);
const SECOND_CHILD = id(4);
const BARE_ROOT = id(5);
const BARE_CHILD = id(6);
const ELSEWHERE_ROOT = id(7);
const ELSEWHERE_CHILD = id(8);
const TRASHED_CHILD = id(9);

const row = (_id, parent, ancestors, cost, extra = {}) => ({
    _id: new ObjectId(_id), TaskName: _id, ProjectID: new ObjectId(PROJECT), ParentTaskId: parent, isParentTask: !parent, TaskTypeKey: 1, deletedStatusKey: 0,
    ancestors, customField: cost === null ? {} : { [COST]: { fieldValue: cost } },
    ...extra,
});

const rollup = (extra = {}) => ({ fieldTitle: 'Total cost', fieldType: 'rollup', global: false, projectId: [PROJECT], rollupFunction: 'sum', rollupSourceFieldId: COST, ...extra });

const answer = () => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    res.send = res.json;
    return res;
};
const create = async (updateObject) => {
    const res = answer();
    await insertCustomField({ headers: { companyid: CID }, uid: OWNER, body: { type: 'save', updateObject } }, res);
    return res;
};
const change = async (fieldId, updateObject) => {
    const res = answer();
    await updateCustomField({ headers: { companyid: CID }, uid: OWNER, body: { type: 'updateOne', key: '$set', id: String(fieldId), updateObject } }, res);
    return res;
};

const stored = (taskId, fieldId) => (mockDb.store[SCHEMA_TYPE.TASKS].find((task) => String(task._id) === taskId).customField[String(fieldId)] || {}).fieldValue;
const toldAbout = () => socketEmitter.emit.mock.calls
    .filter(([event, payload]) => event === 'update' && payload.module === 'task')
    .map(([, payload]) => String(payload.data._id)).sort();
const taskCalls = () => mockDb.calls.filter((call) => call.type === SCHEMA_TYPE.TASKS);

beforeEach(() => {
    Object.keys(mockDb.store).forEach((type) => { mockDb.store[type].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id: new ObjectId(COST), fieldTitle: 'Cost', fieldType: 'number', global: true });
    [
        row(ROOT, '', [], null),
        row(CHILD, ROOT, [ROOT], 10),
        row(GRANDCHILD, CHILD, [ROOT, CHILD], 5),
        row(SECOND_CHILD, ROOT, [ROOT], 1),
        row(BARE_ROOT, '', [], null),
        row(BARE_CHILD, BARE_ROOT, [BARE_ROOT], null),
        row(ELSEWHERE_ROOT, '', [], null, { ProjectID: new ObjectId(ELSEWHERE) }),
        row(ELSEWHERE_CHILD, ELSEWHERE_ROOT, [ELSEWHERE_ROOT], 100, { ProjectID: new ObjectId(ELSEWHERE) }),
        row(TRASHED_CHILD, ROOT, [ROOT], 1000, { deletedStatusKey: 1 }),
    ].forEach((task) => mockDb.seed(SCHEMA_TYPE.TASKS, task));
});

describe('a rollup field that is created', () => {
    it('is computed at once for every task above a subtask that holds a source value', async () => {
        const res = await create(rollup());
        expect(res.statusCode).toBe(200);
        const field = res.body._id;
        expect(stored(ROOT, field)).toBe(16);
        expect(stored(CHILD, field)).toBe(5);
        expect(toldAbout()).toEqual([ROOT, CHILD].sort());
    });

    it('leaves alone a task with nothing to add up and a task of a project the field is not on', async () => {
        const field = (await create(rollup())).body._id;
        [GRANDCHILD, SECOND_CHILD, BARE_ROOT, ELSEWHERE_ROOT].forEach((taskId) => expect([taskId, stored(taskId, field)]).toEqual([taskId, undefined]));
    });

    it('reaches every project when the field is for the whole company', async () => {
        const field = (await create(rollup({ global: true, projectId: [] }))).body._id;
        expect(stored(ELSEWHERE_ROOT, field)).toBe(100);
        expect(stored(ROOT, field)).toBe(16);
    });

    it('reads the tasks of its own company only, a bounded number of them', async () => {
        await create(rollup());
        expect(taskCalls().length).toBeGreaterThan(0);
        expect(mockDb.calls.every((call) => call.companyId === CID)).toBe(true);
        const [first] = taskCalls();
        expect(first.method).toBe('find');
        expect(first.data[2]).toMatchObject({ limit: ROLLUP_FILL_LIMIT });
    });

    it('still answers the field when the computing fails', async () => {
        const real = mockDb.crud.getMockImplementation();
        mockDb.crud.mockImplementation(async (companyId, query, method) => {
            if (query.type === SCHEMA_TYPE.TASKS) throw new Error('read failed');
            return real(companyId, query, method);
        });
        const res = await create(rollup());
        mockDb.crud.mockImplementation(real);
        expect(res.statusCode).toBe(200);
        expect(res.body.fieldTitle).toBe('Total cost');
    });
});

describe('a formula field that is created', () => {
    const formula = (extra = {}) => ({ fieldTitle: 'Double cost', fieldType: 'formula', global: false, projectId: [PROJECT], formulaExpression: '{Cost} * 2', ...extra });

    it('is worked out at once on the tasks of its project that hold what it reads', async () => {
        const res = await create(formula());
        expect(res.statusCode).toBe(200);
        const field = res.body._id;
        expect(stored(CHILD, field)).toBe(20);
        expect(stored(GRANDCHILD, field)).toBe(10);
        expect(stored(SECOND_CHILD, field)).toBe(2);
        expect(stored(ELSEWHERE_CHILD, field)).toBeUndefined();
    });

    it('reads a bounded number of tasks of its own company', async () => {
        await create(formula());
        expect(mockDb.calls.every((call) => call.companyId === CID)).toBe(true);
        expect(taskCalls()[0].data[2]).toMatchObject({ limit: ROLLUP_FILL_LIMIT });
    });

    it('is worked out again when its expression changes', async () => {
        const field = (await create(formula())).body._id;
        expect((await change(field, { formulaExpression: '{Cost} + 1' })).statusCode).toBe(200);
        expect(stored(CHILD, field)).toBe(11);
    });
});

describe('a field that is not a rollup', () => {
    it('reads no task when it is created', async () => {
        expect((await create({ fieldTitle: 'Budget', fieldType: 'number', global: false, projectId: [PROJECT] })).statusCode).toBe(200);
        expect(taskCalls()).toEqual([]);
    });
});

describe('a rollup field that is edited', () => {
    it('is computed again when what it adds up changes', async () => {
        const field = (await create(rollup())).body._id;
        expect((await change(field, { rollupFunction: 'max' })).statusCode).toBe(200);
        expect(stored(ROOT, field)).toBe(10);
        expect(stored(CHILD, field)).toBe(5);
    });

    it('reads no task when only its name changes', async () => {
        const field = (await create(rollup())).body._id;
        mockDb.calls.length = 0;
        expect((await change(field, { fieldTitle: 'Spend' })).statusCode).toBe(200);
        expect(taskCalls()).toEqual([]);
    });
});
