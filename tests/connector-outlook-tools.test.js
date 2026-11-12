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
const { resolveConnection, markBackoff } = require('../Modules/Connectors/resolveConnection');
const connectorTools = require('../Modules/Connectors/tools');
const providerApi = require('../Modules/Connectors/providerApi');
const { validate } = require('../Modules/Connectors/validate');
const outlook = require('../Modules/Connectors/providers/outlook');
const readers = require('../Modules/Agents/skills/readers');
const registry = require('../Modules/Agents/registry');
const egressContext = require('../Modules/Agents/engine/egressContext');
const proposals = require('../Modules/Agents/proposals');
const writes = require('../Modules/Connectors/writes');
const mcpTools = require('../Modules/Mcp/tools');
const fakeMicrosoft = require('./fixtures/fakeMicrosoft');

/* The Outlook provider and its tools on a person's own Microsoft connection, reached from an agent run and from MCP,
 * against the fake Graph server. */

const C = '6f0000000000000000000c01';
const PRISHA = '6f0000000000000000000a01';
const ADMIN = '6f0000000000000000000a02';
const AGENT_ID = '6f0000000000000000000b01';
const PROJECT = '6f0000000000000000000e01';
const RUN = '6f0000000000000000000d01';
const MINE = 'conn-prisha-outlook';
const ENV = { CONNECTORS: 'outlook', AGENT_TAINT_ROUTING: 'on' };
const before = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
const ALL_SCOPES = Object.values(outlook.products).flat();
const ME = '/v1.0/me';

let fake;
const connected = (scopes = ALL_SCOPES) => resolveConnection.mockResolvedValue({ connectionId: MINE, scopes, getAccessToken: async () => fakeMicrosoft.TOKEN });
const actor = { kind: 'agent', userId: PRISHA, agentId: AGENT_ID, agentName: 'Digest', runId: RUN };
const agentRead = (key, input = {}) => egressContext.run({ companyId: C }, () => readers.read(key, C, { runId: RUN, actor, allowedActions: [] }, input));
const mcpCaller = (scopes) => ({
    companyId: C, userId: PRISHA, actor: { kind: 'agent', userId: PRISHA, agentName: 'Claude', viaAccount: 'external' },
    token: { oauth: true, scopes }, oauth: { clientId: 'client-1', grantId: 'grant-1' }, canWrite: true, allowedActions: [],
});
const mcpRead = (key, input = {}) => mcpTools.call(mcpCaller(['connectors:read']), key, input);
const mcpWrite = (key, input = {}) => mcpTools.call(mcpCaller(['connectors:write']), key, input);
const proposalRow = (id) => (mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS] || []).find((p) => String(p._id) === String(id));
const fromAgentRun = (action, params) => proposals.create(C, {
    agent: { _id: AGENT_ID, name: 'Digest' }, projectId: PROJECT, what: 'Do it', why: 'Asked', changes: [{ action, params }], connectionOwner: PRISHA,
});
const approveAs = (id, userId, extra = {}) => proposals.approve(C, id, { decider: { kind: 'human', userId }, isPrivileged: userId === ADMIN, ip: '', ...extra });
const approve = (id, extra) => approveAs(id, PRISHA, extra);
const lastCall = () => fake.state.calls[fake.state.calls.length - 1];
const sends = () => fake.state.calls.filter((call) => call.method !== 'get');

const REPLY = { messageId: 'AAMk-budget_1=', text: 'Friday works.\nSee you then.' };
const NEW_EVENT = { subject: 'Team lunch', start: '2026-11-05T13:00:00+05:30', end: '2026-11-05T14:00:00+05:30', location: 'Cafe', description: 'Bring the plan' };

beforeEach(() => {
    Object.assign(process.env, ENV);
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    fake = fakeMicrosoft.create();
    connected();
    safeFetch.mockImplementation(fake.fetch);
    markBackoff.mockImplementation(async ({ connectionId, until }) => mockDb.seed(SCHEMA_TYPE.CONNECTOR_CONNECTIONS, { _id: connectionId, backoffUntil: until }));
    mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { _id: RUN, status: 'running', connectorReads: [] });
    mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: AGENT_ID, name: 'Digest', allowedActions: [], autonomy: 3 });
});

