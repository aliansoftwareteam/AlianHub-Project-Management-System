jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { AIProviderError, TYPES } = require('../Modules/AICore/providerError');
const flag = require('../Modules/Workflows/flag');
const retry = require('../Modules/Workflows/retry');
const scheduler = require('../Modules/Workflows/scheduler');
const store = require('../Modules/Workflows/store');
const concurrency = require('../Modules/Workflows/concurrency');
const idempotency = require('../Modules/Workflows/idempotency');
const executors = require('../Modules/Workflows/executors');
const workflows = require('../Modules/Workflows');

const ENV_KEYS = ['WORKFLOW_ENGINE', 'WORKFLOW_BACKOFF_MS', 'WORKFLOW_TENANT_CONCURRENCY', 'WORKFLOW_MAX_ATTEMPTS', 'WORKFLOW_LEASE_MS'];
const saved = {};

const step = (over = {}) => ({ runId: 'r1', stepId: 's1', index: 0, type: 'noop', dependsOn: [], status: 'pending', attempts: 0, maxAttempts: 3, fencingToken: 0, ...over });

const lastCall = () => MongoDbCrudOpration.mock.calls[MongoDbCrudOpration.mock.calls.length - 1];

beforeAll(() => { ENV_KEYS.forEach((k) => { saved[k] = process.env[k]; }); });
beforeEach(() => { MongoDbCrudOpration.mockReset(); ENV_KEYS.forEach((k) => delete process.env[k]); });
afterAll(() => { ENV_KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); });

describe('the flag', () => {
    it('is off unless it is turned on', () => {
        expect(flag.enabled()).toBe(false);
        process.env.WORKFLOW_ENGINE = 'false';
        expect(flag.enabled()).toBe(false);
        process.env.WORKFLOW_ENGINE = 'on';
        expect(flag.enabled()).toBe(true);
    });

    it('keeps the automation runner backoff ladder as its default', () => {
        expect(flag.backoffLadder()).toEqual(flag.DEFAULT_BACKOFF_MS);
        process.env.WORKFLOW_BACKOFF_MS = '10, 20 ,30';
        expect(flag.backoffLadder()).toEqual([10, 20, 30]);
    });

    it('leases for at least as long as a run may hold the queue lock', () => {
        const { RUN_LOCK_MS } = require('../Modules/Agents/engine/timeouts');
        expect(flag.leaseMs()).toBe(RUN_LOCK_MS);
    });
});

describe('deterministic versus transient', () => {
    it('reads a provider error rather than guessing again', () => {
        const rateLimited = new AIProviderError({ provider: 'openai', type: TYPES.RATE_LIMIT, retryAfterMs: 1500 });
        const refused = new AIProviderError({ provider: 'openai', type: TYPES.INVALID_REQUEST });
        expect(retry.classify(rateLimited)).toMatchObject({ deterministic: false, type: TYPES.RATE_LIMIT, retryAfterMs: 1500 });
        expect(retry.classify(refused)).toMatchObject({ deterministic: true, type: TYPES.INVALID_REQUEST });
    });

    it('honours an explicit flag over every heuristic', () => {
        const typeError = Object.assign(new TypeError('x is not a function'), { deterministic: false });
        expect(retry.classify(typeError).deterministic).toBe(false);
        expect(retry.classify(Object.assign(new Error('nope'), { deterministic: true })).deterministic).toBe(true);
    });

    it('calls a broken step deterministic and a dropped socket transient', () => {
        expect(retry.classify(new TypeError('bad')).deterministic).toBe(true);
        expect(retry.classify(Object.assign(new Error('reset'), { code: 'ECONNRESET' })).deterministic).toBe(false);
        expect(retry.classify(Object.assign(new Error('gone'), { name: 'MongoNetworkError' })).deterministic).toBe(false);
    });

    it('treats an unrecognised failure as transient, as the runner always has', () => {
        expect(retry.classify(new Error('something odd')).deterministic).toBe(false);
    });

    it('never retries a deterministic failure, whatever the attempt', () => {
        const decision = retry.decide(Object.assign(new Error('no such action'), { deterministic: true }), { attempt: 1, maxAttempts: 3 });
        expect(decision).toMatchObject({ retry: false, reason: 'deterministic' });
        expect(decision.delayMs).toBeUndefined();
    });

    it('backs a transient failure off, and gives up once the attempts are spent', () => {
        process.env.WORKFLOW_BACKOFF_MS = '100,200,300';
        const error = Object.assign(new Error('flaky'), { code: 'ETIMEDOUT' });
        const first = retry.decide(error, { attempt: 1, maxAttempts: 3 });
        const second = retry.decide(error, { attempt: 2, maxAttempts: 3 });
        expect(first.retry).toBe(true);
        expect(second.delayMs).toBeGreaterThan(first.delayMs);
        expect(retry.decide(error, { attempt: 3, maxAttempts: 3 })).toMatchObject({ retry: false, reason: 'attempts_exhausted' });
    });

    it('waits the vendor hint when a rate limit sends one', () => {
        const hinted = new AIProviderError({ provider: 'openai', type: TYPES.RATE_LIMIT, retryAfterMs: 4321 });
        expect(retry.decide(hinted, { attempt: 1, maxAttempts: 3 }).delayMs).toBe(4321);
    });
});

