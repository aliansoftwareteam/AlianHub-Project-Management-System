const crypto = require('crypto');
const verified = require('./fixtures/verifiedRequest');
const mockDb = require('./fixtures/fakeMongo').create();
const mockSlack = require('./fixtures/fakeSlack').create();

const mockRoles = {};

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async (companyId, uid) => (uid in mockRoles ? mockRoles[uid] : null)),
    isPrivileged: (roleType) => roleType === 1 || roleType === 2,
}));
jest.mock('../Modules/Agents/permissions', () => ({ holderMay: jest.fn(async () => ({ allowed: true, reason: '', permission: null })), REASON: 'permission_denied' }));
jest.mock('../Modules/Agents/engine/graph', () => ({ resumeGraph: jest.fn(async () => ({ resumed: false })) }));
jest.mock('../Modules/AICore/persistence', () => {
    const deleteThread = jest.fn(async () => {});
    return { deleteThread, saverFor: jest.fn(() => ({ deleteThread })), storeFor: jest.fn(() => { throw new Error('no store in this suite'); }), ready: jest.fn(async () => {}) };
});
jest.mock('../Modules/Agents/engine/safeFetch', () => ({
    ...jest.requireActual('../Modules/Agents/engine/safeFetch'),
    safeFetch: jest.fn((...a) => mockSlack.fetch(...a)),
}));

const logger = require('../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const registry = require('../Modules/Agents/registry');
const actions = require('../Modules/Agents/actions');
const policy = require('../Modules/Agents/policy');
const taint = require('../Modules/Agents/taint');
const proposals = require('../Modules/Agents/proposals');
const { buildTrace } = require('../Modules/Agents/runTrace');
const readers = require('../Modules/Agents/skills/readers');
const { catalogues } = require('../Modules/Agents/skills/catalogues');
const { validateSkill } = require('../Modules/Agents/skills/validateSkill');
const { compile } = require('../Modules/Agents/skills/compile');
const egressContext = require('../Modules/Agents/engine/egressContext');
const agentFetch = require('../Modules/Agents/engine/agentFetch');
const orchestrator = require('../Modules/Agents/engine/orchestrator');
const slack = require('../Modules/Agents/connectors/slackConnection');
const slackRead = require('../Modules/Agents/connectors/slackRead');
const ctrl = require('../Modules/Connectors/controller');

const C = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000a01';
const ADMIN = '6f0000000000000000000a02';
const MEMBER = '6f0000000000000000000a03';
const GUEST = '6f0000000000000000000a04';
Object.assign(mockRoles, { [OWNER]: 1, [ADMIN]: 2, [MEMBER]: 3, [GUEST]: 0 });
const AGENT_ID = '6f0000000000000000000b01';
const RUN = '6f0000000000000000000d01';
const TOKEN = `xoxb-${crypto.randomBytes(18).toString('hex')}`;
const RELEASES = 'C0RELEASES1';
const GENERAL = 'C0GENERAL01';
const RANDOM = 'C0RANDOM001';
const READ = 'slack.channel.read';
const POST = 'slack.message.post';
const READER = 'slack.channel';
const T = SCHEMA_TYPE.CONNECTOR_CONNECTIONS;
const ENV = { CONNECTORS: 'slack', SECRETS_STORE: 'true', SECRETS_KEY: crypto.randomBytes(24).toString('hex'), AGENT_TAINT_ROUTING: 'on' };
const TASK = { _id: '6f0000000000000000000701', TaskName: 'Weekly channel summary', TaskKey: 'AR-1', ProjectID: 'p1' };

/* What the channel said. None of it may be stored, logged or audited; only the model and the reader's caller see it. */
const SAID = ['The staging password rotates on Friday', 'Customer Northwind asked for a refund', 'attachment body that is never read'];
const NAMES = { [RELEASES]: 'releases', [GENERAL]: 'general', [RANDOM]: 'random' };

const messages = () => [
    { type: 'message', user: 'U0ALICE001', ts: '1727780300.000300', text: SAID[1] },
    { type: 'message', subtype: 'channel_join', user: 'U0BOB00001', ts: '1727780200.000200', text: '<@U0BOB00001> has joined the channel' },
    {
        type: 'message', user: 'U0BOB00001', ts: '1727780100.000100',
        text: `${SAID[0]} <!channel> see <https://example.com/x|the doc> cc <@U0ALICE001> in <#${GENERAL}|general>`,
        files: [{ id: 'F1', name: 'secret.pdf' }], attachments: [{ text: SAID[2] }], blocks: [{ type: 'rich_text' }],
    },
];

const healthySlack = () => ({
    'auth.test': { body: { ok: true, team: 'Acme', team_id: 'T0ACME0001', user_id: 'U0BOT00001' } },
    'conversations.list': { body: { ok: true, channels: Object.entries(NAMES).map(([id, name]) => ({ id, name, is_member: true })), response_metadata: { next_cursor: '' } } },
    'conversations.info': (form) => ({ body: { ok: true, channel: { id: form.channel, name: NAMES[form.channel], is_channel: true, is_private: false, is_im: false, is_mpim: false, is_member: true } } }),
    'conversations.history': { body: { ok: true, has_more: false, messages: messages() } },
    'chat.postMessage': (form) => ({ body: { ok: true, ts: '1727780000.000100', channel: form.channel } }),
});

const rows = (type) => mockDb.store[type] || [];
const settle = () => new Promise((resolve) => setImmediate(resolve));
const runRow = () => rows(SCHEMA_TYPE.AGENT_RUNS).find((r) => String(r._id) === RUN);
const calls = () => rows(SCHEMA_TYPE.AUDIT_LOGS).filter((a) => a.action === 'connector.call');
/* The trace as GET /agents/runs/:id builds it: from the run row and the audit rows that name the run. */
const traceOf = (runId = RUN) => buildTrace(rows(SCHEMA_TYPE.AGENT_RUNS).find((r) => String(r._id) === runId), rows(SCHEMA_TYPE.AUDIT_LOGS).filter((a) => a.meta && a.meta.runId === runId));
const minute = (ts) => new Date(Number(ts) * 1000).toISOString().slice(0, 16).replace('T', ' ');

const res = () => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; return r; };
    r.json = r.send;
    return r;
};
const call = async (handler, uid, { body = {}, params = {}, apiToken } = {}) => {
    const r = res();
    await handler(verified({ headers: { companyid: C }, uid, body, params, query: {}, ...(apiToken ? { apiToken } : {}) }), r);
    return r;
};