afterAll(() => Object.entries(before).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; }));

describe('the Outlook provider definition', () => {
    it('passes the contract, with PKCE, no revoke endpoint and no scope that can send mail', () => {
        expect(validate(outlook)).toEqual([]);
        expect(outlook.auth.pkce).toBe('S256');
        expect(outlook.auth.revokeUrl).toBeUndefined();
        expect([...outlook.auth.baseScopes, ...ALL_SCOPES].filter((scope) => /send/i.test(scope))).toEqual([]);
        expect(outlook.products).toEqual({ mail: ['Mail.ReadWrite'], calendar: ['Calendars.ReadWrite'] });
    });

    it('asks Microsoft\'s common endpoint for offline access, the id token and the ticked products', () => {
        const url = new URL(providerApi.consentUrl({ definition: outlook, clientId: 'cid', redirectUri: 'https://pm.test/cb', scopes: ['openid', 'profile', 'offline_access', 'Mail.ReadWrite'], state: 's', challenge: 'c' }));
        expect(`${url.origin}${url.pathname}`).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
        expect(Object.fromEntries(url.searchParams)).toMatchObject({ scope: 'openid profile offline_access Mail.ReadWrite', code_challenge: 'c', code_challenge_method: 'S256', response_type: 'code' });
    });

    it.each([
        ['full Graph addresses', 'https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Calendars.ReadWrite openid profile'],
        ['another case', 'mail.readwrite calendars.readwrite OpenID Profile'],
        ['an encoded address', 'https%3A%2F%2Fgraph.microsoft.com%2Fmail.readwrite https%3A%2F%2Fgraph.microsoft.com%2Fcalendars.readwrite openid profile'],
    ])('stores the granted scopes in the form the tools name, from %s', (label, scope) => {
        expect(providerApi.scopesOf(providerApi.tokensOf(outlook, { access_token: 'a', scope }).scope)).toEqual(['Mail.ReadWrite', 'Calendars.ReadWrite', 'openid', 'profile']);
    });

    it('keeps a scope it does not know as Microsoft named it, without its Graph address', () => {
        expect(providerApi.tokensOf(outlook, { scope: 'https://graph.microsoft.com/User.Read email' }).scope).toBe('User.Read email');
        expect(providerApi.tokensOf(outlook, { access_token: 'a' })).toEqual({ access_token: 'a' });
    });

    it('names the account by tenant and object id from the id token, and its sign-in name', () => {
        const claims = (value) => ({ id_token: ['e30', Buffer.from(JSON.stringify(value)).toString('base64url'), 'sig'].join('.') });
        expect(outlook.readAccount({ tokenResponse: claims({ tid: 't1', oid: 'o1', sub: 's', preferred_username: 'prisha@contoso.test' }) })).toEqual({ id: 't1:o1', label: 'prisha@contoso.test' });
        expect(outlook.readAccount({ tokenResponse: claims({ tid: 't1', oid: 'o1', name: 'Prisha' }) })).toEqual({ id: 't1:o1', label: 'Prisha' });
        expect(() => outlook.readAccount({ tokenResponse: claims({ sub: 's' }) })).toThrow(/tenant and object id/);
        expect(() => outlook.readAccount({ tokenResponse: {} })).toThrow(/tenant and object id/);
    });

    it('treats a refused or interactive refresh as a dead grant, and anything else as passing', () => {
        expect(providerApi.isGrantRefused(outlook, 'invalid_grant')).toBe(true);
        expect(providerApi.isGrantRefused(outlook, 'interaction_required')).toBe(true);
        expect(providerApi.isGrantRefused(outlook, 'temporarily_unavailable')).toBe(false);
    });
});

