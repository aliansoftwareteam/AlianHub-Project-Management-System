const crypto = require('crypto');
const verified = require('./fixtures/verifiedRequest');
const mockDb = require('./fixtures/fakeMongo').create();

/* The fake Slack: every call the server makes lands here, with the header that carried the token. */
const mockSlack = { calls: [], answers: {} };
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
    safeFetch: jest.fn(async (url, opts = {}) => {
        const method = String(url).split('/api/')[1];
        const form = Object.fromEntries(new URLSearchParams(opts.data || ''));
        mockSlack.calls.push({
            url: String(url), method, form, verb: opts.method, redirects: opts.maxRedirects,
            authorization: (opts.headers || {}).Authorization,
            workspace: (require('../Modules/Agents/engine/egressContext').get() || {}).companyId,
        });
        const answer = mockSlack.answers[method];
        if (answer instanceof Error) throw answer;
        const { status = 200, headers = {}, body } = typeof answer === 'function' ? answer(form) : answer;
        return { status, headers, body: typeof body === 'string' ? body : JSON.stringify(body), bytes: 0, hops: [] };
    }),
}));

const logger = require('../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const registry = require('../Modules/Agents/registry');
const actions = require('../Modules/Agents/actions');
const proposals = require('../Modules/Agents/proposals');
const memory = require('../Modules/Agents/memory');
const slack = require('../Modules/Agents/connectors/slackConnection');
const slackPost = require('../Modules/Agents/connectors/slackPost');
const ctrl = require('../Modules/Connectors/controller');
const routes = require('../Modules/Connectors/routes');
const integrations = require('../Modules/Integrations/controller');

const C = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000a01';
const ADMIN = '6f0000000000000000000a02';
const MEMBER = '6f0000000000000000000a03';
const GUEST = '6f0000000000000000000a04';
Object.assign(mockRoles, { [OWNER]: 1, [ADMIN]: 2, [MEMBER]: 3, [GUEST]: 0 });
const AGENT_ID = '6f0000000000000000000b01';
const TOKEN = `xoxb-${crypto.randomBytes(18).toString('hex')}`;
const NEW_TOKEN = `xoxb-${crypto.randomBytes(18).toString('hex')}`;
const SIGNING = crypto.randomBytes(16).toString('hex');
const RELEASES = 'C0RELEASES1';
const GENERAL = 'C0GENERAL01';
const ACTION = 'slack.message.post';
const TS = '1727780000.000100';
const T = SCHEMA_TYPE.CONNECTOR_CONNECTIONS;
const ENV = { CONNECTORS: 'slack', SECRETS_STORE: 'true', SECRETS_KEY: crypto.randomBytes(24).toString('hex'), AGENT_TAINT_ROUTING: 'on' };

const rows = (type) => mockDb.store[type] || [];
const posts = () => mockSlack.calls.filter((c) => c.method === 'chat.postMessage');
const settle = () => new Promise((resolve) => setImmediate(resolve));

const healthySlack = () => ({
    'auth.test': { body: { ok: true, team: 'Acme', team_id: 'T0ACME0001', user_id: 'U0BOT00001' } },
    'conversations.list': { body: { ok: true, channels: [{ id: RELEASES, name: 'releases', is_member: true }, { id: GENERAL, name: 'general', is_member: false }], response_metadata: { next_cursor: '' } } },
    'chat.postMessage': (form) => ({ body: { ok: true, ts: TS, channel: form.channel } }),
});

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

const connect = async () => {
    await slack.saveSecrets(C, { botToken: TOKEN, signingSecret: SIGNING }, { id: OWNER });
    await slack.setAllowedChannels(C, [RELEASES], { id: OWNER });
};
const agent = () => mockDb.store[SCHEMA_TYPE.AGENTS][0];
const propose = (params) => proposals.create(C, { agent: agent(), projectId: 'p1', what: 'Tell the team the release is out', why: 'The release task closed.', changes: [{ action: ACTION, params, label: 'A harmless comment' }] });
const approveAs = (id, uid) => proposals.approve(C, id, { decider: { kind: 'human', userId: uid }, isPrivileged: mockRoles[uid] === 1 || mockRoles[uid] === 2, ip: '' });
const proposalRow = (id) => rows(SCHEMA_TYPE.AGENT_PROPOSALS).find((p) => String(p._id) === String(id));

/* Everything the server wrote to the database, answered or logged in this test, as one text to search for a
 * secret. The writes are read from the calls, so a value that a later write removed is still found. */
const captured = (...extra) => JSON.stringify([
    mockDb.store,
    mockDb.calls.map((c) => c.data),
    [logger.info, logger.error, logger.warn, logger.debug].map((fn) => fn.mock.calls),
    extra,
]);

const before = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));

