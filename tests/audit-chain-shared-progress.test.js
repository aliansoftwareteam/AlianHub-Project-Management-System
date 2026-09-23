const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const rules = require('../Modules/Audit/helpers/chainRules');

/* Follow-up 76: verification progress is one document per company that every server reads and writes. Each
 * "server" here is its own copy of the chain module, sharing one database. */

const CID = '6f00000000000000000000d7';
const KEY = 'test-audit-chain-key-shared-progress-0123';
const HOUR = 60 * 60 * 1000;
const PROGRESS = SCHEMA_TYPE.AUDIT_CHAIN_PROGRESS;

const server = () => {
    let chain;
    jest.isolateModules(() => { chain = require('../Modules/Audit/chain'); });
    return chain;
};

const auditRows = () => mockDb.store[SCHEMA_TYPE.AUDIT_LOGS] || [];
const bySeq = (seq) => auditRows().find((r) => r.chain && r.chain.seq === seq);
const progressDocs = () => (PROGRESS ? mockDb.store[PROGRESS] || [] : []);
const page = (...seqs) => seqs.map((seq) => ({ row: bySeq(seq), amendments: [] }));
const tamper = (seq) => { bySeq(seq).meta = { ...bySeq(seq).meta, fields: ['owner'] }; };

const entry = (i) => ({ actorId: `u${i}`, actorName: `Person ${i}`, action: 'member.update', entityType: 'member', entityId: `m${i}`, meta: { fields: ['role'], n: i } });
const writeRows = async (chain, from, to) => {
    for (let i = from; i <= to; i += 1) await chain.saveAuditRow(CID, entry(i));
};

const isRangeWalk = (c) => c.type === SCHEMA_TYPE.AUDIT_LOGS && c.method === 'find'
    && c.data[0] && c.data[0]['chain.seq'] && c.data[0]['chain.seq'].$gt !== undefined;
const callsDuring = async (fn) => {
    const from = mockDb.calls.length;
    const result = await fn();
    return { result, calls: mockDb.calls.slice(from) };
};

/* Holds the first chain walk that reaches the database until released, so another server can run meanwhile. */
const holdFirstWalk = () => {
    const real = mockDb.crud.getMockImplementation();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const state = { reached: false };
    mockDb.crud.mockImplementation(async (companyId, query, method) => {
        if (!state.reached && isRangeWalk({ type: query.type, method, data: query.data })) {
            state.reached = true;
            await gate;
        }
        return real(companyId, query, method);
    });
    const reached = async () => {
        for (let i = 0; i < 400 && !state.reached; i += 1) await new Promise((resolve) => setImmediate(resolve));
        if (!state.reached) throw new Error('the walk never reached the database');
    };
    return { reached, release: () => { mockDb.crud.mockImplementation(real); release(); } };
};

const plantLease = (until, owner = 'another-server', leaseId = 'lease-1') => {
    const doc = progressDocs()[0];
    Object.assign(doc, { owner, leaseId, leaseUntil: until, leaseMac: rules.markMac(KEY, 'lease', CID, { seq: until.getTime(), hash: `${owner}:${leaseId}` }) });
};

const servers = [];
const start = () => {
    const s = server();
    servers.push(s);
    return s;
};

beforeAll(() => {
    const schemas = require('../utils/mongo-handler/createSchema');
    mockDb.uniqueFromSchema(SCHEMA_TYPE.AUDIT_LOGS, schemas.auditLogsSchema);
    mockDb.unique(SCHEMA_TYPE.AUDIT_CHAIN_HEADS, ['_id']);
    if (PROGRESS) mockDb.unique(PROGRESS, ['_id']);
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    process.env.AUDIT_CHAIN = 'true';
    process.env.AUDIT_CHAIN_KEY = KEY;
});

afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.flushMirrors()));
});

afterAll(() => {
    delete process.env.AUDIT_CHAIN;
    delete process.env.AUDIT_CHAIN_KEY;
});

