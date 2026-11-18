const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ ROLE_OWNER: 1, ROLE_ADMIN: 2, getRoleType: jest.fn(async () => 1), isPrivileged: (r) => r === 1 || r === 2 }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn(async () => ({ status: true })) }));
jest.mock('../Modules/AICore/llmProvider', () => ({ getProvider: jest.fn(), isAnyProviderConfigured: jest.fn(() => true) }));
jest.mock('../Modules/Agents/engine/findingMemory', () => ({ load: jest.fn(async () => new Map()), decide: jest.fn(), record: jest.fn(), touch: jest.fn() }));
jest.mock('../Modules/Agents/memory', () => ({ ...jest.requireActual('../Modules/Agents/memory'), contextFor: jest.fn(async () => ''), recordEpisode: jest.fn(async () => null) }));
jest.mock('../Modules/Agents/engine/agentFetch', () => ({ audit: jest.fn(), readDeclared: jest.fn(), postJson: jest.fn() }));
jest.mock('../Modules/Agents/actor', () => ({ resolveActor: jest.fn(async (req) => ({ kind: 'human', userId: req.uid })), isAgent: (a) => a.kind === 'agent' }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { getProvider } = require('../Modules/AICore/llmProvider');
const { audit } = require('../Modules/Agents/engine/agentFetch');
const { auditHtml, BLIND_SPOTS } = require('../Modules/Agents/engine/pageAudit');
const findingMemory = require('../Modules/Agents/engine/findingMemory');
const { verify, getSkill } = require('../Modules/Agents/engine/orchestrator');
const confidence = require('../Modules/Agents/engine/confidence');
const persistence = require('../Modules/AICore/persistence');
const runs = require('../Modules/Agents/runs');
const ctrl = require('../Modules/Agents/controller');

const C = '6f0000000000000000000c01';
const AGENT_ID = '6f0000000000000000000a01';
const PROJECT = '6f0000000000000000000901';
const skill = getSkill('qa-review');

const HTML_BAD = `<!doctype html><html><head><title>A perfectly reasonable title</title>
  <meta name="description" content="${'x'.repeat(300)}"></head><body>
  <h1>One</h1><h1>Two</h1><img src="/a.png"><a href="#">dead</a></body></html>`;
const pageAudit = { url: 'https://example.com', facts: auditHtml(HTML_BAD, 'https://example.com') };

const finding = (factId, over = {}) => ({ factId, title: `Fix ${factId}`, severity: 'medium', why: 'w', fix: 'f', ...over });

describe('the floor a run applies', () => {
    it('defaults to 0.6 and is bounded to 0.3–0.9', () => {
        expect(confidence).toMatchObject({ DEFAULT_FLOOR: 0.6, MIN_FLOOR: 0.3, MAX_FLOOR: 0.9 });
        expect(confidence.floorFor(null, null)).toBe(0.6);
        expect(confidence.floorFor({}, {})).toBe(0.6);
    });

    it('the QA Review skill declares the default, and the agent\'s own floor wins over the skill\'s', () => {
        expect(skill.confidenceFloor).toBe(0.6);
        expect(confidence.floorFor({ confidenceFloor: 0.5 }, {})).toBe(0.5);
        expect(confidence.floorFor({ confidenceFloor: 0.5 }, { confidenceFloor: 0.8 })).toBe(0.8);
        expect(confidence.floorFor({ confidenceFloor: 0.5 }, { confidenceFloor: null })).toBe(0.5);
    });

    it.each([[0, 0.3], [0.1, 0.3], [1, 0.9], [5, 0.9], ['0.7', 0.7]])('a stored floor of %p runs as %p', (stored, applied) => {
        expect(confidence.floorFor({}, { confidenceFloor: stored })).toBe(applied);
    });

    it.each([['abc'], [true], [''], [NaN]])('an unreadable floor %p falls back to the skill', (stored) => {
        expect(confidence.floorFor({ confidenceFloor: 0.5 }, { confidenceFloor: stored })).toBe(0.5);
    });
});

describe('verify() drops findings below the confidence floor', () => {
    it('drops a finding under the floor with the reason, and keeps one at or above it with its confidence', () => {
        const { findings, dropped } = verify([
            finding('og_image', { confidence: 0.95 }),
            finding('meta_description', { confidence: 0.6 }),
            finding('h1', { confidence: 0.4, title: 'Two h1s might confuse crawlers' }),
        ], pageAudit, skill);
        expect(findings.map((f) => [f.factId, f.confidence])).toEqual([['og_image', 0.95], ['meta_description', 0.6]]);
        expect(dropped).toEqual([{ title: 'Two h1s might confuse crawlers', reason: 'confidence 0.4 is below the 0.6 floor' }]);
    });

    it('applies the floor it is given', () => {
        const { findings, dropped } = verify([finding('og_image', { confidence: 0.7 })], pageAudit, skill, { floor: 0.8 });
        expect(findings).toEqual([]);
        expect(dropped[0].reason).toBe('confidence 0.7 is below the 0.8 floor');
    });

    it('keeps a finding with no reported confidence, marked as not reported, so older answers still verify', () => {
        const { findings, dropped } = verify([finding('og_image'), finding('h1', { confidence: 'high' })], pageAudit, skill);
        expect(findings.map((f) => [f.factId, f.confidence])).toEqual([['og_image', null], ['h1', null]]);
        expect(dropped).toEqual([]);
    });

    it('reads a numeric string and clamps a value outside 0–1', () => {
        const { findings, dropped } = verify([
            finding('og_image', { confidence: '0.8' }),
            finding('h1', { confidence: 7 }),
            finding('img_alt', { confidence: -2 }),
        ], pageAudit, skill);
        expect(findings.map((f) => [f.factId, f.confidence])).toEqual([['og_image', 0.8], ['h1', 1]]);
        expect(dropped).toEqual([{ title: 'Fix img_alt', reason: 'confidence 0 is below the 0.6 floor' }]);
    });

    it('the evidence gate still runs first: a confident finding with no failing fact is dropped for that', () => {
        const { dropped } = verify([finding('ssl_expired', { confidence: 0.99 })], pageAudit, skill);
        expect(dropped).toEqual([{ title: 'Fix ssl_expired', reason: 'no failing fact "ssl_expired"' }]);
    });

    it('an unsure finding does not take a fact from a confident one that follows it', () => {
        const { findings, dropped } = verify([
            finding('og_image', { confidence: 0.2, title: 'unsure' }),
            finding('og_image', { confidence: 0.9, title: 'sure' }),
        ], pageAudit, skill);
        expect(findings.map((f) => f.title)).toEqual(['sure']);
        expect(dropped.map((d) => d.reason)).toEqual(['confidence 0.2 is below the 0.6 floor']);
    });

    it('severity sorting and the volume cap are unchanged by the floor', () => {
        const { findings, dropped } = verify([
            finding('h1', { severity: 'low', confidence: 0.9 }),
            finding('og_image', { severity: 'high', confidence: 0.9 }),
            finding('meta_description', { severity: 'medium', confidence: 0.9 }),
            finding('empty_links', { severity: 'bogus', confidence: 0.9 }),
        ], pageAudit, { ...skill, maxFindings: 3 });
        expect(findings.map((f) => [f.factId, f.severity])).toEqual([['og_image', 'high'], ['meta_description', 'medium'], ['empty_links', 'medium']]);
        expect(dropped).toEqual([{ title: '1 more', reason: 'over the 3-finding cap' }]);
    });
});

describe('the QA Review output contract asks for a confidence', () => {
    it('names confidence in the JSON shape and says what it means', () => {
        expect(skill.systemPrompt).toMatch(/"confidence":0\.0-1\.0/);
        expect(skill.systemPrompt).toMatch(/confidence/i);
    });
});

describe('on the run path', () => {
    const MODEL = 'gpt-4.1';
    const TASK = { _id: '6f0000000000000000000701', TaskKey: 'AR-3', TaskName: 'Review https://example.com', ProjectID: PROJECT };
    const agent = (over = {}) => ({ _id: AGENT_ID, name: 'Reviewer', autonomy: 1, allowedActions: [], projectIds: [PROJECT], account: 'workspace', spendCapUsd: 0, paused: false, deletedStatusKey: 0, ...over });
    const actor = { kind: 'agent', userId: 'u1', agentId: AGENT_ID, agentName: 'Reviewer', runId: null, viaAccount: 'workspace', tokenId: null };
    const chat = jest.fn();
    const proposalsCreate = jest.fn(async (companyId, doc) => ({ _id: 'prop1', ...doc }));
    let mem;

    beforeEach(() => {
        Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
        jest.clearAllMocks();
        mem = persistence.useInMemory();
        getProvider.mockReturnValue({ name: 'openai', model: MODEL, isConfigured: true, chat });
        audit.mockImplementation(async (url) => ({ ok: true, url, status: 200, facts: auditHtml(HTML_BAD, url), blindSpots: BLIND_SPOTS }));
        findingMemory.decide.mockImplementation(async (companyId, taskId, findings) => findings.map((f) => ({ finding: f, action: 'file', reason: 'new' })));
        mockDb.seed(dbCollections.COMPANIES, { _id: C });
        chat.mockResolvedValue({ model: MODEL, inputTokens: 900, outputTokens: 300, content: JSON.stringify({
            summary: 'Two issues.',
            findings: [
                finding('og_image', { title: 'Add og:image', severity: 'high', confidence: 0.92 }),
                finding('h1', { title: 'Keep one h1', severity: 'low', confidence: 0.7 }),
            ],
        }) });
    });
    afterEach(() => { mem.reset(); persistence.useMongo(); });

    const execute = async (a) => {
        mockDb.seed(SCHEMA_TYPE.AGENTS, a);
        const run = await runs.create(C, { agent: a, taskId: TASK._id, projectId: PROJECT, skill: 'qa-review', startedBy: 'u1' });
        return runs.executeSkill(C, run, a, TASK, { proposals: { create: proposalsCreate }, actions: { perform: jest.fn() }, actor });
    };

    it('the skill\'s floor keeps both findings', async () => {
        await execute(agent());
        const proposal = proposalsCreate.mock.calls[0][1];
        expect(proposal.changes.filter((c) => c.action === 'subtask.create').map((c) => c.params.title)).toEqual(['[high] Add og:image', '[low] Keep one h1']);
    });

    it('an agent with a higher floor drops the unsure finding, and the reviewer sees why', async () => {
        await execute(agent({ confidenceFloor: 0.8 }));
        const proposal = proposalsCreate.mock.calls[0][1];
        expect(proposal.changes.filter((c) => c.action === 'subtask.create').map((c) => c.params.title)).toEqual(['[high] Add og:image']);
        expect(proposal.why).toContain('(confidence 0.7 is below the 0.8 floor)');
    });
});

describe('the agent API validates the floor at the boundary', () => {
    const REASON = 'confidenceFloor must be a number between 0.3 and 0.9';
    const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; return r; };
    const req = (body) => ({ headers: { companyid: C }, params: { id: AGENT_ID }, query: {}, body, uid: 'owner1' });
    const row = () => mockDb.store[SCHEMA_TYPE.AGENTS].find((a) => String(a._id) === AGENT_ID);

    beforeEach(() => {
        Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
        mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: AGENT_ID, name: 'Reviewer', ownerId: 'owner1', autonomy: 1, paused: false, deletedStatusKey: 0 });
    });

    it.each([[0.75, 0.75], ['0.5', 0.5], [0.3, 0.3], [0.9, 0.9]])('stores %p as %p', async (value, stored) => {
        const r = res();
        await ctrl.updateAgent(req({ confidenceFloor: value }), r);
        expect(r.body.status).toBe(true);
        expect(row().confidenceFloor).toBe(stored);
    });

    it('null clears it, so the skill\'s floor applies again', async () => {
        await ctrl.updateAgent(req({ confidenceFloor: 0.8 }), res());
        const r = res();
        await ctrl.updateAgent(req({ confidenceFloor: null }), r);
        expect(r.body.status).toBe(true);
        expect(row().confidenceFloor).toBeNull();
    });

    it.each([[0.2], [0.95], [1], ['abc'], [''], [true]])('refuses %p with a 400 and keeps the row', async (value) => {
        const r = res();
        await ctrl.updateAgent(req({ name: 'Renamed', confidenceFloor: value }), r);
        expect(r.code).toBe(400);
        expect(r.body.statusText).toBe(REASON);
        expect(row()).toMatchObject({ name: 'Reviewer' });
        expect(row().confidenceFloor).toBeUndefined();
    });

    it('refuses an out-of-range floor on create', async () => {
        const r = res();
        await ctrl.createAgent(req({ name: 'New', confidenceFloor: 0.1 }), r);
        expect(r.code).toBe(400);
        expect(mockDb.store[SCHEMA_TYPE.AGENTS]).toHaveLength(1);
    });

    it('is part of the agent\'s pinned revision fields', () => {
        expect(require('../Modules/Agents/revisions').RUN_FIELDS).toContain('confidenceFloor');
    });

    it('is declared on the strict agents schema', () => {
        expect(require('../utils/mongo-handler/schema').schema.agents.confidenceFloor).toMatchObject({ type: Number, required: false });
    });
});
