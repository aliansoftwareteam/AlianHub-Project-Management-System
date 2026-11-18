const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn(), recordAudit: jest.fn() }));
jest.mock('../Modules/SSO/provisioning', () => ({
    jitProvisionUser: jest.fn(async ({ email }) => {
        const { SCHEMA_TYPE: T } = require('../Config/schemaType');
        return mockDb.store[T.COMPANY_USERS].find((row) => row.userEmail === email).userId;
    }),
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { knowledgeChunksSchema } = require('../utils/mongo-handler/createSchema');
const domainEventBus = require('../event/domainEventBus');
const scim = require('../Modules/Scim/controller');
const indexer = require('../Modules/Knowledge/ingest/indexer');
const events = require('../Modules/Knowledge/ingest/events');

const C = '6f00000000000000000000c7';
const OWNER = '6f0000000000000000000071';
const LEAVER = '6f0000000000000000000073';
const PROJECT = '6f00000000000000000000a7';
const ENV = process.env.KNOWLEDGE_INDEXER;

const CHUNKS = SCHEMA_TYPE.KNOWLEDGE_CHUNKS;
const live = (pageId) => (mockDb.store[CHUNKS] || []).filter((c) => c.sourceId === String(pageId) && !c.deleted);
const rowOf = (userId) => mockDb.store[SCHEMA_TYPE.COMPANY_USERS].find((r) => r.userId === userId);
const memberEvents = () => seen.filter((e) => e.type.startsWith('member.')).map((e) => [e.type, e.entity.id]);

const seen = [];
const record = (envelope) => seen.push(envelope);

const member = (userId, roleType) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, {
    userId, roleType, status: 2, isDelete: false, companyId: C, designation: 0, userEmail: `${userId}@scim.test`,
});
const seedPage = (over) => mockDb.seed(SCHEMA_TYPE.PAGES, {
    content: { html: '<p>Notes.</p>' }, visibility: 'project', ProjectID: PROJECT, deletedStatusKey: 0, updatedAt: new Date('2026-09-01T00:00:00Z'), ...over,
});

const send = async (handler, { params = {}, body = {} } = {}) => {
    const res = { code: 200 };
    res.status = (c) => { res.code = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    res.send = res.json;
    await handler({ scimCompanyId: C, scimConfig: { defaultRoleType: 3 }, params, body, query: {}, headers: {}, get: () => 'scim.test' }, res);
    await events.drain();
    return res;
};

const deactivateBy = {
    'PATCH active false': () => send(scim.patchUser, { params: { id: LEAVER }, body: { Operations: [{ op: 'replace', value: { active: false } }] } }),
    'PUT active false': () => send(scim.replaceUser, { params: { id: LEAVER }, body: { active: false } }),
    DELETE: () => send(scim.deleteUser, { params: { id: LEAVER } }),
};
const reactivateBy = {
    'PATCH active true': () => send(scim.patchUser, { params: { id: LEAVER }, body: { Operations: [{ op: 'replace', value: { active: true } }] } }),
    'PUT active true': () => send(scim.replaceUser, { params: { id: LEAVER }, body: { active: true } }),
    'POST of the same user': () => send(scim.createUser, { body: { userName: `${LEAVER}@scim.test`, active: true } }),
};

let pagesOf;

beforeAll(() => domainEventBus.bus.on('domain.event', record));

afterAll(() => {
    domainEventBus.bus.removeListener('domain.event', record);
    events.stop();
    if (ENV === undefined) delete process.env.KNOWLEDGE_INDEXER;
    else process.env.KNOWLEDGE_INDEXER = ENV;
});

beforeEach(async () => {
    process.env.KNOWLEDGE_INDEXER = 'all';
    events.start();
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.uniqueFromSchema(CHUNKS, knowledgeChunksSchema);
    mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: C });
    mockDb.seed(SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE, { companyId: C, sourceType: 'page', status: 'complete', lastSeenOnAt: new Date() });
    member(OWNER, 1);
    member(LEAVER, 3);
    pagesOf = {
        leaverPrivate: seedPage({ title: 'My salary notes', visibility: 'private', createdBy: LEAVER }),
        leaverShared: seedPage({ title: 'Release checklist', createdBy: LEAVER }),
        ownerPrivate: seedPage({ title: 'Board prep', visibility: 'private', createdBy: OWNER }),
    };
    await Promise.all(Object.values(pagesOf).map((page) => indexer.ingestPage(C, page)));
    seen.length = 0;
});

describe('a member deprovisioned through SCIM', () => {
    it.each(Object.keys(deactivateBy))('publishes the same departure as the members screen on %s', async (how) => {
        const res = await deactivateBy[how]();
        expect([200, 204]).toContain(res.code);

        expect(memberEvents()).toEqual([['member.departed', LEAVER]]);
        expect(live(pagesOf.leaverPrivate._id)).toEqual([]);
        expect(live(pagesOf.leaverShared._id)).toHaveLength(1);
        expect(live(pagesOf.ownerPrivate._id)).toHaveLength(1);
    });

    it('publishes nothing for an unknown user', async () => {
        const res = await send(scim.deleteUser, { params: { id: '6f0000000000000000000079' } });
        expect(res.code).toBe(404);
        expect(memberEvents()).toEqual([]);
    });

    it('publishes nothing when a PATCH only renames the member', async () => {
        mockDb.seed(SCHEMA_TYPE.USERS, { _id: LEAVER, Employee_FName: 'Old', Employee_LName: 'Name' });
        await send(scim.patchUser, { params: { id: LEAVER }, body: { Operations: [{ op: 'replace', value: { name: { givenName: 'New' } } }] } });
        expect(memberEvents()).toEqual([]);
        expect(live(pagesOf.leaverPrivate._id)).toHaveLength(1);
    });
});

describe('a member reprovisioned through SCIM', () => {
    beforeEach(async () => {
        await deactivateBy.DELETE();
        expect(live(pagesOf.leaverPrivate._id)).toEqual([]);
        seen.length = 0;
    });

    it.each(Object.keys(reactivateBy))('publishes the rejoin and brings their private pages back on %s', async (how) => {
        const res = await reactivateBy[how]();
        expect([200, 201]).toContain(res.code);

        expect(memberEvents()).toEqual([['member.activated', LEAVER]]);
        expect(live(pagesOf.leaverPrivate._id)).toHaveLength(1);
    });

    it('publishes no rejoin when the member was already active', async () => {
        await reactivateBy['PATCH active true']();
        seen.length = 0;
        await reactivateBy['PATCH active true']();
        expect(memberEvents()).toEqual([]);
    });
});

describe('with KNOWLEDGE_INDEXER off', () => {
    beforeEach(() => {
        events.stop();
        delete process.env.KNOWLEDGE_INDEXER;
    });

    it('deprovisions and reprovisions with no event and no change to the index', async () => {
        const before = JSON.stringify(mockDb.store[CHUNKS]);
        mockDb.calls.length = 0;

        for (const how of Object.keys(deactivateBy)) {
            await deactivateBy[how]();
            expect(rowOf(LEAVER).isDelete).toBe(true);
            await reactivateBy['PATCH active true']();
        }
        await deactivateBy.DELETE();
        expect((await reactivateBy['POST of the same user']()).code).toBe(201);

        expect(seen).toEqual([]);
        expect(JSON.stringify(mockDb.store[CHUNKS])).toBe(before);
        expect(mockDb.calls.filter((c) => c.type === CHUNKS)).toEqual([]);
    });
});