describe('the ready set', () => {
    const graph = () => [
        step({ stepId: 'a', index: 0, status: 'success' }),
        step({ stepId: 'b', index: 1, dependsOn: ['a'] }),
        step({ stepId: 'c', index: 2, dependsOn: ['a'] }),
        step({ stepId: 'd', index: 3, dependsOn: ['b', 'c'] }),
    ];

    it('offers every step whose dependencies have all succeeded', () => {
        expect(scheduler.readySet(graph()).map((s) => s.stepId)).toEqual(['b', 'c']);
    });

    it('holds a fan-in until every branch is in', () => {
        const steps = graph().map((s) => (s.stepId === 'b' ? { ...s, status: 'success' } : s));
        expect(scheduler.readySet(steps).map((s) => s.stepId)).toEqual(['c']);
    });

    it('holds a step that is waiting out a backoff', () => {
        const steps = graph().map((s) => (s.stepId === 'b' ? { ...s, nextAttemptAt: new Date(Date.now() + 60000) } : s));
        expect(scheduler.readySet(steps).map((s) => s.stepId)).toEqual(['c']);
        expect(scheduler.nextAttemptAt(steps)).toBeInstanceOf(Date);
    });

    it('offers a step again once the claim on it has lapsed, and not before', () => {
        const running = (lease) => graph().map((s) => (s.stepId === 'b' ? { ...s, status: 'running', leaseExpiresAt: lease } : s));
        expect(scheduler.readySet(running(new Date(Date.now() + 60000))).map((s) => s.stepId)).toEqual(['c']);
        expect(scheduler.readySet(running(new Date(Date.now() - 1))).map((s) => s.stepId)).toEqual(['b', 'c']);
        expect(scheduler.readySet(running(null)).map((s) => s.stepId)).toEqual(['c']);
        expect(scheduler.runStatus(running(new Date(Date.now() - 1)))).toBeNull();
    });

    it('blocks, rather than strands, a step whose dependency failed', () => {
        const steps = graph().map((s) => (s.stepId === 'a' ? { ...s, status: 'failed' } : s));
        expect(scheduler.readySet(steps)).toEqual([]);
        expect(scheduler.blockedSet(steps).map(({ step: s }) => s.stepId)).toEqual(['b', 'c', 'd']);
    });

    it('blocks a step that names a dependency the run does not have', () => {
        const steps = [step({ stepId: 'a', status: 'success' }), step({ stepId: 'b', dependsOn: ['ghost'] })];
        expect(scheduler.readySet(steps)).toEqual([]);
        expect(scheduler.blockedSet(steps)[0].blockers[0]).toMatchObject({ id: 'ghost', dependency: null });
    });

    it('has no verdict until every step has settled', () => {
        expect(scheduler.runStatus(graph())).toBeNull();
        expect(scheduler.runStatus(graph().map((s) => ({ ...s, status: 'success' })))).toBe('success');
        expect(scheduler.runStatus(graph().map((s, i) => ({ ...s, status: i ? 'skipped' : 'failed' })))).toBe('failed');
        expect(scheduler.runStatus(graph().map((s, i) => ({ ...s, status: i ? 'skipped' : 'stopped' })))).toBe('stopped');
    });
});

