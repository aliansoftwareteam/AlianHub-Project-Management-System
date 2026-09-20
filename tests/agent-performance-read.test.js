const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/completionStore', () => ({ forStatusChange: jest.fn(async () => null), recordWork: jest.fn(async () => null) }));

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const registry = require('../Modules/Agents/registry');
const actions = require('../Modules/Agents/actions');
const policy = require('../Modules/Agents/policy');
const mcp = require('../Modules/Mcp/tools');
const performanceRead = require('../Modules/Agents/performanceRead');
const billable = require('../Modules/TimeSheet/controller/billableSummary');
const variance = require('../Modules/VarianceReport/controller');
const velocity = require('../Modules/AgileReports/velocity');
const cfd = require('../Modules/AgileReports/cfd');
const { aiReplaysSchema } = require('../utils/mongo-handler/createSchema');
const { spawnSync } = require('child_process');
const path = require('path');
const ctrl = require('../Modules/Agents/controller');
const { createAgentRecord } = require('../Modules/Agents/agentRecord');
const REGISTRY_ON_BETA = require('./fixtures/agentRegistry.beta.json');
const AGILE_ON_BETA = require('./fixtures/agileReports.beta.json');

const ACTION = 'performance.read';
const C = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000001';
const MEMBER = '6f0000000000000000000002';
const OTHER = '6f0000000000000000000003';
const AGENT_ID = '6f0000000000000000000a01';
const RUN_ID = '6f0000000000000000000b01';
const P1 = '6f0000000000000000000d01';
const P2 = '6f0000000000000000000d02';
const HIDDEN_PROJECT = '6f0000000000000000000d03';
const OPEN_SPRINT = '6f0000000000000000000e01';
const PRIVATE_SPRINT = '6f0000000000000000000e02';
const T1 = '6f0000000000000000000f01';
const T2 = '6f0000000000000000000f02';
const T3 = '6f0000000000000000000f03';
const MEMBER_ROLE = 3;

const FROM = '2026-08-01';
const TO = '2026-08-31';
// The chart reads local days; local midnight names the same calendar days in any zone,
// and every task event sits at noon UTC, inside the same day from -11 to +11.
const LOCAL_FROM = `${FROM}T00:00:00`;
const LOCAL_TO = `${TO}T00:00:00`;
const at = (iso) => new Date(iso);
const seconds = (iso) => Math.floor(Date.parse(iso) / 1000);

const actorFor = (userId, over = {}) => ({ kind: 'agent', userId, agentId: AGENT_ID, agentName: 'Analyst', runId: null, viaAccount: 'workspace', ...over });
const call = (userId, args, over = {}) => performanceRead.read({ companyId: C, actor: actorFor(userId, over.actor), args, projectScope: over.projectScope, allowedActions: over.allowedActions });
const replays = () => mockDb.store[SCHEMA_TYPE.AI_REPLAYS] || [];
const refusals = () => (mockDb.store[SCHEMA_TYPE.AUDIT_LOGS] || []).filter((row) => row.action === 'agent.action_refused');
const timesheetReads = () => mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.TIMESHEET);

const res = () => {
    const r = { code: 200, body: null };
    r.status = (code) => { r.code = code; return r; };
    r.send = (body) => { r.body = body; return r; };
    r.json = r.send;
    return r;
};
const req = (uid, over = {}) => ({ headers: { companyid: C }, query: {}, body: {}, params: {}, uid, ...over });
const handler = async (fn, uid, over) => { const r = res(); await fn(req(uid, over), r); return r.body; };
const withoutScope = (data) => Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'scope'));

const seedRules = ({ projectTimesheet = 1 } = {}) => {
    const project = mockDb.seed(SCHEMA_TYPE.RULES, { key: 'project', name: 'Project', isParent: true });
    mockDb.seed(SCHEMA_TYPE.RULES, { key: 'project_details', name: 'project_details', isParent: false, parentId: project._id, roles: [{ key: MEMBER_ROLE, permission: false }] });
    mockDb.seed(SCHEMA_TYPE.RULES, { key: 'private_projects', name: 'private_projects', isParent: false, parentId: project._id, roles: [{ key: MEMBER_ROLE, permission: 1 }] });
    const sheets = mockDb.seed(SCHEMA_TYPE.RULES, { key: 'sheet_settings', name: 'Sheet settings', isParent: true });
    mockDb.seed(SCHEMA_TYPE.RULES, { key: 'project_timesheet', name: 'project_timesheet', isParent: false, parentId: sheets._id, roles: [{ key: MEMBER_ROLE, permission: projectTimesheet }] });
};