describe('verification progress shared between servers', () => {
    it('lets a second server carry on from what the first verified', async () => {
        const a = start();
        const b = start();
        await writeRows(a, 1, 6);
        expect(await a.annotateIntegrity(CID, page(5, 6), { budget: 20 })).toEqual([{ state: 'verified' }, { state: 'verified' }]);
        await writeRows(a, 7, 8);

        expect(await b.annotateIntegrity(CID, page(7, 8), { budget: 4 })).toEqual([{ state: 'verified' }, { state: 'verified' }]);
        expect(await a.annotateIntegrity(CID, page(7, 8), { budget: 4 })).toEqual([{ state: 'verified' }, { state: 'verified' }]);
    });

    it('keeps one small document per company: the last verified seq and hash, and when', async () => {
        const a = start();
        await writeRows(a, 1, 3);
        await a.annotateIntegrity(CID, page(3), { budget: 20 });

        expect(progressDocs()).toHaveLength(1);
        expect(progressDocs()[0]).toMatchObject({ _id: 'progress', seq: 3, hash: bySeq(3).chain.hash, anchorSeq: 0, brokenAt: null, leaseUntil: null });
        expect(progressDocs()[0].at).toBeInstanceOf(Date);
    });

    it('declares every field it stores, so a strict schema keeps them', async () => {
        const a = start();
        await writeRows(a, 1, 3);
        await a.annotateIntegrity(CID, page(3), { budget: 20 });
        const { auditChainProgressSchema } = require('../utils/mongo-handler/createSchema');
        const declared = Object.keys(auditChainProgressSchema.paths);
        // The fake stamps createdAt on every save; the real schema has no timestamps.
        const stored = Object.keys(progressDocs()[0]).filter((k) => k !== '__v' && k !== 'createdAt');
        expect(stored.filter((k) => !declared.includes(k))).toEqual([]);
        ['seq', 'hash', 'at', 'leaseUntil', 'owner', 'leaseId', 'leaseMac', 'mac', 'gen', 'anchorSeq', 'rewalkSeq', 'rewalkHash', 'brokenAt'].forEach((k) => expect(declared).toContain(k));
    });
});

