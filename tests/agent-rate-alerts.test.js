const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ ROLE_OWNER: 1, ROLE_ADMIN: 2, getRoleType: jest.fn(async (c, uid) => ({ owner1: 1, admin1: 2 }[uid] || 3)), isPrivileged: (r) => r === 1 || r === 2 }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Agents/actor', () => ({ resolveActor: jest.fn(async (req) => ({ kind: 'human', userId: req.uid })), isAgent: (a) => a.kind === 'agent', attribution: () => ({}) }));
jest.mock('../Modules/AICore/llmProvider', () => ({ getProvider: jest.fn(() => { throw new Error('not configured'); }) }));
jest.mock('../Config/config', () => ({ myCache: new (require('node-cache'))() }));
jest.mock('../Modules/notification-count/controller', () => ({ updateUnReadCommentsCountFun: jest.fn(async () => ({ status: true })) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { removeCache } = require('../utils/commonFunctions');
const socketEmitter = require('../event/socketEventEmitter');
const { myCache } = require('../Config/config');
const { aiAlertsSchema } = require('../utils/mongo-handler/createSchema');
const alerts = require('../Modules/Agents/alerts');
const rules = require('../Modules/Agents/alertRules');
const metricsCtrl = require('../Modules/Agents/metricsController');
const spend = require('../Modules/AICore/spend');

const C = '6f0000000000000000000c01';
const NOW = new Date('2026-09-11T12:00:00.000Z');
const MIN = 60 * 1000;
const ago = (ms) => new Date(NOW.getTime() - ms);

const company = () => mockDb.store[dbCollections.COMPANIES][0];
const incidents = () => mockDb.store[SCHEMA_TYPE.AI_ALERTS] || [];
const openIncidents = () => incidents().filter((i) => i.status === 'open');
const companyNotices = () => mockDb.calls.filter((c) => c.companyId === C && c.type === SCHEMA_TYPE.NOTIFICATIONS && c.method === 'save').map((c) => c.data);
const globalNotices = () => mockDb.calls.filter((c) => c.companyId === dbCollections.GLOBAL && c.type === dbCollections.NOTIFICATIONS && c.method === 'save').map((c) => c.data);
const receivers = (rows) => rows.map((r) => r.receiverID).sort();
const evaluate = () => alerts.evaluateCompany(C, { now: NOW });
const resetCalls = () => { mockDb.calls.length = 0; };

const agentRun = (status, startedAt, extra = {}) => mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, {
    agentId: 'a1', agentName: 'Sentinel QA', status, startedAt, createdAt: startedAt,
    ...(['done', 'failed', 'skipped', 'stopped'].includes(status) ? { finishedAt: new Date(startedAt.getTime() + MIN) } : {}),
    ...extra,
});
const failingAgent = ({ failed = 2, done = 3 } = {}) => {
    for (let i = 0; i < failed; i += 1) agentRun('failed', ago((10 + i) * MIN));
    for (let i = 0; i < done; i += 1) agentRun('done', ago((20 + i) * MIN));
};
const proposal = (status, createdAt) => mockDb.seed(SCHEMA_TYPE.AGENT_PROPOSALS, { agentId: 'a1', status, createdAt });
const usage = (costUsd, at = ago(60 * MIN)) => mockDb.seed(SCHEMA_TYPE.AI_USAGE, { feature: 'agent_run', costUsd, totalTokens: 10, billedToWorkspace: true, at });

beforeAll(() => mockDb.uniqueFromSchema(SCHEMA_TYPE.AI_ALERTS, aiAlertsSchema));

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    resetCalls();
    jest.clearAllMocks();
    myCache.flushAll();
    mockDb.seed(dbCollections.COMPANIES, { _id: C, Cst_CompanyName: 'Acme', agentAlerts: { enabled: true } });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: 'owner1', roleType: 1 });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: 'admin1', roleType: 2 });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: 'member1', roleType: 3 });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: 'gone1', roleType: 1, isDelete: true });
    mockDb.seed(SCHEMA_TYPE.NOTIFICATIONS_SETTINGS, { userId: 'member1', aiAlerts: { agent_error_rate: true, approval_rate_falling: true, cost_forecast: true, queue_age: true } });
});

