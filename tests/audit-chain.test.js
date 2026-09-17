const crypto = require('crypto');

const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');

/* Sprint 8 slice 5: the per-tenant audit hash chain (AUDIT_CHAIN). */

const CID = '6f00000000000000000000c5';
const KEY = 'test-audit-chain-key-0123456789abcdef';
const TASK = '6f0000000000000000000701';
const DAY = 24 * 60 * 60 * 1000;
const actor = { kind: 'agent', userId: 'u1', agentId: '6f0000000000000000000a01', agentName: 'Reviewer', runId: '6f0000000000000000000c01', viaAccount: 'workspace' };

let logger;
let rules;
let chain;
let recorder;
let agentAudit;

const load = () => {
    jest.resetModules();
    logger = require('../Config/loggerConfig');
    rules = require('../Modules/Audit/helpers/chainRules');
    chain = require('../Modules/Audit/chain');
    recorder = require('../Modules/Audit/recorder');
    agentAudit = require('../Modules/Agents/agentAudit');
};

const auditRows = () => mockDb.store[SCHEMA_TYPE.AUDIT_LOGS] || [];
const chained = () => auditRows().filter((r) => r.chain).sort((a, b) => a.chain.seq - b.chain.seq);
const bySeq = (seq) => auditRows().find((r) => r.chain && r.chain.seq === seq);
const removeAudit = (drop) => { mockDb.store[SCHEMA_TYPE.AUDIT_LOGS] = auditRows().filter((r) => !drop(r)); };
const heads = () => mockDb.store[SCHEMA_TYPE.AUDIT_CHAIN_HEADS] || [];
const anchors = () => mockDb.store[SCHEMA_TYPE.AUDIT_CHAIN_ANCHORS] || [];
const range = (n) => Array.from({ length: n }, (_, i) => i + 1);

const entry = (i, over = {}) => ({
    actorId: `u${i}`, actorName: `Person ${i}`, action: 'member.update', entityType: 'member', entityId: `m${i}`,
    entityName: `person${i}@example.com`, meta: { fields: ['role'], n: i }, ip: `10.0.0.${i}`, ...over,
});
const writeRows = async (from, to) => {
    for (let i = from; i <= to; i += 1) await chain.saveAuditRow(CID, entry(i));
};
const flush = async () => {
    for (let i = 0; i < 50; i += 1) await new Promise((resolve) => setImmediate(resolve));
};
const waitFor = async (check) => {
    for (let i = 0; i < 400 && !check(); i += 1) await new Promise((resolve) => setImmediate(resolve));
    if (!check()) throw new Error('condition not met');
};

beforeAll(() => {
    const schemas = require('../utils/mongo-handler/createSchema');
    mockDb.uniqueFromSchema(SCHEMA_TYPE.AUDIT_LOGS, schemas.auditLogsSchema);
    mockDb.uniqueFromSchema(SCHEMA_TYPE.AUDIT_CHAIN_ANCHORS, schemas.auditChainAnchorsSchema);
    mockDb.unique(SCHEMA_TYPE.AUDIT_CHAIN_HEADS, ['_id']);
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    process.env.AUDIT_CHAIN = 'true';
    process.env.AUDIT_CHAIN_KEY = KEY;
    delete process.env.AUDIT_RETENTION_DAYS;
    load();
    jest.clearAllMocks();
});

afterEach(() => {
    jest.useRealTimers();
});

afterAll(() => {
    delete process.env.AUDIT_CHAIN;
    delete process.env.AUDIT_CHAIN_KEY;
});

