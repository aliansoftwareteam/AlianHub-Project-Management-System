const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn(), recordAuditFromReq: jest.fn() }));
jest.mock('../Modules/Agents/permissions', () => ({ holderMay: jest.fn(async () => ({ allowed: true, reason: '', permission: null })), REASON: 'permission_denied' }));
jest.mock('../Modules/Agents/engine/graph', () => ({ resumeGraph: jest.fn(async () => ({ resumed: false })) }));
jest.mock('../Modules/AICore/persistence', () => {
    const deleteThread = jest.fn(async () => {});
    return { deleteThread, saverFor: jest.fn(() => ({ deleteThread })), storeFor: jest.fn(() => { throw new Error('no store in this suite'); }), ready: jest.fn(async () => {}) };
});
jest.mock('../Modules/Connectors/tools', () => {
    const real = jest.requireActual('../Modules/Connectors/tools');
    return { ...real, ...real.make(require('path').join(__dirname, 'fixtures', 'connectors-chat')) };
});
jest.mock('../Modules/Connectors/resolveConnection', () => ({ resolveConnection: jest.fn(), markBroken: jest.fn(async () => {}), markBackoff: jest.fn(async () => {}), recordHealth: jest.fn(async () => {}) }));
jest.mock('../Modules/Agents/engine/safeFetch', () => ({
    ...jest.requireActual('../Modules/Agents/engine/safeFetch'),
    safeFetch: jest.fn(),
}));
jest.mock('../Modules/AICore/llmProvider', () => ({ ...jest.requireActual('../Modules/AICore/llmProvider'), getProvider: jest.fn(), isAnyProviderConfigured: jest.fn(() => true) }));
jest.mock('../Modules/Agents/scope', () => ({ ...jest.requireActual('../Modules/Agents/scope'), visibleProjects: jest.fn(async () => []) }));
jest.mock('../Config/permissionGuard', () => ({ ...jest.requireActual('../Config/permissionGuard'), getRoleType: jest.fn(async () => 3) }));
jest.mock('../Modules/Knowledge/flag', () => ({ enabledFor: jest.fn(async () => false) }));
jest.mock('../Modules/Knowledge/askSources', () => ({ askSources: jest.fn(async () => []) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { safeFetch } = require('../Modules/Agents/engine/safeFetch');
const { resolveConnection } = require('../Modules/Connectors/resolveConnection');
const { recordAudit } = require('../Modules/Audit/recorder');
const { getProvider } = require('../Modules/AICore/llmProvider');
const { visibleProjects } = require('../Modules/Agents/scope');
const egressContext = require('../Modules/Agents/engine/egressContext');
const agentFetch = require('../Modules/Agents/engine/agentFetch');
const proposals = require('../Modules/Agents/proposals');
const askConnectors = require('../Modules/AI/askConnectors');
const { askStream } = require('../Modules/AI/askStream');

/* The AI chat reads a connected app through the asker's own connection: a pull request reference by rule, anything
 * else by one model pick held to the app's turned-on tools; a change waits in the asker's Inbox. */

const C = '6f0000000000000000000c07';
const PRISHA = '6f0000000000000000000a07';
const OTHER = '6f0000000000000000000a08';
const OPS = '6f0000000000000000000e07';
const PR_LINK = 'https://github.com/acme/web/pull/482';
const ENV = { CONNECTORS: 'github,fake,notesmcp', AGENT_TAINT_ROUTING: 'on', JWT_SECRET: 'ask-connectors-test-secret' };
const before = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
const SCOPES = Object.freeze({ github: ['repo'], fake: ['notes.read', 'notes.write'], notesmcp: [] });

const connectorError = (code, provider) => Object.assign(new Error(code), { name: 'ConnectorError', code, provider });

const answers = (url) => {
    const { hostname, pathname } = new URL(url);
    if (hostname === 'api.github.test' && pathname === '/repos/acme/web/pulls/482') return { status: 200, headers: {}, body: JSON.stringify({ number: 482, title: 'Fix login', state: 'open', checks: 'passing' }) };
    if (hostname === 'api.fake.test' && pathname === '/notes') return { status: 200, headers: {}, body: JSON.stringify({ notes: [{ title: 'Board meeting' }, { title: 'Call the bank' }], id: 'n-1' }) };
    return { status: 404, headers: {}, body: '' };
};

/* The model as both steps meet it: a JSON pick when asked for one, and the answer otherwise. */
const model = ({ pick = { calls: [] }, answer = 'Done.', during = async () => {} } = {}) => {
    const chat = jest.fn(async (opts) => {
        if (opts.jsonMode) return { content: typeof pick === 'string' ? pick : JSON.stringify(pick), totalTokens: 10, model: 'm-1' };
        await during(opts);
        return { content: answer, totalTokens: 20, model: 'm-1' };
    });
    getProvider.mockReturnValue({ chat });
    return chat;
};
const picks = (chat) => chat.mock.calls.filter(([opts]) => opts.jsonMode);

const step = (question, apps, extra = {}) => egressContext.run({ companyId: C, actor: PRISHA }, () => askConnectors.readStep({ companyId: C, userId: PRISHA, question, apps, ...extra }));
const posts = () => safeFetch.mock.calls.filter(([, options]) => options.method === 'post');
const proposalRows = () => mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS] || [];
const usageRows = () => mockDb.store[SCHEMA_TYPE.CONNECTOR_USAGE] || [];
const callAudits = () => recordAudit.mock.calls.map(([, row]) => row).filter((row) => row.action === 'connector.call');

const jsonRes = () => {
    const res = { statusCode: 200 };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.send = jest.fn((body) => { res.body = body; return res; });
    return res;
};
const sseRes = () => {
    const res = jsonRes();
    const listeners = {};
    Object.assign(res, {
        headers: {},
        chunks: [],
        setHeader: (key, value) => { res.headers[key.toLowerCase()] = value; },
        flushHeaders: jest.fn(),
        write: jest.fn((chunk) => { res.chunks.push(String(chunk)); return true; }),
        end: jest.fn(() => (listeners.close || []).forEach((fn) => fn())),
        on: (event, fn) => { (listeners[event] = listeners[event] || []).push(fn); return res; },
    });
    return res;
};
const doneOf = (res) => res.chunks.join('').split('\n\n').filter((block) => block.startsWith('data: ')).map((block) => JSON.parse(block.slice(6))).find((e) => e.event === 'done');
const ask = async (body, extra = {}) => {
    const res = sseRes();
    await askStream({ headers: { companyid: C }, uid: PRISHA, params: {}, query: {}, body, ...extra }, res);
    return res;
};

beforeEach(() => {
    Object.assign(process.env, ENV);
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    safeFetch.mockImplementation(async (url) => answers(url));
    resolveConnection.mockImplementation(async ({ provider }) => ({ connectionId: `conn-${provider}`, scopes: SCOPES[provider], getAccessToken: async () => `${provider}-token` }));
    visibleProjects.mockResolvedValue([]);
    model();
});

afterAll(() => Object.entries(before).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; }));

