const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));

const { ObjectId } = require('mongodb');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const computedRefresh = require('../Modules/CustomField/computedRefresh');

const CID = '6f00000000000000000000c1';
const PROJECT = '6f0000000000000000000b01';
const COST = '6f0000000000000000000f01';
const TOTAL = '6f0000000000000000000f02';
const TENFOLD = '6f0000000000000000000f03';
const DOUBLE_COST = '6f0000000000000000000f04';
const TENFOLD_BELOW = '6f0000000000000000000f05';
const AVERAGE = '6f0000000000000000000f06';
const id = (n) => `6f00000000000000000000${String(n).padStart(2, '0')}`;
const PARENT = id(1);
const FIRST = id(2);
const SECOND = id(3);
const OTHER_PARENT = id(4);
const GRANDCHILD = id(5);

const row = (_id, parent, cost, extra = {}) => ({
    _id: new ObjectId(_id), CompanyId: CID, TaskName: _id, ProjectID: new ObjectId(PROJECT), ParentTaskId: parent, isParentTask: !parent, TaskTypeKey: 1,
    deletedStatusKey: 0, subTasks: 0, customField: cost === null ? {} : { [COST]: { fieldValue: cost } },
    ...extra,
});

const tasks = () => mockDb.store[SCHEMA_TYPE.TASKS];
const taskOf = (taskId) => tasks().find((task) => String(task._id) === taskId);
const stored = (taskId, fieldId) => ((taskOf(taskId).customField || {})[fieldId] || {}).fieldValue;

const heard = [];
const hear = (payload) => heard.push(payload);

/* Each helper stores what a task write stores and tells it as that write does (taskMongo/create.js, structural.js, updateMeta.js). */
const told = (taskId, updatedFields) => socketEmitter.emit('update', { type: 'update', data: { ...taskOf(taskId) }, updatedFields, module: 'task', companyId: CID });
const change = (taskId, fields) => {
    Object.assign(taskOf(taskId), fields);
    told(taskId, fields);
};
const countUnder = (parentId, by) => change(parentId, { subTasks: (taskOf(parentId).subTasks || 0) + by });
const add = (taskId, parentId, cost = null, extra = {}) => {
    const task = mockDb.seed(SCHEMA_TYPE.TASKS, row(taskId, parentId, cost, extra));
    socketEmitter.emit('insert', { type: 'insert', data: { ...task }, module: 'task', companyId: CID });
    if (parentId) countUnder(parentId, 1);
};
const setCost = (taskId, value) => {
    taskOf(taskId).customField = { ...taskOf(taskId).customField, [COST]: { fieldValue: value } };
    told(taskId, { [`customField.${COST}`]: { fieldValue: value } });
};
const trash = (taskId) => {
    change(taskId, { deletedStatusKey: 1 });
    countUnder(taskOf(taskId).ParentTaskId, -1);
};
const restore = (taskId) => {
    change(taskId, { deletedStatusKey: 0 });
    countUnder(taskOf(taskId).ParentTaskId, 1);
};

const field = (_id, fieldTitle, fieldType, extra = {}) => mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id: new ObjectId(_id), fieldTitle, fieldType, type: 'task', global: true, ...extra });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((type) => { mockDb.store[type].length = 0; });
    mockDb.calls.length = 0;
    heard.length = 0;
    field(COST, 'Cost', 'number');
    field(TOTAL, 'Total cost', 'rollup', { rollupFunction: 'sum', rollupSourceFieldId: COST });
    field(TENFOLD, 'Tenfold', 'formula', { formulaExpression: '{subtask_count} * 10' });
    field(DOUBLE_COST, 'Double cost', 'formula', { formulaExpression: '{Cost} * 2' });
    mockDb.seed(SCHEMA_TYPE.TASKS, row(PARENT, '', null));
    mockDb.seed(SCHEMA_TYPE.TASKS, row(OTHER_PARENT, '', null));
    computedRefresh.start({ debounceMs: 0 });
    socketEmitter.on('task:update', hear);
});

afterEach(async () => {
    await computedRefresh.flush();
    computedRefresh.stop();
    socketEmitter.off('task:update', hear);
});

describe('a new task', () => {
    it('stores its formula and its rollup when it is made: a zero, not nothing', async () => {
        add(SECOND, '');
        await computedRefresh.flush();
        expect(stored(SECOND, TENFOLD)).toBe(0);
        expect(stored(SECOND, TOTAL)).toBe(0);
    });

    it('stores nothing for a formula that cannot be worked out', async () => {
        add(SECOND, '');
        await computedRefresh.flush();
        expect(stored(SECOND, DOUBLE_COST)).toBe('');
    });
});

