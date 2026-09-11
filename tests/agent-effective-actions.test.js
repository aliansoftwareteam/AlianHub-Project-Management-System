const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ ROLE_OWNER: 1, ROLE_ADMIN: 2, getRoleType: jest.fn(async () => 1), isPrivileged: (r) => r === 1 || r === 2 }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Agents/actor', () => ({ resolveActor: jest.fn(async (req) => ({ kind: req.agent ? 'agent' : 'human', userId: req.uid || null })), isAgent: (a) => a && a.kind === 'agent' }));
jest.mock('../Modules/AICore/llmProvider', () => ({ getProvider: jest.fn(), isAnyProviderConfigured: jest.fn(() => true) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { getRoleType } = require('../Config/permissionGuard');
const { getProvider } = require('../Modules/AICore/llmProvider');
const { validateSkill } = require('../Modules/Agents/skills/validateSkill');
const { effectiveActions, narrowChanges } = require('../Modules/Agents/skills/effectiveActions');
const codeSkills = require('../Modules/Agents/skills');
const registry = require('../Modules/Agents/registry');
const orchestrator = require('../Modules/Agents/engine/orchestrator');
const ctrl = require('../Modules/Agents/controller');
const skillsCtrl = require('../Modules/Agents/skillsController');

const C = '6f0000000000000000000c01';
const AGENT_ID = '6f0000000000000000000a01';
const TASK = { _id: '6f0000000000000000000701', TaskName: 'Magic-link login', TaskKey: 'AR-7', ProjectID: '6f0000000000000000000901', description: '<p>Goal: ship the magic-link login. Acceptance: verify endpoint, email template, rate limit, tests for expiry.</p>' };

const dataSkill = (over = {}) => validateSkill({
    key: 'task.summary',
    name: 'Summariser',
    inputs: ['brief'],
    gather: [{ reader: 'task' }],
    prompt: { template: '{{input.brief}}', output: '{"summary":"..."}' },
    emit: [{ action: 'task.comment', params: { body: '{{answer.summary}}' } }],
    ...over,
}).value;

const req = (body, over = {}) => ({ headers: { companyid: C }, params: {}, query: {}, body, uid: 'owner1', ...over });
const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; return r; };
const call = async (fn, request) => { const r = res(); await fn(request, r); return r; };
const agents = () => mockDb.store[SCHEMA_TYPE.AGENTS] || [];

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    getRoleType.mockResolvedValue(1);
});

describe('effectiveActions(agent, skill)', () => {
    const skill = (emits) => ({ emits });

    it('cuts what the skill emits to the agent\'s allowed actions', () => {
        expect(effectiveActions({ allowedActions: ['task.get', 'task.comment'] }, skill(['subtask.create', 'task.comment']))).toEqual(['task.comment']);
    });

    it('treats an agent with no allowed actions as un-narrowed, never as widened past the skill', () => {
        expect(effectiveActions({ allowedActions: [] }, skill(['subtask.create', 'task.comment']))).toEqual(['subtask.create', 'task.comment']);
        expect(effectiveActions(null, skill(['task.comment']))).toEqual(['task.comment']);
        expect(effectiveActions({ allowedActions: ['task.link', 'task.comment'] }, skill(['task.comment']))).toEqual(['task.comment']);
    });

    it('never yields a never-listed key, even when the agent and the skill both name it', () => {
        expect(registry.isNever('task.delete')).toBe(true);
        expect(effectiveActions({ allowedActions: ['task.delete', 'task.comment'] }, skill(['task.delete', 'task.comment']))).toEqual(['task.comment']);
        expect(effectiveActions({ allowedActions: ['billing.refund'] }, skill(['billing.refund']))).toEqual([]);
    });

    it('drops a key missing from the registry and a registry read', () => {
        expect(effectiveActions({ allowedActions: [] }, skill(['task.teleport', 'task.get', 'task.comment']))).toEqual(['task.comment']);
    });

    it('dedupes and tolerates a skill without emits', () => {
        expect(effectiveActions({}, skill(['task.comment', 'task.comment']))).toEqual(['task.comment']);
        expect(effectiveActions({ allowedActions: ['task.comment'] }, {})).toEqual([]);
    });

    it('code skills and compiled data skills go through the same function', async () => {
        const narrow = { allowedActions: ['task.comment'] };
        expect(effectiveActions(narrow, codeSkills.getSkill('brief.parse'))).toEqual(['task.comment']);
        mockDb.seed(SCHEMA_TYPE.AGENT_SKILLS, dataSkill());
        const compiled = await require('../Modules/Agents/skillRecord').getSkill(C, 'task.summary');
        expect(effectiveActions(narrow, compiled)).toEqual(['task.comment']);
    });

    it('narrowChanges keeps the effective changes and reports the rest with a reason', () => {
        const changes = [
            { action: 'subtask.create', label: 'Create one', params: {} },
            { action: 'task.comment', label: 'Post', params: {} },
            { action: 'task.link', label: 'Link', params: {} },
        ];
        const out = narrowChanges({ allowedActions: ['task.comment', 'task.link'] }, codeSkills.getSkill('brief.parse'), changes);
        expect(out.changes.map((c) => c.action)).toEqual(['task.comment']);
        expect(out.dropped).toEqual([
            { text: 'Create one', reason: 'subtask.create is outside this agent\'s allowed actions' },
            { text: 'Link', reason: 'task.link is not an action this skill declares' },
        ]);
    });
});

