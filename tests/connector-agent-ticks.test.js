const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/permissionGuard', () => ({ ROLE_OWNER: 1, ROLE_ADMIN: 2, getRoleType: jest.fn(async () => 1), isPrivileged: (r) => r === 1 || r === 2 }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn(), recordAuditFromReq: jest.fn() }));
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
const { recordAudit } = require('../Modules/Audit/recorder');
const persistence = require('../Modules/AICore/persistence');
const runs = require('../Modules/Agents/runs');
const actions = require('../Modules/Agents/actions');
const proposals = require('../Modules/Agents/proposals');
const { validateSkill } = require('../Modules/Agents/skills/validateSkill');
const { resolveConnection } = require('../Modules/Connectors/resolveConnection');
const { safeFetch } = require('../Modules/Agents/engine/safeFetch');
const agentConnectors = require('../Modules/Agents/agentConnectors');

/* Task 098: a skill may declare a read of a connected app, but an agent runs it only with that app and tool ticked
 * on its own settings. A real run through the graph, with only the model and the fake provider standing in. */

const C = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000a01';
const AGENT_ID = '6f0000000000000000000b01';
const SKILL = 'team.notes_digest';
const READ = 'fake.notes.list';
const WRITE = 'fake.notes.create';
const MODEL = 'gpt-4.1';
const ENV = { CONNECTORS: 'fake', AGENT_TAINT_ROUTING: 'on', AI_REPLAY: 'off' };
const TASK = { _id: '6f0000000000000000000701', TaskName: 'Digest the notes', TaskKey: 'AR-1', ProjectID: 'p1' };
const before = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));

const NOT_ALLOWED = 'This agent is not allowed to use Fake. Tick it in the agent\'s settings.';
const NOT_THIS_TOOL = 'This agent may use Fake, but not this tool. Tick it in the agent\'s settings.';

const skillOf = ({ optional = false, emit = [{ action: 'task.comment', params: { body: '{{answer.summary}}' } }] } = {}) => validateSkill({
    key: SKILL,
    name: 'Notes digest',
    inputs: [],
    gather: [{ reader: READ, as: 'notes', params: { limit: 2 }, ...(optional ? { optional: true } : {}) }],
    prompt: {
        partials: ['json_only'],
        instructions: 'Summarise the notes.',
        template: '{{#gather.notes.failed}}NOT READ: {{gather.notes.reason}}{{/gather.notes.failed}}NOTES: {{gather.notes.text}}',
        output: '{"summary":"..."}',
    },
    emit,
});

const agent = (connectors) => ({ _id: AGENT_ID, name: 'Digest', autonomy: 0, allowedActions: [], ...(connectors ? { connectors } : {}), projectIds: ['p1'], account: 'workspace', spendCapUsd: 0, paused: false, deletedStatusKey: 0 });
const actor = { kind: 'agent', userId: OWNER, agentId: AGENT_ID, agentName: 'Digest', runId: null, viaAccount: 'workspace', tokenId: null };
const chat = jest.fn();
const rows = (type) => mockDb.store[type] || [];
const runRow = (run) => rows(SCHEMA_TYPE.AGENT_RUNS).find((r) => String(r._id) === String(run._id));
const callRows = () => recordAudit.mock.calls.map(([, row]) => row).filter((row) => row.action === 'connector.call');

const runWith = async (a, skill = skillOf()) => {
    expect(skill.errors).toEqual([]);
    mockDb.seed(SCHEMA_TYPE.AGENT_SKILLS, skill.value);
    mockDb.seed(SCHEMA_TYPE.AGENTS, a);
    const run = await runs.create(C, { agent: a, taskId: TASK._id, projectId: 'p1', skill: SKILL, startedBy: OWNER });
    const out = await runs.executeSkill(C, run, a, TASK, { proposals, actions, actor });
    return { run, out };
};

let mem;
beforeEach(() => {
    Object.assign(process.env, ENV);
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    mem = persistence.useInMemory();
    getProvider.mockReturnValue({ name: 'openai', model: MODEL, isConfigured: true, chat });
    chat.mockResolvedValue({ content: JSON.stringify({ summary: 'Two notes.' }), inputTokens: 900, outputTokens: 60, model: MODEL });
    resolveConnection.mockResolvedValue({ connectionId: 'conn-owner', scopes: ['notes.read', 'notes.write'], getAccessToken: async () => 'secret-token' });
    safeFetch.mockImplementation(async () => ({ status: 200, headers: {}, body: JSON.stringify({ notes: [{ title: 'Board meeting' }, { title: 'Call the bank' }] }) }));
});
afterEach(() => { mem.reset(); persistence.useMongo(); });
afterAll(() => Object.entries(before).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; }));

describe('an agent that has not ticked the app its skill reads', () => {
    it.each([['no ticks at all', undefined], ['an empty list', []], ['another app only', [{ provider: 'slack', tools: ['slack.channel.read'] }]]])('with %s, is refused before anything is asked of the app', async (_, connectors) => {
        const { run, out } = await runWith(agent(connectors));
        expect(out.status).toBe('skipped');
        expect(runRow(run).outcome).toBe(NOT_ALLOWED);
        expect(resolveConnection).not.toHaveBeenCalled();
        expect(safeFetch).not.toHaveBeenCalled();
        expect(chat).not.toHaveBeenCalled();
        expect(callRows()).toEqual([expect.objectContaining({ entityId: 'fake', meta: expect.objectContaining({ action: READ, via: 'agent', agentId: AGENT_ID, state: 'refused', reason: 'agent_not_allowed' }) })]);
    });

    it('with the app ticked but not that tool, is refused and says so', async () => {
        const { run, out } = await runWith(agent([{ provider: 'fake', tools: [WRITE] }]));
        expect(out.status).toBe('skipped');
        expect(runRow(run).outcome).toBe(NOT_THIS_TOOL);
        expect(safeFetch).not.toHaveBeenCalled();
    });
});