describe('the Outlook tools', () => {
    const outlookTools = () => connectorTools.all().filter((tool) => tool.provider === 'outlook');

    it('load on the mail and calendar products, with labels in en.js for every tool and card row', () => {
        expect(outlookTools().map((tool) => tool.key)).toEqual(['outlook.mail.search', 'outlook.mail.read', 'outlook.calendar.events.list', 'outlook.mail.reply.draft', 'outlook.calendar.events.create']);
        expect(connectorTools.problemsOf(outlook, outlookTools())).toEqual([]);
        const en = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'locales', 'en.js'), 'utf8');
        outlookTools().forEach((tool) => expect(en).toContain(`${tool.label.replace('Connectors.tool.', '')}: "`));
        const source = fs.readFileSync(path.join(__dirname, '..', 'Modules', 'Connectors', 'providers', 'outlook', 'tools.js'), 'utf8');
        [...new Set(source.match(/Connectors\.card\.[A-Za-z]+/g))].forEach((key) => expect(en).toContain(`${key.replace('Connectors.card.', '')}: "`));
    });

    it('are reads and propose-only writes in the agent registry', () => {
        expect(registry.get('outlook.mail.reply.draft')).toMatchObject({ write: true, proposeOnly: true, gate: connectorTools.WRITE_GATE });
        expect(registry.get('outlook.calendar.events.create')).toMatchObject({ write: true, proposeOnly: true, gate: connectorTools.WRITE_GATE });
        expect(registry.get('outlook.mail.read')).toMatchObject({ write: false });
    });

    it('are offered only while CONNECTORS names outlook', () => {
        expect(mcpTools.names()).toEqual(expect.arrayContaining(['outlook.mail.search', 'outlook.mail.reply.draft']));
        process.env.CONNECTORS = 'google';
        expect(mcpTools.names()).not.toContain('outlook.mail.search');
        expect(registry.has('outlook.mail.reply.draft')).toBe(false);
    });
});

const READS = [
    ['outlook.mail.search', { query: 'budget' }, /from Ana Silva <ana@contoso.test>: Budget review \(unread, attachments\) \[id: AAMk-budget_1=\]/],
    ['outlook.mail.read', { messageId: 'AAMk-budget_1=' }, /^Subject: Budget review\nFrom: Ana Silva <ana@contoso.test>[\s\S]*Can we move the budget review to Friday\?/],
    ['outlook.calendar.events.list', { start: '2026-11-12T00:00:00Z', end: '2026-11-20T00:00:00Z' }, /2026-11-12 09:00 to 09:15 UTC: Standup at Room 4 \(organizer Ana Silva <ana@contoso.test>\) \[id: AAMkEv1=\]/],
];

describe.each(READS)('the read %s', (key, input, shows) => {
    it('answers an agent run on the person\'s own connection and marks the run', async () => {
        const out = await agentRead(key, input);
        expect(out.text).toMatch(shows);
        expect(resolveConnection).toHaveBeenCalledWith({ companyId: C, userId: PRISHA, provider: 'outlook' });
        expect(out.taint[0]).toMatchObject({ kind: 'connector', ref: expect.stringMatching(/^outlook:/) });
        expect(mockDb.store[SCHEMA_TYPE.AGENT_RUNS][0].connectorReads).toEqual([expect.objectContaining({ action: key, connector: 'outlook', state: 'applied' })]);
    });

    it('answers MCP', async () => {
        expect((await mcpRead(key, input)).text).toMatch(shows);
    });

    it('names the product to tick when its scope is missing, and never calls Graph', async () => {
        connected(['openid', 'profile', 'offline_access']);
        const { product } = connectorTools.get(key);
        expect(await mcpRead(key, input)).toEqual({ code: 'scope_missing', error: `Tick ${product} on your Outlook connection in My connections, then ask again.` });
        expect(safeFetch).not.toHaveBeenCalled();
    });

    it('only GETs, with the token only on Graph', async () => {
        await mcpRead(key, input);
        expect(sends()).toEqual([]);
        safeFetch.mock.calls.forEach(([url, opts]) => {
            expect(new URL(url).hostname).toBe('graph.microsoft.com');
            expect(opts.maxRedirects).toBe(0);
        });
    });
});

