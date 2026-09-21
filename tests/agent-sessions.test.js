const crypto = require('crypto');

const mockDbs = {};
const mockDbFor = (id) => { mockDbs[id] = mockDbs[id] || require('./fixtures/fakeMongo').create(); return mockDbs[id]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method) }));
jest.mock('../Config/config', () => ({ WEBURL: 'https://hub.test/', myCache: { get: () => undefined, set: () => {}, del: () => {}, getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));
jest.mock('../Modules/Agents/agentAudit', () => ({ recordRefusal: jest.fn(async () => 'refusal-1'), recordAction: jest.fn(async () => 'action-1') }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn(async () => undefined) }));
jest.mock('../Modules/Automations/engine/tools', () => ({
    ...jest.requireActual('../Modules/Automations/engine/tools'),
    updateTask: jest.fn(async () => ({ changed: true })),
}));
jest.mock('../Modules/Agents/engine/agentFetch', () => ({ fetchPage: jest.fn(), audit: jest.fn(), postJson: jest.fn() }));
jest.mock('../Modules/AgentSessions/access', () => ({
    EDIT_KEYS: [],
    taskOf: jest.fn(),
    canOpenTask: jest.fn(async () => true),
    canEditTask: jest.fn(async () => true),
    privateSprintOf: jest.fn(async () => null),
    isSprintMember: jest.fn(async () => true),
}));
jest.mock('../Modules/AgentSessions/clients', () => ({
    clientStanding: jest.fn(async () => ({ ok: true, name: 'Coder' })),
    liveGrantFor: jest.fn(async () => ({ grantId: 'grant-1' })),
    grantStanding: jest.fn(async () => true),
    privateSprintsOptIn: jest.fn(async () => true),
    approvalRow: jest.fn(async () => null),
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const egressContext = require('../Modules/Agents/engine/egressContext');
const agentFetch = require('../Modules/Agents/engine/agentFetch');
const access = require('../Modules/AgentSessions/access');
const clients = require('../Modules/AgentSessions/clients');
const { recordAudit } = require('../Modules/Audit/recorder');
const agentAudit = require('../Modules/Agents/agentAudit');
const { handleNotificationtFun } = require('../Modules/notification/prepare-notification-data/controllerV2');
const automationTools = require('../Modules/Automations/engine/tools');
const { RefusedError } = require('../Modules/Agents/actions');
const tokenHash = require('../Modules/OAuthServer/tokenHash');
const delegation = require('../Modules/AgentSessions/delegation');
const activity = require('../Modules/AgentSessions/activity');
const lifecycle = require('../Modules/AgentSessions/lifecycle');
const rules = require('../Modules/AgentSessions/rules');
const store = require('../Modules/AgentSessions/store');

const CID = '6a0000000000000000000001';
const OWNER = '6a00000000000000000000a1';
const MEMBER = '6a00000000000000000000b2';
const TASK = '6a00000000000000000000c3';
const PROJECT = '6a00000000000000000000d4';
const SPRINT = '6a00000000000000000000e5';
const SECRET = 'whsec-s10s7-test';
const CLIENT = 'ahc_coder';
const URL_OUT = 'https://agent.example.com/hooks/alianhub';

const db = () => mockDbFor(CID);
const task = (fields = {}) => ({ _id: TASK, ProjectID: PROJECT, sprintId: SPRINT, TaskName: 'Write the parser', TaskKey: 'AH-7', CompanyId: CID, AssigneeUserId: [], ...fields });
const ctxFor = ({ clientId = CLIENT, grantId = 'grant-1', userId = OWNER, oauth = true } = {}) => ({
    companyId: CID, userId, ip: '203.0.113.9',
    actor: { kind: 'agent', userId, clientId, grantId, delegatedBy: userId, viaAccount: 'external' },
    token: oauth ? { oauth: true, scopes: ['tasks:read', 'tasks:write'] } : { scopes: ['write'] },
    ...(oauth ? { oauth: { clientId, grantId, scopes: ['tasks:read', 'tasks:write'] } } : {}),
    taint: { tainted: true, taintSources: [{ kind: 'client', ref: clientId }] },
});

let emitted;
const onEmit = (change) => emitted.push(change.data.session);
let sent;

beforeAll(() => socketEmitter.on('agentSession:update', onEmit));
afterAll(() => socketEmitter.off('agentSession:update', onEmit));

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => delete mockDbs[key]);
    jest.clearAllMocks();
    lifecycle.reset();
    activity.resetRateLimits();
    emitted = [];
    sent = [];
    access.taskOf.mockImplementation(async () => task());
    db().seed(SCHEMA_TYPE.AGENT_SESSION_ENDPOINTS, { clientId: CLIENT, url: URL_OUT, secret: SECRET });
    agentFetch.postJson.mockImplementation(async (url, options) => {
        sent.push({ url, options, egress: egressContext.get() });
        return { status: 202, hops: [] };
    });
});

afterEach(() => {
    lifecycle.reset();
    jest.useRealTimers();
});

const delegateNow = (fields = {}) => delegation.delegate({ companyId: CID, uid: OWNER, taskId: TASK, clientId: CLIENT, ...fields });
const handleOf = () => JSON.parse(sent[sent.length - 1].options.body).handle;

describe('delegating a task to an outside agent', () => {
    it('keeps the assignee a task already has and notifies nobody', async () => {
        access.taskOf.mockImplementation(async () => task({ AssigneeUserId: [MEMBER] }));
        const { session } = await delegateNow();
        expect(session.state).toBe('offered');
        expect(session.assignedDelegator).toBe(false);
        expect(automationTools.updateTask).not.toHaveBeenCalled();
        expect(handleNotificationtFun).not.toHaveBeenCalled();
    });

    it('gives an unassigned task to the delegating person and notifies them', async () => {
        const { session } = await delegateNow();
        expect(session.assignedDelegator).toBe(true);
        expect(automationTools.updateTask).toHaveBeenCalledWith(CID, TASK, { AssigneeUserId: [OWNER] }, expect.objectContaining({ auditedByCaller: true }));
        expect(handleNotificationtFun).toHaveBeenCalledTimes(1);
        const { body } = handleNotificationtFun.mock.calls[0][0];
        expect(body).toMatchObject({ companyId: CID, taskId: TASK, userId: String(session._id), assigneeUsers: [OWNER], notSeen: [OWNER] });
    });

    it('is refused to a person who cannot edit the task', async () => {
        access.canEditTask.mockResolvedValueOnce(false);
        await expect(delegateNow({ uid: MEMBER })).rejects.toMatchObject({ statusCode: 403 });
        expect(db().store[SCHEMA_TYPE.AGENT_SESSIONS] || []).toHaveLength(0);
    });

    it('is refused for a client that is not approved, holds no live grant from the person, or has no delivery URL', async () => {
        clients.clientStanding.mockResolvedValueOnce({ ok: false, name: '' });
        await expect(delegateNow()).rejects.toMatchObject({ statusCode: 403 });
        clients.liveGrantFor.mockResolvedValueOnce(null);
        await expect(delegateNow()).rejects.toMatchObject({ statusCode: 409 });
        await expect(delegation.delegate({ companyId: CID, uid: OWNER, taskId: TASK, clientId: 'ahc_other' })).rejects.toMatchObject({ statusCode: 409 });
    });

    describe('in a private sprint', () => {
        beforeEach(() => access.privateSprintOf.mockResolvedValue({ _id: SPRINT, private: true, AssigneeUserId: [OWNER] }));
        afterEach(() => access.privateSprintOf.mockResolvedValue(null));

        it('is allowed to a member of the sprint when the client is opted in', async () => {
            const { session } = await delegateNow();
            expect(session.privateSprint).toBe(true);
        });

        it('is refused to a delegator who is not a member of the sprint, even with the opt-in', async () => {
            access.isSprintMember.mockResolvedValueOnce(false);
            await expect(delegateNow()).rejects.toMatchObject({ statusCode: 403, message: expect.stringMatching(/member of this private sprint/) });
        });

        it('is refused when the client is not opted in to private sprints', async () => {
            clients.privateSprintsOptIn.mockResolvedValueOnce(false);
            await expect(delegateNow()).rejects.toMatchObject({ statusCode: 403, message: expect.stringMatching(/opted this outside agent in/) });
        });
    });

    it('is audited as the delegating person, naming the session, client and grant', async () => {
        const { session } = await delegateNow();
        expect(recordAudit).toHaveBeenCalledWith(CID, expect.objectContaining({
            actorId: OWNER, action: 'agent_session.delegated', entityType: 'task', entityId: TASK,
            meta: expect.objectContaining({ sessionId: String(session._id), clientId: CLIENT, grantId: 'grant-1', assignedDelegator: true }),
        }));
    });

    it('counts the session as tainted', async () => {
        const { session } = await delegateNow();
        expect(session.tainted).toBe(true);
    });
});

describe('the opt-in for private sprints is read from the workspace approval', () => {
    const load = (approvals) => {
        let loaded;
        jest.isolateModules(() => {
            jest.doMock('../Modules/OAuthServer/store', () => ({ clients: {}, grants: { find: jest.fn() }, tokens: {}, ...(approvals ? { approvals } : {}) }));
            jest.doMock('../Modules/Mcp/oauthAuth', () => ({ clientStanding: jest.fn(), clientApprovedInWorkspace: jest.fn() }));
            loaded = jest.requireActual('../Modules/AgentSessions/clients');
        });
        return loaded;
    };

    it('refuses when the approvals collection is absent', async () => {
        expect(await load(null).privateSprintsOptIn(CID, CLIENT)).toBe(false);
    });

    it('refuses an approval without the opt-in, and one that is not approved', async () => {
        expect(await load({ find: async () => ({ status: 'approved', privateSprints: false }) }).privateSprintsOptIn(CID, CLIENT)).toBe(false);
        expect(await load({ find: async () => ({ status: 'revoked', privateSprints: true }) }).privateSprintsOptIn(CID, CLIENT)).toBe(false);
    });

    it('allows an approved client an admin opted in', async () => {
        expect(await load({ find: async () => ({ status: 'approved', privateSprints: true }) }).privateSprintsOptIn(CID, CLIENT)).toBe(true);
    });
});

describe('the announcement', () => {
    it('is a signed webhook sent through the egress gateway in the workspace', async () => {
        const { session } = await delegateNow();
        expect(sent).toHaveLength(1);
        const [{ url, options, egress }] = sent;
        expect(url).toBe(URL_OUT);
        expect(egress).toEqual({ companyId: CID, actor: OWNER });
        const expected = `sha256=${crypto.createHmac('sha256', SECRET).update(options.body).digest('hex')}`;
        expect(options.headers['X-AlianHub-Signature']).toBe(expected);
        expect(options.headers['X-AlianHub-Event']).toBe('agent_session.offered');
        const body = JSON.parse(options.body);
        expect(body).toMatchObject({ sessionId: String(session._id), task: { id: TASK, key: 'AH-7', title: 'Write the parser' } });
        expect(body.handle).toMatch(/^ahs_/);
    });

    it('carries no access token, refresh token or bearer credential', async () => {
        await delegateNow();
        const { options } = sent[0];
        const everything = `${options.body} ${JSON.stringify(options.headers)}`;
        Object.values(tokenHash.PREFIX).forEach((prefix) => expect(everything).not.toContain(prefix));
        expect(everything).not.toMatch(/bearer|authorization|access_token/i);
    });

    it('stores only a hash of the handle', async () => {
        const { session } = await delegateNow();
        const row = db().store[SCHEMA_TYPE.AGENT_SESSIONS].find((r) => String(r._id) === String(session._id));
        expect(row.handleHash).toBe(rules.hashOf(handleOf()));
        expect(JSON.stringify(row)).not.toContain(handleOf());
    });

    it('fails the session when the client does not answer 2xx, and arms no clock', async () => {
        jest.useFakeTimers();
        agentFetch.postJson.mockResolvedValueOnce({ status: 500, hops: [] });
        const { session, delivered } = await delegateNow();
        expect(delivered).toBe(false);
        expect(session.state).toBe('failed');
        expect(session.deliveredAt).toBeUndefined();
        await jest.advanceTimersByTimeAsync(20000);
        expect((await store.find(CID, session._id)).state).toBe('failed');
    });

    it('is not sent to a stored URL that no longer passes the delivery rules', async () => {
        db().store[SCHEMA_TYPE.AGENT_SESSION_ENDPOINTS][0].url = 'http://agent.example.com/hook';
        const { session } = await delegateNow();
        expect(sent).toHaveLength(0);
        expect(session).toMatchObject({ state: 'failed', reason: 'the delivery URL must use https' });
    });
});

describe('a delivery URL', () => {
    const owner = { allowsHost: (host) => host === '127.0.0.1' };

    it.each([
        ['https on a public host', 'https://agent.example.com/hook', {}, ''],
        ['plain http', 'http://agent.example.com/hook', {}, 'the delivery URL must use https'],
        ['a private host', 'https://10.0.0.8/hook', {}, 'the delivery URL names a private, local or internal host'],
        ['localhost', 'https://localhost/hook', {}, 'the delivery URL names a private, local or internal host'],
        ['credentials in the URL', 'https://user:pw@agent.example.com/hook', {}, 'the delivery URL must not carry credentials'],
        ['not a URL', 'agent.example.com', {}, 'the delivery URL is not a valid URL'],
        ['a host off the workspace egress list', 'https://agent.example.com/hook', { egressHosts: ['api.example.org'] }, "agent.example.com is not on this workspace's egress allowlist"],
        ['a host on the workspace egress list', 'https://agent.example.com/hook', { egressHosts: ['*.example.com'] }, ''],
        ['http to a private host the instance owner allows', 'http://127.0.0.1:4555/hook', { allowlist: owner }, ''],
    ])('%s', (label, url, options, problem) => {
        expect(rules.deliveryUrlProblem(url, options)).toBe(problem);
    });
});

describe('the ten-second first-activity rule', () => {
    beforeEach(() => jest.useFakeTimers({ now: new Date('2026-09-21T10:00:00.000Z') }));

    it('marks an offer unresponsive ten seconds after delivery, not after creation', async () => {
        agentFetch.postJson.mockImplementationOnce(async (url, options) => {
            sent.push({ url, options, egress: egressContext.get() });
            await new Promise((resolve) => setTimeout(resolve, 4000));
            return { status: 200, hops: [] };
        });
        const pending = delegateNow();
        await jest.advanceTimersByTimeAsync(4000);
        const { session } = await pending;
        expect(session.deliveredAt.toISOString()).toBe('2026-09-21T10:00:04.000Z');

        await jest.advanceTimersByTimeAsync(9000);
        expect((await store.find(CID, session._id)).state).toBe('offered');
        await jest.advanceTimersByTimeAsync(1000);
        const after = await store.find(CID, session._id);
        expect(after).toMatchObject({ state: 'unresponsive' });
        expect(after.endedAt.toISOString()).toBe('2026-09-21T10:00:14.000Z');
        expect(recordAudit).toHaveBeenCalledWith(CID, expect.objectContaining({ action: 'agent_session.unresponsive', entityId: TASK }));
        expect(emitted.map((s) => s.state)).toContain('unresponsive');
    });

    it('keeps a session the client took up within the ten seconds', async () => {
        const { session } = await delegateNow();
        await jest.advanceTimersByTimeAsync(3000);
        await activity.record(ctxFor(), { sessionId: String(session._id), handle: handleOf(), type: 'thought', text: 'Reading the brief' });
        await jest.advanceTimersByTimeAsync(20000);
        expect((await store.find(CID, session._id)).state).toBe('active');
    });

    it('is decided after a restart from the stored delivery time', async () => {
        const stale = await store.create(CID, { taskId: TASK, clientId: CLIENT, grantId: 'grant-1', delegatedBy: OWNER, state: 'offered', createdAt: new Date('2026-09-21T09:59:40.000Z'), deliveredAt: new Date('2026-09-21T09:59:49.000Z') });
        const fresh = await store.create(CID, { taskId: TASK, clientId: CLIENT, grantId: 'grant-1', delegatedBy: OWNER, state: 'offered', createdAt: new Date('2026-09-21T09:59:55.000Z'), deliveredAt: new Date('2026-09-21T09:59:57.000Z') });
        lifecycle.reset();

        const swept = await lifecycle.sweepCompany(CID);
        expect(swept.closed).toBe(1);
        expect((await store.find(CID, stale._id)).state).toBe('unresponsive');
        expect((await store.find(CID, fresh._id)).state).toBe('offered');

        await jest.advanceTimersByTimeAsync(6999);
        expect((await store.find(CID, fresh._id)).state).toBe('offered');
        await jest.advanceTimersByTimeAsync(1);
        expect((await store.find(CID, fresh._id)).state).toBe('unresponsive');
    });

    it('fails an offer whose announcement was never delivered before the process died', async () => {
        const orphan = await store.create(CID, { taskId: TASK, clientId: CLIENT, grantId: 'grant-1', delegatedBy: OWNER, state: 'offered', createdAt: new Date('2026-09-21T09:50:00.000Z') });
        await lifecycle.sweepCompany(CID);
        expect(await store.find(CID, orphan._id)).toMatchObject({ state: 'failed', reason: 'the announcement was never delivered' });
    });
});

describe('activities from the outside agent', () => {
    let session;
    let handle;
    beforeEach(async () => {
        ({ session } = await delegateNow());
        handle = handleOf();
    });

    const refusedWith = async (promise, pattern) => {
        const error = await promise.then(() => null, (e) => e);
        expect(error).toBeInstanceOf(RefusedError);
        expect(error.message).toMatch(pattern);
        expect(agentAudit.recordRefusal).toHaveBeenCalled();
    };

    it('records typed activities with timestamps, taking the offer up and auditing it with the client, grant and taint', async () => {
        const out = await activity.record(ctxFor(), { sessionId: String(session._id), handle, type: 'thought', text: 'Reading the brief' });
        expect(out).toMatchObject({ state: 'active', activityCount: 1 });
        await activity.record(ctxFor(), { sessionId: String(session._id), type: 'action', text: 'Opened a branch' });
        const row = await store.find(CID, session._id);
        expect(row.activities.map((a) => a.type)).toEqual(['thought', 'action']);
        row.activities.forEach((a) => expect(a.at).toBeInstanceOf(Date));
        expect(agentAudit.recordAction).toHaveBeenCalledWith(CID, expect.objectContaining({ clientId: CLIENT, grantId: 'grant-1' }), expect.objectContaining({
            action: 'session.taken_up', entityId: TASK, taint: expect.objectContaining({ tainted: true }),
        }));
        expect(emitted[emitted.length - 1]).toMatchObject({ state: 'active', activities: [{ type: 'thought' }, { type: 'action' }] });
    });

    it('cuts text to the limit and refuses an unknown type', async () => {
        await activity.record(ctxFor(), { sessionId: String(session._id), handle, type: 'response', text: 'x'.repeat(10000) });
        expect((await store.find(CID, session._id)).activities[0].text).toHaveLength(4000);
        await refusedWith(activity.record(ctxFor(), { sessionId: String(session._id), type: 'shout', text: 'hi' }), /type must be one of/);
    });

    it('refuses another client', async () => {
        await refusedWith(activity.record(ctxFor({ clientId: 'ahc_other' }), { sessionId: String(session._id), handle, type: 'thought', text: 'x' }), /another client/);
    });

    it('refuses another grant of the same client', async () => {
        await refusedWith(activity.record(ctxFor({ grantId: 'grant-2' }), { sessionId: String(session._id), handle, type: 'thought', text: 'x' }), /another grant/);
    });

    it('refuses a personal access token', async () => {
        await refusedWith(activity.record(ctxFor({ oauth: false }), { sessionId: String(session._id), handle, type: 'thought', text: 'x' }), /OAuth access token/);
    });

    it('refuses the first call without the handle from the announcement', async () => {
        await refusedWith(activity.record(ctxFor(), { sessionId: String(session._id), type: 'thought', text: 'x' }), /handle/);
    });

    it('refuses a closed session', async () => {
        await activity.complete(ctxFor(), { sessionId: String(session._id), handle, summary: 'Done: PR #12' });
        await refusedWith(activity.record(ctxFor(), { sessionId: String(session._id), type: 'thought', text: 'x' }), /is completed/);
    });

    it('refuses once the person behind the grant can no longer open the task', async () => {
        access.canOpenTask.mockResolvedValueOnce(false);
        await refusedWith(activity.record(ctxFor(), { sessionId: String(session._id), handle, type: 'thought', text: 'x' }), /not_visible/);
        const vis = { allowsTask: () => false };
        await refusedWith(activity.record(ctxFor(), { sessionId: String(session._id), handle, type: 'thought', text: 'x' }, vis), /not_visible/);
    });

    it('limits activities per session to sixty a minute', async () => {
        await activity.record(ctxFor(), { sessionId: String(session._id), handle, type: 'thought', text: 'first' });
        for (let i = 1; i < 60; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await activity.record(ctxFor(), { sessionId: String(session._id), type: 'action', text: `step ${i}` });
        }
        await refusedWith(activity.record(ctxFor(), { sessionId: String(session._id), type: 'action', text: 'one too many' }), /60 activities in a minute/);
        expect((await store.find(CID, session._id)).activityCount).toBe(60);
    });

    it('completes and fails a session with its own closing activity', async () => {
        await activity.record(ctxFor(), { sessionId: String(session._id), handle, type: 'thought', text: 'go' });
        const done = await activity.complete(ctxFor(), { sessionId: String(session._id), summary: 'Opened PR #12' });
        expect(done.state).toBe('completed');
        const row = await store.find(CID, session._id);
        expect(row.activities[row.activities.length - 1]).toMatchObject({ type: 'response', text: 'Opened PR #12' });

        const second = (await delegation.delegate({ companyId: CID, uid: OWNER, taskId: TASK, clientId: CLIENT })).session;
        const failed = await activity.fail(ctxFor(), { sessionId: String(second._id), handle: handleOf(), reason: 'Tests would not run' });
        expect(failed.state).toBe('failed');
        expect(await store.find(CID, second._id)).toMatchObject({ reason: 'Tests would not run' });
    });
});

describe('revocation', () => {
    it('closes an open session whose grant was revoked, and refuses its next activity', async () => {
        const { session } = await delegateNow();
        await activity.record(ctxFor(), { sessionId: String(session._id), handle: handleOf(), type: 'thought', text: 'working' });
        clients.grantStanding.mockResolvedValue(false);
        await lifecycle.sweepTracked();
        clients.grantStanding.mockResolvedValue(true);
        expect(await store.find(CID, session._id)).toMatchObject({ state: 'revoked', reason: expect.stringMatching(/grant/) });
        expect(emitted[emitted.length - 1].state).toBe('revoked');
        const error = await activity.record(ctxFor(), { sessionId: String(session._id), type: 'action', text: 'still here' }).catch((e) => e);
        expect(error.message).toMatch(/is revoked/);
    });

    it('closes an open session when the client approval goes', async () => {
        const { session } = await delegateNow();
        clients.clientStanding.mockResolvedValue({ ok: false, name: '' });
        await lifecycle.sweepCompany(CID);
        clients.clientStanding.mockResolvedValue({ ok: true, name: 'Coder' });
        expect(await store.find(CID, session._id)).toMatchObject({ state: 'revoked', reason: expect.stringMatching(/no longer approved/) });
    });

    it('leaves closed sessions alone', async () => {
        const { session } = await delegateNow();
        await activity.complete(ctxFor(), { sessionId: String(session._id), handle: handleOf(), summary: 'done' });
        clients.grantStanding.mockResolvedValue(false);
        await lifecycle.sweepCompany(CID);
        clients.grantStanding.mockResolvedValue(true);
        expect((await store.find(CID, session._id)).state).toBe('completed');
    });
});

describe('with EXTERNAL_AGENT_SESSIONS off', () => {
    const saved = process.env.EXTERNAL_AGENT_SESSIONS;
    beforeEach(() => { delete process.env.EXTERNAL_AGENT_SESSIONS; });
    afterAll(() => { if (saved === undefined) delete process.env.EXTERNAL_AGENT_SESSIONS; else process.env.EXTERNAL_AGENT_SESSIONS = saved; });

    it('offers no session tool over MCP and answers one as unknown', async () => {
        const tools = require('../Modules/Mcp/tools');
        expect(tools.names().filter((name) => name.startsWith('session.'))).toEqual([]);
        expect(tools.manifest().map((t) => t.name)).not.toContain('session.activity');
        await expect(tools.call(ctxFor(), 'session.activity', { sessionId: 'x' })).rejects.toMatchObject({ code: -32601 });
    });

    it('registers no route and starts no sweep', () => {
        const app = { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn(), use: jest.fn() };
        const setInterval = jest.spyOn(global, 'setInterval');
        require('../Modules/AgentSessions/init').init(app, {});
        expect([...app.get.mock.calls, ...app.post.mock.calls, ...app.put.mock.calls]).toEqual([]);
        expect(setInterval).not.toHaveBeenCalled();
        setInterval.mockRestore();
    });

    it('offers the three session tools, each needing tasks:write, once on', () => {
        process.env.EXTERNAL_AGENT_SESSIONS = 'on';
        const tools = require('../Modules/Mcp/tools');
        const { scopeForTool } = require('../Modules/Mcp/scopes');
        expect(tools.names().filter((name) => name.startsWith('session.'))).toEqual(['session.activity', 'session.complete', 'session.fail']);
        ['session.activity', 'session.complete', 'session.fail'].forEach((name) => expect(scopeForTool(name)).toBe('tasks:write'));
    });
});