describe('alert settings', () => {
    it('declares the defaults', () => {
        expect(rules.settingsOf(undefined)).toEqual({ enabled: false, errorRatePct: 20, errorMinRuns: 5, approvalFloorPct: 50, approvalDropPts: 20, costForecastPct: 110, queueAgeMinutes: 15 });
    });

    it('merges a partial update over what is stored and refuses out-of-range values', () => {
        expect(rules.validate({ errorRatePct: '35' }, { queueAgeMinutes: 30 }).value).toMatchObject({ errorRatePct: 35, queueAgeMinutes: 30, errorMinRuns: 5 });
        expect(rules.validate({ errorMinRuns: 2.5 }).error).toMatch(/whole number/);
        expect(rules.validate({ costForecastPct: 0 }).error).toMatch(/between 1 and 1000/);
        expect(rules.validate({ bogus: 1 }).error).toMatch(/Unknown alert setting: bogus/);
        expect(rules.validate({ enabled: 'no' }).error).toMatch(/true or false/);
    });

    it('resolves opt-in defaults by role and keeps members out', () => {
        expect(rules.preferencesOf(1, undefined)).toEqual({ agent_error_rate: true, approval_rate_falling: true, cost_forecast: true, queue_age: true });
        expect(rules.preferencesOf(2, undefined)).toEqual({ agent_error_rate: false, approval_rate_falling: false, cost_forecast: true, queue_age: true });
        expect(rules.preferencesOf(2, { agent_error_rate: true, queue_age: false })).toMatchObject({ agent_error_rate: true, queue_age: false });
        expect(rules.preferencesOf(3, { agent_error_rate: true })).toBeNull();
    });

    it('reads the evaluation interval from AGENT_ALERTS_INTERVAL_MINUTES, default 15', () => {
        const saved = process.env.AGENT_ALERTS_INTERVAL_MINUTES;
        delete process.env.AGENT_ALERTS_INTERVAL_MINUTES;
        expect(alerts.intervalMs()).toBe(15 * MIN);
        process.env.AGENT_ALERTS_INTERVAL_MINUTES = '5';
        expect(alerts.intervalMs()).toBe(5 * MIN);
        if (saved === undefined) delete process.env.AGENT_ALERTS_INTERVAL_MINUTES; else process.env.AGENT_ALERTS_INTERVAL_MINUTES = saved;
    });
});

describe('agent_error_rate', () => {
    it('opens one incident and notifies the opted-in owners and admins only', async () => {
        failingAgent();
        const out = await evaluate();
        expect(out.opened).toEqual([expect.objectContaining({ type: 'agent_error_rate', key: 'a1', value: 40, notified: 1 })]);
        expect(openIncidents()).toEqual([expect.objectContaining({ type: 'agent_error_rate', key: 'a1', agentName: 'Sentinel QA', lastValue: 40, threshold: 20, window: '1h', notifiedUserIds: ['owner1'], traceId: expect.any(String) })]);
        expect(receivers(companyNotices())).toEqual(['owner1']);
        expect(companyNotices()[0]).toMatchObject({ key: 'agent_rate_alert', changeType: 'agent_alert', notificationType: 'push', assigneeUsers: ['owner1'], notSeen: ['owner1'], changeData: { alertType: 'agent_error_rate', state: 'open', lastValue: 40, threshold: 20 } });
        expect(globalNotices()).toHaveLength(1);
        expect(socketEmitter.emit).toHaveBeenCalledWith('insert', expect.objectContaining({ module: 'globalNotification' }));
        expect(removeCache).toHaveBeenCalledWith(`agentAlerts:${C}`);
    });

    it('includes an admin who opted in', async () => {
        mockDb.seed(SCHEMA_TYPE.NOTIFICATIONS_SETTINGS, { userId: 'admin1', aiAlerts: { agent_error_rate: true } });
        failingAgent();
        await evaluate();
        expect(receivers(companyNotices())).toEqual(['admin1', 'owner1']);
    });

    it('leaves out an owner who opted out', async () => {
        mockDb.seed(SCHEMA_TYPE.NOTIFICATIONS_SETTINGS, { userId: 'owner1', aiAlerts: { agent_error_rate: false } });
        failingAgent();
        await evaluate();
        expect(openIncidents()).toHaveLength(1);
        expect(companyNotices()).toEqual([]);
    });

    it('does not alert below errorMinRuns', async () => {
        failingAgent({ failed: 4, done: 0 });
        await evaluate();
        expect(incidents()).toEqual([]);
        expect(companyNotices()).toEqual([]);
    });

    it('notifies nobody on a second evaluation while still breached, and refreshes the value', async () => {
        failingAgent();
        await evaluate();
        agentRun('failed', ago(5 * MIN));
        resetCalls();
        const out = await evaluate();
        expect(out.opened).toEqual([]);
        expect(out.updated).toEqual([{ type: 'agent_error_rate', key: 'a1', value: 50 }]);
        expect(companyNotices()).toEqual([]);
        expect(incidents()).toHaveLength(1);
        expect(openIncidents()[0].lastValue).toBe(50);
    });

    it('resolves once the condition clears and sends one resolved notice', async () => {
        failingAgent();
        await evaluate();
        mockDb.store[SCHEMA_TYPE.AGENT_RUNS].forEach((r) => { r.status = 'done'; });
        resetCalls();
        const out = await evaluate();
        expect(out.resolved).toEqual([expect.objectContaining({ type: 'agent_error_rate', key: 'a1' })]);
        expect(incidents()).toEqual([expect.objectContaining({ status: 'resolved', resolvedAt: NOW })]);
        expect(companyNotices()).toEqual([expect.objectContaining({ receiverID: 'owner1', changeData: expect.objectContaining({ state: 'resolved' }) })]);

        resetCalls();
        await evaluate();
        expect(companyNotices()).toEqual([]);
    });
});

