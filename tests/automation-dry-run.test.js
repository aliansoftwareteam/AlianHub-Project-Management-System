const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn() }));
jest.mock('../Modules/Automations/engine/tools', () => ({ updateTask: jest.fn(), addComment: jest.fn(), resolveStatus: jest.fn(), createSubtask: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(),
    isPrivileged: (roleType) => roleType === 1 || roleType === 2,
    evaluatePermission: jest.fn(async () => true),
    isWritable: (value) => value === true || value === 1 || value === 2,
}));

const http = require('http');
const https = require('https');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const scope = require('../Modules/Agents/scope');
const guard = require('../Config/permissionGuard');
const tools = require('../Modules/Automations/engine/tools');
const registry = require('../Modules/Automations/engine/registry');
const runner = require('../Modules/Automations/engine/runner');
const socketEmitter = require('../event/socketEventEmitter');
const domainEventBus = require('../event/domainEventBus');
const { removeCache } = require('../utils/commonFunctions');
const ctrl = require('../Modules/Automations/controller');

const C = '6f0000000000000000000c01';
const OPEN = '6f0000000000000000000a01';
const PRIVATE = '6f0000000000000000000a02';
const OWNER = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const MEMBER = '6f0000000000000000000003';
const MISSING = '6f00000000000000000000ff';
const ROLES = { [OWNER]: 1, [ADMIN]: 2, [MEMBER]: 3 };
const READS = ['find', 'findOne', 'countDocuments', 'aggregate'];

const call = async (handler, { uid, params = {}, body = {} }) => {
    const res = {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        send(payload) { this.body = payload; return this; },
    };
    await handler({ uid, params, body, headers: { companyid: C } }, res);
    return res;
};

const seedRule = (over = {}) => mockDb.seed(SCHEMA_TYPE.AUTOMATION_RULES, {
    name: 'Escalate high priority',
    version: 2,
    enabled: true,
    deletedStatusKey: 0,
    createdBy: OWNER,
    trigger: { type: 'event', event: 'task.priority_changed' },
    scope: { allProjects: true, projectIds: [] },
    conditions: { op: 'eq', field: 'Task_Priority', value: 'HIGH' },
    steps: [
        { id: 's1', type: 'action', action: 'add_comment', config: { body: 'Escalated: {{task.TaskName}} ({{task.TaskKey}})' } },
        { id: 's2', type: 'action', action: 'set_status', config: { status: 'In Review' } },
    ],
    ...over,
});

const seedTask = (over = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, {
    TaskName: 'Fix login', TaskKey: 'WEB-7', ProjectID: OPEN, sprintId: 'sp1', isParentTask: true,
    deletedStatusKey: 0, Task_Priority: 'HIGH', statusType: 'in_progress', AssigneeUserId: [], ...over,
});

const dryRun = (uid, rule, body) => call(ctrl.dryRun, { uid, params: { id: rule._id || rule }, body });

let fetchSpy;
let httpSpy;
let httpsSpy;
let emitSpy;
let busSpy;
let actionSpies;
let runnerSpies;

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    guard.getRoleType.mockImplementation(async (companyId, uid) => (uid in ROLES ? ROLES[uid] : null));
    guard.evaluatePermission.mockResolvedValue(true);
    scope.visibleProjectIds.mockImplementation(async (companyId, uid) => (uid === OWNER ? [OPEN, PRIVATE] : [OPEN]));
    global.fetch = jest.fn(async () => { throw new Error('outbound fetch during a dry run'); });
    fetchSpy = global.fetch;
    httpSpy = jest.spyOn(http, 'request');
    httpsSpy = jest.spyOn(https, 'request');
    emitSpy = jest.spyOn(socketEmitter, 'emit');
    busSpy = jest.spyOn(domainEventBus.bus, 'emit');
    actionSpies = registry.actionKeys().map((key) => jest.spyOn(registry.getAction(key), 'run'));
    runnerSpies = ['createRun', 'execute', 'runOnce', 'executeStep'].map((fn) => jest.spyOn(runner, fn));
});

afterEach(() => { jest.restoreAllMocks(); delete global.fetch; });

