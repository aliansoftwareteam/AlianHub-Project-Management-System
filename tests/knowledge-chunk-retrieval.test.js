const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(), visibleProjects: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(), isPrivileged: (roleType) => roleType === 1 || roleType === 2 }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const { getRoleType } = require('../Config/permissionGuard');
const { knowledgeChunksSchema } = require('../utils/mongo-handler/createSchema');
const { pageVisibilityFilter } = require('../Modules/Pages/helpers/pageRules');
const lexical = require('../Modules/Knowledge/adapters/lexical');
const { retrieve } = require('../Modules/Knowledge/retrieval');
const { resolveVisibleSet, filterFor } = require('../Modules/Knowledge/visibleSet');
const indexer = require('../Modules/Knowledge/ingest/indexer');

const C = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000011';
const COLLEAGUE = '6f0000000000000000000012';
const OUTSIDER = '6f0000000000000000000013';
const SHARED = '6f0000000000000000000a01';
const SECRET = '6f0000000000000000000a02';
const ENV = { indexer: process.env.KNOWLEDGE_INDEXER };

const ROLES = { [OWNER]: 3, [COLLEAGUE]: 3, [OUTSIDER]: 3 };
const PROJECTS = { [OWNER]: [SHARED, SECRET], [COLLEAGUE]: [SHARED], [OUTSIDER]: [] };

const CHUNKS = SCHEMA_TYPE.KNOWLEDGE_CHUNKS;
const callsFor = (type) => mockDb.calls.filter((c) => c.type === type);
const chunkSearches = () => callsFor(CHUNKS).filter((c) => c.method === 'aggregate' && c.data[0][0].$match && c.data[0][0].$match.$text);
const textPaths = (node, path = []) => {
    if (!node || typeof node !== 'object') return [];
    return Object.entries(node).flatMap(([key, value]) => (key === '$text' ? [[...path, key].join('.')] : textPaths(value, [...path, key])));
};

const seedPage = (over) => mockDb.seed(SCHEMA_TYPE.PAGES, {
    content: { html: '<p>Nothing to see.</p>' }, visibility: 'project', createdBy: OWNER, ProjectID: SHARED, deletedStatusKey: 0, updatedAt: new Date('2026-09-01T00:00:00Z'), ...over,
});
const indexed = async (over) => {
    const page = seedPage(over);
    await indexer.ingestPage(C, page);
    return String(page._id);
};

const ask = (userId, query, over = {}) => retrieve({ companyId: C, caller: { kind: 'user', userId }, query, scope: { sourceTypes: ['page'] }, ...over });
const pageIds = (result) => result.passages.map((p) => p.sourceId);
const setOf = (userId) => resolveVisibleSet({ companyId: C, caller: { kind: 'user', userId }, scope: { sourceTypes: ['page'] } });
const candidates = async (userId, query) => (await lexical.search({ companyId: C, query, filter: filterFor(await setOf(userId), { chunkSources: ['page'] }), limit: 20 })).map((p) => p.sourceId);

const indexReady = (status = 'complete') => mockDb.seed(SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE, { companyId: C, sourceType: 'page', status, lastSeenOnAt: new Date() });

beforeAll(() => { process.env.KNOWLEDGE_INDEXER = 'tenant'; });
afterAll(() => {
    if (ENV.indexer === undefined) delete process.env.KNOWLEDGE_INDEXER;
    else process.env.KNOWLEDGE_INDEXER = ENV.indexer;
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    myCache.flushAll();
    mockDb.uniqueFromSchema(CHUNKS, knowledgeChunksSchema);
    getRoleType.mockImplementation(async (companyId, uid) => ROLES[uid]);
    visibleProjectIds.mockImplementation(async (companyId, uid) => PROJECTS[uid] || []);
    mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: C, knowledgeIndexer: { mode: 'on' } });
});