beforeEach(() => {
    Object.assign(process.env, ENV);
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    mockSlack.calls.length = 0;
    mockSlack.answers = healthySlack();
    jest.spyOn(memory, 'rememberApprovedChanges').mockResolvedValue([]);
    jest.spyOn(memory, 'preferenceCandidate').mockResolvedValue(null);
    mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: AGENT_ID, name: 'Release notes', ownerId: OWNER, autonomy: 3, projectIds: ['p1'], allowedActions: [], deletedStatusKey: 0 });
});

afterAll(() => {
    Object.keys(ENV).forEach((k) => { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; });
});

describe('connecting Slack', () => {
    it('checks the token with Slack, keeps it by handle and reads the channel list once', async () => {
        const out = await call(ctrl.saveSlackSecrets, OWNER, { body: { botToken: TOKEN, signingSecret: SIGNING } });
        expect(out.code).toBe(200);
        expect(mockSlack.calls.map((c) => c.method)).toEqual(['auth.test', 'conversations.list']);
        mockSlack.calls.forEach((c) => {
            expect(c.url.startsWith('https://slack.com/api/')).toBe(true);
            expect(c.authorization).toBe(`Bearer ${TOKEN}`);
            expect(c.workspace).toBe(C);
            expect(c.redirects).toBe(0);
        });
        expect(out.body.data).toMatchObject({
            connected: true, status: 'connected', team: { id: 'T0ACME0001', name: 'Acme' },
            secrets: { bot_token: { set: true }, signing_secret: { set: true } },
            channels: [{ id: GENERAL, name: 'general', member: false }, { id: RELEASES, name: 'releases', member: true }],
            allowedChannels: [],
        });
        expect(out.body.data.secrets.bot_token.setAt).toBeInstanceOf(Date);
        const [row] = rows(T);
        expect(Object.keys(row.secretHandles).sort()).toEqual(['bot_token', 'signing_secret']);
        expect(rows(SCHEMA_TYPE.SECRETS).map((s) => s.kind)).toEqual(['connector', 'connector']);
    });

    it('stores nothing when Slack refuses the token', async () => {
        mockSlack.answers['auth.test'] = { body: { ok: false, error: 'invalid_auth' } };
        const out = await call(ctrl.saveSlackSecrets, OWNER, { body: { botToken: TOKEN } });
        expect(out.code).toBe(400);
        expect(out.body).toMatchObject({ status: false, code: 'invalid_auth' });
        expect(rows(T)).toHaveLength(0);
        expect(rows(SCHEMA_TYPE.SECRETS)).toHaveLength(0);
    });

    it.each([['a token of the wrong shape', { botToken: 'xoxp-not-a-bot-token-000000000000' }], ['no token at all', {}]])('refuses %s without calling Slack', async (label, body) => {
        const out = await call(ctrl.saveSlackSecrets, OWNER, { body });
        expect(out.code).toBe(400);
        expect(mockSlack.calls).toHaveLength(0);
        expect(rows(T)).toHaveLength(0);
    });

    it('allows only channels Slack listed, under Slack\'s own name for them', async () => {
        await slack.saveSecrets(C, { botToken: TOKEN }, { id: OWNER });
        const unknown = await call(ctrl.setSlackChannels, ADMIN, { body: { channelIds: [RELEASES, 'C0NOTLISTED'] } });
        expect(unknown.code).toBe(400);
        expect(rows(T)[0].allowedChannels).toEqual([]);
        const ok = await call(ctrl.setSlackChannels, ADMIN, { body: { channelIds: [RELEASES] } });
        expect(ok.body.data.allowedChannels).toEqual([{ id: RELEASES, name: 'releases', read: false, post: true }]);
    });

    it('removing the bot token ends the connection and revokes the stored secret', async () => {
        await connect();
        const out = await call(ctrl.removeSlackSecret, OWNER, { params: { key: 'bot_token' } });
        expect(out.body.data).toMatchObject({ connected: false, channels: [], allowedChannels: [], secrets: { bot_token: { set: false }, signing_secret: { set: true } } });
        const kept = rows(T)[0].secretHandles;
        expect(Object.keys(kept)).toEqual(['signing_secret']);
        expect(rows(SCHEMA_TYPE.SECRETS).filter((s) => s.revokedAt)).toHaveLength(1);
        await expect(propose({ channelId: RELEASES, text: 'Hello' })).rejects.toMatchObject({ status: 400, code: 'not_connected' });
    });

    it('a connector secret is not rotated from the stored-secrets screen', async () => {
        await connect();
        const { rotateProblem } = require('../Modules/Secrets/helpers/rotateRules');
        const problem = await rotateProblem({ companyId: C, secret: { kind: 'connector', handle: rows(T)[0].secretHandles.bot_token }, value: NEW_TOKEN });
        expect(problem).toMatchObject({ statusCode: 409 });
    });
});

