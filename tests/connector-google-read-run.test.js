const mockDb = require('./fixtures/fakeMongo').create();
const mockGoogle = require('./fixtures/fakeGoogleApi');

let mockFake;

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/permissionGuard', () => ({ ROLE_OWNER: 1, ROLE_ADMIN: 2, getRoleType: jest.fn(async () => 1), isPrivileged: (r) => r === 1 || r === 2 }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn(async () => ({ status: true })) }));
jest.mock('../Modules/AICore/llmProvider', () => ({ getProvider: jest.fn(), isAnyProviderConfigured: jest.fn(() => true) }));
jest.mock('../Modules/Agents/permissions', () => ({ holderMay: jest.fn(async () => ({ allowed: true, reason: '', permission: null })), REASON: 'permission_denied' }));
jest.mock('../Modules/Agents/engine/findingMemory', () => ({ load: jest.fn(async () => new Map()), decide: jest.fn(), record: jest.fn(), touch: jest.fn() }));
jest.mock('../Modules/Agents/memory', () => ({ DECLINE_REASON_TEXT: { too_many_changes: 'x' }, contextFor: jest.fn(async () => ''), recordEpisode: jest.fn(async () => null), rememberApprovedChanges: jest.fn(async () => null), preferenceCandidate: jest.fn(async () => null) }));
jest.mock('../Modules/Connectors/resolveConnection', () => ({ resolveConnection: jest.fn() }));
jest.mock('../Modules/Agents/engine/safeFetch', () => ({
    ...jest.requireActual('../Modules/Agents/engine/safeFetch'),
    safeFetch: jest.fn((...a) => mockFake.fetch(...a)),
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { getProvider } = require('../Modules/AICore/llmProvider');
const persistence = require('../Modules/AICore/persistence');
const runs = require('../Modules/Agents/runs');
const actions = require('../Modules/Agents/actions');
const proposals = require('../Modules/Agents/proposals');
const { validateSkill } = require('../Modules/Agents/skills/validateSkill');
const { resolveConnection } = require('../Modules/Connectors/resolveConnection');
const google = require('../Modules/Connectors/providers/google');

/* A company's own skill through the real graph, with only the model and Google standing in: it reads through a Google
 * read tool, what it read reaches the model and marks the run, and the only way out is a proposal its owner approves. */

const C = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000a01';
const AGENT_ID = '6f0000000000000000000b01';
const SKILL = 'team.google_digest';
const MODEL = 'gpt-4.1';
const ENV = { CONNECTORS: 'google', AGENT_TAINT_ROUTING: 'on', AI_REPLAY: 'off' };
const TASK = { _id: '6f0000000000000000000701', TaskName: 'Digest', TaskKey: 'AR-1', ProjectID: 'p1' };
const before = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));

const READS = [
    ['google.calendar.events.list', { timeMin: '2026-11-01T00:00:00Z' }, 'Board meeting'],
    ['google.calendar.events.get', { eventId: 'ev1' }, 'sam@example.com'],
    ['google.meet.spaces.get', { space: 'sp1' }, 'abc-mnop-xyz'],
    ['google.drive.files.list', {}, 'Q4 plan'],
    ['google.drive.files.get', { fileId: 'txt1' }, 'notes.txt'],
    ['google.drive.files.read', { fileId: 'doc1' }, 'The Q4 plan text'],
];

const skillOf = (reader, params) => validateSkill({
    key: SKILL,
    name: 'Google digest',
    inputs: [],
    gather: [{ reader, as: 'found', params }],
    prompt: { partials: ['json_only'], instructions: 'Name the next event.', template: '{{gather.found.text}}', output: '{"summary":"..."}' },
    emit: [{ action: 'google.calendar.events.create', params: { summary: '{{answer.summary}}', start: '2026-11-09', end: '2026-11-10' } }],
});

const agent = () => ({ _id: AGENT_ID, name: 'Digest', autonomy: 3, allowedActions: [], projectIds: ['p1'], account: 'workspace', spendCapUsd: 0, paused: false, deletedStatusKey: 0 });
const actor = { kind: 'agent', userId: OWNER, agentId: AGENT_ID, agentName: 'Digest', runId: null, viaAccount: 'workspace', tokenId: null };
const chat = jest.fn();
const rows = (type) => mockDb.store[type] || [];

let mem;
beforeEach(() => {
    Object.assign(process.env, ENV);
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    mem = persistence.useInMemory();
    mockFake = mockGoogle.create();
    getProvider.mockReturnValue({ name: 'openai', model: MODEL, isConfigured: true, chat });
    chat.mockResolvedValue({ content: JSON.stringify({ summary: 'Budget review' }), inputTokens: 900, outputTokens: 60, model: MODEL });
    resolveConnection.mockResolvedValue({ connectionId: 'conn-owner', scopes: Object.values(google.products).flat(), getAccessToken: async () => mockGoogle.TOKEN });
    mockDb.seed(SCHEMA_TYPE.AGENTS, agent());
});
afterEach(() => { mem.reset(); persistence.useMongo(); });
afterAll(() => Object.entries(before).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; }));