describe('outlook.mail.search', () => {
    it('searches every folder by relevance words, with only the fields it shows', async () => {
        const { text } = await mcpRead('outlook.mail.search', { query: 'budget', limit: 5 });
        expect(text.split('\n').filter((line) => line.startsWith('- '))).toHaveLength(2);
        expect(text).toContain('  Hi Prisha, Can we move the budget review to Friday?');
        const { url } = lastCall();
        expect(url.pathname).toBe(`${ME}/messages`);
        expect(url.searchParams.get('$search')).toBe('"budget"');
        expect(url.searchParams.get('$top')).toBe('5');
        expect(url.searchParams.get('$select')).not.toMatch(/\bbody\b/);
    });

    it('cannot close the search quotes early', async () => {
        await mcpRead('outlook.mail.search', { query: 'budget" OR "x\\' });
        expect(lastCall().url.searchParams.get('$search')).toBe('"budget OR x"');
    });

    it('lists the latest Inbox messages, newest first, when there is no query', async () => {
        const { text } = await mcpRead('outlook.mail.search');
        expect(text.split('\n').filter((line) => line.startsWith('- ')).map((line) => line.match(/\[id: (.+)\]$/)[1])).toEqual(['AAMk-budget_1=', 'AAMk-lunch_2']);
        expect(lastCall().url.pathname).toBe(`${ME}/mailFolders/inbox/messages`);
        expect(lastCall().url.searchParams.get('$orderby')).toBe('receivedDateTime desc');
    });

    it('says when nothing matches', async () => {
        expect((await mcpRead('outlook.mail.search', { query: 'zebra' })).text).toBe('No messages match that search.');
    });

    it('refuses more than its cap of messages before calling Graph', async () => {
        await expect(mcpRead('outlook.mail.search', { limit: 26 })).rejects.toThrow(/limit/);
        expect(safeFetch).not.toHaveBeenCalled();
    });
});

describe('outlook.mail.read', () => {
    it('hands the model the words of an HTML body: no markup, script, style, comment or link', async () => {
        const { text } = await mcpRead('outlook.mail.read', { messageId: 'AAMk-budget_1=' });
        const body = text.split('\n\n').slice(1).join('\n\n');
        expect(body).toBe('Hi Prisha,\nCan we move the budget review to Friday?\nCosts are up 5% & travel <> plan.\nThanks, Ana!');
        expect(text).not.toMatch(/<\/?(html|head|title|style|p|b|br|script|a|img)\b|track\.example|alert|color: red|tracking/);
        expect(text).toContain('To: Prisha Shah <prisha@contoso.test>\nCc: Sam Lee <sam@contoso.test>\nReceived: 2026-11-10 09:30 UTC\nAttachments: yes, not read here');
    });

    it('reads a plain-text body as it is', async () => {
        expect((await mcpRead('outlook.mail.read', { messageId: 'AAMk-lunch_2' })).text).toMatch(/\n\nLunch on Thursday\?\nSam$/);
    });

    it('caps a long body at the read\'s limit and says it was cut', async () => {
        fake.state.messages[1].body.content = 'word '.repeat(5000);
        const out = await mcpRead('outlook.mail.read', { messageId: 'AAMk-lunch_2' });
        expect(out.chars).toBe(connectorTools.get('outlook.mail.read').caps.maxChars);
        expect(out.truncated).toBe(true);
    });

    it('keeps the message id inside its URL path', async () => {
        await mcpRead('outlook.mail.read', { messageId: 'a/b+c=' });
        expect(lastCall().url.pathname).toBe(`${ME}/messages/a%2Fb%2Bc%3D`);
        await expect(mcpRead('outlook.mail.read', { messageId: '../events' })).rejects.toThrow(/messageId is not in the form/);
    });

    it('turns Graph\'s not found into a refusal, not an answer', async () => {
        expect(await mcpRead('outlook.mail.read', { messageId: 'gone' })).toEqual({ code: 'provider_refused', error: 'Outlook answered 404, so this did not go through.' });
    });
});

