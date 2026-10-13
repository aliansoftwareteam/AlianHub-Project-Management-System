const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(async () => ['6f0000000000000000000a01']) }));
jest.mock('../Modules/Automations/engine/tools', () => ({ updateTask: jest.fn(), addComment: jest.fn(), resolveStatus: jest.fn(), createSubtask: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider', () => ({ getProvider: jest.fn(() => { throw new Error('a model was called'); }), isAnyProviderConfigured: jest.fn(() => false) }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async () => 1),
    isPrivileged: (roleType) => roleType === 1 || roleType === 2,
    evaluatePermission: jest.fn(async () => true),
    isWritable: (value) => value === true || value === 1 || value === 2,
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const domainEventBus = require('../event/domainEventBus');
const llmProvider = require('../Modules/AICore/llmProvider');
const tools = require('../Modules/Automations/engine/tools');
const { agentPerimeter } = require('../Modules/Agents/guard');

const C = '6f0000000000000000000c01';
const OPEN = '6f0000000000000000000a01';
const OWNER = '6f0000000000000000000001';
const READS = ['find', 'findOne', 'countDocuments', 'aggregate', 'distinct'];

const routes = {};
const register = (method) => (routePath, ...handlers) => { routes[`${method} ${routePath}`] = handlers; };
require('../Modules/Automations/routes').init({ get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE') });

const agentToken = (uid) => ({ uid, apiToken: { _id: '6f0000000000000000000101', kind: 'agent', name: 'Claude', userId: uid, scopes: ['read', 'write'] } });

/* What stands in front of every route, then the route's own guards and its handler. */
const ask = (route, caller, body = {}, params = {}) => new Promise((resolve) => {
    const [method, url] = route.split(' ');
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (answer) => { resolve({ code: res.statusCode, body: answer }); return res; };
    res.json = res.send;
    const req = { ...caller, method, originalUrl: url, url, query: {}, params, headers: { companyid: C }, ip: '1.1.1.1', body };
    const chain = [agentPerimeter, ...routes[route]];
    const step = (at) => Promise.resolve(chain[at](req, res, () => step(at + 1)));
    step(0);
});

const rule = {
    name: 'Escalate high priority',
    version: 2,
    enabled: true,
    trigger: { type: 'event', event: 'task.priority_changed' },
    scope: { allProjects: true, projectIds: [] },
    conditions: { op: 'eq', field: 'Task_Priority', value: 'HIGH' },
    steps: [
        { id: 's1', type: 'action', action: 'add_comment', config: { body: 'Escalated: {{task.TaskName}}' } },
        { id: 's2', type: 'action', action: 'set_status', config: { status: 'In Review' } },
    ],
};

let saved;
let task;
let busSpy;

/* Reading a collection the fake has not seen leaves an empty one behind, which is not a row. */
const stored = () => JSON.stringify(Object.fromEntries(Object.entries(mockDb.store).filter(([, kept]) => kept.length)));

/* [route, body, params]: what each answers about a rule without running it. */
const previews = () => ({
    'what a sentence would make': ['POST /api/v2/automations/compile', { sentence: 'When a task is created, set priority to high' }],
    'what a rule reads as': ['POST /api/v2/automations/compile', { rule }],
    'what a rule would have done': ['POST /api/v2/automations/backtest', { rule }],
    'a dry run of a rule on a task': ['POST /api/v2/automations/:id/dry-run', { taskId: String(task._id) }, { id: String(saved._id) }],
    'the tasks a rule would match': ['POST /api/v1/automations/preview', { conditions: { priority: 'HIGH' } }],
});
const NAMES = ['what a sentence would make', 'what a rule reads as', 'what a rule would have done', 'a dry run of a rule on a task', 'the tasks a rule would match'];

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: OPEN, ProjectName: 'Open', isPrivateSpace: false, deletedStatusKey: 0, taskStatusData: [{ key: 1, name: 'To Do', type: 'default_active' }, { key: 2, name: 'In Review', type: 'active' }] });
    saved = mockDb.seed(SCHEMA_TYPE.AUTOMATION_RULES, { ...rule, deletedStatusKey: 0, createdBy: OWNER });
    task = mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Fix login', TaskKey: 'WEB-7', ProjectID: OPEN, sprintId: 'sp1', isParentTask: true, deletedStatusKey: 0, Task_Priority: 'HIGH', statusKey: 1, statusType: 'default_active', AssigneeUserId: [] });
    mockDb.calls.length = 0;
    busSpy = jest.spyOn(domainEventBus.bus, 'emit');
});

afterEach(() => jest.restoreAllMocks());

describe('what an agent may ask about an automation without running it', () => {
    it.each(NAMES)('%s is answered, and nothing is saved, sent or asked of a model', async (name) => {
        const [route, body, params] = previews()[name];
        const before = stored();

        const answer = await ask(route, agentToken(OWNER), body, params);

        expect([answer.code, answer.body.status]).toEqual([200, true]);
        expect(mockDb.calls.map((call) => call.method).filter((method) => !READS.includes(method))).toEqual([]);
        expect(stored()).toBe(before);
        expect(llmProvider.getProvider).not.toHaveBeenCalled();
        expect(socketEmitter.emit).not.toHaveBeenCalled();
        expect(busSpy).not.toHaveBeenCalled();
        Object.values(tools).forEach((tool) => expect(tool).not.toHaveBeenCalled());
    });
});
