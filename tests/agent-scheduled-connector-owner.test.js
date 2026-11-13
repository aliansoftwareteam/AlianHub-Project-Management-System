const mockDb = require('./fixtures/fakeMongo').create();

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
jest.mock('../Modules/Connectors/tools', () => {
    const real = jest.requireActual('../Modules/Connectors/tools');
    return { ...real, ...real.make(require('path').join(__dirname, 'fixtures', 'connectors')) };
});
jest.mock('../Modules/Connectors/resolveConnection', () => ({ resolveConnection: jest.fn(), markBackoff: jest.fn(), recordHealth: jest.fn(async () => {}) }));
jest.mock('../Modules/Agents/engine/safeFetch', () => ({
    ...jest.requireActual('../Modules/Agents/engine/safeFetch'),
    safeFetch: jest.fn(),
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { getProvider } = require('../Modules/AICore/llmProvider');
const persistence = require('../Modules/AICore/persistence');
const runs = require('../Modules/Agents/runs');
const runAgent = require('../Modules/Automations/engine/actions/runAgent');
const { validateSkill } = require('../Modules/Agents/skills/validateSkill');
const { resolveConnection } = require('../Modules/Connectors/resolveConnection');
const { safeFetch } = require('../Modules/Agents/engine/safeFetch');

/* A run a schedule starts works for the schedule's owner: what it reads from a connected app comes through that
 * person's connection, and what it would write waits for that person, never for whoever made the agent. Here the
 * schedule is a rule on a timer firing the agent's step; the real run engine does the rest. */

const C = '6f0000000000000000000c01';
const CREATOR = '6f0000000000000000000a01';
const SCHEDULE_OWNER = '6f0000000000000000000a02';
const AGENT_ID = '6f0000000000000000000b01';
const RULE_ID = '6f0000000000000000000e01';
const SKILL = 'team.weekly_notes';
const READ = 'fake.notes.list';
const WRITE = 'fake.notes.create';
const MODEL = 'gpt-4.1';
const ENV = { CONNECTORS: 'fake', AGENT_TAINT_ROUTING: 'on', AI_REPLAY: 'off' };
const TASK = { _id: '6f0000000000000000000701', TaskName: 'Weekly notes', TaskKey: 'AR-7', ProjectID: 'p1' };
const before = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));

const skillOf = () => validateSkill({
    key: SKILL,
    name: 'Weekly notes',
    inputs: [],
    gather: [{ reader: READ, as: 'notes', params: { limit: 2 } }],
    prompt: { partials: ['json_only'], instructions: 'Summarise the week.', template: 'NOTES: {{gather.notes.text}}', output: '{"summary":"..."}' },
    emit: [{ action: WRITE, label: 'Save the summary', params: { title: 'Week', body: '{{answer.summary}}' } }],
});

const agent = { _id: AGENT_ID, name: 'Weekly', ownerId: CREATOR, autonomy: 3, allowedActions: [], connectors: [{ provider: 'fake', tools: [READ, WRITE] }], projectIds: ['p1'], account: 'workspace', spendCapUsd: 0, paused: false, deletedStatusKey: 0 };
const chat = jest.fn();
const rows = (type) => mockDb.store[type] || [];
const fireSchedule = () => runAgent.run({
    companyId: C, entity: { kind: 'task', id: TASK._id }, config: { agent: AGENT_ID, skill: SKILL },
    context: { runId: 'auto-week-46', ruleId: RULE_ID, ruleName: 'Every Monday', depth: 0, task: TASK },
});

let mem;
beforeEach(() => {
    Object.assign(process.env, ENV);
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    mem = persistence.useInMemory();
    jest.spyOn(runs, 'canStart').mockResolvedValue({ ok: true, reason: '' });
    getProvider.mockReturnValue({ name: 'openai', model: MODEL, isConfigured: true, chat });
    chat.mockResolvedValue({ content: JSON.stringify({ summary: 'A calm week.' }), inputTokens: 900, outputTokens: 60, model: MODEL });
    resolveConnection.mockImplementation(async ({ userId }) => ({ connectionId: `conn-${userId}`, scopes: ['notes.read', 'notes.write'], getAccessToken: async () => `token-${userId}` }));
    safeFetch.mockImplementation(async () => ({ status: 200, headers: {}, body: JSON.stringify({ notes: [{ title: 'Board meeting' }] }) }));
    const skill = skillOf();
    expect(skill.errors).toEqual([]);
    mockDb.seed(SCHEMA_TYPE.AGENT_SKILLS, skill.value);
    mockDb.seed(SCHEMA_TYPE.AGENTS, agent);
    mockDb.seed(SCHEMA_TYPE.AUTOMATION_RULES, { _id: RULE_ID, name: 'Every Monday', trigger: { type: 'schedule', cron: '0 9 * * 1', tz: 'UTC' }, createdBy: SCHEDULE_OWNER });
});
afterEach(() => { mem.reset(); persistence.useMongo(); jest.restoreAllMocks(); });
afterAll(() => Object.entries(before).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; }));

describe('a scheduled run of an agent that reads a connected app', () => {
    it('is started for the schedule\'s owner and reads through that person\'s connection, never the agent creator\'s', async () => {
        const out = await fireSchedule();
        expect(out).toMatchObject({ verdict: 'proposed' });
        expect(rows(SCHEMA_TYPE.AGENT_RUNS)[0]).toMatchObject({ trigger: 'rule', startedBy: SCHEDULE_OWNER });
        expect(resolveConnection.mock.calls.map(([asked]) => asked.userId)).toEqual([SCHEDULE_OWNER, SCHEDULE_OWNER]);
        expect(resolveConnection.mock.calls.some(([asked]) => asked.userId === CREATOR)).toBe(false);
        expect(safeFetch.mock.calls[0][1].headers.Authorization).toBe(`Bearer token-${SCHEDULE_OWNER}`);
    });

    it('files what it would write for the schedule\'s owner to approve, on that person\'s connection', async () => {
        await fireSchedule();
        const [proposal] = rows(SCHEMA_TYPE.AGENT_PROPOSALS);
        expect(proposal).toMatchObject({ gate: 'connection_owner', connectionOwner: SCHEDULE_OWNER });
        expect(proposal.changes[0]).toMatchObject({ action: WRITE, params: expect.objectContaining({ connectionId: `conn-${SCHEDULE_OWNER}` }) });
    });

    it('stops with the reason when the schedule\'s owner has no connection, even though the creator has one', async () => {
        resolveConnection.mockImplementation(async ({ userId }) => {
            if (userId === CREATOR) return { connectionId: 'conn-creator', scopes: ['notes.read'], getAccessToken: async () => 'creator-token' };
            throw Object.assign(new Error('not_connected'), { name: 'ConnectorError', code: 'not_connected', provider: 'fake' });
        });
        const out = await fireSchedule();
        expect(out).toMatchObject({ verdict: 'skipped', reason: 'Connect Fake on Connectors first, then ask again.' });
        expect(safeFetch).not.toHaveBeenCalled();
        expect(chat).not.toHaveBeenCalled();
    });
});