describe('which apps a question names', () => {
    it('keeps each connector chip of a provider once, and drops anything else without a word', () => {
        expect(askConnectors.appsAsked([
            { kind: 'connector', id: 'github' },
            { kind: 'connector', id: 'github' },
            { kind: 'connector', id: 'fake' },
            { kind: 'connector', id: 'jira' },
            { kind: 'connector', id: 'GitHub' },
            { kind: 'connector', id: { $ne: null } },
            { kind: 'task', id: 'notesmcp' },
        ])).toEqual(['github', 'fake']);
        expect(askConnectors.appsAsked(undefined)).toEqual([]);
    });
});

describe('the pull request rule', () => {
    it('finds a pull request by its link, as owner/repo#123 and as "PR 482 in owner/repo"', () => {
        expect(askConnectors.pullRequestsIn(`status of ${PR_LINK}?`)).toEqual([{ owner: 'acme', repo: 'web', pullNumber: 482 }]);
        expect(askConnectors.pullRequestsIn('is acme/web#482 merged, and acme/api#7.')).toEqual([{ owner: 'acme', repo: 'web', pullNumber: 482 }, { owner: 'acme', repo: 'api', pullNumber: 7 }]);
        expect(askConnectors.pullRequestsIn("what's the status of PR 482 in acme/web")).toEqual([{ owner: 'acme', repo: 'web', pullNumber: 482 }]);
        expect(askConnectors.pullRequestsIn(`${PR_LINK} and acme/web#482`)).toHaveLength(1);
        expect(askConnectors.pullRequestsIn('the roadmap page in Notion')).toEqual([]);
    });

    it('reads the pull request on the asker\'s own GitHub with no model call, and makes it a source', async () => {
        const chat = model();
        const out = await step(`what's the status of ${PR_LINK}?`, ['github']);
        expect(chat).not.toHaveBeenCalled();
        expect(resolveConnection).toHaveBeenCalledWith({ companyId: C, userId: PRISHA, provider: 'github' });
        const [url, options] = safeFetch.mock.calls[0];
        expect(url).toBe('https://api.github.test/repos/acme/web/pulls/482');
        expect(options.headers.Authorization).toBe('Bearer github-token');
        expect(out.sources).toEqual([expect.objectContaining({
            kind: 'connector', ref: 'github:1', project: 'GitHub', title: 'acme · web · 482', detail: '#482 Fix login: open, checks passing', tool: 'github.pull_request.read',
        })]);
        expect(out.sources[0].id).toMatch(/^github:[0-9a-f]{16}$/);
        expect(out.notes).toEqual([]);
    });

    it('is counted against the asker\'s own reads and audited as the chat', async () => {
        await step(`status of ${PR_LINK}`, ['github']);
        expect(usageRows()).toEqual([expect.objectContaining({ connectionId: 'conn-github', userId: PRISHA, reads: 1, actor: { type: 'chat', id: 'ask' } })]);
        expect(callAudits()).toEqual([expect.objectContaining({ actorId: PRISHA, meta: expect.objectContaining({ action: 'github.pull_request.read', phase: 'read', via: 'chat', callerId: 'ask', state: 'applied' }) })]);
    });

    it('is not applied while the tool is not turned on: the app is said to be off and nothing is read', async () => {
        process.env.CONNECTORS = 'fake';
        const chat = model();
        const out = await step(`status of ${PR_LINK}`, ['github']);
        expect(out.notes).toEqual([{ provider: 'github', app: 'GitHub', code: 'provider_off', text: 'GitHub is not switched on here.' }]);
        expect(chat).not.toHaveBeenCalled();
        expect(safeFetch).not.toHaveBeenCalled();
    });
});

