const crypto = require('node:crypto');
const { MongoClient } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');

// The step types against a real MongoDB, because every one of them is a claim
// about rows: an approval that blocks a run and resumes it on a decision, a
// deadline that escalates, a fan-out that becomes N rows and a join that waits
// for all of them, a condition that skips the branch it did not take, a wait and
// a timer that fire, and a loop that stops at its iteration cap and at its
// budget.
//
// Like the engine suite, this works in a tenant database of its own, named after
// an id that belongs to no company.

process.env.MONGODB_URL = resolveMongoUrl();
process.env.WORKFLOW_ENGINE = 'on';
process.env.WORKFLOW_BACKOFF_MS = '100,100,100';
process.env.WORKFLOW_TENANT_CONCURRENCY = '10';
process.env.WORKFLOW_LEASE_MS = '10000';
process.env.WORKFLOW_JOIN_POLL_MS = '40';
process.env.WORKFLOW_APPROVAL_POLL_MS = '60';

const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { closeConnection } = require('../../middlewares/mongoConnector/helper');
const store = require('../../Modules/Workflows/store');
const engine = require('../../Modules/Workflows/engine');
const executors = require('../../Modules/Workflows/executors');
const approvals = require('../../Modules/Workflows/approvals');
const stepTypes = require('../../Modules/Workflows/stepTypes');

const COMPANY = crypto.randomBytes(12).toString('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let client;
const calls = [];
let behaviour = () => ({ ok: true });

executors.register('probe', async ({ step }) => {
    calls.push(String(step.stepId));
    return behaviour(step) || {};
});

const startRun = (steps, over = {}) => store.createRun(COMPANY, {
    workflowId: 'steps',
    name: 'step type workflow',
    source: 'test',
    dedupeKey: `steps:${crypto.randomBytes(6).toString('hex')}`,
    steps,
    ...over,
});

const rows = async (runId) => (await store.listSteps(COMPANY, runId)).map((row) => row.toObject());
const row = async (runId, stepId) => (await store.getStep(COMPANY, runId, stepId)).toObject();
const statuses = async (runId) => (await rows(runId)).reduce((acc, step) => ({ ...acc, [step.stepId]: step.status }), {});

/* Ticks until the run settles or the ticks run out, waiting out whatever the
 * last tick said it was waiting for. A run that is still going when the ticks
 * run out is the honest answer for a run blocked on a person. */
const drive = async (runId, { maxTicks = 60 } = {}) => {
    let result = { status: 'running' };
    for (let i = 0; i < maxTicks; i++) {
        // eslint-disable-next-line no-await-in-loop
        result = await engine.tick(COMPANY, runId);
        if (['success', 'failed', 'stopped', 'missing'].includes(result.status)) return result;
        // eslint-disable-next-line no-await-in-loop
        await sleep(Math.min(Number(result.retryInMs) || 10, 120));
    }
    return result;
};

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    for (const type of [SCHEMA_TYPE.WORKFLOW_RUNS, SCHEMA_TYPE.WORKFLOW_STEP_RUNS, SCHEMA_TYPE.WORKFLOW_APPROVALS, SCHEMA_TYPE.AUDIT_LOGS]) {
        // eslint-disable-next-line no-await-in-loop
        await MongoDbCrudOpration(COMPANY, { type, data: [] }, 'syncIndexes');
    }
});

afterAll(async () => {
    if (client) {
        await client.db(COMPANY).dropDatabase().catch(() => {});
        await client.close();
    }
    closeConnection(COMPANY);
    await sleep(50);
});

beforeEach(() => {
    calls.length = 0;
    behaviour = () => ({ ok: true });
});

