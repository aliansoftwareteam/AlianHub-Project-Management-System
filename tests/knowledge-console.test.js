const mockDbs = {};
const mockDbFor = (companyId) => {
    const id = String(companyId);
    if (!mockDbs[id]) mockDbs[id] = require('./fixtures/fakeMongo').create();
    return mockDbs[id];
};

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDbFor(companyId).crud(companyId, q, method),
}));
jest.mock('../Config/config', () => {
    const NodeCache = require('node-cache');
    return { myCache: new NodeCache() };
});
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../common-storage/readStoredFile', () => ({ readStoredFile: jest.fn() }));
jest.mock('../Modules/Agents/budget', () => ({ settings: jest.fn(async () => ({ monthlyBudgetUsd: 25 })) }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { knowledgeChunksSchema, knowledgeIndexStateSchema } = require('../utils/mongo-handler/createSchema');
const backfill = require('../Modules/Knowledge/ingest/backfill');
const embeddings = require('../Modules/Knowledge/embeddings');
const reindex = require('../Modules/Knowledge/reindex');
const figures = require('../Modules/Knowledge/figures');
const controls = require('../Modules/Knowledge/controls');

const C = '6f0000000000000000000c01';
const OTHER = '6f0000000000000000000c02';
const ALICE = '6f0000000000000000000011';
const BOB = '6f0000000000000000000012';
const PROJECT = '6f0000000000000000000a01';
const TASK = '6f0000000000000000000b01';
const MODEL = embeddings.DEFAULT_MODEL;
const CHUNKS = SCHEMA_TYPE.KNOWLEDGE_CHUNKS;
const STATE = SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE;
const ENV = { indexer: process.env.KNOWLEDGE_INDEXER, retrieval: process.env.KNOWLEDGE_RETRIEVAL, model: process.env.KNOWLEDGE_EMBEDDING_MODEL };
const MINUTE = 60 * 1000;

const db = (companyId = C) => mockDbFor(companyId);
const g = () => mockDbFor('global');
const chunks = (companyId = C) => db(companyId).store[CHUNKS] || [];
const liveOf = (sourceId, companyId = C) => chunks(companyId).filter((c) => c.sourceId === String(sourceId) && c.deleted !== true);
const stateOf = (sourceType, companyId = C) => (db(companyId).store[STATE] || []).find((s) => s.sourceType === sourceType);

let seq = 0;
const chunk = (over = {}) => {
    seq += 1;
    const text = over.text === undefined ? 'Some words here.' : over.text;
    return db(over.companyId || C).seed(CHUNKS, {
        companyId: C, sourceType: 'page', sourceId: `6f00000000000000000${String(seq).padStart(5, '0')}`, ordinal: 0, text, textBytes: Buffer.byteLength(text), contentHash: `h${seq}`,
        createdBy: ALICE, visibility: 'project', deleted: false, embedding: [], embeddingModel: null, updatedAt: new Date('2026-09-10T00:00:00Z'), ...over,
    });
};
const state = (sourceType, over = {}, companyId = C) => db(companyId).seed(STATE, {
    companyId, sourceType, status: 'complete', cursor: '', indexed: 0, skipped: 0, lastSeenOnAt: new Date(), originFilledAt: new Date(), catchUpFrom: null, ...over,
});
const company = (id, over = {}) => g().seed('companies', { _id: id, Cst_CompanyName: 'Acme', knowledgeIndexer: { mode: 'on' }, ...over });
const seedPage = (over = {}) => db().seed(SCHEMA_TYPE.PAGES, {
    title: 'Harbour notes', content: { html: '<p>Park by the harbour.</p>' }, visibility: 'project', createdBy: ALICE, ProjectID: PROJECT, deletedStatusKey: 0, updatedAt: new Date('2026-09-01T00:00:00Z'), ...over,
});

beforeAll(() => {
    process.env.KNOWLEDGE_INDEXER = 'tenant';
    process.env.KNOWLEDGE_RETRIEVAL = 'tenant';
    delete process.env.KNOWLEDGE_EMBEDDING_MODEL;
});

afterAll(() => {
    [['KNOWLEDGE_INDEXER', ENV.indexer], ['KNOWLEDGE_RETRIEVAL', ENV.retrieval], ['KNOWLEDGE_EMBEDDING_MODEL', ENV.model]].forEach(([key, value]) => {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    });
});

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => delete mockDbs[key]);
    myCache.flushAll();
    embeddings.resetBreaker();
    backfill.resetHeartbeats();
    db().uniqueFromSchema(CHUNKS, knowledgeChunksSchema);
    db().uniqueFromSchema(STATE, knowledgeIndexStateSchema);
    company(C);
    company(OTHER, { Cst_CompanyName: 'Bolt' });
});