describe('outlook.calendar.events.list', () => {
    it('reads from now to a week ahead unless told otherwise, oldest first', async () => {
        await mcpRead('outlook.calendar.events.list');
        const q = lastCall().url.searchParams;
        expect(lastCall().url.pathname).toBe(`${ME}/calendarView`);
        const from = new Date(q.get('startDateTime')).getTime();
        expect(from).toBeLessThanOrEqual(Date.now());
        expect(new Date(q.get('endDateTime')).getTime() - from).toBe(7 * 24 * 3600 * 1000);
        expect(q.get('$orderby')).toBe('start/dateTime');
    });

    it('shows an all-day event by its days and a cancelled one as cancelled', async () => {
        const { text } = await mcpRead('outlook.calendar.events.list', { start: '2026-11-12T00:00:00Z', end: '2026-11-20T00:00:00Z' });
        expect(text).toContain('- 2026-11-13 to 2026-11-14, all day: Offsite (organizer Prisha Shah <prisha@contoso.test>) [id: AAMkEv2=]');
        expect(text).toContain('Vendor call at Teams (organizer Sam Lee <sam@contoso.test>) (cancelled) [id: AAMkEv3=]');
        expect(text.indexOf('Standup')).toBeLessThan(text.indexOf('Vendor call'));
    });

    it('sends the window in UTC and its limit', async () => {
        await mcpRead('outlook.calendar.events.list', { start: '2026-11-12T05:30:00+05:30', end: '2026-11-13T00:00:00Z', limit: 1 });
        const q = lastCall().url.searchParams;
        expect(q.get('startDateTime')).toBe('2026-11-12T00:00:00.000Z');
        expect(q.get('$top')).toBe('1');
    });

    it('refuses a window that ends before it starts, without calling Graph', async () => {
        expect(await mcpRead('outlook.calendar.events.list', { start: '2026-11-12T00:00:00Z', end: '2026-11-11T00:00:00Z' })).toEqual({ code: 'bad_input', error: 'The end of the window must come after its start.' });
        expect(safeFetch).not.toHaveBeenCalled();
    });

    it('refuses a time without its offset', async () => {
        await expect(mcpRead('outlook.calendar.events.list', { start: '2026-11-12 10:00' })).rejects.toThrow(/start is not in the form/);
    });
});

const WRITES = [
    ['outlook.mail.reply.draft', REPLY, () => fake.state.drafts.find((d) => d.replyTo === 'AAMk-budget_1='), /^Saved a draft reply to Ana Silva <ana@contoso.test> in your Outlook Drafts; nothing was sent\./],
    ['outlook.calendar.events.create', NEW_EVENT, () => fake.state.events.find((e) => e.subject === 'Team lunch'), /^Created event AAMkEv4= on your Outlook calendar/],
];

describe.each(WRITES)('the write %s', (key, input, madeInOutlook, answer) => {
    it('from an agent run waits for its owner, then goes out once and sends nothing', async () => {
        const p = await fromAgentRun(key, input);
        expect(p).toMatchObject({ status: 'pending', gate: 'connection_owner', connectionOwner: PRISHA });
        expect(safeFetch).not.toHaveBeenCalled();
        const id = p.proposalId || p._id;
        const out = await approve(id);
        expect(out.applied).toEqual([expect.objectContaining({ action: key, ok: true })]);
        expect(madeInOutlook()).toBeTruthy();
        expect(proposalRow(id).delivery[0].answer).toMatch(answer);
        expect(sends()).toHaveLength(1);
        expect(fake.state.sent).toEqual([]);
    });

    it('from MCP waits in the Inbox until its owner approves', async () => {
        const { proposalId } = await mcpWrite(key, input);
        expect(safeFetch).not.toHaveBeenCalled();
        expect(proposalRow(proposalId)).toMatchObject({ status: 'pending', connectionOwner: PRISHA });
        await approve(proposalId);
        expect(madeInOutlook()).toBeTruthy();
        expect(fake.state.sent).toEqual([]);
    });

    it('cannot be approved by anyone but the connection\'s owner, an admin included', async () => {
        const { proposalId } = await mcpWrite(key, input);
        expect(await approveAs(proposalId, ADMIN)).toMatchObject({ status: 403, error: writes.REFUSAL.NOT_OWNER });
        expect(safeFetch).not.toHaveBeenCalled();
        expect(proposalRow(proposalId).status).toBe('pending');
    });

    it('is not sent a second time from the same approval', async () => {
        const { proposalId } = await mcpWrite(key, input);
        await approve(proposalId);
        await approve(proposalId);
        expect(sends()).toHaveLength(1);
    });

    it('names the product to tick when its scope is missing', async () => {
        connected(['openid']);
        const { product } = connectorTools.get(key);
        expect(await mcpWrite(key, input)).toEqual({ code: 'scope_missing', error: `Tick ${product} on your Outlook connection in My connections, then ask again.` });
    });
});

