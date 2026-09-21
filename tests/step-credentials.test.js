process.env.JWT_SECRET = process.env.JWT_SECRET || 'step-credential-test-secret';
process.env.JWT_ALGORITHM = 'HS256';
process.env.JWT_EXP = '24h';

const mockDb = require('./fixtures/fakeMongo').create();

const ROLES = { owner1: 1, admin1: 2, member1: 3, member2: 3, guest1: 0, '6f0000000000000000000102': 3 };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async (c, uid) => (uid in ROLES ? ROLES[uid] : null)),
    isPrivileged: (r) => r === 1 || r === 2,
    evaluatePermission: jest.fn(async () => 'write'),
    isWritable: () => true,
    isReadable: () => true,
}));
jest.mock('../Modules/Agents/permissions', () => ({ holderMay: jest.fn(async () => ({ allowed: true, reason: '', permission: null })), REASON: 'permission_denied' }));
jest.mock('../Modules/ApiTokens/controller', () => ({
    ...jest.requireActual('../Modules/ApiTokens/controller'),
    resolveToken: jest.fn(async () => ({ token: null, refusal: 'Invalid, expired or revoked API token' })),
    logTokenActivity: jest.fn(),
}));

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const permissions = require('../Modules/Agents/permissions');
const apiTokenCtrl = require('../Modules/ApiTokens/controller');
const { looksLikeToken } = require('../Modules/ApiTokens/helpers/apiTokenRules');
const { verifyJWTTokenV2, verifyJWTTokenWithCV2 } = require('../Config/jwt');
const actor = require('../Modules/Agents/actor');
const actions = require('../Modules/Agents/actions');
const agentAudit = require('../Modules/Agents/agentAudit');
const store = require('../Modules/Workflows/store');
const engine = require('../Modules/Workflows/engine');
const stepCredential = require('../Modules/Workflows/stepCredential');
const agentRunner = require('../Modules/Workflows/agentRun');
const agentRuns = require('../Modules/Agents/runs');
const automationTools = require('../Modules/Automations/engine/tools');
const automationRegistry = require('../Modules/Automations/engine/registry');
require('../Modules/Workflows/stepTypes');

const C = '6f0000000000000000000c01';
const OTHER_C = '6f0000000000000000000c02';
const AGENT_ID = '6f0000000000000000000a01';
const STARTER = '6f0000000000000000000101';
const OTHER_STARTER = '6f0000000000000000000102';
const TASK_ID = '6f0000000000000000000701';
const AGENT_RUN_ID = '6f0000000000000000000b01';
const ENV_KEYS = ['STEP_CREDENTIALS', 'STEP_CREDENTIAL_SECRET', 'WORKFLOW_ENGINE', 'WORKFLOW_LEASE_MS', 'WORKFLOW_HEARTBEAT_MS', 'WORKFLOW_TENANT_CONCURRENCY'];
const saved = {};

const rows = (type) => mockDb.store[type] || [];
const auditRows = (action) => rows(SCHEMA_TYPE.AUDIT_LOGS).filter((r) => r.action === action);
const flag = (on) => { if (on) process.env.STEP_CREDENTIALS = 'on'; else delete process.env.STEP_CREDENTIALS; };

const seedAgent = (over = {}) => mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: AGENT_ID, name: 'Reviewer', allowedActions: ['task.comment', 'task.get'], autonomy: 2, deletedStatusKey: 0, ...over });

const seedRun = (runId, over = {}) => {
    const steps = over.steps || [{ id: 'sAgent', type: 'agent_run', dependsOn: [], config: { agentId: AGENT_ID, taskId: TASK_ID }, maxAttempts: 3 }];
    const run = mockDb.seed(SCHEMA_TYPE.WORKFLOW_RUNS, {
        _id: runId, workflowId: `agent:${AGENT_ID}`, name: 'Nightly review', source: 'agent_run', status: 'running',
        startedBy: STARTER, agentId: AGENT_ID, taskId: TASK_ID, definition: { steps }, outputs: {}, spentUsd: 0, depth: 0, startedAt: new Date(),
        ...over, steps: undefined,
    });
    delete run.steps;
    store.stepRowsFor(runId, steps).forEach((row) => mockDb.seed(SCHEMA_TYPE.WORKFLOW_STEP_RUNS, row));
    return run;
};

const agentActor = (over = {}) => ({ kind: 'agent', userId: STARTER, agentId: AGENT_ID, agentName: 'Reviewer', runId: 'agentrun1', viaAccount: 'workspace', tokenId: null, ...over });

/* A claimed step and the credential the engine would mint for it. */
const claimAndMint = async (runId = 'r1', { lease = 60000, actionsGranted = ['task.comment', 'task.get'], now = new Date() } = {}) => {
    const run = await store.getRun(C, runId);
    const claimed = await store.claimStep(C, { runId, stepId: 'sAgent', workerId: 'w1', lease, now });
    const minted = stepCredential.mint({ companyId: C, run, step: claimed, actions: actionsGranted, now });
    const claim = { runId, stepId: 'sAgent', fencingToken: Number(claimed.fencingToken) };
    await store.noteStep(C, claim, { credentialId: minted.credentialId, credentialExpiresAt: minted.expiresAt });
    return { run, claimed, claim, ...minted };
};

const ONLY_THE_CLOCK = ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'];
const freezeClockAt = (now) => jest.useFakeTimers({ doNotFake: ONLY_THE_CLOCK, now });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const performWith = (token, over = {}) => actions.perform({ companyId: C, actor: agentActor({ stepCredential: token }), action: 'task.comment', params: { body: 'hello' }, ...over });

const response = () => {
    const res = { statusCode: 200, body: undefined, cookies: {} };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    res.send = res.json;
    res.clearCookie = () => res;
    return res;
};

beforeAll(() => { ENV_KEYS.forEach((k) => { saved[k] = process.env[k]; }); });
beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    ENV_KEYS.forEach((k) => delete process.env[k]);
    process.env.WORKFLOW_ENGINE = 'on';
    process.env.WORKFLOW_TENANT_CONCURRENCY = '10';
    permissions.holderMay.mockImplementation(async () => ({ allowed: true, reason: '', permission: null }));
    actions.executors['task.comment'] = async ({ params }) => ({ result: { commentId: 'c1' }, undo: null, entityId: params.taskId });
    seedAgent();
    mockDb.seed(dbCollections.USERS, { _id: STARTER, Employee_Name: 'Olivia Owner' });
    mockDb.seed(dbCollections.USERS, { _id: OTHER_STARTER, Employee_Name: 'Max Member' });
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });
afterAll(() => { ENV_KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); });

