const verified = require('./fixtures/verifiedRequest');
const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
const mockSaveSettings = jest.fn(async (companyId, patch) => patch);

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/task_class_Mongo', () => ({ taskMongo: { create: jest.fn() } }));
jest.mock('../Modules/Project/helpers/projectItemHistory', () => ({ recordChecklistChange: jest.fn(async () => undefined) }));
jest.mock('../Modules/TimeSheet/helpers/reminderSettings', () => ({
    getCompanySettings: jest.fn(async () => ({ enabled: true, userIds: [] })),
    updateCompanySettings: (...args) => mockSaveSettings(...args),
}));
jest.mock('../Modules/EstimatedTime/aiTaskEstimator', () => ({ estimateAndPersist: jest.fn(), _internal: {} }));
jest.mock('../Modules/LogTime/controllerV2/helpers', () => ({ updateRemainingTime: jest.fn() }));
jest.mock('../Modules/EstimatedTime/helpers/planHistory', () => ({ previousPlanOf: jest.fn(async () => null), recordPlanChange: jest.fn(async () => undefined) }));
jest.mock('../Modules/PersonalList/ownership', () => ({ ...jest.requireActual('../Modules/PersonalList/ownership'), othersPersonalListIds: jest.fn(async () => []) }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { NOT_A_MEMBER } = require('../Config/companyMembers');
const { CANNOT_OPEN_PROJECT } = require('../Config/projectPeople');
const dashboards = require('../Modules/UserDashboard/controller');
const checklist = require('../Modules/Project/controller/checklist');
const estimates = require('../Modules/EstimatedTime/controller');
const timeReminders = require('../Modules/TimeSheet/controller/timeReminders');
const emailIn = require('../Modules/EmailIn/controller');
const billing = require('../Modules/Milestone/controller/billing');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const ON_PROJECT = 'a00000000000000000000002';
const NOT_ON_PROJECT = 'a00000000000000000000003';
const LEFT = 'a00000000000000000000004';
const NOBODY = 'a00000000000000000000009';
const oid = () => new mongoose.Types.ObjectId().toString();

const call = async (handler, { uid = OWNER, params = {}, body = {} } = {}) => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((payload) => { res.body = payload; return res; });
    res.send = res.json;
    res.set = jest.fn(() => res);
    await handler(verified({ uid, params, body, query: {}, headers: { companyid: C } }), res);
    return res;
};
const textOf = (res) => JSON.stringify(res.body);

let project;

beforeEach(() => {
    myCache.flushAll();
    jest.clearAllMocks();
    mockDb = fakeMongo.create();
    [[OWNER, 1, false], [ON_PROJECT, 3, false], [NOT_ON_PROJECT, 3, false], [LEFT, 3, true]].forEach(([userId, roleType, isDelete]) => {
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete });
        mockDb.seed(SCHEMA_TYPE.USERS, { _id: userId, Employee_Name: `Person ${userId.slice(-1)}` });
    });
    project = String(mockDb.seed(SCHEMA_TYPE.PROJECTS, {
        _id: oid(), ProjectName: 'Board', ProjectCode: 'BRD', isPrivateSpace: true, AssigneeUserId: [ON_PROJECT, LEFT],
        checklistArray: [{ id: 'row-1', name: 'Sign the lease', AssigneeUserId: [LEFT], isChecked: false }],
    })._id);
});

describe('a dashboard is shared with members of the workspace', () => {
    const shared = () => mockDb.store[SCHEMA_TYPE.USERDASHBOARD][0].sharedWith;
    const share = (sharedWith) => call(dashboards.updateSharedDashboard, { params: { id: String(mockDb.store[SCHEMA_TYPE.USERDASHBOARD][0]._id) }, body: { sharedWith } });

    beforeEach(() => mockDb.seed(SCHEMA_TYPE.USERDASHBOARD, { _id: oid(), title: 'Numbers', ownerId: OWNER, userId: OWNER, visibility: 'people', sharedWith: [LEFT], isShared: true }));

    it('takes members, and keeps the people it already holds', async () => {
        expect((await share([LEFT, ON_PROJECT])).body).toMatchObject({ status: true });
        expect(shared()).toEqual([LEFT, ON_PROJECT]);
    });

    it('answers 400 when someone of no workspace is added', async () => {
        const res = await share([LEFT, NOBODY]);
        expect(res.statusCode).toBe(400);
        expect(textOf(res)).toContain(NOT_A_MEMBER);
        expect(shared()).toEqual([LEFT]);
    });
});