const sourceFigures = (result, sourceType) => result.sources.find((s) => s.sourceType === sourceType);

describe('workspace figures', () => {
    it('counts live chunks, sources, stored size and the last indexed time per source type', async () => {
        chunk({ sourceId: 'p1', ordinal: 0, updatedAt: new Date('2026-09-10T00:00:00Z') });
        chunk({ sourceId: 'p1', ordinal: 1, updatedAt: new Date('2026-09-12T00:00:00Z') });
        chunk({ sourceId: 'p2', ordinal: 0 });
        chunk({ sourceId: 'p3', ordinal: 0, deleted: true, text: '' });
        chunk({ sourceType: 'comment', sourceId: 'c1' });
        chunk({ sourceType: 'transcript', sourceId: 't1' });
        chunk({ sourceType: 'transcript', sourceId: 't1', ordinal: 1 });
        chunk({ sourceType: 'page', sourceId: 'elsewhere', companyId: OTHER });
        state('page');

        const result = await figures.workspaceFigures(C);

        expect(sourceFigures(result, 'page')).toMatchObject({ chunks: 3, sources: 2, tombstones: 1, lastIndexedAt: new Date('2026-09-12T00:00:00Z') });
        expect(sourceFigures(result, 'page').textBytes).toBe(3 * Buffer.byteLength('Some words here.'));
        expect(sourceFigures(result, 'comment')).toMatchObject({ chunks: 1, sources: 1, tombstones: 0 });
        expect(sourceFigures(result, 'transcript')).toMatchObject({ chunks: 2, sources: 1 });
        expect(sourceFigures(result, 'guide')).toMatchObject({ chunks: 0, sources: 0, textBytes: 0, lastIndexedAt: null });
        expect(result.totals).toMatchObject({ chunks: 6, sources: 4 });
        expect(result.totals.textBytes).toBe(result.sources.reduce((sum, s) => sum + s.textBytes, 0));
    });

    it('lists a source type the chunk store holds even when the known list does not name it', async () => {
        chunk({ sourceType: 'memory', sourceId: 'm1' });
        const result = await figures.workspaceFigures(C);
        expect(sourceFigures(result, 'memory')).toMatchObject({ chunks: 1, sources: 1 });
    });

    it('never carries chunk text, titles or file names', async () => {
        chunk({ sourceId: 'p1', text: 'SECRET-TEXT-9', title: 'SECRET-TITLE-9' });
        chunk({ sourceType: 'file', sourceId: `${TASK}:a1`, text: '', title: 'payroll-SECRET-NAME.pdf', fileKey: 'Project/x/SECRET-KEY', ordinal: 0, deleted: true, tombstoneReason: 'skipped:too_large' });
        const json = JSON.stringify(await figures.workspaceFigures(C));
        expect(json).not.toMatch(/SECRET/);
    });

    it('reads the backfill state of each source: not started, running with progress, catching up, complete, failed', async () => {
        const pages = [1, 2, 3, 4].map(() => seedPage());
        state('page', { status: 'running', cursor: String(pages[1]._id), indexed: 2 });
        state('comment', { status: 'catching-up', catchUpFrom: new Date(Date.now() - 30 * MINUTE), lastSeenOnAt: new Date() });
        state('transcript', { status: 'failed', error: 'boom SECRET' });
        state('guide', { status: 'complete' });

        const result = await figures.workspaceFigures(C);

        expect(sourceFigures(result, 'page').backfill).toMatchObject({ status: 'running', progress: { done: 2, total: 4 } });
        expect(sourceFigures(result, 'comment').backfill).toMatchObject({ status: 'catching_up' });
        expect(sourceFigures(result, 'comment').freshness.catchUpBehindMs).toBeGreaterThanOrEqual(30 * MINUTE);
        expect(sourceFigures(result, 'transcript').backfill).toMatchObject({ status: 'failed' });
        expect(sourceFigures(result, 'guide').backfill).toMatchObject({ status: 'complete', progress: null });
        expect(sourceFigures(result, 'file').backfill).toMatchObject({ status: 'not_started' });
        expect(JSON.stringify(result)).not.toMatch(/SECRET/);
    });

    it('counts files by the task that carries them for the progress of their backfill', async () => {
        const tasks = [1, 2, 3].map(() => db().seed(SCHEMA_TYPE.TASKS, { ProjectID: PROJECT, deletedStatusKey: 0, attachments: [{ id: 'a1' }] }));
        db().seed(SCHEMA_TYPE.TASKS, { ProjectID: PROJECT, deletedStatusKey: 0, attachments: [] });
        state('file', { status: 'running', cursor: String(tasks[0]._id) });
        const result = await figures.workspaceFigures(C);
        expect(sourceFigures(result, 'file').backfill.progress).toEqual({ done: 1, total: 3 });
    });

    it('says how far the heartbeat is behind and whether that makes the source stale', async () => {
        state('page', { lastSeenOnAt: new Date(Date.now() - 2 * MINUTE) });
        state('comment', { lastSeenOnAt: new Date(Date.now() - backfill.STALE_AFTER_MS - MINUTE) });
        const result = await figures.workspaceFigures(C);
        expect(sourceFigures(result, 'page').freshness).toMatchObject({ stale: false });
        expect(sourceFigures(result, 'page').freshness.behindMs).toBeGreaterThanOrEqual(2 * MINUTE);
        expect(sourceFigures(result, 'comment').freshness).toMatchObject({ stale: true });
        expect(sourceFigures(result, 'guide').freshness).toMatchObject({ heartbeatAt: null, behindMs: null, stale: false });
    });

    it('shows the embedding model and live chunks per model version, so a model change is visible', async () => {
        chunk({ sourceId: 'p1', embeddingModel: MODEL, embedding: [1, 0] });
        chunk({ sourceId: 'p2', embeddingModel: 'text-embedding-ada-002', embedding: [1, 0] });
        chunk({ sourceId: 'p3', embeddingModel: 'text-embedding-ada-002', embedding: [1, 0] });
        chunk({ sourceId: 'p4' });
        chunk({ sourceId: 'p5', embeddingModel: 'text-embedding-ada-002', deleted: true });

        const { embeddings: e } = await figures.workspaceFigures(C);

        expect(e.model).toBe(MODEL);
        expect(e.byModel).toEqual(expect.arrayContaining([
            { model: MODEL, chunks: 1, current: true },
            { model: 'text-embedding-ada-002', chunks: 2, current: false },
            { model: null, chunks: 1, current: false },
        ]));
        expect(e.byModel).toHaveLength(3);
        expect(e.pendingChunks).toBe(3);
    });

    it('reports the embedding spend of this month, the workspace budget, and the breaker', async () => {
        const month = new Date();
        db().seed(SCHEMA_TYPE.AI_USAGE, { companyId: C, feature: 'knowledge_embed', model: MODEL, costUsd: 0.25, totalTokens: 1000, billedToWorkspace: true, at: month });
        db().seed(SCHEMA_TYPE.AI_USAGE, { companyId: C, feature: 'ask', model: 'gpt', costUsd: 2, totalTokens: 10, billedToWorkspace: true, at: month });
        db().seed(SCHEMA_TYPE.AI_USAGE, { companyId: C, feature: 'knowledge_embed', costUsd: 9, totalTokens: 9, billedToWorkspace: true, at: new Date('2020-01-01T00:00:00Z') });

        const { embeddings: e } = await figures.workspaceFigures(C);

        expect(e.spend).toMatchObject({ usd: 0.25, calls: 1, tokens: 1000 });
        expect(e.budget).toEqual({ usedUsd: 2.25, budgetUsd: 25 });
        expect(e.breaker).toMatchObject({ open: false });
    });

    it('counts files left out by reason, with the retryable failures that ran out of attempts', async () => {
        const marker = (id, reason, extra = {}) => chunk({ sourceType: 'file', sourceId: `${TASK}:${id}`, ordinal: 0, deleted: true, text: '', tombstoneReason: reason, ...extra });
        marker('a1', 'skipped:too_large');
        marker('a2', 'skipped:too_large');
        marker('a3', 'skipped:unsupported');
        marker('a4', 'extract:failed', { extractAttempts: 3 });
        marker('a5', 'extract:failed', { extractAttempts: 1, extractDueAt: new Date(Date.now() + MINUTE) });
        marker('a6', 'extract:timed_out', { extractAttempts: 3 });
        marker('a7', 'task');
        marker('a8', '', { extractDueAt: new Date() });

        const { files } = await figures.workspaceFigures(C);

        expect(files.reasons).toEqual([
            { reason: 'extract:failed', count: 2, exhausted: 1, retryable: true },
            { reason: 'extract:timed_out', count: 1, exhausted: 1, retryable: true },
            { reason: 'skipped:too_large', count: 2, exhausted: 0, retryable: false },
            { reason: 'skipped:unsupported', count: 1, exhausted: 0, retryable: false },
        ]);
        expect(files.pending).toBe(2);
    });

    it('reads only the workspace it was asked about', async () => {
        chunk({ sourceId: 'mine' });
        state('page', { status: 'failed' }, OTHER);
        const result = await figures.workspaceFigures(C);
        expect(sourceFigures(result, 'page')).toMatchObject({ chunks: 1, backfill: { status: 'not_started' } });
        const read = db(OTHER).calls.filter((call) => call.type === CHUNKS || call.type === STATE);
        expect(read).toEqual([]);
    });
});