describe('with STEP_CREDENTIALS off, nothing changes', () => {
    it('claims a step without a credential, writes no credential fields and attributes the step as beta does', async () => {
        flag(false);
        const run = seedRun('r1');
        const seen = [];
        const pending = (await store.listSteps(C, 'r1'))[0];
        const steps = await store.listSteps(C, 'r1');
        mockDb.calls.length = 0;
        const result = await engine.runStep(C, run, pending, {
            context: { runAgent: async (args) => { seen.push(args); await args.keepAlive(); return { runId: 'ar1', status: 'done', costUsd: 0, findings: [] }; } },
            steps,
        });
        expect(result.outcome).toBe('success');
        expect(seen).toHaveLength(1);
        expect(seen[0].stepCredential).toBeFalsy();
        expect(mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.AGENTS)).toEqual([]);
        const row = await store.getStep(C, 'r1', 'sAgent');
        expect('credentialId' in row).toBe(false);
        expect('credentialExpiresAt' in row).toBe(false);
        expect(stepCredential.enabled()).toBe(false);
        expect(engine.stepActor(run)).toMatchObject({ kind: 'agent', userId: STARTER, agentId: null });
        const [stepRow] = auditRows(agentAudit.ACTION_DONE);
        expect(stepRow).toMatchObject({ actorId: STARTER, meta: { actorType: 'agent', action: 'workflow.agent_run' } });
        expect(stepRow.meta.service).toBeUndefined();
    });

    it('keeps the tokens list policy as it is, and names the flag there only while it is on', async () => {
        const policy = async () => {
            const res = response();
            await apiTokenCtrl.listTokens({ headers: { companyid: C }, body: {}, params: {}, query: {}, uid: STARTER }, res);
            return res.body.policy;
        };
        flag(false);
        expect(Object.keys(await policy()).sort()).toEqual(['graceDays', 'maxExpiryDays', 'minExpiryDays', 'scopes', 'strict', 'strictSince']);
        flag(true);
        expect((await policy()).stepCredentials).toBe(true);
    });

    it.each(actor.SERVICES)('answers service:%s as a bearer exactly as any other value that is not a token', async (service) => {
        flag(false);
        const raw = `service:${service}`;
        const res = response();
        await verifyJWTTokenV2({ headers: { authorization: `Bearer ${raw}`, companyid: C }, originalUrl: '/api/v2/tasks' }, res, jest.fn());
        expect(res.statusCode).toBe(401);
        expect(res.body).toEqual({ status: false, error: 'jwt malformed', statusText: 'Unauthorized', isJwtError: true });
    });

    it('is off for every spelling that is not on', () => {
        ['', 'off', 'false', '0', 'no'].forEach((v) => { process.env.STEP_CREDENTIALS = v; expect(stepCredential.enabled()).toBe(false); });
        ['on', 'true', '1', 'yes'].forEach((v) => { process.env.STEP_CREDENTIALS = v; expect(stepCredential.enabled()).toBe(true); });
    });
});

