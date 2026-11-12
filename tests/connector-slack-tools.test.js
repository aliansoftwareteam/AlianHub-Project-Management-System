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
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn(), recordAuditFromReq: jest.fn() }));
jest.mock('../Modules/notification-count/controller', () => ({ updateUnReadCommentsCountFun: jest.fn(async () => {}) }));
jest.mock('../Modules/Connectors/resolveConnection', () => ({ resolveConnection: jest.fn(), markBackoff: jest.fn(), recordHealth: jest.fn(async () => {}), markBroken: jest.fn(async () => {}) }));
jest.mock('../Modules/Agents/engine/safeFetch', () => ({
    ...jest.requireActual('../Modules/Agents/engine/safeFetch'),
    safeFetch: jest.fn(),
}));

const fs = require('fs');
const path = require('path');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { safeFetch } = require('../Modules/Agents/engine/safeFetch');
const { resolveConnection, markBroken, markBackoff } = require('../Modules/Connectors/resolveConnection');
const connectorTools = require('../Modules/Connectors/tools');
const providerApi = require('../Modules/Connectors/providerApi');
const { validate } = require('../Modules/Connectors/validate');
const slack = require('../Modules/Connectors/providers/slack');
const readers = require('../Modules/Agents/skills/readers');
const registry = require('../Modules/Agents/registry');
const seeds = require('../Modules/Agents/skills/seeds');
const egressContext = require('../Modules/Agents/engine/egressContext');
const proposals = require('../Modules/Agents/proposals');
const mcpTools = require('../Modules/Mcp/tools');
const fakeSlack = require('./fixtures/fakeSlackApi');

/* The Slack provider and its tools on a person's own user token, reached from an agent run and from MCP, against
 * the fake Slack server. */

const C = '6f0000000000000000000c01';
const PRISHA = '6f0000000000000000000a01';
const AGENT_ID = '6f0000000000000000000b01';
const PROJECT = '6f0000000000000000000e01';
const RUN = '6f0000000000000000000d01';
const MINE = 'conn-prisha-slack';
const ENV = { CONNECTORS: 'slack', AGENT_TAINT_ROUTING: 'on' };
const before = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
const ALL_SCOPES = slack.products.messages;

let fake;
const connected = (scopes = ALL_SCOPES) => resolveConnection.mockResolvedValue({ connectionId: MINE, scopes, getAccessToken: async () => fakeSlack.TOKEN });
const actor = { kind: 'agent', userId: PRISHA, agentId: AGENT_ID, agentName: 'Digest', runId: RUN };
const TICKED = [{ provider: 'slack', tools: require('../Modules/Connectors/tools').all().filter((tool) => tool.provider === 'slack').map((tool) => tool.key) }];
const agentRead = (key, input = {}) => egressContext.run({ companyId: C }, () => readers.read(key, C, { runId: RUN, actor, allowedActions: [], connectors: TICKED }, input));
const mcpCaller = (scopes) => ({
    companyId: C, userId: PRISHA, actor: { kind: 'agent', userId: PRISHA, agentName: 'Claude', viaAccount: 'external' },
    token: { oauth: true, scopes }, oauth: { clientId: 'client-1', grantId: 'grant-1' }, canWrite: true, allowedActions: [],
});
const mcpRead = (key, input = {}) => mcpTools.call(mcpCaller(['connectors:read']), key, input);
const mcpWrite = (key, input = {}) => mcpTools.call(mcpCaller(['connectors:write']), key, input);
const proposalRow = (id) => (mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS] || []).find((p) => String(p._id) === String(id));
const fromAgentRun = (params) => proposals.create(C, {
    agent: { _id: AGENT_ID, name: 'Digest', connectors: TICKED }, projectId: PROJECT, what: 'Post it', why: 'Asked', changes: [{ action: 'slack.message.post', params }], connectionOwner: PRISHA,
});
const approve = (id, extra = {}) => proposals.approve(C, id, { decider: { kind: 'human', userId: PRISHA }, isPrivileged: false, ip: '', ...extra });
const callsTo = (method) => fake.state.calls.filter((call) => call.url.pathname === `/api/${method}`);

beforeEach(() => {
    Object.assign(process.env, ENV);
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    fake = fakeSlack.create();
    connected();
    safeFetch.mockImplementation(fake.fetch);
    markBackoff.mockImplementation(async ({ connectionId, until }) => mockDb.seed(SCHEMA_TYPE.CONNECTOR_CONNECTIONS, { _id: connectionId, backoffUntil: until }));
    mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { _id: RUN, status: 'running', connectorReads: [] });
    mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: AGENT_ID, name: 'Digest', allowedActions: [], autonomy: 3 });
});

afterAll(() => Object.entries(before).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; }));

