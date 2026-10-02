/* A task that is made without a person at the keyboard (a repeat, a mail to an inbox, the AI project generator)
   names only people who hold a seat and can open its project at the time it is made. */
const mongoose = require('mongoose');

const mockDb = require('./fixtures/fakeMongo').create();
const mockInserted = [];
const mockCreate = jest.fn(async ({ data }) => ({ status: true, id: String(data._id) }));

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: async (companyId, query, method) => {
        if (method === 'insertMany') { mockInserted.push({ type: query.type, data: query.data }); return query.data[0]; }
        return mockDb.crud(companyId, query, method);
    },
}));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn(), recordAuditFromReq: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/task_class_Mongo', () => ({ taskMongo: { create: (...args) => mockCreate(...args) } }));
jest.mock('../Modules/Tasks/helpers/taskMongo/internals.js', () => ({ updateTaskKey: jest.fn(async () => undefined) }));
jest.mock('../Modules/Sprints/controller', () => ({ addSprintFun: jest.fn() }));
jest.mock('../Modules/Sprints/helpers/actingUser', () => ({ actingUser: jest.fn(async (req) => ({ id: String(req.uid), Employee_Name: 'Maker' })) }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const recurring = require('../Modules/RecurringTasks/helper');
const taskRule = require('../Modules/RecurringTasks/taskRule');
const emailIn = require('../Modules/EmailIn/controller');

const C = '6f0000000000000000000c01';
const MAKER = '6f0000000000000000000d01';
const ON_PROJECT = '6f0000000000000000000d02';
const LEFT_PROJECT = '6f0000000000000000000d03';
const LEFT_COMPANY = '6f0000000000000000000d04';
const PROJECT = '6f0000000000000000000a01';
const SPRINT = '6f0000000000000000000501';
const TASK = '6f0000000000000000000b01';
const TOKEN = 'a'.repeat(36);
const NAMED = [ON_PROJECT, LEFT_PROJECT, LEFT_COMPANY];
const oid = (id) => new mongoose.Types.ObjectId(id);

const seat = (userId, extra = {}) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType: 3, status: 2, isDelete: false, ...extra });
const template = (extra = {}) => ({
    TaskName: 'Weekly report', TaskKey: '-', AssigneeUserId: [...NAMED], watchers: [], TaskType: 'task', TaskTypeKey: 1, ProjectID: PROJECT, CompanyId: C,
    status: { text: 'To Do', key: 1, type: 'default_active' }, isParentTask: true, Task_Leader: MAKER, statusKey: 1, ...extra,
});
const projectSnapshot = { _id: PROJECT, CompanyId: C, ProjectCode: 'LN', ProjectName: 'Launch' };
const made = () => mockCreate.mock.calls.map(([{ data }]) => data);

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    res.send = res.json;
    return res;
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((type) => { mockDb.store[type].length = 0; });
    mockInserted.length = 0;
    mockCreate.mockClear();
    myCache.flushAll();
    seat(MAKER);
    seat(ON_PROJECT);
    seat(LEFT_PROJECT);
    seat(LEFT_COMPANY, { isDelete: true });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(PROJECT), ProjectName: 'Launch', ProjectCode: 'LN', isPrivateSpace: true, AssigneeUserId: [MAKER, ON_PROJECT] });
});