describe('retrieval reads page passages from the chunk store once the index is built', () => {
    beforeEach(() => indexReady());

    it('finds a word deep in a long page body that the page row itself no longer carries', async () => {
        const filler = '<p>routine paragraph about nothing much</p>'.repeat(250);
        const id = await indexed({ title: 'Operations manual', content: { html: `${filler}<h2>Escalation</h2><p>Call the quartermaster.</p>` }, rawText: 'routine paragraph about nothing much' });
        mockDb.calls.length = 0;

        const result = await ask(COLLEAGUE, 'quartermaster');

        expect(pageIds(result)).toEqual([id]);
        expect(result.passages[0]).toMatchObject({ sourceType: 'page', title: 'Operations manual', projectId: SHARED, authorKind: 'user', permission: { visibility: 'project', via: 'project' } });
        expect(result.passages[0].excerpt).toContain('quartermaster');
        expect(chunkSearches()).toHaveLength(1);
        expect(callsFor(SCHEMA_TYPE.PAGES).some((c) => c.data[0].$text || c.data[0].$and?.some((clause) => clause.$or?.some((f) => f.title || f.rawText)))).toBe(false);
    });

    it('puts $text at the top level beside every visible-set condition', async () => {
        await indexed({ title: 'Budget' });
        mockDb.calls.length = 0;

        await ask(COLLEAGUE, 'budget');

        const [call] = chunkSearches();
        const [pipeline] = call.data;
        const where = pipeline[0].$match;
        expect(textPaths(pipeline)).toEqual(['0.$match.$text']);
        expect(where).toMatchObject({ companyId: C, sourceType: 'page', deleted: { $ne: true } });
        expect(JSON.stringify(where.$and)).toContain(JSON.stringify(pageVisibilityFilter(COLLEAGUE)));
        expect(JSON.stringify(where.$and)).toContain('"projectId"');
    });

    it("returns a private page to its owner and never to a colleague, and the colleague's search never even selects it", async () => {
        const id = await indexed({ title: 'Salary notes', content: { html: '<p>The raise for payroll.</p>' }, visibility: 'private', createdBy: OWNER });

        expect(pageIds(await ask(OWNER, 'payroll'))).toEqual([id]);
        expect(pageIds(await ask(COLLEAGUE, 'payroll'))).toEqual([]);
        expect(await candidates(COLLEAGUE, 'payroll')).toEqual([]);
    });

    it("keeps a project the caller cannot open out of the chunk search, and reaches a company-wide page", async () => {
        const secret = await indexed({ title: 'Acquisition', content: { html: '<p>The harbour deal.</p>' }, ProjectID: SECRET });
        const companyWide = await indexed({ title: 'Harbour parking', content: { html: '<p>Park by the harbour.</p>' }, ProjectID: null });

        expect(await candidates(COLLEAGUE, 'harbour')).toEqual([companyWide]);
        expect(pageIds(await ask(OWNER, 'harbour')).sort()).toEqual([secret, companyWide].sort());
    });

    it('never selects a tombstoned chunk', async () => {
        const id = await indexed({ title: 'Moth plan', content: { html: '<p>Moth season.</p>' } });
        await indexer.tombstonePages(C, [id]);
        expect(await candidates(OWNER, 'moth')).toEqual([]);
    });

    it("searches only the caller's own company's chunks", async () => {
        const id = await indexed({ title: 'Lantern', content: { html: '<p>Lantern festival.</p>' } });
        expect(await candidates(OWNER, 'lantern')).toEqual([id]);
        mockDb.store[CHUNKS].forEach((row) => { row.companyId = '6f0000000000000000000c99'; });
        expect(await candidates(OWNER, 'lantern')).toEqual([]);
    });

    it('returns one passage per page however many of its chunks match, from the best chunk', async () => {
        const id = await indexed({ title: 'Kiln guide', content: { html: '<p>The kiln.</p><h2>Loading</h2><p>Load the kiln cold.</p><h2>Firing</h2><p>Fire the kiln slowly, the kiln cracks otherwise.</p>' } });
        const result = await ask(OWNER, 'kiln');
        expect(pageIds(result)).toEqual([id]);
    });

    it('ranks a page an agent drafted below one a person wrote at equal relevance, even when it is newer', async () => {
        const human = await indexed({ title: 'Vendor list', content: { html: '<p>Approved vendor names.</p>' }, updatedAt: new Date('2026-09-01T00:00:00Z') });
        const agent = await indexed({ title: 'Vendor list draft', content: { html: '<p>Approved vendor names.</p>' }, createdByAgent: true, updatedAt: new Date('2026-09-10T00:00:00Z') });

        const result = await ask(OWNER, 'vendor');

        expect(pageIds(result)).toEqual([human, agent]);
        expect(result.passages.map((p) => p.authorKind)).toEqual(['user', 'agent']);
        expect(result.passages[1].score).toBe(result.passages[0].score / 2);
    });
});

