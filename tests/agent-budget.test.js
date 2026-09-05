const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ ROLE_OWNER: 1, ROLE_ADMIN: 2, getRoleType: jest.fn(async () => 1), isPrivileged: (r) => r === 1 || r === 2 }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Agents/actor', () => ({ resolveActor: jest.fn(async (req) => ({ kind: 'human', userId: req.uid })), isAgent: (a) => a.kind === 'agent' }));
jest.mock('../Modules/Automations/engine/tools', () => ({ getTask: jest.fn(async () => ({ _id: '6f0000000000000000000701', ProjectID: 'p1', TaskKey: 'AR-1' })) }));
jest.mock('../Modules/AIProjectGenerator/usage', () => ({ summarize: jest.fn(() => ({ costUsd: 0, totalTokens: 0, model: 'm' })) }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn(async () => ({ status: true })) }));
jest.mock('../Modules/Agents/proposals', () => ({ create: jest.fn() }));
jest.mock('../Modules/Agents/actions', () => ({ perform: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { summarize } = require('../Modules/AIProjectGenerator/usage');
const { handleNotificationtFun } = require('../Modules/notification/prepare-notification-data/controllerV2');
const runs = require('../Modules/Agents/runs');
const budget = require('../Modules/Agents/budget');
const ctrl = require('../Modules/Agents/controller');
const runAgent = require('../Modules/Automations/engine/actions/runAgent');

const C = '6f0000000000000000000c01';
const AGENT_ID = '6f0000000000000000000a01';
const TASK_ID = '6f0000000000000000000701';
const DAY = 24 * 60 * 60 * 1000;
const agent = (over = {}) => ({ _id: AGENT_ID, name: 'Reviewer', autonomy: 1, allowedActions: [], account: 'workspace', spendCapUsd: 0, paused: false, deletedStatusKey: 0, ...over });
const company = () => mockDb.store[dbCollections.COMPANIES][0];
const seedCompany = (over = {}) => mockDb.seed(dbCollections.COMPANIES, { _id: C, ...over });
const seedRun = (usd, over = {}) => mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: AGENT_ID, status: 'done', startedAt: new Date(), viaAccount: 'workspace', spend: { usd, tokens: 10, billedToWorkspace: true }, ...over });
const lastMonth = () => { const d = new Date(); d.setUTCDate(1); d.setUTCHours(12); return new Date(d.getTime() - 3 * DAY); };

/* A billed run whose recorded spend is `usd`. */
const spend = async (usd, over = {}) => {
    summarize.mockReturnValueOnce({ costUsd: usd, totalTokens: 100, model: 'm' });
    const run = await runs.create(C, { agent: agent(), taskId: TASK_ID, projectId: 'p1', skill: 'qa-review', ...over });
    return runs.recordSpend(C, run, { totalTokens: 100 }, 'm');
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    mockDb.seed(SCHEMA_TYPE.AGENTS, agent());
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: 'owner1', roleType: 1 });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: 'admin1', roleType: 2 });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: 'member1', roleType: 3 });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: 'gone1', roleType: 2, isDelete: true });
});

describe('budget.status', () => {
    it('sums this month\'s run spend against the company budget', async () => {
        seedCompany({ agentMonthlyBudgetUsd: 10 });
        seedRun(2.5);
        seedRun(3);
        seedRun(4, { startedAt: lastMonth() });
        seedRun(0, { viaAccount: 'personal', spend: { usd: 0, personalUsd: 9, billedToWorkspace: false } });
        mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: AGENT_ID, status: 'running', startedAt: new Date() });
        expect(await budget.status(C)).toEqual({ month: runs.monthKey(), usedUsd: 5.5, budgetUsd: 10, percent: 55, alerts: { 80: null, 100: null } });
    });

    it('reports no budget as 0 and a missing company row as defaults', async () => {
        seedRun(7);
        expect(await budget.status(C)).toMatchObject({ usedUsd: 7, budgetUsd: 0, percent: 0 });
        expect(await budget.check(C)).toEqual({ ok: true, reason: '' });
    });

    it('GET /agents/budget returns the status', async () => {
        seedCompany({ agentMonthlyBudgetUsd: 20, agentBudgetAlerts: { month: runs.monthKey(), 80: new Date('2026-09-01T10:00:00.000Z'), 100: null } });
        seedRun(17);
        const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; };
        await ctrl.getBudget({ headers: { companyid: C }, query: {}, uid: 'owner1' }, r);
        expect(r.body).toEqual({ status: true, data: { month: runs.monthKey(), usedUsd: 17, budgetUsd: 20, percent: 85, alerts: { 80: '2026-09-01T10:00:00.000Z', 100: null } } });
    });

    it('forgets last month\'s alert stamps', async () => {
        seedCompany({ agentMonthlyBudgetUsd: 20, agentBudgetAlerts: { month: '2000-01', 80: new Date(), 100: new Date() } });
        expect((await budget.status(C)).alerts).toEqual({ 80: null, 100: null });
    });
});

