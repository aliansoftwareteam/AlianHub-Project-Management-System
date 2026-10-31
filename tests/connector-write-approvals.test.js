const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Agents/permissions', () => ({ holderMay: jest.fn(async () => ({ allowed: true, reason: '', permission: null })), REASON: 'permission_denied' }));
jest.mock('../Modules/Agents/engine/graph', () => ({ resumeGraph: jest.fn(async () => ({ resumed: false })) }));
jest.mock('../Modules/AICore/persistence', () => {
    const deleteThread = jest.fn(async () => {});
    return { deleteThread, saverFor: jest.fn(() => ({ deleteThread })), storeFor: jest.fn(() => { throw new Error('no store in this suite'); }), ready: jest.fn(async () => {}) };
});
jest.mock('../Modules/Mcp/oauthAuth', () => ({ ...jest.requireActual('../Modules/Mcp/oauthAuth'), standingOfGrant: jest.fn(async () => ['connectors:write']) }));
jest.mock('../Modules/Connectors/tools', () => {
    const real = jest.requireActual('../Modules/Connectors/tools');
    return { ...real, ...real.make(require('path').join(__dirname, 'fixtures', 'connectors')) };
});
jest.mock('../Modules/Connectors/resolveConnection', () => ({ resolveConnection: jest.fn() }));
jest.mock('../Modules/Agents/engine/safeFetch', () => ({
    ...jest.requireActual('../Modules/Agents/engine/safeFetch'),
    safeFetch: jest.fn(),
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { safeFetch } = require('../Modules/Agents/engine/safeFetch');
const { resolveConnection } = require('../Modules/Connectors/resolveConnection');
const { standingOfGrant } = require('../Modules/Mcp/oauthAuth');
const connectorTools = require('../Modules/Connectors/tools');
const writes = require('../Modules/Connectors/writes');
const registry = require('../Modules/Agents/registry');
const policy = require('../Modules/Agents/policy');
const actions = require('../Modules/Agents/actions');
const proposals = require('../Modules/Agents/proposals');
const approverRights = require('../Modules/Agents/approverRights');
const mcpTools = require('../Modules/Mcp/tools');

/* The fake provider's one write, from an agent run and from MCP: always a proposal, approved only by the person whose
 * connection it uses, sent once and exactly as approved. */

const C = '6f0000000000000000000c01';
const PRISHA = '6f0000000000000000000a01';
const ADMIN = '6f0000000000000000000a02';
const MEMBER = '6f0000000000000000000a03';
const AGENT_ID = '6f0000000000000000000b01';
const PROJECT = '6f0000000000000000000e01';
const MINE = 'conn-prisha';
const KEY = 'fake.notes.create';
const ENV = { CONNECTORS: 'fake', AGENT_TAINT_ROUTING: 'on' };
const before = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
const NOTE = { folder: 'Board', title: 'Minutes', body: 'Approved the budget for Q4.' };

const connected = (scopes = ['notes.read', 'notes.write']) => resolveConnection.mockResolvedValue({ connectionId: MINE, scopes, getAccessToken: async () => 'secret-token' });
const provider = { status: 200, body: { id: 'n-77' } };
const sent = () => safeFetch.mock.calls.filter(([, options]) => options.method === 'post');
const sentBody = (i = 0) => JSON.parse(sent()[i][1].data);
const proposalRow = (id) => (mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS] || []).find((p) => String(p._id) === String(id));
const decider = (userId) => ({ kind: 'human', userId });
const approveAs = (id, userId, over = {}) => proposals.approve(C, id, { decider: decider(userId), isPrivileged: userId === ADMIN, ip: '', ...over });

const oauthCaller = (scopes) => ({
    companyId: C, userId: PRISHA, actor: { kind: 'agent', userId: PRISHA, agentName: 'Claude', viaAccount: 'external' },
    token: { oauth: true, scopes }, oauth: { clientId: 'client-1', grantId: 'grant-1' }, canWrite: true, allowedActions: [],
});

const fromAgentRun = (change = NOTE) => proposals.create(C, {
    agent: { _id: AGENT_ID, name: 'Digest' }, projectId: PROJECT, what: 'Save the minutes', why: 'The meeting ended',
    changes: [{ action: KEY, params: { ...change } }], connectionOwner: PRISHA,
});

beforeEach(() => {
    Object.assign(process.env, ENV);
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    connected();
    standingOfGrant.mockResolvedValue(['connectors:write']);
    safeFetch.mockImplementation(async () => ({ status: provider.status, headers: {}, body: JSON.stringify(provider.body) }));
    mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: AGENT_ID, name: 'Digest', allowedActions: [], autonomy: 3 });
});