describe('long pages', () => {
    beforeEach(() => indexReady());

    it('cannot crowd other pages out: the search returns the best chunk of as many distinct pages as were asked for', async () => {
        const section = (n) => `<h2>Orbit ${n}</h2><p>${'orbit '.repeat(30)}and the orbit review for part ${n}.</p>`;
        const long = [];
        for (let i = 0; i < 2; i += 1) {
            long.push(await indexed({ title: `Orbit manual ${i}`, content: { html: Array.from({ length: 40 }, (_, n) => section(n)).join('') } }));
        }
        const short = [];
        for (let i = 0; i < 4; i += 1) {
            short.push(await indexed({ title: `Note ${i}`, content: { html: '<p>One orbit mention.</p>' } }));
        }

        const result = await ask(OWNER, 'orbit', { limit: 4 });

        expect(new Set(pageIds(result)).size).toBe(4);
        expect(pageIds(result).slice(0, 2).sort()).toEqual(long.sort());
        expect(pageIds(result).slice(2).every((id) => short.includes(id))).toBe(true);
    });
});

describe('a page edited after its chunks were written', () => {
    beforeEach(() => indexReady());

    it('never shows the old text: the passage takes the live title, drops the stale excerpt, and the page is synced again', async () => {
        const events = require('../Modules/Knowledge/ingest/events');
        const id = await indexed({ title: 'Launch plan', content: { html: '<p>The codename is falcon.</p>' } });
        Object.assign(mockDb.store[SCHEMA_TYPE.PAGES].find((p) => String(p._id) === id), {
            title: 'Launch plan (public)',
            content: { html: '<p>The codename is withheld.</p>' },
            updatedAt: new Date('2026-09-05T00:00:00Z'),
        });

        const first = await ask(OWNER, 'falcon');
        expect(first.passages.map((p) => [p.sourceId, p.title, p.excerpt])).toEqual([[id, 'Launch plan (public)', '']]);

        await events.drain();
        expect(pageIds(await ask(OWNER, 'falcon'))).toEqual([]);
        expect(pageIds(await ask(OWNER, 'withheld'))).toEqual([id]);
    });
});

describe('when the event that should have updated the index is lost', () => {
    beforeEach(() => indexReady());

    it('still hides a page deleted behind the index back', async () => {
        const id = await indexed({ title: 'Glacier', content: { html: '<p>Glacier survey.</p>' } });
        mockDb.store[SCHEMA_TYPE.PAGES].find((p) => String(p._id) === id).deletedStatusKey = 1;

        expect(await candidates(OWNER, 'glacier')).toEqual([id]);
        expect(pageIds(await ask(OWNER, 'glacier'))).toEqual([]);
    });

    it('still hides a page made private behind the index back from everyone but its author', async () => {
        const id = await indexed({ title: 'Tundra', content: { html: '<p>Tundra survey.</p>' }, createdBy: OWNER });
        mockDb.store[SCHEMA_TYPE.PAGES].find((p) => String(p._id) === id).visibility = 'private';

        expect(await candidates(COLLEAGUE, 'tundra')).toEqual([id]);
        expect(pageIds(await ask(COLLEAGUE, 'tundra'))).toEqual([]);
        expect(pageIds(await ask(OWNER, 'tundra'))).toEqual([id]);
    });
});

describe('while the index is not ready', () => {
    it.each([
        ['has never been built', null],
        ['is still being built', 'running'],
    ])('searches the page rows as before when the backfill %s', async (_label, status) => {
        if (status) indexReady(status);
        const page = seedPage({ title: 'Compass', rawText: 'compass bearings' });

        const result = await ask(OWNER, 'compass');

        expect(pageIds(result)).toEqual([String(page._id)]);
        expect(callsFor(CHUNKS)).toEqual([]);
        expect(callsFor(SCHEMA_TYPE.PAGES).some((c) => c.data[0].$text)).toBe(true);
    });

    it('searches the page rows as before when the company has not switched the indexer on', async () => {
        indexReady();
        mockDb.store[SCHEMA_TYPE.COMPANIES][0].knowledgeIndexer = { mode: 'off' };
        const page = seedPage({ title: 'Sextant', rawText: 'sextant' });

        expect(pageIds(await ask(OWNER, 'sextant'))).toEqual([String(page._id)]);
        expect(callsFor(CHUNKS)).toEqual([]);
        expect(callsFor(SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE)).toEqual([]);
    });
});