describe('runs are refused at 100%', () => {
    it('canStart returns the reason once the month\'s spend reaches the budget, after every existing check', async () => {
        seedCompany({ agentMonthlyBudgetUsd: 5 });
        seedRun(4.99);
        expect(await runs.canStart(agent(), { companyId: C })).toEqual({ ok: true, reason: '' });
        seedRun(0.01);
        expect(await runs.canStart(agent(), { companyId: C })).toEqual({ ok: false, reason: 'Company agent budget reached ($5.00 of $5 this month).' });
        expect((await runs.canStart(agent({ paused: true, pausedReason: 'manual' }), { companyId: C })).reason).toBe('Agent is paused (manual).');
        expect((await runs.canStart(agent(), {})).ok).toBe(true);
    });

    it('POST /agents/runs answers 409 with the reason', async () => {
        seedCompany({ agentMonthlyBudgetUsd: 1 });
        seedRun(1);
        const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; };
        await ctrl.startRun({ headers: { companyid: C }, body: { agentId: AGENT_ID, taskId: TASK_ID }, query: {}, uid: 'owner1' }, r);
        expect(r.code).toBe(409);
        expect(r.body.statusText).toBe('Company agent budget reached ($1.00 of $1 this month).');
        expect(mockDb.store[SCHEMA_TYPE.AGENT_RUNS]).toHaveLength(1);
    });

    it('a rule-triggered run is refused the same way', async () => {
        seedCompany({ agentMonthlyBudgetUsd: 1 });
        seedRun(1.5);
        const args = { companyId: C, entity: { kind: 'task', id: TASK_ID }, config: { agent: 'Reviewer', skill: 'qa-review' }, context: { ruleId: '6f0000000000000000000b01', task: { _id: TASK_ID, ProjectID: 'p1' } } };
        await expect(runAgent.run(args)).rejects.toThrow('Reviewer cannot run: Company agent budget reached ($1.50 of $1 this month).');
        expect(mockDb.store[SCHEMA_TYPE.AGENT_RUNS]).toHaveLength(1);
    });
});

describe('80% and 100% alerts fire once each', () => {
    it('notifies every owner and admin once when 80% is crossed, then once at 100%', async () => {
        seedCompany({ agentMonthlyBudgetUsd: 10 });
        await spend(8.5);
        expect(handleNotificationtFun).toHaveBeenCalledTimes(1);
        const first = handleNotificationtFun.mock.calls[0][0].body;
        expect(first).toMatchObject({
            key: 'task_notification', type: 'tasks', changeType: 'agent_budget', companyId: C, projectId: 'p1', taskId: TASK_ID,
            userId: AGENT_ID, assigneeUsers: ['owner1', 'admin1'], notSeen: ['owner1', 'admin1'],
            message: 'Agent budget at 85%: $8.50 of $10 used this month.',
            changeData: { month: runs.monthKey(), level: '80', usedUsd: 8.5, budgetUsd: 10, percent: 85 },
        });
        expect(company().agentBudgetAlerts).toEqual({ month: runs.monthKey(), 80: expect.any(Date), 100: null });

        await spend(0.5);
        expect(handleNotificationtFun).toHaveBeenCalledTimes(1);

        await spend(2);
        expect(handleNotificationtFun).toHaveBeenCalledTimes(2);
        const second = handleNotificationtFun.mock.calls[1][0].body;
        expect(second.changeData).toMatchObject({ level: '100', usedUsd: 11, percent: 110 });
        expect(second.message).toMatch(/^Agent budget reached: \$11\.00 of \$10 used this month/);
        expect(company().agentBudgetAlerts[100]).toEqual(expect.any(Date));

        await spend(1);
        expect(handleNotificationtFun).toHaveBeenCalledTimes(2);
        expect(await runs.canStart(agent(), { companyId: C })).toMatchObject({ ok: false });
    });

    it('a month that jumps straight past 100% announces it once and stamps both levels', async () => {
        seedCompany({ agentMonthlyBudgetUsd: 10 });
        await spend(12);
        expect(handleNotificationtFun).toHaveBeenCalledTimes(1);
        expect(handleNotificationtFun.mock.calls[0][0].body.changeData.level).toBe('100');
        expect(company().agentBudgetAlerts).toEqual({ month: runs.monthKey(), 80: expect.any(Date), 100: expect.any(Date) });
        await spend(1);
        expect(handleNotificationtFun).toHaveBeenCalledTimes(1);
    });

    it('stays silent without a budget, for personal-account runs, and survives a failed notification', async () => {
        await spend(50);
        expect(handleNotificationtFun).not.toHaveBeenCalled();

        seedCompany({ agentMonthlyBudgetUsd: 10 });
        await spend(30, { viaAccount: 'personal' });
        expect(handleNotificationtFun).not.toHaveBeenCalled();

        handleNotificationtFun.mockRejectedValueOnce(new Error('smtp down'));
        const out = await spend(9);
        expect(out.usd).toBe(9);
        expect(handleNotificationtFun).toHaveBeenCalledTimes(1);
        expect(company().agentBudgetAlerts[80]).toEqual(expect.any(Date));
    });
});
