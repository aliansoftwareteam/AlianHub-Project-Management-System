const mockDbs = {};
const mockDbFor = (companyId) => {
    const id = String(companyId);
    if (!mockDbs[id]) mockDbs[id] = require('./fixtures/fakeMongo').create();
    return mockDbs[id];
};

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDbFor(companyId).crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => {
    const NodeCache = require('node-cache');
    return { myCache: new NodeCache() };
});
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/jwt', () => ({
    verifyJWTTokenV2: (req, res, next) => {
        const uid = req.headers['x-uid'];
        if (!uid) return res.status(401).send({ status: false, statusText: 'No session.' });
        req.uid = uid;
        if (req.headers['x-api-token']) req.apiToken = { id: req.headers['x-api-token'] };
        return next();
    },
}));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../common-storage/readStoredFile', () => ({ readStoredFile: jest.fn() }));
jest.mock('../Modules/Instance/controller', () => new Proxy({}, { get: () => (req, res) => res.status(200).json({ status: true, reached: true }) }));
jest.mock('../Modules/Agents/metricsController', () => ({ instanceMetrics: (req, res) => res.json({ status: true }) }));
jest.mock('../Modules/Agents/budget', () => ({ settings: jest.fn(async () => ({ monthlyBudgetUsd: 0 })) }));

const express = require('express');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { knowledgeIndexStateSchema } = require('../utils/mongo-handler/createSchema');
const { init } = require('../Modules/Instance/routes');
const reindex = require('../Modules/Knowledge/reindex');
const controls = require('../Modules/Knowledge/controls');
const indexer = require('../Modules/Knowledge/ingest/indexer');
const { ACTIONS, CODE } = require('../Modules/Instance/knowledge');

const GLOBAL = 'global';
const OWNER = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const MEMBER = '6f0000000000000000000003';
const ALICE = '6f0000000000000000000011';
const CID_A = '6f00000000000000000000a1';
const CID_B = '6f00000000000000000000b1';
const MISSING_CID = '6f00000000000000000000fe';
const PAGE = '6f0000000000000000000d01';
const TASK = '6f0000000000000000000b01';
const BASE = '/api/v2/instance/knowledge';
const KEY = 'instance-admin-key-for-tests';
const CHUNKS = SCHEMA_TYPE.KNOWLEDGE_CHUNKS;
const STATE = SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE;
const ENV_KEYS = ['KNOWLEDGE_INDEXER', 'KNOWLEDGE_RETRIEVAL', 'INSTANCE_ADMIN_KEY'];
const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

const g = () => mockDbFor(GLOBAL);
const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const chunksOf = (companyId) => mockDbFor(companyId).store[CHUNKS] || [];
const audits = (companyId) => (mockDbFor(companyId).store.audit_logs || []).filter((row) => String(row.action).startsWith('knowledge.'));
const stateOf = (companyId, sourceType) => (mockDbFor(companyId).store[STATE] || []).find((s) => s.sourceType === sourceType);

const seedPeople = () => {
    g().seed('users', { _id: OWNER, Employee_Name: 'Olivia Owner', isProductOwner: true });
    g().seed('users', { _id: ADMIN, Employee_Name: 'Ada Admin' });
    g().seed('users', { _id: MEMBER, Employee_Name: 'Max Member' });
    g().seed('company_users', { userId: ADMIN, companyId: CID_A, roleType: 2, status: 1 });
    g().seed('company_users', { userId: MEMBER, companyId: CID_A, roleType: 3, status: 1 });
};
const seedCompany = (id, name, over = {}) => g().seed('companies', { _id: id, Cst_CompanyName: name, createdAt: new Date(Date.now() - 1000), knowledgeIndexer: { mode: 'on' }, ...over });
const seedChunk = (companyId, over = {}) => mockDbFor(companyId).seed(CHUNKS, {
    companyId, sourceType: 'page', sourceId: PAGE, ordinal: 0, text: 'Hidden words', contentHash: 'h', createdBy: ALICE, visibility: 'project', deleted: false, ...over,
});
const seedState = (companyId, sourceType, over = {}) => mockDbFor(companyId).seed(STATE, { companyId, sourceType, status: 'complete', lastSeenOnAt: new Date(), originFilledAt: new Date(), ...over });

let server;
let baseURL;
let kick;

beforeAll(async () => {
    const app = express();
    app.use(express.json());
    init(app);
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    baseURL = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
    ENV_KEYS.forEach((key) => { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; });
    return new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });
});

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => delete mockDbs[key]);
    ENV_KEYS.forEach((key) => delete process.env[key]);
    process.env.KNOWLEDGE_INDEXER = 'tenant';
    myCache.flushAll();
    jest.clearAllMocks();
    kick = jest.spyOn(reindex, 'kick').mockImplementation(() => null);
    seedPeople();
    seedCompany(CID_A, 'Acme');
    seedCompany(CID_B, 'Bolt');
    mockDbFor(CID_A).uniqueFromSchema(STATE, knowledgeIndexStateSchema);
});

afterEach(() => { kick.mockRestore(); });

