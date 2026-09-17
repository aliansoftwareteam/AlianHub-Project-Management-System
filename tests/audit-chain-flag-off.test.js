const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const logger = require('../Config/loggerConfig');
const recorder = require('../Modules/Audit/recorder');
const agentAudit = require('../Modules/Agents/agentAudit');
const chain = require('../Modules/Audit/chain');
const ctrl = require('../Modules/Audit/controller');

/* Sprint 8 slice 5: with AUDIT_CHAIN off, even with AUDIT_CHAIN_KEY set, audit writes, reads, responses and
 * the sweep are what beta did. The one difference is that a row carrying a chain is never edited or swept. */

const CID = '6f00000000000000000000c4';
const OWNER = '6f0000000000000000000001';
const TASK = '6f0000000000000000000701';
const DAY = 24 * 60 * 60 * 1000;
const actor = { kind: 'agent', userId: 'u1', agentId: '6f0000000000000000000a01', agentName: 'Reviewer', runId: '6f0000000000000000000c01', viaAccount: 'workspace' };
const CHAINED_ONLY_READS = [SCHEMA_TYPE.AUDIT_CHAIN_HEADS, SCHEMA_TYPE.AUDIT_CHAIN_ANCHORS];

/* The cached check for a company's chained history, which decides whether appended changes are read. */
const isHistoryProbe = (c) => (c.type === SCHEMA_TYPE.AUDIT_CHAIN_HEADS && c.method === 'findOne')
    || (c.type === SCHEMA_TYPE.AUDIT_LOGS && c.method === 'findOne' && JSON.stringify(c.data[0]) === JSON.stringify({ 'chain.seq': { $gte: 0 } }));
const calls = () => mockDb.calls.map(({ companyId, type, method, data }) => ({ companyId, type, method, data })).filter((c) => !isHistoryProbe(c));
const probes = () => mockDb.calls.filter(isHistoryProbe);
const auditCalls = () => calls().filter((c) => c.type === SCHEMA_TYPE.AUDIT_LOGS || CHAINED_ONLY_READS.includes(c.type));
const amendmentReads = () => calls().filter((c) => JSON.stringify(c.data || '').includes('audit.amended') || JSON.stringify(c.data || '').includes('meta.amends'));
const waitFor = async (check) => {
    for (let i = 0; i < 200 && !check(); i += 1) await new Promise((resolve) => setImmediate(resolve));
    if (!check()) throw new Error('condition not met');
};
const response = () => {
    const res = { code: 200, chunks: [] };
    res.status = (c) => { res.code = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    res.send = (b) => { res.body = b; return res; };
    res.setHeader = () => {};
    res.write = (b) => { res.chunks.push(String(b)); return true; };
    res.end = () => {};
    return res;
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    delete process.env.AUDIT_CHAIN;
    process.env.AUDIT_CHAIN_KEY = 'a-key-that-is-set-but-not-used-while-off-0123';
    delete process.env.AUDIT_RETENTION_DAYS;
});

afterAll(() => {
    delete process.env.AUDIT_CHAIN_KEY;
});

