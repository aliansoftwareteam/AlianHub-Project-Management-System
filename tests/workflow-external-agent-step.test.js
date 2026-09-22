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
jest.mock('../Modules/Agents/actor', () => ({
    ...jest.requireActual('../Modules/Agents/actor'),
    externalClientActor: jest.fn(async ({ userId, clientId, clientName, grantId }) => ({
        kind: 'agent', userId: String(userId), agentName: clientName, viaAccount: 'external', clientId: String(clientId), grantId: String(grantId), delegatedBy: String(userId),
    })),
}));
jest.mock('../Modules/Workflows/queue', () => ({ dispatch: jest.fn(async () => 'inline') }));
jest.mock('../Modules/AgentSessions/access', () => ({
    EDIT_KEYS: [],
    taskOf: jest.fn(),
    canOpenTask: jest.fn(async () => true),
    canEditTask: jest.fn(async () => true),
    canAssignSelf: jest.fn(async () => true),
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

process.env.JWT_SECRET = process.env.JWT_SECRET || 's10s8-test-secret';
const ENV = ['EXTERNAL_AGENT_STEPS', 'EXTERNAL_AGENT_SESSIONS', 'AGENT_TAINT_ROUTING'];
const savedEnv = Object.fromEntries(ENV.map((key) => [key, process.env[key]]));
process.env.EXTERNAL_AGENT_STEPS = 'on';
process.env.EXTERNAL_AGENT_SESSIONS = 'on';

const { SCHEMA_TYPE } = require('../Config/schemaType');
const agentFetch = require('../Modules/Agents/engine/agentFetch');
const agentAudit = require('../Modules/Agents/agentAudit');
const { RefusedError } = require('../Modules/Agents/actions');
const access = require('../Modules/AgentSessions/access');
const clients = require('../Modules/AgentSessions/clients');
const activity = require('../Modules/AgentSessions/activity');
const lifecycle = require('../Modules/AgentSessions/lifecycle');
const sessions = require('../Modules/AgentSessions/store');
const tokenHash = require('../Modules/OAuthServer/tokenHash');
const queue = require('../Modules/Workflows/queue');
const workflowStore = require('../Modules/Workflows/store');
const { isWaiting } = require('../Modules/Workflows/stepTypes/waiting');
const externalAgent = require('../Modules/Workflows/stepTypes/externalAgent');
const externalSession = require('../Modules/Workflows/externalSession');

const CID = '6b0000000000000000000001';
const OWNER = '6b00000000000000000000a1';
const TASK = '6b00000000000000000000c3';
const PROJECT = '6b00000000000000000000d4';
const CLIENT = 'ahc_coder';
const STEP = 'sCode';

const db = () => mockDbFor(CID);
const globalDb = () => mockDbFor(SCHEMA_TYPE.GOLBAL);
const ctxFor = ({ grantId = 'grant-1', userId = OWNER } = {}) => ({
    companyId: CID, userId, ip: '203.0.113.9',
    actor: { kind: 'agent', userId, clientId: CLIENT, grantId, delegatedBy: userId, viaAccount: 'external' },
    token: { oauth: true, scopes: ['tasks:read', 'tasks:write'] },
    oauth: { clientId: CLIENT, grantId, scopes: ['tasks:read', 'tasks:write'] },
    taint: { tainted: true, taintSources: [{ kind: 'client', ref: CLIENT }] },
});

let sent;
let run;

const seedRun = (fields = {}) => db().seed(SCHEMA_TYPE.WORKFLOW_RUNS, { workflowId: 'wf', status: 'running', startedBy: OWNER, taskId: TASK, ...fields });
const seedStep = (runRow, fields = {}) => db().seed(SCHEMA_TYPE.WORKFLOW_STEP_RUNS, {
    runId: String(runRow._id), stepId: STEP, index: 0, type: externalAgent.TYPE, dependsOn: [], status: 'running', attempts: 1, maxAttempts: 3, fencingToken: 1,
    config: { clientId: CLIENT }, ...fields,
});
const stepRow = () => workflowStore.getStep(CID, run._id, STEP);
const claim = () => ({ runId: String(run._id), stepId: STEP, fencingToken: 1 });
const execute = async (context = {}) => externalAgent.execute({ companyId: CID, run: await workflowStore.getRun(CID, run._id), step: await stepRow(), claim: claim(), context });
const settle = (promise) => promise.then((output) => ({ output }), (error) => ({ error }));
const setStep = (set) => db().crud(CID, { type: SCHEMA_TYPE.WORKFLOW_STEP_RUNS, data: [{ runId: String(run._id), stepId: STEP }, { $set: set }] }, 'updateOne');
const setRun = (set) => db().crud(CID, { type: SCHEMA_TYPE.WORKFLOW_RUNS, data: [{ _id: String(run._id) }, { $set: set }] }, 'updateOne');
const sessionRows = () => db().store[SCHEMA_TYPE.AGENT_SESSIONS] || [];
const handleOf = () => JSON.parse(sent[sent.length - 1].options.body).handle;

/* The step's first claim: it opens the session and hands the worker back to wait. */
const opened = async () => {
    const first = await settle(execute());
    expect(isWaiting(first.error)).toBe(true);
    const session = await sessions.forStep(CID, run._id, STEP);
    expect(session).toBeTruthy();
    await setStep({ status: 'pending', agentSessionId: String(session._id) });
    return session;
};

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => delete mockDbs[key]);
    jest.clearAllMocks();
    lifecycle.reset();
    activity.resetRateLimits();
    sent = [];
    clients.grantStanding.mockResolvedValue(true);
    clients.clientStanding.mockResolvedValue({ ok: true, name: 'Coder' });
    access.taskOf.mockImplementation(async () => ({ _id: TASK, ProjectID: PROJECT, TaskName: 'Write the parser', TaskKey: 'AH-7', AssigneeUserId: [OWNER] }));
    db().seed(SCHEMA_TYPE.AGENT_SESSION_ENDPOINTS, { clientId: CLIENT, url: 'https://agent.example.com/hooks', secret: 'whsec-s10s8' });
    agentFetch.postJson.mockImplementation(async (url, options) => { sent.push({ url, options }); return { status: 202, hops: [] }; });
    run = seedRun();
    seedStep(run);
});