const actor = { kind: 'agent', userId: OWNER, agentId: AGENT_ID, agentName: 'Channel digest', viaAccount: 'workspace', tokenId: null };
const ALLOWED = [{ id: RELEASES, read: true, post: true }, { id: RANDOM, read: true, post: false }, { id: GENERAL, read: false, post: true }];
const connect = async (channels = ALLOWED) => {
    await slack.saveSecrets(C, { botToken: TOKEN }, { id: OWNER });
    await slack.setAllowedChannels(C, channels, { id: OWNER });
    mockSlack.calls.length = 0;
};
const read = (params = { channel: 'releases' }, scope = {}) => readers.read(READER, C, { task: TASK, runId: RUN, actor, allowedActions: [], ...scope }, params);

const captured = (...extra) => JSON.stringify([
    mockDb.store,
    mockDb.calls.map((c) => c.data),
    [logger.info, logger.error, logger.warn, logger.debug].map((fn) => fn.mock.calls),
    extra,
]);

const before = Object.fromEntries([...Object.keys(ENV), 'SKILL_EXTERNAL_READS'].map((k) => [k, process.env[k]]));

beforeEach(() => {
    Object.assign(process.env, ENV);
    delete process.env.SKILL_EXTERNAL_READS;
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    mockSlack.reset(healthySlack());
    mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: AGENT_ID, name: 'Channel digest', ownerId: OWNER, autonomy: 3, projectIds: ['p1'], allowedActions: [], deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { _id: RUN, agentId: AGENT_ID, status: 'running', projectId: 'p1', taskId: TASK._id, startedBy: OWNER });
});

afterAll(() => {
    Object.entries(before).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; });
});