describe('the Slack provider definition', () => {
    it('passes the contract and asks only for user scopes, with no direct-message scope', () => {
        expect(validate(slack)).toEqual([]);
        expect(ALL_SCOPES.some((scope) => /^(im|mpim):/.test(scope))).toBe(false);
    });

    it('asks Slack for the scopes as user_scope, comma-separated, with no bot scope', () => {
        const url = new URL(providerApi.consentUrl({ definition: slack, clientId: 'cid', redirectUri: 'https://pm.test/cb', scopes: ['channels:read', 'chat:write'], state: 's', challenge: 'c' }));
        expect(url.searchParams.get('user_scope')).toBe('channels:read,chat:write');
        expect(url.searchParams.has('scope')).toBe(false);
        expect(url.searchParams.has('code_challenge')).toBe(false);
    });

    it('reads the user token from authed_user, and the account as workspace and user', () => {
        const answer = { ok: true, team: { id: 'T01', name: 'Acme' }, authed_user: { id: 'U01', scope: 'channels:read,chat:write', access_token: 'xoxe.xoxp-1', refresh_token: 'xoxe-1', expires_in: 43200, token_type: 'user' } };
        expect(providerApi.tokensOf(slack, answer)).toMatchObject({ access_token: 'xoxe.xoxp-1', refresh_token: 'xoxe-1', expires_in: 43200 });
        expect(providerApi.scopesOf(providerApi.tokensOf(slack, answer).scope)).toEqual(['channels:read', 'chat:write']);
        expect(slack.readAccount({ tokenResponse: answer })).toEqual({ id: 'T01:U01', label: 'Acme' });
        expect(() => slack.readAccount({ tokenResponse: { ok: true } })).toThrow(/names no workspace/);
    });

    it('reads a refreshed token whether Slack nests it or not', () => {
        expect(providerApi.tokensOf(slack, { ok: true, access_token: 'xoxe.xoxp-2', refresh_token: 'xoxe-2', token_type: 'user' }).access_token).toBe('xoxe.xoxp-2');
    });

    it('treats an ok:false answer of 200 as the error it names', async () => {
        safeFetch.mockResolvedValueOnce(fakeSlack.slackError('invalid_refresh_token'));
        const out = await egressContext.run({ companyId: C }, () => providerApi.refresh({ definition: slack, companyId: C, actor: PRISHA, client: { clientId: 'cid', clientSecret: 'sec' }, refreshToken: 'xoxe-1' }));
        expect(out).toEqual({ ok: false, error: 'invalid_refresh_token' });
        expect(providerApi.isGrantRefused(slack, out.error)).toBe(true);
    });

    it('revokes by posting the access token to auth.revoke', async () => {
        safeFetch.mockResolvedValueOnce(fakeSlack.answer(200, { ok: true, revoked: true }));
        const out = await egressContext.run({ companyId: C }, () => providerApi.revoke({ definition: slack, companyId: C, actor: PRISHA, token: 'xoxe.xoxp-1' }));
        expect(out.ok).toBe(true);
        expect(safeFetch.mock.calls[0][0]).toBe('https://slack.com/api/auth.revoke');
        expect(slack.auth.revokeWith).toBe('access');
    });
});

describe('the Slack tools', () => {
    const slackTools = () => connectorTools.all().filter((tool) => tool.provider === 'slack');

    it('load on the messages product, with a label in en.js', () => {
        expect(slackTools().map((tool) => tool.key)).toEqual(['slack.channels.list', 'slack.channel.read', 'slack.message.post']);
        expect(connectorTools.problemsOf(slack, slackTools())).toEqual([]);
        const en = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'locales', 'en.js'), 'utf8');
        slackTools().forEach((tool) => expect(en).toContain(`${tool.label.replace('Connectors.tool.', '')}: "`));
    });

    it('replace the workspace bot\'s actions in the agent registry', () => {
        expect(registry.get('slack.message.post')).toMatchObject({ write: true, proposeOnly: true, gate: connectorTools.WRITE_GATE });
        expect(registry.get('slack.channel.read')).toMatchObject({ write: false });
    });

    it('are off while CONNECTORS does not name slack', () => {
        process.env.CONNECTORS = 'google';
        expect(mcpTools.names()).not.toContain('slack.channel.read');
        expect(seeds.slackSummarySkill()).toBeNull();
    });
});

describe('slack.channels.list', () => {
    it('lists public channels and the private ones the person is in, never a direct message', async () => {
        const { text } = await mcpRead('slack.channels.list');
        expect(text).toBe([
            '- #general (member) [id: C0GENERAL1]',
            '- #leads (private) (member) [id: G0LEADS001]',
            '- #releases [id: C0RELEASE1]',
        ].join('\n'));
        expect(callsTo('conversations.list')[0].url.searchParams.get('types')).toBe('public_channel,private_channel');
    });

    it('filters by name', async () => {
        expect((await mcpRead('slack.channels.list', { name: '#rel' })).text).toBe('- #releases [id: C0RELEASE1]');
    });
});