describe('the lease', () => {
    it('stops a second server from re-verifying the range the first is walking, and it reads the same states', async () => {
        const a = start();
        const b = start();
        await writeRows(a, 1, 6);
        await a.annotateIntegrity(CID, page(5, 6), { budget: 20 });
        tamper(4);
        expect(await a.annotateIntegrity(CID, page(5, 6), { budget: 20 })).toEqual([{ state: 'broken', brokenAt: 4 }, { state: 'broken', brokenAt: 4 }]);

        const hold = holdFirstWalk();
        const walking = a.annotateIntegrity(CID, page(5, 6), { budget: 20 });
        await hold.reached();
        const { result, calls } = await callsDuring(() => b.annotateIntegrity(CID, page(5, 6), { budget: 20 }));
        hold.release();

        expect(calls.filter(isRangeWalk)).toEqual([]);
        expect(result).toEqual([{ state: 'broken', brokenAt: 4 }, { state: 'broken', brokenAt: 4 }]);
        expect(await walking).toEqual([{ state: 'broken', brokenAt: 4 }, { state: 'broken', brokenAt: 4 }]);
        expect(progressDocs()[0].leaseUntil).toBeNull();
    });

    it('reads verified rows as verified while the other server holds the lease', async () => {
        const a = start();
        const b = start();
        await writeRows(a, 1, 6);
        await a.annotateIntegrity(CID, page(5, 6), { budget: 20 });

        const hold = holdFirstWalk();
        const walking = a.annotateIntegrity(CID, page(5, 6), { budget: 20 });
        await hold.reached();
        const { result, calls } = await callsDuring(() => b.annotateIntegrity(CID, page(5, 6), { budget: 20 }));
        hold.release();
        await walking;

        expect(calls.filter(isRangeWalk)).toEqual([]);
        expect(result).toEqual([{ state: 'verified' }, { state: 'verified' }]);
    });

    it('re-reads the progress at most once a second while another server holds the lease', async () => {
        const a = start();
        const b = start();
        await writeRows(a, 1, 6);
        await a.annotateIntegrity(CID, page(5, 6), { budget: 20 });

        const hold = holdFirstWalk();
        const walking = a.annotateIntegrity(CID, page(5, 6), { budget: 20 });
        await hold.reached();
        await b.annotateIntegrity(CID, page(5, 6), { budget: 20 });
        const { calls } = await callsDuring(() => b.annotateIntegrity(CID, page(5, 6), { budget: 20 }));
        hold.release();
        await walking;

        expect(calls.filter(isRangeWalk)).toEqual([]);
        expect(calls.filter((c) => c.type === PROGRESS)).toEqual([]);
    });

    it('does not read rows as verified through a stored position whose row is gone', async () => {
        const a = start();
        const b = start();
        await writeRows(a, 1, 8);
        await a.annotateIntegrity(CID, page(5, 6), { budget: 20 });

        const hold = holdFirstWalk();
        const walking = a.annotateIntegrity(CID, page(5, 6), { budget: 20 });
        await hold.reached();
        mockDb.store[SCHEMA_TYPE.AUDIT_LOGS] = auditRows().filter((r) => !(r.chain && r.chain.seq >= 7));
        const deferred = await b.annotateIntegrity(CID, page(5, 6), { budget: 20 });
        hold.release();
        await walking;

        expect(deferred).toEqual([{ state: 'unverified' }, { state: 'unverified' }]);
    });

    it('never overwrites the progress once its lease has passed to another server', async () => {
        const a = start();
        await writeRows(a, 1, 6);
        await a.annotateIntegrity(CID, page(5, 6), { budget: 20 });
        const before = { ...progressDocs()[0] };

        const hold = holdFirstWalk();
        const walking = a.annotateIntegrity(CID, page(5, 6), { budget: 20 });
        await hold.reached();
        const until = new Date(Date.now() + 5000);
        plantLease(until, 'another-server', 'lease-2');
        hold.release();
        await walking;

        expect(progressDocs()[0]).toMatchObject({ leaseId: 'lease-2', leaseUntil: until, gen: before.gen, mac: before.mac });
    });

    it('lets the lease go when its walk fails', async () => {
        const a = start();
        const b = start();
        await writeRows(a, 1, 6);
        await a.annotateIntegrity(CID, page(5, 6), { budget: 20 });

        const real = mockDb.crud.getMockImplementation();
        mockDb.crud.mockImplementation(async (companyId, query, method) => {
            if (isRangeWalk({ type: query.type, method, data: query.data })) {
                mockDb.crud.mockImplementation(real);
                throw new Error('the database went away');
            }
            return real(companyId, query, method);
        });
        await expect(a.annotateIntegrity(CID, page(5, 6), { budget: 20 })).rejects.toThrow('the database went away');

        const { calls } = await callsDuring(() => b.annotateIntegrity(CID, page(5, 6), { budget: 20 }));
        expect(calls.filter(isRangeWalk).length).toBeGreaterThan(0);
    });

    it('takes over a lease that has run out', async () => {
        const a = start();
        const b = start();
        await writeRows(a, 1, 6);
        await a.annotateIntegrity(CID, page(5, 6), { budget: 20 });
        plantLease(new Date(Date.now() - 1000));

        const { calls } = await callsDuring(() => b.annotateIntegrity(CID, page(5, 6), { budget: 20 }));
        expect(calls.filter(isRangeWalk).length).toBeGreaterThan(0);
    });

    it('ignores a lease that runs further ahead than a lease can', async () => {
        const a = start();
        const b = start();
        await writeRows(a, 1, 6);
        await a.annotateIntegrity(CID, page(5, 6), { budget: 20 });
        plantLease(new Date(Date.now() + HOUR));

        const { calls } = await callsDuring(() => b.annotateIntegrity(CID, page(5, 6), { budget: 20 }));
        expect(calls.filter(isRangeWalk).length).toBeGreaterThan(0);
    });

    it('ignores a lease written without the key', async () => {
        const a = start();
        const b = start();
        await writeRows(a, 1, 6);
        await a.annotateIntegrity(CID, page(5, 6), { budget: 20 });
        plantLease(new Date(Date.now() + 5000));
        progressDocs()[0].leaseMac = 'f'.repeat(64);

        const { calls } = await callsDuring(() => b.annotateIntegrity(CID, page(5, 6), { budget: 20 }));
        expect(calls.filter(isRangeWalk).length).toBeGreaterThan(0);
    });
});