const setGrant = (permission) => {
    mockDb.store[SCHEMA_TYPE.RULES].find((r) => r.key === 'project_timesheet').roles[0].permission = permission;
};

const commitment = { points: 5, tasks: 2, at: at('2026-07-28T09:00:00Z') };

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    process.env.AGENT_PERFORMANCE_READ = 'on';
    delete process.env.AI_REPLAY;

    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: MEMBER_ROLE, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OTHER, roleType: MEMBER_ROLE, status: 2, isDelete: false });
    seedRules();

    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: P1, ProjectName: 'Launch', isPrivateSpace: false, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: P2, ProjectName: 'Ops', isPrivateSpace: false, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: HIDDEN_PROJECT, ProjectName: 'Board', isPrivateSpace: true, AssigneeUserId: [OWNER], deletedStatusKey: 0 });

    const sprint = (over) => ({ projectId: P1, isScrum: true, state: 'closed', deletedStatusKey: 0, commitment, ...over });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, sprint({ _id: OPEN_SPRINT, name: 'Sprint 4', startDate: at('2026-07-28'), endDate: at('2026-08-10'), closeReport: { at: at('2026-08-11T10:00:00Z') } }));
    mockDb.seed(SCHEMA_TYPE.SPRINTS, sprint({ _id: PRIVATE_SPRINT, name: 'Security', private: true, AssigneeUserId: [OTHER], startDate: at('2026-08-12'), endDate: at('2026-08-25'), closeReport: { at: at('2026-08-26T10:00:00Z') } }));

    const task = (over) => ({ ProjectID: P1, isParentTask: true, deletedStatusKey: 0, createdAt: at('2026-07-29T12:00:00Z'), updatedAt: at('2026-08-09T12:00:00Z'), ...over });
    mockDb.seed(SCHEMA_TYPE.TASKS, task({ _id: T1, TaskName: 'Pricing page', sprintId: OPEN_SPRINT, statusType: 'close', points: 3, totalEstimatedTime: 120 }));
    mockDb.seed(SCHEMA_TYPE.TASKS, task({ _id: T2, TaskName: 'Checkout copy', sprintId: OPEN_SPRINT, statusType: 'inprogress', points: 2, totalEstimatedTime: 60 }));
    mockDb.seed(SCHEMA_TYPE.TASKS, task({ _id: T3, TaskName: 'Pen test fixes', sprintId: PRIVATE_SPRINT, statusType: 'close', points: 5, totalEstimatedTime: 90 }));
    mockDb.seed(SCHEMA_TYPE.HISTORY, { Key: 'Task_Status', TaskId: T1, createdAt: at('2026-08-09T12:00:00Z') });
    mockDb.seed(SCHEMA_TYPE.HISTORY, { Key: 'Task_Status', TaskId: T3, createdAt: at('2026-08-20T12:00:00Z') });

    const log = (over) => ({ ProjectId: P1, LogStartTime: seconds('2026-08-05T09:00:00Z'), billable: true, ...over });
    mockDb.seed(SCHEMA_TYPE.TIMESHEET, log({ Loggeduser: MEMBER, TicketID: T1, LogTimeDuration: 60 }));
    mockDb.seed(SCHEMA_TYPE.TIMESHEET, log({ Loggeduser: OTHER, TicketID: T1, LogTimeDuration: 30, billable: false }));
    mockDb.seed(SCHEMA_TYPE.TIMESHEET, log({ Loggeduser: MEMBER, TicketID: T2, LogTimeDuration: 90 }));
    mockDb.seed(SCHEMA_TYPE.TIMESHEET, log({ Loggeduser: OTHER, TicketID: T3, LogTimeDuration: 45 }));
    mockDb.seed(SCHEMA_TYPE.TIMESHEET, log({ Loggeduser: MEMBER, TicketID: T2, LogTimeDuration: 500, LogStartTime: seconds('2026-09-02T09:00:00Z') }));
});

afterAll(() => { delete process.env.AGENT_PERFORMANCE_READ; });

const project = (out, id = P1) => out.projects.find((p) => p.projectId === id);
const ALL = { projectId: P1, from: FROM, to: TO };