describe('the claim', () => {
    it('is one compare-and-set that only a pending or lapsed step can match', async () => {
        MongoDbCrudOpration.mockResolvedValue(step({ status: 'running', fencingToken: 1 }));
        const now = new Date('2026-09-12T10:00:00.000Z');
        await store.claimStep('c1', { runId: 'r1', stepId: 's1', workerId: 'w1', now, lease: 1000 });

        const [companyId, { type, data }, method] = lastCall();
        expect([companyId, type, method]).toEqual(['c1', SCHEMA_TYPE.WORKFLOW_STEP_RUNS, 'findOneAndUpdate']);
        const [filter, update] = data;
        expect(filter.$and[0].$or).toEqual([{ status: 'pending' }, { status: 'running', leaseExpiresAt: { $lte: now } }]);
        expect(update.$inc).toEqual({ fencingToken: 1, attempts: 1 });
        expect(update.$set.leaseExpiresAt).toEqual(new Date(now.getTime() + 1000));
    });

    it('will not hand a step back before its backoff has elapsed', async () => {
        MongoDbCrudOpration.mockResolvedValue(null);
        const now = new Date('2026-09-12T10:00:00.000Z');
        await store.claimStep('c1', { runId: 'r1', stepId: 's1', workerId: 'w1', now });
        const [filter] = lastCall()[1].data;
        expect(filter.$and[1].$or).toContainEqual({ nextAttemptAt: { $lte: now } });
    });
});

describe('fencing', () => {
    it('guards every post-claim write on the token the claim handed out', async () => {
        MongoDbCrudOpration.mockResolvedValue(step({ status: 'success' }));
        await store.succeedStep('c1', { runId: 'r1', stepId: 's1', fencingToken: 7 }, { output: { ok: true } });
        const [filter, update] = lastCall()[1].data;
        expect(filter).toMatchObject({ runId: 'r1', stepId: 's1', status: 'running', fencingToken: 7 });
        expect(update.$set.status).toBe('success');
    });

    it('refuses the late write of a worker whose lease was taken', async () => {
        MongoDbCrudOpration.mockResolvedValue(null);
        await expect(store.succeedStep('c1', { runId: 'r1', stepId: 's1', fencingToken: 3 }, { output: {} }))
            .rejects.toThrow(store.StaleLeaseError);
    });

    it('marks a lost lease deterministic, so nothing retries into the new worker', async () => {
        MongoDbCrudOpration.mockResolvedValue(null);
        const error = await store.failStep('c1', { runId: 'r1', stepId: 's1', fencingToken: 3 }, { error: 'x' }).catch((e) => e);
        expect(error).toBeInstanceOf(store.StaleLeaseError);
        expect(retry.classify(error).deterministic).toBe(true);
    });

    it('reports a heartbeat that matched nothing as a lost lease', async () => {
        MongoDbCrudOpration.mockResolvedValueOnce({ matchedCount: 1 });
        expect(await store.heartbeat('c1', { runId: 'r1', stepId: 's1', fencingToken: 2 })).toBe(true);
        MongoDbCrudOpration.mockResolvedValueOnce({ matchedCount: 0 });
        expect(await store.heartbeat('c1', { runId: 'r1', stepId: 's1', fencingToken: 2 })).toBe(false);
    });
});

describe('per-tenant concurrency', () => {
    it('counts live claims in the tenant database, not in this process', async () => {
        MongoDbCrudOpration.mockResolvedValue(5);
        process.env.WORKFLOW_TENANT_CONCURRENCY = '5';
        expect(await concurrency.atCapacity('c1')).toMatchObject({ full: true, live: 5, limit: 5 });
        const [companyId, { type }, method] = lastCall();
        expect([companyId, type, method]).toEqual(['c1', SCHEMA_TYPE.WORKFLOW_STEP_RUNS, 'countDocuments']);
    });

    it('admits a claim when fewer than the limit were taken before it', async () => {
        process.env.WORKFLOW_TENANT_CONCURRENCY = '2';
        MongoDbCrudOpration.mockResolvedValue(1);
        expect(await concurrency.admit('c1', { _id: 'x', runId: 'r1', stepId: 's1', fencingToken: 1, claimedAt: new Date() })).toBe(true);
    });

    it('hands back exactly the claims past the limit', async () => {
        process.env.WORKFLOW_TENANT_CONCURRENCY = '2';
        MongoDbCrudOpration.mockResolvedValueOnce(2).mockResolvedValueOnce({ matchedCount: 1 });
        expect(await concurrency.admit('c1', { _id: 'x', runId: 'r1', stepId: 's1', fencingToken: 1, claimedAt: new Date() })).toBe(false);
        const [filter, update] = lastCall()[1].data;
        expect(filter.fencingToken).toBe(1);
        expect(update.$set.status).toBe('pending');
        expect(update.$inc).toEqual({ attempts: -1 });
    });
});

