const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    ROLE_OWNER: 1, ROLE_ADMIN: 2,
    getRoleType: jest.fn(async (c, uid) => ({ owner1: 1, admin1: 2, member1: 3 })[uid]),
    isPrivileged: (r) => r === 1 || r === 2,
}));
jest.mock('../Modules/Agents/scope', () => ({
    visibleProjects: jest.fn(async () => [{ _id: '6f00000000000000000000a1', ProjectName: 'Mobile app' }]),
    visibleProjectIds: jest.fn(async () => ['6f00000000000000000000a1']),
}));
jest.mock('../Modules/Agents/actor', () => {
    const isAgent = (a) => Boolean(a && a.kind === 'agent');
    return {
        isAgent,
        resolveActor: jest.fn(async (req) => (req.agentToken
            ? { kind: 'agent', userId: req.uid, agentId: req.agentToken.agentId, agentName: 'Reviewer', viaAccount: 'workspace' }
            : { kind: 'human', userId: req.uid })),
        attribution: (a) => (isAgent(a) ? { actorId: a.agentId, actorType: 'agent', agentId: a.agentId, label: a.agentName } : { actorId: a.userId, actorType: 'human', label: '' }),
    };
});
jest.mock('../Modules/AICore/llmProvider/openaiProvider', () => ({ name: 'openai', model: 'gpt-4.1', isConfigured: true, chat: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider/anthropicProvider', () => ({ name: 'anthropic', model: null, isConfigured: false, chat: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider/deepseekProvider', () => ({ name: 'deepseek', model: null, isConfigured: false, chat: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const adapter = require('../Modules/AICore/llmProvider/openaiProvider');
const scope = require('../Modules/Agents/scope');
const registry = require('../Modules/Agents/registry');
const aiSwitch = require('../Modules/AICore/aiSwitch');

beforeAll(() => require('../Modules/AICore/persistence').useInMemory());
const ctrl = require('../Modules/Agents/builderController');
const builder = require('../Modules/Agents/builder');

const C = '6f0000000000000000000c01';
const VISIBLE = '6f00000000000000000000a1';
const HIDDEN = '6f00000000000000000000b2';
const AGENT_ID = '6f0000000000000000000a01';
const BUILT_IN_SKILLS = ['qa-review', 'brief.parse', 'project.plan', 'pr.summary', 'risk.flags', 'digest.ceo', 'risk.today', 'project.guide'];

const rows = (type) => mockDb.store[type] || [];
const ledger = () => rows(SCHEMA_TYPE.AI_USAGE);
const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; r.json = r.send; return r; };
const req = (uid, body = {}, over = {}) => ({ headers: { companyid: C }, params: {}, query: {}, body, uid, ip: '', ...over });
const call = async (handler, request) => { const r = res(); await handler(request, r); return r; };

const DESCRIPTION = 'Every morning, tell the Mobile app team which tasks are overdue or due soon.';

const greedy = {
    name: 'Deadline Watcher',
    description: 'Watches due dates on the Mobile app project.',
    skills: ['digest.ceo', 'hack.everything', 'pr.summary'],
    allowedActions: ['task.comment', 'tasks.search', 'task.get', 'deploy.staging', 'deploy.production', 'project.delete', 'task.delete',
        'billing.charge', 'permissions.edit', 'member.remove', 'git.merge', 'made.up'],
    autonomy: 3,
    projectIds: [VISIBLE, HIDDEN],
    spendCapUsd: 999,
    cadence: 'daily',
    why: {
        name: 'It watches deadlines.',
        skills: 'The digest lists overdue work and what is due in 48 hours.',
        actions: 'It only needs to read tasks and post a comment.',
        autonomy: 'It should act on its own.',
        scope: 'You named the Mobile app team.',
        spendCap: 'A daily digest is cheap.',
    },
};

const answerWith = (payload) => adapter.chat.mockImplementation(async () => ({
    content: JSON.stringify(payload), inputTokens: 1000, outputTokens: 500, totalTokens: 1500, model: 'gpt-4.1',
}));

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    aiSwitch.forget();
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_PRICING;
    delete process.env.AI_ENABLED;
    answerWith(greedy);
    mockDb.seed(dbCollections.COMPANIES, { _id: C });
    mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: AGENT_ID, name: 'Reviewer', ownerId: 'owner1', autonomy: 1, spendCapUsd: 1, paused: false, deletedStatusKey: 0 });
});

