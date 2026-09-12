const crypto = require('node:crypto');
const { MongoClient } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');

// The workflow API and the agent-run step, against a real MongoDB.
//
// What only a real database can answer: that one idempotency key produces one
// run because a unique index says so, that a step really writes an agent_runs
// row, that a retry of a failed step finds the run its first attempt made rather
// than billing a second, and that a run in one tenant's database is invisible
// from another's.
//
// Two tenant databases of their own, named after ids that belong to no company,
// so nothing here can touch the fixture company's data. The controllers are
// called directly with a request and a response of the shape Express gives them:
// the roles, the runs and the tasks are real rows, and the only thing standing in
// for the outside world is the skill graph, which has no model to call in CI.

process.env.MONGODB_URL = resolveMongoUrl();
process.env.WORKFLOW_ENGINE = 'on';
process.env.WORKFLOW_BACKOFF_MS = '100,100,100';
process.env.WORKFLOW_LEASE_MS = '10000';

const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { closeConnection } = require('../../middlewares/mongoConnector/helper');
const { ROLE_OWNER, ROLE_MEMBER } = require('../../Config/roleTypes');
const { SEAT_ACTIVE } = require('../../Config/seatStatus');
const store = require('../../Modules/Workflows/store');
const executors = require('../../Modules/Workflows/executors');
const workflows = require('../../Modules/Workflows');
const controller = require('../../Modules/Workflows/controller');
const agentRunStep = require('../../Modules/Workflows/agentRun');
const runs = require('../../Modules/Agents/runs');

const id = () => crypto.randomBytes(12).toString('hex');
const COMPANY = id();
const OTHER_COMPANY = id();
const OWNER = id();
const MEMBER = id();
const OTHER_OWNER = id();
const PROJECT = id();
const SPRINT = id();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let client;
let skillOutcome = { status: runs.STATUS.DONE, outcome: 'reviewed' };
let executed = [];

const req = ({ companyId = COMPANY, uid = OWNER, params = {}, body = {}, query = {}, headers = {} } = {}) => ({
    headers: { companyid: companyId, ...headers }, uid, params, query, body, ip: '127.0.0.1',
});

const res = () => {
    const r = { statusCode: 200, body: null };
    r.status = (code) => { r.statusCode = code; return r; };
    r.send = (body) => { r.body = body; return r; };
    return r;
};

const call = async (handler, options) => {
    const answer = res();
    await handler(req(options), answer);
    return answer;
};

const seat = (companyId, userId, roleType) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.COMPANY_USERS,
    data: { companyId, userId, userEmail: `${userId}@workflow.test`, roleType, designation: 0, status: SEAT_ACTIVE, isDelete: false },
}, 'save');

const createAgent = (companyId = COMPANY) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.AGENTS,
    data: { name: '[workflow-api] agent', description: 'integration', autonomy: 1, spendCapUsd: 5, account: 'local', projectIds: [], skills: [], allowedActions: ['task.comment'] },
}, 'save');

/* The owner's own project: personal, so the member the refusal tests use cannot
 * see it and the run that worked in it stays hidden from them. */
const createProject = (companyId = COMPANY) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.PROJECTS,
    data: {
        _id: PROJECT, CompanyId: companyId, ProjectName: '[workflow-api] project', ProjectCode: 'WFA', ProjectCurrency: { code: 'USD' },
        ProjectRequiredDefaultComponent: 'task', ProjectType: 'Blank', projectCreatedBy: OWNER, projectIcon: {}, status: 'active', statusType: 'active',
        isPrivateSpace: false, isPersonal: true, personalOwner: OWNER, deletedStatusKey: 0,
    },
}, 'save');

const createTask = (companyId = COMPANY) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.TASKS,
    data: {
        TaskName: '[workflow-api] task', TaskKey: `WF-${crypto.randomBytes(3).toString('hex')}`, TaskType: 'Task', TaskTypeKey: 1,
        ProjectID: PROJECT, CompanyId: companyId, status: { text: 'To Do' }, statusType: 'todo', statusKey: 1, isParentTask: false,
        Task_Leader: OWNER, sprintArray: [], sprintId: SPRINT, Task_Priority: 'Medium', deletedStatusKey: 0,
    },
}, 'save');

const plain = (row) => (row && typeof row.toObject === 'function' ? row.toObject() : row);

const stepRow = async (runId, stepId) => plain(await store.getStep(COMPANY, runId, stepId));

const agentRunRows = (companyId = COMPANY, filter = {}) => MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_RUNS, data: [filter] }, 'find');

executors.register('probe', async ({ run, step }) => {
    executed.push(`${run._id}/${step.stepId}`);
    return { ok: true };
});

