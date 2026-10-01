const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const { computeTaskFields, descendantsOf } = require('../Modules/CustomField/helpers/computeFields');
const { computeFields } = require('../Modules/CustomField/controller');

const CID = '6f00000000000000000000c1';
const PROJECT = '6f0000000000000000000b01';
const COST = '6f0000000000000000000f01';
const TOTAL = '6f0000000000000000000f02';
const ROWS = '6f0000000000000000000f03';
const id = (n) => `6f00000000000000000000${String(n).padStart(2, '0')}`;
const ROOT = id(1);
const CHILD = id(2);
const GRANDCHILD = id(3);
const SECOND_CHILD = id(4);
const UNCHAINED = id(5);
const OTHER_ROOT = id(6);
const OTHER_CHILD = id(7);
const BUG = id(8);

const definitions = [
    { _id: COST, fieldTitle: 'Cost', fieldType: 'number', global: true, fieldTaskTypes: [1] },
    { _id: TOTAL, fieldTitle: 'Total cost', fieldType: 'rollup', global: true, rollupFunction: 'sum', rollupSourceFieldId: COST },
    { _id: ROWS, fieldTitle: 'Rows below', fieldType: 'rollup', global: true, rollupFunction: 'count', rollupSourceFieldId: '' },
];

const row = (_id, parent, ancestors, cost, extra = {}) => ({
    _id, TaskName: _id, ProjectID: PROJECT, ParentTaskId: parent, isParentTask: !parent, TaskTypeKey: 1, deletedStatusKey: 0,
    ...(ancestors ? { ancestors } : {}),
    customField: cost === null ? {} : { [COST]: { fieldValue: cost } },
    ...extra,
});

const tree = () => [
    row(ROOT, '', [], null),
    row(CHILD, ROOT, [ROOT], 10),
    row(GRANDCHILD, CHILD, [ROOT, CHILD], 5),
    row(SECOND_CHILD, ROOT, [ROOT], 1),
    /* A row written before the chain was stored still names its parent. */
    row(UNCHAINED, CHILD, null, 2),
    row(OTHER_ROOT, '', [], null),
    row(OTHER_CHILD, OTHER_ROOT, [OTHER_ROOT], 100),
    row(BUG, ROOT, [ROOT], 50, { TaskTypeKey: 2 }),
];

const ids = (rows) => rows.map((task) => String(task._id)).sort();
const byId = (rows, taskId) => rows.find((task) => String(task._id) === taskId);
const rollupOf = (rows, taskId) => computeTaskFields({ definitions, task: byId(rows, taskId), children: descendantsOf(byId(rows, taskId), rows) }).values;

describe('the rows a rollup counts', () => {
    it('are every level under the task, each once', () => {
        const rows = tree();
        expect(ids(descendantsOf(byId(rows, ROOT), [...rows, ...rows]))).toEqual([CHILD, GRANDCHILD, SECOND_CHILD, UNCHAINED, BUG].sort());
    });

    it('for a level-two task are its own subtasks', () => {
        const rows = tree();
        expect(ids(descendantsOf(byId(rows, CHILD), rows))).toEqual([GRANDCHILD, UNCHAINED].sort());
        expect(descendantsOf(byId(rows, GRANDCHILD), rows)).toEqual([]);
    });
});

describe('a rollup over three levels of subtasks', () => {
    it('sums the source field over every descendant the field applies to', () => {
        expect(rollupOf(tree(), ROOT)[TOTAL]).toBe(18);
    });

    it('counts every descendant when it has no source field', () => {
        expect(rollupOf(tree(), ROOT)[ROWS]).toBe(5);
    });

    it('on a level-two task counts its level-three subtasks only', () => {
        expect(rollupOf(tree(), CHILD)).toMatchObject({ [TOTAL]: 7, [ROWS]: 2 });
    });

    it('on a task with nothing under it is empty', () => {
        expect(rollupOf(tree(), GRANDCHILD)).toMatchObject({ [TOTAL]: 0, [ROWS]: 0 });
    });
});

describe('POST /api/v2/custom-fields/compute', () => {
    const { ObjectId } = require('mongodb');
    const stored = (taskId, fieldId) => (mockDb.store[SCHEMA_TYPE.TASKS].find((task) => String(task._id) === taskId).customField[fieldId] || {}).fieldValue;
    const compute = async (taskIds) => {
        const res = { send: (body) => { res.body = body; return res; } };
        await computeFields({ headers: { companyid: CID }, body: { projectId: PROJECT, taskIds } }, res);
        return res.body;
    };

    beforeEach(() => {
        Object.keys(mockDb.store).forEach((type) => { mockDb.store[type].length = 0; });
        jest.clearAllMocks();
        definitions.forEach((definition) => mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { ...definition, _id: new ObjectId(definition._id) }));
        [...tree(), row(id(9), ROOT, [ROOT], 1000, { deletedStatusKey: 1 })]
            .forEach((task) => mockDb.seed(SCHEMA_TYPE.TASKS, { ...task, _id: new ObjectId(task._id) }));
    });

    it('stores a root rollup that counts levels two and three, and leaves out a deleted row', async () => {
        const body = await compute([ROOT]);
        expect(body.status).toBe(true);
        expect(stored(ROOT, TOTAL)).toBe(18);
        expect(stored(ROOT, ROWS)).toBe(5);
    });

    it('refreshes the rollups of every task above the one that changed', async () => {
        const body = await compute([GRANDCHILD]);
        expect(Object.keys(body.data.values).sort()).toEqual([ROOT, CHILD, GRANDCHILD].sort());
        expect(stored(CHILD, TOTAL)).toBe(7);
        expect(stored(ROOT, TOTAL)).toBe(18);
        expect(stored(GRANDCHILD, TOTAL)).toBe(0);
        expect(stored(OTHER_ROOT, TOTAL)).toBeUndefined();
    });

    it('tells the open clients about each task it wrote', async () => {
        await compute([GRANDCHILD]);
        const told = socketEmitter.emit.mock.calls.filter(([event, payload]) => event === 'update' && payload.module === 'task').map(([, payload]) => String(payload.data._id));
        expect(told.sort()).toEqual([ROOT, CHILD, GRANDCHILD].sort());
    });
});
