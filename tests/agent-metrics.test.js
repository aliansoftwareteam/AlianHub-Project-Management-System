const fake = require('./fixtures/fakeMongo');

const mockDb = fake.create();
const mockOther = fake.create();
const mockOtherId = '6f0000000000000000000c02';

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, ...a) => (companyId === mockOtherId ? mockOther : mockDb).crud(companyId, ...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ ROLE_OWNER: 1, ROLE_ADMIN: 2, getRoleType: jest.fn(async (c, uid) => (uid === 'member1' ? 3 : 1)), isPrivileged: (r) => r === 1 || r === 2 }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Agents/actor', () => ({ resolveActor: jest.fn(async (req) => (req.agent ? { kind: 'agent', userId: req.uid, agentId: 'a1' } : { kind: 'human', userId: req.uid })), isAgent: (a) => a.kind === 'agent', attribution: () => ({}) }));
jest.mock('../Modules/AICore/llmProvider', () => ({ getProvider: jest.fn(() => { throw new Error('not configured'); }) }));
jest.mock('../Config/config', () => ({ myCache: new (require('node-cache'))() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { myCache } = require('../Config/config');
const metrics = require('../Modules/Agents/metrics');
const ctrl = require('../Modules/Agents/metricsController');

const C = '6f0000000000000000000c01';
const NOW = new Date();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const ago = (ms) => new Date(NOW.getTime() - ms);
const after = (d, ms) => new Date(d.getTime() + ms);

const res = () => {
    const r = { code: 200, body: null, headers: {} };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; return r; };
    r.set = (k, v) => { r.headers[k] = v; return r; };
    return r;
};
const req = (over = {}) => ({ headers: { companyid: C }, params: {}, query: {}, uid: 'owner1', ...over });

let ids;

const run = (db, agentId, agentName, status, startedAt, durationMs, spend, extra = {}) => db.seed(SCHEMA_TYPE.AGENT_RUNS, {
    agentId, agentName, status, startedAt, createdAt: startedAt,
    ...(durationMs === null ? {} : { finishedAt: after(startedAt, durationMs) }),
    spend: { tokens: 0, usd: 0, model: null, ...spend }, ...extra,
});

const seed = () => {
    [mockDb, mockOther].forEach((db) => { Object.keys(db.store).forEach((k) => { db.store[k].length = 0; }); db.calls.length = 0; });
    myCache.flushAll();
    mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: C, Cst_CompanyName: 'Acme Secret Corp' });
    mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: mockOtherId, Cst_CompanyName: 'Globex Hidden Ltd' });

    const r1 = run(mockDb, 'a1', 'Sentinel QA', 'done', ago(2 * HOUR), 60 * 1000, { tokens: 1000, usd: 0.5, model: 'claude-x' }, { steps: [{ name: 'model.call', durationMs: 800 }, { name: 'tool.call', durationMs: 100, status: 'failed' }] });
    const r2 = run(mockDb, 'a1', 'Sentinel QA', 'failed', ago(3 * HOUR), 120 * 1000, { tokens: 500, usd: 0.25, model: 'claude-x' });
    const r3 = run(mockDb, 'a1', 'Sentinel QA', 'done', ago(5 * HOUR), 30 * 1000, { tokens: 200, usd: 0.1, model: 'gpt-y' });
    const r4 = run(mockDb, 'a1', 'Sentinel QA', 'running', ago(10 * MIN), null, {});
    run(mockDb, 'a1', 'Sentinel QA', 'done', ago(30 * HOUR), 5 * 1000, { tokens: 9000, usd: 9, model: 'claude-x' });
    run(mockDb, 'a2', 'Digest', 'done', ago(1 * HOUR), 10 * 1000, { tokens: 100, usd: 0.05, model: 'gpt-y' });

    const proposal = (status, createdAt, extra = {}) => mockDb.seed(SCHEMA_TYPE.AGENT_PROPOSALS, { agentId: 'a1', agentName: 'Sentinel QA', what: 'x', status, createdAt, ...extra });
    proposal('approved', ago(2 * HOUR));
    proposal('edited', ago(2 * HOUR));
    proposal('declined', ago(3 * HOUR));
    proposal('undone', ago(4 * HOUR));
    proposal('failed', ago(1 * HOUR), { failedReason: 'applying for more than 5 minutes — the decider never finished, so the changes were not re-applied' });
    proposal('failed', ago(1 * HOUR), { failedReason: 'the task was deleted' });
    proposal('pending', ago(1 * HOUR));
    proposal('declined', ago(40 * HOUR));

    const audit = (action, meta, createdAt) => mockDb.seed(SCHEMA_TYPE.AUDIT_LOGS, { action, meta, createdAt });
    const act1 = audit('agent.action', { agentId: 'a1', runId: String(r1._id) }, ago(2 * HOUR));
    const act3 = audit('agent.action', { agentId: 'a1', runId: String(r3._id) }, ago(5 * HOUR));
    const act4 = audit('agent.action', { agentId: 'a1', runId: String(r4._id) }, ago(5 * MIN));
    audit('agent.run_reverted', { agentId: 'a1', runId: String(r1._id) }, ago(1 * HOUR));
    audit('agent.action_undone', { originalAuditId: String(act1._id) }, ago(1 * HOUR));
    audit('agent.action_undone', { originalAuditId: String(act3._id) }, ago(1 * HOUR));
    audit('agent.run_reverted', { agentId: 'a1', runId: String(r2._id) }, ago(26 * HOUR));
    audit('agent.action_undone', { originalAuditId: String(act4._id) }, ago(30 * HOUR));

    const usage = (model, feature, totalTokens, costUsd, at) => mockDb.seed(SCHEMA_TYPE.AI_USAGE, { model, provider: model.startsWith('claude') ? 'anthropic' : 'openai', feature, inputTokens: totalTokens / 2, outputTokens: totalTokens / 2, totalTokens, costUsd, at });
    usage('claude-x', 'agent_run', 1000, 0.5, ago(2 * HOUR));
    usage('claude-x', 'agent_run', 500, 0.25, ago(3 * HOUR));
    usage('gpt-y', 'ask', 300, 0.15, ago(4 * HOUR));
    usage('gpt-y', 'agent_run', 100, 0.05, ago(1 * HOUR));
    usage('gpt-y', 'ask', 50, null, ago(6 * HOUR));
    usage('claude-x', 'agent_run', 9000, 5, ago(48 * HOUR));

    const automation = (ruleId, ruleName, status, startedAt, durationMs, steps = []) => mockDb.seed(SCHEMA_TYPE.AUTOMATION_RUNS, {
        ruleId, ruleName, eventId: `e${Math.random()}`, status, startedAt, ...(durationMs === null ? {} : { finishedAt: after(startedAt, durationMs) }), steps,
    });
    automation('r1', 'Triage', 'success', ago(1 * HOUR), 10 * 1000, [{ id: 's1', type: 'action', action: 'task.comment', durationMs: 5 }]);
    automation('r1', 'Triage', 'failed', ago(2 * HOUR), 20 * 1000, [{ id: 's1', type: 'action', action: 'task.comment', durationMs: 15, error: 'boom' }]);
    automation('r1', 'Triage', 'success', ago(3 * HOUR), 40 * 1000);
    automation('r1', 'Triage', 'success', ago(48 * HOUR), 99 * 1000);
    automation('r2', 'Escalate', 'running', ago(20 * MIN), null);

    run(mockOther, 'a9', 'Other Agent', 'done', ago(1 * HOUR), 1000, { tokens: 10, usd: 0.01, model: 'claude-x' });
    mockOther.seed(SCHEMA_TYPE.AGENT_PROPOSALS, { agentId: 'a9', what: 'y', status: 'declined', createdAt: ago(1 * HOUR) });

    ids = { r1, r2, r3, r4 };
};