describe('POST /api/v2/automations/:id/dry-run — what the rule would do', () => {
    it('reports a match with each condition and the actions with their params resolved against the task', async () => {
        const rule = seedRule();
        const task = seedTask();
        const res = await dryRun(OWNER, rule, { taskId: task._id });

        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe(true);
        const data = res.body.data;
        expect(data).toMatchObject({
            matched: true,
            inScope: true,
            rule: { id: String(rule._id), name: 'Escalate high priority', trigger: 'task.priority_changed' },
            task: { id: String(task._id), key: 'WEB-7', name: 'Fix login' },
        });
        expect(data.conditions).toEqual([expect.objectContaining({ field: 'Task_Priority', op: 'eq', value: 'HIGH', actual: 'HIGH', passed: true })]);
        expect(data.actions).toEqual([
            expect.objectContaining({ id: 's1', action: 'add_comment', label: 'Add a comment', wouldRun: true, params: { body: 'Escalated: Fix login (WEB-7)' } }),
            expect.objectContaining({ id: 's2', action: 'set_status', label: 'Change status', wouldRun: true, params: { status: 'In Review' } }),
        ]);
        expect(data.reasons.length).toBeGreaterThan(0);
    });

    it('reports no match with the condition that failed and the value the task actually has', async () => {
        const rule = seedRule();
        const task = seedTask({ Task_Priority: 'LOW' });
        const { body } = await dryRun(OWNER, rule, { taskId: task._id });

        expect(body.data.matched).toBe(false);
        expect(body.data.conditions[0]).toMatchObject({ field: 'Task_Priority', actual: 'LOW', passed: false });
        expect(body.data.reasons.join(' ')).toMatch(/Task_Priority/);
        expect(body.data.reasons.join(' ')).toMatch(/LOW/);
        expect(body.data.actions.every((a) => a.wouldRun === false)).toBe(true);
        expect(body.data.actions[0].params).toEqual({ body: 'Escalated: Fix login (WEB-7)' });
    });

    it('reports no match when the task sits outside the projects the rule is scoped to', async () => {
        const rule = seedRule({ scope: { allProjects: false, projectIds: [OPEN] } });
        const task = seedTask({ ProjectID: PRIVATE });
        const { body } = await dryRun(OWNER, rule, { taskId: task._id });

        expect(body.data).toMatchObject({ matched: false, inScope: false });
        expect(body.data.reasons.join(' ')).toMatch(/scope|project/i);
    });

    it('stops listing actions as runnable after a condition step that does not pass', async () => {
        const rule = seedRule({
            conditions: {},
            steps: [
                { id: 's1', type: 'action', action: 'add_comment', config: { body: 'first' } },
                { id: 's2', type: 'condition', condition: { op: 'eq', field: 'statusType', value: 'done' } },
                { id: 's3', type: 'action', action: 'set_priority', config: { priority: 'LOW' } },
            ],
        });
        const task = seedTask();
        const { body } = await dryRun(OWNER, rule, { taskId: task._id });

        expect(body.data.matched).toBe(true);
        expect(body.data.actions.map((a) => [a.id, a.wouldRun])).toEqual([['s1', true], ['s2', false], ['s3', false]]);
        expect(body.data.actions[1].note).toBeTruthy();
    });

    it('reads a "changed to" clause as though the field just changed, and says a "changed from" one cannot be checked', async () => {
        const rule = seedRule({ conditions: { op: 'changedTo', field: 'Task_Priority', value: 'HIGH' } });
        const task = seedTask();
        expect((await dryRun(OWNER, rule, { taskId: task._id })).body.data.matched).toBe(true);

        const from = seedRule({ conditions: { op: 'changedFrom', field: 'Task_Priority', value: 'LOW' } });
        const { body } = await dryRun(OWNER, from, { taskId: task._id });
        expect(body.data.matched).toBe(false);
        expect(body.data.conditions[0].note).toBeTruthy();
    });
});