describe('reading a channel that is allowed for reading', () => {
    beforeEach(() => connect());

    it('asks Slack about that one channel and returns its recent messages as plain text, oldest first', async () => {
        const out = await read({ channel: '#Releases' });
        expect(mockSlack.methods()).toEqual(['conversations.info', 'conversations.history']);
        mockSlack.calls.forEach((c) => {
            expect(c).toMatchObject({ verb: 'post', authorization: `Bearer ${TOKEN}`, workspace: C, redirects: 0 });
            expect(c.form.channel).toBe(RELEASES);
        });
        const asked = mockSlack.calls[1].form;
        expect(asked.limit).toBe(String(slackRead.LIMITS.MESSAGES));
        expect(Number(asked.oldest)).toBeGreaterThan(Date.now() / 1000 - 25 * 3600);
        expect(Number(asked.oldest)).toBeLessThan(Date.now() / 1000 - 23 * 3600);
        expect(out.text).toBe([
            `${minute(1727780100)} U0BOB00001: ${SAID[0]} @channel see the doc (https://example.com/x) cc @U0ALICE001 in #general`,
            `${minute(1727780300)} U0ALICE001: ${SAID[1]}`,
        ].join('\n'));
        expect(out).toMatchObject({ channelId: RELEASES, channel: 'releases', count: 2, chars: out.text.length, truncated: false });
        expect(out.taint).toEqual([expect.objectContaining({ kind: 'connector', ref: `slack:${RELEASES}` })]);
    });

    it('takes text only: no file, attachment or block, and no join or leave notice', async () => {
        const out = await read();
        expect(out.text).not.toContain(SAID[2]);
        expect(out.text).not.toContain('secret.pdf');
        expect(out.text).not.toContain('has joined');
        expect(JSON.stringify(out)).not.toContain('rich_text');
    });

    it('leaves people as Slack ids: it asks Slack for no profile', async () => {
        const out = await read();
        expect(out.text).toContain('U0ALICE001:');
        expect(mockSlack.methods().some((m) => m.startsWith('users.'))).toBe(false);
    });

    it('with no channel named, reads the first channel allowed for reading, or for both when the skill will post back', async () => {
        expect((await read({})).channelId).toBe(RANDOM);
        expect((await read({ postable: true })).channelId).toBe(RELEASES);
    });

    it('records the read on the run, the connection and the audit log, without a word of the channel', async () => {
        const out = await read();
        await settle();
        expect(runRow().connectorReads).toEqual([{ action: READ, connector: 'slack', channelId: RELEASES, state: 'applied', messages: 2, chars: out.chars, truncated: false, at: expect.any(Date) }]);
        expect(rows(T)[0].lastReadAt).toBeInstanceOf(Date);
        expect(calls()).toHaveLength(1);
        expect(calls()[0]).toMatchObject({
            actorId: OWNER, entityType: 'connector', entityId: 'slack',
            meta: { action: READ, runId: RUN, agentId: AGENT_ID, channelId: RELEASES, state: 'applied', messages: 2, chars: out.chars, truncated: false },
        });
        const trace = traceOf();
        expect(trace).toEqual([expect.objectContaining({ kind: 'tool', event: 'connector.call', action: READ, status: 'applied', messages: 2, chars: out.chars })]);
        const kept = captured(trace);
        SAID.forEach((line) => expect(kept).not.toContain(line));
        expect(kept).not.toContain('U0ALICE001');
    });
});