afterAll(() => Object.entries(before).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; }));

describe('the strict proposal schema', () => {
    it('keeps who may approve a write and the claim on its send', () => {
        const { agentProposals } = require('../utils/mongo-handler/schema').schema;
        expect(agentProposals.connectionOwner).toBeDefined();
        expect(agentProposals.sendAttempts).toBeDefined();
    });
});

describe('a write tool definition', () => {
    it('does not load without the card a person approves from', () => {
        const fake = require('./fixtures/connectors/fake');
        const { card, ...noCard } = connectorTools.get(KEY);
        expect(connectorTools.problemsOf(fake, [{ ...noCard, kind: 'write' }]).join()).toMatch(/a write has no card/);
        expect(typeof card).toBe('function');
    });
});

describe('every write is a proposal', () => {
    it('is proposeOnly behind the connection_owner gate, so no autonomy level makes it directly', () => {
        expect(registry.get(KEY)).toMatchObject({ write: true, proposeOnly: true, gate: 'connection_owner', undoable: false });
        [0, 1, 2, 3].forEach((autonomy) => {
            expect(registry.mayActDirectly(autonomy, KEY)).toBe(false);
            const agent = { autonomy, projectIds: [PROJECT], allowedActions: [] };
            expect(policy.decide({ agent, action: KEY, params: NOTE, rating: actions.rating(KEY), task: { ProjectID: PROJECT } }).decision).toBe(policy.DECISION.PROPOSE);
        });
    });

    it('is refused when an agent tries to make it without an approval, and nothing is sent', async () => {
        const actor = { kind: 'agent', userId: PRISHA, agentId: AGENT_ID, agentName: 'Digest', runId: null };
        await expect(actions.perform({ companyId: C, actor, action: KEY, params: NOTE, allowedActions: [] })).rejects.toThrow(/approval/);
        expect(safeFetch).not.toHaveBeenCalled();
    });

    it('from an agent run, waits with its card, on the owner\'s own connection', async () => {
        const p = await fromAgentRun();
        expect(p).toMatchObject({ status: 'pending', gate: 'connection_owner', connectionOwner: PRISHA });
        expect(p.changes[0].params).toEqual({ ...NOTE, connectionId: MINE });
        expect(p.changes[0].card).toEqual({
            provider: 'fake', tool: KEY, label: 'Connectors.tool.fakeNotesCreate',
            target: 'Board', title: 'Minutes', text: NOTE.body, attachments: [],
        });
        expect(resolveConnection).toHaveBeenCalledWith({ companyId: C, userId: PRISHA, provider: 'fake' });
        expect(safeFetch).not.toHaveBeenCalled();
    });

    it('from an agent run, is not filed without the person whose connection it uses', async () => {
        await expect(proposals.create(C, { agent: { _id: AGENT_ID, name: 'Digest' }, projectId: PROJECT, what: 'x', why: 'y', changes: [{ action: KEY, params: NOTE }] }))
            .rejects.toThrow(writes.REFUSAL.NO_OWNER);
    });

    it('from MCP, is filed in the Inbox and the reply says nothing was sent', async () => {
        const out = await mcpTools.call(oauthCaller(['connectors:write']), KEY, NOTE);
        expect(out).toMatchObject({ ok: false, pending: true, approval: 'pending' });
        expect(out.message).toMatch(/Nothing was sent to Fake.*Inbox/);
        expect(proposalRow(out.proposalId)).toMatchObject({ source: 'mcp', requestedBy: PRISHA, connectionOwner: PRISHA, gate: 'connection_owner', status: 'pending' });
        expect(safeFetch).not.toHaveBeenCalled();
    });

    it('from MCP, is neither listed nor filed for a token without connectors:write', async () => {
        const reader = oauthCaller(['connectors:read']);
        expect(mcpTools.manifest(reader).map((t) => t.name)).not.toContain(KEY);
        await expect(mcpTools.call(reader, KEY, NOTE)).rejects.toThrow(/connectors:write/);
        expect(mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS] || []).toHaveLength(0);
    });

    it('is refused at filing when the person has not ticked the product\'s write scope', async () => {
        connected(['notes.read']);
        await expect(fromAgentRun()).rejects.toMatchObject({ code: 'scope_missing' });
    });
});

