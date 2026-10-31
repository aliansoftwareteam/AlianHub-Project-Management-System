const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/Agents/engine/orchestrator', () => ({ gather: jest.fn(async () => ({ status: 'gathered', context: {} })), analyse: jest.fn() }));
jest.mock('../Modules/Agents/engine/findingMemory', () => ({ load: jest.fn(async () => new Map()), decide: jest.fn(), record: jest.fn(), touch: jest.fn() }));
jest.mock('../Modules/Agents/memory', () => ({
    DECLINE_REASON_TEXT: { too_many_changes: 'x', wrong_tone: 'x', needs_person: 'x', not_now: 'x' },
    contextFor: jest.fn(async () => ''),
    recordEpisode: jest.fn(async () => null),
    preferenceCandidate: jest.fn(async () => null),
    rememberApprovedChanges: jest.fn(async () => null),
}));
jest.mock('../Modules/Agents/actions', () => {
    const actual = jest.requireActual('../Modules/Agents/actions');
    return { ...actual, perform: jest.fn(actual.perform) };
});
jest.mock('../Modules/Agents/permissions', () => ({ holderMay: jest.fn(async () => ({ allowed: true, reason: '', permission: null })), REASON: 'permission_denied' }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Agents/engine/safeFetch', () => ({
    ...jest.requireActual('../Modules/Agents/engine/safeFetch'),
    safeFetch: jest.fn(),
}));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(async () => ['p1']) }));
jest.mock('../Modules/AICore/usage', () => ({ checkConfiguredModelPriced: () => ({ ok: true, reason: '' }), unpricedMessage: (m) => m, UNPRICED_MODEL: 'unpriced_model', summarize: jest.fn(() => ({ costUsd: 0.01, totalTokens: 100, model: 'm' })) }));
jest.mock('../Modules/Connectors/tools', () => {
    const real = jest.requireActual('../Modules/Connectors/tools');
    return { ...real, ...real.make(require('path').join(__dirname, 'fixtures', 'connectors')) };
});
jest.mock('../Modules/Connectors/resolveConnection', () => ({ resolveConnection: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const persistence = require('../Modules/AICore/persistence');
const orchestrator = require('../Modules/Agents/engine/orchestrator');
const actions = require('../Modules/Agents/actions');
const runs = require('../Modules/Agents/runs');
const proposals = require('../Modules/Agents/proposals');
const { resolveConnection } = require('../Modules/Connectors/resolveConnection');
const { safeFetch } = require('../Modules/Agents/engine/safeFetch');

/* A real run through the graph, with only the model's answer and the provider standing in: the write the skill emits
 * waits for the person the run works for, at any autonomy, and goes out once that person approves it. */

const C = '6f0000000000000000000c01';
const AGENT_ID = '6f0000000000000000000a01';
const TASK = { _id: '6f0000000000000000000701', TaskName: 'Write the minutes', TaskKey: 'AR-1', ProjectID: 'p1' };
const KEY = 'fake.notes.create';
const OWNER = 'u1';
const ADMIN = 'u9';
const ENV = { CONNECTORS: 'fake', AGENT_TAINT_ROUTING: 'on' };
const before = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));

const agent = (autonomy) => ({ _id: AGENT_ID, name: 'Digest', autonomy, allowedActions: [], projectIds: ['p1'], account: 'workspace', spendCapUsd: 10 });
const actor = { kind: 'agent', userId: OWNER, agentId: AGENT_ID, agentName: 'Digest', runId: null, viaAccount: 'workspace', tokenId: null };
const proposalRows = () => mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS] || [];

const runToProposal = async (autonomy) => {
    const a = agent(autonomy);
    mockDb.seed(SCHEMA_TYPE.AGENTS, a);
    orchestrator.analyse.mockResolvedValue({ status: 'success', skill: 'plan', changes: [{ action: KEY, label: 'Save the minutes', reversible: false, params: { title: 'Minutes', body: 'Approved.' } }], summary: 'minutes', usage: { totalTokens: 100 }, model: 'm' });
    const run = await runs.create(C, { agent: a, taskId: TASK._id, projectId: 'p1', skill: 'plan', startedBy: OWNER });
    return runs.executeSkill(C, run, a, TASK, { proposals, actions, actor });
};

let mem;
beforeEach(() => {
    Object.assign(process.env, ENV);
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    mem = persistence.useInMemory();
    resolveConnection.mockResolvedValue({ connectionId: 'conn-u1', scopes: ['notes.write'], getAccessToken: async () => 'secret-token' });
    safeFetch.mockImplementation(async () => ({ status: 200, headers: {}, body: JSON.stringify({ id: 'n-77' }) }));
});
afterEach(() => { mem.reset(); persistence.useMongo(); });
afterAll(() => Object.entries(before).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; }));

describe('a connector write from an agent run', () => {
    it.each([0, 1, 2, 3])('at autonomy %i waits as a proposal for the person the run works for', async (autonomy) => {
        const out = await runToProposal(autonomy);
        expect(out).toMatchObject({ status: 'waiting_approval', proposalId: expect.any(String) });
        expect(actions.perform).not.toHaveBeenCalled();
        expect(resolveConnection).toHaveBeenCalledWith({ companyId: C, userId: OWNER, provider: 'fake' });
        expect(proposalRows()[0]).toMatchObject({ gate: 'connection_owner', connectionOwner: OWNER, status: 'pending' });
        expect(proposalRows()[0].changes[0]).toMatchObject({ action: KEY, params: { title: 'Minutes', body: 'Approved.', connectionId: 'conn-u1' }, card: expect.objectContaining({ title: 'Minutes', text: 'Approved.' }) });
    });

    it('goes from the run to the provider once its owner approves, and an admin cannot', async () => {
        const { proposalId } = await runToProposal(1);
        expect(await proposals.approve(C, proposalId, { decider: { kind: 'human', userId: ADMIN }, isPrivileged: true, ip: '' })).toMatchObject({ status: 403 });
        expect(safeFetch).not.toHaveBeenCalled();

        const out = await proposals.approve(C, proposalId, { decider: { kind: 'human', userId: OWNER }, isPrivileged: false, ip: '' });
        expect(out.applied).toEqual([expect.objectContaining({ action: KEY, ok: true })]);
        expect(safeFetch).toHaveBeenCalledTimes(1);
        const [url, options] = safeFetch.mock.calls[0];
        expect(url).toBe('https://api.fake.test/notes');
        expect(options.headers.Authorization).toBe('Bearer secret-token');
        expect(JSON.parse(options.data)).toEqual({ folder: 'Notes', title: 'Minutes', body: 'Approved.' });
        expect(proposalRows()[0].delivery).toEqual([expect.objectContaining({ ok: true, connectionId: 'conn-u1', answer: 'Saved as note n-77' })]);
    });
});