let agent;
let task;

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    for (const companyId of [COMPANY, OTHER_COMPANY]) {
        for (const type of [SCHEMA_TYPE.WORKFLOW_RUNS, SCHEMA_TYPE.WORKFLOW_STEP_RUNS, SCHEMA_TYPE.AUDIT_LOGS, SCHEMA_TYPE.AGENT_RUNS]) {
            // eslint-disable-next-line no-await-in-loop
            await MongoDbCrudOpration(companyId, { type, data: [] }, 'syncIndexes');
        }
    }
    await seat(COMPANY, OWNER, ROLE_OWNER);
    await seat(COMPANY, MEMBER, ROLE_MEMBER);
    await seat(OTHER_COMPANY, OTHER_OWNER, ROLE_OWNER);
    await createProject();
    agent = await createAgent();
    task = await createTask();

    // The skill graph is the one thing with no counterpart in CI: there is no
    // model to call. Everything around it — canStart, the agent_runs row, its
    // idempotency key, the spend cap — is the real run path.
    jest.spyOn(runs, 'executeSkill').mockImplementation(async (companyId, run) => {
        if (skillOutcome.status === runs.STATUS.WAITING) {
            await runs.patch(companyId, run._id, { status: runs.STATUS.WAITING });
            return skillOutcome;
        }
        await runs.finish(companyId, run._id, { status: skillOutcome.status, outcome: skillOutcome.outcome, error: skillOutcome.error });
        return skillOutcome;
    });
});

afterAll(async () => {
    jest.restoreAllMocks();
    if (client) {
        await client.db(COMPANY).dropDatabase().catch(() => {});
        await client.db(OTHER_COMPANY).dropDatabase().catch(() => {});
        await client.close();
    }
    closeConnection(COMPANY);
    closeConnection(OTHER_COMPANY);
    // The agents' spend and revision reads open the global database too; left
    // open, it is the handle that keeps Jest from exiting.
    closeConnection(dbCollections.GLOBAL);
    await sleep(50);
});

beforeEach(() => {
    executed = [];
    skillOutcome = { status: runs.STATUS.DONE, outcome: 'reviewed' };
});

describe('starting a run through the API', () => {
    it('creates one run for one idempotency key, however often it is asked', async () => {
        const key = `k-${id()}`;
        const body = { workflowId: 'probe', steps: [{ id: 'a', type: 'probe' }] };
        const headers = { 'idempotency-key': key };

        const first = await call(controller.startRun, { body, headers });
        const second = await call(controller.startRun, { body, headers });

        expect(first.body.status).toBe(true);
        expect(first.body.data.deduplicated).toBe(false);
        expect(second.body.data.deduplicated).toBe(true);
        expect(String(second.body.data.run._id)).toBe(String(first.body.data.run._id));

        const rows = await MongoDbCrudOpration(COMPANY, { type: SCHEMA_TYPE.WORKFLOW_RUNS, data: [{ dedupeKey: `api:${OWNER}:${key}` }] }, 'find');
        expect(rows).toHaveLength(1);
        expect(executed).toEqual([`${first.body.data.run._id}/a`]);
    });

    it('runs the workflow it started, through the queue path', async () => {
        const started = await call(controller.startRun, { body: { workflowId: 'probe', steps: [{ id: 'a', type: 'probe' }, { id: 'b', type: 'probe', dependsOn: ['a'] }] } });
        expect(started.body.data.dispatched).toBe('inline');
        const read = await call(controller.getRun, { params: { id: String(started.body.data.run._id) } });
        expect(read.body.data.run.status).toBe('success');
        expect(read.body.data.steps.map((s) => s.status)).toEqual(['success', 'success']);
    });
});