describe('who may manage the connection', () => {
    const attempts = [
        ['reads it', ctrl.getSlack, {}],
        ['saves a token', ctrl.saveSlackSecrets, { body: { botToken: NEW_TOKEN } }],
        ['removes the token', ctrl.removeSlackSecret, { params: { key: 'bot_token' } }],
        ['refreshes the channel list', ctrl.refreshSlackChannels, {}],
        ['changes the allow-list', ctrl.setSlackChannels, { body: { channelIds: [GENERAL] } }],
    ];

    it.each(attempts.flatMap(([what, handler, request]) => [[MEMBER, 'a member', what, handler, request], [GUEST, 'a guest', what, handler, request]]))(
        '%s (%s) is refused when it %s',
        async (uid, who, what, handler, request) => {
            await connect();
            mockSlack.calls.length = 0;
            const stored = JSON.stringify(rows(T));
            const out = await call(handler, uid, request);
            expect(out.code).toBe(403);
            expect(out.body).toEqual({ status: false, statusText: 'Only an owner or admin can manage connectors.' });
            expect(JSON.stringify(rows(T))).toBe(stored);
            expect(mockSlack.calls).toHaveLength(0);
        },
    );

    it.each(attempts)('an API token is refused when it %s, even an owner\'s', async (what, handler, request) => {
        await connect();
        mockSlack.calls.length = 0;
        const out = await call(handler, OWNER, { ...request, apiToken: { _id: 'tok1', userId: OWNER } });
        expect(out.code).toBe(403);
        expect(mockSlack.calls).toHaveLength(0);
    });

    it('a request for another workspace is refused', async () => {
        const r = res();
        await ctrl.getSlack(verified({ headers: { companyid: C }, aud: '6f0000000000000000000c99', uid: OWNER, body: {}, params: {}, query: {} }), r);
        expect(r.code).toBeGreaterThanOrEqual(400);
        expect(r.body.status).toBe(false);
    });

    it('lets an owner and an admin read it', async () => {
        await connect();
        for (const uid of [OWNER, ADMIN]) {
            // eslint-disable-next-line no-await-in-loop
            const out = await call(ctrl.getSlack, uid);
            expect(out.body).toMatchObject({ status: true, data: { connected: true, allowedChannels: [{ id: RELEASES, name: 'releases', read: false, post: true }] } });
        }
    });
});

