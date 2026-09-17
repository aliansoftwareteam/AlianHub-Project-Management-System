const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a), validateObjectId: (id) => /^[0-9a-fA-F]{24}$/.test(String(id)) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(), isPrivileged: (roleType) => roleType === 1 || roleType === 2 }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(), visibleProjects: jest.fn() }));
jest.mock('../Modules/Pages/helpers/pageAi', () => ({ composePage: jest.fn(), isAiConfigured: () => false }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { getRoleType } = require('../Config/permissionGuard');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const { knowledgeChunksSchema } = require('../utils/mongo-handler/createSchema');
const domainEventBus = require('../event/domainEventBus');
const pages = require('../Modules/Pages/controller');
const { updateProjectInternal } = require('../Modules/Project/controller/updateProject');
const indexer = require('../Modules/Knowledge/ingest/indexer');
const events = require('../Modules/Knowledge/ingest/events');

const C = '6f0000000000000000000c01';
const OFF_COMPANY = '6f0000000000000000000c02';
const OWNER = '6f0000000000000000000001';
const MEMBER = '6f0000000000000000000003';
const P1 = '6f00000000000000000000a1';
const P2 = '6f00000000000000000000a2';
const ENV = process.env.KNOWLEDGE_INDEXER;

const CHUNKS = SCHEMA_TYPE.KNOWLEDGE_CHUNKS;
const chunks = () => mockDb.store[CHUNKS] || [];
const chunksOf = (pageId) => chunks().filter((c) => c.sourceId === String(pageId)).sort((a, b) => a.ordinal - b.ordinal);
const live = (pageId) => chunksOf(pageId).filter((c) => !c.deleted);
const chunkWrites = () => mockDb.calls.filter((c) => c.type === CHUNKS && c.method !== 'find');

const seedPage = (over = {}) => mockDb.seed(SCHEMA_TYPE.PAGES, {
    title: 'Handbook',
    content: { html: '<p>Intro.</p><h2>Leave</h2><p>Twenty days.</p>' },
    visibility: 'project',
    createdBy: OWNER,
    ProjectID: P1,
    deletedStatusKey: 0,
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    ...over,
});

const response = () => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (body) => { res.body = body; return res; };
    res.json = res.send;
    return res;
};
const call = async (handler, { uid, params = {}, body = {} }) => {
    const res = response();
    await handler({ uid, params, body, query: {}, headers: { companyid: C } }, res);
    return res;
};

beforeAll(() => {
    process.env.KNOWLEDGE_INDEXER = 'tenant';
    expect(events.start()).toBe(true);
});

afterAll(() => {
    events.stop();
    if (ENV === undefined) delete process.env.KNOWLEDGE_INDEXER;
    else process.env.KNOWLEDGE_INDEXER = ENV;
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    mockDb.uniqueFromSchema(CHUNKS, knowledgeChunksSchema);
    mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: C, knowledgeIndexer: { mode: 'on' } });
    mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: OFF_COMPANY });
    mockDb.seed(SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE, { companyId: C, sourceType: 'page', status: 'complete' });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: P1, ProjectName: 'One', isPrivateSpace: false, AssigneeUserId: [], deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: P2, ProjectName: 'Two', isPrivateSpace: false, AssigneeUserId: [], deletedStatusKey: 0 });
    getRoleType.mockImplementation(async () => 3);
    visibleProjectIds.mockImplementation(async () => [P1, P2]);
});