describe('canonical serialisation', () => {
    it('does not depend on key order and drops what Mongo does not store', () => {
        const at = new Date('2026-01-01T00:00:00.000Z');
        const written = { b: 1, a: { d: [1, { y: 2, x: undefined, z: {} }], c: 'x' }, e: {}, f: undefined, g: null, at };
        const stored = { at, g: null, a: { c: 'x', d: [1, { y: 2 }] }, b: 1 };
        expect(rules.canonical(written)).toBe(rules.canonical(stored));
        expect(rules.canonical(stored)).toBe('{"a":{"c":"x","d":[1,{"y":2}]},"at":{"$date":"2026-01-01T00:00:00.000Z"},"b":1,"g":null}');
    });

    it('keeps apart values that loose serialisation would conflate', () => {
        expect(rules.canonical({ a: '1' })).not.toBe(rules.canonical({ a: 1 }));
        expect(rules.canonical({ a: [1, 2] })).not.toBe(rules.canonical({ a: [2, 1] }));
        expect(rules.canonical({ at: new Date(0) })).not.toBe(rules.canonical({ at: new Date(0).toISOString() }));
        expect(rules.canonical({ a: null })).not.toBe(rules.canonical({}));
    });

    it('pins the row hash: HMAC-SHA256 over the canonical hashed content, a newline and the previous hash', () => {
        const row = {
            _id: '6f0000000000000000000001', createdAt: new Date('2026-09-17T00:00:00.000Z'), updatedAt: new Date(), __v: 0,
            actorId: 'u1', actorName: 'Ann', action: 'member.update', entityType: 'member', entityId: 'm1', entityName: 'ann@example.com',
            meta: { fields: ['role'], email: 'ann@example.com', userAgent: 'Firefox' }, ip: '10.0.0.1', chain: { seq: 7, prevHash: 'abc' },
        };
        const content = `{"at":{"$date":"2026-09-17T00:00:00.000Z"},"companyId":"${CID}","id":"6f0000000000000000000001","row":{"action":"member.update","actorId":"u1","entityId":"m1","entityType":"member","meta":{"fields":["role"]}},"seq":7,"v":1}`;
        expect(rules.canonical(rules.hashedContent(CID, row))).toBe(content);
        expect(rules.rowHash(KEY, CID, row, 'abc')).toBe(crypto.createHmac('sha256', KEY).update(`${content}\nabc`).digest('hex'));
    });
});

describe('writing the chain', () => {
    it('gives each row a sequence, the previous hash and a keyed hash, and keeps the row shape otherwise', async () => {
        await writeRows(1, 3);
        const rows = chained();
        expect(rows.map((r) => r.chain.seq)).toEqual([1, 2, 3]);
        expect(rows[0].chain.prevHash).toBe('');
        expect(rows[1].chain.prevHash).toBe(rows[0].chain.hash);
        expect(rows[2].chain.prevHash).toBe(rows[1].chain.hash);
        rows.forEach((r) => expect(r.chain.hash).toBe(rules.rowHash(KEY, CID, r, r.chain.prevHash)));
        expect(rows[0]).toMatchObject({ actorName: 'Person 1', entityName: 'person1@example.com', ip: '10.0.0.1', meta: { fields: ['role'], n: 1 } });
        expect(heads().find((h) => h._id === 'head')).toMatchObject({ seq: 3, hash: rows[2].chain.hash });
    });

    it('produces contiguous, ordered sequence numbers from 50 parallel writes', async () => {
        await Promise.all(range(50).map((i) => chain.saveAuditRow(CID, entry(i))));
        const rows = chained();
        expect(rows.map((r) => r.chain.seq)).toEqual(range(50));
        rows.slice(1).forEach((r, i) => expect(r.chain.prevHash).toBe(rows[i].chain.hash));
        expect(await chain.verifyChain(CID)).toMatchObject({ state: 'verified', brokenAt: null, verifiedThrough: 50 });
    });

    it('stays contiguous when two servers append to one company at once', async () => {
        let other;
        jest.isolateModules(() => { other = require('../Modules/Audit/chain'); });
        await Promise.all(range(50).map((i) => (i % 2 ? chain : other).saveAuditRow(CID, entry(i))));
        const rows = chained();
        expect(rows.map((r) => r.chain.seq)).toEqual(range(50));
        rows.slice(1).forEach((r, i) => expect(r.chain.prevHash).toBe(rows[i].chain.hash));
        expect(await chain.verifyChain(CID)).toMatchObject({ state: 'verified', verifiedThrough: 50 });
    });

    it('leaves no gap when a write fails', async () => {
        await writeRows(1, 2);
        const real = mockDb.crud.getMockImplementation();
        mockDb.crud.mockImplementation(async (companyId, query, method) => {
            if (method === 'save' && query.data && query.data.meta && query.data.meta.n === 3) throw new Error('write failed');
            return real(companyId, query, method);
        });
        try {
            await expect(chain.saveAuditRow(CID, entry(3))).rejects.toThrow('write failed');
        } finally {
            mockDb.crud.mockImplementation(real);
        }
        await writeRows(4, 5);
        expect(chained().map((r) => r.chain.seq)).toEqual([1, 2, 3, 4]);
        expect(await chain.verifyChain(CID)).toMatchObject({ state: 'verified', verifiedThrough: 4 });
    });

    it('chains rows recorded through recordAudit', async () => {
        recorder.recordAudit(CID, entry(1));
        recorder.recordAudit(CID, entry(2));
        await waitFor(() => chained().length === 2);
        expect(await chain.verifyChain(CID)).toMatchObject({ state: 'verified', verifiedThrough: 2 });
    });

    it('mirrors the head to the global database at most once a minute', async () => {
        const mirror = () => heads().find((h) => h._id === CID);
        const globalWrites = () => mockDb.calls.filter((c) => c.companyId === 'global' && c.type === SCHEMA_TYPE.AUDIT_CHAIN_HEADS && c.method === 'updateOne');
        let now = Date.now();
        const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
        try {
            await writeRows(1, 3);
            await flush();
            expect(mirror()).toMatchObject({ seq: 1, hash: bySeq(1).chain.hash });
            expect(globalWrites()).toHaveLength(1);

            now += 60 * 1000;
            await writeRows(4, 4);
            await flush();
            expect(mirror()).toMatchObject({ seq: 4, hash: bySeq(4).chain.hash });
            expect(globalWrites()).toHaveLength(2);
        } finally {
            clock.mockRestore();
        }
    });
});