afterEach(() => lifecycle.reset());

afterAll(() => ENV.forEach((key) => { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key]; }));

describe('EXTERNAL_AGENT_STEPS', () => {
    const load = (env) => {
        let loaded;
        const before = Object.fromEntries(ENV.map((key) => [key, process.env[key]]));
        Object.assign(process.env, env);
        Object.entries(env).forEach(([key, value]) => { if (value === undefined) delete process.env[key]; });
        jest.isolateModules(() => {
            loaded = { stepTypes: require('../Modules/Workflows/stepTypes'), executors: require('../Modules/Workflows/executors') };
        });
        ENV.forEach((key) => { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; });
        return loaded;
    };
    const step = { id: 's1', type: 'external_agent', config: { clientId: CLIENT, taskId: TASK } };

    it('off, the step type is not registered, offered or accepted', () => {
        const { stepTypes, executors } = load({ EXTERNAL_AGENT_STEPS: undefined });
        expect(executors.has('external_agent')).toBe(false);
        expect(stepTypes.manifest().stepTypes.map((c) => c.key)).not.toContain('external_agent');
        expect(stepTypes.get('external_agent')).toBeNull();
        expect(stepTypes.validateSteps([step]).errors).toEqual(['steps[0].type: unknown step type "external_agent"']);
    });

    it('stays off without outside agent sessions, which it works through', () => {
        const { executors } = load({ EXTERNAL_AGENT_STEPS: 'on', EXTERNAL_AGENT_SESSIONS: undefined });
        expect(executors.has('external_agent')).toBe(false);
    });

    it('on, the step type is registered, offered with a client picker and needs a client', () => {
        const { stepTypes, executors } = load({ EXTERNAL_AGENT_STEPS: 'on', EXTERNAL_AGENT_SESSIONS: 'on' });
        expect(executors.has('external_agent')).toBe(true);
        const contract = stepTypes.manifest().stepTypes.find((c) => c.key === 'external_agent');
        expect(contract.config.clientId).toMatchObject({ type: 'oauth_client', required: true });
        expect(stepTypes.validateSteps([step]).valid).toBe(true);
        expect(stepTypes.validateSteps([{ ...step, config: { taskId: TASK } }]).errors).toEqual(['steps[0].config.clientId: required by "external_agent"']);
    });
});