describe('a read that is refused', () => {
    beforeEach(() => connect());

    it.each([
        ['a channel allowed for posting only', 'general'],
        ['a channel Slack listed that nobody allowed', 'C0NOTALLOWED'],
        ['a direct message', 'D0ALICE0001'],
        ['a private group', 'G0PRIVATE01'],
    ])('%s is not read, and Slack is not asked', async (label, channel) => {
        await expect(read({ channel })).rejects.toMatchObject({ code: 'channel_not_readable', deterministic: true });
        expect(mockSlack.calls).toHaveLength(0);
        await settle();
        expect(calls()).toEqual([expect.objectContaining({ meta: expect.objectContaining({ action: READ, state: 'refused', reason: 'channel_not_readable' }) })]);
    });

    it('a channel that asks for posting too is refused when it is allowed for reading only', async () => {
        await expect(read({ channel: 'random', postable: true })).rejects.toMatchObject({ code: 'channel_not_readable' });
        expect(mockSlack.calls).toHaveLength(0);
    });

    it.each([
        ['went private after it was allowed', { is_private: true }],
        ['is a direct message', { is_channel: false, is_im: true }],
        ['is a group message', { is_channel: false, is_mpim: true }],
    ])('a channel that %s is refused when Slack says so at call time, and its messages are never asked for', async (label, change) => {
        mockSlack.answers['conversations.info'] = (form) => ({ body: { ok: true, channel: { id: form.channel, name: 'releases', is_channel: true, is_private: false, is_im: false, is_mpim: false, ...change } } });
        await expect(read()).rejects.toMatchObject({ code: 'channel_private' });
        expect(mockSlack.methods()).toEqual(['conversations.info']);
    });

    it('the allow-list is read at call time: a channel unticked a moment ago is refused', async () => {
        await read();
        await slack.setAllowedChannels(C, [{ id: RELEASES, read: false, post: true }], { id: OWNER });
        mockSlack.calls.length = 0;
        await expect(read()).rejects.toMatchObject({ code: 'channel_not_readable' });
        expect(mockSlack.calls).toHaveLength(0);
    });

    it('an agent whose allowed actions leave the read out is refused before Slack is asked', async () => {
        await expect(read({ channel: 'releases' }, { allowedActions: ['task.comment'] })).rejects.toMatchObject({ name: 'RefusedError' });
        expect(mockSlack.calls).toHaveLength(0);
        expect(rows(SCHEMA_TYPE.AUDIT_LOGS).some((a) => a.action === 'agent.action_refused' && a.meta.action === READ)).toBe(true);
    });

    it.each([['no run', { runId: undefined }], ['no agent behind it', { actor: undefined }]])('a read with %s is refused: nothing is read outside a run', async (label, scope) => {
        await expect(read({ channel: 'releases' }, scope)).rejects.toMatchObject({ code: 'run_required' });
        expect(mockSlack.calls).toHaveLength(0);
    });

    it('a token Slack no longer accepts breaks the connection and is not tried again', async () => {
        mockSlack.answers['conversations.history'] = { body: { ok: false, error: 'token_revoked' } };
        await expect(read()).rejects.toMatchObject({ code: 'slack_failed', slackError: 'token_revoked' });
        expect(rows(T)[0]).toMatchObject({ status: 'broken', brokenReason: 'token_revoked' });
        mockSlack.calls.length = 0;
        await expect(read()).rejects.toMatchObject({ code: 'connection_broken' });
        expect(mockSlack.calls).toHaveLength(0);
        await settle();
        expect(calls().map((a) => a.meta.state)).toEqual(['failed', 'refused']);
        expect(runRow().connectorReads.map((r) => r.state)).toEqual(['failed', 'refused']);
    });

    it('a rate limit fails the read once, with no second attempt, and leaves the connection as it was', async () => {
        mockSlack.answers['conversations.history'] = { status: 429, headers: { 'retry-after': '30' }, body: { ok: false, error: 'ratelimited' } };
        await expect(read()).rejects.toMatchObject({ code: 'slack_failed', slackError: 'rate_limited' });
        expect(mockSlack.methods()).toEqual(['conversations.info', 'conversations.history']);
        expect(rows(T)[0].status).toBe('connected');
    });

    it('a workspace that never connected Slack reads nothing', async () => {
        await slack.removeSecret(C, 'bot_token', { id: OWNER });
        mockSlack.calls.length = 0;
        await expect(read()).rejects.toMatchObject({ code: 'not_connected' });
        expect(mockSlack.calls).toHaveLength(0);
    });
});

describe('caps', () => {
    beforeEach(() => connect());
    const many = (n, text = 'short') => Array.from({ length: n }, (unused, i) => ({ type: 'message', user: 'U0ALICE001', ts: `${1727780000 + (n - i)}.000100`, text: `${text} ${n - i}` }));

    it('a skill cannot ask for more than the caps: 50 messages and 20,000 characters', async () => {
        mockSlack.answers['conversations.history'] = { body: { ok: true, messages: many(80) } };
        const out = await read({ channel: 'releases', limit: 500, maxChars: 900000, hours: 9000 });
        const asked = mockSlack.calls[1].form;
        expect(asked.limit).toBe('50');
        expect(Number(asked.oldest)).toBeGreaterThan(Date.now() / 1000 - (slackRead.LIMITS.HOURS + 1) * 3600);
        expect(out.count).toBe(50);
        expect(out.text.split('\n').pop()).toContain('short 80');
    });

    it('long messages are cut at the character cap, newest kept, and the result says it was cut', async () => {
        mockSlack.answers['conversations.history'] = { body: { ok: true, messages: many(30, 'x'.repeat(1500)) } };
        const out = await read();
        expect(out.chars).toBeLessThanOrEqual(slackRead.LIMITS.CHARS);
        expect(out.text.length).toBe(out.chars);
        expect(out.truncated).toBe(true);
        expect(out.count).toBeLessThan(30);
        expect(out.text.split('\n').pop()).toContain(' 30');
    });

    it('a run reads a connector at most three times', async () => {
        for (let i = 0; i < slackRead.LIMITS.RUN_CALLS; i += 1) await read(); // eslint-disable-line no-await-in-loop
        mockSlack.calls.length = 0;
        await expect(read()).rejects.toMatchObject({ code: 'run_call_cap', deterministic: true });
        expect(mockSlack.calls).toHaveLength(0);
        await settle();
        expect(calls().pop().meta).toMatchObject({ state: 'refused', reason: 'run_call_cap' });
    });

    it('a run takes in at most 40,000 characters from connectors, and the last read gets only what is left', async () => {
        mockSlack.answers['conversations.history'] = { body: { ok: true, messages: many(40, 'y'.repeat(1500)) } };
        const first = await read();
        mockDb.store[SCHEMA_TYPE.AGENT_RUNS][0].connectorReads[0].chars = slackRead.LIMITS.RUN_CHARS - 1000;
        const second = await read();
        expect(first.chars).toBeGreaterThan(15000);
        expect(second.chars).toBeLessThanOrEqual(1000);
        expect(second.truncated).toBe(true);
        mockDb.store[SCHEMA_TYPE.AGENT_RUNS][0].connectorReads[1].chars = 1000;
        mockSlack.calls.length = 0;
        await expect(read()).rejects.toMatchObject({ code: 'run_char_cap' });
        expect(mockSlack.calls).toHaveLength(0);
    });

    it('another run starts from zero', async () => {
        for (let i = 0; i < slackRead.LIMITS.RUN_CALLS; i += 1) await read(); // eslint-disable-line no-await-in-loop
        const other = mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: AGENT_ID, status: 'running', projectId: 'p1', startedBy: OWNER });
        expect((await read({ channel: 'releases' }, { runId: String(other._id) })).count).toBe(2);
    });
});