describe('a data skill', () => {
    const { validateSkill } = require('../Modules/Agents/skills/validateSkill');
    const { compile } = require('../Modules/Agents/skills/compile');
    const prompt = { partials: ['json_only'], instructions: 'Write the minutes.', template: '{{input.brief}}', output: '{"title":"...","body":"..."}' };
    const doc = (params) => validateSkill({ key: 'team.minutes', name: 'Minutes', inputs: ['brief'], gather: [], prompt, emit: [{ action: KEY, params }] });

    it('may emit a connector write, with the tool\'s required params', () => {
        expect(doc({ title: '{{answer.title}}', body: '{{answer.body}}' }).errors).toEqual([]);
        expect(doc({ title: '{{answer.title}}' }).errors.map((e) => `${e.field} ${e.code}`)).toContain('emit[0].params.body required');
    });

    it('may not while its provider is off', () => {
        process.env.CONNECTORS = 'slack';
        expect(doc({ title: 't', body: 'b' }).errors.map((e) => e.code)).toContain('unknown_action');
    });

    it('renders the write with no task or project id its schema would refuse', () => {
        const skill = compile(doc({ title: '{{answer.title}}', body: '{{answer.body}}' }).value);
        const { changes } = skill.toChanges({ task: { _id: 't1', ProjectID: PROJECT }, raw: { title: 'Minutes', body: 'Text' }, context: {} });
        expect(changes).toEqual([expect.objectContaining({ action: KEY, params: { title: 'Minutes', body: 'Text' } })]);
    });
});

describe('only the connection\'s owner approves', () => {
    it('refuses an admin and another member, and lists the row as not theirs', async () => {
        const p = await fromAgentRun();
        for (const someone of [ADMIN, MEMBER]) {
            // eslint-disable-next-line no-await-in-loop
            expect(await approveAs(p._id, someone)).toMatchObject({ status: 403, error: writes.REFUSAL.NOT_OWNER });
        }
        const caller = { human: true, privileged: true, actor: { userId: ADMIN } };
        expect(await approverRights.standingOf(C, { ...caller, seat: true, roleType: 2 }, proposalRow(p._id))).toMatchObject({ locked: true });
        expect(proposalRow(p._id).status).toBe('pending');
        expect(safeFetch).not.toHaveBeenCalled();
    });

    it('refuses an admin on an MCP proposal too', async () => {
        const { proposalId } = await mcpTools.call(oauthCaller(['connectors:write']), KEY, NOTE);
        expect(await approveAs(proposalId, ADMIN)).toMatchObject({ status: 403, error: writes.REFUSAL.NOT_OWNER });
        expect(safeFetch).not.toHaveBeenCalled();
    });
});