describe('a task that repeats', () => {
    const due = () => mockDb.seed(SCHEMA_TYPE.RECURRING_TASKS, {
        _id: oid('6f0000000000000000000e01'), name: 'Weekly report', ProjectID: oid(PROJECT), sprintId: SPRINT, enabled: true, deletedStatusKey: 0,
        freq: 'daily', interval: 1, runHour: 9, runCount: 0, nextRunAt: new Date('2026-10-01T09:00:00Z'), missedPolicy: 'create',
        templateSnapshot: template(), projectSnapshot, userSnapshot: { id: MAKER, Employee_Name: 'Maker', companyOwnerId: '' }, createdBy: MAKER,
    });

    it('is made at each run for the people who can still open the project, and is made all the same', async () => {
        due();
        const out = await recurring.processDueForCompany(C, new Date('2026-10-02T10:00:00Z'));
        expect(out.created).toBe(1);
        expect(made().map((data) => data.AssigneeUserId)).toEqual([[ON_PROJECT]]);
    });

    it('names a person again once they are back on the project', async () => {
        due();
        mockDb.store[SCHEMA_TYPE.PROJECTS][0].AssigneeUserId.push(LEFT_PROJECT);
        await recurring.processDueForCompany(C, new Date('2026-10-02T10:00:00Z'));
        expect(made()[0].AssigneeUserId).toEqual([ON_PROJECT, LEFT_PROJECT]);
    });

    it('set on a task takes over only the assignees who can open the project', async () => {
        mockDb.seed(SCHEMA_TYPE.TASKS, { _id: oid(TASK), TaskName: 'Weekly report', ProjectID: oid(PROJECT), sprintId: oid(SPRINT), AssigneeUserId: [...NAMED], deletedStatusKey: 0, TaskType: 'task', TaskTypeKey: 1 });
        const res = response();
        await taskRule.saveForTask({ uid: MAKER, headers: { companyid: C }, params: { taskId: TASK }, body: { freq: 'weekly', interval: 1, byweekday: [1], runHour: 9 } }, res);
        expect(res.body).toMatchObject({ status: true });
        const [rule] = mockDb.store[SCHEMA_TYPE.RECURRING_TASKS];
        expect(rule.templateSnapshot.AssigneeUserId).toEqual([ON_PROJECT]);
    });
});

describe('a mail to an inbox', () => {
    const inbox = () => mockDb.seed(SCHEMA_TYPE.EMAIL_INBOXES, {
        _id: oid('6f0000000000000000000e02'), token: TOKEN, companyId: C, name: 'Support', ProjectID: PROJECT, sprintId: SPRINT, enabled: true, deletedStatusKey: 0,
        templateSnapshot: template({ TaskName: '' }), projectSnapshot, userSnapshot: { id: MAKER, Employee_Name: 'Maker', companyOwnerId: '' }, createdBy: MAKER,
    });

    it('becomes a task for the people who can still open the project, and the task is made all the same', async () => {
        inbox();
        const res = response();
        await emailIn.receiveEmail({ params: { token: TOKEN }, body: { from: 'someone@example.test', subject: 'Printer is down', text: 'Since this morning.' } }, res);
        expect(res.body).toMatchObject({ status: true });
        expect(made().map((data) => data.AssigneeUserId)).toEqual([[ON_PROJECT]]);
    });
});

describe('the AI project generator', () => {
    const project = {
        _id: oid(PROJECT), CompanyId: C, ProjectName: 'Launch', ProjectCode: 'LN', lastTaskId: 0, LeadUserId: [],
        taskTypeCounts: [{ name: 'Task', key: 1, value: 'task' }], taskStatusData: [{ name: 'To Do', key: 1, type: 'default_active' }],
    };

    it('assigns a task and its subtasks only to people who can open the project', async () => {
        const { createTasksForSprint } = require('../Modules/AIProjectGenerator/orchestrator');
        await createTasksForSprint({
            companyId: C, projectDoc: project, sprintDoc: { _id: oid(SPRINT), name: 'Sprint 1' }, creatorUid: MAKER, statusByName: new Map(), taskTypeByKey: new Map(),
            tasks: [{ TaskName: 'Plan the launch', AssigneeUserId: [...NAMED], subtasks: [{ TaskName: 'Book the venue', AssigneeUserId: [LEFT_PROJECT] }] }],
        });
        const docs = mockInserted.filter((call) => call.type === SCHEMA_TYPE.TASKS).flatMap((call) => call.data[0]);
        expect(docs.map((doc) => [doc.TaskName, doc.AssigneeUserId, doc.watchers, doc.Task_Leader])).toEqual([
            ['Plan the launch', [ON_PROJECT], [ON_PROJECT, MAKER], ON_PROJECT],
            ['Book the venue', [], [MAKER], MAKER],
        ]);
    });
});