describe('what a read does to the run', () => {
    beforeEach(() => connect());
    const agent = (autonomy) => ({ autonomy, projectIds: ['p1'], allowedActions: [] });

    it('marks the run as tainted by a connector, through the same routing as a fetched page', async () => {
        expect(taint.KIND_LIST).toContain('connector');
        const out = await read();
        const found = taint.fromContext({ gather: { slack: out } });
        expect(found).toEqual([expect.objectContaining({ kind: 'connector', ref: `slack:${RELEASES}` })]);
        const marked = await taint.mark(C, runRow(), found);
        expect(marked).toMatchObject({ tainted: true, taintSources: [{ kind: 'connector', ref: `slack:${RELEASES}` }] });
        expect(taint.routes(marked)).toBe(true);
        expect(taint.connectorsRead(marked)).toEqual(['slack']);
        expect(taint.connectorsRead({ tainted: true, taintSources: [taint.fetched('https://example.com/')] })).toEqual([]);
        expect(taint.forProposal(marked).reason).toContain(`connector slack:${RELEASES}`);
    });

    it.each([0, 1, 2, 3])('a Slack message from such a run is proposed at autonomy L%s, never sent', async (autonomy) => {
        const run = { projectId: 'p1', tainted: true, taintSources: [taint.connector('slack', RELEASES)] };
        const verdict = policy.decide({ agent: agent(autonomy), action: POST, params: { channelId: RELEASES, text: 'Summary', projectId: 'p1' }, rating: actions.rating(POST), run });
        expect(verdict.decision).toBe(policy.DECISION.PROPOSE);
        const marker = taint.record(run);
        await expect(actions.perform({ companyId: C, actor, action: POST, params: { channelId: RELEASES, channelName: 'releases', text: 'Summary' }, taint: marker })).rejects.toMatchObject({ name: 'RefusedError' });
        await expect(actions.perform({ companyId: C, actor, action: POST, params: { channelId: RELEASES, channelName: 'releases', text: 'Summary' }, taint: marker, decision: { decision: 'act', reason: 'forced' } })).rejects.toMatchObject({ name: 'RefusedError' });
        expect(mockSlack.methods()).not.toContain('chat.postMessage');
    });

    it('its write outside the run\'s project is proposed, with the connector named in the reason', () => {
        const run = { projectId: 'p1', tainted: true, taintSources: [taint.connector('slack', RELEASES)] };
        const verdict = policy.decide({ agent: { autonomy: 3, projectIds: ['p1', 'p2'], allowedActions: [] }, action: 'task.comment', params: { taskId: 't9', body: 'x', projectId: 'p1' }, rating: actions.rating('task.comment'), run, targetProjectId: 'p2' });
        expect(verdict).toMatchObject({ decision: policy.DECISION.PROPOSE });
        expect(verdict.reason).toContain(`connector slack:${RELEASES}`);
    });

    it('the proposal it files carries the connector as its source and still needs an owner or admin', async () => {
        const run = await taint.mark(C, runRow(), [taint.connector('slack', RELEASES)]);
        const saved = await proposals.create(C, {
            agent: rows(SCHEMA_TYPE.AGENTS)[0], runId: RUN, projectId: 'p1', what: 'Post the summary', why: 'Asked for it.',
            changes: [{ action: POST, params: { channelId: RELEASES, text: 'Summary of the day.' } }], taint: taint.forProposal(run),
        });
        expect(saved).toMatchObject({ status: 'pending', gate: 'owner_admin', taint: { sources: [expect.objectContaining({ kind: 'connector', ref: `slack:${RELEASES}` })] } });
        const out = await proposals.approve(C, saved._id, { decider: { kind: 'human', userId: MEMBER }, isPrivileged: false, ip: '' });
        expect(out).toEqual({ error: 'This proposal needs an Owner or Admin.', status: 403 });
        expect(mockSlack.methods()).not.toContain('chat.postMessage');
    });
});