describe('the model\'s pick', () => {
    it('is one model call offering the asked app\'s turned-on tools, a change marked as one, and its reads are run', async () => {
        const chat = model({ pick: { calls: [{ tool: 'fake.notes.list', arguments: { limit: 2 } }] } });
        const out = await step('what are my latest notes?', ['fake']);
        expect(picks(chat)).toHaveLength(1);
        const message = picks(chat)[0][0].messages[0].content;
        const offered = JSON.parse(/TOOLS: (\[.*\])/.exec(message)[1]);
        expect(offered.map((t) => [t.name, t.kind])).toEqual([['fake.notes.list', 'read'], ['fake.notes.create', 'change']]);
        expect(message).toContain('what are my latest notes?');
        expect(safeFetch.mock.calls[0][0]).toBe('https://api.fake.test/notes?limit=2');
        expect(out.sources).toEqual([expect.objectContaining({ ref: 'fake:1', project: 'Fake', detail: '- Board meeting\n- Call the bank' })]);
    });

    it('refuses a tool outside the asked app\'s turned-on tools, and runs nothing', async () => {
        model({ pick: { calls: [{ tool: 'notesmcp.notes.search', arguments: { query: 'bank' } }, { tool: 'fake.notes.delete', arguments: {} }, { tool: 'notesmcp.notes.archive' }] } });
        const out = await step('find the bank notes', ['fake']);
        expect(out.notes.map((n) => n.code)).toEqual(['unknown_tool', 'unknown_tool', 'unknown_tool']);
        expect(out.notes.every((n) => !n.text.includes('notesmcp') && !n.text.includes('delete'))).toBe(true);
        expect(out.sources).toEqual([]);
        expect(safeFetch).not.toHaveBeenCalled();
        expect(resolveConnection).toHaveBeenCalledTimes(1);
    });

    it('refuses arguments that do not fit the tool, a connection of the model\'s choosing among them', async () => {
        model({ pick: { calls: [{ tool: 'fake.notes.list', arguments: { limit: 'many' } }, { tool: 'fake.notes.list', arguments: { limit: 900 } }, { tool: 'fake.notes.list', arguments: { connectionId: 'conn-someone-else' } }] } });
        const out = await step('my notes', ['fake']);
        expect(out.notes.map((n) => n.code)).toEqual(['bad_input', 'bad_input', 'bad_input']);
        expect(safeFetch).not.toHaveBeenCalled();
    });

    it('runs at most three calls for one question', async () => {
        model({ pick: { calls: [1, 2, 3, 4].map((limit) => ({ tool: 'fake.notes.list', arguments: { limit } })) } });
        const out = await step('all my notes', ['fake']);
        expect(safeFetch).toHaveBeenCalledTimes(3);
        expect(out.sources.map((s) => s.ref)).toEqual(['fake:1', 'fake:2', 'fake:3']);
        expect(out.notes.map((n) => n.code)).toEqual(['too_many']);
    });

    it('says so when the model answers with no JSON, and reads nothing', async () => {
        model({ pick: 'I would read your notes.' });
        const out = await step('my notes', ['fake']);
        expect(out.notes).toEqual([expect.objectContaining({ provider: 'fake', code: 'pick_failed' })]);
        expect(safeFetch).not.toHaveBeenCalled();
    });

    it('says nothing was read when the model picks no call', async () => {
        const out = await step('hello there', ['fake']);
        expect(out.notes).toEqual([{ provider: 'fake', app: 'Fake', code: 'nothing_read', text: 'Nothing was read from Fake for this question.' }]);
    });
});