beforeEach(() => {
    jest.clearAllMocks();
    seed();
});

describe('companyMetrics over a 24h window', () => {
    let data;
    beforeEach(async () => { data = await metrics.companyMetrics(C, '24h', { now: NOW }); });

    it('computes per-agent runs, error rate, durations, proposals, reverts, tokens, cost and last run', () => {
        const a1 = data.agents.find((a) => a.agentId === 'a1');
        expect(a1).toMatchObject({
            agentName: 'Sentinel QA',
            runs: 4, finished: 3, failed: 1,
            p50DurationMs: 60000, p95DurationMs: 120000,
            proposals: { approved: 2, declined: 1, undone: 1, failed: 1, reaped: 1, pending: 1 },
            approvalRate: 0.75, declineRate: 0.25,
            reverted: 2, revertRate: 0.5,
            tokens: 1700,
            lastRunAt: ago(10 * MIN).toISOString(),
        });
        expect(a1.errorRate).toBeCloseTo(1 / 3, 10);
        expect(a1.costUsd).toBeCloseTo(0.85, 10);

        const a2 = data.agents.find((a) => a.agentId === 'a2');
        expect(a2).toMatchObject({ runs: 1, finished: 1, failed: 0, errorRate: 0, p50DurationMs: 10000, p95DurationMs: 10000, approvalRate: null, declineRate: null, reverted: 0, revertRate: 0, tokens: 100, costUsd: 0.05 });
    });

    it('buckets each agent\'s runs by hour for the sparkline', () => {
        const a1 = data.agents.find((a) => a.agentId === 'a1');
        expect(a1.series).toHaveLength(24);
        expect(a1.series[0].at).toBe(ago(24 * HOUR).toISOString());
        const busy = a1.series.map((b, i) => [i, b.runs, b.failed]).filter(([, n]) => n);
        expect(busy).toEqual([[19, 1, 0], [21, 1, 1], [22, 1, 0], [23, 1, 0]]);
        expect(data.agents.find((a) => a.agentId === 'a2').series[23].runs).toBe(1);
    });

    it('computes per-model calls, tokens, cost and run error rate', () => {
        const claude = data.models.find((m) => m.model === 'claude-x');
        expect(claude).toMatchObject({ provider: 'anthropic', calls: 2, tokens: 1500, unpricedCalls: 0, finishedRuns: 2, failedRuns: 1, errorRate: 0.5 });
        expect(claude.costUsd).toBeCloseTo(0.75, 10);
        const gpt = data.models.find((m) => m.model === 'gpt-y');
        expect(gpt).toMatchObject({ calls: 3, tokens: 450, unpricedCalls: 1, finishedRuns: 2, failedRuns: 0, errorRate: 0 });
        expect(gpt.costUsd).toBeCloseTo(0.2, 10);
        expect(data.models.map((m) => m.model)).toEqual(['claude-x', 'gpt-y']);
    });

    it('computes per-feature calls, tokens and cost', () => {
        expect(data.features).toEqual([
            { feature: 'agent_run', calls: 3, tokens: 1600, costUsd: 0.8 },
            { feature: 'ask', calls: 2, tokens: 350, costUsd: 0.15 },
        ]);
    });

    it('computes per-rule runs, failures and p95 duration', () => {
        expect(data.rules).toEqual([
            { ruleId: 'r1', ruleName: 'Triage', runs: 3, failures: 1, failureRate: 1 / 3, p95DurationMs: 40000 },
            { ruleId: 'r2', ruleName: 'Escalate', runs: 1, failures: 0, failureRate: 0, p95DurationMs: null },
        ]);
    });

    it('computes per-step calls, errors and p95 from agent and automation steps', () => {
        expect(data.steps).toEqual(expect.arrayContaining([
            { source: 'automation', step: 'task.comment', calls: 2, errors: 1, errorRate: 0.5, p95DurationMs: 15 },
            { source: 'agent', step: 'model.call', calls: 1, errors: 0, errorRate: 0, p95DurationMs: 800 },
            { source: 'agent', step: 'tool.call', calls: 1, errors: 1, errorRate: 1, p95DurationMs: 100 },
        ]));
        expect(data.steps).toHaveLength(3);
    });

    it('rolls the totals up', () => {
        expect(data.totals).toMatchObject({ runs: 5, finished: 4, failed: 1, errorRate: 0.25, reverted: 2, revertRate: 0.4, calls: 5, tokens: 1950, approvalRate: 0.75 });
        expect(data.totals.costUsd).toBeCloseTo(0.95, 10);
        expect(data).toMatchObject({ window: '24h', from: ago(24 * HOUR).toISOString(), to: NOW.toISOString(), bucketMs: HOUR });
    });

    it('matches on the window before anything else in every pipeline', () => {
        const pipelines = mockDb.calls.filter((c) => c.method === 'aggregate').map((c) => c.data[0]);
        expect(pipelines).toHaveLength(6);
        pipelines.forEach((p) => expect(Object.keys(p[0])).toEqual(['$match']));
    });
});