describe('with AGENT_PERFORMANCE_READ off', () => {
    beforeEach(() => { delete process.env.AGENT_PERFORMANCE_READ; });

    it('is not registered, rated or offered, and the registry is exactly the listed actions', () => {
        expect(registry.has(ACTION)).toBe(false);
        expect(registry.get(ACTION)).toBeNull();
        expect(registry.keys()).toEqual(registry.ACTIONS.map((a) => a.key));
        expect(registry.manifest().actions.map((a) => a.key)).toEqual(registry.ACTIONS.map((a) => a.key));
        expect(actions.rating(ACTION)).toBeNull();
        expect(Object.keys(actions.ratings())).not.toContain(ACTION);
        expect(mcp.names()).not.toContain(ACTION);
        expect(mcp.manifest().map((t) => t.name)).toEqual(mcp.TOOLS.map((t) => t.name));
        expect(registry.evaluate(ACTION, {})).toMatchObject({ allowed: false });
    });

    it('leaves the registry, the ratings, the MCP tool list and both manifests exactly as beta had them', () => {
        const plain = (value) => JSON.parse(JSON.stringify(value));
        expect(registry.keys()).toEqual(REGISTRY_ON_BETA.registryKeys);
        expect(plain(registry.manifest())).toEqual(REGISTRY_ON_BETA.registryManifest);
        expect(plain(actions.manifest())).toEqual(REGISTRY_ON_BETA.actionsManifest);
        expect(plain(actions.ratings())).toEqual(REGISTRY_ON_BETA.ratings);
        expect(mcp.names()).toEqual(REGISTRY_ON_BETA.toolNames);
        expect(plain(mcp.manifest())).toEqual(REGISTRY_ON_BETA.toolManifest);
    });

    it('answers an MCP call as an unknown tool and reads nothing', async () => {
        const ctx = { companyId: C, userId: OWNER, actor: actorFor(OWNER), projectIds: [], ip: '' };
        await expect(mcp.call(ctx, ACTION, ALL)).rejects.toMatchObject({ code: -32601 });
        expect(timesheetReads()).toHaveLength(0);
    });

    it('refuses a direct call before reading anything, whatever its arguments', async () => {
        await expect(call(OWNER, ALL)).rejects.toMatchObject({ name: 'RefusedError', message: 'Agents cannot perform performance.read' });
        await expect(call(OWNER, { projectId: P1 })).rejects.toMatchObject({ name: 'RefusedError', message: 'Agents cannot perform performance.read' });
        expect(timesheetReads()).toHaveLength(0);
        expect(replays()).toHaveLength(0);
    });
});

