const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const logger = require('../Config/loggerConfig');
const recorder = require('../Modules/Audit/recorder');
const agentAudit = require('../Modules/Agents/agentAudit');

/* Sprint 8 slice 5: with AUDIT_CHAIN unset, every audit write, update and sweep is exactly what beta issued. */

const CID = '6f00000000000000000000c4';
const TASK = '6f0000000000000000000701';
const DAY = 24 * 60 * 60 * 1000;
const actor = { kind: 'agent', userId: 'u1', agentId: '6f0000000000000000000a01', agentName: 'Reviewer', runId: '6f0000000000000000000c01', viaAccount: 'workspace' };

const calls = () => mockDb.calls.map(({ companyId, type, method, data }) => ({ companyId, type, method, data }));
const waitFor = async (check) => {
    for (let i = 0; i < 200 && !check(); i += 1) await new Promise((resolve) => setImmediate(resolve));
    if (!check()) throw new Error('condition not met');
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    delete process.env.AUDIT_CHAIN;
    delete process.env.AUDIT_CHAIN_KEY;
    delete process.env.AUDIT_RETENTION_DAYS;
});

describe('with AUDIT_CHAIN off', () => {
    it('recordAudit saves the normalised entry and nothing else', async () => {
        recorder.recordAudit(CID, { actorId: 'u1', actorName: 'Ann', action: 'member.update', entityType: 'member', entityId: 'm1', meta: { fields: ['role'] }, ip: '10.0.0.1' });
        await waitFor(() => mockDb.calls.length === 1);

        expect(calls()).toEqual([{
            companyId: CID,
            type: SCHEMA_TYPE.AUDIT_LOGS,
            method: 'save',
            data: { actorId: 'u1', actorName: 'Ann', action: 'member.update', entityType: 'member', entityId: 'm1', entityName: '', meta: { fields: ['role'] }, ip: '10.0.0.1' },
        }]);
    });

    it('opens, applies, fails and undoes agent actions in place', async () => {
        const applied = await agentAudit.openAction(CID, actor, { action: 'task.comment', reason: 'r', params: { taskId: TASK }, ip: '10.0.0.2', entityId: TASK });
        await agentAudit.applyAction(CID, applied, { undo: { kind: 'comment', commentId: 'c1', taskId: TASK }, entityType: 'task', entityId: TASK, entityName: 'Fix the thing' });
        const failed = await agentAudit.openAction(CID, actor, { action: 'task.update', params: { taskId: TASK } });
        await agentAudit.failAction(CID, failed, 'boom');
        await agentAudit.markUndone(CID, applied, 'u2');

        const seen = calls();
        expect(seen.map((c) => [c.type, c.method])).toEqual([
            [SCHEMA_TYPE.AUDIT_LOGS, 'save'], [SCHEMA_TYPE.AUDIT_LOGS, 'updateOne'],
            [SCHEMA_TYPE.AUDIT_LOGS, 'save'], [SCHEMA_TYPE.AUDIT_LOGS, 'updateOne'],
            [SCHEMA_TYPE.AUDIT_LOGS, 'updateOne'],
        ]);
        expect(Object.keys(seen[0].data).sort()).toEqual(['action', 'actorId', 'actorName', 'entityId', 'entityName', 'entityType', 'ip', 'meta']);
        expect(seen[1].data[1]).toEqual({ $set: { 'meta.state': 'applied', 'meta.undo': { kind: 'comment', commentId: 'c1', taskId: TASK }, 'meta.undoable': true, 'meta.settledAt': expect.any(Date), entityType: 'task', entityId: TASK, entityName: 'Fix the thing' } });
        expect(seen[3].data[1]).toEqual({ $set: { 'meta.state': 'failed', 'meta.failed': 'boom', 'meta.undoable': false, 'meta.settledAt': expect.any(Date) } });
        expect(seen[4].data[1]).toEqual({ $set: { 'meta.undoneAt': expect.any(Date), 'meta.undoneBy': 'u2' } });

        const rows = mockDb.store[SCHEMA_TYPE.AUDIT_LOGS];
        expect(rows).toHaveLength(2);
        expect(rows.every((r) => r.chain === undefined)).toBe(true);
        expect(rows[0].meta).toMatchObject({ state: 'applied', undoneBy: 'u2' });
    });

    it('still only logs a markUndone failure', async () => {
        const id = await agentAudit.openAction(CID, actor, { action: 'task.comment', params: { taskId: TASK } });
        const real = mockDb.crud.getMockImplementation();
        mockDb.crud.mockImplementation(async (companyId, query, method) => {
            if (method === 'updateOne') throw new Error('disk full');
            return real(companyId, query, method);
        });
        try {
            await expect(agentAudit.markUndone(CID, id, 'u2')).resolves.toBeUndefined();
        } finally {
            mockDb.crud.mockImplementation(real);
        }
        expect(logger.error).toHaveBeenCalledWith('markUndone: disk full');
    });

    it('sweeps with one deleteMany on createdAt, writes no anchor and does not clamp a short retention', async () => {
        mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: CID });
        mockDb.seed(SCHEMA_TYPE.AUDIT_LOGS, { action: 'member.update', createdAt: new Date(Date.now() - 40 * DAY), meta: {} });
        mockDb.seed(SCHEMA_TYPE.AUDIT_LOGS, { action: 'member.update', createdAt: new Date(Date.now() - DAY), meta: {} });
        mockDb.calls.length = 0;

        await recorder.runAuditRetentionForAllCompanies(30);

        const seen = calls();
        expect(seen.map((c) => [c.companyId, c.type, c.method])).toEqual([
            ['global', SCHEMA_TYPE.COMPANIES, 'find'],
            [CID, SCHEMA_TYPE.AUDIT_LOGS, 'deleteMany'],
        ]);
        expect(seen[1].data).toEqual([{ createdAt: { $lt: expect.any(Date) } }]);
        expect(Math.round((Date.now() - seen[1].data[0].createdAt.$lt.getTime()) / DAY)).toBe(30);
        expect(mockDb.store[SCHEMA_TYPE.AUDIT_LOGS]).toHaveLength(1);
        expect(logger.warn).not.toHaveBeenCalled();
    });
});