describe('approval_rate_falling', () => {
    it('opens when the 24h rate is under the floor with at least 5 decisions', async () => {
        proposal('approved', ago(60 * MIN));
        ['declined', 'declined', 'declined', 'declined'].forEach((s) => proposal(s, ago(120 * MIN)));
        await evaluate();
        expect(openIncidents()).toEqual([expect.objectContaining({ type: 'approval_rate_falling', key: 'company', lastValue: 20, threshold: 50, window: '24h' })]);
        expect(receivers(companyNotices())).toEqual(['owner1']);
    });

    it('opens when the 24h rate drops the configured points under the 7-day rate', async () => {
        for (let i = 0; i < 20; i += 1) proposal('approved', ago(3 * 24 * 60 * MIN));
        ['approved', 'approved', 'approved', 'declined', 'declined'].forEach((s) => proposal(s, ago(60 * MIN)));
        await evaluate();
        expect(openIncidents()).toEqual([expect.objectContaining({ type: 'approval_rate_falling', lastValue: 60, detail: expect.objectContaining({ reason: 'drop', baselinePct: 92 }) })]);
    });

    it('waits for 5 decided proposals', async () => {
        ['declined', 'declined', 'declined', 'declined', 'pending', 'failed'].forEach((s) => proposal(s, ago(60 * MIN)));
        await evaluate();
        expect(incidents()).toEqual([]);
    });
});

describe('cost_forecast', () => {
    it('opens when month-to-date spend projects past the budget share', async () => {
        company().agentMonthlyBudgetUsd = 100;
        usage(50);
        await evaluate();
        const [incident] = openIncidents();
        expect(incident).toMatchObject({ type: 'cost_forecast', key: 'company', threshold: 110, window: 'month', detail: { usedUsd: 50, budgetUsd: 100 } });
        expect(incident.lastValue).toBeCloseTo(142.9, 1);
        expect(receivers(companyNotices())).toEqual(['admin1', 'owner1']);
    });

    it('stays quiet on a projection under the threshold', async () => {
        company().agentMonthlyBudgetUsd = 100;
        usage(30);
        await evaluate();
        expect(incidents()).toEqual([]);
    });

    it('never alerts without a budget', async () => {
        usage(5000);
        const monthly = jest.spyOn(spend, 'monthly');
        await evaluate();
        expect(incidents()).toEqual([]);
        expect(monthly).not.toHaveBeenCalled();
        monthly.mockRestore();
    });
});

describe('queue_age', () => {
    it('opens on an agent run queued longer than the threshold', async () => {
        agentRun('queued', ago(20 * MIN));
        await evaluate();
        expect(openIncidents()).toEqual([expect.objectContaining({ type: 'queue_age', lastValue: 20, threshold: 15, detail: expect.objectContaining({ source: 'agent_run', status: 'queued' }) })]);
        expect(receivers(companyNotices())).toEqual(['admin1', 'owner1']);
    });

    it('opens on a pending automation run and ignores runs waiting for a person', async () => {
        agentRun('waiting_approval', ago(3 * 60 * MIN));
        mockDb.seed(SCHEMA_TYPE.AUTOMATION_RUNS, { ruleId: 'r1', eventId: 'e1', status: 'retrying', createdAt: ago(30 * MIN) });
        await evaluate();
        expect(openIncidents()).toEqual([expect.objectContaining({ type: 'queue_age', lastValue: 30, detail: expect.objectContaining({ source: 'automation_run' }) })]);
    });

    it('stays quiet for a young queue', async () => {
        agentRun('running', ago(5 * MIN));
        await evaluate();
        expect(incidents()).toEqual([]);
    });
});