describe('a change asked for in the chat', () => {
    const note = { title: 'Minutes', body: 'Approved the budget for Q4.' };

    it('waits in the asker\'s Inbox as a proposal only they approve, and nothing reaches the app', async () => {
        model({ pick: { calls: [{ tool: 'fake.notes.create', arguments: note }] } });
        const out = await step('save a note called Minutes: Approved the budget for Q4.', ['fake']);
        expect(posts()).toEqual([]);
        expect(safeFetch).not.toHaveBeenCalled();
        const [row] = proposalRows();
        expect(row).toMatchObject({ source: 'ask', requestedBy: PRISHA, connectionOwner: PRISHA, status: 'pending', agentId: 'ask' });
        expect(row.changes).toEqual([expect.objectContaining({ action: 'fake.notes.create', params: { ...note, connectionId: 'conn-fake' }, card: expect.objectContaining({ title: 'Minutes', text: note.body }) })]);
        expect(out.proposals).toEqual([{ proposalId: String(row._id), provider: 'fake', app: 'Fake', tool: 'fake.notes.create', label: 'Connectors.tool.fakeNotesCreate' }]);
        expect(usageRows()).toEqual([expect.objectContaining({ writeProposals: 1, actor: { type: 'chat', id: 'ask' } })]);
        expect(callAudits()).toEqual([expect.objectContaining({ meta: expect.objectContaining({ phase: 'propose', via: 'chat', state: 'filed' }) })]);
    });

    it('is sent once, as filed, when the asker approves it, and never on another person\'s approval', async () => {
        model({ pick: { calls: [{ tool: 'fake.notes.create', arguments: note }] } });
        const { proposals: [filed] } = await step('save a note called Minutes', ['fake']);
        const refused = await proposals.approve(C, filed.proposalId, { decider: { kind: 'human', userId: OTHER }, isPrivileged: true, ip: '' });
        expect(refused).toMatchObject({ status: 403 });
        expect(posts()).toEqual([]);
        const approved = await egressContext.run({ companyId: C }, () => proposals.approve(C, filed.proposalId, { decider: { kind: 'human', userId: PRISHA }, isPrivileged: false, ip: '' }));
        expect(approved.error).toBeUndefined();
        expect(posts()).toHaveLength(1);
        expect(JSON.parse(posts()[0][1].data)).toEqual({ folder: 'Notes', title: 'Minutes', body: note.body });
    });

    it('"comment on that PR" after asking about it lands in the Inbox, not in GitHub', async () => {
        const chat = model({ pick: { calls: [{ tool: 'github.pull_request.comment', arguments: { owner: 'acme', repo: 'web', pullNumber: 482, body: 'LGTM' } }] } });
        const out = await step('Comment "LGTM" on that PR', ['github'], { previous: 'what is the status of acme/web#482?' });
        expect(picks(chat)[0][0].messages[0].content).toContain('EARLIER QUESTION (from the asker):\nwhat is the status of acme/web#482?');
        expect(safeFetch).not.toHaveBeenCalled();
        expect(out.proposals).toEqual([expect.objectContaining({ provider: 'github', app: 'GitHub', tool: 'github.pull_request.comment' })]);
        expect(proposalRows()[0]).toMatchObject({ source: 'ask', connectionOwner: PRISHA, gate: 'connection_owner' });
        expect(proposalRows()[0].changes[0].card).toMatchObject({ target: 'acme/web#482', text: 'LGTM' });
    });

    it('is told to the answer as waiting, never as made', async () => {
        model({ pick: { calls: [{ tool: 'fake.notes.create', arguments: note }] } });
        const out = await step('save a note', ['fake']);
        const block = askConnectors.promptBlock(out);
        expect(block).toContain('CONNECTED APPS:');
        expect(block).toContain('Fake: a change waits for the asker\'s approval in their Inbox. Nothing was sent to Fake.');
        expect(askConnectors.systemFor(out)).toContain('Never say that a waiting change was made or sent.');
    });

    it('a change with arguments that do not fit is refused, not filed', async () => {
        model({ pick: { calls: [{ tool: 'fake.notes.create', arguments: { title: 'Minutes' } }] } });
        const out = await step('save a note', ['fake']);
        expect(out.notes.map((n) => n.code)).toEqual(['bad_input']);
        expect(proposalRows()).toEqual([]);
    });
});