describe('the window excludes rows outside it', () => {
    it('drops the old run, proposal, usage, revert, undo and automation rows', async () => {
        const data = await metrics.companyMetrics(C, '24h', { now: NOW });
        expect(data.agents.find((a) => a.agentId === 'a1').tokens).toBe(1700);
        expect(data.agents.find((a) => a.agentId === 'a1').proposals.declined).toBe(1);
        expect(data.models.find((m) => m.model === 'claude-x').tokens).toBe(1500);
        expect(data.rules[0].runs).toBe(3);
        expect(data.agents.find((a) => a.agentId === 'a1').reverted).toBe(2);
    });

    it('widens with the window', async () => {
        const data = await metrics.companyMetrics(C, '7d', { now: NOW });
        const a1 = data.agents.find((a) => a.agentId === 'a1');
        expect(a1).toMatchObject({ runs: 5, tokens: 10700, reverted: 4 });
        expect(a1.proposals.declined).toBe(2);
        expect(a1.series).toHaveLength(7);
        expect(data.rules[0].runs).toBe(4);
    });

    it('narrows to the last hour', async () => {
        const data = await metrics.companyMetrics(C, '1h', { now: NOW });
        expect(data.agents.map((a) => [a.agentId, a.runs])).toEqual([['a1', 1], ['a2', 1]]);
        expect(data.agents[0].series).toHaveLength(12);
        expect(data.totals.calls).toBe(1);
    });

    it('refuses an unknown window', () => {
        expect(() => metrics.windowOf('2w', NOW)).toThrow(/window must be one of 1h, 24h, 7d, 30d/);
    });
});