describe('with AGENT_PERFORMANCE_READ on, the action is registered like the other reads', () => {
    it('is a low-risk project-scoped read governed by project_details, and offered over MCP', () => {
        expect(registry.get(ACTION)).toMatchObject({ key: ACTION, write: false, risk: 'low', undoable: false });
        expect(registry.keys()).toContain(ACTION);
        expect(registry.permissionsFor(ACTION)).toEqual([{ key: 'project.project_details', write: false }]);
        expect(actions.rating(ACTION)).toEqual({ write: false, reversible: true, scope: 'project', money: false });
        expect(actions.unrated()).toEqual([]);
        expect(actions.manifest().actions.map((a) => a.key)).toEqual(registry.keys());
        expect(mcp.names()).toContain(ACTION);
        expect(mcp.manifest().find((t) => t.name === ACTION).inputSchema.required).toEqual(['from', 'to']);
        expect(policy.decide({ agent: { autonomy: 0, projectIds: [] }, action: ACTION, params: { projectId: P1 }, rating: actions.rating(ACTION) }).decision).toBe('act');
    });

    it('is refused for an agent whose allowed actions leave it out', async () => {
        await expect(call(OWNER, ALL, { allowedActions: ['task.get'] })).rejects.toMatchObject({ name: 'RefusedError', message: expect.stringMatching(/not in this agent's skills/) });
        expect(timesheetReads()).toHaveLength(0);
    });
});

describe('the numbers are the ones the existing reports compute on the same data', () => {
    it('logged time matches the billable summary', async () => {
        const out = await call(OWNER, { ...ALL, metrics: ['time'] });
        const report = await handler(billable.getBillableSummary, OWNER, { body: { projectArray: [P1], start: seconds(`${FROM}T00:00:00.000Z`), end: seconds(`${TO}T23:59:59.999Z`) } });
        expect(project(out).time).toEqual({ ...withoutScope(report.data), whose: 'company' });
        expect(project(out).time.totalMinutes).toBe(225);
    });

    it('estimate against actual matches the variance summary', async () => {
        const out = await call(OWNER, { ...ALL, metrics: ['variance'] });
        const report = await handler(variance.getVarianceSummary, OWNER, { query: { from: FROM, to: TO } });
        expect(project(out).variance).toEqual(report.data.totals);
        expect(project(out).variance).toMatchObject({ tasks: 3, totalEstimated: 270, totalActual: 225 });
    });

    it('velocity matches the velocity chart', async () => {
        const out = await call(OWNER, { ...ALL, metrics: ['velocity'] });
        const report = await handler(velocity.getVelocity, OWNER, { query: { projectId: P1, limit: 50 } });
        expect(report.data.sprints).toHaveLength(2);
        expect(project(out).velocity).toEqual({
            skipped: report.data.skipped,
            sprints: report.data.sprints.map((s) => ({
                sprintId: s.sprintId, name: s.name, startDate: s.startDate, endDate: s.endDate,
                committed: s.committed, completed: s.completed, completedHuman: s.completedHuman, completedAgent: s.completedAgent, rollingAvg: s.rollingAvg,
            })),
        });
    });

    it('cumulative flow matches the flow chart', async () => {
        const out = await call(OWNER, { ...ALL, metrics: ['flow'] });
        const report = await handler(cfd.getCFD, OWNER, { query: { projectId: P1, from: LOCAL_FROM, to: LOCAL_TO } });
        expect(report.data.days).toHaveLength(31);
        expect(project(out).flow).toEqual({ days: report.data.days });
    });

    it('returns every metric when none is named, per project, with the range it answered', async () => {
        const out = await call(OWNER, { projectIds: [P1, P2], from: FROM, to: TO });
        expect(out).toMatchObject({ action: ACTION, from: FROM, to: TO, metrics: ['time', 'variance', 'velocity', 'flow'] });
        expect(out.projects.map((p) => [p.projectId, p.name])).toEqual([[P1, 'Launch'], [P2, 'Ops']]);
        expect(Object.keys(project(out))).toEqual(expect.arrayContaining(['time', 'variance', 'velocity', 'flow']));
        expect(project(out, P2).time.totalMinutes).toBe(0);
    });

    it('leaves the chart handlers answering an empty project as they did', async () => {
        const report = await handler(velocity.getVelocity, OWNER, { query: { projectId: P2 } });
        expect(report).toEqual({ status: true, statusText: 'No completed sprints yet.', data: { sprints: [], skipped: 0 } });
        const flow = await handler(cfd.getCFD, OWNER, { query: { projectId: P2, from: FROM, to: TO } });
        expect(flow).toEqual({ status: true, statusText: 'No tasks yet.', data: { days: [] } });
    });
});

describe('access follows the person behind the agent and the projects it is narrowed to', () => {
    it('refuses a project the person cannot open, and audits it', async () => {
        await expect(call(MEMBER, { ...ALL, projectId: HIDDEN_PROJECT })).rejects.toMatchObject({ name: 'RefusedError', status: 403 });
        expect(refusals()).toHaveLength(1);
        expect(refusals()[0].meta).toMatchObject({ action: ACTION, reason: expect.stringMatching(HIDDEN_PROJECT) });
        expect(timesheetReads()).toHaveLength(0);
        expect(replays()).toHaveLength(0);
    });

    it('refuses the whole request rather than dropping the project it may not read', async () => {
        await expect(call(MEMBER, { projectIds: [P1, HIDDEN_PROJECT], from: FROM, to: TO })).rejects.toMatchObject({ name: 'RefusedError' });
        expect(timesheetReads()).toHaveLength(0);
    });

    it('lets the owner read the same private project', async () => {
        const out = await call(OWNER, { ...ALL, projectId: HIDDEN_PROJECT, metrics: ['time'] });
        expect(out.projects.map((p) => p.projectId)).toEqual([HIDDEN_PROJECT]);
    });

    it('refuses a project outside the token or agent project scope, even for the owner', async () => {
        await expect(call(OWNER, { ...ALL, projectId: P2 }, { projectScope: [P1] })).rejects.toMatchObject({ name: 'RefusedError', message: expect.stringMatching(P2) });
        await expect(call(OWNER, ALL, { projectScope: [P1] })).resolves.toMatchObject({ action: ACTION });
    });

    it('refuses when no person stands behind the agent', async () => {
        await expect(call('', ALL)).rejects.toMatchObject({ name: 'RefusedError', message: expect.stringMatching(/permission_denied/) });
    });

    it('refuses a guest whose role holds no project_details', async () => {
        const GUEST = '6f0000000000000000000004';
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: GUEST, roleType: 0, status: 2, isDelete: false });
        await expect(call(GUEST, ALL)).rejects.toMatchObject({ name: 'RefusedError', message: expect.stringMatching(/permission_denied: project\.project_details/) });
        expect(timesheetReads()).toHaveLength(0);
    });

    it('refuses a member who has been removed from the company', async () => {
        const GONE = '6f0000000000000000000005';
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: GONE, roleType: MEMBER_ROLE, status: 2, isDelete: true });
        await expect(call(GONE, ALL)).rejects.toMatchObject({ name: 'RefusedError', message: expect.stringMatching(/permission_denied/) });
        expect(timesheetReads()).toHaveLength(0);
    });

    it('refuses a token holder who has since lost access to the project the token names', async () => {
        const PRIVATE_PROJECT = '6f0000000000000000000d04';
        mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PRIVATE_PROJECT, ProjectName: 'Pilot', isPrivateSpace: false, AssigneeUserId: [OWNER], deletedStatusKey: 0 });
        const token = { projectScope: [PRIVATE_PROJECT] };
        await expect(call(MEMBER, { ...ALL, projectId: PRIVATE_PROJECT, metrics: ['time'] }, token)).resolves.toMatchObject({ action: ACTION });

        mockDb.store[SCHEMA_TYPE.PROJECTS].find((p) => p._id === PRIVATE_PROJECT).isPrivateSpace = true;
        await expect(call(MEMBER, { ...ALL, projectId: PRIVATE_PROJECT, metrics: ['time'] }, token)).rejects.toMatchObject({ name: 'RefusedError', message: expect.stringMatching(PRIVATE_PROJECT) });
    });

    it('refuses a member whose role holds no project_details', async () => {
        mockDb.store[SCHEMA_TYPE.RULES].find((r) => r.key === 'project_details').roles = [];
        await expect(call(MEMBER, ALL)).rejects.toMatchObject({ name: 'RefusedError', message: expect.stringMatching(/project\.project_details/) });
        expect(timesheetReads()).toHaveLength(0);
    });
});