describe('an agent run as a step', () => {
    const startAgentStep = () => call(controller.startRun, { body: { agentId: String(agent._id), taskId: String(task._id) } });

    it('really runs the agent, with the run recorded on the step', async () => {
        const started = await startAgentStep();
        const runId = String(started.body.data.run._id);

        const step = await stepRow(runId, 'agent');
        expect(step.status).toBe('success');
        expect(step.output.agentRunId).toBeTruthy();

        const agentRun = plain(await runs.get(COMPANY, step.output.agentRunId));
        expect(agentRun).toMatchObject({ agentId: String(agent._id), taskId: String(task._id), trigger: agentRunStep.TRIGGER, status: runs.STATUS.DONE });
        expect(agentRun.idempotencyKey).toBe(`wf:${runId}:agent`);
        expect(runs.executeSkill).toHaveBeenCalled();
        expect(String((await store.getRun(COMPANY, runId)).status)).toBe('success');
    });

    it('fails the step when the agent run fails, and still says which run it was', async () => {
        skillOutcome = { status: runs.STATUS.FAILED, error: 'the provider refused' };
        const started = await startAgentStep();
        const runId = String(started.body.data.run._id);

        const step = await stepRow(runId, 'agent');
        expect(step.status).toBe('failed');
        expect(step.error).toMatch(/the provider refused/);
        expect(step.output.agentRunId).toBeTruthy();
        expect(step.failure.deterministic).toBe(true);
        expect((await store.getRun(COMPANY, runId)).status).toBe('failed');
    });

    it('retries a failed step onto the run its first attempt made, not a second one', async () => {
        skillOutcome = { status: runs.STATUS.FAILED, error: 'the provider refused' };
        const started = await startAgentStep();
        const runId = String(started.body.data.run._id);
        const firstAgentRunId = (await stepRow(runId, 'agent')).output.agentRunId;

        skillOutcome = { status: runs.STATUS.DONE, outcome: 'reviewed' };
        const retried = await call(controller.retryStep, { params: { id: runId, stepId: 'agent' }, body: { reason: 'the provider is back' } });

        expect(retried.body.status).toBe(true);
        const step = await stepRow(runId, 'agent');
        expect(step.status).toBe('success');
        expect(step.control).toMatchObject({ action: 'retry', by: OWNER });
        expect(step.output.agentRunId).toBe(firstAgentRunId);
        expect(await agentRunRows(COMPANY, { idempotencyKey: `wf:${runId}:agent` })).toHaveLength(1);
        expect((await store.getRun(COMPANY, runId)).status).toBe('success');
    });

    it('waits with a run that is waiting for a person, rather than marching on', async () => {
        skillOutcome = { status: runs.STATUS.WAITING };
        const started = await startAgentStep();
        const runId = String(started.body.data.run._id);

        const step = await stepRow(runId, 'agent');
        expect(step.status).toBe('pending');
        expect(step.failure.deterministic).toBe(false);
        expect(step.error).toMatch(/waiting for approval/);
        expect((await store.getRun(COMPANY, runId)).status).toBe('running');
    });
});

describe('a run a person started from a task', () => {
    it('goes through the queue like a rule-started one', async () => {
        const agentRun = await runs.create(COMPANY, {
            agent, taskId: String(task._id), projectId: PROJECT, skill: 'qa-review', trigger: 'manual', startedBy: OWNER, viaAccount: 'local',
        });
        const workflowRun = await workflows.enqueueForAgentRun(COMPANY, plain(agentRun), {});

        expect(workflowRun).not.toBeNull();
        expect(workflowRun.source).toBe('agent_run');
        expect(workflowRun.definition.steps[0]).toMatchObject({ type: agentRunStep.TYPE });
        const step = await stepRow(workflowRun._id, 'agent');
        expect(step.status).toBe('success');
        expect(step.output.agentRunId).toBe(String(agentRun._id));
        expect(plain(await runs.get(COMPANY, agentRun._id)).status).toBe(runs.STATUS.DONE);
        // The run that already existed is the run that executed: no second one.
        expect(await agentRunRows(COMPANY, { _id: agentRun._id })).toHaveLength(1);
    });
});

