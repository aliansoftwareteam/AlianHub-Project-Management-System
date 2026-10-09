const mockDbs = {};
const mockDbFor = (id) => { mockDbs[id] = mockDbs[id] || require('./fixtures/fakeMongo').create(); return mockDbs[id]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ WEBURL: 'https://hub.test/', myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn(), recordAuditFromReq: jest.fn() }));
jest.mock('../Modules/Workflows/queue', () => ({ dispatch: jest.fn(async () => 'inline') }));

process.env.WORKFLOW_ENGINE = 'on';
process.env.DISPATCHER = 'on';

const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const { removeCache } = require('../utils/commonFunctions');
const { recordAudit } = require('../Modules/Audit/recorder');
const workflowStore = require('../Modules/Workflows/store');
const executors = require('../Modules/Workflows/executors');
const stepTypes = require('../Modules/Workflows/stepTypes');
const roleHandoff = require('../Modules/Workflows/stepTypes/roleHandoff');
const { isWaiting } = require('../Modules/Workflows/stepTypes/waiting');
const findings = require('../Modules/Agents/manager/findings');
const places = require('../Modules/Agents/manager/places');
const engine = require('../Modules/Workflows/engine');

const CID = '6c0000000000000000000001';
const OTHER_CID = '6c0000000000000000000002';
const OWNER = '6c00000000000000000000a1';
const TASK = '6c00000000000000000000c3';
const PROJECT = '6c00000000000000000000d4';
const ROLE = 'it-company/qa-engineer';
const STEP = 'sQa';
const NEXT = 'sAfter';

const db = (id = CID) => mockDbFor(id);
const rows = (id = CID) => db(id).store[SCHEMA_TYPE.PROJECT_FINDINGS] || [];
const queueRow = () => rows().find((row) => row.rule === findings.HANDED_OVER);

let run;
const seedCompany = (id, roles = [ROLE]) => {
    db(id).seed(SCHEMA_TYPE.ASSIGNMENT_RULES, { projectId: PROJECT, entries: [], revision: 1, dispatcher: { mode: 'suggest', roles, rules: [], threshold: 80, revision: 1 } });
    db(id).seed(SCHEMA_TYPE.TASKS, { _id: TASK, ProjectID: PROJECT, TaskName: 'Test the parser', TaskKey: 'AH-7', statusType: 'open', deletedStatusKey: 0 });
};
const setRoles = (roles) => db().crud(CID, { type: SCHEMA_TYPE.ASSIGNMENT_RULES, data: [{ projectId: PROJECT }, { $set: { 'dispatcher.roles': roles } }] }, 'updateOne');
const seedRun = (config = { role: ROLE }) => {
    run = db().seed(SCHEMA_TYPE.WORKFLOW_RUNS, { workflowId: 'wf', status: 'running', startedBy: OWNER, taskId: TASK });
    db().seed(SCHEMA_TYPE.WORKFLOW_STEP_RUNS, {
        runId: String(run._id), stepId: STEP, index: 0, type: roleHandoff.TYPE, dependsOn: [], status: 'running', attempts: 1, maxAttempts: 3, fencingToken: 1, config,
    });
    db().seed(SCHEMA_TYPE.WORKFLOW_STEP_RUNS, {
        runId: String(run._id), stepId: NEXT, index: 1, type: roleHandoff.TYPE, dependsOn: [STEP], status: 'pending', attempts: 0, maxAttempts: 3, config: { role: ROLE },
    });
};
const stepRow = () => workflowStore.getStep(CID, run._id, STEP);
const execute = async (context = {}) => roleHandoff.execute({ companyId: CID, run: await workflowStore.getRun(CID, run._id), step: await stepRow(), context });
const settle = (promise) => promise.then((output) => ({ output }), (error) => ({ error }));
const setStep = (set) => db().crud(CID, { type: SCHEMA_TYPE.WORKFLOW_STEP_RUNS, data: [{ runId: String(run._id), stepId: STEP }, { $set: set }] }, 'updateOne');
const patchRun = (set) => db().crud(CID, { type: SCHEMA_TYPE.WORKFLOW_RUNS, data: [{ _id: run._id }, { $set: set }] }, 'updateOne');
const setTask = (set) => db().crud(CID, { type: SCHEMA_TYPE.TASKS, data: [{ _id: TASK }, { $set: set }] }, 'updateOne');
const withdrawn = () => expect(queueRow()).toMatchObject({ status: findings.STATUS.CLOSED, leftQueue: { why: findings.LEFT.WITHDRAWN } });
const audited = (action) => recordAudit.mock.calls.filter(([, entry]) => entry.action === action);