describe('slack.channel.read', () => {
    it('reads a channel by name on the person\'s own token, oldest first, with Slack markup made words', async () => {
        const out = await agentRead('slack.channel.read', { channel: '#general' });
        const lines = out.text.split('\n');
        expect(lines).toHaveLength(2);
        expect(lines[0]).toMatch(/U0JO000001: Who owns #releases\?$/);
        expect(lines[1]).toMatch(/U0SAM00001: Shipping @here today, see the plan \(https:\/\/x.test\)$/);
        expect(out.text).not.toContain('<!');
        expect(out).toMatchObject({ channel: 'general', channelId: 'C0GENERAL1', count: 2 });
        expect(out.taint[0]).toMatchObject({ kind: 'connector', ref: expect.stringMatching(/^slack:/) });
        expect(resolveConnection).toHaveBeenCalledWith({ companyId: C, userId: PRISHA, provider: 'slack' });
    });

    it('reads a private channel the person is in', async () => {
        expect((await mcpRead('slack.channel.read', { channel: 'G0LEADS001' })).text).toMatch(/Budget is approved/);
    });

    it('with no channel named, reads the first channel by name the person is a member of', async () => {
        const out = await agentRead('slack.channel.read');
        expect(out.channel).toBe('general');
    });

    it('refuses a direct message id before calling Slack', async () => {
        await expect(mcpRead('slack.channel.read', { channel: 'D0DIRECT01' })).rejects.toThrow(/channel is not in the form/);
        expect(safeFetch).not.toHaveBeenCalled();
    });

    it('refuses a group DM even when its id looks like a channel', async () => {
        fake.state.channels.push({ id: 'G0MPIM0001', name: 'mpdm-sam--jo', is_mpim: true, is_private: true });
        expect(await mcpRead('slack.channel.read', { channel: 'G0MPIM0001' })).toMatchObject({ error: expect.stringMatching(/direct message/) });
        expect(callsTo('conversations.history')).toHaveLength(0);
    });

    it('turns Slack\'s ok:false into a refusal, not data', async () => {
        expect(await mcpRead('slack.channel.read', { channel: 'C0NOTHERE1' })).toEqual({ code: 'provider_refused', error: 'Slack answered channel_not_found, so this did not go through.' });
    });

    it('marks the connection broken when Slack says the token is dead', async () => {
        fake.state.next = fakeSlack.slackError('token_revoked');
        expect(await mcpRead('slack.channel.read', { channel: 'C0GENERAL1' })).toMatchObject({ code: 'broken' });
        expect(markBroken).toHaveBeenCalledWith({ companyId: C, connectionId: MINE, reason: 'token_revoked' });
    });

    it('names the product to tick when its scope is missing', async () => {
        connected(['chat:write']);
        expect(await mcpRead('slack.channel.read', { channel: 'general' })).toEqual({ code: 'scope_missing', error: 'Tick messages on your Slack connection in My connections, then ask again.' });
    });
});

describe('slack.message.post', () => {
    it('from an agent run waits for its owner, then posts once as that person, as plain text', async () => {
        const p = await fromAgentRun({ channel: 'releases', text: 'Release 2.1 is out.' });
        expect(p).toMatchObject({ status: 'pending', gate: 'connection_owner', connectionOwner: PRISHA });
        expect(safeFetch).not.toHaveBeenCalled();
        expect(proposalRow(p.proposalId || p._id).changes[0].card).toMatchObject({ target: '#releases', text: 'Release 2.1 is out.' });
        const out = await approve(p.proposalId || p._id);
        expect(out.applied).toEqual([expect.objectContaining({ action: 'slack.message.post', ok: true })]);
        expect(fake.state.posted).toEqual([expect.objectContaining({ channel: 'C0RELEASE1', text: 'Release 2.1 is out.', parse: 'none', link_names: false, unfurl_links: false })]);
    });

    it('from MCP waits in the Inbox', async () => {
        const { proposalId } = await mcpWrite('slack.message.post', { channel: 'general', text: 'Hello' });
        expect(proposalRow(proposalId)).toMatchObject({ status: 'pending', connectionOwner: PRISHA });
        expect(fake.state.posted).toEqual([]);
    });

    it('is refused at filing when it would notify a whole channel', async () => {
        await expect(fromAgentRun({ channel: 'general', text: 'Hi <!channel>' })).rejects.toThrow(/notify a whole channel/);
        expect(safeFetch).not.toHaveBeenCalled();
    });

    it('never posts to a direct message', async () => {
        await expect(fromAgentRun({ channel: 'D0DIRECT01', text: 'Hi' })).rejects.toThrow(/channel is not in the form/);
    });
});

describe('the Slack summary skill', () => {
    it('exists while Slack is on, reading through slack.channel.read and posting back by channel name', () => {
        const skill = seeds.slackSummarySkill();
        expect(skill).not.toBeNull();
        expect(seeds.SEEDS.slackSummary.gather[0].reader).toBe('slack.channel.read');
        expect(seeds.SEEDS.slackSummary.emit[0].params.channel).toBe('{{gather.slack.channel}}');
    });
});

describe('Slack writes, checked again on edit and at send', () => {
    it('refuses an edit on the approval card that would notify a whole channel, and sends nothing', async () => {
        const p = await fromAgentRun({ channel: 'general', text: 'Release is out.' });
        const id = p.proposalId || p._id;
        const out = await approve(id, { changes: [{ action: 'slack.message.post', params: { channel: 'general', text: 'Release is out <!everyone>' } }] });
        expect(out.error).toMatch(/notify a whole channel/);
        expect(fake.state.posted).toEqual([]);
        expect(proposalRow(id).status).toBe('pending');
    });

    it('shows an accepted edit again before it is sent, then sends exactly the edited text', async () => {
        const p = await fromAgentRun({ channel: 'general', text: 'Release is out.' });
        const id = p.proposalId || p._id;
        expect(await approve(id, { changes: [{ action: 'slack.message.post', params: { channel: 'general', text: 'Release 2.1 is out.' } }] })).toMatchObject({ reshown: true, applied: [] });
        expect(fake.state.posted).toEqual([]);
        await approve(id, { revision: proposalRow(id).revision });
        expect(fake.state.posted.map((m) => m.text)).toEqual(['Release 2.1 is out.']);
    });

    it('is not sent when the channel turned into a direct message by send time', async () => {
        const p = await fromAgentRun({ channel: 'G0LEADS001', text: 'Budget is approved.' });
        Object.assign(fake.state.channels.find((c) => c.id === 'G0LEADS001'), { is_mpim: true });
        const out = await approve(p.proposalId || p._id);
        expect(out.applied).toEqual([expect.objectContaining({ ok: false, error: expect.stringMatching(/direct message/) })]);
        expect(fake.state.posted).toEqual([]);
    });

    it('a bot-era post still waiting in the Inbox names no connection owner, so even an admin cannot send it', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENT_PROPOSALS, { _id: '6f0000000000000000000f01', agentId: AGENT_ID, status: 'pending', gate: 'owner_admin', changes: [{ action: 'slack.message.post', params: { channelId: 'C0GENERAL1', text: 'old' } }] });
        const out = await proposals.approve(C, '6f0000000000000000000f01', { decider: { kind: 'human', userId: PRISHA }, isPrivileged: true, ip: '' });
        expect(out).toMatchObject({ status: 403, reason: 'not_permitted' });
        expect(fake.state.posted).toEqual([]);
    });
});

