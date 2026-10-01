const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/config', () => {
    const NodeCache = require('node-cache');
    return { myCache: new NodeCache() };
});
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../common-storage/readStoredFile', () => ({ readStoredFile: jest.fn() }));
jest.mock('../Modules/Agents/budget', () => ({ settings: jest.fn(async () => ({ monthlyBudgetUsd: 25 })) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const indexer = require('../Modules/Knowledge/ingest/indexer');
const atlas = require('../Modules/Knowledge/adapters/atlas');
const { resolveVisibleSet, chunkClausesFor } = require('../Modules/Knowledge/visibleSet');

const C = '6f0000000000000000000c01';
const AUTHOR = '6f0000000000000000000011';
const NAMED = '6f0000000000000000000012';
const OTHER = '6f0000000000000000000013';

const para = (text) => ({ id: 'a', type: 'paragraph', data: { text } });
const share = (userId, role = 'viewer') => ({ userId, role, by: AUTHOR, at: new Date() });

let doc;
const chunks = () => (mockDb.store[SCHEMA_TYPE.KNOWLEDGE_CHUNKS] || []).filter((chunk) => chunk.sourceId === String(doc._id) && chunk.deleted !== true);
const stored = () => mockDb.store[SCHEMA_TYPE.PAGES].find((row) => String(row._id) === String(doc._id));
const shareWith = async (people) => {
    Object.assign(stored(), { sharedWith: people, updatedAt: new Date(new Date(stored().updatedAt).getTime() + 1000) });
    await indexer.sync(C, 'page', String(doc._id));
};
const reaches = async (uid) => {
    const set = await resolveVisibleSet({ companyId: C, caller: { kind: 'user', userId: uid } });
    return (await mockDb.crud(C, { type: SCHEMA_TYPE.KNOWLEDGE_CHUNKS, data: [chunkClausesFor(set).page] }, 'find')).length > 0;
};

beforeEach(async () => {
    Object.keys(mockDb.store).forEach((key) => { mockDb.store[key].length = 0; });
    myCache.flushAll();
    [AUTHOR, NAMED, OTHER].forEach((userId) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType: 3, status: 2, isDelete: false }));
    doc = mockDb.seed(SCHEMA_TYPE.PAGES, {
        _id: new mongoose.Types.ObjectId().toString(),
        title: 'Atlas notes',
        createdBy: AUTHOR,
        visibility: 'private',
        deletedStatusKey: 0,
        content: { blocks: { blocks: [para('Atlas plan for the quarter')] } },
        rawText: 'Atlas plan for the quarter',
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    await indexer.sync(C, 'page', String(doc._id));
});

describe('a doc shared with people by name: the knowledge index', () => {
    it('keeps the named people on the chunks, and follows a share and an unshare', async () => {
        expect(chunks().length).toBeGreaterThan(0);
        expect(chunks().every((chunk) => (chunk.sharedWith || []).length === 0)).toBe(true);
        expect(await reaches(NAMED)).toBe(false);

        await shareWith([share(NAMED), share(OTHER, 'editor')]);
        expect(chunks().map((chunk) => chunk.sharedWith)).toEqual(chunks().map(() => [NAMED, OTHER]));
        expect(chunks().every((chunk) => chunk.visibility === 'private' && chunk.createdBy === AUTHOR)).toBe(true);
        expect(await reaches(NAMED)).toBe(true);
        expect(await reaches(OTHER)).toBe(true);

        await shareWith([share(OTHER, 'editor')]);
        expect(chunks().map((chunk) => chunk.sharedWith)).toEqual(chunks().map(() => [OTHER]));
        expect(await reaches(NAMED)).toBe(false);
        expect(await reaches(AUTHOR)).toBe(true);
    });

    it('leaves the chunks alone when only a role changes', async () => {
        await shareWith([share(NAMED)]);
        const before = JSON.stringify(chunks().map((chunk) => [chunk.sharedWith, chunk.contentHash]));
        await shareWith([share(NAMED, 'editor')]);
        expect(JSON.stringify(chunks().map((chunk) => [chunk.sharedWith, chunk.contentHash]))).toBe(before);
    });

    it('still leaves the index with its author, whoever it is shared with', async () => {
        await shareWith([share(NAMED)]);
        mockDb.store[SCHEMA_TYPE.COMPANY_USERS].find((seat) => seat.userId === AUTHOR).isDelete = true;
        myCache.flushAll();
        expect((await indexer.RULES.page.decide(C, stored())).action).toBe('tombstone');
    });

    it('lets the vector pre-filter narrow by the named people', () => {
        expect(atlas.FILTER_PATHS).toContain('sharedWith');
        const set = { companyId: C, caller: { userId: NAMED }, projectIds: [], hiddenSprintIds: [], fileProjectIds: [], sourceTypes: ['page'] };
        expect(JSON.stringify(atlas.prefilterOf(chunkClausesFor(set).page))).toContain(`"sharedWith":{"$eq":"${NAMED}"}`);
    });
});