describe('re-indexing a source', () => {
    const buildPages = async (n) => {
        const pages = Array.from({ length: n }, (_, i) => seedPage({ title: `Harbour ${i}` }));
        await backfill.backfillSource(C, 'page');
        return pages;
    };

    it('walks every row again while the source stays complete, so its chunks stay readable', async () => {
        const pages = await buildPages(3);
        const before = chunks().filter((c) => c.deleted !== true).length;
        expect(await backfill.indexedSources(C, ['page'])).toEqual(['page']);

        const asked = await reindex.request(C, 'page', { requestedBy: ALICE });
        expect(asked).toMatchObject({ ok: true });
        expect(stateOf('page')).toMatchObject({ status: 'complete', reindexStatus: 'running', reindexCursor: '', reindexRequestedBy: ALICE });
        expect(await backfill.indexedSources(C, ['page'])).toEqual(['page']);

        await reindex.runSource(C, 'page', { batchSize: 1, maxBatches: 1 });
        expect(stateOf('page')).toMatchObject({ status: 'complete', reindexStatus: 'running', reindexCursor: String(pages[0]._id), reindexSynced: 1 });
        expect(await backfill.indexedSources(C, ['page'])).toEqual(['page']);
        expect(chunks().filter((c) => c.deleted !== true)).toHaveLength(before);

        await reindex.runSource(C, 'page', { batchSize: 1 });
        expect(stateOf('page')).toMatchObject({ status: 'complete', reindexStatus: 'complete', reindexCursor: '', reindexSynced: 3 });
        expect(stateOf('page').reindexFinishedAt).toBeInstanceOf(Date);
        expect(await backfill.indexedSources(C, ['page'])).toEqual(['page']);
    });

    it('brings back what the index lost, and drops what should have left it', async () => {
        const trashed = db().seed(SCHEMA_TYPE.PROJECTS, { ProjectName: 'Old', deletedStatusKey: 1 });
        const [kept, gone] = await buildPages(2);
        db().store[CHUNKS] = chunks().filter((c) => c.sourceId !== String(kept._id));
        db().store[SCHEMA_TYPE.PAGES].find((p) => p._id === gone._id).ProjectID = trashed._id;
        await reindex.request(C, 'page', {});
        await reindex.runSource(C, 'page');
        expect(liveOf(kept._id).length).toBeGreaterThan(0);
        expect(liveOf(gone._id)).toEqual([]);
    });

    it('refuses a second request while one runs, and a source whose own backfill is not settled', async () => {
        await buildPages(1);
        expect(await reindex.request(C, 'page', {})).toMatchObject({ ok: true });
        expect(await reindex.request(C, 'page', {})).toEqual({ ok: false, code: 'reindex_running' });
        expect(await reindex.request(C, 'comment', {})).toEqual({ ok: false, code: 'backfill_pending' });
        state('guide', { status: 'running' });
        expect(await reindex.request(C, 'guide', {})).toEqual({ ok: false, code: 'backfill_running' });
        state('transcript', { status: 'catching-up' });
        expect(await reindex.request(C, 'transcript', {})).toEqual({ ok: false, code: 'backfill_running' });
    });

    it('accepts a new request once the last one completed, and restarts from the first row', async () => {
        await buildPages(2);
        await reindex.request(C, 'page', {});
        await reindex.runSource(C, 'page');
        expect(await reindex.request(C, 'page', {})).toMatchObject({ ok: true });
        expect(stateOf('page')).toMatchObject({ reindexStatus: 'running', reindexCursor: '', reindexSynced: 0 });
    });

    it('keeps its place after a failure and carries on from there on the next run', async () => {
        const pages = await buildPages(2);
        await reindex.request(C, 'page', {});
        const indexer = require('../Modules/Knowledge/ingest/indexer');
        const spy = jest.spyOn(indexer, 'sync').mockRejectedValueOnce(new Error('storage down'));
        await reindex.runSource(C, 'page', { batchSize: 1 });
        expect(stateOf('page')).toMatchObject({ status: 'complete', reindexStatus: 'running', reindexCursor: '', reindexError: 'storage down' });
        spy.mockRestore();
        await reindex.runSource(C, 'page', { batchSize: 1 });
        expect(stateOf('page')).toMatchObject({ reindexStatus: 'complete', reindexSynced: pages.length, reindexError: '' });
    });

    it('is run by the recurring job for every switched-on workspace', async () => {
        await buildPages(1);
        await reindex.request(C, 'page', {});
        await reindex.runAll();
        expect(stateOf('page')).toMatchObject({ reindexStatus: 'complete' });
    });

    it('names the source types it can walk from the backfill, not from a list of its own', () => {
        expect(reindex.reindexable()).toEqual(Object.keys(backfill.CANDIDATES));
    });
});