describe('verifying the chain', () => {
    it('detects a modified row at its sequence number', async () => {
        await writeRows(1, 5);
        expect(await chain.verifyChain(CID)).toMatchObject({ state: 'verified', brokenAt: null, verifiedThrough: 5 });

        bySeq(3).meta = { ...bySeq(3).meta, fields: ['owner'] };
        expect(await chain.verifyChain(CID)).toMatchObject({ state: 'broken', brokenAt: 3, verifiedThrough: 2 });
    });

    it('detects a modified row whose hash was recomputed without the key', async () => {
        await writeRows(1, 5);
        const row = bySeq(4);
        row.actorId = 'someone-else';
        row.chain.hash = rules.rowHash('a-different-key-that-is-long-enough-000', CID, row, row.chain.prevHash);
        expect(await chain.verifyChain(CID)).toMatchObject({ state: 'broken', brokenAt: 4 });
    });

    it('detects a deleted middle row', async () => {
        await writeRows(1, 5);
        removeAudit((r) => r.chain.seq === 3);
        expect(await chain.verifyChain(CID)).toMatchObject({ state: 'broken', brokenAt: 3, verifiedThrough: 2 });
    });

    it('detects the newest rows truncated, against the company head', async () => {
        await writeRows(1, 5);
        removeAudit((r) => r.chain.seq >= 4);
        expect(await chain.verifyChain(CID)).toMatchObject({ state: 'broken', brokenAt: 4 });
    });

    it('detects the newest rows truncated, against the global head when the company head went with them', async () => {
        await writeRows(1, 5);
        await chain.mirrorHead(CID);
        removeAudit((r) => r.chain.seq >= 4);
        mockDb.store[SCHEMA_TYPE.AUDIT_CHAIN_HEADS] = heads().filter((h) => h._id !== 'head');
        expect(await chain.verifyChain(CID)).toMatchObject({ state: 'broken', brokenAt: 4 });
    });

    it('does not treat a head that lags behind the newest row as a break', async () => {
        await writeRows(1, 5);
        const head = heads().find((h) => h._id === 'head');
        Object.assign(head, { seq: 3, hash: bySeq(3).chain.hash, mac: rules.markMac(KEY, 'head', CID, { seq: 3, hash: bySeq(3).chain.hash }) });
        expect(await chain.verifyChain(CID)).toMatchObject({ state: 'verified', verifiedThrough: 5 });
    });

    it('treats a head altered without the key as a break', async () => {
        await writeRows(1, 5);
        Object.assign(heads().find((h) => h._id === 'head'), { seq: 3, hash: bySeq(3).chain.hash });
        expect(await chain.verifyChain(CID)).toMatchObject({ state: 'broken' });
    });

    it('keeps verifying when personal fields are blanked', async () => {
        await writeRows(1, 3);
        await chain.saveAuditRow(CID, entry(4, { meta: { fields: [], email: 'person4@example.com', userAgent: 'Firefox' } }));
        chained().forEach((r) => {
            Object.assign(r, { actorName: '', entityName: '', ip: '' });
            if (r.meta.email) r.meta.email = '';
            delete r.meta.userAgent;
        });
        expect(await chain.verifyChain(CID)).toMatchObject({ state: 'verified', verifiedThrough: 4 });

        bySeq(2).actorId = 'u-other';
        expect(await chain.verifyChain(CID)).toMatchObject({ state: 'broken', brokenAt: 2 });
    });

    it('reads in pages and stops at its budget', async () => {
        await writeRows(1, 7);
        mockDb.calls.length = 0;
        expect(await chain.verifyChain(CID, { budget: 5, pageSize: 2 })).toMatchObject({ state: 'partial', brokenAt: null, verifiedThrough: 5, checked: 5 });
        const pages = mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.AUDIT_LOGS && c.method === 'find' && c.data[0] && c.data[0]['chain.seq'] && c.data[0]['chain.seq'].$gt !== undefined);
        expect(pages.map((c) => c.data[2].limit)).toEqual([2, 2, 1]);
        expect(await chain.verifyChain(CID, { budget: 50, pageSize: 2 })).toMatchObject({ state: 'verified', verifiedThrough: 7 });
    });

    it('gives each row an integrity state: verified, broken from the first broken seq, or unchained', async () => {
        mockDb.seed(SCHEMA_TYPE.AUDIT_LOGS, { action: 'member.update', actorId: 'u0', meta: {}, createdAt: new Date(Date.now() - DAY) });
        await writeRows(1, 4);
        const entries = () => auditRows().map((row) => ({ row, amendments: [] }));

        expect(await chain.annotateIntegrity(CID, entries())).toEqual([
            { state: 'unchained' }, { state: 'verified' }, { state: 'verified' }, { state: 'verified' }, { state: 'verified' },
        ]);

        bySeq(2).entityId = 'm-other';
        expect(await chain.annotateIntegrity(CID, entries())).toEqual([
            { state: 'unchained' }, { state: 'verified' }, { state: 'broken', brokenAt: 2 }, { state: 'broken', brokenAt: 2 }, { state: 'broken', brokenAt: 2 },
        ]);
    });

    it('keeps re-checking rows it has already verified, including rows not on the page', async () => {
        await writeRows(1, 6);
        const page = () => [5, 6].map((seq) => ({ row: bySeq(seq), amendments: [] }));
        expect(await chain.annotateIntegrity(CID, page())).toEqual([{ state: 'verified' }, { state: 'verified' }]);

        bySeq(2).meta = { ...bySeq(2).meta, fields: ['owner'] };
        expect(await chain.annotateIntegrity(CID, page())).toEqual([{ state: 'broken', brokenAt: 2 }, { state: 'broken', brokenAt: 2 }]);
    });

    it('notices a row deleted below the part it has already verified', async () => {
        await writeRows(1, 6);
        const page = () => [5, 6].map((seq) => ({ row: bySeq(seq), amendments: [] }));
        expect(await chain.annotateIntegrity(CID, page())).toEqual([{ state: 'verified' }, { state: 'verified' }]);

        removeAudit((r) => r.chain.seq === 3);
        expect(await chain.annotateIntegrity(CID, page())).toEqual([{ state: 'broken', brokenAt: 3 }, { state: 'broken', brokenAt: 3 }]);
    });

    it('reports rows as unverified when the key is not available to check them', async () => {
        await writeRows(1, 2);
        delete process.env.AUDIT_CHAIN_KEY;
        load();
        expect(await chain.annotateIntegrity(CID, auditRows().map((row) => ({ row, amendments: [] })))).toEqual([{ state: 'unverified' }, { state: 'unverified' }]);
    });
});