describe('a formula that counts subtasks', () => {
    it('follows a subtask that is added', async () => {
        add(FIRST, PARENT);
        await computedRefresh.flush();
        expect(stored(PARENT, TENFOLD)).toBe(10);
        add(SECOND, PARENT);
        await computedRefresh.flush();
        expect(stored(PARENT, TENFOLD)).toBe(20);
    });

    it('follows a subtask that is put in the trash, and one that is restored', async () => {
        add(FIRST, PARENT);
        add(SECOND, PARENT);
        await computedRefresh.flush();
        trash(SECOND);
        await computedRefresh.flush();
        expect(stored(PARENT, TENFOLD)).toBe(10);
        restore(SECOND);
        await computedRefresh.flush();
        expect(stored(PARENT, TENFOLD)).toBe(20);
    });

    it('follows a subtask that becomes a task of its own', async () => {
        add(FIRST, PARENT);
        add(SECOND, PARENT);
        await computedRefresh.flush();
        change(SECOND, { ParentTaskId: '', isParentTask: true });
        countUnder(PARENT, -1);
        await computedRefresh.flush();
        expect(stored(PARENT, TENFOLD)).toBe(10);
        expect(stored(SECOND, TENFOLD)).toBe(0);
    });

    it('follows a task that becomes a subtask', async () => {
        add(SECOND, '');
        await computedRefresh.flush();
        change(SECOND, { ParentTaskId: PARENT, isParentTask: false });
        countUnder(PARENT, 1);
        await computedRefresh.flush();
        expect(stored(PARENT, TENFOLD)).toBe(10);
    });

    it('follows a subtask that moves under another task: both tasks are worked out again', async () => {
        add(FIRST, PARENT, 4);
        await computedRefresh.flush();
        change(FIRST, { ParentTaskId: OTHER_PARENT });
        countUnder(PARENT, -1);
        countUnder(OTHER_PARENT, 1);
        await computedRefresh.flush();
        expect([stored(PARENT, TENFOLD), stored(PARENT, TOTAL)]).toEqual([0, 0]);
        expect([stored(OTHER_PARENT, TENFOLD), stored(OTHER_PARENT, TOTAL)]).toEqual([10, 4]);
    });
});

describe('a rollup', () => {
    it('follows the value of a subtask on every level above it', async () => {
        add(FIRST, PARENT, 5);
        add(GRANDCHILD, FIRST, 2);
        await computedRefresh.flush();
        expect([stored(PARENT, TOTAL), stored(FIRST, TOTAL)]).toEqual([7, 2]);
        setCost(GRANDCHILD, 3);
        await computedRefresh.flush();
        expect([stored(PARENT, TOTAL), stored(FIRST, TOTAL)]).toEqual([8, 3]);
    });

    it('is zero with subtasks that hold no value', async () => {
        add(FIRST, PARENT);
        await computedRefresh.flush();
        expect(stored(PARENT, TOTAL)).toBe(0);
    });

    it('stores nothing where there is nothing to average', async () => {
        field(AVERAGE, 'Average cost', 'rollup', { rollupFunction: 'avg', rollupSourceFieldId: COST });
        add(FIRST, PARENT);
        await computedRefresh.flush();
        expect(stored(PARENT, AVERAGE)).toBe('');
    });

    it('over a formula of the subtasks reads the number that write just gave them', async () => {
        field(TENFOLD_BELOW, 'Tenfold below', 'rollup', { rollupFunction: 'sum', rollupSourceFieldId: TENFOLD });
        add(FIRST, PARENT);
        add(GRANDCHILD, FIRST);
        await computedRefresh.flush();
        expect(stored(FIRST, TENFOLD)).toBe(10);
        expect(stored(PARENT, TENFOLD_BELOW)).toBe(10);
    });
});

describe('a formula over a field of the task', () => {
    it('follows that field', async () => {
        setCost(PARENT, 6);
        await computedRefresh.flush();
        expect(stored(PARENT, DOUBLE_COST)).toBe(12);
        setCost(PARENT, 0);
        await computedRefresh.flush();
        expect(stored(PARENT, DOUBLE_COST)).toBe(0);
    });

    it('follows the estimate', async () => {
        field(AVERAGE, 'Estimate twice', 'formula', { formulaExpression: '{estimate} * 2' });
        change(PARENT, { totalEstimatedTime: 90 });
        await computedRefresh.flush();
        expect(stored(PARENT, AVERAGE)).toBe(180);
    });
});

describe('what a refresh costs', () => {
    it('writes and tells nothing when no number changed', async () => {
        add(FIRST, PARENT);
        await computedRefresh.flush();
        heard.length = 0;
        mockDb.calls.length = 0;
        change(PARENT, { totalEstimatedTime: 30 });
        await computedRefresh.flush();
        expect(mockDb.calls.filter((call) => call.method === 'findOneAndUpdate')).toEqual([]);
        expect(heard.filter((payload) => Object.keys(payload.updatedFields).some((key) => key.startsWith('customField.')))).toEqual([]);
    });

    it('does not answer its own event with another refresh', async () => {
        add(FIRST, PARENT);
        await computedRefresh.flush();
        mockDb.calls.length = 0;
        await computedRefresh.flush();
        expect(mockDb.calls).toEqual([]);
    });

    it('leaves a change that no formula reads alone', async () => {
        mockDb.calls.length = 0;
        change(PARENT, { TaskName: 'Renamed', DueDate: new Date() });
        await computedRefresh.flush();
        expect(mockDb.calls).toEqual([]);
    });

    it('reads no task in a company with no formula and no rollup', async () => {
        mockDb.store[SCHEMA_TYPE.CUSTOM_FIELDS].length = 0;
        field(COST, 'Cost', 'number');
        mockDb.calls.length = 0;
        add(FIRST, PARENT, 3);
        await computedRefresh.flush();
        expect(mockDb.calls.filter((call) => call.type === SCHEMA_TYPE.TASKS)).toEqual([]);
    });

    it('stays in the company of the write', async () => {
        add(FIRST, PARENT);
        await computedRefresh.flush();
        expect(mockDb.calls.every((call) => call.companyId === CID)).toBe(true);
    });
});