describe('re-embedding', () => {
    it('refuses unless the workspace is in hybrid mode', async () => {
        expect(await controls.reembed(C)).toEqual({ ok: false, code: 'not_hybrid' });
    });

    it('refuses without an embedding key, and while the breaker is open', async () => {
        g().store.companies.find((row) => row._id === C).knowledgeRetrieval = { mode: 'hybrid' };
        const llm = require('../Modules/AICore/llmProvider');
        const configured = jest.spyOn(llm, 'isEmbeddingConfigured').mockReturnValue(false);
        expect(await controls.reembed(C)).toEqual({ ok: false, code: 'embedding_unconfigured' });
        configured.mockReturnValue(true);
        const breaker = jest.spyOn(embeddings, 'readiness').mockReturnValue('paused');
        expect(await controls.reembed(C)).toEqual({ ok: false, code: 'embedding_paused' });
        breaker.mockRestore();
        configured.mockRestore();
    });

    it('starts when hybrid and ready, counting the live chunks not on the current model', async () => {
        g().store.companies.find((row) => row._id === C).knowledgeRetrieval = { mode: 'hybrid' };
        chunk({ sourceId: 'p1', embeddingModel: 'text-embedding-ada-002' });
        chunk({ sourceId: 'p2', embeddingModel: MODEL });
        chunk({ sourceId: 'p3', deleted: true });
        const llm = require('../Modules/AICore/llmProvider');
        const configured = jest.spyOn(llm, 'isEmbeddingConfigured').mockReturnValue(true);
        const indexer = require('../Modules/Knowledge/ingest/indexer');
        let release;
        const sweep = jest.spyOn(indexer, 'reembedMissing').mockImplementation(() => new Promise((resolve) => { release = () => resolve(0); }));
        expect(await controls.reembed(C)).toEqual({ ok: true, pendingChunks: 1, model: MODEL });
        expect(await controls.reembed(C)).toEqual({ ok: false, code: 'reembed_running' });
        release();
        await controls.settled();
        expect(sweep).toHaveBeenCalledWith(C);
        sweep.mockRestore();
        configured.mockRestore();
    });
});