describe('when Slack says slow down, or a run has read enough', () => {
    it('a 429 holds the connection, and the next call never reaches Slack', async () => {
        fake.state.next = fakeSlack.answer(429, { ok: false, error: 'ratelimited' }, { 'retry-after': '30' });
        expect(await mcpRead('slack.channels.list')).toMatchObject({ code: 'provider_busy' });
        expect(markBackoff).toHaveBeenCalledWith(expect.objectContaining({ connectionId: MINE }));
        const calls = fake.state.calls.length;
        expect(await mcpRead('slack.channel.read', { channel: 'C0GENERAL1' })).toMatchObject({ code: 'provider_busy' });
        expect(fake.state.calls).toHaveLength(calls);
    });

    it('stops an agent run after its connector read cap, without calling Slack again', async () => {
        const { RUN } = require('../Modules/Agents/connectors/readLimits');
        for (let i = 0; i < RUN.CALLS; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await agentRead('slack.channel.read', { channel: 'C0GENERAL1' });
        }
        const calls = fake.state.calls.length;
        await expect(agentRead('slack.channel.read', { channel: 'C0GENERAL1' })).rejects.toMatchObject({ code: 'run_call_cap' });
        expect(fake.state.calls).toHaveLength(calls);
    });

    it('never sends the token anywhere but slack.com, and keeps it out of what it stores', async () => {
        const { proposalId } = await mcpWrite('slack.message.post', { channel: 'general', text: 'Hello' });
        await approve(proposalId);
        await agentRead('slack.channel.read', { channel: 'general' });
        safeFetch.mock.calls.forEach(([url]) => expect(new URL(url).hostname).toBe('slack.com'));
        expect(JSON.stringify(mockDb.store)).not.toContain(fakeSlack.TOKEN);
    });
});