describe('action-level idempotency', () => {
    it('keys on the run and the step, never on the attempt', () => {
        expect(idempotency.keyFor({ runId: 'r1', stepId: 's1' })).toBe('wf:r1:s1');
        expect(idempotency.keyFor({ runId: 'r1', stepId: 's1', action: 'add_comment' })).toBe('wf:r1:s1:add_comment');
    });
});

describe('the automation rule node', () => {
    const runner = require('../Modules/Automations/engine/runner');
    const automationRule = require('../Modules/Workflows/automationRule');
    const wfRun = { _id: 'wf1', automationRunId: 'ar1', ruleId: 'rule1' };

    afterEach(() => { if (runner.execute.mockRestore) runner.execute.mockRestore(); });

    it('runs the rule through the same runner, against the same automation run', async () => {
        jest.spyOn(runner, 'execute').mockResolvedValue({ status: 'success' });
        expect(await automationRule.execute({ companyId: 'c1', run: wfRun, context: {} }))
            .toEqual({ status: 'success', automationRunId: 'ar1' });
        expect(runner.execute).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'c1', runId: 'ar1', ruleId: 'rule1' }));
    });

    it('leaves the retry to the step, by never handing the runner an enqueue', async () => {
        jest.spyOn(runner, 'execute').mockResolvedValue({ status: 'success' });
        await automationRule.execute({ companyId: 'c1', run: wfRun, context: {} });
        expect(runner.execute.mock.calls[0][0].enqueue).toBeUndefined();
    });

    it('turns the runner\'s verdicts into a retry decision the engine understands', async () => {
        jest.spyOn(runner, 'execute').mockResolvedValue({ status: 'retrying', error: 'mongo timeout' });
        const transient = await automationRule.execute({ companyId: 'c1', run: wfRun, context: {} }).catch((e) => e);
        expect(retry.classify(transient).deterministic).toBe(false);

        runner.execute.mockResolvedValue({ status: 'failed', error: 'no such action' });
        const permanent = await automationRule.execute({ companyId: 'c1', run: wfRun, context: {} }).catch((e) => e);
        expect(retry.classify(permanent).deterministic).toBe(true);
    });
});

describe('an automation rule is a one-node workflow', () => {
    it('is a registered executor like any other step type, beside the agent run', () => {
        expect(executors.types()).toEqual(expect.arrayContaining([workflows.AUTOMATION_RULE, workflows.AGENT_RUN]));
        expect(typeof executors.get(workflows.AUTOMATION_RULE)).toBe('function');
        expect(typeof executors.get(workflows.AGENT_RUN)).toBe('function');
    });

    it('starts one node that points at the rule run rather than copying its steps', async () => {
        const run = { _id: 'wf1' };
        MongoDbCrudOpration.mockResolvedValueOnce(run).mockResolvedValueOnce([{}]);
        const rule = { _id: 'rule1', name: 'Escalate', steps: [{ id: 's1' }, { id: 's2' }] };
        await workflows.startForRule('c1', rule, { id: 'evt_1', type: 'task.created', entity: {} }, { _id: 'ar1', traceId: 't1' });

        const [, { data: created }] = MongoDbCrudOpration.mock.calls[0];
        expect(created).toMatchObject({ workflowId: 'rule:rule1', dedupeKey: 'rule:rule1:evt_1', automationRunId: 'ar1', ruleId: 'rule1' });
        expect(created.definition.steps).toEqual([{ id: 'rule', type: workflows.AUTOMATION_RULE, dependsOn: [], maxAttempts: 3 }]);

        const [, { data: inserted }, method] = MongoDbCrudOpration.mock.calls[1];
        expect(method).toBe('insertMany');
        expect(inserted[0]).toHaveLength(1);
        expect(inserted[0][0]).toMatchObject({ runId: 'wf1', stepId: 'rule', status: 'pending', fencingToken: 0 });
    });

    it('drops a redelivered trigger on the dedupe key', async () => {
        MongoDbCrudOpration.mockRejectedValueOnce(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));
        const started = await workflows.startForRule('c1', { _id: 'rule1' }, { id: 'evt_1', entity: {} }, { _id: 'ar1' });
        expect(started).toBeNull();
        expect(MongoDbCrudOpration).toHaveBeenCalledTimes(1);
    });
});