describe('an app the asker cannot use', () => {
    it('tells a member with no connection to connect it, and asks no model', async () => {
        resolveConnection.mockImplementation(async ({ provider }) => { throw connectorError('not_connected', provider); });
        const chat = model();
        const out = await step(`status of ${PR_LINK}`, ['github']);
        expect(out.notes).toEqual([{ provider: 'github', app: 'GitHub', code: 'not_connected', text: 'Connect GitHub on My connections first, then ask again.' }]);
        expect(chat).not.toHaveBeenCalled();
        expect(safeFetch).not.toHaveBeenCalled();
    });

    it('reads nothing for a caller with a token instead of a session', async () => {
        const out = await step(`status of ${PR_LINK}`, ['github'], { viaToken: true });
        expect(out.notes.map((n) => n.code)).toEqual(['session_only']);
        expect(resolveConnection).not.toHaveBeenCalled();
    });

    it('says what to tick when the connection lacks the tool\'s access', async () => {
        resolveConnection.mockImplementation(async ({ provider }) => ({ connectionId: `conn-${provider}`, scopes: [], getAccessToken: async () => 't' }));
        const out = await step(`status of ${PR_LINK}`, ['github']);
        expect(out.notes).toEqual([expect.objectContaining({ code: 'scope_missing', text: 'Tick repos on your GitHub connection in My connections, then ask again.' })]);
        expect(safeFetch).not.toHaveBeenCalled();
    });
});