describe('the people on a project\'s checklist', () => {
    const rows = () => mockDb.store[SCHEMA_TYPE.PROJECTS][0].checklistArray;
    const write = (body) => call(checklist.handleChecklist, { body: { id: project, ...body } });

    it('takes a member who can open the project', async () => {
        expect((await write({ operation: 'update', key: 'assigneeAdd', checklistItem: { id: 'row-1', uid: ON_PROJECT } })).body).toMatchObject({ status: true });
        expect(rows()[0].AssigneeUserId).toEqual([LEFT, ON_PROJECT]);
    });

    it('lets a row be ticked while it still names someone who has left', async () => {
        const res = await write({ operation: 'update', key: 'isChecked', checklistItem: [{ ...rows()[0], isChecked: true }] });
        expect(res.body).toMatchObject({ status: true });
        expect(rows()[0]).toMatchObject({ isChecked: true, AssigneeUserId: [LEFT] });
    });

    it.each([
        ['someone of no workspace', NOBODY, NOT_A_MEMBER],
        ['a member who cannot open the project', NOT_ON_PROJECT, CANNOT_OPEN_PROJECT],
    ])('answers 400 when %s is named, however the write is shaped', async (_label, named, reason) => {
        const writes = [
            { operation: 'update', key: 'assigneeAdd', checklistItem: { id: 'row-1', uid: named } },
            { operation: 'push', checklistItem: { id: 'row-2', name: 'New', AssigneeUserId: [named] } },
            { operation: 'update', key: 'isChecked', checklistItem: [{ id: 'row-1', name: 'Sign the lease', AssigneeUserId: [named] }] },
        ];
        for (const body of writes) {
            // eslint-disable-next-line no-await-in-loop
            const res = await write(body);
            expect(res.statusCode).toBe(400);
            expect(textOf(res)).toContain(reason);
        }
        expect(rows()).toEqual([{ id: 'row-1', name: 'Sign the lease', AssigneeUserId: [LEFT], isChecked: false }]);
    });
});

describe('the person time is planned for', () => {
    const task = () => String(mockDb.seed(SCHEMA_TYPE.TASKS, { _id: oid(), ProjectID: project, TaskName: 'Plan' })._id);
    const plan = (userId) => call(estimates.updateEstimatedTime, { body: { userId, taskId: task(), projectId: project, date: '2026-05-01T00:00:00.000Z', minutes: 60 } });
    const plans = () => mockDb.store[SCHEMA_TYPE.ESTIMATES_TIME] || [];

    it('is a member who can open the project', async () => {
        expect((await plan(ON_PROJECT)).statusCode).toBe(200);
        expect(plans()).toHaveLength(1);
    });

    it.each([
        ['someone of no workspace', NOBODY, NOT_A_MEMBER],
        ['a member who cannot open the project', NOT_ON_PROJECT, CANNOT_OPEN_PROJECT],
    ])('answers 400 when %s is named', async (_label, named, reason) => {
        const res = await plan(named);
        expect(res.statusCode).toBe(400);
        expect(textOf(res)).toContain(reason);
        expect(plans()).toHaveLength(0);
    });
});

describe('the people who are reminded to log their time', () => {
    it('are kept to the members of the workspace', async () => {
        const res = await call(timeReminders.updateReminderSettings, { body: { userIds: [ON_PROJECT, LEFT, NOBODY, { $ne: '' }] } });
        expect(res.body).toMatchObject({ status: true });
        expect(mockSaveSettings.mock.calls[0][1]).toEqual({ userIds: [ON_PROJECT] });
    });
});

describe('the people an email inbox gives its tasks to', () => {
    it('are kept to the members who can open its project', async () => {
        mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(), projectId: project, name: 'List', private: false, deletedStatusKey: 0 });
        const res = await call(emailIn.createInbox, { body: { projectId: project, assignees: [ON_PROJECT, NOT_ON_PROJECT, LEFT] } });
        expect(res.body).toMatchObject({ status: true });
        expect(mockDb.store[SCHEMA_TYPE.EMAIL_INBOXES][0].templateSnapshot.AssigneeUserId).toEqual([ON_PROJECT]);
    });
});

describe('the person who signs off a milestone', () => {
    const milestones = () => mockDb.store[SCHEMA_TYPE.MILESTONE] || [];
    const make = (signOffUserId) => call(billing.createBillingMilestone, { body: { projectId: project, milestoneName: 'Phase 1', amount: 100, signOffUserId } });

    it('is a member who can open the project', async () => {
        expect((await make(ON_PROJECT)).body).toMatchObject({ status: true });
        expect(milestones()[0].signOffUserId).toBe(ON_PROJECT);
    });

    it.each([['someone who left', LEFT], ['a member who cannot open the project', NOT_ON_PROJECT]])('is not %s, on a new milestone or a saved one', async (_label, named) => {
        expect((await make(named)).body).toMatchObject({ status: false });
        expect(milestones()).toHaveLength(0);
        const saved = mockDb.seed(SCHEMA_TYPE.MILESTONE, { _id: oid(), projectId: project, milestoneName: 'Phase 2', signOffUserId: ON_PROJECT });
        const res = await call(billing.updateBillingMilestone, { params: { id: String(saved._id) }, body: { projectId: project, signOffUserId: named } });
        expect(res.body).toMatchObject({ status: false });
        expect(milestones()[0].signOffUserId).toBe(ON_PROJECT);
    });
});
