process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ ...jest.requireActual('../utils/commonFunctions'), removeCache: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/mongo_helper', () => ({ HandleHistory: jest.fn(async () => ({ status: true })) }));
jest.mock('../Modules/Tasks/helpers/handleNotification', () => ({ HandleBothNotification: jest.fn(async () => ({ status: true })) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const { removeCache } = require('../utils/commonFunctions');
const { HandleHistory } = require('../Modules/Tasks/helpers/mongo_helper');
const assignment = require('../Modules/Tasks/helpers/taskMongo/updateAssignment');
const { TASK_ACTION_FIELDS, specFor } = require('../Modules/Tasks/helpers/taskWriteFields');

const C = '6f0000000000000000000c01';
const PROJECT = '6f0000000000000000000a01';
const PRIYA = '6f0000000000000000000011';
const SAM = '6f0000000000000000000012';

let emitSpy;
let task;

const call = (over = {}) => assignment.updateAssignee({
    firebaseObj: { AssigneeUserId: PRIYA },
    projectData: { _id: PROJECT, ProjectName: 'Web', CompanyId: C },
    taskData: { _id: String(task._id), TaskName: 'Fix login', sprintId: 'sp1', folderObjId: '' },
    employeeName: 'Priya Shah',
    type: 'assigneeAdd',
    userData: { id: SAM, Employee_Name: 'Sam Lee' },
    isUpdateTask: true,
    ...over,
});

const settle = () => new Promise((resolve) => setImmediate(resolve));
const stored = () => mockDb.store[SCHEMA_TYPE.TASKS].find((t) => String(t._id) === String(task._id));
const assigneeEmits = () => emitSpy.mock.calls.filter(([, payload]) => payload && payload.updatedFields && Object.keys(payload.updatedFields).length);

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    emitSpy = jest.spyOn(socketEmitter, 'emit').mockImplementation(() => true);
    task = mockDb.seed(SCHEMA_TYPE.TASKS, {
        TaskName: 'Fix login', CompanyId: C, ProjectID: PROJECT, sprintId: 'sp1',
        AssigneeUserId: [], watchers: [], groupByAssigneeIndex: 4,
    });
});

afterEach(() => { jest.restoreAllMocks(); });

describe('updateAssignee — who the change is announced as', () => {
    it('without an actor emits exactly the event it always has', async () => {
        await call();
        await settle();
        const [name, payload] = assigneeEmits()[0];
        expect(name).toBe('update');
        expect(Object.keys(payload)).toEqual(['type', 'data', 'updatedFields', 'module', 'companyId']);
        expect(JSON.stringify(payload)).toBe(JSON.stringify({
            type: 'update', data: stored(), updatedFields: { $addToSet: { AssigneeUserId: PRIYA } }, module: 'task', companyId: C,
        }));
    });

    it('with an actor and a depth emits them, so the automation loop guard sees who made the change', async () => {
        await call({ eventActor: { kind: 'automation', userId: null }, eventDepth: 2 });
        await settle();
        const [, payload] = assigneeEmits()[0];
        expect(payload.actor).toEqual({ kind: 'automation', userId: null });
        expect(payload.depth).toBe(2);
        expect(payload.updatedFields).toEqual({ $addToSet: { AssigneeUserId: PRIYA } });
    });

    it('cannot be given an actor or depth through the task write API', () => {
        const params = specFor(TASK_ACTION_FIELDS, 'updateAssignee').params;
        expect(params).not.toContain('eventActor');
        expect(params).not.toContain('eventDepth');
    });
});

describe('updateAssignee — the write path an automation now shares with the task panel', () => {
    it('adds the assignee, clears the assignee group index and makes them a watcher', async () => {
        await call({ eventActor: { kind: 'automation', userId: null }, eventDepth: 1 });
        await settle();
        expect(stored().AssigneeUserId).toEqual([PRIYA]);
        expect(stored().groupByAssigneeIndex).toBeUndefined();
        expect(stored().watchers).toEqual([PRIYA]);
        expect(HandleHistory).toHaveBeenCalled();
    });

    it('removing takes the person off the assignees and the watchers', async () => {
        stored().AssigneeUserId = [PRIYA, SAM];
        stored().watchers = [PRIYA, SAM];
        await call({ type: 'assigneRemove', eventActor: { kind: 'automation', userId: null }, eventDepth: 1 });
        await settle();
        expect(stored().AssigneeUserId).toEqual([SAM]);
        expect(stored().watchers).toEqual([SAM]);
    });

    it('clears the same caches with or without an actor (the assignee write keeps no cache)', async () => {
        await call();
        await settle();
        const plain = removeCache.mock.calls.length;
        stored().AssigneeUserId = [];
        await call({ eventActor: { kind: 'automation', userId: null }, eventDepth: 1 });
        await settle();
        expect(removeCache.mock.calls.length - plain).toBe(plain);
    });
});