describe('per-model errors read provider failures', () => {
    it('attributes a failed run to the failing model and counts its failure type', async () => {
        run(mockDb, 'a2', 'Digest', 'failed', ago(30 * MIN), 1000, { model: 'gpt-y' }, { failure: { type: 'rate_limit', provider: 'deepseek', model: 'deepseek-z' } });
        run(mockDb, 'a2', 'Digest', 'failed', ago(40 * MIN), 1000, { model: 'gpt-y' }, { failure: { type: 'quota', provider: 'openai' } });
        const data = await metrics.companyMetrics(C, '24h', { now: NOW });
        expect(data.models.find((m) => m.model === 'deepseek-z')).toMatchObject({ provider: 'deepseek', finishedRuns: 1, failedRuns: 1, errorRate: 1, errorTypes: { rate_limit: 1 } });
        expect(data.models.find((m) => m.model === 'gpt-y')).toMatchObject({ provider: 'openai', finishedRuns: 3, failedRuns: 1, errorTypes: { quota: 1 } });
        expect(data.models.find((m) => m.model === 'claude-x').errorTypes).toEqual({ unknown: 1 });
    });
});

describe('GET /api/v2/agents/metrics', () => {
    const get = async (over) => { const r = res(); await ctrl.getMetrics(req(over), r); return r; };

    it('answers an owner with the company\'s figures', async () => {
        const r = await get();
        expect(r.code).toBe(200);
        expect(r.body).toMatchObject({ status: true, data: { window: '24h' } });
        expect(r.body.data.agents.map((a) => a.agentId).sort()).toEqual(['a1', 'a2']);
    });

    it('refuses a member with 403', async () => {
        const r = await get({ uid: 'member1' });
        expect(r.code).toBe(403);
        expect(r.body).toMatchObject({ status: false, statusText: 'Owner/admin only.' });
        expect(mockDb.calls.filter((c) => c.method === 'aggregate')).toHaveLength(0);
    });

    it('refuses an agent token with 403', async () => {
        expect((await get({ agent: true })).code).toBe(403);
    });

    it('refuses a request without a user or company with 401', async () => {
        expect((await get({ uid: undefined })).code).toBe(401);
        expect((await get({ headers: {} })).code).toBe(401);
    });

    it('refuses an unknown window with 400', async () => {
        expect((await get({ query: { window: 'forever' } })).code).toBe(400);
    });

    it('caches for 60 seconds per company and window', async () => {
        await get();
        const afterFirst = mockDb.calls.length;
        await get();
        expect(mockDb.calls.length).toBe(afterFirst);
        await get({ query: { window: '7d' } });
        expect(mockDb.calls.length).toBeGreaterThan(afterFirst);
        expect(myCache.getTtl(`agentMetrics:${C}:24h`) - Date.now()).toBeLessThanOrEqual(60 * 1000);
    });
});