describe('outlook.mail.reply.draft', () => {
    it('shows the whole reply on its card and goes to Drafts, never to /send', async () => {
        const { proposalId } = await mcpWrite('outlook.mail.reply.draft', REPLY);
        const { card } = proposalRow(proposalId).changes[0];
        expect(card).toMatchObject({ target: '', targetLabel: 'Connectors.card.outlookDrafts', text: REPLY.text });
        expect(card.rows).toEqual([
            { label: 'Connectors.card.replyToMessage', value: 'AAMk-budget_1=' },
            { label: 'Connectors.card.replyAll', valueLabel: 'Connectors.card.no' },
        ]);
        await approve(proposalId);
        expect(lastCall()).toMatchObject({ method: 'post', body: { comment: 'Friday works.<br>See you then.' } });
        expect(lastCall().url.pathname).toBe(`${ME}/messages/AAMk-budget_1%3D/createReply`);
        expect(fake.state.calls.some((call) => /send/i.test(call.url.pathname))).toBe(false);
    });

    it('replies to everyone when asked, and says so on the card', async () => {
        const { proposalId } = await mcpWrite('outlook.mail.reply.draft', { ...REPLY, replyAll: true });
        expect(proposalRow(proposalId).changes[0].card.rows).toContainEqual({ label: 'Connectors.card.replyAll', valueLabel: 'Connectors.card.yes' });
        await approve(proposalId);
        expect(lastCall().url.pathname).toMatch(/\/createReplyAll$/);
        expect(proposalRow(proposalId).delivery[0].answer).toMatch(/to Ana Silva <ana@contoso.test>, Sam Lee <sam@contoso.test> in your Outlook Drafts/);
    });

    it('puts markup in the reply into the draft as text, so no image or link can ride in', async () => {
        const { proposalId } = await mcpWrite('outlook.mail.reply.draft', { ...REPLY, text: 'See <img src="https://x.test/p.png"> & <a href="https://x.test">this</a>' });
        await approve(proposalId);
        expect(fake.state.drafts[0].comment).toBe('See &lt;img src=&quot;https://x.test/p.png&quot;&gt; &amp; &lt;a href=&quot;https://x.test&quot;&gt;this&lt;/a&gt;');
    });

    it.each([['blank', '   '], ['a control character', 'Hi\u0007']])('is not filed with %s text', async (label, text) => {
        expect(await mcpWrite('outlook.mail.reply.draft', { ...REPLY, text })).toMatchObject({ code: 'bad_input' });
        expect(mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS] || []).toEqual([]);
    });

    it('shows an edit again before it is saved, then saves exactly the edited text', async () => {
        const p = await fromAgentRun('outlook.mail.reply.draft', REPLY);
        const proposalId = p.proposalId || p._id;
        expect(await approve(proposalId, { changes: [{ action: 'outlook.mail.reply.draft', params: { ...REPLY, text: 'Friday at 10 works.' } }] })).toMatchObject({ reshown: true, applied: [] });
        expect(sends()).toEqual([]);
        await approve(proposalId, { revision: proposalRow(proposalId).revision });
        expect(fake.state.drafts.map((d) => d.comment)).toEqual(['Friday at 10 works.']);
    });

    it('reports Graph\'s refusal as not delivered', async () => {
        const { proposalId } = await mcpWrite('outlook.mail.reply.draft', { ...REPLY, messageId: 'gone' });
        const out = await approve(proposalId);
        expect(out.applied).toEqual([expect.objectContaining({ ok: false })]);
        expect(proposalRow(proposalId).delivery[0]).toMatchObject({ ok: false, error: 'Outlook answered 404, so this did not go through.' });
    });
});