describe('what is approved is what is sent, once', () => {
    it('sends exactly the approved note, on the owner\'s token, and keeps the answer', async () => {
        const p = await fromAgentRun();
        const out = await approveAs(p._id, PRISHA);
        expect(out.applied).toEqual([expect.objectContaining({ action: KEY, ok: true })]);
        expect(sent()).toHaveLength(1);
        const [url, options] = sent()[0];
        expect(url).toBe('https://api.fake.test/notes');
        expect(options.headers.Authorization).toBe('Bearer secret-token');
        const card = proposalRow(p._id).changes[0].card;
        expect(sentBody()).toEqual({ folder: card.target, title: card.title, body: card.text });
        expect(proposalRow(p._id).delivery).toEqual([expect.objectContaining({ action: KEY, ok: true, connectionId: MINE, answer: 'Saved as note n-77' })]);
    });

    it('sends an MCP proposal as approved by its owner', async () => {
        const { proposalId } = await mcpTools.call(oauthCaller(['connectors:write']), KEY, NOTE);
        const out = await approveAs(proposalId, PRISHA);
        expect(out.error).toBeUndefined();
        expect(sentBody()).toEqual(NOTE);
    });

    it('refuses an MCP proposal whose grant lost connectors:write', async () => {
        const { proposalId } = await mcpTools.call(oauthCaller(['connectors:write']), KEY, NOTE);
        standingOfGrant.mockResolvedValue(['tasks:write']);
        expect((await approveAs(proposalId, PRISHA)).error).toMatch(/grant/);
        expect(safeFetch).not.toHaveBeenCalled();
    });

    it('checks an edit and shows it again, sending nothing until it is approved', async () => {
        const p = await fromAgentRun();
        const edited = { ...NOTE, body: 'Approved the budget for Q4, with one change.' };
        const out = await approveAs(p._id, PRISHA, { changes: [{ action: KEY, params: edited }] });
        expect(out).toMatchObject({ reshown: true, applied: [] });
        expect(proposalRow(p._id)).toMatchObject({ status: 'pending' });
        expect(proposalRow(p._id).changes[0].card.text).toBe(edited.body);
        expect(safeFetch).not.toHaveBeenCalled();
        await approveAs(p._id, PRISHA);
        expect(sentBody()).toEqual(edited);
    });

    it('refuses an edit the tool\'s schema does not accept', async () => {
        const p = await fromAgentRun();
        const out = await approveAs(p._id, PRISHA, { changes: [{ action: KEY, params: { ...NOTE, cc: 'everyone@acme.test' } }] });
        expect(out).toMatchObject({ status: 400 });
        expect(proposalRow(p._id).changes[0].params).toEqual({ ...NOTE, connectionId: MINE });
    });

    it('refuses a second approval of the same proposal', async () => {
        const p = await fromAgentRun();
        await approveAs(p._id, PRISHA);
        expect(await approveAs(p._id, PRISHA)).toMatchObject({ status: 409 });
        expect(sent()).toHaveLength(1);
    });

    it('refuses a second send of the same approval', async () => {
        const p = await fromAgentRun();
        await approveAs(p._id, PRISHA);
        const proposal = { id: String(p._id), connectionOwner: PRISHA };
        const actor = { kind: 'human', userId: PRISHA };
        await expect(writes.send({ companyId: C, actor, action: KEY, params: { ...NOTE, connectionId: MINE }, proposal })).rejects.toMatchObject({ code: 'sent_once' });
        expect(sent()).toHaveLength(1);
    });

    it('keeps the provider\'s error on the proposal and does not try again', async () => {
        safeFetch.mockRejectedValue(Object.assign(new Error('provider timed out'), { code: 'timeout' }));
        const p = await fromAgentRun();
        const out = await approveAs(p._id, PRISHA);
        expect(out.applied).toEqual([expect.objectContaining({ ok: false })]);
        expect(proposalRow(p._id).delivery).toEqual([expect.objectContaining({ ok: false, error: expect.stringMatching(/timed out/) })]);
        expect(await approveAs(p._id, PRISHA)).toMatchObject({ status: 409 });
        expect(safeFetch).toHaveBeenCalledTimes(1);
    });

    it('keeps a provider\'s refusal as the error, not as a delivery', async () => {
        safeFetch.mockImplementation(async () => ({ status: 403, headers: {}, body: JSON.stringify({ id: 'never' }) }));
        const p = await fromAgentRun();
        const out = await approveAs(p._id, PRISHA);
        expect(out.applied).toEqual([expect.objectContaining({ ok: false })]);
        expect(proposalRow(p._id).delivery).toEqual([expect.objectContaining({ ok: false, error: expect.stringMatching(/answered 403/) })]);
    });

    it('keeps "reconnect" on the proposal when the token cannot be refreshed, and sends nothing', async () => {
        const dead = Object.assign(new Error('broken: fake'), { name: 'ConnectorError', code: 'broken', provider: 'fake' });
        resolveConnection.mockResolvedValue({ connectionId: MINE, scopes: ['notes.write'], getAccessToken: async () => { throw dead; } });
        const p = await fromAgentRun();
        expect(p.changes[0].label).toBe(NOTE.title);
        await approveAs(p._id, PRISHA);
        expect(proposalRow(p._id).delivery).toEqual([expect.objectContaining({ ok: false, error: 'Fake is no longer accepting your connection. Reconnect Fake on My connections, then ask again.' })]);
        expect(safeFetch).not.toHaveBeenCalled();
    });

    it('refuses a write whose card could not show all of it', async () => {
        await expect(fromAgentRun({ ...NOTE, body: 'x'.repeat(20001) })).rejects.toMatchObject({ code: 'card_too_long' });
        await expect(fromAgentRun({ ...NOTE, body: 'x'.repeat(20000) })).resolves.toMatchObject({ status: 'pending' });
        const p = await fromAgentRun();
        const out = await approveAs(p._id, PRISHA, { changes: [{ action: KEY, params: { ...NOTE, body: 'x'.repeat(20001) } }] });
        expect(out).toMatchObject({ status: 400 });
        expect(proposalRow(p._id).changes[0].card.text).toBe(NOTE.body);
        expect(safeFetch).not.toHaveBeenCalled();
    });

    it('answers an MCP caller with no connection, and files nothing', async () => {
        resolveConnection.mockRejectedValue(Object.assign(new Error('not_connected'), { name: 'ConnectorError', code: 'not_connected', provider: 'fake' }));
        expect(await mcpTools.call(oauthCaller(['connectors:write']), KEY, NOTE)).toEqual({ code: 'not_connected', error: 'Connect Fake on My connections first, then ask again.' });
        expect(mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS] || []).toHaveLength(0);
    });

    it('is never sent without an approved proposal behind it', async () => {
        const actor = { kind: 'human', userId: PRISHA };
        await expect(writes.send({ companyId: C, actor, action: KEY, params: NOTE, proposal: null })).rejects.toMatchObject({ code: 'not_approved' });
        expect(safeFetch).not.toHaveBeenCalled();
    });
});