const SAMPLE = /^[a-zA-Z_:][a-zA-Z0-9_:]*(\{[a-zA-Z_][a-zA-Z0-9_]*="(?:[^"\\\n]|\\.)*"(,[a-zA-Z_][a-zA-Z0-9_]*="(?:[^"\\\n]|\\.)*")*\})? (-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?|NaN|[+-]Inf)$/;
const COMMENT = /^# (HELP [a-zA-Z_:][a-zA-Z0-9_:]* .+|TYPE [a-zA-Z_:][a-zA-Z0-9_:]* (counter|gauge|summary|histogram|untyped))$/;

describe('Prometheus exposition', () => {
    let text;
    beforeEach(async () => { text = metrics.prometheusText(await metrics.instanceSnapshot({ now: NOW })); });

    it('parses: every line is a comment or a sample in the text format', () => {
        const lines = text.split('\n');
        expect(lines[lines.length - 1]).toBe('');
        lines.slice(0, -1).forEach((line) => expect(line).toMatch(line.startsWith('#') ? COMMENT : SAMPLE));
    });

    it('carries the named families', () => {
        ['alianhub_agent_runs_total counter', 'alianhub_agent_run_duration_seconds summary', 'alianhub_ai_tokens_total counter', 'alianhub_ai_cost_usd_total counter', 'alianhub_agent_proposals_total counter', 'alianhub_automation_runs_total counter']
            .forEach((t) => expect(text).toContain(`# TYPE ${t}`));
    });

    it('counts across every retained row and every company', () => {
        expect(text).toContain(`alianhub_agent_runs_total{company="${C}",agent="a1",status="done"} 3`);
        expect(text).toContain(`alianhub_agent_runs_total{company="${C}",agent="a1",status="failed"} 1`);
        expect(text).toContain(`alianhub_agent_runs_total{company="${mockOtherId}",agent="a9",status="done"} 1`);
        expect(text).toContain('alianhub_ai_tokens_total{model="claude-x",feature="agent_run"} 10500');
        expect(text).toContain('alianhub_ai_cost_usd_total{model="gpt-y",feature="ask"} 0.15');
        expect(text).toContain('alianhub_agent_proposals_total{outcome="declined"} 3');
        expect(text).toContain('alianhub_agent_proposals_total{outcome="reaped"} 1');
        expect(text).toContain('alianhub_agent_proposals_total{outcome="failed"} 1');
        expect(text).toContain('alianhub_agent_proposals_total{outcome="approved"} 2');
        expect(text).toContain('alianhub_automation_runs_total{status="success"} 3');
        expect(text).toContain(`alianhub_agent_run_duration_seconds{company="${C}",quantile="0.5"} 30`);
        expect(text).toContain(`alianhub_agent_run_duration_seconds{company="${C}",quantile="0.95"} 120`);
        expect(text).toContain(`alianhub_agent_run_duration_seconds_count{company="${C}"} 4`);
    });

    it('labels companies and agents by id, never by name', () => {
        ['Acme', 'Globex', 'Sentinel', 'Digest', 'Other Agent', 'Triage'].forEach((name) => expect(text).not.toContain(name));
    });

    it('escapes label values', () => {
        const out = metrics.prometheusText({ companies: [{ companyId: C, runs: [{ agentId: 'a"b\\c', status: 'done', n: 1 }], usage: [], proposals: { approved: 0, declined: 0, undone: 0, failed: 0, reaped: 0, pending: 0 }, automations: [], durations: { quantiles: { 0.5: null, 0.95: null }, sumMs: 0, count: 0 } }] });
        expect(out).toContain('agent="a\\"b\\\\c"');
        out.split('\n').filter(Boolean).forEach((line) => expect(line).toMatch(line.startsWith('#') ? COMMENT : SAMPLE));
    });

    it('serves the text with the exposition content type and caches it', async () => {
        const r = res();
        await ctrl.instanceMetrics(req(), r);
        expect(r.headers['Content-Type']).toBe('text/plain; version=0.0.4; charset=utf-8');
        expect(r.body).toContain('# TYPE alianhub_agent_runs_total counter');
        const calls = mockDb.calls.length;
        await ctrl.instanceMetrics(req(), res());
        expect(mockDb.calls.length).toBe(calls);
    });

    it('skips a company whose database fails and counts it', async () => {
        const broken = mockOther.crud.getMockImplementation();
        mockOther.crud.mockImplementation(async () => { throw new Error('down'); });
        const snapshot = await metrics.instanceSnapshot({ now: NOW });
        mockOther.crud.mockImplementation(broken);
        expect(snapshot.failures).toBe(1);
        expect(metrics.prometheusText(snapshot)).toContain('alianhub_metrics_company_failures 1');
    });
});