const call = async (method, path, { uid, body, apiToken, adminKey } = {}) => {
    const headers = { 'content-type': 'application/json' };
    if (uid) headers['x-uid'] = uid;
    if (apiToken) headers['x-api-token'] = apiToken;
    if (adminKey) headers.adminkey = adminKey;
    const res = await fetch(baseURL + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
};
const asOwner = (method, path, body) => call(method, path, { uid: OWNER, body });

const RUNS = [
    ['POST', `${BASE}/${CID_A}/reindex`, { sourceType: 'page' }],
    ['POST', `${BASE}/${CID_A}/reembed`, {}],
    ['POST', `${BASE}/${CID_A}/retry-files`, {}],
];
const ERASURES = [
    ['POST', `${BASE}/${CID_A}/erase/document`, { sourceType: 'page', sourceId: PAGE, confirm: PAGE }],
    ['POST', `${BASE}/${CID_A}/erase/person`, { userId: ALICE, confirm: ALICE }],
];
const WRITES = [...RUNS, ['POST', `${BASE}/${CID_A}/reindex/cancel`, { sourceType: 'page' }], ...ERASURES];
const ROUTES = [['GET', BASE, undefined], ['GET', `${BASE}/${CID_A}`, undefined], ...WRITES];

describe('who may open the knowledge console', () => {
    it.each(ROUTES)('refuses a member on %s %s', async (method, path, body) => {
        seedChunk(CID_A);
        expect((await call(method, path, { uid: MEMBER, body })).status).toBe(403);
        expect(chunksOf(CID_A)).toHaveLength(1);
    });

    it.each(ROUTES)('refuses a workspace admin on %s %s', async (method, path, body) => {
        seedChunk(CID_A);
        expect((await call(method, path, { uid: ADMIN, body })).status).toBe(403);
        expect(chunksOf(CID_A)).toHaveLength(1);
    });

    it.each(ROUTES)("refuses an API token, even the owner's, on %s %s", async (method, path, body) => {
        expect((await call(method, path, { uid: OWNER, apiToken: 'tok', body })).status).toBe(403);
    });

    it.each(ROUTES)('answers 401 without a session on %s %s', async (method, path, body) => {
        expect((await call(method, path, { body })).status).toBe(401);
    });

    it('lets the owner in', async () => {
        const res = await asOwner('GET', BASE);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(true);
    });

    it('lets the instance admin key in when one is configured, and names it on the audit row', async () => {
        process.env.INSTANCE_ADMIN_KEY = KEY;
        seedChunk(CID_A);
        const res = await call('POST', `${BASE}/${CID_A}/erase/document`, { adminKey: KEY, body: { sourceType: 'page', sourceId: PAGE, confirm: PAGE } });
        expect(res.status).toBe(200);
        await settle();
        expect(audits(CID_A)).toEqual([expect.objectContaining({ actorId: 'instance-admin-key', meta: expect.objectContaining({ via: 'admin_key' }) })]);
    });

    it('refuses a wrong admin key', async () => {
        process.env.INSTANCE_ADMIN_KEY = KEY;
        expect((await call('GET', BASE, { adminKey: 'wrong' })).status).toBe(401);
    });
});

describe('the summary', () => {
    it('lists workspaces a page at a time, newest first, with their modes and each source state', async () => {
        seedState(CID_A, 'page', { status: 'complete' });
        seedState(CID_A, 'file', { status: 'running', reindexStatus: '' });
        const res = await asOwner('GET', `${BASE}?pageSize=1&page=2`);
        expect(res.status).toBe(200);
        const { data } = res.body;
        expect(data).toMatchObject({ page: 2, pageSize: 1, total: 2, indexer: { mode: 'tenant', envKey: 'KNOWLEDGE_INDEXER' } });
        expect(data.workspaces).toHaveLength(1);
        expect(data.workspaces[0]).toMatchObject({ companyId: CID_A, name: 'Acme', modes: { indexer: 'on', retrieval: 'off' } });
        expect(data.workspaces[0].sources).toEqual(expect.arrayContaining([
            expect.objectContaining({ sourceType: 'page', backfill: 'complete', reindex: '' }),
            expect.objectContaining({ sourceType: 'file', backfill: 'running' }),
            expect.objectContaining({ sourceType: 'comment', backfill: 'not_started' }),
        ]));
        expect(data.reindexable).toEqual(reindex.reindexable());
        expect(data.documentTypes).toEqual(controls.documentTypes());
    });

    it.each([['0', 1], ['-3', 1], ['abc', 1], ['1e308', 2], ['99', 2]])('bounds page=%s to %s', async (raw, expected) => {
        const res = await asOwner('GET', `${BASE}?pageSize=1&page=${raw}`);
        expect(res.body.data.page).toBe(expected);
    });

    it.each([['1000', 100], ['0', 20], ['x', 20]])('bounds pageSize=%s to %s', async (raw, expected) => {
        const res = await asOwner('GET', `${BASE}?pageSize=${raw}`);
        expect(res.body.data.pageSize).toBe(expected);
    });

    it('still answers with the indexer off, saying so, so the tab can show it', async () => {
        delete process.env.KNOWLEDGE_INDEXER;
        const res = await asOwner('GET', BASE);
        expect(res.status).toBe(200);
        expect(res.body.data.indexer).toEqual({ mode: 'off', envKey: 'KNOWLEDGE_INDEXER' });
    });
});

describe('one workspace', () => {
    it('answers the figures of that workspace only', async () => {
        seedChunk(CID_A);
        seedChunk(CID_B);
        seedChunk(CID_B, { ordinal: 1 });
        const res = await asOwner('GET', `${BASE}/${CID_A}`);
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ companyId: CID_A, name: 'Acme', totals: { chunks: 1, sources: 1 } });
        expect(JSON.stringify(res.body)).not.toMatch(/Hidden words/);
    });

    it('refuses an id that is not a workspace id, and one that does not exist', async () => {
        expect((await asOwner('GET', `${BASE}/nope`)).body).toMatchObject({ status: false, code: CODE.INVALID_COMPANY_ID });
        const missing = await asOwner('GET', `${BASE}/${MISSING_CID}`);
        expect(missing.status).toBe(404);
        expect(missing.body.code).toBe(CODE.UNKNOWN_WORKSPACE);
    });
});