describe('skip, resume and compensate on a failed step', () => {
    const failingRun = async () => {
        const started = await call(controller.startRun, { body: { workflowId: 'probe', steps: [{ id: 'a', type: 'probe', maxAttempts: 1 }, { id: 'b', type: 'probe', dependsOn: ['a'] }] } });
        return String(started.body.data.run._id);
    };

    it('skips a failed step and lets the rest of the run finish', async () => {
        const runId = await failingRun();
        await MongoDbCrudOpration(COMPANY, {
            type: SCHEMA_TYPE.WORKFLOW_STEP_RUNS,
            data: [{ runId, stepId: 'a' }, { $set: { status: 'failed', error: 'broken' } }],
        }, 'updateOne');
        await MongoDbCrudOpration(COMPANY, {
            type: SCHEMA_TYPE.WORKFLOW_STEP_RUNS,
            data: [{ runId, stepId: 'b' }, { $set: { status: 'pending', finishedAt: null, error: null } }],
        }, 'updateOne');

        const skipped = await call(controller.skipStep, { params: { id: runId, stepId: 'a' }, body: { reason: 'not worth fixing' } });

        expect(skipped.body.status).toBe(true);
        const a = await stepRow(runId, 'a');
        expect(a).toMatchObject({ status: 'skipped', skippedBy: OWNER });
        expect((await stepRow(runId, 'b')).status).toBe('success');
        expect((await store.getRun(COMPANY, runId)).status).toBe('success');
    });

    it('resumes a step whose worker died holding the claim, keeping the attempts it spent', async () => {
        const runId = await failingRun();
        await MongoDbCrudOpration(COMPANY, {
            type: SCHEMA_TYPE.WORKFLOW_STEP_RUNS,
            data: [{ runId, stepId: 'b' }, { $set: { status: 'running', attempts: 2, workerId: 'dead', leaseExpiresAt: new Date(Date.now() + 60000), finishedAt: null } }],
        }, 'updateOne');
        const before = await stepRow(runId, 'b');

        const resumed = await call(controller.resumeStep, { params: { id: runId, stepId: 'b' } });

        expect(resumed.body.status).toBe(true);
        const after = await stepRow(runId, 'b');
        expect(after.status).toBe('success');
        expect(after.attempts).toBeGreaterThan(before.attempts);
        expect(after.fencingToken).toBeGreaterThan(before.fencingToken);
        expect(after.control).toMatchObject({ action: 'resume', by: OWNER });
    });

    it('refuses a control on a step that is not in a state for it', async () => {
        const runId = await failingRun();
        const refused = await call(controller.retryStep, { params: { id: runId, stepId: 'a' } });
        expect(refused.statusCode).toBe(409);
        expect((await stepRow(runId, 'a')).status).toBe('success');
    });

    it('compensates an agent-run step by reverting the run it made', async () => {
        const started = await call(controller.startRun, { body: { agentId: String(agent._id), taskId: String(task._id) } });
        const runId = String(started.body.data.run._id);
        const agentRunId = (await stepRow(runId, 'agent')).output.agentRunId;

        const compensated = await call(controller.compensateStep, { params: { id: runId, stepId: 'agent' } });

        // The run made no reversible change in this environment, so the agents'
        // own revert refuses it — the point is that the step routes to that check
        // rather than inventing an undo of its own.
        expect(compensated.statusCode).toBe(409);
        expect(compensated.body.message).toMatch(/reversible/);
        expect(agentRunId).toBeTruthy();
    });

    it('has nothing to compensate on a step that is not an agent run', async () => {
        const runId = await failingRun();
        const answer = await call(controller.compensateStep, { params: { id: runId, stepId: 'a' } });
        expect(answer.statusCode).toBe(409);
        expect(answer.body.message).toMatch(/nothing to compensate/);
    });
});

describe('who may touch a run', () => {
    let runId;

    beforeAll(async () => {
        const started = await call(controller.startRun, { body: { workflowId: 'probe', steps: [{ id: 'a', type: 'probe' }] } });
        runId = String(started.body.data.run._id);
    });

    it('refuses a member every control', async () => {
        for (const handler of [controller.retryStep, controller.skipStep, controller.resumeStep, controller.compensateStep]) {
            // eslint-disable-next-line no-await-in-loop
            const answer = await call(handler, { uid: MEMBER, params: { id: runId, stepId: 'a' } });
            expect(answer.statusCode).toBe(403);
            expect(answer.body.message).toMatch(/Owner or an Admin/);
        }
        const start = await call(controller.startRun, { uid: MEMBER, body: { workflowId: 'probe', steps: [{ id: 'a', type: 'probe' }] } });
        expect(start.statusCode).toBe(403);
    });

    it('hides a member from a run they did not start and cannot see the project of', async () => {
        const read = await call(controller.getRun, { uid: MEMBER, params: { id: runId } });
        expect(read.statusCode).toBe(404);
        const list = await call(controller.listRuns, { uid: MEMBER });
        expect(list.body.data).toEqual([]);
    });

    it('keeps a run invisible and untouchable from another company', async () => {
        const read = await call(controller.getRun, { companyId: OTHER_COMPANY, uid: OTHER_OWNER, params: { id: runId } });
        expect(read.statusCode).toBe(404);

        const control = await call(controller.retryStep, { companyId: OTHER_COMPANY, uid: OTHER_OWNER, params: { id: runId, stepId: 'a' } });
        expect(control.statusCode).toBe(404);

        const list = await call(controller.listRuns, { companyId: OTHER_COMPANY, uid: OTHER_OWNER });
        expect(list.body.data).toEqual([]);
        expect((await stepRow(runId, 'a')).status).toBe('success');
    });
});

describe('the flag', () => {
    it('answers unavailable on every route while the engine is off', async () => {
        process.env.WORKFLOW_ENGINE = 'off';
        try {
            for (const handler of [controller.startRun, controller.listRuns, controller.getRun, controller.retryStep, controller.skipStep, controller.resumeStep, controller.compensateStep]) {
                // eslint-disable-next-line no-await-in-loop
                const answer = await call(handler, { params: { id: id(), stepId: 'a' } });
                expect(answer.statusCode).toBe(503);
                expect(answer.body.status).toBe(false);
            }
        } finally {
            process.env.WORKFLOW_ENGINE = 'on';
        }
    });
});
