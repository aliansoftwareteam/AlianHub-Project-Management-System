/* A re-index walks files by the task that carries them, so one row of the walk can be many slow
 * extractions. The walker renews its lease as each attachment finishes: a slow but live walker is
 * never taken over mid-task, one whose lease was taken stops at the next attachment, and a walker
 * that died is still taken over once its lease runs out. */
const mockDbs = {};
const mockDbFor = (companyId) => {
    const id = String(companyId);
    if (!mockDbs[id]) mockDbs[id] = require('./fixtures/fakeMongo').create();
    return mockDbs[id];
};

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDbFor(companyId).crud(companyId, q, method),
    validateObjectId: (id) => /^[0-9a-fA-F]{24}$/.test(String(id)),
}));
jest.mock('../Config/config', () => {
    const NodeCache = require('node-cache');
    return { myCache: new NodeCache() };
});
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../common-storage/readStoredFile', () => ({ readStoredFile: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { knowledgeChunksSchema, knowledgeIndexStateSchema } = require('../utils/mongo-handler/createSchema');
const { readStoredFile } = require('../common-storage/readStoredFile');
const extractor = require('../Modules/Knowledge/ingest/extract/extractor');
const reindex = require('../Modules/Knowledge/reindex');

const C = '6f0000000000000000000c01';
const PROJECT = '6f0000000000000000000a01';
const CHUNKS = SCHEMA_TYPE.KNOWLEDGE_CHUNKS;
const STATE = SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE;
const MINUTE = 60 * 1000;
const STEP = 2 * MINUTE;
const ATTACHMENTS = 6;
const ENV = { indexer: process.env.KNOWLEDGE_INDEXER, retrieval: process.env.KNOWLEDGE_RETRIEVAL };

const db = () => mockDbFor(C);
const stateOf = () => (db().store[STATE] || []).find((s) => s.sourceType === 'file');
const liveFiles = () => new Set((db().store[CHUNKS] || []).filter((c) => c.sourceType === 'file' && c.deleted !== true).map((c) => c.sourceId));

let now;
let extracted;
let extract;

const seedTask = () => {
    const task = db().seed(SCHEMA_TYPE.TASKS, { TaskName: 'Harbour survey', ProjectID: PROJECT, deletedStatusKey: 0, updatedAt: new Date('2026-09-01T00:00:00Z'), attachments: [] });
    task.attachments = Array.from({ length: ATTACHMENTS }, (_, i) => ({
        id: `att${i + 1}`, filename: `survey-${i + 1}.txt`, extension: 'txt', size: 64, url: `Project/${PROJECT}/Sprint/${task._id}/Attachment/survey-${i + 1}.txt`,
    }));
    return task;
};

const readKey = async ({ key }) => ({ buffer: Buffer.from(key) });

/* Another server: its own copy of the modules, so nothing in this process's memory (the per-source
 * sync queue, the files in hand) is shared with the first, only the database and the extraction. */
const secondServer = () => {
    let server;
    jest.isolateModules(() => {
        server = {
            reindex: require('../Modules/Knowledge/reindex'),
            extractor: require('../Modules/Knowledge/ingest/extract/extractor'),
            storage: require('../common-storage/readStoredFile'),
        };
    });
    server.storage.readStoredFile.mockImplementation(readKey);
    jest.spyOn(server.extractor, 'extractText').mockImplementation((...args) => extract(...args));
    return server;
};

const timesEach = () => extracted.reduce((counts, key) => ({ ...counts, [key]: (counts[key] || 0) + 1 }), {});