describe('ingesting a page into the chunk store', () => {
    it('writes one chunk per section carrying what the visible set needs', async () => {
        const page = seedPage();
        await indexer.ingestPage(C, page);

        const rows = live(page._id);
        expect(rows.map((r) => r.headingPath)).toEqual([['Handbook'], ['Handbook', 'Leave']]);
        rows.forEach((row, ordinal) => expect(row).toMatchObject({
            companyId: C,
            sourceType: 'page',
            sourceId: String(page._id),
            ordinal,
            projectId: P1,
            visibility: 'project',
            createdBy: OWNER,
            authorKind: 'human',
            title: 'Handbook',
            contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
            embeddingModel: null,
            deleted: false,
        }));
        expect(rows[1].text).toBe('Leave\nTwenty days.');
    });

    it('marks a page an agent drafted as agent-authored', async () => {
        const page = seedPage({ createdByAgent: true, agentName: 'Scribe', agentStatus: 'draft' });
        await indexer.ingestPage(C, page);
        expect(live(page._id).map((r) => r.authorKind)).toEqual(['agent', 'agent']);
    });

    it('skips the write when every content hash is unchanged', async () => {
        const page = seedPage();
        await indexer.ingestPage(C, page);
        mockDb.calls.length = 0;

        const result = await indexer.ingestPage(C, { ...page, updatedAt: new Date('2026-09-02T00:00:00Z') });

        expect(result).toMatchObject({ written: 0, unchanged: 2 });
        expect(chunkWrites()).toEqual([]);
    });

    it('rewrites only the chunk whose text changed', async () => {
        const page = seedPage();
        await indexer.ingestPage(C, page);
        mockDb.calls.length = 0;

        const result = await indexer.ingestPage(C, { ...page, content: { html: '<p>Intro.</p><h2>Leave</h2><p>Twenty-five days.</p>' }, updatedAt: new Date('2026-09-02T00:00:00Z') });

        expect(result).toMatchObject({ written: 1, unchanged: 1 });
        expect(live(page._id)[1].text).toBe('Leave\nTwenty-five days.');
    });

    it('rewrites unchanged text when the page is made private, so the index never keeps a stale visibility', async () => {
        const page = seedPage();
        await indexer.ingestPage(C, page);

        const result = await indexer.ingestPage(C, { ...page, visibility: 'private', updatedAt: new Date('2026-09-02T00:00:00Z') });

        expect(result).toMatchObject({ written: 2 });
        expect(live(page._id).map((r) => r.visibility)).toEqual(['private', 'private']);
    });

    it('tombstones the chunks a shorter page no longer has', async () => {
        const page = seedPage();
        await indexer.ingestPage(C, page);

        await indexer.ingestPage(C, { ...page, content: { html: '<p>Intro only.</p>' }, updatedAt: new Date('2026-09-02T00:00:00Z') });

        expect(chunksOf(page._id).map((r) => [r.ordinal, r.deleted])).toEqual([[0, false], [1, true]]);
    });

    it('never lets an older read of a page overwrite a newer one', async () => {
        const page = seedPage({ updatedAt: new Date('2026-09-05T00:00:00Z'), content: { html: '<p>New text.</p>' } });
        await indexer.ingestPage(C, page);

        const result = await indexer.ingestPage(C, { ...page, updatedAt: new Date('2026-09-01T00:00:00Z'), content: { html: '<p>Old text.</p>' } });

        expect(result.stale).toBe(1);
        expect(live(page._id).map((r) => r.text)).toEqual(['Handbook\nNew text.']);
    });
});