describe('no web fetch after a connector read', () => {
    beforeEach(() => connect());
    const PAGE = 'https://example.com/pricing';
    const inRun = (fn) => egressContext.run({ companyId: C, actor: OWNER }, fn);

    it('the same run fetches a page before the read and is refused after it', async () => {
        await inRun(async () => {
            await agentFetch.audit(PAGE);
            const fetched = mockSlack.web.length;
            expect(fetched).toBeGreaterThan(0);
            await read();
            await expect(agentFetch.audit(PAGE)).rejects.toMatchObject({ code: 'connector_read', deterministic: true });
            await expect(agentFetch.postJson('https://agent.example.com/hook', { body: '{}' })).rejects.toMatchObject({ code: 'connector_read' });
            await expect(agentFetch.readDeclared({ companyId: C, actor: OWNER, url: PAGE, declaredHosts: ['example.com'] })).rejects.toMatchObject({ code: 'connector_read' });
            expect(mockSlack.web).toHaveLength(fetched);
            expect((await read({ channel: 'random' })).channelId).toBe(RANDOM);
        });
    });

    it('says why in words a person can act on', async () => {
        await inRun(async () => {
            await read();
            await expect(agentFetch.audit(PAGE)).rejects.toThrow(/read from a connector \(slack\).*no web fetch/);
        });
    });

    it('a read that was refused took nothing in, so the run may still fetch', async () => {
        await inRun(async () => {
            await expect(read({ channel: 'general' })).rejects.toMatchObject({ code: 'channel_not_readable' });
            await agentFetch.audit(PAGE);
            expect(mockSlack.web.length).toBeGreaterThan(0);
        });
    });

    it('another run in the same workspace is not affected', async () => {
        await inRun(() => read());
        await inRun(() => agentFetch.audit(PAGE));
        expect(mockSlack.web.length).toBeGreaterThan(0);
    });

    it('a data skill that reads Slack and then a page stops at the page', async () => {
        process.env.SKILL_EXTERNAL_READS = 'on';
        const skill = compile({
            key: 'slack.then.web', name: 'Read then fetch', version: 1, inputs: [], emits: ['task.comment'], declaredHosts: ['example.com'],
            gather: [{ reader: READER, as: 'slack', params: { channel: 'releases' } }, { reader: 'url', as: 'page', params: { host: 'example.com', path: '/pricing' } }],
            prompt: { partials: [], instructions: '', template: '{{gather.slack.text}}', output: '{"summary":"..."}' },
            emit: [{ action: 'task.comment', params: { body: '{{answer.summary}}' } }],
        });
        await expect(inRun(() => skill.gather({ task: TASK, companyId: C, startedBy: OWNER, runId: RUN, actor, allowedActions: [] }))).rejects.toMatchObject({ code: 'connector_read' });
        expect(mockSlack.web).toHaveLength(0);
    });

    it('a later phase of a run that read a connector fetches nothing either', async () => {
        const spend = { companyId: C, userId: OWNER, runId: RUN, tainted: true, taintSources: [taint.connector('slack', RELEASES)] };
        const out = await orchestrator.analyse({ skillSlug: 'qa-review', task: TASK, context: { url: PAGE }, companyId: C, spend, agent: rows(SCHEMA_TYPE.AGENTS)[0] });
        expect(out.status).toBe('failed');
        expect(out.reason).toMatch(/read from a connector \(slack\)/);
        expect(mockSlack.web).toHaveLength(0);
    });

    it('a skill is refused at save time when a page read follows a Slack read, and accepted the other way round', () => {
        process.env.SKILL_EXTERNAL_READS = 'on';
        const slackStep = { reader: READER, as: 'slack', params: { channel: 'releases' } };
        const pageStep = { reader: 'url', as: 'page', params: { host: 'example.com', path: '/pricing' } };
        const doc = (gather) => ({
            key: 'slack.mix', name: 'Mix', inputs: [], gather,
            prompt: { template: '{{gather.slack.text}}', output: '{"summary":"..."}' },
            emit: [{ action: 'task.comment', params: { body: '{{answer.summary}}' } }],
        });
        expect((validateSkill(doc([slackStep, pageStep])).errors || []).map((e) => [e.field, e.code])).toEqual([['gather[1].reader', 'connector_then_fetch']]);
        expect(validateSkill(doc([pageStep, slackStep])).errors).toEqual([]);
    });
});

