const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/completionStore', () => ({ forStatusChange: jest.fn(async () => null), recordWork: jest.fn(async () => null) }));
jest.mock('../Modules/Agents/permissions', () => ({ holderMay: jest.fn(async () => ({ allowed: true, reason: '' })) }));
jest.mock('../Modules/Agents/budget', () => ({ check: jest.fn(async () => ({ ok: true, reason: '' })) }));
jest.mock('../Modules/AICore/usage', () => ({ checkConfiguredModelPriced: () => ({ ok: true, reason: '' }), unpricedMessage: (m) => `No price on file for ${m}`, summarize: jest.fn() }));
jest.mock('../Modules/Agents/engine/graph', () => ({ resumeGraph: jest.fn(async () => ({ resumed: false })) }));
jest.mock('../Modules/AICore/persistence', () => {
    const deleteThread = jest.fn(async () => {});
    return { deleteThread, saverFor: jest.fn(() => ({ deleteThread })), storeFor: jest.fn(() => { throw new Error('no store in this suite'); }), ready: jest.fn(async () => {}) };
});

const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const bus = require('../event/domainEventBus');
const actions = require('../Modules/Agents/actions');
const runs = require('../Modules/Agents/runs');
const proposals = require('../Modules/Agents/proposals');
const memory = require('../Modules/Agents/memory');
const runAgent = require('../Modules/Automations/engine/actions/runAgent');

const C = '6a8ee973d625fca52e519a12';
const AGENT_ID = '6f0000000000000000000a01';
const RULE_ID = '6f0000000000000000000b01';
const TASK_ID = '6f0000000000000000000701';
const PROJECT_ID = '6a9954186dd786246031e47b';
const ITERATION_CAP = 20;
const originDepth = (run) => Math.max(0, Number(run && run.triggerDepth) || 0);

const agentDoc = () => ({ _id: AGENT_ID, name: 'Code Reviewer', account: 'workspace', autonomy: 2, projectIds: [], allowedActions: [], deletedStatusKey: 0 });
const taskDoc = () => ({ _id: TASK_ID, CompanyId: C, ProjectID: PROJECT_ID, TaskName: 'Fix the thing', TaskKey: 'AR-1', Task_Priority: 'LOW' });
const taskEmits = () => socketEmitter.emit.mock.calls.map(([, p]) => p).filter((p) => p && p.module === 'task');
const runRows = () => mockDb.store[SCHEMA_TYPE.AGENT_RUNS] || [];
const refusalRows = () => (mockDb.store[SCHEMA_TYPE.AUDIT_LOGS] || []).filter((r) => r.action === 'agent.action_refused');

const bumpPriority = (companyId, actor, depth, agent) => actions.perform({
    companyId, actor, action: 'task.update', params: { taskId: TASK_ID, fields: { Task_Priority: 'HIGH' } },
    reason: 'qa-review finding', allowedActions: agent.allowedActions, depth,
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    jest.restoreAllMocks();
    mockDb.seed(SCHEMA_TYPE.AGENTS, agentDoc());
    mockDb.seed(SCHEMA_TYPE.TASKS, taskDoc());
    mockDb.seed(SCHEMA_TYPE.AUTOMATION_RULES, { _id: RULE_ID, name: 'Re-review', createdBy: 'u1', reactToAutomation: true });
    jest.spyOn(runs, 'executeSkill').mockImplementation(async (companyId, run, agent, task, deps) => {
        await bumpPriority(companyId, deps.actor, originDepth(run), agent);
        return { status: runs.STATUS.DONE, outcome: '1 change(s) applied', refusals: 0 };
    });
});