describe('an agent with the tool ticked', () => {
    it('reads through the connection of the person the run works for, and the model sees what was read', async () => {
        const { run, out } = await runWith(agent([{ provider: 'fake', tools: [READ] }]));
        expect(out.status).toBe('waiting_approval');
        expect(resolveConnection).toHaveBeenCalledWith({ companyId: C, userId: OWNER, provider: 'fake' });
        expect(JSON.stringify(chat.mock.calls[0][0])).toContain('Board meeting');
        expect(runRow(run).connectorReads).toEqual([expect.objectContaining({ action: READ, state: 'applied' })]);
    });
});

describe('an optional read the agent may not use', () => {
    it('fails its step with the reason, and the run goes on with the reason in front of the model', async () => {
        const { out } = await runWith(agent([]), skillOf({ optional: true }));
        expect(out.status).toBe('waiting_approval');
        expect(safeFetch).not.toHaveBeenCalled();
        const asked = JSON.stringify(chat.mock.calls[0][0]);
        expect(asked).toContain('NOT READ: This agent is not allowed to use Fake.');
        expect(asked).not.toContain('Board meeting');
    });

    it('fails its step the same way when the person has no connection, so a missing connection says to connect it', async () => {
        resolveConnection.mockRejectedValue(Object.assign(new Error('not_connected'), { name: 'ConnectorError', code: 'not_connected', provider: 'fake' }));
        const { out } = await runWith(agent([{ provider: 'fake', tools: [READ] }]), skillOf({ optional: true }));
        expect(out.status).toBe('waiting_approval');
        expect(JSON.stringify(chat.mock.calls[0][0])).toContain('Connect Fake on My connections first');
    });

    it('is refused when saved on a reader that is not a connected app', () => {
        const checked = validateSkill({ ...skillOf().value, gather: [{ reader: 'task', as: 'task', optional: true }], prompt: { ...skillOf().value.prompt, template: '{{gather.task.title}}' } });
        expect(checked.errors).toContainEqual(expect.objectContaining({ field: 'gather[0].optional', code: 'invalid' }));
    });
});

describe('a write to an app the agent has not ticked', () => {
    const both = [{ action: 'task.comment', params: { body: '{{answer.summary}}' } }, { action: WRITE, label: 'Save the notes', params: { title: 'Digest', body: '{{answer.summary}}' } }];

    it('is left out of what the run proposes, with the reason on the proposal', async () => {
        const { out } = await runWith(agent([{ provider: 'fake', tools: [READ] }]), skillOf({ emit: both }));
        expect(out.status).toBe('waiting_approval');
        const [proposal] = rows(SCHEMA_TYPE.AGENT_PROPOSALS);
        expect(proposal.changes.map((c) => c.action)).toEqual(['task.comment']);
        expect(proposal.why).toContain(NOT_THIS_TOOL);
        expect(proposal.connectionOwner).toBeUndefined();
    });

    it('is proposed for its owner once ticked', async () => {
        await runWith(agent([{ provider: 'fake', tools: [READ, WRITE] }]), skillOf({ emit: both }));
        const [proposal] = rows(SCHEMA_TYPE.AGENT_PROPOSALS);
        expect(proposal.changes.map((c) => c.action)).toEqual(['task.comment', WRITE]);
        expect(proposal).toMatchObject({ gate: 'connection_owner', connectionOwner: OWNER });
    });

    it('is refused at filing when a caller skips the narrowing, and the refusal is audited', async () => {
        const filing = proposals.create(C, {
            agent: { _id: AGENT_ID, name: 'Digest', connectors: [{ provider: 'fake', tools: [READ] }] }, projectId: 'p1', what: 'Save it', why: 'Asked',
            changes: [{ action: WRITE, params: { title: 'Digest', body: 'Two notes.' } }], connectionOwner: OWNER,
        });
        await expect(filing).rejects.toMatchObject({ code: 'agent_not_allowed', message: NOT_THIS_TOOL });
        expect(rows(SCHEMA_TYPE.AGENT_PROPOSALS)).toHaveLength(0);
        expect(resolveConnection).not.toHaveBeenCalled();
        expect(callRows()).toEqual([expect.objectContaining({ meta: expect.objectContaining({ action: WRITE, phase: 'propose', state: 'refused', reason: 'agent_not_allowed' }) })]);
    });
});

describe('the rule itself', () => {
    it('reads nothing ticked from a missing or malformed list', () => {
        expect(agentConnectors.refusalFor(undefined, READ)).toBe(NOT_ALLOWED);
        expect(agentConnectors.refusalFor([{ provider: 'fake', tools: 'fake.notes.list' }], READ)).toBe(NOT_THIS_TOOL);
        expect(agentConnectors.refusalFor([{ provider: 'other', tools: [READ] }], READ)).toBe(NOT_ALLOWED);
        expect(agentConnectors.refusalFor([{ provider: 'fake', tools: [READ] }], READ)).toBe('');
        expect(agentConnectors.refusalFor([], 'task.comment')).toBe('');
    });
});