describe('arguments are checked before anything is read', () => {
    it.each([
        ['a range longer than the maximum', { projectId: P1, from: '2026-01-01', to: '2026-06-30' }, /at most 120 days/],
        ['an inverted range', { projectId: P1, from: TO, to: FROM }, /from must not be after to/],
        ['a missing from', { projectId: P1, to: TO }, /from and to are required/],
        ['a missing to', { projectId: P1, from: FROM }, /from and to are required/],
        ['a date that is not a calendar day', { projectId: P1, from: '2026-02-30', to: '2026-03-02' }, /YYYY-MM-DD/],
        ['no project', { from: FROM, to: TO }, /projectId is required/],
        ['a malformed project id', { projectId: 'p1', from: FROM, to: TO }, /not a valid project id/],
        ['too many projects', { projectIds: [1, 2, 3, 4, 5, 6].map((n) => `6f00000000000000000001a${n}`), from: FROM, to: TO }, /at most 5 projects/],
        ['an unknown metric', { ...ALL, metrics: ['revenue'] }, /unknown metric "revenue"/],
    ])('refuses %s', async (_, args, reason) => {
        await expect(call(OWNER, args)).rejects.toMatchObject({ name: 'RefusedError', message: expect.stringMatching(reason) });
        expect(timesheetReads()).toHaveLength(0);
        expect(replays()).toHaveLength(0);
    });

    it('accepts the maximum range exactly', async () => {
        await expect(call(OWNER, { projectId: P1, from: '2026-05-04', to: '2026-08-31', metrics: ['time'] })).resolves.toMatchObject({ from: '2026-05-04' });
    });
});

describe('timesheet numbers keep to whose time the person may see', () => {
    it('gives a member without the grant only their own time', async () => {
        const out = await call(MEMBER, { ...ALL, metrics: ['time', 'variance'] });
        expect(project(out).time).toMatchObject({ totalMinutes: 150, billableMinutes: 150, nonBillableMinutes: 0, whose: 'self' });
        expect(project(out).variance).toMatchObject({ tasks: 2, totalActual: 150 });
    });

    it('matches what the member reads in the billable summary', async () => {
        const out = await call(MEMBER, { ...ALL, metrics: ['time'] });
        const report = await handler(billable.getBillableSummary, MEMBER, { body: { projectArray: [P1], start: seconds(`${FROM}T00:00:00.000Z`), end: seconds(`${TO}T23:59:59.999Z`) } });
        expect(project(out).time).toEqual({ ...withoutScope(report.data), whose: 'self' });
    });

    it('gives a member everyone\'s time once an admin grants the project timesheet to Everyone', async () => {
        setGrant(2);
        const out = await call(MEMBER, { ...ALL, metrics: ['time'] });
        expect(project(out).time).toMatchObject({ totalMinutes: 180, nonBillableMinutes: 30, whose: 'everyone' });
    });
});

