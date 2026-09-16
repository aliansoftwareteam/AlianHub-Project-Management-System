const mockDb = require('./fixtures/fakeMongo').create();

// Mongoose treats an update without operators as a $set; fakeMongo only applies operators.
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => {
        const [filter, update, ...rest] = q.data || [];
        const plain = method === 'findOneAndUpdate' && update && !Object.keys(update).some((k) => k.startsWith('$'));
        return mockDb.crud(companyId, plain ? { ...q, data: [filter, { $set: update }, ...rest] } : q, method);
    },
}));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Company/controller/updateCompany', () => ({ getCompanyDataFun: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const ctrl = require('../Modules/taskIndex/controller');

const COMPANY = '6f00000000000000000a5001';
const PROJECT = '6f00000000000000000a5011';
const SPRINT = '6f00000000000000000a5021';
const TAB_ID = `tab-${'0123456789abcdef'.repeat(2)}`;
const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOiJ1c2VyLTEifQ.c2lnbmF0dXJlLXZhbHVl';
const API_TOKEN = `ahp_${'x'.repeat(40)}`;
const TOKEN_SHAPED = /^eyJ|^ahp_|\.[^.]+\./;

let task;

const drop = (updateToken) => new Promise((resolve) => {
    socketEmitter.once('task:update', resolve);
    const res = { send: jest.fn(), status: jest.fn(() => res) };
    ctrl.updateTaskIndex({
        headers: { companyid: COMPANY },
        body: {
            companyId: COMPANY,
            projectId: PROJECT,
            sprintId: SPRINT,
            taskId: task._id,
            taskKey: task.TaskKey,
            isFirst: true,
            isFirstWithRecord: false,
            relevantIndex: 0,
            indexName: 'groupByPriorityIndex',
            searchKey: 'Task_Priority',
            relevantKey: 'HIGH',
            updateData: { Task_Priority: 'HIGH', updateToken, islocalSnapStop: true },
        },
    }, res);
});

const stored = () => mockDb.store[SCHEMA_TYPE.TASKS].find((row) => row._id === task._id);

const expectNoCredential = (doc) => {
    const marker = doc.updateToken;
    if (marker === undefined) return;
    expect(typeof marker).toBe('object');
    expect(JSON.stringify(marker)).not.toMatch(/eyJ|ahp_/);
    if (marker.user !== undefined) expect(marker.user).not.toMatch(TOKEN_SHAPED);
};

beforeEach(() => {
    mockDb.store[SCHEMA_TYPE.TASKS] = [];
    task = mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Drag me', TaskKey: 'AH-1', ProjectID: PROJECT, sprintId: SPRINT, Task_Priority: 'LOW' });
});

describe('task drag updates never store a session credential as the update marker', () => {
    test('an access token sent as the marker is neither stored nor broadcast', async () => {
        const change = await drop({ user: JWT, timeStamp: 1700000000000 });

        expect(stored().Task_Priority).toBe('HIGH');
        expectNoCredential(stored());
        expectNoCredential(change.data);
    });

    test('an API token sent as the marker is not stored', async () => {
        await drop({ user: API_TOKEN, timeStamp: 1700000000000 });

        expectNoCredential(stored());
    });

    test('a bare token in place of the marker object is not stored', async () => {
        await drop(JWT);

        expect(stored().updateToken).toBeUndefined();
    });

    test('the per-tab id is kept, so the tab still recognises its own echo', async () => {
        const change = await drop({ user: TAB_ID, timeStamp: 1700000000000 });

        expect(stored().updateToken).toEqual({ user: TAB_ID, timeStamp: 1700000000000 });
        expect(change.data.updateToken).toEqual({ user: TAB_ID, timeStamp: 1700000000000 });
    });
});