describe('retrying failed files', () => {
    it('resets the attempts of files that failed for a retryable reason only, and makes them due', async () => {
        const marker = (id, reason, extra = {}) => chunk({ sourceType: 'file', sourceId: `${TASK}:${id}`, ordinal: 0, deleted: true, text: '', tombstoneReason: reason, ...extra });
        marker('a1', 'extract:failed', { extractAttempts: 3 });
        marker('a2', 'extract:timed_out', { extractAttempts: 3 });
        marker('a3', 'extract:too_much_memory', { extractAttempts: 2 });
        marker('a4', 'skipped:too_large', { extractAttempts: 0 });
        marker('a5', 'skipped:unreadable');
        const indexer = require('../Modules/Knowledge/ingest/indexer');
        const resume = jest.spyOn(indexer, 'resumeFiles').mockResolvedValue(0);

        const result = await controls.retryFiles(C);

        expect(result).toEqual({ ok: true, reset: 3, byReason: { 'extract:failed': 1, 'extract:timed_out': 1, 'extract:too_much_memory': 1 } });
        const byId = (id) => chunks().find((c) => c.sourceId === `${TASK}:${id}`);
        ['a1', 'a2', 'a3'].forEach((id) => {
            expect(byId(id).extractAttempts).toBe(0);
            expect(byId(id).extractDueAt).toBeInstanceOf(Date);
        });
        expect(byId('a4').extractDueAt).toBeUndefined();
        expect(byId('a5').extractDueAt).toBeUndefined();
        await controls.settled();
        expect(resume).toHaveBeenCalledWith(C);
        resume.mockRestore();
    });
});