describe('estimates are read only from the project asked about', () => {
    it('leaves out a task that has since moved to a project the person cannot open', async () => {
        mockDb.store[SCHEMA_TYPE.TASKS].find((t) => t._id === T2).ProjectID = HIDDEN_PROJECT;
        const out = await call(MEMBER, { ...ALL, metrics: ['variance'] });
        expect(project(out).variance).toMatchObject({ tasks: 1, totalEstimated: 120, totalActual: 60 });
    });
});

describe('a private sprint the person is not on stays out of every metric', () => {
    beforeEach(() => setGrant(2));

    it('drops its time, its tasks, its velocity row and its flow for a member who is not on it', async () => {
        const out = await call(MEMBER, ALL);
        const p = project(out);
        expect(p.time.totalMinutes).toBe(180);
        expect(p.variance).toMatchObject({ tasks: 2, totalEstimated: 180 });
        expect(p.velocity.sprints.map((s) => s.sprintId)).toEqual([OPEN_SPRINT]);
        expect(p.flow.days[p.flow.days.length - 1]).toMatchObject({ open: 0, inprogress: 1, onhold: 0, close: 1 });
    });

    it('keeps it for a member the sprint is shared with', async () => {
        const out = await call(OTHER, ALL);
        const p = project(out);
        expect(p.time.totalMinutes).toBe(225);
        expect(p.variance.tasks).toBe(3);
        expect(p.velocity.sprints.map((s) => s.sprintId)).toEqual([OPEN_SPRINT, PRIVATE_SPRINT]);
        expect(p.flow.days[p.flow.days.length - 1].close).toBe(2);
    });

    it('agrees with the velocity and flow charts the member sees', async () => {
        const out = await call(MEMBER, { ...ALL, metrics: ['velocity', 'flow'] });
        const chart = await handler(velocity.getVelocity, MEMBER, { query: { projectId: P1, limit: 50 } });
        const flow = await handler(cfd.getCFD, MEMBER, { query: { projectId: P1, from: LOCAL_FROM, to: LOCAL_TO } });
        expect(project(out).velocity.sprints.map((s) => s.sprintId)).toEqual(chart.data.sprints.map((s) => s.sprintId));
        expect(project(out).flow.days).toEqual(flow.data.days);
    });
});

describe('velocity keeps to the sprints closed inside the range', () => {
    it('leaves out a sprint closed after the range ends', async () => {
        const out = await call(OWNER, { projectId: P1, from: FROM, to: '2026-08-20', metrics: ['velocity'] });
        expect(project(out).velocity.sprints.map((s) => s.sprintId)).toEqual([OPEN_SPRINT]);
    });
});