describe('service identities', () => {
    it.each(actor.SERVICES)('resolves %s as a service actor that attribution names as the component', (service) => {
        const a = actor.serviceActor(service, { runId: 'r1', userId: STARTER });
        expect(a).toMatchObject({ kind: 'service', service, runId: 'r1', userId: STARTER, agentId: null, tokenId: null });
        expect(actor.isAgent(a)).toBe(false);
        expect(actor.isService(a)).toBe(true);
        expect(actor.attribution(a)).toMatchObject({ actorType: 'service', actorId: `service:${service}`, service });
        expect(actor.attribution(a).label).toMatch(/engine|worker|indexer|router/i);
    });

    it('names exactly the four components and refuses any other', () => {
        expect([...actor.SERVICES]).toEqual(['engine', 'worker', 'indexer', 'router']);
        expect(() => actor.serviceActor('cron')).toThrow(/service/);
    });

    it('is never what a request resolves to', async () => {
        const human = await actor.resolveActor({ headers: {}, uid: STARTER, body: {} });
        expect(human.kind).toBe('human');
        const named = await actor.resolveActor({ headers: { 'x-actor-kind': 'service' }, uid: STARTER, body: { kind: 'service', service: 'engine' } });
        expect(named.kind).toBe('human');
    });

    it('appears in the audit row of a refusal it records', async () => {
        await agentAudit.recordRefusal(C, actor.serviceActor('indexer'), { action: 'docs.read', reason: 'no', params: {} });
        const [row] = auditRows(agentAudit.ACTION_REFUSED);
        expect(row).toMatchObject({ actorId: 'service:indexer', meta: { actorType: 'service', service: 'indexer', agentId: null, onBehalfOf: null } });
    });

    it.each(actor.SERVICES)('%s cannot be presented as a bearer token', async (service) => {
        flag(true);
        const raw = `service:${service}`;
        expect(looksLikeToken(raw)).toBe(false);
        expect(actor.looksLikeServiceIdentity(raw)).toBe(true);
        const res = response();
        const next = jest.fn();
        await verifyJWTTokenV2({ headers: { authorization: `Bearer ${raw}`, companyid: C }, originalUrl: '/api/v2/tasks' }, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
        expect(res.body.error).toMatch(/service identity/i);
        expect(apiTokenCtrl.resolveToken).not.toHaveBeenCalled();
    });
});

describe('minting on claim', () => {
    beforeEach(() => flag(true));

    it('signs the step, its fencing token and its actor context, expiring with the lease', async () => {
        seedRun('r1');
        const now = new Date();
        const { claimed, token, credentialId, expiresAt, claims } = await claimAndMint('r1', { lease: 45000, now });
        expect(token).not.toContain(credentialId);
        const leaseEnd = new Date(claimed.leaseExpiresAt).getTime();
        expect(expiresAt.getTime()).toBeGreaterThanOrEqual(leaseEnd);
        expect(expiresAt.getTime() - leaseEnd).toBeLessThan(1000);
        expect(claims).toMatchObject({ kind: 'step_credential', jti: credentialId, companyId: C, runId: 'r1', stepId: 'sAgent', stepRunId: String(claimed._id), fencingToken: 1, agentId: AGENT_ID, startedBy: STARTER, actions: ['task.comment', 'task.get'] });
        const decoded = jwt.decode(token);
        expect(decoded.exp).toBe(Math.floor(expiresAt.getTime() / 1000));
        expect(decoded.fencingToken).toBe(1);
        expect(() => jwt.verify(token, process.env.JWT_SECRET)).toThrow();
    });

    it('is minted by the engine when it claims an agent step, with the agent\'s allowed actions, and stored on the row as an id and an expiry', async () => {
        process.env.WORKFLOW_LEASE_MS = '30000';
        const run = seedRun('r1');
        const seen = [];
        const before = Date.now();
        const result = await engine.runStep(C, run, (await store.listSteps(C, 'r1'))[0], {
            context: { runAgent: async (args) => { seen.push(args); return { runId: 'ar1', status: 'done', costUsd: 0, findings: [] }; } },
            steps: await store.listSteps(C, 'r1'),
        });
        expect(result.outcome).toBe('success');
        const credential = seen[0].stepCredential();
        expect(typeof credential).toBe('string');
        const claims = jwt.decode(credential);
        expect(claims).toMatchObject({ kind: 'step_credential', companyId: C, runId: 'r1', stepId: 'sAgent', fencingToken: 1, agentId: AGENT_ID, startedBy: STARTER, actions: ['task.comment', 'task.get'] });
        const row = await store.getStep(C, 'r1', 'sAgent');
        expect(row.credentialId).toBe(claims.jti);
        expect(new Date(row.credentialExpiresAt).getTime()).toBe(claims.exp * 1000);
        expect(new Date(row.credentialExpiresAt).getTime()).toBeGreaterThanOrEqual(before + 30000 - 1000);
        expect(JSON.stringify(row)).not.toContain(credential);
    });

    it('grants every registry action to an agent that narrows nothing, and one tool to a tool call', async () => {
        const registry = require('../Modules/Agents/registry');
        expect(stepCredential.actionsFor({ type: 'agent_run', config: {} }, { allowedActions: [] })).toEqual(registry.keys());
        expect(stepCredential.actionsFor({ type: 'agent_run', config: {} }, { allowedActions: ['task.get'] })).toEqual(['task.get']);
        expect(stepCredential.actionsFor({ type: 'agent_run', config: {} }, null)).toEqual([]);
        expect(stepCredential.actionsFor({ type: 'tool_call', config: { tool: 'task.comment' } }, null)).toEqual(['task.comment']);
        expect(stepCredential.actionsFor({ type: 'wait', config: {} }, null)).toEqual([]);
    });

    const runAgentStep = async (run, seen) => engine.runStep(C, run, (await store.listSteps(C, String(run._id)))[0], {
        context: { runAgent: async (args) => { seen.push(args); return { runId: 'ar1', status: 'done', costUsd: 0, findings: [] }; } },
        steps: await store.listSteps(C, String(run._id)),
    });

    it('grants nothing to an agent step whose agent does not exist', async () => {
        rows(SCHEMA_TYPE.AGENTS).length = 0;
        const seen = [];
        expect((await runAgentStep(seedRun('r1'), seen)).outcome).toBe('success');
        expect(jwt.decode(seen[0].stepCredential())).toMatchObject({ agentId: AGENT_ID, actions: [] });
    });

    it('hands the step back, with no credential, when its agent cannot be read', async () => {
        jest.spyOn(agentRuns, 'getAgent').mockRejectedValue(new Error('mongo went away'));
        const seen = [];
        const result = await runAgentStep(seedRun('r1'), seen);
        expect(result.outcome).toBe('retrying');
        expect(seen).toHaveLength(0);
        const row = await store.getStep(C, 'r1', 'sAgent');
        expect(row).toMatchObject({ status: 'pending', leaseExpiresAt: null });
        expect(row.error).toContain('mongo went away');
        expect('credentialId' in row).toBe(false);
    });

    it('hands the step back when minting itself fails, rather than leaving it claimed for a lease', async () => {
        jest.spyOn(stepCredential, 'issue').mockRejectedValue(new Error('no key to sign with'));
        const seen = [];
        const result = await runAgentStep(seedRun('r1'), seen);
        expect(result.outcome).toBe('retrying');
        expect(seen).toHaveLength(0);
        expect(await store.getStep(C, 'r1', 'sAgent')).toMatchObject({ status: 'pending', leaseExpiresAt: null });
    });

    it('finds the agent of a step that names only its agent run, and grants nothing when that run is gone', async () => {
        const onlyTheRun = [{ id: 'sAgent', type: 'agent_run', dependsOn: [], config: { agentRunId: AGENT_RUN_ID }, maxAttempts: 3 }];
        mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { _id: AGENT_RUN_ID, agentId: AGENT_ID, taskId: TASK_ID, startedBy: STARTER, status: 'running' });
        const seen = [];
        await runAgentStep(seedRun('r1', { agentId: null, steps: onlyTheRun }), seen);
        expect(jwt.decode(seen[0].stepCredential())).toMatchObject({ agentId: AGENT_ID, actions: ['task.comment', 'task.get'] });

        rows(SCHEMA_TYPE.AGENT_RUNS).length = 0;
        await runAgentStep(seedRun('r2', { agentId: null, steps: onlyTheRun }), seen);
        expect(jwt.decode(seen[1].stepCredential())).toMatchObject({ agentId: null, actions: [] });
    });

    it('mints for the agent of the agent run a step names, as the runner executes it, over the run\'s own agent', async () => {
        const OTHER_AGENT = '6f0000000000000000000a02';
        mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: OTHER_AGENT, name: 'Writer', allowedActions: ['task.create'], autonomy: 2, deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { _id: AGENT_RUN_ID, agentId: OTHER_AGENT, taskId: TASK_ID, startedBy: STARTER, status: 'running' });
        const seen = [];
        await runAgentStep(seedRun('r1', { agentId: AGENT_ID, steps: [{ id: 'sAgent', type: 'agent_run', dependsOn: [], config: { agentRunId: AGENT_RUN_ID }, maxAttempts: 3 }] }), seen);
        expect(jwt.decode(seen[0].stepCredential())).toMatchObject({ agentId: OTHER_AGENT, actions: ['task.create'] });
    });

    it('hands the step back when the claim\'s note cannot be written, rather than leaving it claimed for a lease', async () => {
        jest.spyOn(store, 'noteStep').mockRejectedValueOnce(new Error('write concern timed out'));
        const seen = [];
        const result = await runAgentStep(seedRun('r1'), seen);
        expect(result.outcome).toBe('retrying');
        expect(seen).toHaveLength(0);
        const row = await store.getStep(C, 'r1', 'sAgent');
        expect(row).toMatchObject({ status: 'pending', leaseExpiresAt: null });
        expect(row.error).toContain('write concern timed out');
    });

    it('records the step under the engine service identity, on behalf of whoever started the run', async () => {
        const run = seedRun('r1');
        await engine.runStep(C, run, (await store.listSteps(C, 'r1'))[0], {
            context: { runAgent: async () => ({ runId: 'ar1', status: 'done', costUsd: 0, findings: [] }) },
            steps: await store.listSteps(C, 'r1'),
        });
        const [stepRow] = auditRows(agentAudit.ACTION_DONE);
        expect(stepRow).toMatchObject({ actorId: 'service:engine', meta: { actorType: 'service', service: 'engine', action: 'workflow.agent_run', onBehalfOf: STARTER, runId: 'r1' } });
        expect(engine.stepActor(run)).toMatchObject({ kind: 'service', service: 'engine' });
    });

    it('is signed with a key of its own, from STEP_CREDENTIAL_SECRET when set', async () => {
        seedRun('r1');
        const { token } = await claimAndMint('r1');
        process.env.STEP_CREDENTIAL_SECRET = 'a-dedicated-secret-for-step-credentials';
        expect((await stepCredential.check(C, token, { action: 'task.get', actor: agentActor() })).code).toBe(stepCredential.REFUSAL.INVALID);
        seedRun('r2');
        const fresh = await claimAndMint('r2');
        expect((await stepCredential.check(C, fresh.token, { action: 'task.get', actor: agentActor() })).ok).toBe(true);
    });
});