describe('with the indexer off', () => {
    beforeEach(() => { delete process.env.KNOWLEDGE_INDEXER; });

    it.each(RUNS)('refuses %s %s with indexer_off and changes nothing', async (method, path, body) => {
        seedChunk(CID_A);
        seedState(CID_A, 'page');
        const res = await asOwner(method, path, body);
        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ status: false, code: CODE.INDEXER_OFF });
        expect(chunksOf(CID_A)).toHaveLength(1);
        expect(stateOf(CID_A, 'page').reindexStatus).toBeUndefined();
        await settle();
        expect(audits(CID_A)).toEqual([]);
    });

    it.each(ERASURES)('still erases on %s %s, since what was indexed earlier must stay erasable', async (method, path, body) => {
        seedChunk(CID_A, { visibility: 'private' });
        const res = await asOwner(method, path, body);
        expect(res.status).toBe(200);
        expect(chunksOf(CID_A)).toEqual([]);
        await settle();
        expect(audits(CID_A)).toHaveLength(1);
    });
});

describe('with the indexer off for the workspace alone', () => {
    beforeEach(() => { g().store.companies.find((c) => c._id === CID_A).knowledgeIndexer = { mode: 'off' }; });

    it.each(RUNS)('refuses %s %s, which would run nothing there', async (method, path, body) => {
        seedState(CID_A, 'page');
        const res = await asOwner(method, path, body);
        expect(res.status).toBe(409);
        expect(res.body.code).toBe(CODE.WORKSPACE_INDEXER_OFF);
    });

    it('still erases, since what was indexed before stays until erased', async () => {
        seedChunk(CID_A);
        const res = await asOwner('POST', `${BASE}/${CID_A}/erase/document`, { sourceType: 'page', sourceId: PAGE, confirm: PAGE });
        expect(res.status).toBe(200);
        expect(chunksOf(CID_A)).toEqual([]);
    });
});

describe('re-index', () => {
    it('starts a walk of the source, audits it, and answers 409 to a second request while it runs', async () => {
        seedState(CID_A, 'page');
        const first = await asOwner('POST', `${BASE}/${CID_A}/reindex`, { sourceType: 'page' });
        expect(first.status).toBe(202);
        expect(stateOf(CID_A, 'page')).toMatchObject({ status: 'complete', reindexStatus: 'running', reindexRequestedBy: OWNER });
        expect(kick).toHaveBeenCalledWith(CID_A, 'page');

        const second = await asOwner('POST', `${BASE}/${CID_A}/reindex`, { sourceType: 'page' });
        expect(second.status).toBe(409);
        expect(second.body.code).toBe(CODE.REINDEX_RUNNING);
        await settle();
        expect(audits(CID_A)).toEqual([expect.objectContaining({ action: ACTIONS.REINDEX, actorId: OWNER, actorName: 'Olivia Owner', entityId: 'page' })]);
    });

    it('lets another source of the same workspace, and the same source of another workspace, start meanwhile', async () => {
        seedState(CID_A, 'page');
        seedState(CID_A, 'comment');
        seedState(CID_B, 'page');
        expect((await asOwner('POST', `${BASE}/${CID_A}/reindex`, { sourceType: 'page' })).status).toBe(202);
        expect((await asOwner('POST', `${BASE}/${CID_A}/reindex`, { sourceType: 'comment' })).status).toBe(202);
        expect((await asOwner('POST', `${BASE}/${CID_B}/reindex`, { sourceType: 'page' })).status).toBe(202);
    });

    it.each([[{ sourceType: 'pages' }], [{ sourceType: '' }], [{}], [{ sourceType: ['page'] }], [{ sourceType: 'task' }]])('refuses an unknown source type %j', async (body) => {
        const res = await asOwner('POST', `${BASE}/${CID_A}/reindex`, body);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe(CODE.INVALID_SOURCE_TYPE);
    });

    it('says when the source has no backfill yet or one is running', async () => {
        seedState(CID_A, 'comment', { status: 'running' });
        expect((await asOwner('POST', `${BASE}/${CID_A}/reindex`, { sourceType: 'page' })).body.code).toBe(CODE.BACKFILL_PENDING);
        expect((await asOwner('POST', `${BASE}/${CID_A}/reindex`, { sourceType: 'comment' })).body.code).toBe(CODE.BACKFILL_RUNNING);
    });
});

