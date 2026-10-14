const mockDb = require('./fixtures/fakeMongo').create();
const mockPriced = { ok: true };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async (company, uid) => ({ owner1: 'owner', member1: 'member' }[uid] || null)),
    isPrivileged: (r) => r === 'owner' || r === 'admin',
}));
jest.mock('../Modules/Agents/actor', () => ({
    resolveActor: jest.fn(async (req) => (req.agent ? { kind: 'agent', userId: req.uid, agentId: 'x' } : { kind: 'human', userId: req.uid })),
    isAgent: (a) => a.kind === 'agent',
    attribution: (a) => ({ actorId: a.userId, label: a.userId }),
}));
jest.mock('../Modules/AICore/usage', () => ({
    checkConfiguredModelPriced: () => (mockPriced.ok ? { ok: true, reason: '' } : { ok: false, reason: 'No priced model.', code: 'unpriced_model' }),
    unpricedMessage: (m) => `No price on file for ${m}`,
    UNPRICED_MODEL: 'unpriced_model',
    summarize: () => ({ costUsd: 0, totalTokens: 0, model: 'm' }),
}));
jest.mock('../Modules/Agents/engine/orchestrator', () => ({ gather: jest.fn(async () => ({ status: 'gathered', context: {} })), analyse: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const orchestrator = require('../Modules/Agents/engine/orchestrator');
const { rating } = require('../Modules/Agents/actions');
const triggers = require('../Modules/Agents/triggers');
const runs = require('../Modules/Agents/runs');
const policy = require('../Modules/Agents/policy');
const ctrl = require('../Modules/Agents/controller');
const guide = require('../Modules/Agents/workspaceGuide');

const C = '6f0000000000000000000c01';
const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; return r; };
const req = (uid, extra = {}) => ({ headers: { companyid: C }, params: {}, query: {}, body: {}, uid, ...extra });
const TASK = { _id: '6f0000000000000000000701', TaskName: 'Plan the launch', TaskKey: 'GD-1', ProjectID: 'p1' };
const guides = () => (mockDb.store[SCHEMA_TYPE.AGENTS] || []).filter((a) => a.builtIn === guide.KEY);

beforeAll(() => {
    require('../Modules/AICore/persistence').useInMemory();
    mockDb.uniqueFromSchema(SCHEMA_TYPE.AGENTS, require('../utils/mongo-handler/createSchema').agentsSchema);
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockPriced.ok = true;
    delete process.env.WORKSPACE_GUIDE_AUTO_CREATE;
    process.env.AI_BUDGET_CACHE_MS = '0';
    jest.clearAllMocks();
});

describe('ensureWorkspaceAgent', () => {
    it('makes a mention-only, built-in agent that proposes and does not write on its own', async () => {
        const out = await guide.ensureWorkspaceAgent(C, { ownerId: 'owner1' });
        expect(out).toMatchObject({ created: true, state: 'present' });
        const [row] = guides();
        expect(row).toMatchObject({ name: 'Workspace Guide', builtIn: 'workspace-guide', trigger: 'mention', paused: false, deletedStatusKey: 0, account: 'workspace' });
        expect(row.autonomy).toBeLessThan(policy.REVIEW_LEVEL);
        expect(row.allowedActions).toEqual(['task.get', 'task.comment', 'subtask.create']);
        expect(row.schedule).toBeUndefined();
        expect(row.projectIds).toEqual([]);
        expect(row.spendCapUsd).toBeGreaterThan(0);
        expect(row.rateLimitPerDay).toBeGreaterThan(0);
    });

    it('is idempotent', async () => {
        await guide.ensureWorkspaceAgent(C, { ownerId: 'owner1' });
        const again = await guide.ensureWorkspaceAgent(C, { ownerId: 'owner1' });
        expect(again).toMatchObject({ created: false, state: 'present' });
        expect(guides()).toHaveLength(1);
    });

    it('leaves exactly one under concurrent calls', async () => {
        const all = await Promise.all(Array.from({ length: 6 }, () => guide.ensureWorkspaceAgent(C, { ownerId: 'owner1' })));
        expect(guides()).toHaveLength(1);
        expect(all.filter((o) => o.created)).toHaveLength(1);
        all.forEach((o) => expect(String(o.agent._id)).toBe(String(guides()[0]._id)));
    });

    it('does not make one again once it was removed', async () => {
        await guide.ensureWorkspaceAgent(C, { ownerId: 'owner1' });
        const del = res();
        await ctrl.deleteAgent(req('owner1', { params: { id: String(guides()[0]._id) } }), del);
        expect(del.code).toBe(200);
        const out = await guide.ensureWorkspaceAgent(C, { ownerId: 'owner1' });
        expect(out).toMatchObject({ created: false, state: 'removed' });
        expect(guides()).toHaveLength(1);
        expect(await guide.stateOf(C)).toBe('removed');
    });

    it('keeps a rename an admin made', async () => {
        await guide.ensureWorkspaceAgent(C, { ownerId: 'owner1' });
        guides()[0].name = 'Ask Ally';
        await guide.ensureWorkspaceAgent(C, { ownerId: 'owner1' });
        expect(guides()[0].name).toBe('Ask Ally');
    });

    it('audits the creation like any other agent change', async () => {
        await guide.ensureWorkspaceAgent(C, { ownerId: 'owner1' });
        const audit = JSON.stringify(Object.values(mockDb.store).flat());
        expect(audit).toContain('agent.created');
        expect(audit).toContain('built-in:workspace-guide');
    });
});

describe('what the Workspace Guide may do', () => {
    const agentRow = async () => { await guide.ensureWorkspaceAgent(C, { ownerId: 'owner1' }); return guides()[0]; };

    it('refuses what it is not allowed to do', async () => {
        const agent = await agentRow();
        const decide = (action) => policy.decide({ agent, action, params: {}, rating: rating(action), task: { ProjectID: 'p1' } });
        expect(decide('task.status.set').decision).toBe(policy.DECISION.REFUSE);
        expect(decide('task.delete').decision).toBe(policy.DECISION.REFUSE);
    });

    it('refuses a mention run once the company\'s daily AI budget is spent', async () => {
        const agent = await agentRow();
        mockDb.seed(dbCollections.COMPANIES, { _id: C, agentDailyBudgetUsd: 1 });
        mockDb.seed(SCHEMA_TYPE.AI_USAGE, { companyId: C, feature: 'ask', costUsd: 1.5, totalTokens: 10, billedToWorkspace: true, at: new Date() });
        const out = await triggers.launch(C, { agent, task: TASK, trigger: 'mention', startedBy: 'member1' });
        expect(out).toMatchObject({ started: false });
        expect(out.reason).toMatch(/daily AI budget reached/);
        expect(mockDb.store[SCHEMA_TYPE.AGENT_RUNS] || []).toHaveLength(0);
    });

    it('refuses a mention run once the company\'s monthly AI budget is spent', async () => {
        const agent = await agentRow();
        mockDb.seed(dbCollections.COMPANIES, { _id: C, agentMonthlyBudgetUsd: 2 });
        mockDb.seed(SCHEMA_TYPE.AI_USAGE, { companyId: C, feature: 'ask', costUsd: 2.5, totalTokens: 10, billedToWorkspace: true, at: new Date() });
        const out = await triggers.launch(C, { agent, task: TASK, trigger: 'mention', startedBy: 'member1' });
        expect(out).toMatchObject({ started: false });
        expect(out.reason).toMatch(/agent budget reached/);
        expect(mockDb.store[SCHEMA_TYPE.AGENT_RUNS] || []).toHaveLength(0);
    });

    it('is hidden from running when no priced model is configured', async () => {
        const agent = await agentRow();
        mockPriced.ok = false;
        expect((await runs.canStart(agent, { trigger: 'mention', companyId: C })).ok).toBe(false);
        mockPriced.ok = true;
        expect((await runs.canStart(agent, { trigger: 'mention', companyId: C })).ok).toBe(true);
    });

    it('has no schedule: a scheduled start is refused', async () => {
        const agent = await agentRow();
        expect((await runs.canStart(agent, { trigger: 'schedule', companyId: C })).ok).toBe(false);
    });

    it('counts its runs against the daily limit and its spend cap', async () => {
        const agent = await agentRow();
        for (let i = 0; i < agent.rateLimitPerDay; i += 1) mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: String(agent._id), status: 'done', startedAt: new Date() });
        expect((await runs.canStart(agent, { trigger: 'mention', companyId: C })).reason).toMatch(/Daily run limit reached/);
        const spent = { ...agent, rateLimitPerDay: 0, spendMonth: { month: runs.monthKey(), usd: agent.spendCapUsd } };
        expect((await runs.canStart(spent, { trigger: 'mention', companyId: C })).reason).toMatch(/Spend cap reached/);
    });

    it('is listed with its built-in mark for the @ menu', async () => {
        const agent = await agentRow();
        expect(require('../Modules/Agents/triggers').listed(agent).builtIn).toBe('workspace-guide');
    });
});

