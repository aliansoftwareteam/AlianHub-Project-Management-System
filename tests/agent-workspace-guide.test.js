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
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const runs = require('../Modules/Agents/runs');
const policy = require('../Modules/Agents/policy');
const registry = require('../Modules/Agents/registry');
const ctrl = require('../Modules/Agents/controller');
const guide = require('../Modules/Agents/workspaceGuide');

const C = '6f0000000000000000000c01';
const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; return r; };
const req = (uid, extra = {}) => ({ headers: { companyid: C }, params: {}, query: {}, body: {}, uid, ...extra });
const guides = () => (mockDb.store[SCHEMA_TYPE.AGENTS] || []).filter((a) => a.builtIn === guide.KEY);

beforeAll(() => {
    require('../Modules/AICore/persistence').useInMemory();
    mockDb.uniqueFromSchema(SCHEMA_TYPE.AGENTS, require('../utils/mongo-handler/createSchema').agentsSchema);
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockPriced.ok = true;
    delete process.env.WORKSPACE_GUIDE_AUTO_CREATE;
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

    it('never acts on a write: it refuses what is not allowed and proposes what is', async () => {
        const agent = await agentRow();
        const task = { ProjectID: 'p1' };
        const decide = (action) => policy.decide({ agent, action, params: {}, rating: registry.rating ? registry.rating(action) : { write: true, reversible: true, scope: 'task', money: false }, task });
        expect(decide('task.status.set').decision).toBe(policy.DECISION.REFUSE);
        expect(decide('task.delete').decision).toBe(policy.DECISION.REFUSE);
        for (const action of ['task.comment', 'subtask.create']) expect(decide(action).decision).not.toBe(policy.DECISION.ACT);
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

describe('the company-create setting', () => {
    it('adds the guide to a new workspace by default', async () => {
        await guide.onCompanyCreated(C, 'owner1');
        expect(guides()).toHaveLength(1);
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