/* A step's first claim queues the task and hands the worker back, and what it noted on the row is there on the next claim. */
const handedOver = async () => {
    const first = await settle(execute());
    expect(isWaiting(first.error)).toBe(true);
    await setStep({ status: 'pending', ...first.error.wait.set });
    return first.error;
};
const roleFinishes = () => db().crud(CID, {
    type: SCHEMA_TYPE.PROJECT_FINDINGS,
    data: [{ _id: queueRow()._id }, { $set: { status: findings.STATUS.CLOSED, closedAt: new Date(), leftQueue: { why: findings.LEFT.FINISHED, userId: OWNER, name: 'QA Engineer, for Priya', at: new Date() } } }],
}, 'updateOne');
const roleGivesBack = (why = findings.LEFT.TAKEN_BACK) => db().crud(CID, {
    type: SCHEMA_TYPE.PROJECT_FINDINGS,
    data: [{ _id: queueRow()._id }, { $set: { status: findings.STATUS.CLOSED, closedAt: new Date(), leftQueue: { why, userId: OWNER, at: new Date() } } }],
}, 'updateOne');

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => delete mockDbs[key]);
    jest.clearAllMocks();
    seedCompany(CID);
    seedCompany(OTHER_CID);
    seedRun();
});

describe('role_handoff, registered behind WORKFLOW_ENGINE and DISPATCHER', () => {
    const load = (env) => {
        const saved = { WORKFLOW_ENGINE: process.env.WORKFLOW_ENGINE, DISPATCHER: process.env.DISPATCHER };
        Object.entries(env).forEach(([key, value]) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; });
        let loaded;
        jest.isolateModules(() => {
            loaded = { stepTypes: require('../Modules/Workflows/stepTypes'), executors: require('../Modules/Workflows/executors') };
        });
        Object.entries(saved).forEach(([key, value]) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; });
        return loaded;
    };
    const step = { id: 'sOne', type: 'role_handoff', config: { role: ROLE } };

    it('without the dispatcher, the step type is not registered, offered or accepted', () => {
        const off = load({ DISPATCHER: undefined });
        expect(off.executors.has('role_handoff')).toBe(false);
        expect(off.stepTypes.manifest().stepTypes.map((c) => c.key)).not.toContain('role_handoff');
        expect(off.stepTypes.validateSteps([step]).errors).toEqual(['steps[0].type: unknown step type "role_handoff"']);
    });

    it('without the workflow engine, it is not registered either', () => {
        expect(load({ WORKFLOW_ENGINE: undefined }).executors.has('role_handoff')).toBe(false);
    });

    it('with both on, it is offered, needs a role, and an approval can sit between two hand-overs', () => {
        expect(executors.has('role_handoff')).toBe(true);
        expect(stepTypes.manifest().stepTypes.find((c) => c.key === 'role_handoff').config.role).toMatchObject({ required: true });
        expect(stepTypes.validateSteps([{ id: 'sOne', type: 'role_handoff', config: {} }]).errors).toEqual(['steps[0].config.role: required by "role_handoff"']);
        const chain = [
            step,
            { id: 'sGate', type: 'human_approval', dependsOn: ['sOne'], config: { ownerRole: 'lead' } },
            { id: 'sTwo', type: 'role_handoff', dependsOn: ['sGate'], config: { role: 'it-company/code-reviewer' } },
        ];
        expect(stepTypes.validateSteps(chain)).toEqual({ valid: true, errors: [] });
    });

    it('a role that does not exist is refused when the workflow is saved', () => {
        expect(stepTypes.validateSteps([{ ...step, config: { role: 'it-company/nobody' } }]).errors).toEqual(['steps[0].config.role: there is no role "it-company/nobody"']);
    });
});

