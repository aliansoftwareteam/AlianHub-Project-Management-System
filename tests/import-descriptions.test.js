/* A description that arrives as text, through each importer and the real task create path, on the in-memory database. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/tenant', () => ({ pinSessionTenant: (req) => req.headers.companyid }));
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
jest.mock('../utils/planHelper', () => mockStub());
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => mockStub());
process.env.STORAGE_TYPE = 'server';

const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const { taskMongo } = require('../Modules/Tasks/helpers/task_class_Mongo');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const importers = require('../Modules/Importers/controller');
const guardFixture = require('./fixtures/taskWriteGuard');

mongoHelper.getTotalSprintCount = async () => true;

const { CID, OWNER, OPEN_PROJECT: PROJECT } = guardFixture;
const SPRINT = '6f0000000000000000000e01';
const guard = guardFixture.create(mockDb);
const settle = async () => { for (let i = 0; i < 40; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

const TEXT = 'Agree the date\n- Book the room\n<b>not bold</b>';
const SHOWN = [
    { type: 'paragraph', data: { text: 'Agree the date' } },
    { type: 'list', data: { style: 'unordered', items: [{ content: 'Book the room', items: [] }] } },
    { type: 'paragraph', data: { text: '&lt;b&gt;not bold&lt;/b&gt;' } },
];

const taskNamed = (name) => mockDb.store[SCHEMA_TYPE.TASKS].find((task) => task.TaskName === name);

const call = async (handler, body) => {
    const res = { code: 200 };
    res.status = (code) => { res.code = code; return res; };
    res.send = (payload) => { res.body = payload; return res; };
    res.json = res.send;
    await handler({ uid: OWNER, headers: { companyid: CID }, body: { projectId: PROJECT, sprintId: SPRINT, ...body } }, res);
    await settle();
    return res;
};

beforeEach(() => {
    guard.reset();
    Object.assign(mockDb.store[SCHEMA_TYPE.PROJECTS].find((project) => project._id === PROJECT), {
        ProjectName: 'Web', ProjectCode: 'WEB', CompanyId: CID, taskStatusData: [{ name: 'To Do', key: 1, type: 'default_active' }],
    });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: SPRINT, name: 'Sprint 1', projectId: PROJECT });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: OWNER, Employee_Name: 'Olivia Owner', Employee_Email: 'owner@company.test' });
});

describe('an imported description shows in the task panel', () => {
    it.each([
        ['ClickUp', importers.importFromClickUp, { rows: [{ 'Task ID': 'a1', 'Task Name': 'Imported', 'Task Content': TEXT, Status: 'to do' }] }],
        ['a CSV', importers.importFromCsv, { rows: [{ Title: 'Imported', Description: TEXT }] }],
        ['Jira', importers.importFromJira, { rows: [{ Summary: 'Imported', Status: 'To Do', Description: TEXT }] }],
        ['Trello', importers.importFromTrello, { board: { lists: [{ id: 'l1', name: 'To Do', closed: false }], cards: [{ id: 'c1', name: 'Imported', desc: TEXT, idList: 'l1', closed: false }] } }],
        ['Asana', importers.importFromAsana, { asana: { data: [{ gid: '1', name: 'Imported', notes: TEXT }] } }],
        ['Monday', importers.importFromMonday, { rows: [{ Name: 'Imported', Notes: TEXT }] }],
    ])('from %s', async (_source, handler, body) => {
        const res = await call(handler, body);
        expect(res.body).toMatchObject({ status: true });
        const stored = taskNamed('Imported');
        expect(stored.rawDescription).toBe(TEXT);
        expect(stored.descriptionBlock).toMatchObject({ time: expect.any(Number), version: expect.any(String) });
        expect(stored.descriptionBlock.blocks).toEqual(SHOWN);
    });

    it('on a subtask as on a task', async () => {
        await call(importers.importFromClickUp, { rows: [
            { 'Task ID': 'a1', 'Task Name': 'Parent', 'Task Content': 'Above', Status: 'to do' },
            { 'Task ID': 'a2', 'Task Name': 'Child', 'Task Content': 'Below', 'Parent ID': 'a1', Status: 'to do' },
        ] });
        expect(taskNamed('Child').descriptionBlock.blocks).toEqual([{ type: 'paragraph', data: { text: 'Below' } }]);
    });

    it('stays empty for a task that brought no description', async () => {
        await call(importers.importFromJira, { rows: [{ Summary: 'Imported', Status: 'To Do' }] });
        expect(taskNamed('Imported').descriptionBlock).toEqual({});
    });
});

describe('any new task saved with its description as text alone', () => {
    const newTask = (over) => ({
        TaskName: 'From an email', TaskKey: '-', TaskType: 'task', TaskTypeKey: 1, ProjectID: PROJECT, CompanyId: CID, sprintId: SPRINT,
        sprintArray: { id: SPRINT, name: 'Sprint 1' }, AssigneeUserId: [], watchers: [], isParentTask: true, ParentTaskId: '', deletedStatusKey: 0,
        status: { text: 'To Do', key: 1, type: 'default_active' }, statusType: 'default_active', statusKey: 1, Task_Priority: 'MEDIUM', ...over,
    });
    const create = async (data) => {
        const result = await taskMongo.create({ data, user: { id: OWNER, Employee_Name: 'Olivia Owner' }, projectData: { _id: PROJECT, CompanyId: CID, ProjectCode: 'WEB' }, indexObj: {} });
        await settle();
        return mockDb.store[SCHEMA_TYPE.TASKS].find((task) => String(task._id) === String(result.id));
    };

    it('shows it, as an inbound email does, with no link made of what a stranger sent', async () => {
        const stored = await create(newTask({ rawDescription: 'Hello\nPay at https://example.test/pay', descriptionBlock: {}, origin: { kind: 'email', ref: 'm1' } }));
        expect(stored.descriptionBlock.blocks).toEqual([
            { type: 'paragraph', data: { text: 'Hello' } },
            { type: 'paragraph', data: { text: 'Pay at https://example.test/pay' } },
        ]);
    });

    it('keeps the document the editor sent', async () => {
        const typed = { time: 1, version: '2.30.7', blocks: [{ type: 'paragraph', data: { text: '<b>bold</b>' } }] };
        const stored = await create(newTask({ rawDescription: 'bold', descriptionBlock: typed }));
        expect(stored.descriptionBlock).toEqual(typed);
    });
});