describe('a mention run of the Workspace Guide', () => {
    const OTHER_TASK = '6f0000000000000000000702';
    const reply = (taskId = TASK._id) => ({ action: 'task.comment', label: 'Post the next step', reversible: true, params: { taskId, body: 'Next step: write the brief.' } });
    const subtask = { action: 'subtask.create', label: 'Create subtask "Brief"', reversible: true, params: { taskId: TASK._id, title: 'Brief' } };
    const deps = () => ({
        proposals: { create: jest.fn(async () => ({ _id: 'prop1' })) },
        actions: { perform: jest.fn(async ({ action }) => ({ auditId: `aud-${action}`, result: {} })) },
        actor: { kind: 'agent', userId: 'member1', agentId: 'g', agentName: 'Workspace Guide', runId: null, viaAccount: 'workspace', tokenId: null },
    });
    const runWith = async (changes, trigger = 'mention') => {
        await guide.ensureWorkspaceAgent(C, { ownerId: 'owner1' });
        const agent = guides()[0];
        orchestrator.analyse.mockResolvedValue({ status: 'success', skill: 'plan', changes, summary: 'next step', usage: { totalTokens: 10 }, model: 'm' });
        const d = deps();
        const run = await runs.create(C, { agent, taskId: TASK._id, projectId: 'p1', skill: 'plan', trigger });
        const out = await runs.executeSkill(C, run, agent, TASK, d);
        return { d, out };
    };

    it('posts its reply on the task it was mentioned on and proposes every other write', async () => {
        const { d, out } = await runWith([subtask, reply(), reply(OTHER_TASK)]);
        expect(d.actions.perform.mock.calls.map(([a]) => [a.action, a.params.taskId, a.decision.decision])).toEqual([['task.comment', TASK._id, 'act']]);
        expect(d.proposals.create).toHaveBeenCalledTimes(1);
        expect(d.proposals.create.mock.calls[0][1].changes.map((c) => [c.action, c.params.taskId])).toEqual([['subtask.create', TASK._id], ['task.comment', OTHER_TASK]]);
        expect(out).toMatchObject({ status: 'waiting_approval', outcome: '1 change(s) applied, 2 proposed' });
    });

    it('ends done when the reply is all it had to say', async () => {
        const { d, out } = await runWith([reply()]);
        expect(d.actions.perform).toHaveBeenCalledTimes(1);
        expect(d.proposals.create).not.toHaveBeenCalled();
        expect(out).toMatchObject({ status: 'done' });
    });

    it('proposes its comment when it was not started by a mention', async () => {
        const { d } = await runWith([reply()], 'manual');
        expect(d.actions.perform).not.toHaveBeenCalled();
        expect(d.proposals.create).toHaveBeenCalledTimes(1);
    });

    it('gives no other agent the same pass', () => {
        const run = { trigger: 'mention' };
        expect(policy.isMentionReply({ agent: { builtIn: guide.KEY }, action: 'task.comment', params: { taskId: TASK._id }, run, task: TASK })).toBe(true);
        expect(policy.isMentionReply({ agent: {}, action: 'task.comment', params: { taskId: TASK._id }, run, task: TASK })).toBe(false);
        expect(policy.isMentionReply({ agent: { builtIn: guide.KEY }, action: 'subtask.create', params: { taskId: TASK._id }, run, task: TASK })).toBe(false);
    });
});