describe('who may draft an agent', () => {
    it.each(['member1'])('refuses %s before any model call', async (uid) => {
        const r = await call(ctrl.draftAgent, req(uid, { description: DESCRIPTION }));
        expect(r.code).toBe(403);
        expect(r.body).toMatchObject({ status: false, statusText: 'Only an Owner or an Admin can manage agents.' });
        expect(adapter.chat).not.toHaveBeenCalled();
        expect(ledger()).toHaveLength(0);
    });

    it('refuses an agent token even when the person behind it is the owner', async () => {
        const r = await call(ctrl.draftAgent, req('owner1', { description: DESCRIPTION }, { agentToken: { agentId: AGENT_ID } }));
        expect(r.code).toBe(403);
        expect(adapter.chat).not.toHaveBeenCalled();
    });

    it('asks for a sentence before it spends anything', async () => {
        const r = await call(ctrl.draftAgent, req('owner1', { description: 'hi' }));
        expect(r.code).toBe(400);
        expect(adapter.chat).not.toHaveBeenCalled();
    });

    it('refuses while AI is off for the workspace and books nothing', async () => {
        rows(dbCollections.COMPANIES)[0].aiSwitch = { enabled: false };
        const r = await call(ctrl.draftAgent, req('admin1', { description: DESCRIPTION }));
        expect(r.code).toBe(403);
        expect(r.body).toMatchObject({ status: false, code: aiSwitch.AI_OFF });
        expect(adapter.chat).not.toHaveBeenCalled();
        expect(ledger()).toHaveLength(0);
    });

    it('refuses once the month has reached the company budget', async () => {
        rows(dbCollections.COMPANIES)[0].agentMonthlyBudgetUsd = 1;
        mockDb.seed(SCHEMA_TYPE.AI_USAGE, { companyId: C, feature: 'ask', costUsd: 5, priced: true, billedToWorkspace: true, at: new Date(), month: new Date().toISOString().slice(0, 7) });
        const before = ledger().length;
        const r = await call(ctrl.draftAgent, req('owner1', { description: DESCRIPTION }));
        expect(r.code).toBe(403);
        expect(adapter.chat).not.toHaveBeenCalled();
        expect(ledger()).toHaveLength(before);
    });
});

