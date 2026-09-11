jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async (companyId, { data }) => (Array.isArray(data) ? {} : { _id: 'auto1', ...data })) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/Automations/engine/registry', () => ({ getAction: jest.fn() }));
jest.mock('../Modules/Agents/runs', () => ({
    STATUS: { RUNNING: 'running', WAITING: 'waiting_approval', DONE: 'done', SKIPPED: 'skipped', FAILED: 'failed', STOPPED: 'stopped' },
    canStart: jest.fn(async () => ({ ok: true, reason: '' })),
    start: jest.fn(async (companyId, { agent, skill }) => ({ run: { _id: 'run1', agentId: String(agent._id), skill, viaAccount: 'workspace', status: 'running' }, deduplicated: false })),
    skillSlugOf: jest.fn((agent, explicit) => explicit || 'qa-review'),
    executeSkill: jest.fn(async () => ({ status: 'done', outcome: 'ok', refusals: 0 })),
}));
jest.mock('../Modules/Agents/proposals', () => ({ create: jest.fn() }));
jest.mock('../Modules/Agents/actions', () => ({ perform: jest.fn() }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const registry = require('../Modules/Automations/engine/registry');
const runs = require('../Modules/Agents/runs');
const telemetry = require('../Config/telemetry');
const runner = require('../Modules/Automations/engine/runner');
const runAgent = require('../Modules/Automations/engine/actions/runAgent');
const { buildEnvelope } = require('../event/domainEventBus');

const TASK_ID = '6f0000000000000000000701';
const envelope = (over = {}) => ({ id: 'evt_1', companyId: 'c1', type: 'task.status_changed', depth: 0, entity: { kind: 'task', id: TASK_ID }, data: { _id: TASK_ID, ProjectID: 'p1' }, ...over });

beforeEach(() => jest.clearAllMocks());

describe('automation runs carry the envelope trace id', () => {
    it('a domain event takes the trace id of the request that raised it', () => {
        const traceId = telemetry.newTraceId();
        expect(telemetry.withTrace(traceId, () => buildEnvelope({ companyId: 'c1', type: 'task.updated', doc: { _id: TASK_ID }, changedFields: [], actor: {} })).traceId).toBe(traceId);
        expect(buildEnvelope({ companyId: 'c1', type: 'task.updated', doc: { _id: TASK_ID }, changedFields: [], actor: {} }).traceId).toMatch(/^[0-9a-f]{32}$/);
    });

    it('the run row records it and every step runs inside it', async () => {
        const traceId = telemetry.newTraceId();
        const created = await runner.createRun('c1', { _id: 'rule1', name: 'QA' }, envelope({ traceId }));
        expect(created.traceId).toBe(traceId);

        const seen = [];
        registry.getAction.mockReturnValue({ run: async ({ context }) => { seen.push([context.traceId, telemetry.traceIdNow()]); return { ok: true }; } });
        const out = await runner.runOnce('c1', { _id: 'auto1', cursor: 0, steps: [], outputs: {} }, { _id: 'rule1', name: 'QA', steps: [{ id: 's1', type: 'action', action: 'run_agent' }] }, envelope({ traceId }));
        expect(out).toEqual({ status: 'success' });
        expect(seen).toEqual([[traceId, traceId]]);
        expect(MongoDbCrudOpration).toHaveBeenCalled();
    });

    it('run_agent starts the agent run on that trace id', async () => {
        const traceId = telemetry.newTraceId();
        const agentRow = { _id: '6f0000000000000000000a01', name: 'Reviewer', account: 'workspace', projectIds: [] };
        MongoDbCrudOpration.mockImplementation(async () => agentRow);
        await runAgent.run({ companyId: 'c1', entity: { kind: 'task', id: TASK_ID }, config: { agent: 'Reviewer', skill: 'qa-review' }, context: { runId: 'auto1', ruleId: 'rule1', ruleName: 'QA', depth: 0, traceId, task: { _id: TASK_ID, ProjectID: 'p1' } } });
        expect(runs.start).toHaveBeenCalledWith('c1', expect.objectContaining({ traceId }));
    });
});
