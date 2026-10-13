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
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const controls = require('../Modules/Knowledge/controls');
const indexer = require('../Modules/Knowledge/ingest/indexer');
const { INDEXED_SOURCES } = require('../Modules/Knowledge/sources');
const history = require('../Modules/Pages/versions');

/* Erasure by person and a member's departure act on the knowledge index: a person's private docs leave it and stay
 * out, and the docs themselves are not touched. A version is a copy of a doc, so it is never a source of its own,
 * and restoring one cannot bring an erased or departed person's private doc back into the index. */

const C = '6f0000000000000000000c01';
const ALICE = '6f0000000000000000000011';
const BOB = '6f0000000000000000000012';
const VERSIONS = SCHEMA_TYPE.PAGE_VERSIONS;

const oid = (id) => new mongoose.Types.ObjectId(id);
const para = (text) => ({ id: 'a', type: 'paragraph', data: { text } });
const seat = (userId, extra = {}) => mockDbFor(C).seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType: 3, status: 2, isDelete: false, ...extra });
const page = (createdBy, extra = {}) => mockDbFor(C).seed(SCHEMA_TYPE.PAGES, {
    _id: new mongoose.Types.ObjectId().toString(),
    title: 'Notes',
    createdBy,
    editedBy: createdBy,
    visibility: 'private',
    deletedStatusKey: 0,
    content: { blocks: { blocks: [para('Now')] } },
    rawText: 'Now',
    updatedAt: new Date(),
    createdAt: new Date(),
    ...extra,
});
const version = (doc, text, visibility = 'private') => mockDbFor(C).seed(VERSIONS, {
    _id: new mongoose.Types.ObjectId().toString(),
    pageId: oid(doc._id), title: doc.title, content: { blocks: [para(text)] }, rawText: text, savedBy: doc.createdBy, savedAt: new Date(), createdAt: new Date(), reason: 'interval', visibility, hash: text,
});
const stored = (type) => mockDbFor(C).store[type] || [];
const storedPage = (doc) => stored(SCHEMA_TYPE.PAGES).find((row) => String(row._id) === String(doc._id));
const decide = (doc) => indexer.RULES.page.decide(C, storedPage(doc));

const restore = async (uid, doc, kept) => {
    const res = { body: null };
    res.status = () => res;
    res.send = (body) => { res.body = body; return res; };
    res.json = res.send;
    await history.restoreVersion({ headers: { companyid: C }, aud: C, uid, params: { id: String(doc._id), versionId: String(kept._id) }, body: {}, query: {} }, res);
    return res.body;
};

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => { delete mockDbs[key]; });
    myCache.flushAll();
    jest.clearAllMocks();
    seat(ALICE);
    seat(BOB);
});

describe('a doc version and the knowledge index', () => {
    it('is not a source of its own', () => {
        expect(INDEXED_SOURCES.some((source) => /version/i.test(source))).toBe(false);
        expect(Object.values(indexer.RULES).some((rule) => rule.collection === VERSIONS)).toBe(false);
    });
});

describe('erasure by person', () => {
    it('leaves the versions where it leaves the docs: in the app, untouched', async () => {
        const doc = page(ALICE);
        version(doc, 'Earlier');
        version(page(BOB), 'Bob earlier');

        const result = await controls.erasePerson(C, ALICE);

        expect(result.removed.page_version).toBeUndefined();
        expect(stored(VERSIONS).map((row) => row.rawText).sort()).toEqual(['Bob earlier', 'Earlier']);
        expect(stored(SCHEMA_TYPE.PAGES)).toHaveLength(2);
    });

    it('keeps the erased person’s private doc out of the index after a version of it is restored', async () => {
        const doc = page(ALICE);
        const kept = version(doc, 'Earlier');
        expect((await decide(doc)).action).toBe('ingest');

        await controls.erasePerson(C, ALICE);
        expect(await restore(ALICE, doc, kept)).toMatchObject({ status: true, data: { rawText: 'Earlier' } });

        expect(socketEmitter.emit).toHaveBeenCalledWith('update', expect.objectContaining({ module: 'pages', companyId: C }));
        expect(await decide(doc)).toMatchObject({ action: 'erase', reason: 'erased' });
    });
});

describe('a departed member’s private doc', () => {
    it('stays out of the index whatever its history holds, and nobody can restore from it', async () => {
        const doc = page(ALICE);
        const kept = version(doc, 'Earlier');
        stored(SCHEMA_TYPE.COMPANY_USERS).find((row) => row.userId === ALICE).isDelete = true;
        myCache.flushAll();

        expect(await decide(doc)).toMatchObject({ action: 'tombstone', reason: 'departed' });
        for (const uid of [ALICE, BOB]) {
            expect(await restore(uid, doc, kept)).toMatchObject({ status: false, statusCode: 404 });
        }
        expect(storedPage(doc).rawText).toBe('Now');
        expect(socketEmitter.emit).not.toHaveBeenCalled();
    });
});