describe('what a draft may contain', () => {
    it('keeps only skills this workspace can run', async () => {
        const r = await call(ctrl.draftAgent, req('owner1', { description: DESCRIPTION }));
        expect(r.body.status).toBe(true);
        expect(r.body.data.skills).toEqual(['digest.ceo']);
        r.body.data.skills.forEach((key) => expect(BUILT_IN_SKILLS).toContain(key));
    });

    it('keeps only registry actions a manager can hand an agent, never an owner/admin-only or never-listed one', async () => {
        const r = await call(ctrl.draftAgent, req('owner1', { description: DESCRIPTION }));
        const actions = r.body.data.allowedActions;
        expect(actions).toEqual(expect.arrayContaining(['task.comment', 'tasks.search', 'task.get']));
        actions.forEach((key) => {
            const action = registry.get(key);
            expect(action).toBeTruthy();
            expect(action.gate).toBeUndefined();
            expect(action.proposeOnly).toBeFalsy();
            expect(registry.isNever(key)).toBe(false);
        });
        ['deploy.staging', 'deploy.production', 'project.delete', 'task.delete', 'billing.charge', 'permissions.edit', 'member.remove', 'git.merge', 'made.up']
            .forEach((key) => expect(actions).not.toContain(key));
    });

    it('never drafts more autonomy than "Suggests changes"', async () => {
        const r = await call(ctrl.draftAgent, req('owner1', { description: DESCRIPTION }));
        expect(r.body.data.autonomy).toBe(1);
        expect(r.body.data.why.autonomy).toBeTruthy();
    });

    it('may draft less autonomy than that when the model asks for it', async () => {
        answerWith({ ...greedy, autonomy: 0 });
        const r = await call(ctrl.draftAgent, req('owner1', { description: DESCRIPTION }));
        expect(r.body.data.autonomy).toBe(0);
    });

    it('defaults to "Suggests changes" when the model says nothing usable', async () => {
        answerWith({ ...greedy, autonomy: 'max' });
        const r = await call(ctrl.draftAgent, req('owner1', { description: DESCRIPTION }));
        expect(r.body.data.autonomy).toBe(1);
    });

    it('scopes the draft to projects the creator can open and shows the model nothing else', async () => {
        const r = await call(ctrl.draftAgent, req('owner1', { description: DESCRIPTION }));
        expect(r.body.data.projectIds).toEqual([VISIBLE]);
        expect(scope.visibleProjects).toHaveBeenCalledWith(C, 'owner1');
        const prompt = JSON.stringify(adapter.chat.mock.calls[0][0]);
        expect(prompt).toContain('Mobile app');
        expect(prompt).not.toContain(HIDDEN);
    });

    it('never drafts a spend cap above the default for a new agent', async () => {
        const r = await call(ctrl.draftAgent, req('owner1', { description: DESCRIPTION }));
        expect(r.body.data.spendCapUsd).toBeGreaterThan(0);
        expect(r.body.data.spendCapUsd).toBeLessThanOrEqual(builder.DEFAULT_SPEND_CAP_USD);
    });

    it('explains each choice in one short line', async () => {
        const r = await call(ctrl.draftAgent, req('owner1', { description: DESCRIPTION }));
        ['name', 'skills', 'actions', 'autonomy', 'scope', 'spendCap'].forEach((field) => {
            expect(typeof r.body.data.why[field]).toBe('string');
            expect(r.body.data.why[field].length).toBeLessThanOrEqual(builder.WHY_MAX);
        });
    });

    it('tells the model only the skills and grantable actions that exist', async () => {
        await call(ctrl.draftAgent, req('owner1', { description: DESCRIPTION }));
        const prompt = JSON.stringify(adapter.chat.mock.calls[0][0]);
        expect(prompt).toContain('digest.ceo');
        expect(prompt).not.toContain('deploy.staging');
    });

    it('treats a reply that is not JSON as a failed draft and saves nothing', async () => {
        adapter.chat.mockImplementation(async () => ({ content: 'sure thing!', inputTokens: 10, outputTokens: 5, totalTokens: 15, model: 'gpt-4.1' }));
        const r = await call(ctrl.draftAgent, req('owner1', { description: DESCRIPTION }));
        expect(r.code).toBe(502);
        expect(rows(SCHEMA_TYPE.AGENTS)).toHaveLength(1);
    });
});

describe('spend and persistence', () => {
    it('books the call against the workspace under its own feature tag', async () => {
        await call(ctrl.draftAgent, req('admin1', { description: DESCRIPTION }));
        expect(ledger()).toHaveLength(1);
        expect(ledger()[0]).toMatchObject({ companyId: C, feature: 'agent_builder', userId: 'admin1', priced: true });
    });

    it('stores no agent and no revision: nothing is saved until the wizard is finished', async () => {
        const before = JSON.stringify(rows(SCHEMA_TYPE.AGENTS));
        const r = await call(ctrl.draftAgent, req('owner1', { description: DESCRIPTION }));
        expect(r.body.status).toBe(true);
        expect(r.body.data._id).toBeUndefined();
        expect(JSON.stringify(rows(SCHEMA_TYPE.AGENTS))).toBe(before);
        expect(rows(SCHEMA_TYPE.AGENT_REVISIONS)).toHaveLength(0);
    });
});
