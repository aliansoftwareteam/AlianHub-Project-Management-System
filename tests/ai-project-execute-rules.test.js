const mockMongo = jest.fn();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockMongo(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Sprints/controller', () => ({ addSprintFun: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/helper', () => ({ HandleHistory: jest.fn(async () => null) }));
jest.mock('../Modules/Tasks/helpers/handleNotification', () => ({ HandleBothNotification: jest.fn(async () => null) }));
jest.mock('../Modules/createProject/controller', () => ({ checkProjectPlan: jest.fn(async () => ({ status: true })), removeProjectCount: jest.fn(async () => null) }));
jest.mock('../Modules/Company/helpers/companyCurrency', () => ({ defaultCurrencyOf: jest.fn(async () => 'USD') }));
jest.mock('../Modules/AIProjectGenerator/sseEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/AIProjectGenerator/executeAgents', () => ({
    prepare: jest.fn(async ({ plan }) => ({ plan, agents: [] })),
    projectFields: jest.fn(() => ({})),
    pairDocs: jest.fn(() => []),
    start: jest.fn(async () => ({})),
}));

const mongoose = require('mongoose');
const { dbCollections } = require('../Config/collections');
const { addSprintFun } = require('../Modules/Sprints/controller');
const executeAgents = require('../Modules/AIProjectGenerator/executeAgents');
const sseEmitter = require('../Modules/AIProjectGenerator/sseEmitter');
const planAutomations = require('../Modules/AIProjectGenerator/planAutomations');
const orchestrator = require('../Modules/AIProjectGenerator/orchestrator');

const C = '6f0000000000000000000c01';
const U = '6f0000000000000000000a01';
const CATALOG = ['ProjectListView', 'ProjectKanban'].map((keyName, at) => ({ _id: `6f00000000000000000001${at}0`, keyName, name: keyName }));
const TELL_CREATOR = { name: 'Tell the creator', trigger: 'task.status_changed', conditions: [{ field: 'statusRef', op: 'changedTo', value: 'Done' }], actions: [{ action: 'notify', config: { recipients: ['task_creator'], message: 'Finished.' } }] };

const plan = () => ({
    project: {
        ProjectName: 'Bike shop',
        projectStatusData: [{ name: 'Planning', type: 'default_active' }, { name: 'Closed', type: 'close' }],
        taskStatusData: [{ name: 'To Do', type: 'default_active' }, { name: 'Done', type: 'close' }],
        taskTypeCounts: [{ name: 'Task', key: 1 }],
        projectIcon: {},
    },
    sprints: [{ sprintName: 'W1', tasks: [] }],
    rules: [TELL_CREATOR],
});

beforeEach(() => {
    mockMongo.mockReset();
    mockMongo.mockImplementation(async (companyId, { type, data }, op) => {
        if (op === 'find') return type === dbCollections.PROJECT_TAB_COMPONENTS ? CATALOG : [];
        if (op === 'save') return data;
        return null;
    });
    addSprintFun.mockResolvedValue({ data: { _id: new mongoose.Types.ObjectId() } });
    sseEmitter.emit.mockClear();
    executeAgents.start.mockReset();
    executeAgents.start.mockResolvedValue({});
});
afterEach(() => jest.restoreAllMocks());

describe('executePlan and the planned rules', () => {
    it('makes the rules last, in the saved project, and reports what was made and not', async () => {
        const order = [];
        executeAgents.start.mockImplementation(async () => { order.push('agents'); return {}; });
        const makeRules = jest.spyOn(planAutomations, 'makeRules').mockImplementation(async () => {
            order.push('rules');
            return { made: [{ name: 'Tell the creator', ruleId: 'r1' }], notMade: [{ name: 'Review subtask', reason: 'x', code: 'admin' }] };
        });
        const out = await orchestrator.executePlan({ plan: plan(), companyId: C, uid: U, userData: { id: U, Employee_Name: 'Me' }, jobId: 'job-1' });

        expect(out.ok).toBe(true);
        expect(order).toEqual(['agents', 'rules']);
        expect(makeRules).toHaveBeenCalledWith({ companyId: C, uid: U, projectId: out.projectId, plan: expect.objectContaining({ rules: [TELL_CREATOR] }) });
        const complete = sseEmitter.emit.mock.calls.map(([, payload]) => payload).find((payload) => payload.event === 'complete');
        expect(complete.rules).toEqual({ made: [{ name: 'Tell the creator', ruleId: 'r1' }], notMade: [{ name: 'Review subtask', reason: 'x', code: 'admin' }] });
    });

    it('keeps the project when no rule could be made', async () => {
        jest.spyOn(planAutomations, 'makeRules').mockResolvedValue({ made: [], notMade: [{ name: 'Tell the creator', reason: 'x', code: 'other' }] });
        const out = await orchestrator.executePlan({ plan: plan(), companyId: C, uid: U, userData: { id: U }, jobId: 'job-2' });
        expect(out.ok).toBe(true);
        expect(sseEmitter.emit.mock.calls.some(([, payload]) => payload.event === 'error')).toBe(false);
    });
});

describe('executePlan and the project plan check', () => {
    const createProject = require('../Modules/createProject/controller');
    const { SCHEMA_TYPE } = require('../Config/schemaType');
    const savedProjects = () => mockMongo.mock.calls.filter(([, { type }, op]) => op === 'save' && type === SCHEMA_TYPE.PROJECTS);

    beforeEach(() => {
        addSprintFun.mockClear();
        createProject.removeProjectCount.mockClear();
    });

    it('stops before anything is made when the check does not pass, and gives the count back', async () => {
        createProject.checkProjectPlan.mockResolvedValueOnce({ status: false, statusText: 'The plan allows no more projects.' });
        const out = await orchestrator.executePlan({ plan: plan(), companyId: C, uid: U, userData: { id: U }, jobId: 'job-3' });
        expect(out).toEqual({ ok: false, error: 'The plan allows no more projects.' });
        expect(savedProjects()).toHaveLength(0);
        expect(addSprintFun).not.toHaveBeenCalled();
        expect(createProject.removeProjectCount).toHaveBeenCalledWith(C, false);
    });

    it('leaves the count alone when the check could not count the project', async () => {
        createProject.checkProjectPlan.mockRejectedValueOnce({ status: false, countRollBack: false });
        const out = await orchestrator.executePlan({ plan: plan(), companyId: C, uid: U, userData: { id: U }, jobId: 'job-4' });
        expect(out.ok).toBe(false);
        expect(savedProjects()).toHaveLength(0);
        expect(createProject.removeProjectCount).not.toHaveBeenCalled();
    });
});
