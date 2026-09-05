const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async () => 'owner'), isPrivileged: (r) => r === 'owner' || r === 'admin' }));
jest.mock('../Modules/Agents/actor', () => ({ resolveActor: jest.fn(async (req) => ({ kind: 'human', userId: req.uid })), isAgent: (a) => a.kind === 'agent' }));
jest.mock('../Modules/Automations/engine/tools', () => ({ getTask: jest.fn() }));
jest.mock('../Modules/Agents/engine/orchestrator', () => ({ run: jest.fn() }));
jest.mock('../Modules/Agents/engine/findingMemory', () => ({ load: jest.fn(async () => new Map()), decide: jest.fn(), record: jest.fn(), touch: jest.fn() }));
jest.mock('../Modules/AIProjectGenerator/usage', () => ({ summarize: jest.fn(() => ({ costUsd: 0, totalTokens: 0, model: 'm' })) }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn(async () => ({ status: true })) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const tools = require('../Modules/Automations/engine/tools');
const orchestrator = require('../Modules/Agents/engine/orchestrator');
const memory = require('../Modules/Agents/engine/findingMemory');
const { summarize } = require('../Modules/AIProjectGenerator/usage');
const { handleNotificationtFun } = require('../Modules/notification/prepare-notification-data/controllerV2');
const runs = require('../Modules/Agents/runs');
const ctrl = require('../Modules/Agents/controller');

const C = '6f0000000000000000000c01';
const AGENT_ID = '6f0000000000000000000a01';
const TASK = { _id: '6f0000000000000000000701', TaskName: 'Review https://example.com', TaskKey: 'AR-1', ProjectID: 'p1' };
const agent = (over = {}) => ({ _id: AGENT_ID, name: 'Reviewer', autonomy: 1, allowedActions: [], account: 'workspace', spendCapUsd: 10, paused: false, deletedStatusKey: 0, ...over });
const actor = { kind: 'agent', userId: 'u1', agentId: AGENT_ID, agentName: 'Reviewer', runId: null, viaAccount: 'workspace', tokenId: null };
const finding = { factId: 'f1', title: 'Missing alt', severity: 'high', why: 'w' };

const deps = () => ({ proposals: { create: jest.fn(async () => ({ _id: 'prop1' })) }, actions: { perform: jest.fn(async () => ({ auditId: 'aud1', result: { subtaskId: 'st1' } })) }, actor });
const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; return r; };
const req = (body, over = {}) => ({ headers: { companyid: C }, params: {}, query: {}, body, uid: 'u1', ...over });
const runRow = (id) => mockDb.store[SCHEMA_TYPE.AGENT_RUNS].find((r) => String(r._id) === String(id));
const agentRow = () => mockDb.store[SCHEMA_TYPE.AGENTS].find((a) => String(a._id) === AGENT_ID);
const flush = () => new Promise((resolve) => setImmediate(resolve));
const startRun = async (body) => { const r = res(); await ctrl.startRun(req({ agentId: AGENT_ID, taskId: TASK._id, ...body }), r); await flush(); return r; };
const success = () => orchestrator.run.mockResolvedValue({ status: 'success', skill: 'qa-review', findings: [finding], summary: 'one issue', usage: { totalTokens: 500 }, model: 'm' });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    memory.load.mockResolvedValue(new Map());
    memory.decide.mockImplementation(async (companyId, taskId, findings) => findings.map((f) => ({ finding: f, action: 'file', reason: 'new' })));
    summarize.mockReturnValue({ costUsd: 0, totalTokens: 0, model: 'm' });
    tools.getTask.mockResolvedValue(TASK);
    mockDb.seed(SCHEMA_TYPE.AGENTS, agent());
});

describe('POST /agents/runs persists the picker options', () => {
    beforeEach(() => jest.spyOn(runs, 'executeSkill').mockResolvedValue({ status: 'done' }));
    afterEach(() => runs.executeSkill.mockRestore());

    it('stores spendCapUsd and notifyMe on the run, and GET /agents/runs/:id returns them', async () => {
        const started = await startRun({ spendCapUsd: 5, notifyMe: true });
        expect(started.body.status).toBe(true);
        expect(started.body.data).toMatchObject({ spendCapUsd: 5, notifyMe: true, startedBy: 'u1' });
        expect(runRow(started.body.data._id)).toMatchObject({ spendCapUsd: 5, notifyMe: true });

        const got = res();
        await ctrl.getRun(req({}, { params: { id: String(started.body.data._id) } }), got);
        expect(got.body.data.run).toMatchObject({ spendCapUsd: 5, notifyMe: true });
    });

    it('accepts a numeric string cap, omits the cap when absent and defaults notifyMe to false', async () => {
        const capped = await startRun({ spendCapUsd: '2.5', notifyMe: 'yes' });
        expect(runRow(capped.body.data._id)).toMatchObject({ spendCapUsd: 2.5, notifyMe: true });

        const plain = await startRun({});
        const row = runRow(plain.body.data._id);
        expect('spendCapUsd' in row).toBe(false);
        expect(row.notifyMe).toBe(false);
    });

    it.each([['abc'], [0], [-2], ['']])('refuses spendCapUsd %p with a 400 and starts nothing', async (value) => {
        const r = await startRun({ spendCapUsd: value });
        expect(r.code).toBe(400);
        expect(r.body).toEqual({ status: false, statusText: 'spendCapUsd must be a number greater than 0', message: 'spendCapUsd must be a number greater than 0' });
        expect(mockDb.store[SCHEMA_TYPE.AGENT_RUNS] || []).toHaveLength(0);
        expect(runs.executeSkill).not.toHaveBeenCalled();
    });
});