describe('page events on the bus', () => {
    it('carries the company id, so a created page is ingested', async () => {
        const res = await call(pages.createPage, { uid: OWNER, body: { title: 'Travel policy', projectId: P1, contentBlocks: [{ type: 'paragraph', data: { text: 'Book economy.' } }] } });
        expect(res.body.status).toBe(true);
        await events.drain();

        expect(live(res.body.data._id).map((r) => r.text)).toEqual(['Travel policy\nBook economy.']);
    });

    it('deleting a page tombstones the chunks of every descendant it took with it', async () => {
        const parent = seedPage({ title: 'Parent' });
        const child = seedPage({ title: 'Child', parentPageId: parent._id });
        const grandchild = seedPage({ title: 'Grandchild', parentPageId: child._id });
        const secret = seedPage({ title: 'Secret', parentPageId: parent._id, visibility: 'private', createdBy: OWNER });
        const other = seedPage({ title: 'Unrelated' });
        await Promise.all([parent, child, grandchild, secret, other].map((p) => indexer.ingestPage(C, p)));
        const announced = [];
        const listen = (envelope) => announced.push(envelope);
        domainEventBus.bus.on('page.deleted', listen);

        try {
            const res = await call(pages.deletePage, { uid: MEMBER, params: { id: parent._id } });
            expect(res.body.data.deleted).toBe(3);
            await events.drain();
        } finally {
            domainEventBus.bus.removeListener('page.deleted', listen);
        }

        expect(announced).toHaveLength(1);
        expect(announced[0]).toMatchObject({ companyId: C, entity: { kind: 'page', id: String(parent._id) } });
        expect([...announced[0].data.ids].sort()).toEqual([parent, child, grandchild].map((p) => String(p._id)).sort());
        [parent, child, grandchild].forEach((p) => expect(live(p._id)).toEqual([]));
        expect(chunksOf(parent._id).every((r) => r.deleted && r.deletedAt instanceof Date)).toBe(true);
        expect(live(secret._id)).toHaveLength(2);
        expect(live(other._id)).toHaveLength(2);
    });

    it('ingests a page an agent drafts as agent-authored, and undoing the draft takes it back out', async () => {
        const { executors } = require('../Modules/Agents/actions');
        const { inverses } = require('../Modules/Agents/undo');
        const actor = { kind: 'agent', agentId: '6f00000000000000000000e1', agentName: 'Scribe', userId: OWNER };

        const { result } = await executors['page.draft']({ companyId: C, actor, params: { title: 'Release notes', projectId: P1, content: { blocks: [{ type: 'paragraph', data: { text: 'Shipped search.' } }] } } });
        await events.drain();
        expect(live(result.pageId).map((r) => [r.authorKind, r.text])).toEqual([['agent', 'Release notes\nShipped search.']]);

        await inverses.page(C, { pageId: result.pageId });
        await events.drain();
        expect(live(result.pageId)).toEqual([]);
    });

    it('does nothing for a company whose own switch is off', async () => {
        await domainEventBus.bus.emit('page.created', { companyId: OFF_COMPANY, type: 'page.created', entity: { kind: 'page', id: '6f00000000000000000000f1' }, data: {} });
        await events.drain();
        expect(mockDb.calls.filter((c) => c.type === CHUNKS || c.type === SCHEMA_TYPE.PAGES)).toEqual([]);
    });
});

describe('cascades', () => {
    it("trashing a project tombstones that project's chunks and no other's, and restoring it brings them back", async () => {
        const inTrash = seedPage({ title: 'Doomed', ProjectID: P1 });
        const elsewhere = seedPage({ title: 'Safe', ProjectID: P2 });
        await indexer.ingestPage(C, inTrash);
        await indexer.ingestPage(C, elsewhere);

        await updateProjectInternal(C, P1, { deletedStatusKey: 1 });
        await events.drain();

        expect(live(inTrash._id)).toEqual([]);
        expect(live(elsewhere._id)).toHaveLength(2);

        await updateProjectInternal(C, P1, { deletedStatusKey: 0 });
        await events.drain();

        expect(live(inTrash._id)).toHaveLength(2);
    });

    it('re-sending a trash that crosses nothing announces nothing', async () => {
        const page = seedPage({ ProjectID: P2 });
        await indexer.ingestPage(C, page);
        const announced = jest.fn();
        domainEventBus.bus.on('project.restored', announced);
        try {
            await updateProjectInternal(C, P2, { deletedStatusKey: 0 });
            await events.drain();
        } finally {
            domainEventBus.bus.removeListener('project.restored', announced);
        }
        expect(announced).not.toHaveBeenCalled();
    });
});