describe('erasure', () => {
    it('by document removes every chunk of that one source and records counts', async () => {
        chunk({ sourceId: 'p1', ordinal: 0 });
        chunk({ sourceId: 'p1', ordinal: 1, deleted: true });
        chunk({ sourceId: 'p2' });
        const result = await controls.eraseDocument(C, { sourceType: 'page', sourceId: 'p1' });
        expect(result).toMatchObject({ removed: { page: 2 }, total: 2 });
        expect(chunks().map((c) => c.sourceId)).toEqual(['p2']);
        expect(db().store[SCHEMA_TYPE.KNOWLEDGE_EXCLUSIONS]).toEqual([expect.objectContaining({ kind: 'document', sourceType: 'page', sourceId: 'p1' })]);
    });

    it('by document counts the agent notes formed from it under their own source type', async () => {
        chunk({ sourceId: 'p1' });
        chunk({ sourceType: 'memory', sourceId: 'n1', derivedFrom: ['page:p1'] });
        chunk({ sourceType: 'memory', sourceId: 'n2', derivedFrom: ['page:p2'] });
        const result = await controls.eraseDocument(C, { sourceType: 'page', sourceId: 'p1' });
        expect(result).toMatchObject({ removed: { page: 1, memory: 1 }, total: 2 });
        expect(chunks().map((c) => c.sourceId)).toEqual(['n2']);
    });

    it('by task removes the chunks of every comment and file under it', async () => {
        chunk({ sourceType: 'comment', sourceId: 'c1', taskId: TASK });
        chunk({ sourceType: 'file', sourceId: `${TASK}:a1`, taskId: TASK });
        chunk({ sourceType: 'file', sourceId: `${TASK}:a1`, taskId: TASK, ordinal: 1 });
        chunk({ sourceType: 'comment', sourceId: 'c2', taskId: 'another' });
        const result = await controls.eraseDocument(C, { sourceType: 'task', sourceId: TASK });
        expect(result).toMatchObject({ removed: { comment: 1, file: 2 }, total: 3 });
        expect(chunks().map((c) => c.sourceId)).toEqual(['c2']);
        expect(db().store[SCHEMA_TYPE.KNOWLEDGE_EXCLUSIONS].filter((e) => e.kind === 'document').map((e) => `${e.sourceType}:${e.sourceId}`).sort()).toEqual([`comment:c1`, `file:${TASK}:a1`]);
        expect(db().store[SCHEMA_TYPE.KNOWLEDGE_EXCLUSIONS]).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'task', sourceId: TASK })]));
    });

    it("by person removes their private pages and their comments, never their shared pages or transcripts (owner's rule)", async () => {
        chunk({ sourceId: 'private', createdBy: ALICE, visibility: 'private' });
        chunk({ sourceId: 'private', createdBy: ALICE, visibility: 'private', ordinal: 1 });
        chunk({ sourceId: 'shared', createdBy: ALICE, visibility: 'project' });
        chunk({ sourceType: 'comment', sourceId: 'c1', createdBy: ALICE });
        chunk({ sourceType: 'transcript', sourceId: 't1', createdBy: ALICE, visibility: 'participants' });
        chunk({ sourceId: 'bobs', createdBy: BOB, visibility: 'private' });

        const result = await controls.erasePerson(C, ALICE);

        expect(result).toMatchObject({ removed: { page: 2, comment: 1 }, total: 3 });
        expect(chunks().map((c) => c.sourceId).sort()).toEqual(['bobs', 'shared', 't1']);
    });

    it('offers the known source types and tasks as documents, and checks each id by its shape', () => {
        expect(controls.documentTypes()).toEqual([...require('../Modules/Knowledge/sources').INDEXED_SOURCES, 'task']);
        expect(controls.validDocumentId('page', PROJECT)).toBe(true);
        expect(controls.validDocumentId('page', 'nope')).toBe(false);
        expect(controls.validDocumentId('file', `${TASK}:a1`)).toBe(true);
        expect(controls.validDocumentId('file', PROJECT)).toBe(false);
        expect(controls.validDocumentId('task', TASK)).toBe(true);
        expect(controls.validDocumentId('nonsense', TASK)).toBe(false);
    });
});