describe('the allow-list says read, post or both for each channel', () => {
    it('a channel allowed before reading existed stays post-only', async () => {
        await slack.saveSecrets(C, { botToken: TOKEN }, { id: OWNER });
        rows(T)[0].allowedChannels = [{ id: RELEASES, name: 'releases' }];
        expect((await call(ctrl.getSlack, OWNER)).body.data.allowedChannels).toEqual([{ id: RELEASES, name: 'releases', read: false, post: true }]);
        await expect(read()).rejects.toMatchObject({ code: 'channel_not_readable' });
        expect((await slackPostAdmit({ channelId: RELEASES, text: 'Hello' })).channelId).toBe(RELEASES);
    });

    it('a list of ids, as the first version of the screen sent it, allows posting only', async () => {
        await slack.saveSecrets(C, { botToken: TOKEN }, { id: OWNER });
        const out = await call(ctrl.setSlackChannels, ADMIN, { body: { channelIds: [RELEASES] } });
        expect(out.body.data.allowedChannels).toEqual([{ id: RELEASES, name: 'releases', read: false, post: true }]);
    });

    it('stores both ticks under Slack\'s own name for the channel, and drops a channel with neither', async () => {
        await slack.saveSecrets(C, { botToken: TOKEN }, { id: OWNER });
        const out = await call(ctrl.setSlackChannels, ADMIN, { body: { channels: [{ id: RELEASES, read: true, post: true, name: 'spoofed' }, { id: RANDOM, read: true, post: false }, { id: GENERAL, read: false, post: false }] } });
        expect(out.code).toBe(200);
        expect(out.body.data.allowedChannels).toEqual([{ id: RELEASES, name: 'releases', read: true, post: true }, { id: RANDOM, name: 'random', read: true, post: false }]);
        expect(rows(T)[0].allowedChannels).toEqual(out.body.data.allowedChannels);
        await settle();
        expect(rows(SCHEMA_TYPE.AUDIT_LOGS).find((a) => a.action === 'connector.channels_set').meta).toMatchObject({ read: [RELEASES, RANDOM], post: [RELEASES] });
    });

    it.each([
        ['a channel Slack never listed', [{ id: 'C0NOTLISTED', read: true, post: false }]],
        ['a tick that is not true or false', [{ id: RELEASES, read: 'yes', post: false }]],
        ['an entry with no id', [{ read: true, post: true }]],
        ['something that is not a list', { [RELEASES]: { read: true } }],
    ])('refuses %s and changes nothing', async (label, channels) => {
        await connect();
        const stored = JSON.stringify(rows(T)[0].allowedChannels);
        const out = await call(ctrl.setSlackChannels, OWNER, { body: { channels } });
        expect(out.code).toBe(400);
        expect(JSON.stringify(rows(T)[0].allowedChannels)).toBe(stored);
    });

    it('a message to a channel allowed for reading only is refused', async () => {
        await connect();
        await expect(slackPostAdmit({ channelId: RANDOM, text: 'Hello' })).rejects.toMatchObject({ code: 'channel_not_allowed' });
    });

    it('replacing the token or reading the list again keeps each channel\'s ticks', async () => {
        await connect();
        await slack.saveSecrets(C, { botToken: TOKEN }, { id: OWNER });
        const refreshed = await call(ctrl.refreshSlackChannels, OWNER);
        expect(refreshed.body.data.allowedChannels).toEqual([
            { id: RELEASES, name: 'releases', read: true, post: true }, { id: RANDOM, name: 'random', read: true, post: false }, { id: GENERAL, name: 'general', read: false, post: true },
        ]);
    });

    it.each([[MEMBER, 'a member'], [GUEST, 'a guest']])('%s cannot let agents read a channel (%s)', async (uid) => {
        await connect();
        const stored = JSON.stringify(rows(T));
        const out = await call(ctrl.setSlackChannels, uid, { body: { channels: [{ id: GENERAL, read: true, post: true }] } });
        expect(out.code).toBe(403);
        expect(JSON.stringify(rows(T))).toBe(stored);
    });

    it('an API token cannot either, even an owner\'s', async () => {
        await connect();
        const stored = JSON.stringify(rows(T));
        const out = await call(ctrl.setSlackChannels, OWNER, { body: { channels: [{ id: GENERAL, read: true, post: true }] }, apiToken: { _id: 'tok1', userId: OWNER } });
        expect(out.code).toBe(403);
        expect(JSON.stringify(rows(T))).toBe(stored);
    });
});

