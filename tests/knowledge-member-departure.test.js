const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn(), recordAudit: jest.fn() }));
jest.mock('../utils/data', () => ({ importUserNotifications: jest.fn(async () => undefined) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { knowledgeChunksSchema } = require('../utils/mongo-handler/createSchema');
const members = require('../Modules/settings/Members/controller');
const indexer = require('../Modules/Knowledge/ingest/indexer');
const events = require('../Modules/Knowledge/ingest/events');

const C = '6f00000000000000000000c1';
const OWNER = '6f0000000000000000000001';
const LEAVER = '6f0000000000000000000003';
const PROJECT = '6f00000000000000000000a1';
const ENV = process.env.KNOWLEDGE_INDEXER;

const CHUNKS = SCHEMA_TYPE.KNOWLEDGE_CHUNKS;
const live = (pageId) => (mockDb.store[CHUNKS] || []).filter((c) => c.sourceId === String(pageId) && !c.deleted);
const rowOf = (userId) => mockDb.store[SCHEMA_TYPE.COMPANY_USERS].find((r) => r.userId === userId);

const member = (userId, roleType) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, {
    userId, roleType, status: 2, isDelete: false, companyId: C, designation: 0, userEmail: `${userId}@e2e.test`,
});
const seedPage = (over) => mockDb.seed(SCHEMA_TYPE.PAGES, {
    content: { html: '<p>Notes.</p>' }, visibility: 'project', ProjectID: PROJECT, deletedStatusKey: 0, updatedAt: new Date('2026-09-01T00:00:00Z'), ...over,
});

const update = async (uid, userId, data) => {
    const res = { code: 200 };
    res.status = (c) => { res.code = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    await members.updateMember({ uid, headers: { companyid: C }, body: { id: rowOf(userId)._id, data }, params: {}, query: {} }, res);
    await events.drain();
    return res;
};

let pagesOf;

beforeAll(() => {
    process.env.KNOWLEDGE_INDEXER = 'all';
    events.start();
});

afterAll(() => {
    events.stop();
    if (ENV === undefined) delete process.env.KNOWLEDGE_INDEXER;
    else process.env.KNOWLEDGE_INDEXER = ENV;
});

beforeEach(async () => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.uniqueFromSchema(CHUNKS, knowledgeChunksSchema);
    mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: C });
    mockDb.seed(SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE, { companyId: C, sourceType: 'page', status: 'complete' });
    member(OWNER, 1);
    member(LEAVER, 3);
    pagesOf = {
        leaverPrivate: seedPage({ title: 'My salary notes', visibility: 'private', createdBy: LEAVER }),
        leaverShared: seedPage({ title: 'Release checklist', createdBy: LEAVER }),
        leaverCompanyWide: seedPage({ title: 'Holiday rota', createdBy: LEAVER, ProjectID: null }),
        ownerPrivate: seedPage({ title: 'Board prep', visibility: 'private', createdBy: OWNER }),
    };
    await Promise.all(Object.values(pagesOf).map((page) => indexer.ingestPage(C, page)));
});

describe('a member leaving the workspace', () => {
    it.each([
        ['removed', { isDelete: true }],
        ['whose seat is cancelled', { status: 3 }],
    ])('takes only their private pages out of the index when %s', async (_label, data) => {
        const res = await update(OWNER, LEAVER, data);
        expect(res.code).toBe(200);

        expect(live(pagesOf.leaverPrivate._id)).toEqual([]);
        expect(live(pagesOf.leaverShared._id)).toHaveLength(1);
        expect(live(pagesOf.leaverCompanyWide._id)).toHaveLength(1);
        expect(live(pagesOf.ownerPrivate._id)).toHaveLength(1);
    });

    it.each([
        ['a change that is not a departure', { designation: 4 }],
        ['a member made a guest, who can still read their own private pages', { roleType: 0 }],
    ])('leaves the index alone for %s', async (_label, data) => {
        const res = await update(OWNER, LEAVER, data);
        expect(res.code).toBe(200);
        expect(live(pagesOf.leaverPrivate._id)).toHaveLength(1);
    });

    it('leaves the index alone when the update is refused', async () => {
        const res = await update(LEAVER, OWNER, { isDelete: true });
        expect(res.code).toBe(403);
        expect(live(pagesOf.ownerPrivate._id)).toHaveLength(1);
    });
});