describe('PUT /api/v2/agents/:id on the Workspace Guide', () => {
    const put = async (body) => {
        await guide.ensureWorkspaceAgent(C, { ownerId: 'owner1' });
        const out = res();
        await ctrl.updateAgent(req('owner1', { params: { id: String(guides()[0]._id) }, body }), out);
        return out;
    };

    it('lets an admin rename it', async () => {
        const out = await put({ name: 'Ask Ally' });
        expect(out.code).toBe(200);
        expect(guides()[0].name).toBe('Ask Ally');
    });

    it.each([
        [{ autonomy: 3 }],
        [{ allowedActions: ['task.get', 'task.comment', 'task.status.set'] }],
        [{ projectIds: ['6f0000000000000000000901'] }],
        [{ name: 'Ask Ally', autonomy: 2 }],
    ])('refuses %j with a 400 and changes nothing', async (body) => {
        const out = await put(body);
        expect(out.code).toBe(400);
        expect(out.body).toMatchObject({ status: false, code: 'built_in_locked' });
        expect(guides()[0]).toMatchObject({ name: 'Workspace Guide', autonomy: guide.AUTONOMY, allowedActions: [...guide.ACTIONS], projectIds: [] });
    });

    it('refuses a draft revision that would widen it', async () => {
        await guide.ensureWorkspaceAgent(C, { ownerId: 'owner1' });
        const out = res();
        await ctrl.createRevision(req('owner1', { params: { id: String(guides()[0]._id) }, body: { autonomy: 3 } }), out);
        expect(out.code).toBe(400);
        expect(out.body.code).toBe('built_in_locked');
    });
});