describe('an action under a step credential', () => {
    beforeEach(() => flag(true));

    it('passes when the step is live, still claimed under the same fencing token, inside its lease and granted the action', async () => {
        seedRun('r1');
        const { token } = await claimAndMint('r1');
        const out = await performWith(token);
        expect(out.auditId).toBeTruthy();
        expect(auditRows(agentAudit.ACTION_REFUSED)).toHaveLength(0);
        await expect(actions.authorizeRead({ companyId: C, actor: agentActor({ stepCredential: token }), action: 'task.get', params: { taskId: TASK_ID } })).resolves.toBe(true);
    });

    const refused = async (token, code, over = {}) => {
        await expect(performWith(token, over)).rejects.toMatchObject({ name: 'RefusedError', message: expect.stringContaining(code) });
        const refusals = auditRows(agentAudit.ACTION_REFUSED);
        expect(refusals).toHaveLength(1);
        expect(refusals[0]).toMatchObject({ actorId: AGENT_ID, meta: { actorType: 'agent', action: over.action || 'task.comment', ran: false } });
        expect(refusals[0].meta.reason).toContain(code);
        return refusals[0];
    };

    it('is refused once the step has finished', async () => {
        seedRun('r1');
        const { token, claim } = await claimAndMint('r1');
        await store.succeedStep(C, claim, { output: {} });
        await refused(token, stepCredential.REFUSAL.STEP_FINISHED);
    });

    it('is refused once the step failed', async () => {
        seedRun('r1');
        const { token, claim } = await claimAndMint('r1');
        await store.failStep(C, claim, { error: 'boom', failure: { type: 'deterministic', deterministic: true } });
        await refused(token, stepCredential.REFUSAL.STEP_FINISHED);
    });

    it('is refused once another worker has reclaimed the step', async () => {
        seedRun('r1');
        const { token, claimed } = await claimAndMint('r1', { lease: 1000 });
        const later = new Date(new Date(claimed.leaseExpiresAt).getTime() + 1);
        const reclaimed = await store.claimStep(C, { runId: 'r1', stepId: 'sAgent', workerId: 'w2', lease: 60000, now: later });
        expect(reclaimed.fencingToken).toBe(2);
        await refused(token, stepCredential.REFUSAL.STEP_RECLAIMED);
    });

    it('reads as reclaimed, not as expired, once the reclaimed step\'s credential has also run out', async () => {
        seedRun('r1');
        const past = new Date(Date.now() - 120000);
        const { token, claimed } = await claimAndMint('r1', { lease: 1000, now: past });
        expect(jwt.decode(token).exp * 1000).toBeLessThan(Date.now());
        const reclaimed = await store.claimStep(C, { runId: 'r1', stepId: 'sAgent', workerId: 'w2', lease: 60000 });
        expect(reclaimed.fencingToken).toBe(claimed.fencingToken + 1);
        await refused(token, stepCredential.REFUSAL.STEP_RECLAIMED);
    });

    it('reads as finished, not as expired, once the settled step\'s credential has also run out', async () => {
        seedRun('r1');
        const past = new Date(Date.now() - 120000);
        const { token, claim } = await claimAndMint('r1', { lease: 1000, now: past });
        await store.succeedStep(C, claim, { output: {} });
        await refused(token, stepCredential.REFUSAL.STEP_FINISHED);
    });

    it('matches ids whatever their case or type, and still tells two ids apart', async () => {
        const upper = AGENT_ID.toUpperCase();
        seedRun('r1', { steps: [{ id: 'sAgent', type: 'agent_run', dependsOn: [], config: { agentId: upper, taskId: TASK_ID }, maxAttempts: 3 }] });
        const { token, claims } = await claimAndMint('r1');
        expect(claims.agentId).toBe(upper);
        const presentedBy = (agentId, userId = STARTER) => stepCredential.check(C, token, { action: 'task.get', actor: agentActor({ agentId, userId }) });
        expect((await presentedBy(AGENT_ID)).ok).toBe(true);
        expect((await presentedBy(upper)).ok).toBe(true);
        expect((await presentedBy(new mongoose.Types.ObjectId(AGENT_ID), new mongoose.Types.ObjectId(STARTER))).ok).toBe(true);
        expect((await presentedBy(AGENT_ID, STARTER.toUpperCase())).ok).toBe(true);
        expect((await stepCredential.check(C.toUpperCase(), token, { action: 'task.get', actor: agentActor() })).ok).toBe(true);
        expect((await presentedBy('6f0000000000000000000a02')).code).toBe(stepCredential.REFUSAL.AGENT_MISMATCH);
        expect((await presentedBy(AGENT_ID, OTHER_STARTER)).code).toBe(stepCredential.REFUSAL.STARTER_MISMATCH);
        expect((await stepCredential.check(OTHER_C, token, { action: 'task.get', actor: agentActor() })).code).toBe(stepCredential.REFUSAL.WRONG_COMPANY);
    });

    it.each(['stopped', 'failed', 'blocked', 'success', 'queued'])('is refused once its run is %s, even while the step row still says running', async (status) => {
        seedRun('r1');
        const { token } = await claimAndMint('r1');
        rows(SCHEMA_TYPE.WORKFLOW_RUNS)[0].status = status;
        const row = await refused(token, stepCredential.REFUSAL.RUN_NOT_RUNNING);
        expect(row.meta.reason).toContain(status);
    });

    it('is refused once its run is gone', async () => {
        seedRun('r1');
        const { token } = await claimAndMint('r1');
        rows(SCHEMA_TYPE.WORKFLOW_RUNS).length = 0;
        await refused(token, stepCredential.REFUSAL.RUN_NOT_RUNNING);
    });

    it('is refused when the run was started by someone other than the starter it was minted for', async () => {
        seedRun('r1');
        const { token } = await claimAndMint('r1');
        rows(SCHEMA_TYPE.WORKFLOW_RUNS)[0].startedBy = OTHER_STARTER;
        await refused(token, stepCredential.REFUSAL.STARTER_MISMATCH);
    });

    it('is refused when the row under that run and step is not the row it was minted for', async () => {
        seedRun('r1');
        const { token } = await claimAndMint('r1');
        rows(SCHEMA_TYPE.WORKFLOW_STEP_RUNS)[0]._id = '6f00000000000000000005ff';
        await refused(token, stepCredential.REFUSAL.STEP_MISSING);
    });

    it('is refused when it is signed here but is not a step credential', async () => {
        seedRun('r1');
        const { claims } = await claimAndMint('r1');
        const signingKey = crypto.scryptSync(process.env.JWT_SECRET, 'alianhub-step-credential', 32);
        const otherKind = jwt.sign({ ...claims, kind: 'session', exp: Math.floor(Date.now() / 1000) + 600 }, signingKey, { algorithm: 'HS256' });
        await refused(otherKind, stepCredential.REFUSAL.INVALID);
    });

    it('is refused when the row names neither it nor the credential it replaced', async () => {
        seedRun('r1');
        const { token } = await claimAndMint('r1');
        const step = rows(SCHEMA_TYPE.WORKFLOW_STEP_RUNS)[0];
        step.previousCredentialId = step.credentialId;
        step.credentialId = 'a-later-credential';
        expect((await stepCredential.check(C, token, { action: 'task.get', actor: agentActor() })).ok).toBe(true);
        step.previousCredentialId = 'the-one-before';
        await refused(token, stepCredential.REFUSAL.SUPERSEDED);
    });

    it('stops a read, too, once the step has finished', async () => {
        seedRun('r1');
        const { token, claim } = await claimAndMint('r1');
        await store.succeedStep(C, claim, { output: {} });
        await expect(actions.authorizeRead({ companyId: C, actor: agentActor({ stepCredential: token }), action: 'task.get', params: { taskId: TASK_ID } }))
            .rejects.toMatchObject({ name: 'RefusedError', message: expect.stringContaining(stepCredential.REFUSAL.STEP_FINISHED) });
        expect(auditRows(agentAudit.ACTION_REFUSED)).toHaveLength(1);
    });

    it('is refused when the actor says it acts under a credential and carries none', async () => {
        seedRun('r1');
        await claimAndMint('r1');
        await expect(actions.perform({ companyId: C, actor: agentActor({ stepScoped: true }), action: 'task.comment', params: { body: 'x' } }))
            .rejects.toMatchObject({ name: 'RefusedError', message: expect.stringContaining(stepCredential.REFUSAL.MISSING) });
        expect(auditRows(agentAudit.ACTION_REFUSED)).toHaveLength(1);
    });

    it('is refused when another agent presents it', async () => {
        seedRun('r1');
        const { token } = await claimAndMint('r1');
        const other = '6f0000000000000000000a02';
        await expect(actions.perform({ companyId: C, actor: agentActor({ agentId: other, stepCredential: token }), action: 'task.comment', params: { body: 'x' } }))
            .rejects.toMatchObject({ name: 'RefusedError', message: expect.stringContaining(stepCredential.REFUSAL.AGENT_MISMATCH) });
        const [row] = auditRows(agentAudit.ACTION_REFUSED);
        expect(row).toMatchObject({ actorId: other, meta: { ran: false } });
        expect(row.meta.reason).toContain(stepCredential.REFUSAL.AGENT_MISMATCH);
    });

    it('is refused when the step row names another agent than the credential', async () => {
        seedRun('r1');
        const { token } = await claimAndMint('r1');
        rows(SCHEMA_TYPE.WORKFLOW_STEP_RUNS)[0].config.agentId = '6f0000000000000000000a02';
        await refused(token, stepCredential.REFUSAL.AGENT_MISMATCH);
    });

    it('is refused when it is presented on behalf of someone other than the run\'s starter', async () => {
        seedRun('r1');
        const { token } = await claimAndMint('r1');
        await expect(actions.perform({ companyId: C, actor: agentActor({ userId: OTHER_STARTER, stepCredential: token }), action: 'task.comment', params: { body: 'x' } }))
            .rejects.toMatchObject({ name: 'RefusedError', message: expect.stringContaining(stepCredential.REFUSAL.STARTER_MISMATCH) });
        const [row] = auditRows(agentAudit.ACTION_REFUSED);
        expect(row.meta).toMatchObject({ ran: false, onBehalfOf: OTHER_STARTER });
        expect(row.meta.reason).toContain(stepCredential.REFUSAL.STARTER_MISMATCH);
    });

    it('is refused when nobody is named as presenting it', async () => {
        seedRun('r1');
        const { token } = await claimAndMint('r1');
        expect(await stepCredential.check(C, token, { action: 'task.get' })).toMatchObject({ ok: false, code: stepCredential.REFUSAL.AGENT_MISMATCH });
    });

    it('is refused once the lease has run out, even before the credential itself expires', async () => {
        seedRun('r1');
        const { token } = await claimAndMint('r1', { lease: 60000 });
        rows(SCHEMA_TYPE.WORKFLOW_STEP_RUNS)[0].leaseExpiresAt = new Date(Date.now() - 1);
        await refused(token, stepCredential.REFUSAL.LEASE_EXPIRED);
    });

    it('is refused once the credential itself has expired', async () => {
        seedRun('r1');
        const past = new Date(Date.now() - 120000);
        const { token } = await claimAndMint('r1', { lease: 60000, now: past });
        rows(SCHEMA_TYPE.WORKFLOW_STEP_RUNS)[0].leaseExpiresAt = new Date(Date.now() + 60000);
        await refused(token, stepCredential.REFUSAL.EXPIRED);
    });

    it('is refused once the step was handed back', async () => {
        seedRun('r1');
        const { token, claim } = await claimAndMint('r1');
        await store.releaseStep(C, claim);
        expect((await store.getStep(C, 'r1', 'sAgent')).status).toBe('pending');
        await refused(token, stepCredential.REFUSAL.STEP_RELEASED);
    });

    it('is refused for an action outside the step\'s granted set', async () => {
        seedRun('r1');
        const { token } = await claimAndMint('r1', { actionsGranted: ['task.get'] });
        await refused(token, stepCredential.REFUSAL.ACTION_NOT_GRANTED);
    });

    it('is refused in another company', async () => {
        seedRun('r1');
        const { token } = await claimAndMint('r1');
        await expect(actions.perform({ companyId: OTHER_C, actor: agentActor({ stepCredential: token }), action: 'task.comment', params: { body: 'x' } })).rejects.toMatchObject({ name: 'RefusedError', message: expect.stringContaining(stepCredential.REFUSAL.WRONG_COMPANY) });
    });

    it('is refused when it was not signed here', async () => {
        seedRun('r1');
        const { claims } = await claimAndMint('r1');
        const forged = jwt.sign({ ...claims, exp: Math.floor(Date.now() / 1000) + 600 }, process.env.JWT_SECRET, { algorithm: 'HS256' });
        await refused(forged, stepCredential.REFUSAL.INVALID);
    });

    it('never widens what the run\'s actor may do: the registry and the holder\'s permissions still apply', async () => {
        seedRun('r1');
        const { token } = await claimAndMint('r1', { actionsGranted: ['task.comment', 'task.get', 'task.create'] });
        permissions.holderMay.mockImplementation(async () => ({ allowed: false, reason: 'permission_denied: task.task_comment is not granted to the person behind this agent', permission: 'task.task_comment' }));
        await refused(token, 'permission_denied');
        permissions.holderMay.mockImplementation(async () => ({ allowed: true, reason: '', permission: null }));
        await expect(performWith(token, { allowedActions: ['task.get'] })).rejects.toMatchObject({ name: 'RefusedError', message: expect.stringContaining("not in this agent's skills") });
    });

    it('cannot be presented as a bearer token on either verifier', async () => {
        seedRun('r1');
        const { token } = await claimAndMint('r1');
        expect(looksLikeToken(token)).toBe(false);
        for (const verify of [verifyJWTTokenV2, verifyJWTTokenWithCV2]) {
            const res = response();
            const next = jest.fn();
            // eslint-disable-next-line no-await-in-loop
            await verify({ headers: { authorization: `Bearer ${token}`, companyid: C }, originalUrl: '/api/v2/tasks', body: {}, query: {}, params: {} }, res, next);
            expect(next).not.toHaveBeenCalled();
            expect(res.statusCode).toBe(401);
            expect(res.body.error).toMatch(/step-scoped credential/i);
        }
        expect(apiTokenCtrl.resolveToken).not.toHaveBeenCalled();
    });
});

