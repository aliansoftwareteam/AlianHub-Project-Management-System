const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
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
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => mockStub());
process.env.STORAGE_TYPE = 'server';

const socketEmitter = require('../event/socketEventEmitter');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { taskMongo } = require('../Modules/Tasks/helpers/task_class_Mongo');
const { TASK_ACTION_FIELDS } = require('../Modules/Tasks/helpers/taskWriteFields');

const C = '6f0000000000000000000c01';
const PROJECT = '6f0000000000000000000a01';
const TASK = '6f0000000000000000000b01';
const PRIYA = '6f0000000000000000000001';

const assign = (extra = {}) => taskMongo.updateAssignee({
    firebaseObj: { AssigneeUserId: PRIYA },
    projectData: { _id: PROJECT, CompanyId: C, ProjectName: 'Launch' },
    taskData: { _id: TASK, TaskName: 'Fix login', sprintId: '' },
    employeeName: 'Priya',
    type: 'assigneeAdd',
    userData: { id: PRIYA, Employee_Name: 'Assignment rules' },
    isUpdateTask: true,
    ...extra,
});

const taskEmit = () => socketEmitter.emit.mock.calls.map(([, payload]) => payload).find((p) => p && p.module === 'task' && p.updatedFields && p.updatedFields.$addToSet);

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    socketEmitter.emit.mockClear();
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: TASK, ProjectID: PROJECT, TaskName: 'Fix login', AssigneeUserId: [], watchers: [] });
});

describe('updateAssignee and the domain event bus', () => {
    it('emits exactly as before when no actor or depth is given', async () => {
        await assign();
        const payload = taskEmit();
        expect(payload).toBeTruthy();
        expect(payload).not.toHaveProperty('actor');
        expect(payload).not.toHaveProperty('depth');
    });

    it('carries a server caller\'s actor and depth on the emit', async () => {
        await assign({ actor: { kind: 'automation', userId: PRIYA }, depth: 2 });
        expect(taskEmit()).toMatchObject({ actor: { kind: 'automation', userId: PRIYA }, depth: 2 });
    });

    it('cannot be given an actor or depth through the task route', () => {
        expect(TASK_ACTION_FIELDS.updateAssignee.params).not.toContain('actor');
        expect(TASK_ACTION_FIELDS.updateAssignee.params).not.toContain('depth');
    });
});