describe('the evaluator', () => {
    it('evaluates nothing when alerts are disabled', async () => {
        company().agentAlerts = { enabled: false };
        failingAgent();
        agentRun('queued', ago(60 * MIN));
        resetCalls();
        const out = await evaluate();
        expect(out.skipped).toBe(true);
        expect(mockDb.calls.map((c) => c.type)).toEqual([dbCollections.COMPANIES]);
        expect(incidents()).toEqual([]);
    });

    it('stays off for a workspace that never switched alerts on', async () => {
        delete company().agentAlerts;
        failingAgent();
        const out = await evaluate();
        expect(out.skipped).toBe(true);
        expect(incidents()).toEqual([]);
    });

    it('uses the thresholds stored in company settings', async () => {
        company().agentAlerts = { enabled: true, errorRatePct: 50, errorMinRuns: 2 };
        failingAgent({ failed: 1, done: 2 });
        await evaluate();
        expect(incidents()).toEqual([]);
        company().agentAlerts = { enabled: true, errorRatePct: 30, errorMinRuns: 2 };
        await evaluate();
        expect(openIncidents()).toEqual([expect.objectContaining({ type: 'agent_error_rate', threshold: 30 })]);
    });

    it('keeps the job going when a notification cannot be written', async () => {
        failingAgent();
        const real = mockDb.crud.getMockImplementation();
        mockDb.crud.mockImplementation(async (companyId, query, method) => {
            if (query.type === SCHEMA_TYPE.NOTIFICATIONS && method === 'save') throw new Error('mail and push are down');
            return real(companyId, query, method);
        });
        try {
            const out = await evaluate();
            expect(out.opened).toEqual([expect.objectContaining({ notified: 0 })]);
            expect(openIncidents()[0].notifiedUserIds).toEqual([]);
        } finally {
            mockDb.crud.mockImplementation(real);
        }
    });

    it('leaves the incidents of a check that failed untouched', async () => {
        failingAgent();
        await evaluate();
        const real = mockDb.crud.getMockImplementation();
        mockDb.crud.mockImplementation(async (companyId, query, method) => {
            if (query.type === SCHEMA_TYPE.AGENT_RUNS && method === 'aggregate') throw new Error('timeout');
            return real(companyId, query, method);
        });
        try {
            const out = await evaluate();
            expect(out.failed).toEqual(['agent_error_rate']);
            expect(out.resolved).toEqual([]);
            expect(openIncidents()).toHaveLength(1);
        } finally {
            mockDb.crud.mockImplementation(real);
        }
    });

    it('allows one open incident per type and key, and a new one after resolution', async () => {
        const row = { type: 'queue_age', key: 'company', status: 'open', openedAt: NOW };
        await mockDb.crud(C, { type: SCHEMA_TYPE.AI_ALERTS, data: row }, 'save');
        await expect(mockDb.crud(C, { type: SCHEMA_TYPE.AI_ALERTS, data: row }, 'save')).rejects.toMatchObject({ code: 11000 });
        incidents()[0].status = 'resolved';
        await expect(mockDb.crud(C, { type: SCHEMA_TYPE.AI_ALERTS, data: row }, 'save')).resolves.toMatchObject({ status: 'open' });
    });

    it('runs every company and survives one that fails', async () => {
        mockDb.seed(dbCollections.COMPANIES, { _id: '6f0000000000000000000c02', agentAlerts: { enabled: true } });
        failingAgent();
        const real = mockDb.crud.getMockImplementation();
        mockDb.crud.mockImplementation(async (companyId, query, method) => {
            if (companyId === '6f0000000000000000000c02' && query.type === SCHEMA_TYPE.AI_ALERTS) throw new Error('down');
            return real(companyId, query, method);
        });
        try {
            const totals = await alerts.evaluateAll({ now: NOW });
            expect(totals).toMatchObject({ opened: 1, failures: 1 });
        } finally {
            mockDb.crud.mockImplementation(real);
        }
    });
});

describe('GET /agents/alerts and POST /agents/alerts/evaluate', () => {
    const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; return r; };
    const req = (uid) => ({ headers: { companyid: C }, params: {}, query: {}, uid });

    afterEach(() => jest.useRealTimers());

    it('lets an owner run the evaluator and list the open incidents', async () => {
        jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
        failingAgent();
        const ran = res();
        await metricsCtrl.evaluateAlerts(req('owner1'), ran);
        expect(ran.body).toMatchObject({ status: true, data: { opened: [expect.objectContaining({ type: 'agent_error_rate' })] } });
        const listed = res();
        await metricsCtrl.getAlerts(req('admin1'), listed);
        expect(listed.body.data.open).toEqual([expect.objectContaining({ type: 'agent_error_rate', key: 'a1', status: 'open' })]);
        expect(listed.body.data.resolved).toEqual([]);
    });

    it('refuses a member', async () => {
        const listed = res();
        await metricsCtrl.getAlerts(req('member1'), listed);
        expect(listed.code).toBe(403);
        const ran = res();
        await metricsCtrl.evaluateAlerts(req('member1'), ran);
        expect(ran.code).toBe(403);
        expect(incidents()).toEqual([]);
    });
});