describe('after a connector read', () => {
    it('the question makes no web fetch', async () => {
        await egressContext.run({ companyId: C, actor: PRISHA }, async () => {
            await askConnectors.readStep({ companyId: C, userId: PRISHA, question: `status of ${PR_LINK}`, apps: ['github'] });
            await expect(agentFetch.audit('https://example.com/')).rejects.toMatchObject({ code: 'connector_read' });
        });
    });
});

describe('the streamed answer with a connector chip', () => {
    it('cites the pull request, fetches nothing from the web while answering, and offers no posting', async () => {
        let fetchedAfter = null;
        const chat = model({
            answer: 'It is open and its checks pass [github:1].',
            during: async () => { fetchedAfter = await agentFetch.audit('https://example.com/').then(() => 'fetched', (error) => error.code); },
        });
        const res = await ask({ question: `what's the status of ${PR_LINK}?`, context: [{ kind: 'connector', id: 'github' }] });
        const done = doneOf(res);
        expect(done.cited).toEqual([expect.objectContaining({ kind: 'connector', ref: 'github:1' })]);
        expect(done.shareToken).toBeUndefined();
        expect(done.connectors).toEqual({ notes: [], proposals: [] });
        expect(fetchedAfter).toBe('connector_read');
        const [answering] = chat.mock.calls.map(([opts]) => opts).filter((opts) => !opts.jsonMode);
        expect(answering.messages[answering.messages.length - 1].content).toContain('[github:1] connector · GitHub');
        expect(answering.systemPrompt).toContain('outside');
    });

    it('reads nothing once the chip is removed before sending', async () => {
        visibleProjects.mockResolvedValue([{ _id: OPS, ProjectName: 'Ops' }]);
        mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Status of the login fix', TaskKey: 'OPS-1', statusType: 'open', ProjectID: OPS, deletedStatusKey: 0, updatedAt: new Date() });
        model({ answer: 'It is in review [OPS-1].' });
        const res = await ask({ question: `what's the status of the login fix ${PR_LINK}` });
        const done = doneOf(res);
        expect(safeFetch).not.toHaveBeenCalled();
        expect(resolveConnection).not.toHaveBeenCalled();
        expect(done.connectors).toBeUndefined();
        expect(done.shareToken).toEqual(expect.any(String));
    });

    it('says what to connect, without a model answer, when nothing else could be read', async () => {
        resolveConnection.mockImplementation(async ({ provider }) => { throw connectorError('not_connected', provider); });
        const chat = model();
        const res = await ask({ question: `status of ${PR_LINK}`, context: [{ kind: 'connector', id: 'github' }] });
        expect(chat).not.toHaveBeenCalled();
        expect(res.body).toMatchObject({ status: true, data: { emptyCode: 'connector_unread', connectors: { notes: [expect.objectContaining({ code: 'not_connected', app: 'GitHub' })], proposals: [] } } });
    });

    it('says a change waits in the Inbox when that is all the question did', async () => {
        model({ pick: { calls: [{ tool: 'fake.notes.create', arguments: { title: 'Minutes', body: 'Ship it.' } }] } });
        const res = await ask({ question: 'save a note called Minutes: Ship it.', context: [{ kind: 'connector', id: 'fake' }] });
        expect(res.body.data).toMatchObject({ emptyCode: 'connector_waiting', connectors: { proposals: [expect.objectContaining({ app: 'Fake' })] } });
        expect(posts()).toEqual([]);
    });
});
