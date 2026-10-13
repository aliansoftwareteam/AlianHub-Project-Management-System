const mockMongo = jest.fn();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockMongo(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Sprints/controller', () => ({ addSprintFun: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/helper', () => ({ HandleHistory: jest.fn(async () => null) }));
jest.mock('../Modules/Tasks/helpers/handleNotification', () => ({ HandleBothNotification: jest.fn(async () => null) }));
jest.mock('../Modules/createProject/controller', () => ({ checkProjectPlan: jest.fn(async () => null), removeProjectCount: jest.fn(async () => null) }));
jest.mock('../Modules/Company/helpers/companyCurrency', () => ({ defaultCurrencyOf: jest.fn(async () => 'USD') }));
jest.mock('../Modules/AIProjectGenerator/sseEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/AIProjectGenerator/executeAgents', () => ({
    prepare: jest.fn(async ({ plan }) => ({ plan, agents: [] })),
    projectFields: jest.fn(() => ({})),
    pairDocs: jest.fn(() => []),
    start: jest.fn(async () => ({})),
}));

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { addSprintFun } = require('../Modules/Sprints/controller');
const sseEmitter = require('../Modules/AIProjectGenerator/sseEmitter');
const planViews = require('../Modules/AIProjectGenerator/planViews');
const orchestrator = require('../Modules/AIProjectGenerator/orchestrator');

const C = '6f0000000000000000000c01';
const U = '6f0000000000000000000a01';
const CATALOG = ['ProjectListView', 'ProjectKanban', 'Calendar', 'TableView'].map((keyName, at) => ({ _id: `6f00000000000000000001${at}0`, keyName, name: keyName }));

const plan = () => ({
    project: {
        ProjectName: 'Bike shop',
        projectStatusData: [{ name: 'Planning', type: 'default_active' }, { name: 'Closed', type: 'close' }],
        taskStatusData: [{ name: 'To Do', type: 'default_active' }, { name: 'Done', type: 'close' }],
        taskTypeCounts: [{ name: 'Task', key: 1 }],
        projectIcon: {},
    },
    sprints: [{ sprintName: 'W1', tasks: [] }],
    views: [{ name: 'Board by person', kind: 'board', look: { groupBy: 'assignee' } }, { name: 'Due dates', kind: 'calendar' }],
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
});
afterEach(() => jest.restoreAllMocks());

describe('executePlan and the planned views', () => {
    it('makes the views in the saved project, drops the tab of a kind with no view made, and reports both', async () => {
        const makeViews = jest.spyOn(planViews, 'makeViews').mockResolvedValue({
            made: [{ name: 'Board by person', kind: 'board' }],
            notMade: [{ name: 'Due dates', reason: 'x', code: 'permission' }],
        });
        const out = await orchestrator.executePlan({ plan: plan(), companyId: C, uid: U, userData: { id: U, Employee_Name: 'Me' }, jobId: 'job-1' });

        expect(out.ok).toBe(true);
        const saved = mockMongo.mock.calls.find(([, , op]) => op === 'save')[1].data;
        expect(makeViews).toHaveBeenCalledWith({ companyId: C, uid: U, projectId: String(saved._id), views: expect.any(Array) });
        expect(makeViews.mock.calls[0][0].projectId).toBe(out.projectId);
        expect(saved.ProjectRequiredComponent.map((tab) => tab.keyName)).toEqual(['ProjectListView', 'ProjectKanban']);

        const pull = mockMongo.mock.calls.find(([, { type, data }, op]) => op === 'updateOne' && type === SCHEMA_TYPE.PROJECTS && data[1].$pull);
        expect(pull[1].data).toEqual([{ _id: saved._id }, { $pull: { ProjectRequiredComponent: { _id: { $in: [CATALOG[2]._id] } } } }]);

        const complete = sseEmitter.emit.mock.calls.map(([, payload]) => payload).find((payload) => payload.event === 'complete');
        expect(complete.views).toEqual({ made: [{ name: 'Board by person', kind: 'board' }], notMade: [{ name: 'Due dates', reason: 'x', code: 'permission' }] });
    });

    it('keeps a planned tab once a view of its kind is made', async () => {
        jest.spyOn(planViews, 'makeViews').mockResolvedValue({ made: [{ name: 'Due dates', kind: 'calendar' }], notMade: [] });
        await orchestrator.executePlan({ plan: plan(), companyId: C, uid: U, userData: { id: U }, jobId: 'job-2' });
        expect(mockMongo.mock.calls.some(([, { data }, op]) => op === 'updateOne' && Array.isArray(data) && data[1] && data[1].$pull)).toBe(false);
    });
});