describe('proposing a Slack message', () => {
    beforeEach(connect);

    it('stores the exact channel id, Slack\'s name for it and the text, and sends nothing', async () => {
        mockSlack.calls.length = 0;
        const saved = await propose({ channelId: '#Releases', text: '  Version 14.36 is out.\r\nThanks all.  ', taskId: 't1' });
        expect(saved.status).toBe('pending');
        expect(saved.gate).toBe('owner_admin');
        expect(saved.changes).toEqual([expect.objectContaining({
            action: ACTION, reversible: false, label: 'Post to #releases in Slack',
            params: { channelId: RELEASES, channelName: 'releases', text: 'Version 14.36 is out.\nThanks all.' },
        })]);
        expect(mockSlack.calls).toHaveLength(0);
    });

    it.each([
        ['a channel that is not on the allow-list', { channelId: GENERAL, text: 'Hello' }, 'channel_not_allowed'],
        ['a channel Slack never listed', { channelId: 'C0SOMEWHERE', text: 'Hello' }, 'channel_not_allowed'],
        ['no text', { channelId: RELEASES, text: '   ' }, 'text_required'],
        ['text that is too long', { channelId: RELEASES, text: 'x'.repeat(slackPost.MAX_TEXT + 1) }, 'text_too_long'],
        ['a whole-channel mention', { channelId: RELEASES, text: 'Wake up <!channel>' }, 'text_broadcast'],
        ['a file', { channelId: RELEASES, text: 'See attached', files: ['f1'] }, 'text_only'],
        ['blocks', { channelId: RELEASES, text: 'Hi', blocks: [{ type: 'section' }] }, 'text_only'],
    ])('refuses %s when the proposal is filed', async (label, params, code) => {
        mockSlack.calls.length = 0;
        await expect(propose(params)).rejects.toMatchObject({ status: 400, code });
        expect(rows(SCHEMA_TYPE.AGENT_PROPOSALS)).toHaveLength(0);
        expect(mockSlack.calls).toHaveLength(0);
    });
});

describe('nothing is posted without an approval', () => {
    beforeEach(connect);
    const actor = (uid) => ({ kind: 'agent', userId: uid, agentId: AGENT_ID, agentName: 'Release notes', viaAccount: 'workspace', tokenId: null });

    it.each([[OWNER, 'an owner\'s own agent'], [MEMBER, 'a member\'s agent']])('a direct call is refused (%s: %s), tainted run or not', async (uid) => {
        mockSlack.calls.length = 0;
        const params = { channelId: RELEASES, channelName: 'releases', text: 'Hello' };
        await expect(actions.perform({ companyId: C, actor: actor(uid), action: ACTION, params })).rejects.toMatchObject({ name: 'RefusedError' });
        await expect(actions.perform({ companyId: C, actor: actor(uid), action: ACTION, params, taint: { tainted: true, taintSources: [] } })).rejects.toMatchObject({ name: 'RefusedError' });
        await expect(actions.perform({ companyId: C, actor: actor(uid), action: ACTION, params, decision: { decision: 'act', reason: 'forced' } })).rejects.toMatchObject({ name: 'RefusedError' });
        expect(mockSlack.calls).toHaveLength(0);
    });

    it('a pending proposal sends nothing, and a declined one never does', async () => {
        mockSlack.calls.length = 0;
        const p = await propose({ channelId: RELEASES, text: 'Hello' });
        await proposals.decline(C, p._id, { decider: { kind: 'human', userId: OWNER }, ip: '' });
        expect(proposalRow(p._id).status).toBe('declined');
        expect(mockSlack.calls).toHaveLength(0);
    });

    it.each([[MEMBER, 'a member'], [GUEST, 'a guest']])('%s cannot approve it (%s)', async (uid) => {
        mockSlack.calls.length = 0;
        const p = await propose({ channelId: RELEASES, text: 'Hello' });
        const out = await approveAs(p._id, uid);
        expect(out).toEqual({ error: 'This proposal needs an Owner or Admin.', status: 403 });
        expect(proposalRow(p._id).status).toBe('pending');
        expect(mockSlack.calls).toHaveLength(0);
    });
});