describe('the replay record holds the query and the numbers', () => {
    const inRun = { actor: { runId: RUN_ID } };

    beforeEach(() => {
        mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { _id: RUN_ID, agentId: AGENT_ID, startedBy: MEMBER, status: 'running' });
    });

    it('writes one tool row with the action, arguments, resolved scope and the numbers returned', async () => {
        const out = await call(MEMBER, { ...ALL, metrics: ['time', 'velocity'] }, inRun);
        expect(replays()).toHaveLength(1);
        const row = replays()[0];
        expect(out.replayId).toBe(String(row._id));
        expect(row).toMatchObject({
            feature: 'agent_run', kind: 'tool', runId: RUN_ID, agentId: AGENT_ID, status: 'ok',
            promptHash: expect.stringMatching(/^[0-9a-f]{64}$/),
            query: {
                action: ACTION,
                args: { projectIds: [P1], from: FROM, to: TO, metrics: ['time', 'velocity'] },
                scope: { userId: MEMBER, projectIds: [P1], narrowedTo: null, timesheet: 'self', hiddenSprintIds: { [P1]: [PRIVATE_SPRINT] } },
            },
        });
        expect(row.result.projects).toEqual([{
            projectId: P1,
            time: project(out).time,
            velocity: { skipped: 0, sprints: project(out).velocity.sprints.map(({ name, ...numbers }) => numbers) },
        }]);
        expect(row.expiresAt.getTime()).toBeGreaterThan(row.createdAt.getTime());
    });

    it('keeps the tool row whole through the strict replay schema', () => {
        return call(MEMBER, { ...ALL, metrics: ['time'] }, inRun).then(() => {
            const Model = mongoose.models.s7s5ReplayProbe || mongoose.model('s7s5ReplayProbe', aiReplaysSchema);
            const row = replays()[0];
            const doc = new Model({ ...row, _id: undefined }).toObject();
            expect(doc.kind).toBe('tool');
            expect(doc.query).toEqual(row.query);
            expect(doc.result).toEqual(row.result);
        });
    });

    it('does not attach a run started by someone else', async () => {
        await call(OWNER, { ...ALL, metrics: ['time'] }, inRun);
        expect(replays()[0].runId).toBeNull();
    });

    it('does not attach a run that has finished', async () => {
        mockDb.store[SCHEMA_TYPE.AGENT_RUNS].find((r) => r._id === RUN_ID).status = 'done';
        await call(MEMBER, { ...ALL, metrics: ['time'] }, inRun);
        expect(replays()[0].runId).toBeNull();
    });

    it('does not attach a run of another agent, even one the same person started', async () => {
        await call(MEMBER, { ...ALL, metrics: ['time'] }, { actor: { runId: RUN_ID, agentId: '6f0000000000000000000a02' } });
        expect(replays()[0].runId).toBeNull();
    });

    it('does not attach a run to a token that belongs to no agent', async () => {
        await call(MEMBER, { ...ALL, metrics: ['time'] }, { actor: { runId: RUN_ID, agentId: null } });
        expect(replays()[0]).toMatchObject({ runId: null, agentId: null });
    });

    it('marks the tool row when its run has read outside content', async () => {
        const run = mockDb.store[SCHEMA_TYPE.AGENT_RUNS].find((r) => r._id === RUN_ID);
        run.tainted = true;
        run.taintSources = [{ kind: 'page', ref: 'p1', at: new Date('2026-09-01T00:00:00Z') }];
        await call(MEMBER, { ...ALL, metrics: ['time'] }, inRun);
        expect(replays()[0]).toMatchObject({ runId: RUN_ID, tainted: true, taintSources: [{ kind: 'page', ref: 'p1', at: expect.any(Date) }] });
    });

    it('writes nothing when replay is off, and still answers', async () => {
        process.env.AI_REPLAY = 'off';
        const out = await call(MEMBER, { ...ALL, metrics: ['time'] }, inRun);
        expect(out.replayId).toBeNull();
        expect(replays()).toHaveLength(0);
    });
});

describe('over MCP', () => {
    it('runs for the token holder inside the token\'s projects', async () => {
        const ctx = { companyId: C, userId: MEMBER, actor: actorFor(MEMBER), projectIds: [P1], ip: '' };
        const out = await mcp.call(ctx, ACTION, { ...ALL, metrics: ['time'] });
        expect(project(out).time.whose).toBe('self');
        await expect(mcp.call(ctx, ACTION, { projectId: P2, from: FROM, to: TO })).rejects.toMatchObject({ name: 'RefusedError' });
    });
});

describe('over MCP, the permission is judged in the project it is asked for', () => {
    const memberToken = { companyId: C, userId: MEMBER, actor: actorFor(MEMBER), projectIds: [P1], ip: '' };

    const projectRules = (roles) => {
        mockDb.store[SCHEMA_TYPE.PROJECTS].find((p) => p._id === P1).isGlobalPermission = false;
        mockDb.store[SCHEMA_TYPE.RULES].find((r) => r.key === 'project_details').roles = [];
        const parent = mockDb.seed(SCHEMA_TYPE.PROJECT_RULES, { key: 'project', name: 'Project', isParent: true, projectId: P1 });
        mockDb.seed(SCHEMA_TYPE.PROJECT_RULES, { key: 'project_details', name: 'project_details', isParent: false, parentId: parent._id, projectId: P1, roles });
    };

    it('answers a member whose project rules grant project_details where the company rules do not', async () => {
        projectRules([{ key: MEMBER_ROLE, permission: false }]);
        await expect(mcp.call(memberToken, ACTION, { ...ALL, metrics: ['time'] })).resolves.toMatchObject({ action: ACTION });
        expect(refusals()).toHaveLength(0);
    });

    it('still refuses and audits a member whose project rules withhold it', async () => {
        projectRules([]);
        await expect(mcp.call(memberToken, ACTION, { ...ALL, metrics: ['time'] })).rejects.toMatchObject({ name: 'RefusedError', message: expect.stringMatching(/project\.project_details/) });
        expect(refusals()).toHaveLength(1);
        expect(timesheetReads()).toHaveLength(0);
    });
});