describe('a heartbeat that extends the lease', () => {
    const T0 = Date.UTC(2030, 0, 1, 12, 0, 0);
    const until = async (condition) => { for (let i = 0; i < 200 && !condition(); i++) await sleep(5); }; // eslint-disable-line no-await-in-loop

    beforeEach(() => {
        flag(true);
        process.env.WORKFLOW_LEASE_MS = '30000';
    });

    it('re-mints the credential under the same fencing token, moves the row to it and hands it to the running step', async () => {
        freezeClockAt(T0);
        const run = seedRun('r1');
        const held = {};
        const presented = { action: 'task.get', actor: agentActor() };
        const result = await engine.runStep(C, run, (await store.listSteps(C, 'r1'))[0], {
            context: {
                runAgent: async (args) => {
                    held.first = args.stepCredential();
                    jest.setSystemTime(T0 + 20000);
                    held.kept = await args.keepAlive();
                    held.second = args.stepCredential();
                    held.row = { ...(await store.getStep(C, 'r1', 'sAgent')) };
                    held.firstInsideItsOwnExpiry = await stepCredential.check(C, held.first, presented);
                    jest.setSystemTime(T0 + 40000);
                    held.firstPastItsOwnExpiry = await stepCredential.check(C, held.first, presented);
                    held.secondThen = await stepCredential.check(C, held.second, presented);
                    return { runId: 'ar1', status: 'done', costUsd: 0, findings: [] };
                },
            },
            steps: await store.listSteps(C, 'r1'),
        });
        expect(result.outcome).toBe('success');
        expect(held.kept).toBe(true);
        const [first, second] = [jwt.decode(held.first), jwt.decode(held.second)];
        expect(second.jti).not.toBe(first.jti);
        expect(second).toMatchObject({ kind: 'step_credential', companyId: C, runId: 'r1', stepId: 'sAgent', stepRunId: first.stepRunId, fencingToken: first.fencingToken, agentId: AGENT_ID, startedBy: STARTER, actions: first.actions });
        expect(first.exp * 1000).toBe(T0 + 30000);
        expect(second.exp * 1000).toBe(T0 + 50000);
        expect(held.row.credentialId).toBe(second.jti);
        expect(new Date(held.row.credentialExpiresAt).getTime()).toBe(T0 + 50000);
        expect(new Date(held.row.leaseExpiresAt).getTime()).toBe(T0 + 50000);
        expect(JSON.stringify(held.row)).not.toContain(held.second);
        expect(held.firstInsideItsOwnExpiry.ok).toBe(true);
        expect(held.firstPastItsOwnExpiry).toMatchObject({ ok: false, code: stepCredential.REFUSAL.EXPIRED });
        expect(held.secondThen.ok).toBe(true);
    });

    it('does not revive a lease that has already lapsed: no extension, no new credential', async () => {
        freezeClockAt(T0);
        const run = seedRun('r1');
        const held = {};
        const result = await engine.runStep(C, run, (await store.listSteps(C, 'r1'))[0], {
            context: {
                runAgent: async (args) => {
                    held.first = args.stepCredential();
                    jest.setSystemTime(T0 + 31000);
                    held.kept = await args.keepAlive();
                    held.after = args.stepCredential();
                    held.row = { ...(await store.getStep(C, 'r1', 'sAgent')) };
                    held.verdict = await stepCredential.check(C, held.first, { action: 'task.get', actor: agentActor() });
                    return { runId: 'ar1', status: 'done', costUsd: 0, findings: [] };
                },
            },
            steps: await store.listSteps(C, 'r1'),
        });
        expect(result.outcome).toBe('success');
        expect(held.kept).toBe(false);
        expect(held.after).toBe(held.first);
        expect(held.row.credentialId).toBe(jwt.decode(held.first).jti);
        expect(new Date(held.row.leaseExpiresAt).getTime()).toBe(T0 + 30000);
        expect(held.verdict).toMatchObject({ ok: false, code: stepCredential.REFUSAL.EXPIRED });
    });

    it('still extends a lapsed lease with the flag off, as before', async () => {
        flag(false);
        freezeClockAt(T0);
        const run = seedRun('r1');
        const held = {};
        await engine.runStep(C, run, (await store.listSteps(C, 'r1'))[0], {
            context: {
                runAgent: async (args) => {
                    jest.setSystemTime(T0 + 31000);
                    held.kept = await args.keepAlive();
                    held.row = { ...(await store.getStep(C, 'r1', 'sAgent')) };
                    return { runId: 'ar1', status: 'done', costUsd: 0, findings: [] };
                },
            },
            steps: await store.listSteps(C, 'r1'),
        });
        expect(held.kept).toBe(true);
        expect(new Date(held.row.leaseExpiresAt).getTime()).toBe(T0 + 61000);
    });

    it('keeps the credential it replaced good until the next heartbeat, and no longer', async () => {
        freezeClockAt(T0);
        const run = seedRun('r1');
        const held = {};
        const presented = { action: 'task.get', actor: agentActor() };
        await engine.runStep(C, run, (await store.listSteps(C, 'r1'))[0], {
            context: {
                runAgent: async (args) => {
                    held.first = args.stepCredential();
                    await args.keepAlive();
                    held.second = args.stepCredential();
                    held.firstAfterOne = await stepCredential.check(C, held.first, presented);
                    await args.keepAlive();
                    held.third = args.stepCredential();
                    held.row = { ...(await store.getStep(C, 'r1', 'sAgent')) };
                    held.firstAfterTwo = await stepCredential.check(C, held.first, presented);
                    held.secondAfterTwo = await stepCredential.check(C, held.second, presented);
                    held.thirdAfterTwo = await stepCredential.check(C, held.third, presented);
                    return { runId: 'ar1', status: 'done', costUsd: 0, findings: [] };
                },
            },
            steps: await store.listSteps(C, 'r1'),
        });
        expect(held.firstAfterOne.ok).toBe(true);
        expect(held.row).toMatchObject({ credentialId: jwt.decode(held.third).jti, previousCredentialId: jwt.decode(held.second).jti });
        expect(held.firstAfterTwo).toMatchObject({ ok: false, code: stepCredential.REFUSAL.SUPERSEDED });
        expect(held.secondAfterTwo.ok).toBe(true);
        expect(held.thirdAfterTwo.ok).toBe(true);
    });

    it('takes two heartbeats at once one after the other, so the step always holds the credential the row names', async () => {
        freezeClockAt(T0);
        const run = seedRun('r1');
        const held = {};
        await engine.runStep(C, run, (await store.listSteps(C, 'r1'))[0], {
            context: {
                runAgent: async (args) => {
                    held.first = args.stepCredential();
                    await Promise.all([args.keepAlive(), args.keepAlive()]);
                    held.now = args.stepCredential();
                    held.row = { ...(await store.getStep(C, 'r1', 'sAgent')) };
                    return { runId: 'ar1', status: 'done', costUsd: 0, findings: [] };
                },
            },
            steps: await store.listSteps(C, 'r1'),
        });
        expect(held.row.credentialId).toBe(jwt.decode(held.now).jti);
        expect(held.row.previousCredentialId).not.toBe(jwt.decode(held.first).jti);
        expect(held.row.previousCredentialId).not.toBe(held.row.credentialId);
    });

    it('lets an agent step that outlives its first credential act under the re-minted one', async () => {
        freezeClockAt(T0);
        process.env.WORKFLOW_HEARTBEAT_MS = '5';
        mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { _id: AGENT_RUN_ID, agentId: AGENT_ID, taskId: TASK_ID, startedBy: STARTER, status: 'running', viaAccount: 'workspace', skill: 'qa-review' });
        const run = seedRun('r1', { steps: [{ id: 'sAgent', type: 'agent_run', dependsOn: [], config: { agentRunId: AGENT_RUN_ID, agentId: AGENT_ID, taskId: TASK_ID }, maxAttempts: 3 }] });
        jest.spyOn(automationTools, 'getTask').mockResolvedValue({ _id: TASK_ID, ProjectID: 'p1' });
        const acted = {};
        jest.spyOn(agentRuns, 'executeSkill').mockImplementation(async (companyId, agentRun, agent, task, deps) => {
            acted.first = deps.actor.stepCredential;
            jest.setSystemTime(T0 + 20000);
            await until(() => deps.actor.stepCredential !== acted.first);
            jest.setSystemTime(T0 + 40000);
            acted.firstVerdict = await stepCredential.check(companyId, acted.first, { action: 'task.comment', actor: deps.actor });
            acted.out = await deps.actions.perform({ companyId, actor: deps.actor, action: 'task.comment', params: { taskId: TASK_ID, body: 'late, and still live' }, allowedActions: agent.allowedActions });
            return { status: 'done' };
        });
        const result = await engine.runStep(C, run, (await store.listSteps(C, 'r1'))[0], { steps: await store.listSteps(C, 'r1') });
        expect(result.outcome).toBe('success');
        expect(acted.firstVerdict).toMatchObject({ ok: false, code: stepCredential.REFUSAL.EXPIRED });
        expect(acted.out.auditId).toBeTruthy();
        expect(auditRows(agentAudit.ACTION_REFUSED)).toHaveLength(0);
    });

    it('builds the run\'s actor so that it always presents the credential the step holds now', async () => {
        let current = 'first';
        const built = agentRunner.actorFor({ _id: AGENT_RUN_ID, startedBy: STARTER, viaAccount: 'workspace' }, { _id: AGENT_ID, name: 'Reviewer' }, () => current);
        expect(built).toMatchObject({ kind: 'agent', userId: STARTER, agentId: AGENT_ID, runId: AGENT_RUN_ID, stepCredential: 'first' });
        current = 'second';
        expect(built.stepCredential).toBe('second');
        const plain = agentRunner.actorFor({ _id: AGENT_RUN_ID, startedBy: STARTER, viaAccount: 'workspace' }, { _id: AGENT_ID, name: 'Reviewer' }, null);
        expect('stepCredential' in plain).toBe(false);
        expect('stepScoped' in plain).toBe(false);
    });

    it('keeps the credential out of any copy of the actor, and a copy is refused rather than left unchecked', async () => {
        seedRun('r1');
        const { token } = await claimAndMint('r1');
        const built = agentRunner.actorFor({ _id: AGENT_RUN_ID, startedBy: STARTER, viaAccount: 'workspace' }, { _id: AGENT_ID, name: 'Reviewer' }, () => token);
        expect(JSON.stringify(built)).not.toContain(token);
        expect(JSON.stringify(built)).not.toContain('eyJ');
        const copy = { ...built };
        expect('stepCredential' in copy).toBe(false);
        expect(Object.keys(built)).not.toContain('stepCredential');
        expect((await actions.perform({ companyId: C, actor: built, action: 'task.comment', params: { body: 'x' } })).auditId).toBeTruthy();
        await expect(actions.perform({ companyId: C, actor: copy, action: 'task.comment', params: { body: 'x' } }))
            .rejects.toMatchObject({ name: 'RefusedError', message: expect.stringContaining(stepCredential.REFUSAL.MISSING) });
    });
});

