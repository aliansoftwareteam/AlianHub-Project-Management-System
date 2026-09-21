const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Agents/actions', () => ({
    authorizeRead: jest.fn(async () => true),
    perform: jest.fn(async ({ action }) => ({ auditId: 'audit-1', result: { action }, undo: { kind: 'x' } })),
    RefusedError: class RefusedError extends Error {},
}));
jest.mock('../Modules/Automations/engine/tools', () => ({ oid: (id) => (/^[0-9a-fA-F]{24}$/.test(String(id)) ? String(id) : null) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(async () => ['6f00000000000000000000a1']) }));
jest.mock('../Config/permissionGuard', () => ({ ...jest.requireActual('../Config/permissionGuard'), getRoleType: jest.fn(async () => 3) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const actions = require('../Modules/Agents/actions');
const tools = require('../Modules/Mcp/tools');

const C = '6f0000000000000000000c01';
const USER = '6f0000000000000000000001';
const PROJECT = '6f00000000000000000000a1';
const SPRINT = '6f00000000000000000000b1';
const TASK = '6f00000000000000000000d1';
const PAGE = '6f00000000000000000000e1';

const ctx = () => ({
    companyId: C, userId: USER, actor: { kind: 'agent', userId: USER }, ip: '1.1.1.1', projectIds: [], canWrite: true,
    token: { _id: '6f0000000000000000000101', userId: USER, scopes: ['read', 'write'], active: true },
});

const seed = () => {
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT, ProjectName: 'Apollo' });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: SPRINT, name: 'Sprint 1', projectId: PROJECT });
    mockDb.seed(SCHEMA_TYPE.TASKS, {
        _id: TASK, TaskKey: 'AP-1', TaskName: 'Ship it', CompanyId: C, ProjectID: PROJECT, sprintId: SPRINT,
        status: { text: 'To do', type: 'default_active' }, statusType: 'default_active', Task_Priority: 'HIGH',
        AssigneeUserId: [USER], TaskType: 'task', TaskTypeKey: 1, DueDate: null, totalEstimatedTime: 7200,
        updatedAt: new Date('2026-09-01T00:00:00Z'), description: 'Goal: ship it',
    });
    mockDb.seed(SCHEMA_TYPE.PAGES, { _id: PAGE, title: 'Spec', rawText: 'The spec', content: {}, updatedAt: new Date('2026-09-02T00:00:00Z') });
};

const ARGS = {
    'tasks.next': {},
    'tasks.search': { query: 'ship' },
    'task.get': { taskId: TASK },
    'task.comment': { taskId: TASK, body: 'hello' },
    'task.status.set': { taskId: TASK, status: 'In review' },
    'task.link': { taskId: TASK, url: 'https://example.com/pull/1' },
    'task.create': { projectId: PROJECT, title: 'New one' },
    'subtask.create': { taskId: TASK, title: 'Part' },
    'timelog.start': { taskId: TASK },
    'timelog.stop': { taskId: TASK },
    'docs.read': { pageId: PAGE },
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    delete process.env.MCP_TOOLS_V2;
    seed();
});

describe('MCP_TOOLS_V2 off keeps today\'s tools and result shapes', () => {
    it('lists the same tools with the same schemas and no annotations', () => {
        expect(tools.manifest()).toMatchSnapshot();
    });

    it('covers every offered tool with a fixture call', () => {
        expect(tools.names().sort()).toEqual(Object.keys(ARGS).sort());
    });

    it.each(Object.keys(ARGS))('answers %s in today\'s shape', async (name) => {
        const out = await tools.call(ctx(), name, ARGS[name]);
        expect(out).toMatchSnapshot();
    });

    it('never files a proposal for a write', async () => {
        await tools.call(ctx(), 'task.comment', ARGS['task.comment']);
        expect(actions.perform).toHaveBeenCalledTimes(1);
        expect(mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS] || []).toHaveLength(0);
    });
});
