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

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const controls = require('../Modules/Knowledge/controls');
const { INDEXED_SOURCES } = require('../Modules/Knowledge/sources');

/* Erasure by person forgets a person's private docs and leaves their shared ones; a version is a copy of the doc,
 * so the copies kept while a doc of theirs was private go the same way. */

const C = '6f0000000000000000000c01';
const OTHER = '6f0000000000000000000c02';
const ALICE = '6f0000000000000000000011';
const BOB = '6f0000000000000000000012';
const VERSIONS = SCHEMA_TYPE.PAGE_VERSIONS;

const oid = (id) => new mongoose.Types.ObjectId(id);
const page = (companyId, createdBy, extra = {}) => mockDbFor(companyId).seed(SCHEMA_TYPE.PAGES, {
    _id: new mongoose.Types.ObjectId().toString(), title: 'Doc', createdBy, visibility: 'project', deletedStatusKey: 0, ...extra,
});
const version = (companyId, doc, visibility, label) => mockDbFor(companyId).seed(VERSIONS, {
    pageId: oid(doc._id), title: label, content: { blocks: [] }, savedBy: doc.createdBy, savedAt: new Date(), reason: 'interval', visibility,
});
const left = (companyId) => (mockDbFor(companyId).store[VERSIONS] || []).map((row) => row.title).sort();

beforeEach(() => { Object.keys(mockDbs).forEach((key) => { delete mockDbs[key]; }); });

describe('erasure by person', () => {
    it('removes the versions kept while a doc of theirs was private, and counts them', async () => {
        const alicePrivate = page(C, ALICE, { visibility: 'private' });
        const aliceShared = page(C, ALICE);
        const aliceTrashed = page(C, ALICE, { deletedStatusKey: 1 });
        const bobPrivate = page(C, BOB, { visibility: 'private' });
        version(C, alicePrivate, 'private', 'alice private doc');
        version(C, aliceShared, 'private', 'alice shared doc, private time');
        version(C, aliceShared, 'project', 'alice shared doc, shared time');
        version(C, aliceTrashed, 'private', 'alice trashed doc');
        version(C, bobPrivate, 'private', 'bob private doc');
        version(OTHER, page(OTHER, ALICE, { visibility: 'private' }), 'private', 'alice in another workspace');

        const result = await controls.erasePerson(C, ALICE);

        expect(result).toMatchObject({ removed: { page_version: 3 }, total: 3 });
        expect(left(C)).toEqual(['alice shared doc, shared time', 'bob private doc']);
        expect(left(OTHER)).toEqual(['alice in another workspace']);
    });

    it('leaves the old history, which was written before a doc could be private', async () => {
        const doc = page(C, ALICE);
        mockDbFor(C).seed(VERSIONS, { pageId: oid(doc._id), title: 'old row', content: { html: '<p>Old</p>' }, savedBy: ALICE });

        const result = await controls.erasePerson(C, ALICE);

        expect(result.removed.page_version).toBeUndefined();
        expect(left(C)).toEqual(['old row']);
    });

    it('finds a person who left nothing but private versions', async () => {
        expect(await controls.personExists(C, ALICE)).toBe(false);
        version(C, page(C, ALICE, { visibility: 'private' }), 'private', 'alice private doc');
        expect(await controls.personExists(C, ALICE)).toBe(true);
    });
});

describe('the knowledge index', () => {
    it('has no source for versions, so a departed member’s private history is never searchable', () => {
        expect(INDEXED_SOURCES.some((source) => /version/i.test(source))).toBe(false);
        expect(controls.documentTypes().some((source) => /version/i.test(source))).toBe(false);
    });
});