describe('a tool call step', () => {
    it('hands its tool a context without the credential', async () => {
        flag(true);
        const seen = {};
        jest.spyOn(automationRegistry, 'getAction').mockReturnValue({ key: 'probe', schema: {}, run: async ({ context }) => { seen.context = context; return { changed: false }; } });
        const run = seedRun('r1', { steps: [{ id: 'sTool', type: 'tool_call', dependsOn: [], config: { tool: 'probe', params: {} }, maxAttempts: 1 }] });
        mockDb.calls.length = 0;
        const result = await engine.runStep(C, run, (await store.listSteps(C, 'r1'))[0], { steps: await store.listSteps(C, 'r1') });
        expect(result.outcome).toBe('success');
        expect((await store.getStep(C, 'r1', 'sTool')).credentialId).toBeTruthy();
        expect(seen.context).toMatchObject({ runId: 'r1', action: 'workflow.probe' });
        expect(Object.keys(seen.context)).not.toContain('stepCredential');
        expect(mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.AGENTS)).toEqual([]);
        expect(Object.values(seen.context).filter((value) => typeof value === 'string' && value.startsWith('eyJ'))).toEqual([]);
    });
});

describe('a malformed bearer value', () => {
    const b64 = (text) => Buffer.from(text).toString('base64url');
    const NOT_JSON = `${b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64('not json')}.sig`;
    const VALUES = [NOT_JSON, 'a.b.c', 'garbage'];
    const asBetaSays = (raw) => { try { jwt.verify(raw, process.env.JWT_SECRET); return null; } catch (error) { return error.message; } };
    const request = (raw) => ({ headers: { authorization: `Bearer ${raw}`, companyid: C }, originalUrl: '/api/v2/tasks', body: {}, query: {}, params: {} });

    describe.each([['on', true], ['off', false]])('with STEP_CREDENTIALS %s', (label, on) => {
        beforeEach(() => flag(on));

        it.each(VALUES)('gets the session verifier\'s 401 with the parser\'s message: %s', async (raw) => {
            const res = response();
            const next = jest.fn();
            await verifyJWTTokenV2(request(raw), res, next);
            expect(next).not.toHaveBeenCalled();
            expect(res.statusCode).toBe(401);
            expect(res.body).toEqual({ status: false, error: asBetaSays(raw), statusText: 'Unauthorized', isJwtError: true });
        });

        it.each(VALUES)('gets the company verifier\'s 401: %s', async (raw) => {
            const res = response();
            const next = jest.fn();
            await verifyJWTTokenWithCV2(request(raw), res, next);
            expect(next).not.toHaveBeenCalled();
            expect(res.statusCode).toBe(401);
            expect(res.body).toEqual({ status: false, error: 'Unauthorized', statusText: 'Unauthorized', isJwtError: true });
        });
    });

    it('never reads as a step credential', () => {
        const { looksLikeStepCredential } = require('../Modules/ApiTokens/helpers/bearerRules');
        VALUES.forEach((raw) => expect(looksLikeStepCredential(raw)).toBe(false));
    });
});