describe('retention', () => {
    const writeAt = async (daysAgo, from, to) => {
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'], now: Date.now() - daysAgo * DAY });
        await writeRows(from, to);
        jest.useRealTimers();
    };

    it('anchors the last swept row so verification stays valid after the sweep', async () => {
        await writeAt(400, 1, 4);
        await writeRows(5, 7);
        const lastSwept = { seq: 4, hash: bySeq(4).chain.hash };
        mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: CID });

        await recorder.runAuditRetentionForAllCompanies(365);

        expect(chained().map((r) => r.chain.seq)).toEqual([5, 6, 7]);
        expect(anchors()).toEqual([expect.objectContaining(lastSwept)]);
        expect(await chain.verifyChain(CID)).toMatchObject({ state: 'verified', brokenAt: null, verifiedThrough: 7, anchorSeq: 4 });

        await writeRows(8, 8);
        expect(bySeq(8).chain.prevHash).toBe(bySeq(7).chain.hash);
        expect(await chain.verifyChain(CID)).toMatchObject({ state: 'verified', verifiedThrough: 8 });
    });

    it('continues from the anchor when the sweep removed every chained row', async () => {
        await writeAt(400, 1, 3);
        mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: CID });
        await recorder.runAuditRetentionForAllCompanies(365);
        expect(chained()).toHaveLength(0);

        await writeRows(4, 5);
        expect(chained().map((r) => r.chain.seq)).toEqual([4, 5]);
        expect(await chain.verifyChain(CID)).toMatchObject({ state: 'verified', verifiedThrough: 5, anchorSeq: 3 });
    });

    it('ignores an anchor written without the key', async () => {
        await writeRows(1, 5);
        await mockDb.crud(CID, { type: SCHEMA_TYPE.AUDIT_CHAIN_ANCHORS, data: { seq: 4, hash: bySeq(4).chain.hash, mac: 'forged' } }, 'save');
        bySeq(2).actorId = 'u-other';
        expect(await chain.verifyChain(CID)).toMatchObject({ state: 'broken', brokenAt: 2 });
    });

    it('keeps audit rows at least as long as agent runs, with a warning', async () => {
        const { RETENTION_SECONDS } = require('../Modules/Agents/runs');
        const runDays = RETENTION_SECONDS / (24 * 60 * 60);
        process.env.AUDIT_RETENTION_DAYS = '30';
        await writeAt(runDays + 10, 1, 1);
        await writeAt(40, 2, 3);
        mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: CID });

        await recorder.runAuditRetentionForAllCompanies();

        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('AUDIT_RETENTION_DAYS'));
        expect(auditRows()).toHaveLength(2);
    });
});