describe('the engine narrows every generic skill through effectiveActions', () => {
    it('a code skill\'s changes outside the agent\'s allowed actions are dropped before review', async () => {
        const answer = { subtasks: [{ title: 'Add verify endpoint', hours: 3 }], questions: [], summary: 'One piece.' };
        getProvider.mockReturnValue({ name: 'openai', model: 'gpt-4.1', isConfigured: true, chat: jest.fn(async () => ({ content: JSON.stringify(answer), inputTokens: 10, outputTokens: 10, model: 'gpt-4.1' })) });
        const result = await orchestrator.run({ skillSlug: 'brief.parse', task: TASK, companyId: C, budget: { maxTokens: 4000 }, agent: { allowedActions: ['task.get', 'task.comment'] } });
        expect(result.status).toBe('success');
        expect(result.changes.map((c) => c.action)).toEqual(['task.comment']);
        expect(result.dropped).toEqual([expect.objectContaining({ reason: 'subtask.create is outside this agent\'s allowed actions' })]);
    });
});

describe('saving an agent validates its skills', () => {
    it('refuses an unknown skill key on create with unknown_skill, and stores nothing', async () => {
        const r = await call(ctrl.createAgent, req({ name: 'Intake', skills: [{ key: 'brief.parse' }, { key: 'brief.prase' }] }));
        expect(r.code).toBe(400);
        expect(r.body).toMatchObject({ status: false, data: { errors: [{ field: 'skills[1].key', code: 'unknown_skill' }] } });
        expect(r.body.data.errors[0].message).toMatch(/brief\.prase/);
        expect(agents()).toHaveLength(0);
    });

    it('refuses an unknown skill key on update and leaves the stored skills alone', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: AGENT_ID, name: 'Intake', skills: [{ key: 'brief.parse', name: 'brief.parse', enabled: true }], deletedStatusKey: 0 });
        const r = await call(ctrl.updateAgent, req({ skills: ['no.such.skill'] }, { params: { id: AGENT_ID } }));
        expect(r.code).toBe(400);
        expect(r.body.data.errors).toEqual([expect.objectContaining({ field: 'skills[0].key', code: 'unknown_skill' })]);
        expect(agents()[0].skills.map((s) => s.key)).toEqual(['brief.parse']);
    });

    it('refuses a disabled data skill and a retired one with skill_disabled', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENT_SKILLS, dataSkill({ enabled: false }));
        mockDb.seed(SCHEMA_TYPE.AGENT_SKILLS, { ...dataSkill({ key: 'old.one', name: 'Old' }), retiredAt: new Date() });
        const r = await call(ctrl.createAgent, req({ name: 'Summariser', skills: ['task.summary', 'old.one'] }));
        expect(r.code).toBe(400);
        expect(r.body.data.errors.map((e) => `${e.field}:${e.code}`)).toEqual(['skills[0].key:skill_disabled', 'skills[1].key:skill_disabled']);
        expect(agents()).toHaveLength(0);
    });

    it('accepts code skills, their aliases and live data skills', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENT_SKILLS, dataSkill());
        const r = await call(ctrl.createAgent, req({ name: 'Mixed', skills: ['brief.parse', 'project.plan', { key: 'task.summary', enabled: false }] }));
        expect(r.body.status).toBe(true);
        expect(agents()[0].skills.map((s) => s.key)).toEqual(['brief.parse', 'project.plan', 'task.summary']);
    });

    it('a data skill disabled under a code skill\'s key still resolves to the code skill', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENT_SKILLS, dataSkill({ key: 'brief.parse', enabled: false }));
        const r = await call(ctrl.createAgent, req({ name: 'Intake', skills: ['brief.parse'] }));
        expect(r.body.status).toBe(true);
    });

    it('an update that does not touch skills does not resolve them', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: AGENT_ID, name: 'Legacy', skills: [{ key: 'gone.skill' }], deletedStatusKey: 0 });
        const r = await call(ctrl.updateAgent, req({ name: 'Renamed' }, { params: { id: AGENT_ID } }));
        expect(r.body.status).toBe(true);
        expect(mockDb.calls.some((c) => c.type === SCHEMA_TYPE.AGENT_SKILLS)).toBe(false);
    });
});

