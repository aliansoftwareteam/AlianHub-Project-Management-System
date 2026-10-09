const C = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const ME = '6f0000000000000000000001';
const P1 = '6f0000000000000000000b01';
const P2 = '6f0000000000000000000b02';
const T1 = '6f0000000000000000000a01';

const WRITES = ['findOneAndUpdate', 'updateOne', 'updateMany', 'update', 'insert', 'insertMany', 'save', 'create', 'deleteOne', 'deleteMany', 'bulkWrite'];

const mockTask = { current: null };
const mockCrud = jest.fn(async (companyId, mongoObj, op) => {
    if (op === 'findOne') return mockTask.current ? { ...mockTask.current } : null;
    if (op === 'find') return [];
    if (op === 'findOneAndUpdate') return { ...mockTask.current, ...(mongoObj.data[1].$set || {}) };
    return null;
});
const mockChat = jest.fn(async () => ({ content: JSON.stringify({ minutes: 210, reasoning: 'Two endpoints and a form' }) }));

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCrud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Sprints/helpers/sprintVisibility', () => ({ ...jest.requireActual('../Modules/Sprints/helpers/sprintVisibility'), hiddenSprintIds: jest.fn(async () => []) }));
jest.mock('../Modules/Tasks/helpers/taskReadAccess', () => require('./fixtures/taskReadByProject').taskReadByProject());
jest.mock('../Modules/Tasks/helpers/taskListProjects', () => require('./fixtures/taskListRules').taskListHeldEverywhere());
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async () => 3),
    evaluatePermission: jest.fn(),
    isPrivileged: (r) => r === 1 || r === 2,
    isWritable: (p) => p === true || p === 1 || p === 2,
}));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider', () => ({
    isAnyProviderConfigured: () => true,
    getProvider: () => ({ chat: (...a) => mockChat(...a) }),
}));
jest.mock('../Modules/EstimatedTime/estimateGrounding', () => ({ buildGrounding: jest.fn(async () => null) }));
jest.mock('../Modules/Tasks/helpers/helper', () => ({ HandleHistory: jest.fn(async () => undefined), convertToDisplayFormat: (m) => `${m}m` }));
jest.mock('../Modules/LogTime/controllerV2/helpers', () => ({ updateRemainingTime: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/EstimatedTime/helpers/planHistory', () => ({ previousPlanOf: jest.fn(async () => null), recordPlanChange: jest.fn(async () => undefined) }));

const { evaluatePermission } = require('../Config/permissionGuard');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const socketEmitter = require('../event/socketEventEmitter');
const { HandleHistory } = require('../Modules/Tasks/helpers/helper');
const estimates = require('../Modules/EstimatedTime/controller');
const routes = require('../Modules/EstimatedTime/routes');

const res = () => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    r.send = r.json;
    return r;
};

const request = (over = {}) => ({ headers: { companyid: C }, params: { tid: T1 }, body: { userId: ME, userName: 'Me' }, query: {}, uid: ME, ...over });

const propose = async (over) => {
    const r = res();
    await estimates.proposeAiEstimate(request(over), r);
    return r;
};

const writesMade = () => mockCrud.mock.calls.filter(([, , op]) => WRITES.includes(op));

beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    jest.clearAllMocks();
    mockTask.current = { _id: T1, TaskName: 'Build the signup form', rawDescription: 'Two endpoints and a React form', ProjectID: P1, totalEstimatedTime: 120, isParentTask: true };
    visibleProjectIds.mockResolvedValue([P1]);
    evaluatePermission.mockResolvedValue(true);
});

afterEach(() => jest.useRealTimers());

describe('POST /api/v1/estimatedTime/ai/:tid/propose', () => {
    it('is registered beside the write route', () => {
        const app = { get: jest.fn(), put: jest.fn(), post: jest.fn() };
        routes.init(app);
        const paths = app.post.mock.calls.map(([path]) => path);
        expect(paths).toEqual(expect.arrayContaining(['/api/v1/estimatedTime/ai/:tid', '/api/v1/estimatedTime/ai/:tid/propose']));
        const handlers = app.post.mock.calls.find(([path]) => path === '/api/v1/estimatedTime/ai/:tid/propose');
        expect(handlers[handlers.length - 1]).toBe(estimates.proposeAiEstimate);
    });

    it('returns the suggested minutes and reasoning without writing anything', async () => {
        const r = await propose();
        expect(r.code).toBe(200);
        expect(r.body.status).toBe(true);
        expect(r.body.data).toMatchObject({ minutes: 210, reasoning: 'Two endpoints and a form', previousMinutes: 120 });
        expect(mockChat).toHaveBeenCalled();
        expect(writesMade()).toEqual([]);
        expect(socketEmitter.emit).not.toHaveBeenCalled();
        expect(HandleHistory).not.toHaveBeenCalled();
    });

    it('reads only inside the company named by the request', async () => {
        await propose();
        expect(mockCrud).toHaveBeenCalled();
        expect(mockCrud.mock.calls.every(([companyId]) => companyId === C)).toBe(true);
        expect(mockCrud.mock.calls.some(([companyId]) => companyId === OTHER_COMPANY)).toBe(false);
    });

    it('refuses without a company', async () => {
        const r = await propose({ headers: {} });
        expect(r.code).toBe(400);
        expect(mockChat).not.toHaveBeenCalled();
    });

    it('answers not found for a task in a project the caller cannot open, before any model call', async () => {
        mockTask.current = { ...mockTask.current, ProjectID: P2 };
        const r = await propose();
        expect(r.code).toBe(404);
        expect(mockChat).not.toHaveBeenCalled();
        expect(writesMade()).toEqual([]);
    });

    it.each([
        ['no access', null],
        ['read only', false],
    ])('refuses a caller with %s to the estimate, before any model call', async (label, permission) => {
        evaluatePermission.mockResolvedValue(permission);
        const r = await propose();
        expect(r.code).toBe(403);
        expect(mockChat).not.toHaveBeenCalled();
        expect(evaluatePermission).toHaveBeenCalledWith(C, ME, 'task.task_estimated_hours', expect.objectContaining({ projectId: P1 }));
    });

    it.each([1, 2, true])('lets a caller whose estimate permission is %p have a suggestion', async (permission) => {
        evaluatePermission.mockResolvedValue(permission);
        const r = await propose();
        expect(r.code).toBe(200);
    });

    it('asks for a description before estimating', async () => {
        mockTask.current = { ...mockTask.current, rawDescription: '', descriptionBlock: null };
        const r = await propose();
        expect(r.body.status).toBe(false);
        expect(mockChat).not.toHaveBeenCalled();
    });
});

describe('POST /api/v1/estimatedTime/ai/:tid still writes for its callers', () => {
    it('persists the estimate and broadcasts it', async () => {
        const r = res();
        await estimates.generateAiEstimate(request(), r);
        expect(r.code).toBe(200);
        expect(r.body.data.totalEstimatedTime).toBe(210);
        const writes = writesMade();
        expect(writes).toHaveLength(1);
        expect(writes[0][0]).toBe(C);
        expect(writes[0][1].data[1]).toEqual({ $set: { totalEstimatedTime: 210 } });
        expect(socketEmitter.emit).toHaveBeenCalledWith('update', expect.objectContaining({ module: 'task', updatedFields: { totalEstimatedTime: 210 } }));
    });

    it('does not write for a caller who cannot edit the estimate', async () => {
        evaluatePermission.mockResolvedValue(false);
        const r = res();
        await estimates.generateAiEstimate(request(), r);
        expect(r.code).toBe(403);
        expect(writesMade()).toEqual([]);
    });
});