describe.each(READS)('a skill that reads %s', (reader, params, shows) => {
    it('saves, feeds the model, marks the run and can only propose what follows', async () => {
        const checked = skillOf(reader, params);
        expect(checked.errors).toEqual([]);
        mockDb.seed(SCHEMA_TYPE.AGENT_SKILLS, checked.value);

        const run = await runs.create(C, { agent: agent(), taskId: TASK._id, projectId: 'p1', skill: SKILL, startedBy: OWNER });
        const out = await runs.executeSkill(C, run, agent(), TASK, { proposals, actions, actor });

        expect(JSON.stringify(chat.mock.calls[0][0])).toContain(shows);
        expect(resolveConnection).toHaveBeenCalledWith({ companyId: C, userId: OWNER, provider: 'google' });
        expect(out).toMatchObject({ status: 'waiting_approval' });
        const row = rows(SCHEMA_TYPE.AGENT_RUNS).find((r) => String(r._id) === String(run._id));
        expect(row).toMatchObject({ tainted: true, taintSources: [expect.objectContaining({ kind: 'connector', ref: expect.stringMatching(/^google:/) })] });
        expect(row.connectorReads).toEqual([expect.objectContaining({ action: reader, state: 'applied' })]);
        expect(mockFake.state.calls.every((call) => call.method === 'get')).toBe(true);
        expect(rows(SCHEMA_TYPE.AGENT_PROPOSALS)[0]).toMatchObject({ gate: 'connection_owner', connectionOwner: OWNER, status: 'pending' });
        expect(mockFake.state.events.some((event) => event.summary === 'Budget review')).toBe(false);
    });
});

describe('a skill that leaves out what a read needs', () => {
    it.each([['google.calendar.events.get', 'eventId'], ['google.meet.spaces.get', 'space'], ['google.drive.files.read', 'fileId']])('%s is refused when saved', (reader, param) => {
        expect(skillOf(reader, {}).errors).toContainEqual(expect.objectContaining({ field: `gather[0].params.${param}`, code: 'required' }));
    });
});

describe('a skill whose person never ticked the product', () => {
    it('stops the run with the product to tick, and no read reaches Google', async () => {
        resolveConnection.mockResolvedValue({ connectionId: 'conn-owner', scopes: google.products.meet, getAccessToken: async () => mockGoogle.TOKEN });
        mockDb.seed(SCHEMA_TYPE.AGENT_SKILLS, skillOf(...READS[0].slice(0, 2)).value);
        const run = await runs.create(C, { agent: agent(), taskId: TASK._id, projectId: 'p1', skill: SKILL, startedBy: OWNER });
        await runs.executeSkill(C, run, agent(), TASK, { proposals, actions, actor }).catch(() => {});
        expect(mockFake.state.calls).toHaveLength(0);
        expect(chat).not.toHaveBeenCalled();
        const row = rows(SCHEMA_TYPE.AGENT_RUNS).find((r) => String(r._id) === String(run._id));
        expect(JSON.stringify(row)).toContain('Tick calendar on your Google connection');
    });
});
