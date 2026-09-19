/* A project's AI guide as a knowledge source: ingested when the guide is saved, chunked on its
 * markdown structure, tombstoned with a trashed project and re-indexed on restore, as pages are. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a), validateObjectId: (id) => /^[0-9a-fA-F]{24}$/.test(String(id)) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Agents/memory', () => ({ fromBrief: jest.fn(async () => []) }));
jest.mock('../Modules/Agents/agentRecord', () => ({ createAgentRecord: jest.fn(async () => ({ _id: '6f00000000000000000000e1' })) }));
jest.mock('../Modules/Agents/runs', () => ({}));
jest.mock('../Modules/Agents/proposals', () => ({}));
jest.mock('../Modules/Agents/actions', () => ({}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { myCache } = require('../Config/config');
const { knowledgeChunksSchema } = require('../utils/mongo-handler/createSchema');
const domainEventBus = require('../event/domainEventBus');
const { updateProjectInternal } = require('../Modules/Project/controller/updateProject');
const executeAgents = require('../Modules/AIProjectGenerator/executeAgents');
const indexer = require('../Modules/Knowledge/ingest/indexer');
const events = require('../Modules/Knowledge/ingest/events');
const { eraseDocument } = require('../Modules/Knowledge/ingest/erase');

const C = '6f0000000000000000000c01';
const OFF_COMPANY = '6f0000000000000000000c02';
const OWNER = '6f0000000000000000000001';
const P1 = '6f00000000000000000000a1';
const ENV = process.env.KNOWLEDGE_INDEXER;

const GUIDE = '## Stages\n1. Catalogue in place\n2. First orders\n\n## Essentials\n- Payment account\n\n### Escalations\nCall the owner about refunds.';

const CHUNKS = SCHEMA_TYPE.KNOWLEDGE_CHUNKS;
const at = (day) => new Date(`2026-09-${String(day).padStart(2, '0')}T00:00:00Z`);
const rowsOf = (projectId) => (mockDb.store[CHUNKS] || []).filter((c) => c.sourceType === 'guide' && c.sourceId === String(projectId)).sort((a, b) => a.ordinal - b.ordinal);
const live = (projectId) => rowsOf(projectId).filter((c) => !c.deleted);
const project = (id = P1) => mockDb.store[SCHEMA_TYPE.PROJECTS].find((p) => String(p._id) === id);
const heard = [];
const onGuideSaved = (envelope) => heard.push(envelope);

beforeAll(() => {
    process.env.KNOWLEDGE_INDEXER = 'tenant';
    expect(events.start()).toBe(true);
    domainEventBus.bus.on('guide.saved', onGuideSaved);
});

afterAll(() => {
    domainEventBus.bus.removeListener('guide.saved', onGuideSaved);
    events.stop();
    if (ENV === undefined) delete process.env.KNOWLEDGE_INDEXER;
    else process.env.KNOWLEDGE_INDEXER = ENV;
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    heard.length = 0;
    jest.clearAllMocks();
    myCache.flushAll();
    mockDb.uniqueFromSchema(CHUNKS, knowledgeChunksSchema);
    mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: C, knowledgeIndexer: { mode: 'on' } });
    mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: OFF_COMPANY });
    ['page', 'comment', 'transcript', 'guide', 'file'].forEach((sourceType) => mockDb.seed(SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE, { companyId: C, sourceType, status: 'complete', lastSeenOnAt: new Date(), originFilledAt: new Date() }));
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: P1, ProjectName: 'Bike shop', aiGuide: { stages: [], markdown: GUIDE }, deletedStatusKey: 0, updatedAt: at(1) });
});

describe('saving a guide', () => {
    it('is announced with the company id once the AI project flow has stored it, and the guide is ingested', async () => {
        await executeAgents.start({ companyId: C, uid: OWNER, projectId: P1, projectName: 'Bike shop', pairs: [], agents: [], withGuide: true, approvedBrief: 'A shop for bikes.', assumptions: [] });
        await events.drain();

        expect(heard).toHaveLength(1);
        expect(heard[0]).toMatchObject({ companyId: C, type: 'guide.saved', entity: { kind: 'project', id: P1 } });
        expect(JSON.stringify(heard[0])).not.toContain('Catalogue');
        expect(live(P1).length).toBeGreaterThan(0);
    });

    it('announces nothing for a project made without a guide', async () => {
        await executeAgents.start({ companyId: C, uid: OWNER, projectId: P1, projectName: 'Bike shop', pairs: [], agents: [], withGuide: false, approvedBrief: '', assumptions: [] });
        await events.drain();
        expect(heard).toHaveLength(0);
    });

    it('chunks the guide on its markdown headings, under the project, as machine-written text', async () => {
        await indexer.syncGuide(C, P1);

        const rows = live(P1);
        expect(rows.map((c) => c.headingPath)).toEqual([
            ['Bike shop project guide'],
            ['Bike shop project guide', 'Stages'],
            ['Bike shop project guide', 'Essentials'],
            ['Bike shop project guide', 'Essentials', 'Escalations'],
        ]);
        expect(rows[1].text).toContain('Catalogue in place');
        expect(rows[3].text).toContain('Call the owner about refunds.');
        rows.forEach((row) => expect(row).toMatchObject({
            companyId: C, sourceType: 'guide', sourceId: P1, projectId: P1, sprintId: null, taskId: '', visibility: 'project', authorKind: 'agent', origin: 'agent', title: 'Bike shop project guide', deleted: false,
        }));
    });

    it('re-ingests a guide changed through the project update every client uses, and only then', async () => {
        await indexer.syncGuide(C, P1);
        project().updatedAt = at(2);

        await updateProjectInternal(C, P1, { aiGuide: { stages: [], markdown: '## Stages\n1. Hire a mechanic' } });
        await events.drain();

        expect(heard.map((e) => e.entity.id)).toEqual([P1]);
        expect(live(P1).map((c) => c.text).join('\n')).toContain('Hire a mechanic');
        expect(live(P1).map((c) => c.text).join('\n')).not.toContain('Catalogue in place');

        heard.length = 0;
        await updateProjectInternal(C, P1, { ProjectName: 'Bike shop two' });
        await events.drain();
        expect(heard).toHaveLength(0);
    });

    it('hears a guide changed one field at a time', async () => {
        await updateProjectInternal(C, P1, { 'aiGuide.markdown': '## Stages\n1. Paint the shop' });
        await events.drain();
        expect(heard).toHaveLength(1);
        expect(live(P1).map((c) => c.text).join('\n')).toContain('Paint the shop');
    });

    it('tombstones the chunks of a guide that was cleared', async () => {
        await indexer.syncGuide(C, P1);
        await updateProjectInternal(C, P1, { aiGuide: null });
        await events.drain();
        expect(live(P1)).toHaveLength(0);
        expect(rowsOf(P1).length).toBeGreaterThan(0);
    });

    it('indexes nothing for a project with no guide', async () => {
        project().aiGuide = undefined;
        const result = await indexer.syncGuide(C, P1);
        expect(result).toMatchObject({ leftOut: true, reason: 'no guide' });
        expect(rowsOf(P1)).toHaveLength(0);
    });

    it('publishes nothing and indexes nothing for a company whose indexer is off', async () => {
        mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: '6f00000000000000000000b1', ProjectName: 'Elsewhere', aiGuide: { markdown: GUIDE }, deletedStatusKey: 0 });
        events.publishGuideSaved(OFF_COMPANY, '6f00000000000000000000b1');
        await events.drain();
        expect(mockDb.store[CHUNKS] || []).toHaveLength(0);
    });
});

describe('a guide follows its project', () => {
    it('leaves the index when the project is trashed and is re-indexed when it is restored', async () => {
        await indexer.syncGuide(C, P1);

        await updateProjectInternal(C, P1, { deletedStatusKey: 1 });
        await events.drain();
        expect(live(P1)).toHaveLength(0);

        await updateProjectInternal(C, P1, { deletedStatusKey: 0 });
        await events.drain();
        expect(live(P1).length).toBeGreaterThan(0);
    });

    it('is never indexed for a trashed project, whatever announces it', async () => {
        project().deletedStatusKey = 1;
        events.publishGuideSaved(C, P1);
        await events.drain();
        expect(live(P1)).toHaveLength(0);
    });

    it('leaves the index when the project row is gone', async () => {
        await indexer.syncGuide(C, P1);
        mockDb.store[SCHEMA_TYPE.PROJECTS].length = 0;
        await indexer.syncGuide(C, P1);
        expect(live(P1)).toHaveLength(0);
    });

    it('is not rewritten by a project update that leaves the guide alone', async () => {
        await indexer.syncGuide(C, P1);
        mockDb.calls.length = 0;
        project().updatedAt = at(2);

        await indexer.syncGuide(C, P1);

        const writes = mockDb.calls.filter((c) => c.type === CHUNKS && c.method === 'updateOne');
        expect(writes).toHaveLength(0);
        expect(live(P1).every((c) => new Date(c.sourceUpdatedAt).getTime() === at(2).getTime())).toBe(true);
    });
});

describe('erasure by document', () => {
    it('removes a guide for good: no later save, sync or project restore writes it back', async () => {
        await indexer.syncGuide(C, P1);
        const before = rowsOf(P1).length;

        expect(await eraseDocument(C, { sourceType: 'guide', sourceId: P1 })).toEqual({ erased: before });

        await indexer.syncGuide(C, P1);
        await updateProjectInternal(C, P1, { aiGuide: { markdown: '## Stages\n1. Again' } });
        await updateProjectInternal(C, P1, { deletedStatusKey: 1 });
        await updateProjectInternal(C, P1, { deletedStatusKey: 0 });
        await events.drain();
        expect(rowsOf(P1)).toHaveLength(0);
    });
});