describe('re-embed', () => {
    it('refuses unless the workspace is hybrid', async () => {
        const res = await asOwner('POST', `${BASE}/${CID_A}/reembed`, {});
        expect(res.status).toBe(409);
        expect(res.body.code).toBe(CODE.NOT_HYBRID);
    });

    it('starts when hybrid and ready, and audits the chunks it has to embed', async () => {
        process.env.KNOWLEDGE_RETRIEVAL = 'tenant';
        g().store.companies.find((c) => c._id === CID_A).knowledgeRetrieval = { mode: 'hybrid' };
        seedChunk(CID_A, { embeddingModel: 'old-model' });
        const llm = require('../Modules/AICore/llmProvider');
        const configured = jest.spyOn(llm, 'isEmbeddingConfigured').mockReturnValue(true);
        const sweep = jest.spyOn(indexer, 'reembedMissing').mockResolvedValue(0);
        const res = await asOwner('POST', `${BASE}/${CID_A}/reembed`, {});
        expect(res.status).toBe(202);
        expect(res.body.data).toMatchObject({ pendingChunks: 1 });
        await controls.settled();
        await settle();
        expect(audits(CID_A)).toEqual([expect.objectContaining({ action: ACTIONS.REEMBED, actorId: OWNER, meta: expect.objectContaining({ pendingChunks: 1 }) })]);
        sweep.mockRestore();
        configured.mockRestore();
    });
});

describe('retry failed files', () => {
    it('resets the retryable failures and audits the counts by reason', async () => {
        const resume = jest.spyOn(indexer, 'resumeFiles').mockResolvedValue(0);
        seedChunk(CID_A, { sourceType: 'file', sourceId: `${TASK}:a1`, deleted: true, text: '', tombstoneReason: 'extract:failed', extractAttempts: 3 });
        seedChunk(CID_A, { sourceType: 'file', sourceId: `${TASK}:a2`, deleted: true, text: '', tombstoneReason: 'skipped:too_large' });
        const res = await asOwner('POST', `${BASE}/${CID_A}/retry-files`, {});
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ reset: 1, byReason: { 'extract:failed': 1 } });
        await controls.settled();
        await settle();
        expect(audits(CID_A)).toEqual([expect.objectContaining({ action: ACTIONS.RETRY_FILES, actorId: OWNER, meta: expect.objectContaining({ reset: 1 }) })]);
        resume.mockRestore();
    });
});

describe('erasure', () => {
    it('by document needs the document id typed back, then removes it and audits counts, never text', async () => {
        seedChunk(CID_A, { ordinal: 0 });
        seedChunk(CID_A, { ordinal: 1 });
        seedChunk(CID_B);

        const unconfirmed = await asOwner('POST', `${BASE}/${CID_A}/erase/document`, { sourceType: 'page', sourceId: PAGE });
        expect(unconfirmed.status).toBe(400);
        expect(unconfirmed.body.code).toBe(CODE.CONFIRMATION_MISMATCH);
        const wrong = await asOwner('POST', `${BASE}/${CID_A}/erase/document`, { sourceType: 'page', sourceId: PAGE, confirm: `${PAGE} ` });
        expect(wrong.body.code).toBe(CODE.CONFIRMATION_MISMATCH);
        expect(chunksOf(CID_A)).toHaveLength(2);

        const res = await asOwner('POST', `${BASE}/${CID_A}/erase/document`, { sourceType: 'page', sourceId: PAGE, confirm: PAGE });
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ removed: { page: 2 }, total: 2 });
        expect(chunksOf(CID_A)).toEqual([]);
        expect(chunksOf(CID_B)).toHaveLength(1);
        await settle();
        const rows = audits(CID_A);
        expect(rows).toEqual([expect.objectContaining({
            action: ACTIONS.ERASE_DOCUMENT, actorId: OWNER, actorName: 'Olivia Owner', entityType: 'page', entityId: PAGE, meta: { sourceType: 'page', removed: { page: 2 }, total: 2 },
        })]);
        expect(JSON.stringify(rows)).not.toMatch(/Hidden words/);
        expect(audits(CID_B)).toEqual([]);
    });

    it('by person needs the person\'s id typed back, and follows the owner\'s rule', async () => {
        seedChunk(CID_A, { sourceId: 'private', visibility: 'private' });
        seedChunk(CID_A, { sourceId: 'shared' });
        seedChunk(CID_A, { sourceType: 'comment', sourceId: 'c1' });
        seedChunk(CID_A, { sourceType: 'transcript', sourceId: 't1', visibility: 'participants' });

        const wrong = await asOwner('POST', `${BASE}/${CID_A}/erase/person`, { userId: ALICE, confirm: 'Acme' });
        expect(wrong.status).toBe(400);
        expect(wrong.body.code).toBe(CODE.CONFIRMATION_MISMATCH);
        expect(chunksOf(CID_A)).toHaveLength(4);

        const res = await asOwner('POST', `${BASE}/${CID_A}/erase/person`, { userId: ALICE, confirm: ALICE });
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ removed: { page: 1, comment: 1 }, total: 2 });
        expect(chunksOf(CID_A).map((c) => c.sourceId).sort()).toEqual(['shared', 't1']);
        await settle();
        expect(audits(CID_A)).toEqual([expect.objectContaining({
            action: ACTIONS.ERASE_PERSON, actorId: OWNER, entityType: 'user', entityId: ALICE, meta: { removed: { page: 1, comment: 1 }, total: 2 },
        })]);
    });

    it("by person leaves the app's own audit rows as they are (owner's rule)", async () => {
        seedChunk(CID_A, { sourceId: 'private', visibility: 'private' });
        const own = mockDbFor(CID_A).seed('audit_logs', { actorId: ALICE, actorName: 'Alice Doe', action: 'member.update', entityType: 'member', entityId: MEMBER, entityName: 'Max Member', meta: {}, ip: '10.0.0.7', createdAt: new Date() });
        const before = { ...own };

        const res = await asOwner('POST', `${BASE}/${CID_A}/erase/person`, { userId: ALICE, confirm: ALICE });

        expect(res.status).toBe(200);
        expect(own).toEqual(before);
        expect((mockDbFor(CID_A).store.audit_logs || []).map((row) => row.action).filter((a) => !a.startsWith('knowledge.') && a !== 'member.update')).toEqual([]);
        expect(mockDbFor(CID_A).store.audit_redactions).toBeUndefined();
    });

    it.each([
        [{ sourceType: 'pages', sourceId: PAGE, confirm: PAGE }, 'INVALID_SOURCE_TYPE'],
        [{ sourceType: 'page', sourceId: 'not-an-id', confirm: 'not-an-id' }, 'INVALID_DOCUMENT_ID'],
        [{ sourceType: 'file', sourceId: PAGE, confirm: PAGE }, 'INVALID_DOCUMENT_ID'],
        [{ sourceType: 'page', sourceId: { $ne: '' }, confirm: PAGE }, 'INVALID_DOCUMENT_ID'],
    ])('refuses a document named badly: %j', async (body, code) => {
        seedChunk(CID_A);
        const res = await asOwner('POST', `${BASE}/${CID_A}/erase/document`, body);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe(CODE[code]);
        expect(chunksOf(CID_A)).toHaveLength(1);
    });

    it.each([['nope'], [''], [{ $ne: '' }]])('refuses a person id that is not an id: %j', async (userId) => {
        seedChunk(CID_A, { visibility: 'private' });
        const res = await asOwner('POST', `${BASE}/${CID_A}/erase/person`, { userId, confirm: userId });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe(CODE.INVALID_USER_ID);
        expect(chunksOf(CID_A)).toHaveLength(1);
    });

    it('refuses a workspace that does not exist', async () => {
        const res = await asOwner('POST', `${BASE}/${MISSING_CID}/erase/person`, { userId: ALICE, confirm: ALICE });
        expect(res.status).toBe(404);
        expect(res.body.code).toBe(CODE.UNKNOWN_WORKSPACE);
    });
});