describe('with AUDIT_CHAIN off and a key set', () => {
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

    it('opens, applies, fails and undoes agent actions in place, only on rows without a chain', async () => {
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
        expect(String(seen[1].data[0]._id)).toBe(applied);
        expect(seen[1].data[0].chain).toEqual({ $exists: false });
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

    it('reads rows with no query for appended changes while the company has no chained history', async () => {
        const id = await agentAudit.openAction(CID, actor, { action: 'task.update', params: { taskId: TASK }, idempotencyKey: 'wf:run:step' });
        mockDb.calls.length = 0;

        await agentAudit.findById(CID, id);
        await agentAudit.findByIdempotencyKey(CID, 'wf:run:step');
        const rows = mockDb.store[SCHEMA_TYPE.AUDIT_LOGS].map((r) => ({ ...r }));
        expect(await chain.foldRows(CID, rows)).toBe(rows);

        expect(calls().map((c) => [c.type, c.method])).toEqual([[SCHEMA_TYPE.AUDIT_LOGS, 'findOne'], [SCHEMA_TYPE.AUDIT_LOGS, 'findOne']]);
        expect(amendmentReads()).toEqual([]);
        expect(probes().length).toBeLessThanOrEqual(2);
    });

    it('lists and exports rows in beta\'s shape: one aggregate, no integrity, no chain metadata', async () => {
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
        mockDb.seed(SCHEMA_TYPE.AUDIT_LOGS, { action: 'member.update', actorId: OWNER, entityType: 'member', entityId: 'm1', createdAt: new Date(), meta: {} });
        mockDb.seed(SCHEMA_TYPE.AUDIT_LOGS, { action: 'permission.refused', actorId: OWNER, entityType: 'permission', entityId: 'task.task_priority', createdAt: new Date(), meta: { reason: 'denied' } });
        const req = (query) => ({ uid: OWNER, headers: { companyid: CID }, query, body: {} });

        for (const query of [{}, { undone: 'true' }, { q: 'member' }, { refused: 'true' }]) {
            mockDb.calls.length = 0;
            const res = response();
            await ctrl.listAuditLogs(req(query), res);
            expect(res.body.status).toBe(true);
            expect(Object.keys(res.body.metadata).sort()).toEqual(['page', 'total', 'totalPages']);
            res.body.data.forEach((row) => expect(row).not.toHaveProperty('integrity'));
            expect(auditCalls().map((c) => c.method)).toEqual(['aggregate']);
            expect(amendmentReads()).toEqual([]);
        }
        const refused = response();
        await ctrl.listAuditLogs(req({ refused: 'true' }), refused);
        expect(refused.body.data.map((r) => r.action)).toEqual(['permission.refused']);

        mockDb.calls.length = 0;
        const exported = response();
        await ctrl.exportAuditCsv(req({ undone: 'true' }), exported);
        expect(auditCalls().map((c) => c.method)).toEqual(['aggregate']);
        expect(amendmentReads()).toEqual([]);
    });

    it('sweeps with one deleteMany on createdAt that leaves chained rows alone, says how many it kept, and does not clamp', async () => {
        mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: CID });
        mockDb.seed(SCHEMA_TYPE.AUDIT_LOGS, { action: 'member.update', createdAt: new Date(Date.now() - 40 * DAY), meta: {} });
        mockDb.seed(SCHEMA_TYPE.AUDIT_LOGS, { action: 'member.update', createdAt: new Date(Date.now() - 40 * DAY), meta: {}, chain: { seq: 1, prevHash: '', hash: 'h' } });
        mockDb.seed(SCHEMA_TYPE.AUDIT_LOGS, { action: 'member.update', createdAt: new Date(Date.now() - DAY), meta: {} });
        mockDb.calls.length = 0;

        await recorder.runAuditRetentionForAllCompanies(30);

        const seen = calls();
        expect(seen.map((c) => [c.companyId, c.type, c.method])).toEqual([
            ['global', SCHEMA_TYPE.COMPANIES, 'find'],
            [CID, SCHEMA_TYPE.AUDIT_LOGS, 'countDocuments'],
            [CID, SCHEMA_TYPE.AUDIT_LOGS, 'deleteMany'],
        ]);
        expect(seen[2].data).toEqual([{ createdAt: { $lt: expect.any(Date) }, 'chain.seq': { $exists: false } }]);
        expect(Math.round((Date.now() - seen[2].data[0].createdAt.$lt.getTime()) / DAY)).toBe(30);
        expect(mockDb.store[SCHEMA_TYPE.AUDIT_LOGS].map((r) => Boolean(r.chain))).toEqual([true, false]);
        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`${CID}.*kept 1 chained row`)));
    });
});