describe('approving a Slack message', () => {
    beforeEach(connect);

    it('posts exactly what was approved, once, and records the message on the proposal and in the audit log', async () => {
        const p = await propose({ channelId: RELEASES, text: 'Version 14.36 is out.' });
        mockSlack.calls.length = 0;
        const out = await approveAs(p._id, ADMIN);
        expect(out.error).toBeUndefined();
        expect(posts()).toHaveLength(1);
        expect(mockSlack.calls).toHaveLength(1);
        expect(posts()[0]).toMatchObject({
            url: 'https://slack.com/api/chat.postMessage', verb: 'post', authorization: `Bearer ${TOKEN}`, workspace: C,
            form: { channel: RELEASES, text: 'Version 14.36 is out.', parse: 'none', link_names: 'false', unfurl_links: 'false', unfurl_media: 'false' },
        });
        const row = proposalRow(p._id);
        expect(row.status).toBe('approved');
        expect(row.delivery).toEqual([expect.objectContaining({ action: ACTION, ok: true, channelId: RELEASES, channelName: 'releases', ts: TS })]);
        await settle();
        const audit = rows(SCHEMA_TYPE.AUDIT_LOGS);
        const done = audit.find((a) => a.action === 'agent.action' && a.meta.action === ACTION);
        expect(done).toMatchObject({ entityType: 'slack_message', entityId: `${RELEASES}:${TS}`, entityName: '#releases', meta: { state: 'applied', params: { channelId: RELEASES, text: 'Version 14.36 is out.' } } });
        expect(audit.some((a) => a.action === 'agent.proposal_decided')).toBe(true);
        expect(rows(T)[0].lastPostAt).toBeInstanceOf(Date);
    });

    it('refuses again at apply time when the channel left the allow-list after the proposal was filed', async () => {
        const p = await propose({ channelId: RELEASES, text: 'Hello' });
        await slack.setAllowedChannels(C, [], { id: OWNER });
        mockSlack.calls.length = 0;
        const out = await approveAs(p._id, OWNER);
        expect(out.applied).toEqual([{ action: ACTION, ok: false, error: 'That Slack channel is not on the list agents may post to. An owner or an admin can add it on the Integrations screen.' }]);
        expect(mockSlack.calls).toHaveLength(0);
        expect(proposalRow(p._id)).toMatchObject({ status: 'approved', delivery: [expect.objectContaining({ ok: false, error: expect.stringContaining('list agents may post to') })] });
    });

    it('a stored proposal whose channel was changed by hand is refused at apply time', async () => {
        const p = await propose({ channelId: RELEASES, text: 'Hello' });
        proposalRow(p._id).changes[0].params.channelId = GENERAL;
        mockSlack.calls.length = 0;
        await approveAs(p._id, OWNER);
        expect(mockSlack.calls).toHaveLength(0);
        expect(proposalRow(p._id).delivery).toEqual([expect.objectContaining({ ok: false, channelId: GENERAL })]);
    });

    it('a token Slack no longer accepts breaks the connection, tells the admin, and is not tried again', async () => {
        const first = await propose({ channelId: RELEASES, text: 'One' });
        const second = await propose({ channelId: RELEASES, text: 'Two' });
        mockSlack.answers['chat.postMessage'] = { body: { ok: false, error: 'invalid_auth' } };
        mockSlack.calls.length = 0;
        await approveAs(first._id, OWNER);
        expect(posts()).toHaveLength(1);
        expect(proposalRow(first._id).delivery).toEqual([expect.objectContaining({ ok: false, error: 'slack: invalid_auth' })]);
        const seen = await call(ctrl.getSlack, ADMIN);
        expect(seen.body.data).toMatchObject({ status: 'broken', brokenReason: 'invalid_auth' });
        expect(seen.body.data.brokenAt).toBeInstanceOf(Date);

        await approveAs(second._id, OWNER);
        expect(posts()).toHaveLength(1);
        expect(proposalRow(second._id).delivery[0].error).toBe('slack: connection_broken_invalid_auth');
        const refresh = await call(ctrl.refreshSlackChannels, OWNER);
        expect(refresh.code).toBe(409);
        expect(mockSlack.calls).toHaveLength(1);
        await settle();
        const failed = rows(SCHEMA_TYPE.AUDIT_LOGS).find((a) => a.action === 'agent.action' && a.meta.state === 'failed');
        expect(failed.meta.failed).toBe('slack: invalid_auth');
        expect(rows(SCHEMA_TYPE.AUDIT_LOGS).some((a) => a.action === 'connector.broken')).toBe(true);

        mockSlack.answers = healthySlack();
        const replaced = await call(ctrl.saveSlackSecrets, OWNER, { body: { botToken: NEW_TOKEN } });
        expect(replaced.body.data).toMatchObject({ status: 'connected', brokenReason: '', allowedChannels: [{ id: RELEASES, name: 'releases', read: false, post: true }] });
        const third = await propose({ channelId: RELEASES, text: 'Three' });
        await approveAs(third._id, OWNER);
        expect(posts().pop().authorization).toBe(`Bearer ${NEW_TOKEN}`);
        expect(proposalRow(third._id).delivery).toEqual([expect.objectContaining({ ok: true, ts: TS })]);
    });

    it('a Slack rate limit is recorded with its wait and is not retried', async () => {
        const p = await propose({ channelId: RELEASES, text: 'Hello' });
        mockSlack.answers['chat.postMessage'] = { status: 429, headers: { 'retry-after': '30' }, body: { ok: false, error: 'ratelimited' } };
        mockSlack.calls.length = 0;
        await approveAs(p._id, OWNER);
        expect(posts()).toHaveLength(1);
        expect(proposalRow(p._id).delivery).toEqual([expect.objectContaining({ ok: false, error: 'slack: rate_limited, retry after 30s' })]);
        expect(rows(T)[0].status).toBe('connected');
    });

    it('a failure to reach Slack is recorded, and the connection is left as it was', async () => {
        const p = await propose({ channelId: RELEASES, text: 'Hello' });
        mockSlack.answers['chat.postMessage'] = new Error('slack.com is not on this workspace\'s egress allowlist');
        await approveAs(p._id, OWNER);
        expect(proposalRow(p._id).delivery[0]).toMatchObject({ ok: false, error: expect.stringContaining('unreachable') });
        expect(rows(T)[0].status).toBe('connected');
    });

    it('a secret revoked from the stored-secrets screen reads as not set, and nothing is posted', async () => {
        const p = await propose({ channelId: RELEASES, text: 'Hello' });
        await require('../Config/secrets').revoke({ companyId: C, handle: rows(T)[0].secretHandles.bot_token, actor: { id: OWNER } });
        mockSlack.calls.length = 0;
        await approveAs(p._id, OWNER);
        expect(mockSlack.calls).toHaveLength(0);
        expect(proposalRow(p._id).delivery[0].error).toBe('slack: token_unavailable');
        const seen = await call(ctrl.getSlack, OWNER);
        expect(seen.body.data).toMatchObject({ connected: false, secrets: { bot_token: { set: false, revoked: true } } });
    });
});