describe('the recurring job', () => {
    it('runs the re-index walks after the backfill', async () => {
        const engine = require('../Modules/Automations/engine');
        const events = require('../Modules/Knowledge/ingest/events');
        const spies = [
            jest.spyOn(engine, 'defineRecurring').mockResolvedValue(undefined),
            jest.spyOn(events, 'start').mockReturnValue(true),
            jest.spyOn(backfill, 'backfillAll').mockResolvedValue({ companies: 0 }),
            jest.spyOn(reindex, 'runAll').mockResolvedValue(0),
        ];
        require('../Modules/Knowledge/init').init();
        const [, , job] = spies[0].mock.calls[0];
        await job();
        expect(spies[2]).toHaveBeenCalled();
        expect(spies[3]).toHaveBeenCalled();
        spies.forEach((spy) => spy.mockRestore());
    });
});

describe('erasing a task', () => {
    it('keeps comments and files added under the task later out of the index', async () => {
        db().seed(SCHEMA_TYPE.TASKS, { _id: TASK, ProjectID: PROJECT, deletedStatusKey: 0, attachments: [{ id: 'a2', url: 'https://drive.example.com/x', filename: 'x.pdf' }] });
        await controls.eraseDocument(C, { sourceType: 'task', sourceId: TASK });

        const comment = db().seed(SCHEMA_TYPE.COMMENTS, { message: 'A later note', type: 'text', taskId: TASK, projectId: PROJECT, userId: BOB, isDeleted: false, updatedAt: new Date() });
        const indexer = require('../Modules/Knowledge/ingest/indexer');
        await indexer.syncComment(C, String(comment._id));
        await indexer.syncFile(C, `${TASK}:a2`);

        expect(chunks().filter((c) => c.sourceId === String(comment._id))).toEqual([]);
        expect(chunks().filter((c) => c.sourceId === `${TASK}:a2`)).toEqual([]);
    });
});

describe('an erasure racing a sync', () => {
    it('landing between the sync reading the source and writing its chunks still leaves nothing behind', async () => {
        const erase = require('../Modules/Knowledge/ingest/erase');
        const indexer = require('../Modules/Knowledge/ingest/indexer');
        const page = seedPage();
        const real = db().crud.getMockImplementation();
        let fired = false;
        db().crud.mockImplementation(async (c, q, method) => {
            if (!fired && q.type === CHUNKS && method === 'updateOne' && q.data[2] && q.data[2].upsert) {
                fired = true;
                await erase.eraseDocument(C, { sourceType: 'page', sourceId: String(page._id) });
            }
            return real(c, q, method);
        });
        await indexer.syncPage(C, String(page._id));
        expect(fired).toBe(true);
        expect(chunks().filter((c) => c.sourceId === String(page._id))).toEqual([]);
    });
});

