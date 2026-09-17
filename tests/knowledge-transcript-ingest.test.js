const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a), validateObjectId: (id) => /^[0-9a-fA-F]{24}$/.test(String(id)) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/AI/meetingNotes', () => ({ generateMeetingNotes: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { knowledgeChunksSchema } = require('../utils/mongo-handler/createSchema');
const { generateMeetingNotes } = require('../Modules/AI/meetingNotes');
const domainEventBus = require('../event/domainEventBus');
const notes = require('../Modules/Calls/notes');
const { updateProjectInternal } = require('../Modules/Project/controller/updateProject');
const { MAX_CHUNK_CHARS } = require('../Modules/Knowledge/ingest/chunker');
const indexer = require('../Modules/Knowledge/ingest/indexer');
const events = require('../Modules/Knowledge/ingest/events');

const C = '6f0000000000000000000c01';
const HOST = '6f0000000000000000000001';
const GUEST = '6f0000000000000000000002';
const PROJECT = '6f00000000000000000000a1';
const ENV = process.env.KNOWLEDGE_INDEXER;

const CHUNKS = SCHEMA_TYPE.KNOWLEDGE_CHUNKS;
const chunksOf = (id) => (mockDb.store[CHUNKS] || []).filter((c) => c.sourceType === 'transcript' && c.sourceId === String(id)).sort((a, b) => a.ordinal - b.ordinal);
const live = (id) => chunksOf(id).filter((c) => !c.deleted);

const call = async (handler, { uid = HOST, params = {}, body = {} } = {}) => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (b) => { res.body = b; return res; };
    res.json = res.send;
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
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT, ProjectName: 'One', isPrivateSpace: false, AssigneeUserId: [], deletedStatusKey: 0 });
    generateMeetingNotes.mockResolvedValue({ status: true, data: { summary: 'Agreed to repaint the lighthouse.', actionItems: [{ id: 'ai_1', title: 'Order white paint', owner: 'Ann' }] } });
});

describe('call notes events on the bus', () => {
    it('carry the company id, so notes saved at the end of a call are ingested with the people on it', async () => {
        const res = await call(notes.createNotes, { body: { callId: 'call-1', title: 'Lighthouse sync', participants: [GUEST], projectId: PROJECT, transcript: 'We looked at the lamp.\nThe paint is peeling.', durationSec: 60 } });
        expect(res.body.status).toBe(true);
        await events.drain();

        const rows = live(res.body.data._id);
        expect(rows.length).toBeGreaterThan(0);
        rows.forEach((row) => expect(row).toMatchObject({
            companyId: C,
            sourceType: 'transcript',
            sourceId: String(res.body.data._id),
            projectId: PROJECT,
            visibility: 'participants',
            participants: [HOST, GUEST],
            createdBy: HOST,
            authorKind: 'human',
            title: 'Lighthouse sync',
            embeddingModel: null,
        }));
        const text = rows.map((r) => r.text).join('\n');
        ['Lighthouse sync', 'Agreed to repaint the lighthouse.', 'Order white paint', 'We looked at the lamp.', 'The paint is peeling.'].forEach((part) => expect(text).toContain(part));
    });

    it('re-ingests notes whose summary is edited, and tombstones notes that are discarded', async () => {
        const created = await call(notes.createNotes, { body: { callId: 'call-2', title: 'Harbour call', participants: [GUEST], transcript: 'Boats.' } });
        const id = String(created.body.data._id);
        await events.drain();

        await call(notes.updateNotes, { params: { id }, body: { summary: 'The ferry timetable changes in May.' } });
        await events.drain();
        expect(live(id).map((r) => r.text).join('\n')).toContain('The ferry timetable changes in May.');

        await call(notes.updateNotes, { params: { id }, body: { status: 'discarded' } });
        await events.drain();
        expect(live(id)).toEqual([]);
        expect(chunksOf(id).every((r) => r.deleted)).toBe(true);
    });

    it('announces notes as transcript.created, transcript.updated and transcript.deleted, with its company', async () => {
        const announced = [];
        const listen = (envelope) => { if (envelope.entity.kind === 'transcript') announced.push(envelope); };
        domainEventBus.bus.on('domain.event', listen);
        try {
            const created = await call(notes.createNotes, { body: { callId: 'call-3', participants: [GUEST], transcript: 'Hello.' } });
            const id = String(created.body.data._id);
            await call(notes.updateNotes, { params: { id }, body: { title: 'Renamed' } });
            await call(notes.updateNotes, { params: { id }, body: { status: 'discarded' } });
            await events.drain();
            expect(announced.map((e) => [e.type, e.companyId, e.entity.id])).toEqual([
                ['transcript.created', C, id],
                ['transcript.updated', C, id],
                ['transcript.deleted', C, id],
            ]);
            expect(JSON.stringify(announced)).not.toContain('Hello.');
        } finally {
            domainEventBus.bus.removeListener('domain.event', listen);
        }
    });
});

describe('chunking a transcript', () => {
    it('splits a long transcript into chunks no longer than a chunk, all under the call title', async () => {
        const line = (n) => `Speaker ${n % 2 ? 'A' : 'B'}: point number ${n} about the lighthouse keeper rota and the lamp oil.`;
        const call1 = mockDb.seed(SCHEMA_TYPE.CALLS, {
            callId: 'long', title: 'Rota review', participants: [HOST], transcript: Array.from({ length: 200 }, (_, n) => line(n)).join('\n'), summary: '', actionItems: [], deletedStatusKey: 0, createdBy: HOST, updatedAt: new Date('2026-09-01T00:00:00Z'),
        });

        await indexer.syncTranscript(C, String(call1._id));

        const rows = live(call1._id);
        expect(rows.length).toBeGreaterThan(3);
        rows.forEach((row, ordinal) => {
            expect(row.ordinal).toBe(ordinal);
            expect(row.text.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
            expect(row.headingPath[0]).toBe('Rota review');
        });
        expect(rows.map((r) => r.text).join('\n')).toContain('point number 199');
    });

    it('stays indexed for its participants when its project is trashed, since a transcript follows the call rather than the project', async () => {
        const kept = mockDb.seed(SCHEMA_TYPE.CALLS, { callId: 'p', title: 'Project call', participants: [HOST], projectId: PROJECT, transcript: 'Paint.', deletedStatusKey: 0, createdBy: HOST, updatedAt: new Date('2026-09-01T00:00:00Z') });
        await indexer.syncTranscript(C, String(kept._id));

        await updateProjectInternal(C, PROJECT, { deletedStatusKey: 1 });
        await events.drain();

        expect(live(kept._id).length).toBeGreaterThan(0);
    });
});