describe('the tokens screen list of step-scoped credentials', () => {
    const ROUTE = '/api/v2/api-tokens/step-credentials';
    const ask = async (uid, over = {}) => {
        const res = response();
        await apiTokenCtrl.listStepCredentials({ headers: { companyid: C }, body: {}, params: {}, query: {}, originalUrl: ROUTE, uid, ...over }, res);
        return res;
    };
    const stepReads = () => mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.WORKFLOW_STEP_RUNS);

    beforeEach(async () => {
        flag(true);
        seedRun('r1');
        seedRun('r2', { name: 'Member review', startedBy: OTHER_STARTER });
        seedRun('r3', { name: 'Finished review' });
        await claimAndMint('r1');
        await claimAndMint('r2');
        const third = await claimAndMint('r3');
        await store.succeedStep(C, third.claim, { output: {} });
    });

    const stamp = async (runId) => {
        const claimed = await store.getStep(C, runId, 'sAgent');
        const minted = stepCredential.mint({ companyId: C, run: await store.getRun(C, runId), step: claimed, actions: [] });
        await store.noteStep(C, { runId, stepId: 'sAgent', fencingToken: claimed.fencingToken }, { credentialId: minted.credentialId, credentialExpiresAt: minted.expiresAt });
        return minted;
    };

    it('shows an owner every live credential as its own kind, with run, step and expiry and never the credential', async () => {
        const one = await stamp('r1');
        const two = await stamp('r2');
        const res = await ask('owner1');
        expect(res.statusCode).toBe(200);
        expect(res.body.policy).toMatchObject({ stepCredentials: true });
        const data = res.body.data;
        expect(data.map((r) => r.runId).sort()).toEqual(['r1', 'r2']);
        const mine = data.find((r) => r.runId === 'r1');
        expect(mine).toMatchObject({ kind: 'step_scoped', runId: 'r1', runName: 'Nightly review', stepId: 'sAgent', stepType: 'agent_run', startedBy: { id: STARTER, name: 'Olivia Owner' } });
        expect(new Date(mine.expiresAt).getTime()).toBe(one.expiresAt.getTime());
        expect(mine.issuedAt).toBeTruthy();
        const text = JSON.stringify(res.body);
        [one.token, two.token, one.credentialId, two.credentialId, 'eyJ'].forEach((secret) => expect(text).not.toContain(secret));
        expect(text).not.toMatch(/credentialId|token/);
    });

    it('shows an admin the same list as the owner', async () => {
        await stamp('r1');
        await stamp('r2');
        expect((await ask('admin1')).body.data.map((r) => r.runId).sort()).toEqual(['r1', 'r2']);
    });

    it('shows a member only the credentials of runs they started', async () => {
        await stamp('r1');
        await stamp('r2');
        const res = await ask(OTHER_STARTER);
        expect(res.statusCode).toBe(200);
        expect(res.body.data.map((r) => r.runId)).toEqual(['r2']);
        expect((await ask('member1')).body.data).toEqual([]);
    });

    it('leaves out a settled step and one whose lease has run out', async () => {
        await stamp('r1');
        rows(SCHEMA_TYPE.WORKFLOW_STEP_RUNS).find((r) => r.runId === 'r1').leaseExpiresAt = new Date(Date.now() - 1);
        await stamp('r3').catch(() => null);
        expect((await ask('owner1')).body.data.map((r) => r.runId)).toEqual(['r2']);
    });

    it('refuses an API token, and someone with no seat', async () => {
        expect((await ask('owner1', { apiToken: { _id: 't1', userId: 'owner1' } })).statusCode).toBe(403);
        expect((await ask('6f0000000000000000000a99')).statusCode).toBe(403);
    });

    it('answers an empty list without reading a step while the flag is off', async () => {
        await stamp('r1');
        flag(false);
        mockDb.calls.length = 0;
        const res = await ask('owner1');
        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ status: true, data: [], policy: { stepCredentials: false } });
        expect(stepReads()).toEqual([]);
    });
});