describe('routes', () => {
    it('registers the instance metrics behind the instance admin guard', () => {
        jest.isolateModules(() => {
            jest.doMock('../Modules/Instance/controller', () => new Proxy({}, { get: () => jest.fn() }));
            jest.doMock('../Modules/Instance/guard', () => ({ requireInstanceAdmin: jest.fn() }));
            const order = [];
            const app = { use: (p) => order.push(`use ${p}`), get: (p) => order.push(`get ${p}`), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
            require('../Modules/Instance/routes').init(app);
            expect(order.indexOf('get /api/v2/instance/metrics')).toBeGreaterThan(order.indexOf('use /api/v2/instance'));
        });
    });

    it('registers the company metrics under the agents prefix', () => {
        const paths = [];
        const app = { use: jest.fn(), get: (p) => paths.push(p), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
        require('../Modules/Agents/routes').init(app);
        expect(paths).toContain('/api/v2/agents/metrics');
    });
});

describe('pure helpers', () => {
    it('takes the nearest-rank quantile', () => {
        expect(metrics.quantile([], 0.5)).toBeNull();
        expect(metrics.quantile([5], 0.95)).toBe(5);
        expect(metrics.quantile([4, 1, 3, 2], 0.5)).toBe(2);
        expect(metrics.quantile([4, 1, 3, 2], 0.95)).toBe(4);
    });

    it('maps proposal statuses to outcomes', () => {
        expect(['approved', 'edited', 'declined', 'undone', 'applying', 'pending'].map((status) => metrics.outcomeOf({ status })))
            .toEqual(['approved', 'approved', 'declined', 'undone', 'pending', 'pending']);
        expect(metrics.outcomeOf({ status: 'failed', failedReason: 'applying for more than 5 minutes' })).toBe('reaped');
        expect(metrics.outcomeOf({ status: 'failed', failedReason: 'boom' })).toBe('failed');
    });

    it('keeps the fixture ids stable', () => { expect(Object.keys(ids)).toEqual(['r1', 'r2', 'r3', 'r4']); });
});