describe('who walks a re-index', () => {
    const indexer = require('../Modules/Knowledge/ingest/indexer');
    const ticks = async (check) => {
        for (let i = 0; i < 200 && !check(); i += 1) await new Promise((resolve) => setImmediate(resolve));
    };
    const buildPages = async (n) => {
        Array.from({ length: n }, (_, i) => seedPage({ title: `Harbour ${i}` }));
        await backfill.backfillSource(C, 'page');
    };
    const gated = () => {
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        const real = indexer.sync;
        const spy = jest.spyOn(indexer, 'sync').mockImplementation(async (...args) => {
            await gate;
            return real(...args);
        });
        return { spy, release: () => release() };
    };

    it('one server holds the walk under a lease while another passes it over', async () => {
        await buildPages(2);
        await reindex.request(C, 'page', {});
        const { spy, release } = gated();
        const first = reindex.runSource(C, 'page', { owner: 'server-a' });
        await ticks(() => spy.mock.calls.length > 0);
        expect(stateOf('page')).toMatchObject({ reindexOwner: 'server-a' });
        expect(stateOf('page').reindexLeaseUntil.getTime()).toBeGreaterThan(Date.now());

        expect(await reindex.runSource(C, 'page', { owner: 'server-b' })).toBeNull();
        expect(spy).toHaveBeenCalledTimes(1);

        release();
        await first;
        spy.mockRestore();
        expect(stateOf('page')).toMatchObject({ reindexStatus: 'complete', reindexSynced: 2, reindexOwner: '', reindexLeaseUntil: null });
    });

    it('takes over a walk whose lease ran out, and leaves one whose lease still holds', async () => {
        await buildPages(2);
        await reindex.request(C, 'page', {});
        stateOf('page').reindexOwner = 'gone';
        stateOf('page').reindexLeaseUntil = new Date(Date.now() + 60 * 1000);
        expect(await reindex.runSource(C, 'page', { owner: 'server-b' })).toBeNull();
        expect(stateOf('page')).toMatchObject({ reindexStatus: 'running', reindexOwner: 'gone' });

        stateOf('page').reindexLeaseUntil = new Date(Date.now() - 1000);
        await reindex.runSource(C, 'page', { owner: 'server-b' });
        expect(stateOf('page')).toMatchObject({ reindexStatus: 'complete', reindexSynced: 2 });
    });

    it('gives up a walk that keeps failing, so a new request is not refused for ever', async () => {
        await buildPages(1);
        await reindex.request(C, 'page', {});
        const spy = jest.spyOn(indexer, 'sync').mockRejectedValue(new Error('storage down'));
        for (let run = 1; run < reindex.MAX_FAILURES; run += 1) {
            await reindex.runSource(C, 'page');
            expect(stateOf('page')).toMatchObject({ reindexStatus: 'running', reindexFailures: run, reindexLeaseUntil: null });
        }
        await reindex.runSource(C, 'page');
        spy.mockRestore();
        expect(stateOf('page')).toMatchObject({ status: 'complete', reindexStatus: 'failed', reindexFailures: reindex.MAX_FAILURES });
        expect(await reindex.request(C, 'page', {})).toMatchObject({ ok: true });
        expect(stateOf('page')).toMatchObject({ reindexStatus: 'running', reindexFailures: 0 });
    });

    it('stops a walk that is cancelled while it runs', async () => {
        await buildPages(2);
        await reindex.request(C, 'page', {});
        const { spy, release } = gated();
        const walk = reindex.runSource(C, 'page', { owner: 'server-a', batchSize: 1 });
        await ticks(() => spy.mock.calls.length > 0);
        expect(await reindex.cancel(C, 'page')).toEqual({ ok: true });
        release();
        await walk;
        expect(spy).toHaveBeenCalledTimes(1);
        spy.mockRestore();
        expect(stateOf('page')).toMatchObject({ status: 'complete', reindexStatus: 'cancelled', reindexOwner: '' });
        expect(await reindex.cancel(C, 'page')).toEqual({ ok: false, code: 'reindex_not_running' });
    });
});

describe('a walk that loses its hold', () => {
    const indexer = require('../Modules/Knowledge/ingest/indexer');
    const buildPages = async (n) => {
        Array.from({ length: n }, (_, i) => seedPage({ title: `Harbour ${i}` }));
        await backfill.backfillSource(C, 'page');
    };

    it('stops, saving nothing, when another server has taken its lease', async () => {
        await buildPages(2);
        await reindex.request(C, 'page', {});
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        const real = indexer.sync;
        const spy = jest.spyOn(indexer, 'sync').mockImplementation(async (...args) => {
            await gate;
            return real(...args);
        });
        const walk = reindex.runSource(C, 'page', { owner: 'server-a' });
        for (let i = 0; i < 200 && !spy.mock.calls.length; i += 1) await new Promise((resolve) => setImmediate(resolve));
        stateOf('page').reindexOwner = 'server-b';
        release();
        await walk;
        spy.mockRestore();
        expect(stateOf('page')).toMatchObject({ reindexStatus: 'running', reindexOwner: 'server-b', reindexSynced: 0, reindexCursor: '' });
    });

    it('checks its lease at every batch, so a walk cancelled between batches syncs nothing more', async () => {
        await buildPages(3);
        await reindex.request(C, 'page', {});
        const real = db().crud.getMockImplementation();
        let cut = false;
        db().crud.mockImplementation(async (c, q, method) => {
            const out = await real(c, q, method);
            const set = q.type === STATE && method === 'findOneAndUpdate' && q.data[1] && q.data[1].$set;
            if (!cut && set && set.reindexCursor) {
                cut = true;
                stateOf('page').reindexStatus = 'cancelled';
            }
            return out;
        });
        const spy = jest.spyOn(indexer, 'sync');
        await reindex.runSource(C, 'page', { owner: 'server-a', batchSize: 1 });
        expect(spy).toHaveBeenCalledTimes(1);
        spy.mockRestore();
        expect(stateOf('page')).toMatchObject({ reindexStatus: 'cancelled', reindexSynced: 1 });
    });
});