describe('the company-create setting', () => {
    it('adds the guide to a new workspace by default', async () => {
        await guide.onCompanyCreated(C, 'owner1');
        expect(guides()).toHaveLength(1);
    });

    it('logs and does not throw when the guide cannot be made', async () => {
        const agentRecord = require('../Modules/Agents/agentRecord');
        const spy = jest.spyOn(agentRecord, 'createAgentRecord').mockRejectedValueOnce(new Error('db down'));
        await expect(guide.onCompanyCreated(C, 'owner1')).resolves.toEqual({ failed: true });
        expect(require('../Config/loggerConfig').error).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('adds none when WORKSPACE_GUIDE_AUTO_CREATE is false', async () => {
        process.env.WORKSPACE_GUIDE_AUTO_CREATE = 'false';
        expect(await guide.onCompanyCreated(C, 'owner1')).toEqual({ skipped: true });
        expect(guides()).toHaveLength(0);
    });
});

describe('POST /api/v2/agents/workspace-guide', () => {
    it('lets an owner add it once, then reports it is already there', async () => {
        const first = res();
        await ctrl.addWorkspaceGuide(req('owner1'), first);
        expect(first.body).toMatchObject({ status: true, data: { state: 'present', created: true } });
        const second = res();
        await ctrl.addWorkspaceGuide(req('owner1'), second);
        expect(second.body.data).toMatchObject({ state: 'present', created: false });
        expect(guides()).toHaveLength(1);
    });

    it('refuses a member', async () => {
        const out = res();
        await ctrl.addWorkspaceGuide(req('member1'), out);
        expect(out.code).toBe(403);
        expect(guides()).toHaveLength(0);
    });

    it('refuses an agent, even for an owner\'s token', async () => {
        const out = res();
        await ctrl.addWorkspaceGuide(req('owner1', { agent: true }), out);
        expect(out.code).toBe(403);
        expect(guides()).toHaveLength(0);
    });

    it('does not bring back a removed guide', async () => {
        await guide.ensureWorkspaceAgent(C, { ownerId: 'owner1' });
        await ctrl.deleteAgent(req('owner1', { params: { id: String(guides()[0]._id) } }), res());
        const out = res();
        await ctrl.addWorkspaceGuide(req('owner1'), out);
        expect(out.body.data).toMatchObject({ state: 'removed', created: false, agent: null });
        expect(guides()).toHaveLength(1);
    });
});
