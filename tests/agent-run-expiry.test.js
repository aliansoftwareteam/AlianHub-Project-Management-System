const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const runs = require('../Modules/Agents/runs');
const { agentRunsSchema } = require('../utils/mongo-handler/createSchema');
const { schema } = require('../utils/mongo-handler/schema');

const C = 'c1';
const AGENT_ID = '6f0000000000000000000a01';
const agent = { _id: AGENT_ID, name: 'Reviewer', account: 'workspace', deletedStatusKey: 0 };
const runRow = (id) => mockDb.store[SCHEMA_TYPE.AGENT_RUNS].find((r) => String(r._id) === String(id));
const retentionMs = runs.RETENTION_SECONDS * 1000;

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    mockDb.seed(SCHEMA_TYPE.AGENTS, agent);
});

describe('#16 agent runs expire only after a terminal status', () => {
    it('declares the TTL on expiresAt, not on createdAt', () => {
        const indexes = agentRunsSchema.indexes();
        const ttl = indexes.filter(([, options]) => options && options.expireAfterSeconds !== undefined);
        expect(ttl).toEqual([[{ expiresAt: 1 }, expect.objectContaining({ expireAfterSeconds: 0 })]]);
        expect(schema.agentRuns.expiresAt).toMatchObject({ type: Date });
    });

    it('an open run has no expiry, including while it waits on a person', async () => {
        const run = await runs.create(C, { agent, taskId: 't1', projectId: 'p1', skill: 'qa-review' });
        expect(runRow(run._id).expiresAt).toBeUndefined();
        await runs.patch(C, run._id, { status: runs.STATUS.WAITING });
        expect(runRow(run._id).expiresAt).toBeUndefined();
        expect(runs.OPEN).toEqual(expect.arrayContaining([runs.STATUS.QUEUED, runs.STATUS.RUNNING, runs.STATUS.WAITING]));
    });

    it.each(runs.TERMINAL)('finish(%s) sets expiresAt to the finish time plus the retention period', async (status) => {
        const run = await runs.create(C, { agent, taskId: 't1', projectId: 'p1', skill: 'qa-review' });
        const saved = await runs.finish(C, run._id, { status });
        const row = runRow(run._id);
        expect(row.status).toBe(status);
        expect(row.expiresAt).toBeInstanceOf(Date);
        expect(row.expiresAt.getTime()).toBe(new Date(row.finishedAt).getTime() + retentionMs);
        expect(saved.expiresAt.getTime()).toBe(row.expiresAt.getTime());
    });

    it('terminalUpdate gives every transition the same fields', () => {
        const at = new Date('2026-09-01T00:00:00Z');
        expect(runs.terminalUpdate(runs.STATUS.FAILED, at)).toEqual({ status: 'failed', finishedAt: at, expiresAt: new Date(at.getTime() + retentionMs) });
        expect(() => runs.terminalUpdate(runs.STATUS.WAITING)).toThrow(/terminal/);
    });

    it('stop, reapStale and pauseAll all go through the terminal update', async () => {
        const stopped = await runs.create(C, { agent, taskId: 't1', projectId: 'p1' });
        await runs.stop(C, stopped._id, 'u1');
        expect(runRow(stopped._id)).toMatchObject({ status: 'stopped', expiresAt: expect.any(Date) });

        const stale = await runs.create(C, { agent, taskId: 't2', projectId: 'p1' });
        await runs.reapStale(C);
        expect(runRow(stale._id)).toMatchObject({ status: 'failed', expiresAt: expect.any(Date) });

        const active = await runs.create(C, { agent, taskId: 't3', projectId: 'p1' });
        const waiting = await runs.create(C, { agent, taskId: 't4', projectId: 'p1' });
        await runs.patch(C, waiting._id, { status: runs.STATUS.WAITING });
        await runs.pauseAll(C, 'pause_all');
        expect(runRow(active._id)).toMatchObject({ status: 'stopped', expiresAt: expect.any(Date) });
        expect(runRow(waiting._id).status).toBe('waiting_approval');
        expect(runRow(waiting._id).expiresAt).toBeUndefined();
    });
});