describe('ids in another case', () => {
    const UPPER_A = CID_A.toUpperCase();

    it('reads and changes the real workspace when its id comes in capitals', async () => {
        seedChunk(CID_A);
        const res = await asOwner('GET', `${BASE}/${UPPER_A}`);
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ companyId: CID_A, totals: { chunks: 1 } });
        const erased = await asOwner('POST', `${BASE}/${UPPER_A}/erase/document`, { sourceType: 'page', sourceId: PAGE, confirm: PAGE });
        expect(erased.body.data).toEqual({ removed: { page: 1 }, total: 1 });
        expect(chunksOf(CID_A)).toEqual([]);
        await settle();
        expect(audits(CID_A)).toHaveLength(1);
        expect(Object.keys(mockDbs)).not.toContain(UPPER_A);
    });

    it('erases a document named in capitals, and keeps it out under the id the indexer checks', async () => {
        seedChunk(CID_A);
        seedChunk(CID_A, { ordinal: 1 });
        const res = await asOwner('POST', `${BASE}/${CID_A}/erase/document`, { sourceType: 'page', sourceId: PAGE.toUpperCase(), confirm: PAGE.toUpperCase() });
        expect(res.body.data).toEqual({ removed: { page: 2 }, total: 2 });
        expect(chunksOf(CID_A)).toEqual([]);
        expect(mockDbFor(CID_A).store[SCHEMA_TYPE.KNOWLEDGE_EXCLUSIONS]).toEqual([expect.objectContaining({ sourceType: 'page', sourceId: PAGE })]);
    });

    it('erases a file whose task id comes in capitals, keeping the attachment id as it is', async () => {
        seedChunk(CID_A, { sourceType: 'file', sourceId: `${TASK}:aB1`, taskId: TASK });
        const id = `${TASK.toUpperCase()}:aB1`;
        const res = await asOwner('POST', `${BASE}/${CID_A}/erase/document`, { sourceType: 'file', sourceId: id, confirm: id });
        expect(res.body.data).toEqual({ removed: { file: 1 }, total: 1 });
    });

    it('erases a person named in capitals, with the confirmation in either case', async () => {
        seedChunk(CID_A, { visibility: 'private' });
        const res = await asOwner('POST', `${BASE}/${CID_A}/erase/person`, { userId: ALICE.toUpperCase(), confirm: ALICE });
        expect(res.body.data).toEqual({ removed: { page: 1 }, total: 1 });
        expect(mockDbFor(CID_A).store[SCHEMA_TYPE.KNOWLEDGE_EXCLUSIONS]).toEqual([expect.objectContaining({ kind: 'author', userId: ALICE })]);
    });
});

describe('an erasure that matches nothing', () => {
    it('says so with its own code, still records the exclusion, and is audited', async () => {
        mockDbFor(CID_A).seed(SCHEMA_TYPE.PAGES, { _id: PAGE, title: 'Not indexed yet' });
        const res = await asOwner('POST', `${BASE}/${CID_A}/erase/document`, { sourceType: 'page', sourceId: PAGE, confirm: PAGE });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ code: CODE.NOTHING_ERASED, data: { removed: {}, total: 0 } });
        expect(mockDbFor(CID_A).store[SCHEMA_TYPE.KNOWLEDGE_EXCLUSIONS]).toHaveLength(1);
        await settle();
        expect(audits(CID_A)).toEqual([expect.objectContaining({ action: ACTIONS.ERASE_DOCUMENT, meta: expect.objectContaining({ total: 0 }) })]);
    });
});