describe('agent audit rows under the chain', () => {
    const scenario = async () => {
        const applied = await agentAudit.openAction(CID, actor, { action: 'task.comment', reason: 'r', params: { taskId: TASK }, ip: '10.0.0.2', entityId: TASK });
        await agentAudit.applyAction(CID, applied, { undo: { kind: 'comment', commentId: 'c1', taskId: TASK }, entityType: 'task', entityId: TASK, entityName: 'Fix the thing' });
        await agentAudit.markUndone(CID, applied, 'u2');
        const failed = await agentAudit.openAction(CID, actor, { action: 'task.update', params: { taskId: TASK }, idempotencyKey: 'wf:run:step' });
        await agentAudit.failAction(CID, failed, 'boom');
        const pending = await agentAudit.openAction(CID, actor, { action: 'task.assign', params: { taskId: TASK } });
        return { applied, failed, pending };
    };
    const comparable = (row) => {
        const rest = { ...(typeof row.toObject === 'function' ? row.toObject() : row) };
        ['_id', 'createdAt', 'updatedAt', 'chain', '__v'].forEach((field) => delete rest[field]);
        const meta = { ...rest.meta, settledAt: Boolean(rest.meta.settledAt), undoneAt: Boolean(rest.meta.undoneAt) };
        delete meta.traceId;
        return { ...rest, meta };
    };
    const currentState = async (ids) => ({
        applied: comparable(await agentAudit.findById(CID, ids.applied)),
        failed: comparable(await agentAudit.findById(CID, ids.failed)),
        pending: comparable(await agentAudit.findById(CID, ids.pending)),
        byKey: comparable(await agentAudit.findByIdempotencyKey(CID, 'wf:run:step')),
    });

    it('appends a chained row for each state change, and the folded state equals the in-place state', async () => {
        process.env.AUDIT_CHAIN = 'false';
        load();
        const today = await currentState(await scenario());

        Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
        mockDb.calls.length = 0;
        process.env.AUDIT_CHAIN = 'true';
        load();
        const ids = await scenario();

        expect(mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.AUDIT_LOGS && ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne'].includes(c.method))).toEqual([]);
        const originals = auditRows().filter((r) => r.action === 'agent.action');
        expect(originals).toHaveLength(3);
        originals.forEach((r) => expect(r.meta).toMatchObject({ state: 'pending', undo: null, undoneAt: null }));
        const amendments = chained().filter((r) => r.action === 'audit.amended');
        expect(amendments.map((r) => r.meta.amends)).toEqual([ids.applied, ids.applied, ids.failed]);

        expect(await currentState(ids)).toEqual(today);
        expect(await chain.verifyChain(CID)).toMatchObject({ state: 'verified', verifiedThrough: 6 });
    });

    it('still refuses to mark a row that does not exist', async () => {
        await expect(agentAudit.applyAction(CID, '6f00000000000000000000ff', { undo: null })).rejects.toMatchObject({ reason: 'audit_unmarked' });
    });

    it('reports a markUndone failure instead of swallowing it', async () => {
        const id = await agentAudit.recordAction(CID, actor, { action: 'task.comment', params: { taskId: TASK, projectId: 'p1' }, undo: { kind: 'comment', commentId: '6f0000000000000000000d01', taskId: TASK }, entityId: TASK });
        const row = await agentAudit.findById(CID, id);
        const undo = require('../Modules/Agents/undo');
        const real = mockDb.crud.getMockImplementation();
        mockDb.crud.mockImplementation(async (companyId, query, method) => {
            if (method === 'save' && query.data && query.data.meta && query.data.meta.set && query.data.meta.set.undoneAt) throw new Error('disk full');
            return real(companyId, query, method);
        });
        try {
            await expect(agentAudit.markUndone(CID, id, 'u2')).rejects.toMatchObject({ reason: 'audit_unmarked', auditId: id });
            expect(logger.error).toHaveBeenCalledWith(expect.stringContaining(id));

            await expect(undo.undoAuditRow(CID, row, { kind: 'human', userId: 'u2' }, '', { undoHours: 24, visibleProjectIds: ['p1'], run: null }))
                .rejects.toMatchObject({ reason: 'audit_unmarked' });
        } finally {
            mockDb.crud.mockImplementation(real);
        }
        expect(auditRows().filter((r) => r.action === agentAudit.ACTION_UNDONE)).toHaveLength(1);
    });
});

describe('the key', () => {
    it('leaves the chain off and logs an error at boot and on writes when AUDIT_CHAIN_KEY is missing', async () => {
        delete process.env.AUDIT_CHAIN_KEY;
        load();
        chain.logBootState();
        expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/AUDIT_CHAIN_KEY/));

        logger.error.mockClear();
        let now = Date.now() + 5 * 60 * 1000;
        const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
        try {
            recorder.recordAudit(CID, entry(1));
            await waitFor(() => auditRows().length === 1);
            expect(logger.error).toHaveBeenCalledTimes(1);
            expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/AUDIT_CHAIN_KEY/));

            await chain.saveAuditRow(CID, entry(2));
            expect(logger.error).toHaveBeenCalledTimes(1);
            now += 61 * 1000;
            await chain.saveAuditRow(CID, entry(3));
            expect(logger.error).toHaveBeenCalledTimes(2);
        } finally {
            clock.mockRestore();
        }

        expect(auditRows().every((r) => r.chain === undefined)).toBe(true);
        expect(heads()).toHaveLength(0);
    });

    it('leaves the chain off with an error when AUDIT_CHAIN_KEY is shorter than 32 characters', async () => {
        process.env.AUDIT_CHAIN_KEY = 'k'.repeat(31);
        load();
        await chain.saveAuditRow(CID, entry(1));
        expect(auditRows()[0].chain).toBeUndefined();
        expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/AUDIT_CHAIN_KEY/));

        const id = await agentAudit.openAction(CID, actor, { action: 'task.comment', params: { taskId: TASK } });
        await agentAudit.applyAction(CID, id, { undo: null });
        expect(auditRows().filter((r) => r.action === 'audit.amended')).toHaveLength(0);

        expect(rules.chainConfig({ AUDIT_CHAIN: 'true', AUDIT_CHAIN_KEY: 'k'.repeat(31) })).toMatchObject({ on: false, requested: true });
        expect(rules.chainConfig({ AUDIT_CHAIN: 'true', AUDIT_CHAIN_KEY: 'k'.repeat(32) })).toMatchObject({ on: true, error: '' });
        expect(rules.chainConfig({ AUDIT_CHAIN_KEY: 'k'.repeat(32) })).toMatchObject({ on: false, requested: false, error: '' });
    });
});