describe('the token never leaves the secrets store', () => {
    it('is in no response, log line, audit row, proposal or connection row, in any state', async () => {
        const responses = [];
        const errors = [];
        responses.push(await call(ctrl.saveSlackSecrets, OWNER, { body: { botToken: TOKEN, signingSecret: SIGNING } }));
        responses.push(await call(ctrl.setSlackChannels, OWNER, { body: { channelIds: [RELEASES] } }));
        responses.push(await call(ctrl.getSlack, ADMIN));
        responses.push(await call(ctrl.refreshSlackChannels, OWNER));
        responses.push(await call(ctrl.getSlack, MEMBER));
        responses.push(await call(integrations.listCatalog, MEMBER));

        const sent = await propose({ channelId: RELEASES, text: 'Sent' });
        responses.push(await approveAs(sent._id, OWNER));

        mockSlack.answers['chat.postMessage'] = { status: 429, headers: { 'retry-after': '5' }, body: `{"ok":false,"error":"ratelimited","echo":"${TOKEN}"}` };
        const limited = await propose({ channelId: RELEASES, text: 'Limited' });
        responses.push(await approveAs(limited._id, OWNER));

        mockSlack.answers['chat.postMessage'] = new Error(`connect failed for Authorization: Bearer ${TOKEN}`);
        const unreachable = await propose({ channelId: RELEASES, text: 'Unreachable' });
        responses.push(await approveAs(unreachable._id, OWNER));

        mockSlack.answers['chat.postMessage'] = { body: { ok: false, error: `leak ${TOKEN}` } };
        const odd = await propose({ channelId: RELEASES, text: 'Odd' });
        responses.push(await approveAs(odd._id, OWNER));

        mockSlack.answers['chat.postMessage'] = { body: { ok: false, error: 'token_revoked' } };
        const revoked = await propose({ channelId: RELEASES, text: 'Revoked' });
        responses.push(await approveAs(revoked._id, OWNER));
        responses.push(await call(ctrl.getSlack, OWNER));

        mockSlack.answers['auth.test'] = new Error(`socket hang up after sending Bearer ${NEW_TOKEN}`);
        responses.push(await call(ctrl.saveSlackSecrets, OWNER, { body: { botToken: NEW_TOKEN } }));
        mockDb.crud.mockImplementationOnce(async () => { throw new Error(`write failed near ${NEW_TOKEN}`); });
        const crashed = await call(ctrl.saveSlackSecrets, OWNER, { body: { botToken: NEW_TOKEN } });
        expect(crashed.body).toEqual({ status: false, statusText: 'Something went wrong.' });
        responses.push(crashed);
        await slack.saveSecrets(C, { botToken: 'not-a-token' }, { id: OWNER }).catch((e) => errors.push(e.message));
        responses.push(await call(ctrl.removeSlackSecret, OWNER, { params: { key: 'signing_secret' } }));
        responses.push(await call(ctrl.removeSlackSecret, OWNER, { params: { key: 'bot_token' } }));
        await settle();

        expect(mockSlack.calls.length).toBeGreaterThan(6);
        expect(rows(SCHEMA_TYPE.AUDIT_LOGS).length).toBeGreaterThan(8);
        expect(rows(SCHEMA_TYPE.AGENT_PROPOSALS)).toHaveLength(5);
        const everything = captured(responses.map((r) => r.body || r), errors);
        for (const secret of [TOKEN, NEW_TOKEN, SIGNING]) {
            expect(everything.includes(secret)).toBe(false);
            expect(everything.includes(secret.slice(5, 25))).toBe(false);
        }
        expect(everything).toContain('unreachable');
        expect(everything).toContain('[token]');
    });

    it('the search above finds a token that is stored in the clear, logged, or written and later removed', async () => {
        mockDb.seed(T, { connector: 'slack', leaked: TOKEN });
        expect(captured().includes(TOKEN)).toBe(true);
        logger.error(`posting with ${NEW_TOKEN}`);
        expect(captured().includes(NEW_TOKEN)).toBe(true);
        await mockDb.crud(C, { type: T, data: [{ connector: 'slack' }, { $set: { leaked: SIGNING } }] }, 'updateOne');
        await mockDb.crud(C, { type: T, data: [{ connector: 'slack' }, { $set: { leaked: '' } }] }, 'updateOne');
        expect(JSON.stringify(mockDb.store).includes(SIGNING)).toBe(false);
        expect(captured().includes(SIGNING)).toBe(true);
    });
});