describe('an erasure that fails partway', () => {
    const failChunkDeletes = (companyId, { after = 0 } = {}) => {
        const db = mockDbFor(companyId);
        const real = db.crud.getMockImplementation();
        let seen = 0;
        db.crud.mockImplementation((c, q, method) => {
            if (method === 'deleteMany' && q.type === CHUNKS) {
                seen += 1;
                if (seen > after) return Promise.reject(new Error('disk gone'));
            }
            return real(c, q, method);
        });
    };

    it('after the exclusion is written: answers 500 and audits a partial row with what it reached', async () => {
        seedChunk(CID_A);
        failChunkDeletes(CID_A);
        const res = await asOwner('POST', `${BASE}/${CID_A}/erase/document`, { sourceType: 'page', sourceId: PAGE, confirm: PAGE });
        expect(res.status).toBe(500);
        expect(res.body.code).toBe(CODE.SERVER_ERROR);
        expect(mockDbFor(CID_A).store[SCHEMA_TYPE.KNOWLEDGE_EXCLUSIONS]).toHaveLength(1);
        await settle();
        expect(audits(CID_A)).toEqual([expect.objectContaining({
            action: ACTIONS.ERASE_DOCUMENT, actorId: OWNER, meta: { sourceType: 'page', removed: {}, total: 0, partial: true, error: CODE.SERVER_ERROR },
        })]);
    });

    it('partway through a task: audits the sources already removed', async () => {
        seedChunk(CID_A, { sourceType: 'comment', sourceId: 'c1', taskId: TASK });
        seedChunk(CID_A, { sourceType: 'file', sourceId: `${TASK}:a1`, taskId: TASK });
        failChunkDeletes(CID_A, { after: 1 });
        const res = await asOwner('POST', `${BASE}/${CID_A}/erase/document`, { sourceType: 'task', sourceId: TASK, confirm: TASK });
        expect(res.status).toBe(500);
        await settle();
        const [row] = audits(CID_A);
        expect(row.meta).toMatchObject({ partial: true, error: CODE.SERVER_ERROR, total: 1 });
        expect(Object.values(row.meta.removed)).toEqual([1]);
    });

    it('by person: audits a partial row', async () => {
        seedChunk(CID_A, { visibility: 'private' });
        failChunkDeletes(CID_A);
        const res = await asOwner('POST', `${BASE}/${CID_A}/erase/person`, { userId: ALICE, confirm: ALICE });
        expect(res.status).toBe(500);
        await settle();
        expect(audits(CID_A)).toEqual([expect.objectContaining({ action: ACTIONS.ERASE_PERSON, meta: expect.objectContaining({ partial: true, total: 0 }) })]);
    });
});

describe('cancelling a re-index', () => {
    it('stops a running walk, audits it, and lets a new one start', async () => {
        seedState(CID_A, 'page');
        await asOwner('POST', `${BASE}/${CID_A}/reindex`, { sourceType: 'page' });
        const res = await asOwner('POST', `${BASE}/${CID_A}/reindex/cancel`, { sourceType: 'page' });
        expect(res.status).toBe(200);
        expect(stateOf(CID_A, 'page')).toMatchObject({ status: 'complete', reindexStatus: 'cancelled' });
        await settle();
        expect(audits(CID_A).map((row) => row.action)).toEqual([ACTIONS.REINDEX, ACTIONS.REINDEX_CANCEL]);
        expect((await asOwner('POST', `${BASE}/${CID_A}/reindex`, { sourceType: 'page' })).status).toBe(202);
    });

    it('answers 409 when nothing runs, and 400 to an unknown source type', async () => {
        seedState(CID_A, 'page');
        const none = await asOwner('POST', `${BASE}/${CID_A}/reindex/cancel`, { sourceType: 'page' });
        expect(none.status).toBe(409);
        expect(none.body.code).toBe(CODE.REINDEX_NOT_RUNNING);
        expect((await asOwner('POST', `${BASE}/${CID_A}/reindex/cancel`, { sourceType: 'nope' })).body.code).toBe(CODE.INVALID_SOURCE_TYPE);
    });
});

