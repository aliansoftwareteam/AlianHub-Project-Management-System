const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const requestContext = require('../Config/requestContext');
const telemetry = require('../Config/telemetry');
const audit = require('../Modules/Agents/agentAudit');
const { buildTrace } = require('../Modules/Agents/runTrace');

const C = '6f0000000000000000000c01';
const AGENT_ID = '6f0000000000000000000a01';
const RUN_ID = '6f0000000000000000000d01';
const agentActor = { kind: 'agent', userId: 'u1', agentId: AGENT_ID, agentName: 'Planner', runId: RUN_ID, viaAccount: 'workspace', tokenId: null };
const rows = () => mockDb.store[SCHEMA_TYPE.AUDIT_LOGS] || [];

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
});

describe('audit rows carry the trace id', () => {
    it('every row written inside a run trace records that trace id', async () => {
        const traceId = telemetry.newTraceId();
        await telemetry.withTrace(traceId, async () => {
            const opened = await audit.openAction(C, agentActor, { action: 'task.comment', params: { taskId: 't1' } });
            await audit.applyAction(C, opened, { undo: null });
            await audit.recordRefusal(C, agentActor, { action: 'task.delete', reason: 'never available' });
            await audit.recordUndo(C, agentActor, { originalId: opened, action: 'task.comment' });
            await audit.recordRunReverted(C, agentActor, { runId: RUN_ID, reverted: 1, failed: [] });
            await audit.recordRevisionChange(C, agentActor, { agentId: AGENT_ID, to: 2 });
            await audit.recordAgentDeleted(C, agentActor, { agentId: AGENT_ID });
        });
        expect(rows()).toHaveLength(6);
        expect(rows().map((r) => r.meta.traceId)).toEqual(Array(6).fill(traceId));
        expect(rows()[0].meta.settledAt).toEqual(expect.any(Date));
    });

    it('an actor carrying the run trace id wins over the request trace it was decided in', async () => {
        const runTrace = telemetry.newTraceId();
        await requestContext.run({ id: 'req-1' }, () => audit.recordProposalDecision(C, { kind: 'human', userId: 'u9', traceId: runTrace }, { proposalId: 'p1', decision: 'approved', runId: RUN_ID }));
        expect(rows()[0].meta).toMatchObject({ traceId: runTrace, runId: RUN_ID });
    });

    it('a row written inside a request without a run takes the request trace id', async () => {
        const seen = await requestContext.run({ id: 'req-2' }, async () => {
            await audit.recordAgentDeleted(C, { kind: 'human', userId: 'u9' }, { agentId: AGENT_ID });
            return telemetry.traceIdNow();
        });
        expect(rows()[0].meta.traceId).toBe(seen);
    });
});

describe('the run trace view', () => {
    const at = (ms) => new Date(Date.UTC(2026, 8, 11, 12, 0, 0, ms));

    it('merges steps and tool calls chronologically with duration, tokens, cost and decision', () => {
        const run = {
            traceId: 'a'.repeat(32),
            decisions: [{ action: 'task.comment', decision: 'act' }, { action: 'task.delete', decision: 'refuse' }],
            steps: [
                { node: 'gather', startedAt: at(0), endedAt: at(5), durationMs: 5, spanId: '1'.repeat(16), status: 'ok', tokens: 0, costUsd: 0 },
                { node: 'analyse', startedAt: at(5), endedAt: at(900), durationMs: 895, spanId: '2'.repeat(16), status: 'ok', tokens: 1200, costUsd: 0.0042 },
                { node: 'act', startedAt: at(910), endedAt: at(990), durationMs: 80, spanId: '3'.repeat(16), status: 'ok', tokens: 0, costUsd: 0 },
            ],
        };
        const auditRows = [
            { _id: 'x1', action: 'agent.action', createdAt: at(920), meta: { action: 'task.comment', state: 'applied', settledAt: at(960) } },
            { _id: 'x2', action: 'agent.action_refused', createdAt: at(915), meta: { action: 'task.delete', reason: 'never available' } },
            { _id: 'x3', action: 'agent.proposal_decided', createdAt: at(2000), meta: { decision: 'approved' } },
            { _id: 'x4', action: 'agent.action', createdAt: at(1990), meta: { action: 'subtask.create', state: 'failed', reason: 'approved proposal p1 by u9', settledAt: at(1995) } },
        ];

        expect(buildTrace(run, auditRows)).toEqual([
            { kind: 'step', node: 'gather', status: 'ok', at: at(0), endedAt: at(5), durationMs: 5, tokens: 0, costUsd: 0, spanId: '1'.repeat(16) },
            { kind: 'step', node: 'analyse', status: 'ok', at: at(5), endedAt: at(900), durationMs: 895, tokens: 1200, costUsd: 0.0042, spanId: '2'.repeat(16) },
            { kind: 'step', node: 'act', status: 'ok', at: at(910), endedAt: at(990), durationMs: 80, tokens: 0, costUsd: 0, spanId: '3'.repeat(16) },
            { kind: 'tool', auditId: 'x2', event: 'agent.action_refused', action: 'task.delete', decision: 'refuse', status: 'refused', at: at(915), durationMs: null, tokens: null, costUsd: null },
            { kind: 'tool', auditId: 'x1', event: 'agent.action', action: 'task.comment', decision: 'act', status: 'applied', at: at(920), durationMs: 40, tokens: null, costUsd: null },
            { kind: 'tool', auditId: 'x4', event: 'agent.action', action: 'subtask.create', decision: 'propose', status: 'failed', at: at(1990), durationMs: 5, tokens: null, costUsd: null },
            { kind: 'tool', auditId: 'x3', event: 'agent.proposal_decided', action: 'agent.proposal_decided', decision: 'approved', status: null, at: at(2000), durationMs: null, tokens: null, costUsd: null },
        ]);
    });

    it('a run from before tracing has no steps and still lists its tool calls', () => {
        expect(buildTrace({}, [])).toEqual([]);
        expect(buildTrace({ decisions: [] }, [{ _id: 'x1', action: 'agent.action', createdAt: at(1), meta: { action: 'task.comment', state: 'applied', cost: { usd: 0.5, tokens: 10 } } }]))
            .toEqual([{ kind: 'tool', auditId: 'x1', event: 'agent.action', action: 'task.comment', decision: null, status: 'applied', at: at(1), durationMs: null, tokens: 10, costUsd: 0.5 }]);
    });
});