describe('a run stops at its own spend cap', () => {
    it('ends stopped with the amounts in the outcome, files nothing, and leaves the agent running', async () => {
        const d = deps();
        success();
        summarize.mockReturnValue({ costUsd: 0.02, totalTokens: 500, model: 'm' });
        const run = await runs.create(C, { agent: agent(), taskId: TASK._id, projectId: 'p1', skill: 'qa-review', startedBy: 'u1', spendCapUsd: 0.01 });
        const out = await runs.executeSkill(C, run, agent(), TASK, d);
        expect(out).toMatchObject({ status: 'stopped', outcome: 'Run spend cap reached ($0.02 of $0.01)' });
        expect(runRow(run._id)).toMatchObject({ status: 'stopped', outcome: 'Run spend cap reached ($0.02 of $0.01)', spend: { usd: 0.02, tokens: 500 } });
        expect(d.proposals.create).not.toHaveBeenCalled();
        expect(d.actions.perform).not.toHaveBeenCalled();
        expect(agentRow().paused).toBe(false);
    });

    it('carries on under the cap and without one', async () => {
        success();
        summarize.mockReturnValue({ costUsd: 0.02, totalTokens: 500, model: 'm' });
        const under = await runs.create(C, { agent: agent(), taskId: TASK._id, projectId: 'p1', skill: 'qa-review', spendCapUsd: 1 });
        expect((await runs.executeSkill(C, under, agent(), TASK, deps())).status).toBe('waiting_approval');
        const uncapped = await runs.create(C, { agent: agent(), taskId: TASK._id, projectId: 'p1', skill: 'qa-review' });
        expect((await runs.executeSkill(C, uncapped, agent(), TASK, deps())).status).toBe('waiting_approval');
    });

    it('does not resurrect a run that was stopped while the skill ran', async () => {
        summarize.mockReturnValue({ costUsd: 0.02, totalTokens: 500, model: 'm' });
        const run = await runs.create(C, { agent: agent(), taskId: TASK._id, projectId: 'p1', skill: 'qa-review', spendCapUsd: 0.01 });
        orchestrator.run.mockImplementation(async () => {
            await runs.stop(C, run._id, 'u2');
            return { status: 'success', skill: 'qa-review', findings: [finding], summary: 's', usage: {}, model: 'm' };
        });
        expect((await runs.executeSkill(C, run, agent(), TASK, deps())).status).toBe('abandoned');
        expect(runRow(run._id)).toMatchObject({ status: 'stopped', outcome: 'stopped by u2' });
    });
});

describe('notifyMe tells the starter once, when the run needs them or is over', () => {
    it('notifies the starter through the task-notification pipeline when the run waits for approval', async () => {
        success();
        const run = await runs.create(C, { agent: agent(), taskId: TASK._id, projectId: 'p1', skill: 'qa-review', startedBy: 'u1', notifyMe: true });
        expect((await runs.executeSkill(C, run, agent(), TASK, deps())).status).toBe('waiting_approval');
        expect(handleNotificationtFun).toHaveBeenCalledTimes(1);
        expect(handleNotificationtFun.mock.calls[0][0].body).toMatchObject({
            key: 'task_notification', type: 'tasks', changeType: 'agent_run',
            companyId: C, projectId: 'p1', taskId: TASK._id,
            userId: AGENT_ID, assigneeUsers: ['u1'], notSeen: ['u1'],
            message: 'Reviewer run on AR-1 needs your approval',
            changeData: { runId: String(run._id), agentId: AGENT_ID, status: 'waiting_approval' },
        });
    });

    it('notifies once on a terminal state with the outcome, and a failed notification does not fail the run', async () => {
        success();
        handleNotificationtFun.mockRejectedValueOnce(new Error('smtp down'));
        const run = await runs.create(C, { agent: agent({ autonomy: 2 }), taskId: TASK._id, projectId: 'p1', skill: 'qa-review', startedBy: 'u1', notifyMe: true });
        const out = await runs.executeSkill(C, run, agent({ autonomy: 2 }), TASK, deps());
        expect(out).toMatchObject({ status: 'done', outcome: '2 change(s) applied' });
        expect(runRow(run._id).status).toBe('done');
        expect(handleNotificationtFun).toHaveBeenCalledTimes(1);
        expect(handleNotificationtFun.mock.calls[0][0].body.message).toBe('Reviewer run on AR-1 is done — 2 change(s) applied');
    });

    it('stays silent without notifyMe, and for a run that was stopped mid-flight', async () => {
        success();
        const quiet = await runs.create(C, { agent: agent(), taskId: TASK._id, projectId: 'p1', skill: 'qa-review', startedBy: 'u1' });
        await runs.executeSkill(C, quiet, agent(), TASK, deps());
        expect(handleNotificationtFun).not.toHaveBeenCalled();

        const raced = await runs.create(C, { agent: agent(), taskId: TASK._id, projectId: 'p1', skill: 'qa-review', startedBy: 'u1', notifyMe: true });
        orchestrator.run.mockImplementation(async () => { await runs.stop(C, raced._id, 'u2'); return { status: 'success', skill: 'qa-review', findings: [finding], summary: 's', usage: {}, model: 'm' }; });
        expect((await runs.executeSkill(C, raced, agent(), TASK, deps())).status).toBe('abandoned');
        expect(handleNotificationtFun).not.toHaveBeenCalled();
    });
});