describe('the cost of the figures', () => {
    const aggregates = () => mockDbFor(CID_A).calls.filter((c) => c.method === 'aggregate' && c.type === CHUNKS);

    it('are cached per workspace for a short time, and read again on refresh or after a control', async () => {
        seedChunk(CID_A);
        await asOwner('GET', `${BASE}/${CID_A}`);
        const second = await asOwner('GET', `${BASE}/${CID_A}`);
        expect(aggregates()).toHaveLength(1);
        expect(second.body.data.cachedAt).toEqual(expect.any(String));
        await asOwner('GET', `${BASE}/${CID_A}?refresh=1`);
        expect(aggregates()).toHaveLength(2);
        await asOwner('POST', `${BASE}/${CID_A}/erase/document`, { sourceType: 'page', sourceId: PAGE, confirm: PAGE });
        const after = await asOwner('GET', `${BASE}/${CID_A}`);
        expect(after.body.data.totals.chunks).toBe(0);
    });

    it('run under a time limit, overridable by the environment', async () => {
        await asOwner('GET', `${BASE}/${CID_A}?refresh=1`);
        expect(aggregates().at(-1).data[1]).toEqual({ maxTimeMS: 10000 });
        process.env.KNOWLEDGE_FIGURES_MAX_TIME_MS = '2500';
        try {
            await asOwner('GET', `${BASE}/${CID_A}?refresh=1`);
            expect(aggregates().at(-1).data[1]).toEqual({ maxTimeMS: 2500 });
        } finally {
            delete process.env.KNOWLEDGE_FIGURES_MAX_TIME_MS;
        }
    });

    it('answer figures_timed_out when the database gives up', async () => {
        const db = mockDbFor(CID_A);
        const real = db.crud.getMockImplementation();
        db.crud.mockImplementation((c, q, method) => (method === 'aggregate' && q.type === CHUNKS
            ? Promise.reject(Object.assign(new Error('operation exceeded time limit'), { code: 50, codeName: 'MaxTimeMSExpired' }))
            : real(c, q, method)));
        const res = await asOwner('GET', `${BASE}/${CID_A}`);
        expect(res.status).toBe(503);
        expect(res.body.code).toBe(CODE.FIGURES_TIMED_OUT);
    });

    it('start from an indexed match and never bring whole rows or vectors into the pipeline', async () => {
        seedChunk(CID_A, { embedding: [1, 2, 3], embeddingModel: 'm' });
        await asOwner('GET', `${BASE}/${CID_A}`);
        const [pipeline] = aggregates().at(-1).data;
        expect(Object.keys(pipeline[0])).toEqual(['$match']);
        expect(pipeline[0].$match).toEqual({ sourceType: { $in: expect.arrayContaining(['page']) } });
        expect(JSON.stringify(pipeline)).not.toMatch(/\$\$ROOT|\$bsonSize|"embedding"|"\$embedding"/);
    });
});

const EXCLUSIONS_PATH = `${BASE}/${CID_A}/exclusions`;

describe('an erasure naming nothing that exists', () => {
    it('answers not_found, audits it, and records no exclusion', async () => {
        const res = await asOwner('POST', `${BASE}/${CID_A}/erase/document`, { sourceType: 'page', sourceId: PAGE, confirm: PAGE });
        expect(res.status).toBe(404);
        expect(res.body.code).toBe(CODE.NOT_FOUND);
        expect(mockDbFor(CID_A).store[SCHEMA_TYPE.KNOWLEDGE_EXCLUSIONS] || []).toEqual([]);
        await settle();
        expect(audits(CID_A)).toEqual([expect.objectContaining({ action: ACTIONS.ERASE_DOCUMENT, entityId: PAGE, meta: expect.objectContaining({ notFound: true, total: 0 }) })]);
    });

    it.each([
        ['task', TASK],
        ['comment', '6f0000000000000000000e01'],
        ['file', `${TASK}:a1`],
        ['guide', '6f0000000000000000000a09'],
        ['transcript', '6f0000000000000000000f01'],
    ])('answers not_found for a %s that is nowhere', async (sourceType, sourceId) => {
        const res = await asOwner('POST', `${BASE}/${CID_A}/erase/document`, { sourceType, sourceId, confirm: sourceId });
        expect(res.body.code).toBe(CODE.NOT_FOUND);
        expect(mockDbFor(CID_A).store[SCHEMA_TYPE.KNOWLEDGE_EXCLUSIONS] || []).toEqual([]);
    });

    it('answers not_found for a person who never held a seat here and wrote nothing indexed', async () => {
        const res = await asOwner('POST', `${BASE}/${CID_A}/erase/person`, { userId: ALICE, confirm: ALICE });
        expect(res.status).toBe(404);
        expect(res.body.code).toBe(CODE.NOT_FOUND);
        expect(mockDbFor(CID_A).store[SCHEMA_TYPE.KNOWLEDGE_EXCLUSIONS] || []).toEqual([]);
    });

    it('erases a person who holds or held a seat here even with nothing indexed, recording the exclusion', async () => {
        g().seed('company_users', { userId: ALICE, companyId: CID_A, roleType: 3, status: 2 });
        const res = await asOwner('POST', `${BASE}/${CID_A}/erase/person`, { userId: ALICE, confirm: ALICE });
        expect(res.body.code).toBe(CODE.NOTHING_ERASED);
        expect(mockDbFor(CID_A).store[SCHEMA_TYPE.KNOWLEDGE_EXCLUSIONS]).toHaveLength(1);
    });

    it.each([
        ['task', TASK, SCHEMA_TYPE.TASKS, { _id: TASK }],
        ['page', PAGE, SCHEMA_TYPE.PAGES, { _id: PAGE }],
        ['file', `${TASK}:a1`, SCHEMA_TYPE.TASKS, { _id: TASK, attachments: [{ id: 'a1' }] }],
    ])('takes a %s whose row exists as existing, even with no chunks', async (sourceType, sourceId, type, row) => {
        mockDbFor(CID_A).seed(type, row);
        const res = await asOwner('POST', `${BASE}/${CID_A}/erase/document`, { sourceType, sourceId, confirm: sourceId });
        expect(res.body.code).toBe(CODE.NOTHING_ERASED);
    });

    it('does not take a file as existing when its task has no such attachment', async () => {
        mockDbFor(CID_A).seed(SCHEMA_TYPE.TASKS, { _id: TASK, attachments: [{ id: 'other' }] });
        const res = await asOwner('POST', `${BASE}/${CID_A}/erase/document`, { sourceType: 'file', sourceId: `${TASK}:a1`, confirm: `${TASK}:a1` });
        expect(res.body.code).toBe(CODE.NOT_FOUND);
    });
});