describe('outlook.calendar.events.create', () => {
    it('sends what the card shows, in UTC, and invites nobody', async () => {
        const { proposalId } = await mcpWrite('outlook.calendar.events.create', NEW_EVENT);
        const { card } = proposalRow(proposalId).changes[0];
        expect(card).toMatchObject({ target: '', targetLabel: 'Connectors.card.outlookCalendar', title: 'Team lunch', text: 'Bring the plan' });
        expect(card.rows).toEqual([
            { label: 'Connectors.card.start', value: NEW_EVENT.start },
            { label: 'Connectors.card.end', value: NEW_EVENT.end },
            { label: 'Connectors.card.where', value: 'Cafe' },
            { label: 'Connectors.card.attendees', valueLabel: 'Connectors.card.nobody' },
        ]);
        await approve(proposalId);
        expect(lastCall().url.pathname).toBe(`${ME}/events`);
        expect(lastCall().body).toEqual({
            subject: 'Team lunch',
            body: { contentType: 'text', content: 'Bring the plan' },
            location: { displayName: 'Cafe' },
            start: { dateTime: '2026-11-05T07:30:00', timeZone: 'UTC' },
            end: { dateTime: '2026-11-05T08:30:00', timeZone: 'UTC' },
        });
    });

    it('leaves out what it was not given', async () => {
        const { proposalId } = await mcpWrite('outlook.calendar.events.create', { subject: 'Focus', start: '2026-11-05T09:00:00Z', end: '2026-11-05T10:00:00Z' });
        expect(proposalRow(proposalId).changes[0].card.rows.map((row) => row.label)).toEqual(['Connectors.card.start', 'Connectors.card.end', 'Connectors.card.attendees']);
        await approve(proposalId);
        expect(Object.keys(lastCall().body).sort()).toEqual(['end', 'start', 'subject']);
    });

    it('has no attendees field to invite anyone with', async () => {
        await expect(mcpWrite('outlook.calendar.events.create', { ...NEW_EVENT, attendees: 'sam@contoso.test' })).rejects.toThrow(/attendees/);
        expect(mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS] || []).toEqual([]);
    });

    it('is not filed when it ends before it starts', async () => {
        expect(await mcpWrite('outlook.calendar.events.create', { ...NEW_EVENT, end: NEW_EVENT.start })).toEqual({ code: 'bad_input', error: 'An event must end after it starts.' });
        expect(mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS] || []).toEqual([]);
    });
});

describe('when Graph says slow down, or a run has read enough', () => {
    it('a 429 holds the connection, and the next call never reaches Graph', async () => {
        fake.state.next = fakeMicrosoft.answer(429, { error: { code: 'TooManyRequests' } }, { 'retry-after': '30' });
        expect(await mcpRead('outlook.mail.search')).toMatchObject({ code: 'provider_busy' });
        expect(markBackoff).toHaveBeenCalledWith(expect.objectContaining({ connectionId: MINE }));
        const calls = fake.state.calls.length;
        expect(await mcpRead('outlook.calendar.events.list')).toMatchObject({ code: 'provider_busy' });
        expect(fake.state.calls).toHaveLength(calls);
    });

    it('stops an agent run after its connector read cap, without calling Graph again', async () => {
        const { RUN: CAP } = require('../Modules/Agents/connectors/readLimits');
        for (let i = 0; i < CAP.CALLS; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await agentRead('outlook.mail.search');
        }
        const calls = fake.state.calls.length;
        await expect(agentRead('outlook.mail.read', { messageId: 'AAMk-lunch_2' })).rejects.toMatchObject({ code: 'run_call_cap' });
        expect(fake.state.calls).toHaveLength(calls);
    });

    it('never sends the token anywhere but Graph, and keeps it out of what it stores', async () => {
        const { proposalId } = await mcpWrite('outlook.mail.reply.draft', REPLY);
        await approve(proposalId);
        await agentRead('outlook.mail.read', { messageId: 'AAMk-budget_1=' });
        safeFetch.mock.calls.forEach(([url]) => expect(new URL(url).hostname).toBe('graph.microsoft.com'));
        expect(fake.state.web).toEqual([]);
        expect(JSON.stringify(mockDb.store)).not.toContain(fakeMicrosoft.TOKEN);
    });
});
