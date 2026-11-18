/* Task 047, S2-D: the generator's plan may hold one dashboard. Its cards are held to the ones a connected AI's plan
   takes, the person can leave it out on the plan card, and it is made after the project, as that person, through
   the same plan part; a dashboard that is not made never undoes the project. */
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
const sseEmitter = require('../Modules/AIProjectGenerator/sseEmitter');
const projectSetup = require('../Modules/Agents/projectSetup');
const planDashboard = require('../Modules/AIProjectGenerator/planDashboard');
const planPicks = require('../Modules/AIProjectGenerator/planPicks');
const { PlanSchema } = require('../Modules/AIProjectGenerator/schemaValidator');
const orchestrator = require('../Modules/AIProjectGenerator/orchestrator');

const C = '6f0000000000000000000c01';
const U = '6f0000000000000000000a01';
const BOARD = { name: 'Shop at a glance', cards: ['tasks_by_status', 'due_soon'] };

const plan = (extra = {}) => ({
    project: {
        ProjectName: 'Bike shop',
        projectStatusData: [{ name: 'Planning', type: 'default_active' }, { name: 'Closed', type: 'close' }],
        taskStatusData: [{ name: 'To Do', type: 'default_active' }, { name: 'Done', type: 'close' }],
        taskTypeCounts: [{ name: 'Task', key: 1 }],
        projectIcon: {},
    },
    sprints: [{ sprintName: 'W1', tasks: [] }],
    ...extra,
});

beforeEach(() => {
    mockMongo.mockReset();
    mockMongo.mockImplementation(async (companyId, { type, data }, op) => {
        if (op === 'find') return type === dbCollections.PROJECT_TAB_COMPONENTS ? [{ _id: '6f0000000000000000000100', keyName: 'ProjectListView', name: 'List' }] : [];
        if (op === 'save') return data;
        return null;
    });
    addSprintFun.mockResolvedValue({ data: { _id: new mongoose.Types.ObjectId() } });
    sseEmitter.emit.mockClear();
});
afterEach(() => jest.restoreAllMocks());

describe('the plan holds the dashboard a connected AI\'s plan takes', () => {
    it('keeps a known card once, at most six, and names each by the component the editor draws', () => {
        const { kept, dropped } = planDashboard.trimDashboard({ name: ' Shop  at a glance ', cards: ['tasks_by_status', 'velocity', 'tasks_by_status', 'due_soon'] });
        expect(dropped).toBeNull();
        expect(kept).toEqual({ name: 'Shop at a glance', cards: ['tasks_by_status', 'due_soon'], cardKeys: ['TasksByStatusCard', 'DueSoonCard'] });
        const many = planDashboard.trimDashboard({ name: 'All', cards: ['due_soon', 'my_time', 'project_pulse', 'logged_vs_estimate', 'free_capacity', 'at_risk', 'tasks_by_status'] });
        expect(many.kept.cards).toHaveLength(6);
    });

    it('drops a dashboard with no name or no card it can make, with the reason', () => {
        expect(planDashboard.trimDashboard({ cards: ['due_soon'] })).toEqual({ kept: null, dropped: { name: '', code: 'name_missing' } });
        expect(planDashboard.trimDashboard({ name: 'Odd', cards: ['velocity'] })).toEqual({ kept: null, dropped: { name: 'Odd', code: 'no_cards' } });
        expect(planDashboard.trimDashboard(null)).toEqual({ kept: null, dropped: null });
    });

    it('passes the schema, null included, so a plan is never sent back for its dashboard', () => {
        const dashboardIssues = (given) => {
            const read = PlanSchema.safeParse(plan({ dashboard: given }));
            return read.success ? [] : read.error.issues.filter((issue) => issue.path[0] === 'dashboard');
        };
        expect(dashboardIssues(BOARD)).toEqual([]);
        expect(dashboardIssues(null)).toEqual([]);
        expect(dashboardIssues({ name: 'Odd', cards: 'due_soon' })).not.toEqual([]);
    });
});

describe('the person can leave it out', () => {
    it('counts it as one part and drops it when it is not ticked', () => {
        const held = plan({ dashboard: BOARD });
        expect(planPicks.countsOf(held).dashboards).toBe(1);
        expect(planPicks.narrow(held, { lists: [0] }).plan.dashboard).toBeUndefined();
        expect(planPicks.narrow(held, { lists: [0], dashboards: [0] }).plan.dashboard).toEqual(BOARD);
        expect(planPicks.narrow(held, undefined).plan.dashboard).toEqual(BOARD);
    });
});

describe('it is made after the project, as the person who ran the generator', () => {
    it('goes through the plan part, and says whether it is shown on the project', async () => {
        const carryOut = jest.spyOn(projectSetup, 'carryOut').mockResolvedValue([{ part: 'dashboards', ok: true, items: [{ name: BOARD.name, made: true, shared: true }] }]);
        const out = await orchestrator.executePlan({ plan: plan({ dashboard: BOARD }), companyId: C, uid: U, userData: { id: U }, jobId: 'job-d1' });
        expect(out.ok).toBe(true);
        expect(carryOut).toHaveBeenCalledWith(expect.objectContaining({
            companyId: C, projectId: out.projectId, who: expect.objectContaining({ uid: U }), plan: { dashboards: [{ name: BOARD.name, cards: BOARD.cards }] },
        }));
        const complete = sseEmitter.emit.mock.calls.map(([, payload]) => payload).find((payload) => payload.event === 'complete');
        expect(complete.dashboard).toEqual({ name: BOARD.name, made: true, shared: true });
    });

    it('reports one that was not made and keeps the project', async () => {
        jest.spyOn(projectSetup, 'carryOut').mockRejectedValue(new Error('the route failed'));
        const out = await orchestrator.executePlan({ plan: plan({ dashboard: BOARD }), companyId: C, uid: U, userData: { id: U }, jobId: 'job-d2' });
        expect(out).toMatchObject({ ok: true, dashboard: { name: BOARD.name, made: false, reason: 'the route failed' } });
    });

    it('makes nothing for a plan without one', async () => {
        const carryOut = jest.spyOn(projectSetup, 'carryOut');
        const out = await orchestrator.executePlan({ plan: plan(), companyId: C, uid: U, userData: { id: U }, jobId: 'job-d3' });
        expect(out.dashboard).toBeNull();
        expect(carryOut).not.toHaveBeenCalled();
    });
});