describe('with the flag off', () => {
    const routesOf = () => {
        const seen = [];
        const app = Object.fromEntries(['get', 'post', 'put', 'delete'].map((verb) => [verb, (path) => seen.push(`${verb.toUpperCase()} ${path}`)]));
        routes.init(app);
        return seen;
    };

    it('registers the routes while the flag names slack', () => {
        expect(routesOf()).toEqual([
            'GET /api/v2/connectors/slack', 'PUT /api/v2/connectors/slack/secrets', 'DELETE /api/v2/connectors/slack/secrets/:key',
            'POST /api/v2/connectors/slack/channels/refresh', 'PUT /api/v2/connectors/slack/channels',
        ]);
    });

    it.each([undefined, 'off'])('CONNECTORS=%s: no route, no action, nothing in the catalogue, and a proposal is refused', async (value) => {
        await connect();
        if (value === undefined) delete process.env.CONNECTORS; else process.env.CONNECTORS = value;
        expect(routesOf()).toEqual([]);
        expect(registry.has(ACTION)).toBe(false);
        expect(registry.manifest().actions.map((a) => a.key)).not.toContain(ACTION);
        expect(require('../Modules/Agents/skills/catalogues').catalogues().actions.map((a) => a.key)).not.toContain(ACTION);
        const catalogue = await call(integrations.listCatalog, OWNER);
        expect(catalogue.body.connectors).toBeUndefined();
        mockSlack.calls.length = 0;
        await expect(propose({ channelId: RELEASES, text: 'Hello' })).rejects.toMatchObject({ status: 400 });
        const owner = await call(ctrl.getSlack, OWNER);
        expect(owner.code).toBe(404);
        expect((await call(ctrl.getSlack, MEMBER)).code).toBe(403);
        expect(mockSlack.calls).toHaveLength(0);
    });

    it('a proposal filed while the flag was on is not sent once it is off', async () => {
        await connect();
        const p = await propose({ channelId: RELEASES, text: 'Hello' });
        delete process.env.CONNECTORS;
        mockSlack.calls.length = 0;
        const out = await approveAs(p._id, OWNER);
        expect(mockSlack.calls).toHaveLength(0);
        expect(out.applied).toEqual([expect.objectContaining({ action: ACTION, ok: false })]);
    });

    it('named but without its preconditions: the screen is told why, and every route refuses', async () => {
        delete process.env.AGENT_TAINT_ROUTING;
        const catalogue = await call(integrations.listCatalog, MEMBER);
        expect(catalogue.body.connectors).toEqual(['slack']);
        const seen = await call(ctrl.getSlack, ADMIN);
        expect(seen.body).toMatchObject({ status: true, data: { on: false, problems: ['taint_routing_off'] } });
        expect(Object.keys(seen.body.data).sort()).toEqual(['on', 'problems']);
        expect((await call(ctrl.getSlack, MEMBER)).code).toBe(403);
        const out = await call(ctrl.saveSlackSecrets, OWNER, { body: { botToken: TOKEN } });
        expect(out.code).toBe(409);
        expect(out.body).toMatchObject({ status: false, problems: ['taint_routing_off'] });
        expect(out.body.statusText).toContain('AGENT_TAINT_ROUTING');
        expect((await call(ctrl.saveSlackSecrets, MEMBER, { body: { botToken: TOKEN } })).code).toBe(403);
        expect(mockSlack.calls).toHaveLength(0);
        expect(registry.has(ACTION)).toBe(false);
    });

    it('the catalogue names the connector and nothing more; its state is the owner\'s and admin\'s to read', async () => {
        const catalogue = await call(integrations.listCatalog, MEMBER);
        expect(catalogue.body.connectors).toEqual(['slack']);
        expect((await call(ctrl.getSlack, OWNER)).body.data).toMatchObject({ on: true, problems: [], connected: false });
    });
});

describe('a data skill may emit the action only while it is registered', () => {
    const { validateSkill } = require('../Modules/Agents/skills/validateSkill');
    const doc = () => ({
        key: 'release.announce', name: 'Announce a release', inputs: [], gather: [],
        prompt: { template: '{{TaskName}}', output: '{"summary":"..."}' },
        emit: [{ action: ACTION, params: { channelId: RELEASES, text: '{{answer.summary}}' } }],
    });

    it('accepts it with the flag on and asks for a channel and a text', () => {
        expect(validateSkill(doc()).errors || []).toEqual([]);
        const bare = doc();
        bare.emit[0].params = {};
        expect((validateSkill(bare).errors || []).map((e) => e.field)).toEqual(['emit[0].params.channelId', 'emit[0].params.text']);
    });

    it('refuses it with the flag off', () => {
        delete process.env.CONNECTORS;
        expect((validateSkill(doc()).errors || []).map((e) => e.code)).toContain('unknown_action');
    });
});