describe('an erasure whose first write fails', () => {
    it('is audited as failed, not partial', async () => {
        seedChunk(CID_A);
        const db = mockDbFor(CID_A);
        const real = db.crud.getMockImplementation();
        db.crud.mockImplementation((c, q, method) => (method === 'updateOne' && q.type === SCHEMA_TYPE.KNOWLEDGE_EXCLUSIONS
            ? Promise.reject(new Error('disk gone'))
            : real(c, q, method)));
        const res = await asOwner('POST', `${BASE}/${CID_A}/erase/document`, { sourceType: 'page', sourceId: PAGE, confirm: PAGE });
        expect(res.status).toBe(500);
        await settle();
        const [row] = audits(CID_A);
        expect(row.meta).toEqual({ sourceType: 'page', removed: {}, total: 0, failed: true, error: CODE.SERVER_ERROR });
    });
});

describe('the task erasure query', () => {
    it('names the source types, so the index on source type and task is used', async () => {
        seedChunk(CID_A, { sourceType: 'comment', sourceId: 'c1', taskId: TASK });
        await asOwner('POST', `${BASE}/${CID_A}/erase/document`, { sourceType: 'task', sourceId: TASK, confirm: TASK });
        const reads = mockDbFor(CID_A).calls.filter((c) => c.type === CHUNKS && c.method === 'find' && c.data[0] && c.data[0].taskId === TASK);
        expect(reads.length).toBeGreaterThan(0);
        reads.forEach((c) => expect(c.data[0].sourceType).toEqual({ $in: expect.arrayContaining(['comment', 'file']) }));
    });
});

describe('exclusions', () => {
    const EXCLUSIONS = `${BASE}/${CID_A}/exclusions`;
    const stored = () => mockDbFor(CID_A).store[SCHEMA_TYPE.KNOWLEDGE_EXCLUSIONS] || [];

    it('are listed with kind, ids, when, who and the chunks kept out, never text', async () => {
        seedChunk(CID_A, { ordinal: 0 });
        seedChunk(CID_A, { ordinal: 1 });
        await asOwner('POST', `${BASE}/${CID_A}/erase/document`, { sourceType: 'page', sourceId: PAGE, confirm: PAGE });
        seedChunk(CID_A, { sourceType: 'comment', sourceId: 'c9', visibility: 'project' });
        await asOwner('POST', `${BASE}/${CID_A}/erase/person`, { userId: ALICE, confirm: ALICE });

        const res = await asOwner('GET', EXCLUSIONS);
        expect(res.status).toBe(200);
        expect(res.body.data.total).toBe(2);
        expect(res.body.data.exclusions).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: 'document', sourceType: 'page', sourceId: PAGE, erasedBy: OWNER, erasedByName: 'Olivia Owner', erasedChunks: 2, erasedAt: expect.any(String), id: expect.any(String) }),
            expect.objectContaining({ kind: 'author', userId: ALICE, erasedChunks: 1 }),
        ]));
        expect(JSON.stringify(res.body)).not.toMatch(/Hidden words/);
    });

    it('can be removed with the id typed back, audited, so a wrong one is undone', async () => {
        seedChunk(CID_A);
        await asOwner('POST', `${BASE}/${CID_A}/erase/document`, { sourceType: 'page', sourceId: PAGE, confirm: PAGE });
        const [exclusion] = stored();
        const id = String(exclusion._id);

        const wrong = await asOwner('POST', `${EXCLUSIONS}/${id}/remove`, { confirm: 'nope' });
        expect(wrong.status).toBe(400);
        expect(wrong.body.code).toBe(CODE.CONFIRMATION_MISMATCH);
        expect(stored()).toHaveLength(1);

        const res = await asOwner('POST', `${EXCLUSIONS}/${id}/remove`, { confirm: PAGE.toUpperCase() });
        expect(res.status).toBe(200);
        expect(stored()).toEqual([]);
        await settle();
        expect(audits(CID_A).map((row) => row.action)).toEqual([ACTIONS.ERASE_DOCUMENT, ACTIONS.EXCLUSION_REMOVE]);
        expect(audits(CID_A)[1]).toMatchObject({ actorId: OWNER, entityId: id, meta: { kind: 'document', sourceType: 'page', sourceId: PAGE } });
    });

    it('refuses an id that is not one, and one that is not there', async () => {
        expect((await asOwner('POST', `${EXCLUSIONS}/nope/remove`, { confirm: 'x' })).body.code).toBe(CODE.INVALID_EXCLUSION_ID);
        const missing = await asOwner('POST', `${EXCLUSIONS}/${MISSING_CID}/remove`, { confirm: 'x' });
        expect(missing.status).toBe(404);
        expect(missing.body.code).toBe(CODE.NOT_FOUND);
    });

    it.each([['GET', EXCLUSIONS_PATH, undefined], ['POST', `${EXCLUSIONS_PATH}/${MISSING_CID}/remove`, { confirm: 'x' }]])('refuse a member on %s %s', async (method, path, body) => {
        expect((await call(method, path, { uid: MEMBER, body })).status).toBe(403);
        expect((await call(method, path, { uid: ADMIN, body })).status).toBe(403);
        expect((await call(method, path, { uid: OWNER, apiToken: 't', body })).status).toBe(403);
    });
});