describe('a human approval', () => {
    const approvalWorkflow = (config) => [
        { id: 'ask', type: stepTypes.HUMAN_APPROVAL, dependsOn: [], config },
        { id: 'act', type: 'probe', dependsOn: ['ask'] },
    ];

    it('blocks the run with a reason, and resumes it on a decision', async () => {
        const run = await startRun(approvalWorkflow({ ownerUserId: 'user-7', prompt: 'ship it?', deadlineMs: 60000 }));

        const first = await engine.tick(COMPANY, run._id);
        expect(first.status).toBe('running');
        expect(calls).toEqual([]);

        const waiting = await row(run._id, 'ask');
        expect(waiting.status).toBe('pending');
        expect(waiting.waitReason).toBe('waiting for user user-7 to approve');
        expect(waiting.attempts).toBe(0);
        expect(waiting.error).toBeFalsy();
        expect(stepTypes.blockedReason(await rows(run._id))).toMatchObject({ blocked: true, stepId: 'ask' });

        const request = await approvals.get(COMPANY, run._id, 'ask');
        expect(request.status).toBe('pending');
        expect(String(waiting.approvalId)).toBe(String(request._id));

        expect(await approvals.decide(COMPANY, { runId: run._id, stepId: 'ask', decision: 'approved', decidedBy: 'user-7', comment: 'go' })).not.toBeNull();
        // A second decision finds the request already answered.
        expect(await approvals.decide(COMPANY, { runId: run._id, stepId: 'ask', decision: 'rejected', decidedBy: 'user-9' })).toBeNull();

        expect((await drive(run._id)).status).toBe('success');
        expect(calls).toEqual(['act']);
        expect((await row(run._id, 'ask')).output).toMatchObject({ decision: 'approved', decidedBy: 'user-7' });
        expect((await row(run._id, 'ask')).waitReason).toBeFalsy();
    });

    it('stops the path it was asked about when it is refused', async () => {
        const run = await startRun(approvalWorkflow({ ownerUserId: 'user-7', deadlineMs: 60000 }));
        await engine.tick(COMPANY, run._id);
        await approvals.decide(COMPANY, { runId: run._id, stepId: 'ask', decision: 'rejected', decidedBy: 'user-7', comment: 'no' });

        expect((await drive(run._id)).status).toBe('success');
        expect(calls).toEqual([]);
        expect(await statuses(run._id)).toEqual({ ask: 'success', act: 'skipped' });
        expect((await row(run._id, 'ask')).output).toMatchObject({ decision: 'rejected', skipped: ['act'] });
    });

    it('escalates on its escalation deadline and keeps waiting', async () => {
        const run = await startRun(approvalWorkflow({ ownerUserId: 'user-7', escalateToUserId: 'user-1', escalateAfterMs: 60, deadlineMs: 60000 }));
        await engine.tick(COMPANY, run._id);
        expect((await approvals.get(COMPANY, run._id, 'ask')).escalatedAt).toBeFalsy();

        await sleep(120);
        await engine.tick(COMPANY, run._id);

        const escalated = await approvals.get(COMPANY, run._id, 'ask');
        expect(escalated.escalatedAt).toBeTruthy();
        expect(escalated.ownerUserId).toBe('user-1');
        expect(escalated.owners).toEqual(['user-7', 'user-1']);
        expect(escalated.status).toBe('pending');
        expect((await row(run._id, 'ask')).waitReason).toBe('waiting for user user-1 to approve (escalated)');
        expect(calls).toEqual([]);
    });

    it('fails the step when nobody decides by the deadline', async () => {
        const run = await startRun(approvalWorkflow({ ownerUserId: 'user-7', deadlineMs: 60, onDeadline: 'fail' }));
        await engine.tick(COMPANY, run._id);
        await sleep(120);

        expect((await drive(run._id)).status).toBe('failed');
        expect((await approvals.get(COMPANY, run._id, 'ask')).status).toBe('expired');
        expect((await row(run._id, 'ask')).error).toMatch(/was not decided by/);
        expect(await statuses(run._id)).toMatchObject({ ask: 'failed', act: 'skipped' });
    });

    it('lets the deadline itself be the decision when the definition says so', async () => {
        const run = await startRun(approvalWorkflow({ ownerUserId: 'user-7', deadlineMs: 60, onDeadline: 'approve' }));
        await engine.tick(COMPANY, run._id);
        await sleep(120);

        expect((await drive(run._id)).status).toBe('success');
        expect(calls).toEqual(['act']);
        const decided = await approvals.get(COMPANY, run._id, 'ask');
        expect(decided).toMatchObject({ status: 'approved', decidedBy: 'system', comment: 'decided by the deadline' });
    });
});