describe('a dry run writes nothing and reaches nothing outside the process', () => {
    const assertNothingHappened = (before) => {
        const methods = mockDb.calls.map((c) => c.method);
        expect(methods.length).toBeGreaterThan(0);
        expect(methods.filter((m) => !READS.includes(m))).toEqual([]);
        expect(JSON.stringify(mockDb.store)).toBe(before);
        expect(emitSpy).not.toHaveBeenCalled();
        expect(busSpy).not.toHaveBeenCalled();
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(httpSpy).not.toHaveBeenCalled();
        expect(httpsSpy).not.toHaveBeenCalled();
        actionSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
        runnerSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
        Object.values(tools).forEach((fn) => expect(fn).not.toHaveBeenCalled());
        expect(removeCache).not.toHaveBeenCalled();
    };

    it('only reads, for a rule that matches and would comment, change status and run an agent', async () => {
        const rule = seedRule({
            steps: [
                { id: 's1', type: 'action', action: 'add_comment', config: { body: 'hi' } },
                { id: 's2', type: 'action', action: 'set_status', config: { status: 'Done' } },
                { id: 's3', type: 'action', action: 'run_agent', config: { agent: 'Triage', skill: registry.getAction('run_agent').schema.skill.options[0] } },
            ],
        });
        const task = seedTask();
        const before = JSON.stringify(mockDb.store);
        const res = await dryRun(OWNER, rule, { taskId: task._id });
        expect(res.body.data.matched).toBe(true);
        expect(res.body.data.actions.map((a) => a.wouldRun)).toEqual([true, true, true]);
        assertNothingHappened(before);
    });

    it('only reads for a rule that does not match', async () => {
        const rule = seedRule();
        const task = seedTask({ Task_Priority: 'LOW' });
        const before = JSON.stringify(mockDb.store);
        expect((await dryRun(OWNER, rule, { taskId: task._id })).body.data.matched).toBe(false);
        assertNothingHappened(before);
    });

    it('leaves the rule untouched — no run row, no counter, no cache flush', async () => {
        const rule = seedRule();
        const task = seedTask();
        await dryRun(OWNER, rule, { taskId: task._id });
        expect(mockDb.store[SCHEMA_TYPE.AUTOMATION_RUNS] || []).toHaveLength(0);
        expect(mockDb.store[SCHEMA_TYPE.AUTOMATION_RULES][0]).not.toHaveProperty('lastRunAt');
    });
});

describe('who may dry-run a rule, and on which task', () => {
    it('answers 403 to a caller who cannot edit rules, before reading the task', async () => {
        const rule = seedRule();
        const task = seedTask();
        const res = await dryRun(MEMBER, rule, { taskId: task._id });
        expect(res.statusCode).toBe(403);
        expect(res.body.status).toBe(false);
        expect(mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.TASKS)).toHaveLength(0);
    });

    it('answers 403 to an admin when the rule targets a project they cannot edit', async () => {
        const rule = seedRule({ scope: { allProjects: false, projectIds: [PRIVATE] } });
        const task = seedTask();
        expect((await dryRun(ADMIN, rule, { taskId: task._id })).statusCode).toBe(403);
    });

    it('answers 404 for a task in a project the caller cannot open', async () => {
        const rule = seedRule();
        const task = seedTask({ ProjectID: PRIVATE });
        const res = await dryRun(ADMIN, rule, { taskId: task._id });
        expect(res.statusCode).toBe(404);
        expect(JSON.stringify(res.body)).not.toContain('Fix login');
    });

    it('answers 404 for a deleted task, a task that does not exist, and a malformed id', async () => {
        const rule = seedRule();
        const deleted = seedTask({ deletedStatusKey: 1 });
        expect((await dryRun(OWNER, rule, { taskId: deleted._id })).statusCode).toBe(404);
        expect((await dryRun(OWNER, rule, { taskId: MISSING })).statusCode).toBe(404);
        expect((await dryRun(OWNER, rule, { taskId: 'not-an-id' })).statusCode).toBe(404);
        expect((await dryRun(OWNER, rule, {})).statusCode).toBe(400);
    });

    it('answers 404 for a rule that does not exist or was deleted', async () => {
        const task = seedTask();
        expect((await dryRun(OWNER, MISSING, { taskId: task._id })).statusCode).toBe(404);
        const gone = seedRule({ deletedStatusKey: 1 });
        expect((await dryRun(OWNER, gone, { taskId: task._id })).statusCode).toBe(404);
    });

    it('refuses a rule that does not run on a task event', async () => {
        const rule = seedRule({ trigger: { type: 'event', event: 'form.submitted' } });
        const task = seedTask();
        const res = await dryRun(OWNER, rule, { taskId: task._id });
        expect(res.statusCode).toBe(400);
        expect(res.body.status).toBe(false);
    });
});

describe('the route', () => {
    it('is registered as POST /api/v2/automations/:id/dry-run', () => {
        const seen = [];
        const app = new Proxy({}, { get: (_t, verb) => (path) => seen.push(`${verb.toUpperCase()} ${path}`) });
        require('../Modules/Automations/routes').init(app);
        expect(seen).toContain('POST /api/v2/automations/:id/dry-run');
    });
});