describe('the step and its session', () => {
    it('opens one session per run and step however often the step is claimed, bound to both', async () => {
        const session = await opened();
        expect(session).toMatchObject({ workflowRunId: String(run._id), workflowStepId: STEP, clientId: CLIENT, delegatedBy: OWNER, tainted: true });
        expect((await stepRow()).agentSessionId).toBe(String(session._id));
        const again = await settle(execute());
        expect(isWaiting(again.error)).toBe(true);
        expect(again.error.wait.set).toMatchObject({ agentSessionId: String(session._id) });
        expect(sessionRows()).toHaveLength(1);
        expect(sent).toHaveLength(1);
    });

    it('keeps the task assignee: the session is delegated by the person who started the run', async () => {
        await opened();
        const { recordAudit } = require('../Modules/Audit/recorder');
        expect(recordAudit).toHaveBeenCalledWith(CID, expect.objectContaining({ action: 'agent_session.delegated', actorId: OWNER, meta: expect.objectContaining({ workflowRunId: String(run._id), workflowStepId: STEP }) }));
        expect(require('../Modules/Automations/engine/tools').updateTask).not.toHaveBeenCalled();
    });

    it('completes with the response the outside agent closed the session with', async () => {
        const session = await opened();
        await activity.record(ctxFor(), { sessionId: String(session._id), handle: handleOf(), type: 'action', text: 'Running the tests' });
        await activity.complete(ctxFor(), { sessionId: String(session._id), summary: 'Opened PR #12' });
        const { output } = await settle(execute());
        expect(output).toEqual({ sessionId: String(session._id), state: 'completed', clientId: CLIENT, clientName: 'Coder', response: 'Opened PR #12', activityCount: 2 });
    });

    it('fails a session completed without a response', async () => {
        const session = await opened();
        await activity.complete(ctxFor(), { sessionId: String(session._id), handle: handleOf() });
        const { error } = await settle(execute());
        expect(error).toMatchObject({ deterministic: true, message: expect.stringMatching(/completed without a response/) });
    });

    it('fails on the error the outside agent reports', async () => {
        const session = await opened();
        await activity.fail(ctxFor(), { sessionId: String(session._id), handle: handleOf(), reason: 'The tests would not run' });
        const { error } = await settle(execute());
        expect(error).toMatchObject({ deterministic: true, message: expect.stringMatching(/reported an error: The tests would not run/) });
    });

    it('fails when the outside agent never takes the session up', async () => {
        const session = await opened();
        await lifecycle.expire(session, new Date(Date.now() + 11000));
        const { error } = await settle(execute());
        expect(error).toMatchObject({ deterministic: true, message: expect.stringMatching(/unresponsive/) });
    });

    it('fails when the session is revoked, naming why', async () => {
        const session = await opened();
        await lifecycle.close(session, 'revoked', 'the grant behind this session was revoked or has expired');
        const { error } = await settle(execute());
        expect(error).toMatchObject({ deterministic: true, message: expect.stringMatching(/revoked: the grant behind this session was revoked/) });
    });

    it('fails at its deadline and closes the session so the outside agent stops', async () => {
        await setStep({ config: { clientId: CLIENT, deadlineMs: 60000 } });
        const session = await opened();
        await db().crud(CID, { type: SCHEMA_TYPE.AGENT_SESSIONS, data: [{ _id: String(session._id) }, { $set: { createdAt: new Date(Date.now() - 120000) } }] }, 'updateOne');
        const { error } = await settle(execute());
        expect(error).toMatchObject({ deterministic: true, message: expect.stringMatching(/deadline/) });
        expect(await sessions.find(CID, session._id)).toMatchObject({ state: 'failed', reason: expect.stringMatching(/deadline/) });
    });

    it('waits no longer than the run has left', async () => {
        await opened();
        const deadlineAt = new Date(Date.now() + 5000);
        const { error } = await settle(execute({ deadlineAt }));
        expect(error.until.getTime()).toBeLessThanOrEqual(deadlineAt.getTime());
    });

    it('fails without retrying when the delegation is refused', async () => {
        clients.clientStanding.mockResolvedValue({ ok: false, name: '' });
        const { error } = await settle(execute());
        expect(error).toMatchObject({ deterministic: true, message: expect.stringMatching(/not approved in this workspace/) });
        expect(sessionRows()).toHaveLength(0);
    });

    it('fails without a task to delegate', async () => {
        await setRun({ taskId: null });
        const { error } = await settle(execute());
        expect(error).toMatchObject({ deterministic: true, message: expect.stringMatching(/task/) });
    });

    it('wakes its step when the session closes', async () => {
        const session = await opened();
        await activity.complete(ctxFor(), { sessionId: String(session._id), handle: handleOf(), summary: 'done' });
        await new Promise((resolve) => setImmediate(resolve));
        expect(queue.dispatch).toHaveBeenCalledWith(CID, String(run._id));
        expect((await stepRow()).nextAttemptAt).toBeNull();
    });
});