describe('a fan-out and its join', () => {
    it('expands into N children and joins them once every one has finished', async () => {
        behaviour = (step) => ({ ok: true, seen: (step.config || {}).item || null, items: ['a', 'b', 'c', 'd', 'e'] });
        const run = await startRun([
            { id: 'seed', type: 'probe', dependsOn: [] },
            { id: 'spread', type: stepTypes.FAN_OUT, dependsOn: ['seed'], config: { itemsFrom: '$seed.items', type: 'probe' } },
            { id: 'join', type: stepTypes.FAN_IN, dependsOn: ['spread'], config: { from: 'spread' } },
            { id: 'after', type: 'probe', dependsOn: ['join'] },
        ]);

        expect((await drive(run._id)).status).toBe('success');

        const children = (await store.listChildren(COMPANY, run._id, 'spread')).map((child) => child.toObject());
        expect(children.map((child) => child.stepId)).toEqual(['spread#1', 'spread#2', 'spread#3', 'spread#4', 'spread#5']);
        expect(children.every((child) => child.status === 'success')).toBe(true);
        expect(children.map((child) => child.item.value)).toEqual(['a', 'b', 'c', 'd', 'e']);

        const join = await row(run._id, 'join');
        expect(join.output).toMatchObject({ total: 5, succeeded: 5, failed: 0 });
        // The join ran after every child, and `after` ran after the join.
        expect(calls.indexOf('after')).toBe(calls.length - 1);
        expect(calls.filter((id) => id.startsWith('spread#'))).toHaveLength(5);
    });

    it('waits rather than joining early, and fails the join when a child fails', async () => {
        behaviour = (step) => {
            const item = (step.config || {}).item;
            if (item === 'bad') throw Object.assign(new Error('this child cannot work'), { deterministic: true });
            return { ok: true };
        };
        const run = await startRun([
            { id: 'spread', type: stepTypes.FAN_OUT, dependsOn: [], config: { items: ['good', 'bad'], type: 'probe' } },
            { id: 'join', type: stepTypes.FAN_IN, dependsOn: ['spread'], config: { from: 'spread' } },
        ]);

        expect((await drive(run._id)).status).toBe('failed');
        expect((await row(run._id, 'join')).error).toMatch(/spread#2 is failed/);
    });

    it('refuses a fan wider than the bound instead of doing part of it', async () => {
        const run = await startRun([
            { id: 'spread', type: stepTypes.FAN_OUT, dependsOn: [], config: { items: ['a', 'b', 'c'], type: 'probe', maxChildren: 2 } },
        ]);
        expect((await drive(run._id)).status).toBe('failed');
        expect((await row(run._id, 'spread')).error).toMatch(/3 items is over the bound of 2/);
        expect(await store.listChildren(COMPANY, run._id, 'spread')).toHaveLength(0);
    });
});

describe('a condition', () => {
    const branchWorkflow = (value) => [
        { id: 'seed', type: 'probe', dependsOn: [] },
        { id: 'check', type: stepTypes.CONDITION, dependsOn: ['seed'], config: { when: { op: 'eq', field: '$seed.grade', value }, then: ['yes'], else: ['no'] } },
        { id: 'yes', type: 'probe', dependsOn: ['check'] },
        { id: 'no', type: 'probe', dependsOn: ['check'] },
    ];

    it('takes the branch it matched and skips the one it did not', async () => {
        behaviour = () => ({ grade: 'ok' });
        const run = await startRun(branchWorkflow('ok'));
        expect((await drive(run._id)).status).toBe('success');
        expect(calls).toEqual(['seed', 'yes']);
        expect(await statuses(run._id)).toEqual({ seed: 'success', check: 'success', yes: 'success', no: 'skipped' });
        expect((await row(run._id, 'check')).output).toMatchObject({ matched: true, taken: ['yes'], skipped: ['no'] });
    });

    it('takes the other branch when it does not', async () => {
        behaviour = () => ({ grade: 'ok' });
        const run = await startRun(branchWorkflow('something else'));
        expect((await drive(run._id)).status).toBe('success');
        expect(calls).toEqual(['seed', 'no']);
        expect(await statuses(run._id)).toEqual({ seed: 'success', check: 'success', yes: 'skipped', no: 'success' });
    });
});

describe('a wait and a timer', () => {
    it('holds the run for its duration and then goes on', async () => {
        const run = await startRun([
            { id: 'hold', type: stepTypes.WAIT, dependsOn: [], config: { forMs: 250 } },
            { id: 'after', type: 'probe', dependsOn: ['hold'] },
        ]);

        const started = Date.now();
        await engine.tick(COMPANY, run._id);
        const held = await row(run._id, 'hold');
        expect(held.status).toBe('pending');
        expect(new Date(held.waitUntil).getTime()).toBeGreaterThan(started);
        expect(calls).toEqual([]);

        expect((await drive(run._id)).status).toBe('success');
        expect(Date.now() - started).toBeGreaterThanOrEqual(250);
        expect(calls).toEqual(['after']);
        expect((await row(run._id, 'hold')).output.waitedMs).toBeGreaterThanOrEqual(0);
    });

    it('fires at the moment a timer names, and not before', async () => {
        const at = new Date(Date.now() + 250);
        const run = await startRun([
            { id: 'until', type: stepTypes.TIMER, dependsOn: [], config: { at: at.toISOString() } },
            { id: 'after', type: 'probe', dependsOn: ['until'] },
        ]);

        await engine.tick(COMPANY, run._id);
        expect(calls).toEqual([]);
        expect(new Date((await row(run._id, 'until')).waitUntil).toISOString()).toBe(at.toISOString());

        expect((await drive(run._id)).status).toBe('success');
        expect(Date.now()).toBeGreaterThanOrEqual(at.getTime());
        expect(calls).toEqual(['after']);
    });

    it('refuses a timer that names no moment', async () => {
        const run = await startRun([{ id: 'until', type: stepTypes.TIMER, dependsOn: [], config: { at: 'whenever' } }]);
        expect((await drive(run._id)).status).toBe('failed');
        expect((await row(run._id, 'until')).error).toMatch(/is not a moment/);
    });
});

describe('a loop as bounded re-entry', () => {
    const cycle = (config) => [
        { id: 'scan', type: 'probe', dependsOn: [] },
        { id: 'again', type: stepTypes.LOOP, dependsOn: ['scan'], config },
        { id: 'after', type: 'probe', dependsOn: ['again'] },
    ];

    it('stops at its iteration cap', async () => {
        const run = await startRun(cycle({ body: ['scan'], maxIterations: 3 }));
        expect((await drive(run._id)).status).toBe('success');

        expect(calls.filter((id) => id === 'scan')).toHaveLength(3);
        expect(calls[calls.length - 1]).toBe('after');
        expect((await row(run._id, 'again')).output).toMatchObject({ iterations: 3, stoppedBy: 'iteration_cap' });
    });

    it('stops at its budget before its cap', async () => {
        behaviour = () => ({ costUsd: 0.6 });
        const run = await startRun(cycle({ body: ['scan'], maxIterations: 20, budgetUsd: 1 }));
        expect((await drive(run._id)).status).toBe('success');

        expect(calls.filter((id) => id === 'scan')).toHaveLength(2);
        expect((await row(run._id, 'again')).output).toMatchObject({ iterations: 2, stoppedBy: 'budget', budgetUsedUsd: 1.2 });
    });

    it('stops when its condition stops holding', async () => {
        let pass = 0;
        behaviour = () => { pass += 1; return { keepGoing: pass < 2 }; };
        const run = await startRun(cycle({ body: ['scan'], maxIterations: 20, while: { op: 'eq', field: '$scan.keepGoing', value: true } }));
        expect((await drive(run._id)).status).toBe('success');

        expect(calls.filter((id) => id === 'scan')).toHaveLength(2);
        expect((await row(run._id, 'again')).output).toMatchObject({ stoppedBy: 'condition' });
    });

    it('never runs more iterations than the ceiling, whatever the definition asks for', async () => {
        const run = await startRun(cycle({ body: ['scan'], maxIterations: 1000 }));
        const { maxLoopIterations } = require('../../Modules/Workflows/flag');
        expect((await drive(run._id, { maxTicks: 200 })).status).toBe('success');
        expect(calls.filter((id) => id === 'scan')).toHaveLength(maxLoopIterations());
        expect((await row(run._id, 'again')).output).toMatchObject({ stoppedBy: 'iteration_cap', cap: maxLoopIterations() });
    });
});