describe('every metric counts the same UTC days the query names', () => {
    const PROBE = path.join(__dirname, 'fixtures', 'performanceReadProbe.js');
    const AUGUST = Array.from({ length: 31 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`);

    it.each([['America/New_York'], ['Pacific/Auckland'], ['UTC']])('under TZ=%s', (zone) => {
        const child = spawnSync(process.execPath, [PROBE], { env: { ...process.env, TZ: zone }, encoding: 'utf8' });
        expect(child.stderr).toBe('');
        const { zone: ran, out, replayArgs } = JSON.parse(child.stdout);
        expect(ran).toBe(zone);
        expect(replayArgs).toMatchObject({ from: '2026-08-01', to: '2026-08-31' });
        const [numbers] = out.projects;
        expect(numbers.time.totalMinutes).toBe(10);
        expect(numbers.flow.days.map((d) => d.date)).toEqual(AUGUST);
        expect(numbers.flow.days).toEqual(AGILE_ON_BETA.flow['owner, August'].data.days.slice(0, 31));
    });

    it('in this process too', async () => {
        const out = await call(OWNER, { ...ALL, metrics: ['flow'] });
        expect(project(out).flow.days.map((d) => d.date)).toEqual(AUGUST);
    });
});

describe('an allowed-action list is never emptied by a save while the flag is off', () => {
    const AGENT = '6f0000000000000000000a09';
    const saved = () => mockDb.store[SCHEMA_TYPE.AGENTS].find((a) => String(a._id) === AGENT);

    beforeEach(() => {
        delete process.env.AGENT_PERFORMANCE_READ;
        mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: AGENT, name: 'Analyst', ownerId: OWNER, autonomy: 1, allowedActions: ['performance.read'], paused: false, deletedStatusKey: 0 });
    });

    it('keeps performance.read on an update, so the agent stays narrowed to it', async () => {
        const r = res();
        await ctrl.updateAgent(req(OWNER, { params: { id: AGENT }, body: { name: 'Analyst', allowedActions: ['performance.read'] } }), r);
        expect(r.body.status).toBe(true);
        expect(saved().allowedActions).toEqual(['performance.read']);
        expect(registry.evaluate('task.comment', {}, { allowedActions: saved().allowedActions })).toMatchObject({ allowed: false });
        expect(policy.decide({ agent: saved(), action: 'task.comment', params: { taskId: T1 }, rating: actions.rating('task.comment') }).decision).toBe('refuse');
    });

    it('keeps it on a create through the API and through createAgentRecord', async () => {
        const r = res();
        await ctrl.createAgent(req(OWNER, { body: { name: 'Second analyst', allowedActions: ['performance.read'] } }), r);
        expect(r.body.data.allowedActions).toEqual(['performance.read']);
        const record = await createAgentRecord(C, { name: 'Third analyst', allowedActions: ['performance.read'] }, { ownerId: OWNER });
        expect(record.allowedActions).toEqual(['performance.read']);
    });

    it('refuses a save whose list names nothing the registry knows, instead of storing an empty list', async () => {
        const r = res();
        await ctrl.updateAgent(req(OWNER, { params: { id: AGENT }, body: { allowedActions: ['sprint.close'] } }), r);
        expect(r.code).toBe(400);
        expect(saved().allowedActions).toEqual(['performance.read']);

        const created = res();
        await ctrl.createAgent(req(OWNER, { body: { name: 'Nothing', allowedActions: ['sprint.close'] } }), created);
        expect(created.code).toBe(400);
        await expect(createAgentRecord(C, { name: 'Nothing either', allowedActions: ['sprint.close'] }, { ownerId: OWNER })).rejects.toThrow(/allowedActions/);
        expect(mockDb.store[SCHEMA_TYPE.AGENTS]).toHaveLength(1);
    });

    it('still drops an unknown name next to a known one, and still stores an empty list that was sent empty', async () => {
        const r = res();
        await ctrl.updateAgent(req(OWNER, { params: { id: AGENT }, body: { allowedActions: ['sprint.close', 'task.get'] } }), r);
        expect(saved().allowedActions).toEqual(['task.get']);
        await ctrl.updateAgent(req(OWNER, { params: { id: AGENT }, body: { allowedActions: [] } }), res());
        expect(saved().allowedActions).toEqual([]);
    });
});