describe('handing over', () => {
    it('puts the task in the role queue, writes the audit row, emits the socket event and clears the cache, then waits', async () => {
        const emitted = jest.spyOn(socketEmitter, 'emit');
        const waiting = await handedOver();
        expect(waiting.wait.reason).toBe(`waiting for ${ROLE} to finish`);
        expect(queueRow()).toMatchObject({ rule: findings.HANDED_OVER, status: findings.STATUS.OPEN, taskId: TASK, facts: { role: ROLE, handedBy: OWNER } });
        expect(audited(roleHandoff.AUDIT.QUEUED)).toHaveLength(1);
        expect(audited(roleHandoff.AUDIT.QUEUED)[0][1]).toMatchObject({ entityType: 'task', entityId: TASK, meta: { runId: String(run._id), stepId: STEP, role: ROLE } });
        expect(emitted).toHaveBeenCalledWith('update', expect.objectContaining({ module: 'agent', companyId: CID }));
        expect(removeCache).toHaveBeenCalledWith('UserProjectData:', true);
        expect((await stepRow()).handedAt).toBeTruthy();
    });

    it('is company scoped: another company with the same ids sees nothing', async () => {
        await handedOver();
        expect(rows(OTHER_CID)).toHaveLength(0);
        expect(rows()).toHaveLength(1);
    });

    it('claimed again while the role works, it keeps waiting without queueing a second time', async () => {
        await handedOver();
        const again = await settle(execute());
        expect(isWaiting(again.error)).toBe(true);
        expect(rows()).toHaveLength(1);
        expect(audited(roleHandoff.AUDIT.QUEUED)).toHaveLength(1);
        expect(await again.error.recheck()).toBe(false);
    });

    it('waits, without queueing, while agents are paused in the project', async () => {
        db().seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT, ProjectName: 'P', agentLimits: { paused: true } });
        const first = await settle(execute());
        expect(isWaiting(first.error)).toBe(true);
        expect(first.error.wait.reason).toMatch(/switched on again/);
        expect(first.error.wait.set.handedAt).toBeUndefined();
        expect(rows()).toHaveLength(0);
    });
});

describe('the role finishes', () => {
    it('continues with the outcome, who finished it and an audit row', async () => {
        await handedOver();
        roleFinishes();
        const done = await settle(execute());
        expect(done.output).toMatchObject({ role: ROLE, taskId: TASK, outcome: 'finished', finishedBy: 'QA Engineer, for Priya' });
        expect(audited(roleHandoff.AUDIT.FINISHED)).toHaveLength(1);
        expect((await workflowStore.getStep(CID, run._id, NEXT)).status).toBe('pending');
    });

    it('wakes a waiting step early: the recheck turns true once the role is done', async () => {
        const waiting = await handedOver();
        expect(await waiting.recheck()).toBe(false);
        roleFinishes();
        expect(await waiting.recheck()).toBe(true);
    });

    it('a second hand-over of the same task to another role queues it again', async () => {
        await handedOver();
        roleFinishes();
        await settle(execute());
        setRoles([ROLE, 'it-company/code-reviewer']);
        await setStep({ config: { role: 'it-company/code-reviewer' }, handedAt: null, waitingSince: null });
        const second = await settle(execute());
        expect(isWaiting(second.error)).toBe(true);
        expect(queueRow()).toMatchObject({ status: findings.STATUS.OPEN, facts: { role: 'it-company/code-reviewer' } });
        expect(queueRow().leftQueue).toBeUndefined();
    });
});

describe('the role releases it', () => {
    it('by default ends this path: the steps after it are skipped and the outcome says released', async () => {
        await handedOver();
        roleGivesBack();
        const done = await settle(execute());
        expect(done.output).toMatchObject({ outcome: 'released', skipped: [NEXT] });
        expect((await workflowStore.getStep(CID, run._id, NEXT)).status).toBe('skipped');
        expect(audited(roleHandoff.AUDIT.RELEASED)).toHaveLength(1);
    });

    it('with onRelease continue, the steps after it still run', async () => {
        await setStep({ config: { role: ROLE, onRelease: 'continue' } });
        await handedOver();
        roleGivesBack(findings.LEFT.WITHDRAWN);
        const done = await settle(execute());
        expect(done.output).toMatchObject({ outcome: 'released', skipped: [] });
        expect((await workflowStore.getStep(CID, run._id, NEXT)).status).toBe('pending');
    });

    it('a lead moving the task to another role counts as the role letting go', async () => {
        await handedOver();
        db().crud(CID, { type: SCHEMA_TYPE.PROJECT_FINDINGS, data: [{ _id: queueRow()._id }, { $set: { 'facts.role': 'it-company/code-reviewer' } }] }, 'updateOne');
        expect((await settle(execute())).output).toMatchObject({ outcome: 'released' });
    });
});