describe('the live check on a session bound to a waiting step', () => {
    let session;
    beforeEach(async () => { session = await opened(); });

    it('passes an open session on a running run whose step waits for it, under a live grant', async () => {
        expect(await externalSession.liveCheck(CID, session)).toMatchObject({ ok: true });
    });

    it('refuses a closed session', async () => {
        const closed = await lifecycle.close(session, 'failed', 'gave up');
        expect(await externalSession.liveCheck(CID, closed)).toMatchObject({ ok: false, code: externalSession.REFUSAL.SESSION_CLOSED });
    });

    it('refuses a session whose run was stopped', async () => {
        await setRun({ status: 'stopped' });
        expect(await externalSession.liveCheck(CID, session)).toMatchObject({ ok: false, code: externalSession.REFUSAL.RUN_NOT_RUNNING });
    });

    it('refuses a session whose step is no longer waiting', async () => {
        await setStep({ status: 'failed' });
        expect(await externalSession.liveCheck(CID, session)).toMatchObject({ ok: false, code: externalSession.REFUSAL.STEP_NOT_WAITING });
        await setStep({ status: 'pending', agentSessionId: '6b00000000000000000000ff' });
        expect(await externalSession.liveCheck(CID, session)).toMatchObject({ ok: false, code: externalSession.REFUSAL.STEP_NOT_WAITING });
    });

    it('refuses a session whose grant is no longer live', async () => {
        clients.grantStanding.mockResolvedValue(false);
        expect(await externalSession.liveCheck(CID, session)).toMatchObject({ ok: false, code: externalSession.REFUSAL.GRANT_NOT_LIVE, closeAs: 'revoked' });
    });

    it('refuses an activity on a stopped run, closes the session and records the refusal', async () => {
        await setRun({ status: 'stopped' });
        const error = await activity.record(ctxFor(), { sessionId: String(session._id), handle: handleOf(), type: 'thought', text: 'hello' }).catch((e) => e);
        expect(error).toBeInstanceOf(RefusedError);
        expect(error.message).toMatch(/run_not_running/);
        expect(await sessions.find(CID, session._id)).toMatchObject({ state: 'failed' });
        expect(agentAudit.recordRefusal).toHaveBeenCalledWith(CID, expect.objectContaining({ clientId: CLIENT, delegatedBy: OWNER }), expect.objectContaining({ action: 'session.activity' }));
    });

    it('refuses a tool call from the grant of a session whose step stopped waiting, once', async () => {
        await setStep({ status: 'skipped' });
        const error = await externalSession.checkToolCall(ctxFor(), 'tasks.update').catch((e) => e);
        expect(error).toBeInstanceOf(RefusedError);
        expect(error.message).toMatch(/step_not_waiting/);
        expect(await sessions.find(CID, session._id)).toMatchObject({ state: 'failed' });
        await expect(externalSession.checkToolCall(ctxFor(), 'tasks.update')).resolves.toBeUndefined();
    });

    it('lets a tool call through while the step waits, and from a grant bound to no step', async () => {
        await expect(externalSession.checkToolCall(ctxFor(), 'tasks.update')).resolves.toBeUndefined();
        await expect(externalSession.checkToolCall(ctxFor({ grantId: 'grant-other' }), 'tasks.update')).resolves.toBeUndefined();
    });

    it('holds a risky write from the session for a person under tainted-run routing', () => {
        process.env.AGENT_TAINT_ROUTING = 'on';
        try {
            const { heldForApproval } = require('../Modules/Mcp/taintHold');
            const { rating } = require('../Modules/Agents/actions');
            const { escalations } = require('../Modules/Agents/policy');
            const risky = require('../Modules/Agents/registry').keys().find((key) => rating(key) && escalations(rating(key)).length);
            expect(heldForApproval(ctxFor(), risky)).toMatch(/outside client/);
        } finally {
            delete process.env.AGENT_TAINT_ROUTING;
        }
    });
});

