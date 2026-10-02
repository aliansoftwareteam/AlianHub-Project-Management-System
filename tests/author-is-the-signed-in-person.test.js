const verified = require('./fixtures/verifiedRequest');
const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
const mockEstimate = jest.fn(async () => ({ status: true, minutes: 90 }));

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/RecurringTasks/helper', () => ({ computeNextRun: jest.fn(() => new Date('2026-11-02T09:00:00Z')), announce: jest.fn() }));
jest.mock('../Modules/EstimatedTime/aiTaskEstimator', () => ({
    estimateAndPersist: (...args) => mockEstimate(...args),
    proposeEstimate: jest.fn(),
    _internal: { extractDescription: () => 'Build the form' },
}));
jest.mock('../Modules/AI/taskAccess', () => ({ visibleTask: jest.fn(async ({ taskId }) => ({ _id: taskId, ProjectID: 'b00000000000000000000001', isParentTask: false })), TASK_NOT_FOUND: 'Task not found' }));
jest.mock('../Modules/LogTime/controllerV2/helpers', () => ({ updateRemainingTime: jest.fn() }));
jest.mock('../Modules/EstimatedTime/helpers/planHistory', () => ({ previousPlanOf: jest.fn(async () => null), recordPlanChange: jest.fn(async () => undefined) }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const recurring = require('../Modules/RecurringTasks/controller');
const epics = require('../Modules/Epics/controller');
const estimates = require('../Modules/EstimatedTime/controller');

const C = 'c00000000000000000000001';
const CALLER = 'a00000000000000000000001';
const SOMEONE = 'a00000000000000000000002';
const PROJECT = 'b00000000000000000000001';
const TASK = 'd00000000000000000000001';
const CLAIMED = { id: SOMEONE, _id: SOMEONE, Employee_Name: 'Somebody Else', companyOwnerId: SOMEONE };

const call = async (handler, { params = {}, body = {} } = {}) => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((payload) => { res.body = payload; return res; });
    res.send = res.json;
    await handler(verified({ uid: CALLER, params, body, query: {}, headers: { companyid: C } }), res);
    return res;
};

beforeEach(() => {
    myCache.flushAll();
    jest.clearAllMocks();
    mockDb = fakeMongo.create();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: CALLER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: SOMEONE, roleType: 3, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: CALLER, Employee_Name: 'Stored Caller' });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: SOMEONE, Employee_Name: 'Stored Someone' });
});

describe('what a person makes is recorded under the person who signed in', () => {
    it('records a repeating task under the caller, who also leads its tasks', async () => {
        const res = await call(recurring.createDefinition, {
            body: { name: 'Weekly report', taskName: 'Write the report', freq: 'weekly', projectData: { _id: PROJECT, CompanyId: C, ProjectName: 'Launch' }, userData: CLAIMED },
        });
        expect(res.body).toMatchObject({ status: true });
        const [saved] = mockDb.store[SCHEMA_TYPE.RECURRING_TASKS];
        expect(saved.createdBy).toBe(CALLER);
        expect(saved.userSnapshot).toMatchObject({ id: CALLER, Employee_Name: 'Stored Caller' });
        expect(saved.templateSnapshot.Task_Leader).toBe(CALLER);
        expect(JSON.stringify(saved)).not.toContain(SOMEONE);
    });

    it('records an epic under the caller', async () => {
        const res = await call(epics.createEpic, { body: { name: 'Checkout', projectId: PROJECT, userData: CLAIMED } });
        expect(res.body).toMatchObject({ status: true });
        expect(mockDb.store[SCHEMA_TYPE.EPICS][0].createdBy).toBe(CALLER);
    });

    it('writes an estimate\'s history under the caller', async () => {
        const res = await call(estimates.generateAiEstimate, { params: { tid: TASK }, body: { userId: SOMEONE, userName: 'Somebody Else' } });
        expect(res.body).toMatchObject({ status: true });
        expect(mockEstimate.mock.calls[0][0].userData).toEqual({ id: CALLER, Employee_Name: 'Stored Caller' });
    });
});