describe('loop depth through an agent hop (defect 14)', () => {
    const ruleHop = (envelope) => runAgent.run({
        companyId: C, entity: envelope.entity, config: { agent: 'Code Reviewer', skill: 'qa-review' },
        context: { runId: `auto-${envelope.depth}`, ruleId: RULE_ID, ruleName: 'Re-review', depth: envelope.depth, eventId: envelope.id, task: envelope.data },
    });

    it('a rule → agent → event → same rule chain trips the guard at MAX_DEPTH instead of recursing', async () => {
        const hops = [];
        let envelope = bus.buildEnvelope({ companyId: C, type: 'task.updated', doc: taskDoc(), changedFields: ['Task_Priority'], actor: { kind: 'user', userId: 'u1' }, depth: 0 });
        let dropped = false;
        for (let i = 0; i < ITERATION_CAP; i++) {
            socketEmitter.emit.mockClear();
            let refused = null;
            // eslint-disable-next-line no-await-in-loop
            try { await ruleHop(envelope); } catch (e) { refused = e; }
            hops.push({ depth: envelope.depth, refused: refused ? refused.message : null });
            if (refused) break;
            const [emitted] = taskEmits();
            expect(emitted).toBeDefined();
            envelope = bus.buildEnvelope({ companyId: C, type: 'task.updated', doc: emitted.data, changedFields: Object.keys(emitted.updatedFields), actor: emitted.actor, depth: emitted.depth });
            if (envelope.depth > bus.MAX_DEPTH) { dropped = true; break; }
        }

        expect(dropped).toBe(false);
        expect(hops).toHaveLength(bus.MAX_DEPTH + 1);
        expect(hops.map((h) => h.depth)).toEqual([0, 1, 2, 3]);
        expect(hops.slice(0, -1).every((h) => h.refused === null)).toBe(true);
        expect(hops[hops.length - 1].refused).toMatch(/loop_depth_exceeded/);

        expect(runRows()).toHaveLength(bus.MAX_DEPTH);
        expect(runRows().map((r) => r.triggerDepth)).toEqual([0, 1, 2]);
        expect(runRows().every((r) => typeof r.triggerEventId === 'string' && r.triggerEventId.length > 0)).toBe(true);
        expect(refusalRows()).toHaveLength(1);
        expect(refusalRows()[0].meta).toMatchObject({ action: 'run.start', reason: 'loop_depth_exceeded' });
    });

    it('a rule-triggered run stores the envelope depth and correlation id, and its actions emit one deeper', async () => {
        const envelope = bus.buildEnvelope({ companyId: C, type: 'task.updated', doc: taskDoc(), changedFields: ['Task_Priority'], actor: { kind: 'user', userId: 'u1' }, depth: 1 });
        await ruleHop(envelope);
        expect(runRows()[0]).toMatchObject({ trigger: 'rule', triggerDepth: 1, triggerEventId: envelope.id });
        expect(taskEmits()[0]).toMatchObject({ actor: { kind: expect.not.stringMatching(/^user$/) }, depth: 2 });
    });

    it('canStart refuses at the max depth before a run row is written', async () => {
        const check = await runs.canStart(agentDoc(), { trigger: 'rule', companyId: C, depth: bus.MAX_DEPTH });
        expect(check).toMatchObject({ ok: false, reason: 'loop_depth_exceeded', code: 'loop_depth_exceeded' });
        expect(await runs.canStart(agentDoc(), { trigger: 'rule', companyId: C, depth: bus.MAX_DEPTH - 1 })).toMatchObject({ ok: true });
        expect(runRows()).toHaveLength(0);
    });
});

describe('depth on runs that did not come from a rule', () => {
    it('a user-started run starts at depth 0 and emits at depth 1', async () => {
        const agent = agentDoc();
        const run = await runs.create(C, { agent, taskId: TASK_ID, projectId: PROJECT_ID, skill: 'qa-review', trigger: 'manual', startedBy: 'u1' });
        expect(run.triggerDepth).toBe(0);
        expect(run.triggerEventId).toBeNull();

        const actor = { kind: 'agent', userId: 'u1', agentId: AGENT_ID, agentName: agent.name, runId: String(run._id), viaAccount: 'workspace', tokenId: null };
        await bumpPriority(C, actor, originDepth(run), agent);
        expect(taskEmits()).toHaveLength(1);
        expect(taskEmits()[0].depth).toBe(1);
    });

    it('an approved proposal carries its run\'s depth into the applied actions', async () => {
        jest.spyOn(memory, 'rememberApprovedChanges').mockResolvedValue([]);
        const run = mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: AGENT_ID, agentName: 'Code Reviewer', status: 'waiting_approval', skill: 'qa-review', taskId: TASK_ID, projectId: PROJECT_ID, trigger: 'rule', triggerDepth: 2, startedAt: new Date(), spend: { usd: 0 }, actions: [], proposals: [] });
        const p = mockDb.seed(SCHEMA_TYPE.AGENT_PROPOSALS, {
            agentId: AGENT_ID, agentName: 'Code Reviewer', runId: String(run._id), taskId: TASK_ID, projectId: PROJECT_ID, status: 'pending', gate: null,
            changes: [{ action: 'task.update', params: { taskId: TASK_ID, fields: { Task_Priority: 'HIGH' } }, label: 'Raise priority' }],
        });

        const out = await proposals.approve(C, String(p._id), { decider: { kind: 'human', userId: 'u1' }, isPrivileged: true, ip: '' });
        expect(out.error).toBeUndefined();
        expect(taskEmits()).toHaveLength(1);
        expect(taskEmits()[0].depth).toBe(3);
    });
});
