jest.mock('../Modules/Workflows/store');
jest.mock('../Modules/Workflows/queue');
jest.mock('../Modules/Agents/access');
jest.mock('../Modules/Agents/revert');

const store = require('../Modules/Workflows/store');
const queue = require('../Modules/Workflows/queue');
const access = require('../Modules/Agents/access');
const revert = require('../Modules/Agents/revert');
const controller = require('../Modules/Workflows/controller');
const scheduler = require('../Modules/Workflows/scheduler');
const stepTypes = require('../Modules/Workflows/stepTypes');

const COMPANY = '0123456789abcdef01234567';
const RUN_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const AGENT_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const TASK_ID = 'cccccccccccccccccccccccc';
const OWNER = 'dddddddddddddddddddddddd';
const MEMBER = 'eeeeeeeeeeeeeeeeeeeeeeee';

const reqFor = (over = {}) => ({ headers: { companyid: COMPANY }, params: {}, query: {}, body: {}, ip: '', ...over });

const resSpy = () => {
    const res = { statusCode: 200, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (body) => { res.body = body; return res; };
    return res;
};

const asCaller = ({ human = true, privileged = true, userId = OWNER } = {}) => {
    access.callerOf.mockResolvedValue({ actor: { userId, kind: human ? 'human' : 'agent' }, human, privileged });
    access.canManageAgents.mockImplementation((caller) => Boolean(caller && caller.human && caller.privileged));
    access.visibleProjectIdsFor.mockResolvedValue([]);
};

const savedFlag = process.env.WORKFLOW_ENGINE;

beforeEach(() => {
    jest.clearAllMocks();
    process.env.WORKFLOW_ENGINE = 'on';
    asCaller();
    queue.dispatch.mockResolvedValue('queued');
    store.listSteps.mockResolvedValue([]);
    store.reopenRun.mockResolvedValue({ matchedCount: 1 });
});

afterAll(() => { if (savedFlag === undefined) delete process.env.WORKFLOW_ENGINE; else process.env.WORKFLOW_ENGINE = savedFlag; });

describe('the flag gates the whole surface', () => {
    it('answers 503 on every route while the engine is off', async () => {
        process.env.WORKFLOW_ENGINE = 'off';
        const handlers = [controller.startRun, controller.listRuns, controller.getRun, controller.retryStep, controller.skipStep, controller.resumeStep, controller.compensateStep];
        for (const handler of handlers) {
            const res = resSpy();
            // eslint-disable-next-line no-await-in-loop
            await handler(reqFor({ params: { id: RUN_ID, stepId: 'sAgent' } }), res);
            expect(res.statusCode).toBe(503);
            expect(res.body).toMatchObject({ status: false });
            expect(res.body.message).toMatch(/WORKFLOW_ENGINE/);
        }
        expect(store.createRun).not.toHaveBeenCalled();
        expect(store.getRun).not.toHaveBeenCalled();
    });
});

describe('who may manage a workflow run', () => {
    it('refuses a member every control, and lets them read', async () => {
        asCaller({ privileged: false, userId: MEMBER });
        store.getRun.mockResolvedValue({ _id: RUN_ID, startedBy: MEMBER });
        store.listRuns.mockResolvedValue([{ _id: RUN_ID, startedBy: MEMBER }]);

        for (const handler of [controller.startRun, controller.retryStep, controller.skipStep, controller.resumeStep, controller.compensateStep]) {
            const res = resSpy();
            // eslint-disable-next-line no-await-in-loop
            await handler(reqFor({ params: { id: RUN_ID, stepId: 'sAgent' }, body: { agentId: AGENT_ID, taskId: TASK_ID } }), res);
            expect(res.statusCode).toBe(403);
            expect(res.body.message).toMatch(/Owner or an Admin/);
        }

        const read = resSpy();
        await controller.getRun(reqFor({ params: { id: RUN_ID } }), read);
        expect(read.body.status).toBe(true);
    });

    it('refuses an agent token outright', async () => {
        asCaller({ human: false });
        const res = resSpy();
        await controller.listRuns(reqFor(), res);
        expect(res.statusCode).toBe(403);
        expect(res.body.message).toMatch(/a person has to/);
    });

    it('hides a run the reader neither started nor can see the project of', async () => {
        asCaller({ privileged: false, userId: MEMBER });
        store.getRun.mockResolvedValue({ _id: RUN_ID, startedBy: OWNER, projectId: 'ffffffffffffffffffffffff' });
        access.visibleProjectIdsFor.mockResolvedValue(['111111111111111111111111']);
        const res = resSpy();
        await controller.getRun(reqFor({ params: { id: RUN_ID } }), res);
        expect(res.statusCode).toBe(404);
    });

    it('refuses a request whose body names a different company than its header', async () => {
        const res = resSpy();
        await controller.listRuns(reqFor({ body: { companyId: '999999999999999999999999' } }), res);
        expect(res.statusCode).toBe(403);
        expect(store.listRuns).not.toHaveBeenCalled();
    });
});

describe('starting a run', () => {
    it('turns the agent shorthand into one agent_run step and queues it', async () => {
        store.createRun.mockResolvedValue({ _id: RUN_ID });
        store.getRun.mockResolvedValue({ _id: RUN_ID, status: 'running' });
        const res = resSpy();

        await controller.startRun(reqFor({ body: { agentId: AGENT_ID, taskId: TASK_ID, note: 'please review' } }), res);

        expect(res.body.status).toBe(true);
        const [, created] = store.createRun.mock.calls[0];
        expect(created.steps).toEqual([expect.objectContaining({ id: 'sAgent', type: stepTypes.AGENT_RUN })]);
        expect(created.steps[0].config).toMatchObject({ agentId: AGENT_ID, taskId: TASK_ID, note: 'please review' });
        expect(created.startedBy).toBe(OWNER);
        expect(queue.dispatch).toHaveBeenCalledWith(COMPANY, RUN_ID);
    });

    it('returns the first run when the same idempotency key comes back', async () => {
        store.createRun.mockResolvedValue(null);
        store.findRunByDedupeKey.mockResolvedValue({ _id: RUN_ID, status: 'running' });
        const res = resSpy();

        await controller.startRun(reqFor({ headers: { companyid: COMPANY, 'idempotency-key': 'k-1' }, body: { agentId: AGENT_ID, taskId: TASK_ID } }), res);

        expect(res.body.data).toMatchObject({ deduplicated: true });
        expect(res.body.data.run._id).toBe(RUN_ID);
        expect(queue.dispatch).not.toHaveBeenCalled();
        expect(store.createRun.mock.calls[0][1].dedupeKey).toBe(`api:${OWNER}:k-1`);
    });

    it('refuses a definition it cannot execute', async () => {
        const cases = [
            [{ steps: [] }, /non-empty/],
            [{ steps: [{ id: 'a', type: 'no_such_type' }] }, /no executor is registered/],
            [{ steps: [{ id: 'a', type: stepTypes.AGENT_RUN }, { id: 'a', type: stepTypes.AGENT_RUN }] }, /used twice/],
            [{ steps: [{ id: 'a', type: stepTypes.AGENT_RUN, dependsOn: ['ghost'] }] }, /not a step of this workflow/],
            [{ agentId: AGENT_ID }, /valid taskId/],
            [{}, /valid agentId/],
        ];
        for (const [body, message] of cases) {
            const res = resSpy();
            // eslint-disable-next-line no-await-in-loop
            await controller.startRun(reqFor({ body }), res);
            expect(res.statusCode).toBe(400);
            expect(res.body.message).toMatch(message);
        }
        expect(store.createRun).not.toHaveBeenCalled();
    });
});

describe('the per-step controls', () => {
    beforeEach(() => {
        store.getRun.mockResolvedValue({ _id: RUN_ID, status: 'failed', startedBy: OWNER });
        store.getStep.mockResolvedValue({ runId: RUN_ID, stepId: 'sAgent', type: stepTypes.AGENT_RUN, status: 'failed' });
    });

    const control = (handler, over = {}) => handler(reqFor({ params: { id: RUN_ID, stepId: 'sAgent' }, body: { reason: 'the provider was down' }, ...over }), resSpy());

    it('retries, skips and resumes a step and puts the run back on the queue', async () => {
        const cases = [[controller.retryStep, store.retryStep], [controller.skipStep, store.operatorSkipStep], [controller.resumeStep, store.resumeStep]];
        for (const [handler, write] of cases) {
            jest.clearAllMocks();
            store.getRun.mockResolvedValue({ _id: RUN_ID, status: 'failed' });
            store.getStep.mockResolvedValue({ runId: RUN_ID, stepId: 'sAgent', status: 'failed' });
            store.listSteps.mockResolvedValue([]);
            queue.dispatch.mockResolvedValue('queued');
            write.mockResolvedValue({ runId: RUN_ID, stepId: 'sAgent', status: 'pending' });

            // eslint-disable-next-line no-await-in-loop
            const res = await control(handler);
            expect(res.body.status).toBe(true);
            expect(write).toHaveBeenCalledWith(COMPANY, RUN_ID, 'sAgent', { by: OWNER, reason: 'the provider was down' });
            expect(store.reopenRun).toHaveBeenCalledWith(COMPANY, RUN_ID);
            expect(queue.dispatch).toHaveBeenCalledWith(COMPANY, RUN_ID);
        }
    });

    it('refuses a control on a step in the wrong state', async () => {
        store.retryStep.mockResolvedValue(null);
        const res = await control(controller.retryStep);
        expect(res.statusCode).toBe(409);
        expect(res.body.message).toMatch(/failed or skipped/);
        expect(queue.dispatch).not.toHaveBeenCalled();
    });

    it('answers 404 for a step of another run', async () => {
        store.getStep.mockResolvedValue(null);
        const res = await control(controller.skipStep);
        expect(res.statusCode).toBe(404);
        expect(store.operatorSkipStep).not.toHaveBeenCalled();
    });
});

describe('compensating a step', () => {
    it('reverts the agent run the step made and records what came back', async () => {
        store.getRun.mockResolvedValue({ _id: RUN_ID, status: 'failed' });
        store.getStep.mockResolvedValue({ runId: RUN_ID, stepId: 'sAgent', type: stepTypes.AGENT_RUN, status: 'success', output: { agentRunId: 'a1' } });
        revert.revertRun.mockResolvedValue({ reverted: 2, failed: [] });
        store.recordCompensation.mockResolvedValue({ stepId: 'sAgent', compensation: { reverted: 2 } });
        const res = resSpy();

        await controller.compensateStep(reqFor({ params: { id: RUN_ID, stepId: 'sAgent' } }), res);

        expect(revert.revertRun).toHaveBeenCalledWith(COMPANY, 'a1', expect.objectContaining({ isPrivileged: true }));
        expect(store.recordCompensation).toHaveBeenCalledWith(COMPANY, RUN_ID, 'sAgent', expect.objectContaining({ reverted: 2, agentRunId: 'a1' }));
        expect(res.body.data.revert).toMatchObject({ reverted: 2 });
    });

    it('says so when the step type has nothing to undo', async () => {
        store.getRun.mockResolvedValue({ _id: RUN_ID });
        store.getStep.mockResolvedValue({ runId: RUN_ID, stepId: 'rule', type: 'automation_rule', status: 'failed' });
        const res = resSpy();
        await controller.compensateStep(reqFor({ params: { id: RUN_ID, stepId: 'rule' } }), res);
        expect(res.statusCode).toBe(409);
        expect(revert.revertRun).not.toHaveBeenCalled();
    });

    it('passes the revert refusal straight through', async () => {
        store.getRun.mockResolvedValue({ _id: RUN_ID });
        store.getStep.mockResolvedValue({ runId: RUN_ID, stepId: 'sAgent', type: stepTypes.AGENT_RUN, status: 'success', output: { agentRunId: 'a1' } });
        revert.revertRun.mockResolvedValue({ error: 'The revert window closed.', status: 409 });
        const res = resSpy();
        await controller.compensateStep(reqFor({ params: { id: RUN_ID, stepId: 'sAgent' } }), res);
        expect(res.statusCode).toBe(409);
        expect(store.recordCompensation).not.toHaveBeenCalled();
    });
});

describe('a skip a person asked for', () => {
    const row = (over) => ({ runId: RUN_ID, index: 0, status: 'pending', dependsOn: [], ...over });

    it('lets the steps behind it run, unlike one the engine wrote', () => {
        const byEngine = [row({ stepId: 'a', status: 'skipped' }), row({ stepId: 'b', index: 1, dependsOn: ['a'] })];
        expect(scheduler.readySet(byEngine).map((s) => s.stepId)).toEqual([]);
        expect(scheduler.blockedSet(byEngine).map((b) => b.step.stepId)).toEqual(['b']);

        const byPerson = [row({ stepId: 'a', status: 'skipped', skippedBy: OWNER }), row({ stepId: 'b', index: 1, dependsOn: ['a'] })];
        expect(scheduler.readySet(byPerson).map((s) => s.stepId)).toEqual(['b']);
        expect(scheduler.blockedSet(byPerson)).toEqual([]);
    });

    it('does not make the run a failure', () => {
        const steps = [row({ stepId: 'a', status: 'skipped', skippedBy: OWNER }), row({ stepId: 'b', status: 'success' })];
        expect(scheduler.runStatus(steps)).toBe('success');
    });
});