/* Lets the walk run until it is waiting on something that never settles. */
const flush = async () => {
    for (let i = 0; i < 200; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

beforeAll(() => {
    process.env.KNOWLEDGE_INDEXER = 'tenant';
    process.env.KNOWLEDGE_RETRIEVAL = 'tenant';
});

afterAll(() => {
    [['KNOWLEDGE_INDEXER', ENV.indexer], ['KNOWLEDGE_RETRIEVAL', ENV.retrieval]].forEach(([key, value]) => {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    });
});

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => delete mockDbs[key]);
    db().uniqueFromSchema(CHUNKS, knowledgeChunksSchema);
    db().uniqueFromSchema(STATE, knowledgeIndexStateSchema);
    mockDbFor('global').seed('companies', { _id: C, Cst_CompanyName: 'Acme', knowledgeIndexer: { mode: 'on' } });
    db().seed(STATE, { companyId: C, sourceType: 'file', status: 'complete', cursor: '', indexed: 0, skipped: 0, lastSeenOnAt: new Date(), catchUpFrom: null });
    now = Date.parse('2026-09-20T00:00:00Z');
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    readStoredFile.mockImplementation(readKey);
    extracted = [];
    extract = jest.spyOn(extractor, 'extractText').mockImplementation(async ({ buffer }) => {
        extracted.push(buffer.toString());
        now += STEP;
        return { text: `Harbour survey notes from ${buffer.toString()}.` };
    });
});

afterEach(() => jest.restoreAllMocks());

describe('re-indexing files by the task that carries them', () => {
    it('keeps the lease through a slow task, so another server passes it over and no attachment is extracted twice', async () => {
        seedTask();
        await reindex.request(C, 'file', {});
        const serverB = secondServer();
        let other;
        extract.mockImplementation(async ({ buffer }) => {
            extracted.push(buffer.toString());
            now += STEP;
            if (extracted.length === 3) other = await serverB.reindex.runSource(C, 'file', { owner: 'server-b' });
            return { text: `Harbour survey notes from ${buffer.toString()}.` };
        });

        const done = await reindex.runSource(C, 'file', { owner: 'server-a' });

        expect(ATTACHMENTS * STEP).toBeGreaterThan(reindex.LEASE_MS);
        expect(other).toBeNull();
        expect(extracted).toHaveLength(ATTACHMENTS);
        expect(Object.values(timesEach())).toEqual(Array(ATTACHMENTS).fill(1));
        expect(done).toMatchObject({ reindexStatus: 'complete', reindexSynced: 1, reindexOwner: '' });
        expect(liveFiles().size).toBe(ATTACHMENTS);
    });

    it('stops at the next attachment once its lease is gone, and extracts nothing more', async () => {
        seedTask();
        await reindex.request(C, 'file', {});
        extract.mockImplementation(async ({ buffer }) => {
            extracted.push(buffer.toString());
            now += STEP;
            if (extracted.length === 3) await reindex.cancel(C, 'file');
            return { text: `Harbour survey notes from ${buffer.toString()}.` };
        });

        expect(await reindex.runSource(C, 'file', { owner: 'server-a' })).toBeNull();

        expect(extracted).toHaveLength(3);
        expect(stateOf()).toMatchObject({ reindexStatus: 'cancelled', reindexOwner: '' });
    });

    it('is still taken over when the walker dies mid-task, and the files it finished are not extracted again', async () => {
        seedTask();
        await reindex.request(C, 'file', {});
        const serverB = secondServer();
        extract.mockImplementation(async ({ buffer }) => {
            extracted.push(buffer.toString());
            now += STEP;
            if (extracted.length === 3) return new Promise(() => {});
            return { text: `Harbour survey notes from ${buffer.toString()}.` };
        });

        reindex.runSource(C, 'file', { owner: 'server-a' });
        await flush();
        expect(extracted).toHaveLength(3);
        expect(stateOf()).toMatchObject({ reindexStatus: 'running', reindexOwner: 'server-a' });

        expect(await serverB.reindex.runSource(C, 'file', { owner: 'server-b' })).toBeNull();

        now = stateOf().reindexLeaseUntil.getTime() + MINUTE;
        extract.mockImplementation(async ({ buffer }) => {
            extracted.push(buffer.toString());
            return { text: `Harbour survey notes from ${buffer.toString()}.` };
        });
        const done = await serverB.reindex.runSource(C, 'file', { owner: 'server-b' });

        expect(done).toMatchObject({ reindexStatus: 'complete', reindexOwner: '' });
        const counts = timesEach();
        expect(Object.keys(counts)).toHaveLength(ATTACHMENTS);
        expect(Object.values(counts).filter((n) => n > 1)).toEqual([2]);
        expect(liveFiles().size).toBe(ATTACHMENTS);
    });
});