describe('a revoked grant mid-step', () => {
    const RAW = `${tokenHash.PREFIX.access}${'a'.repeat(43)}`;
    let session;

    beforeEach(async () => {
        session = await opened();
        await activity.record(ctxFor(), { sessionId: String(session._id), handle: handleOf(), type: 'action', text: 'Running the tests' });
        globalDb().seed(SCHEMA_TYPE.OAUTH_TOKENS, { tokenHash: tokenHash.hashOf(RAW), kind: 'access', grantId: 'grant-1', clientId: CLIENT, companyId: CID, userId: OWNER });
        globalDb().seed(SCHEMA_TYPE.OAUTH_GRANTS, { grantId: 'grant-1', clientId: CLIENT, companyId: CID, userId: OWNER, revokedAt: new Date(), revokedReason: 'revoked_by_user' });
    });

    it('revokes the session on the refused call, attributes the refusal to the agent and the delegating person, and fails the step by name', async () => {
        clients.grantStanding.mockResolvedValue(false);
        const closed = await externalSession.refuseRevokedToken(RAW, { action: 'session.activity', ip: '203.0.113.9' });
        expect(closed).toEqual([String(session._id)]);
        expect(await sessions.find(CID, session._id)).toMatchObject({ state: 'revoked', reason: expect.stringMatching(/grant .*revoked/) });
        expect(agentAudit.recordRefusal).toHaveBeenCalledWith(
            CID,
            expect.objectContaining({ viaAccount: 'external', clientId: CLIENT, grantId: 'grant-1', delegatedBy: OWNER, userId: OWNER }),
            expect.objectContaining({ action: 'session.activity', entityType: 'agent_session', entityId: String(session._id), params: expect.objectContaining({ workflowRunId: String(run._id), stepId: STEP }) }),
        );
        const { error } = await settle(execute());
        expect(error).toMatchObject({ deterministic: true, message: expect.stringMatching(/revoked: the grant behind this session was revoked/) });
    });

    it('leaves the session alone when only the access token died and the grant lives', async () => {
        clients.grantStanding.mockResolvedValue(true);
        expect(await externalSession.refuseRevokedToken(RAW, { action: 'session.activity' })).toEqual([]);
        expect((await sessions.find(CID, session._id)).state).toBe('active');
        expect(agentAudit.recordRefusal).not.toHaveBeenCalled();
    });

    it('does nothing with the flag off', async () => {
        clients.grantStanding.mockResolvedValue(false);
        delete process.env.EXTERNAL_AGENT_STEPS;
        try {
            expect(await externalSession.refuseRevokedToken(RAW, { action: 'session.activity' })).toEqual([]);
        } finally {
            process.env.EXTERNAL_AGENT_STEPS = 'on';
        }
        expect((await sessions.find(CID, session._id)).state).toBe('active');
    });
});