describe('what the database cannot move', () => {
    it('does not trust progress written without the key', async () => {
        const a = start();
        const b = start();
        await writeRows(a, 1, 6);
        await a.annotateIntegrity(CID, page(5, 6), { budget: 20 });
        await writeRows(a, 7, 8);
        tamper(7);
        Object.assign(progressDocs()[0], { seq: 8, hash: bySeq(8).chain.hash });

        expect(await b.annotateIntegrity(CID, page(8), { budget: 2 })).toEqual([{ state: 'unverified' }]);
    });

    it('does not go back to an older copy of the progress once it has read a newer one', async () => {
        const a = start();
        const b = start();
        await writeRows(a, 1, 6);
        await a.annotateIntegrity(CID, page(5, 6), { budget: 20 });
        const older = { ...progressDocs()[0] };
        tamper(4);
        await a.annotateIntegrity(CID, page(5, 6), { budget: 20 });

        let hold = holdFirstWalk();
        let walking = a.annotateIntegrity(CID, page(5, 6), { budget: 20 });
        await hold.reached();
        expect(await b.annotateIntegrity(CID, page(5, 6), { budget: 20 })).toEqual([{ state: 'broken', brokenAt: 4 }, { state: 'broken', brokenAt: 4 }]);
        hold.release();
        await walking;

        await new Promise((resolve) => setTimeout(resolve, 1100));
        hold = holdFirstWalk();
        walking = a.annotateIntegrity(CID, page(5, 6), { budget: 20 });
        await hold.reached();
        const { owner, leaseId, leaseUntil, leaseMac } = progressDocs()[0];
        Object.assign(progressDocs()[0], older, { owner, leaseId, leaseUntil, leaseMac });
        const replayed = await b.annotateIntegrity(CID, page(5, 6), { budget: 20 });
        hold.release();
        await walking;

        expect(replayed).not.toEqual([{ state: 'verified' }, { state: 'verified' }]);
    });
});

describe('one server', () => {
    it('resumes from its own progress as it did from memory', async () => {
        const a = start();
        await writeRows(a, 1, 12);
        expect(await a.annotateIntegrity(CID, page(11, 12), { budget: 4 })).toEqual([{ state: 'unverified' }, { state: 'unverified' }]);
        expect(await a.annotateIntegrity(CID, page(11, 12), { budget: 4 })).toEqual([{ state: 'unverified' }, { state: 'unverified' }]);
        expect(await a.annotateIntegrity(CID, page(11, 12), { budget: 20 })).toEqual([{ state: 'verified' }, { state: 'verified' }]);
        const { calls } = await callsDuring(() => a.annotateIntegrity(CID, page(11, 12), { budget: 4 }));
        expect(calls.filter(isRangeWalk).map((c) => c.data[0]['chain.seq'])).toEqual([{ $gt: 12 }, { $gt: 0, $lte: 12 }]);
    });
});

describe('with AUDIT_CHAIN off', () => {
    it('reads and writes no progress, even with the key set and chained rows to verify', async () => {
        const a = start();
        await writeRows(a, 1, 4);
        mockDb.store[PROGRESS] = [];
        process.env.AUDIT_CHAIN = 'false';
        const off = start();
        const b = start();
        mockDb.calls.length = 0;

        expect(await off.annotateIntegrity(CID, page(3, 4), { budget: 20 })).toEqual([{ state: 'verified' }, { state: 'verified' }]);
        await b.annotateIntegrity(CID, page(3, 4), { budget: 20 });
        expect(mockDb.calls.filter((c) => c.type === PROGRESS)).toEqual([]);
        expect(progressDocs()).toEqual([]);
    });
});