describe('the wait runs out', () => {
    it('takes the task out of the role queue, audits it and fails the step without a retry', async () => {
        await handedOver();
        await setStep({ handedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) });
        const out = await settle(execute());
        expect(out.error).toMatchObject({ deterministic: true });
        expect(out.error.message).toMatch(/did not finish by/);
        expect(queueRow()).toMatchObject({ status: findings.STATUS.CLOSED, leftQueue: { why: findings.LEFT.WITHDRAWN } });
        expect(audited(roleHandoff.AUDIT.TIMED_OUT)).toHaveLength(1);
    });

    it('uses the step own deadline', async () => {
        await handedOver();
        await setStep({ config: { role: ROLE, deadlineMs: 60 * 1000 }, handedAt: new Date(Date.now() - 2 * 60 * 1000) });
        expect((await settle(execute())).error).toMatchObject({ deterministic: true });
        withdrawn();
    });

    it('ends before the run deadline, with room left to take the task back', async () => {
        const runEnds = new Date(Date.now() + 10 * 60 * 1000);
        await patchRun({ deadlineAt: runEnds });
        const waiting = await handedOver();
        expect(waiting.until.getTime()).toBeLessThanOrEqual(runEnds.getTime() - 60 * 1000);
        await patchRun({ deadlineAt: new Date(Date.now() + 30 * 1000) });
        const out = await settle(execute());
        expect(out.error.message).toMatch(/did not finish by/);
        withdrawn();
    });

    it('a step deadline longer than what the run has left ends before the hop guard would refuse it', async () => {
        const runEnds = new Date(Date.now() + 60 * 60 * 1000);
        await patchRun({ deadlineAt: runEnds });
        await setStep({ config: { role: ROLE, deadlineMs: 20 * 60 * 1000 } });
        const waiting = await handedOver();
        expect(waiting.until.getTime()).toBeLessThanOrEqual(runEnds.getTime() - 20 * 60 * 1000);
    });
});

describe('a role that cannot take it', () => {
    it('fails at once, naming the role, when it does not exist', async () => {
        await setStep({ config: { role: 'it-company/nobody' } });
        const out = await settle(execute());
        expect(out.error).toMatchObject({ deterministic: true });
        expect(out.error.message).toMatch(/there is no role "it-company\/nobody"/);
        expect(rows()).toHaveLength(0);
    });

    it('fails when the role is not on for the project, and queues nothing', async () => {
        setRoles([]);
        const out = await settle(execute());
        expect(out.error).toMatchObject({ deterministic: true });
        expect(out.error.message).toMatch(/not on for this task's project/);
        expect(rows()).toHaveLength(0);
    });

    it('fails when the task is missing or already done', async () => {
        await setStep({ config: { role: ROLE, taskId: '6c00000000000000000000ff' } });
        expect((await settle(execute())).error.message).toMatch(/was not found/);
        await setStep({ config: { role: ROLE } });
        db().crud(CID, { type: SCHEMA_TYPE.TASKS, data: [{ _id: TASK }, { $set: { statusType: 'close' } }] }, 'updateOne');
        expect((await settle(execute())).error.message).toMatch(/already done/);
    });

    it('refuses to run when the dispatcher is switched off after the definition was saved', async () => {
        process.env.DISPATCHER = 'off';
        try {
            expect((await settle(execute())).error.message).toMatch(/needs WORKFLOW_ENGINE and DISPATCHER on/);
        } finally {
            process.env.DISPATCHER = 'on';
        }
        expect(rows()).toHaveLength(0);
    });
});

describe('waiting while agents are paused', () => {
    const pause = (paused) => db().crud(CID, { type: SCHEMA_TYPE.PROJECTS, data: [{ _id: PROJECT }, { $set: { agentLimits: { paused } } }] }, 'updateOne');

    it('looks again every 30 seconds rather than at once, and is woken only once agents are back', async () => {
        db().seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT, ProjectName: 'P', agentLimits: { paused: true } });
        const first = await settle(execute());
        expect(first.error.retryAfterMs).toBe(30 * 1000);
        expect(await first.error.recheck()).toBe(false);
        await pause(false);
        expect(await first.error.recheck()).toBe(true);
    });

    it('paused after the hand-over, the step keeps waiting and says so', async () => {
        db().seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT, ProjectName: 'P', agentLimits: { paused: false } });
        await handedOver();
        await pause(true);
        const again = await settle(execute());
        expect(again.error.wait.reason).toMatch(/switched on again; .* holds the task/);
        expect(await again.error.recheck()).toBe(false);
        expect(queueRow().status).toBe(findings.STATUS.OPEN);
    });
});