describe('with the connector off', () => {
    it.each([undefined, 'off'])('CONNECTORS=%s: no action, no reader, and a read is refused without asking Slack', async (value) => {
        await connect();
        if (value === undefined) delete process.env.CONNECTORS; else process.env.CONNECTORS = value;
        expect(registry.has(READ)).toBe(false);
        expect(actions.rating(READ)).toBeNull();
        expect(catalogues().readers.map((r) => r.key)).not.toContain(READER);
        expect(require('../Modules/Agents/skills').all().map((s) => s.slug)).not.toContain('slack.summary');
        await expect(read()).rejects.toMatchObject({ code: 'connector_off', deterministic: true });
        expect(mockSlack.calls).toHaveLength(0);
        const doc = { key: 'slack.read', name: 'Read', inputs: [], gather: [{ reader: READER, as: 'slack', params: { channel: 'releases' } }], prompt: { template: '{{gather.slack.text}}', output: '{}' }, emit: [{ action: 'task.comment', params: { body: 'x' } }] };
        expect((validateSkill(doc).errors || []).map((e) => e.code)).toContain('unknown_reader');
    });

    it('named but without taint routing, it stays off', async () => {
        await connect();
        delete process.env.AGENT_TAINT_ROUTING;
        expect(registry.has(READ)).toBe(false);
        await expect(read()).rejects.toMatchObject({ code: 'connector_off' });
        expect(mockSlack.calls).toHaveLength(0);
    });

    it('on: the read is a rated, read-only registry action offered to data skills and to no MCP client', () => {
        expect(registry.get(READ)).toMatchObject({ write: false, undoable: false });
        expect(actions.rating(READ)).toEqual({ write: false, reversible: true, scope: 'workspace', money: false });
        expect(actions.unrated()).toEqual([]);
        expect(catalogues().readers.find((r) => r.key === READER)).toMatchObject({ fields: ['channel', 'channelId', 'count', 'text', 'chars', 'truncated'] });
        expect(require('../Modules/Mcp/tools').actionsOffered()).not.toContain(READ);
    });
});

describe('nothing a channel said is kept', () => {
    it('is in no log line, audit row, run row, trace entry or connection row, whatever became of the read', async () => {
        await connect();
        const other = String(mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: AGENT_ID, status: 'running', projectId: 'p1', startedBy: OWNER })._id);
        const errors = [];
        await read();
        await read({ channel: 'general' }).catch((e) => errors.push(e.message));
        mockSlack.answers['conversations.history'] = { status: 429, headers: { 'retry-after': '5' }, body: `{"ok":false,"error":"ratelimited","echo":"${SAID[0]}"}` };
        await read().catch((e) => errors.push(e.message));
        mockSlack.answers['conversations.history'] = { body: { ok: false, error: `leak ${SAID[1]}`, messages: messages() } };
        await read({ channel: 'random' }, { runId: other }).catch((e) => errors.push(e.message));
        mockSlack.answers['conversations.history'] = new Error(`socket hang up near ${TOKEN}`);
        await read({ channel: 'random' }, { runId: other }).catch((e) => errors.push(e.message));
        await settle();

        expect(errors.map((e) => e.split(':')[0])).toEqual(['channel_not_readable', 'slack_failed', 'slack_failed', 'slack_failed']);
        expect(calls().map((a) => a.meta.state)).toEqual(['applied', 'refused', 'failed', 'failed', 'failed']);
        expect(calls().map((a) => a.meta.error)).toEqual([undefined, undefined, 'rate_limited', 'unknown_error', 'unreachable']);
        const everything = captured(errors, traceOf(), traceOf(other));
        SAID.forEach((line) => expect(everything).not.toContain(line));
        expect(everything).not.toContain(TOKEN);
        expect(everything).not.toContain(TOKEN.slice(5, 25));
    });

    it('the search above finds a line that is stored or logged', () => {
        mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { connectorReads: [{ text: SAID[0] }] });
        expect(captured().includes(SAID[0])).toBe(true);
        logger.info(`read ${SAID[1]}`);
        expect(captured().includes(SAID[1])).toBe(true);
    });
});

function slackPostAdmit(params) {
    return require('../Modules/Agents/connectors/slackPost').admit(C, params);
}