describe('GET /api/v2/agents/manifest', () => {
    it('lists every non-deleted agent with its skills, their source and effective actions', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENT_SKILLS, dataSkill());
        mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: AGENT_ID, name: 'Intake', paused: false, allowedActions: ['task.get', 'task.comment'], skills: [{ key: 'brief.parse', name: 'Intake', enabled: true }, 'task.summary', { key: 'gone.skill', enabled: false }], deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.AGENTS, { name: 'Open', allowedActions: [], skills: ['project.plan'], deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.AGENTS, { name: 'Deleted', skills: ['brief.parse'], deletedStatusKey: 1 });
        getRoleType.mockResolvedValue(3);

        const r = await call(skillsCtrl.agentManifest, req({}));
        expect(r.body.status).toBe(true);
        expect(r.body.data.map((a) => a.name)).toEqual(['Intake', 'Open']);
        expect(r.body.data[0]).toEqual({
            id: AGENT_ID,
            name: 'Intake',
            paused: false,
            allowedActions: ['task.get', 'task.comment'],
            skills: [
                { key: 'brief.parse', name: 'Intake', enabled: true, resolved: true, source: 'code', version: null, emits: ['subtask.create', 'task.comment'], effectiveActions: ['task.comment'] },
                { key: 'task.summary', name: 'Summariser', enabled: true, resolved: true, source: 'data', version: 1, emits: ['task.comment'], effectiveActions: ['task.comment'] },
                { key: 'gone.skill', name: 'gone.skill', enabled: false, resolved: false, source: null, version: null, emits: [], effectiveActions: [] },
            ],
        });
        expect(r.body.data[1].skills[0]).toMatchObject({ key: 'project.plan', source: 'code', effectiveActions: ['subtask.create', 'task.comment'] });
        expect(JSON.parse(JSON.stringify(r.body.data))).toEqual(r.body.data);
        expect(mockDb.calls.every((c) => c.companyId === C)).toBe(true);
    });

    it('refuses without a company', async () => {
        const r = await call(skillsCtrl.agentManifest, req({}, { headers: {} }));
        expect(r.body.status).toBe(false);
    });

    it('is registered before the /agents/:id routes', () => {
        const order = [];
        const app = new Proxy({}, { get: (_, method) => (path) => { order.push(`${method} ${path}`); } });
        require('../Modules/Agents/routes').init(app);
        const manifest = order.indexOf('get /api/v2/agents/manifest');
        expect(manifest).toBeGreaterThan(-1);
        order.forEach((line, i) => { if (/\/agents\/:id/.test(line)) expect(i).toBeGreaterThan(manifest); });
    });
});