describe('after the hand-over', () => {
    it('a closed task wakes the step, which fails and takes the task back', async () => {
        const waiting = await handedOver();
        await setTask({ statusType: 'close' });
        expect(await waiting.recheck()).toBe(true);
        const out = await settle(execute());
        expect(out.error).toMatchObject({ deterministic: true });
        expect(out.error.message).toMatch(/was closed before/);
        withdrawn();
        expect(audited(roleHandoff.AUDIT.WITHDRAWN)[0][1]).toMatchObject({ meta: { reason: 'task_closed', role: ROLE } });
    });

    it('a deleted task wakes the step, which fails and takes the task back', async () => {
        const waiting = await handedOver();
        await setTask({ deletedStatusKey: 1 });
        expect(await waiting.recheck()).toBe(true);
        expect((await settle(execute())).error.message).toMatch(/was not found/);
        withdrawn();
        expect(audited(roleHandoff.AUDIT.WITHDRAWN)[0][1]).toMatchObject({ meta: { reason: 'task_gone' } });
    });

    it('a role switched off for the project fails the step with the reason and takes the task back', async () => {
        await handedOver();
        await setRoles([]);
        const out = await settle(execute());
        expect(out.error.message).toMatch(/was switched off for this task's project/);
        withdrawn();
        expect(audited(roleHandoff.AUDIT.WITHDRAWN)[0][1]).toMatchObject({ meta: { reason: 'role_off' } });
    });

    it('a finish by another role the task was moved to is a release for this step', async () => {
        await handedOver();
        roleFinishes();
        db().crud(CID, { type: SCHEMA_TYPE.PROJECT_FINDINGS, data: [{ _id: queueRow()._id }, { $set: { 'facts.role': 'it-company/code-reviewer' } }] }, 'updateOne');
        expect((await settle(execute())).output).toMatchObject({ outcome: 'released' });
        expect(audited(roleHandoff.AUDIT.FINISHED)).toHaveLength(0);
    });

    it('taking it back frees the place an agent held on it', async () => {
        const giveBack = jest.spyOn(places, 'giveBack');
        await handedOver();
        await setStep({ handedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) });
        await settle(execute());
        expect(giveBack).toHaveBeenCalledWith(CID, queueRow()._id);
        giveBack.mockRestore();
    });
});

describe('every other way the step ends takes the task back too', () => {
    it('the hop guard refusing it once the run is out of time', async () => {
        await handedOver();
        await patchRun({ deadlineAt: new Date(Date.now() - 1000) });
        const steps = await workflowStore.listSteps(CID, run._id);
        const out = await engine.runStep(CID, await workflowStore.getRun(CID, run._id), steps.find((step) => step.stepId === STEP), { steps });
        expect(out.outcome).toBe('blocked');
        withdrawn();
        expect(audited(roleHandoff.AUDIT.WITHDRAWN)).toHaveLength(1);
    });

    it('an executor that is gone, as when DISPATCHER is switched off and the server restarts', async () => {
        await handedOver();
        const ok = await engine.failUnclaimed(CID, run, await stepRow(), { workerId: 'w', error: 'no executor', code: 'unknown_step_type' });
        expect(ok).toBe(true);
        withdrawn();
    });

    it('a person skipping it, once only', async () => {
        await handedOver();
        expect(await executors.ended({ companyId: CID, run, step: await stepRow(), why: 'skipped by a person' })).toBe(true);
        withdrawn();
        expect(await executors.ended({ companyId: CID, run, step: await stepRow(), why: 'skipped by a person' })).toBe(false);
        expect(audited(roleHandoff.AUDIT.WITHDRAWN)).toHaveLength(1);
        expect(audited(roleHandoff.AUDIT.WITHDRAWN)[0][1]).toMatchObject({ entityId: TASK, entityName: 'Test the parser', meta: { reason: 'skipped by a person' } });
    });

    it('the run ending while the step still waits', async () => {
        await handedOver();
        await engine.finish(CID, run, await workflowStore.listSteps(CID, run._id), { code: 'deadline_exceeded', reason: 'out of time', stepId: NEXT });
        withdrawn();
    });

    it('a step that never handed anything over leaves the queue alone', async () => {
        expect(await executors.ended({ companyId: CID, run, step: await stepRow(), why: 'skipped' })).toBe(false);
        expect(rows()).toHaveLength(0);
    });
});
