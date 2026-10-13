const mockDbs = {};
const mockDbFor = (companyId) => { mockDbs[companyId] = mockDbs[companyId] || require('./fixtures/fakeMongo').create(); return mockDbs[companyId]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { buildContext, validateMigration, listMigrations } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { settingsCollectionDocs } = require('../Config/collections');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { getRoleType } = require('../Config/permissionGuard');
const migration = require('../migrations/013-activate-provisioned-seats');

const COMPANY = '6f0000000000000000000c01';
const SSO_USER = '6f0000000000000000000001';
const INVITEE = '6f0000000000000000000002';
const LEFT = '6f0000000000000000000003';

const logger = { info: jest.fn(), error: jest.fn() };
const context = () => buildContext({ MongoDbCrudOpration, SCHEMA_TYPE, settingsCollectionDocs, logger, listCompanies: async () => [{ _id: COMPANY }] });
const seatOf = (userId) => (mockDbFor(COMPANY).store[SCHEMA_TYPE.COMPANY_USERS] || []).find((seat) => seat.userId === userId);

beforeEach(() => {
    Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
    jest.clearAllMocks();
    const db = mockDbFor(COMPANY);
    db.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: SSO_USER, roleType: 3, status: 1, isDelete: false, userEmail: 'jit@example.test' });
    db.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: INVITEE, roleType: 2, status: 1, isDelete: false, linkId: 'tok', sendInvitationTime: new Date() });
    db.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: LEFT, roleType: 3, status: 1, isDelete: true });
});

describe('013-activate-provisioned-seats', () => {
    test('is a valid company-scoped migration listed after 012', () => {
        expect(() => validateMigration(migration, '013-activate-provisioned-seats')).not.toThrow();
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf('013-activate-provisioned-seats')).toBeGreaterThan(ids.indexOf('012-hash-calendar-feed-tokens'));
    });

    test('activates a seat SSO or SCIM provisioned, and gives that user their role back', async () => {
        await migration.up(context());
        expect(seatOf(SSO_USER).status).toBe(2);
        expect(await getRoleType(COMPANY, SSO_USER)).toBe(3);
    });

    test('leaves a real pending invitation pending', async () => {
        await migration.up(context());
        expect(seatOf(INVITEE).status).toBe(1);
        expect(await getRoleType(COMPANY, INVITEE)).toBeNull();
    });

    test('leaves a removed member removed', async () => {
        await migration.up(context());
        expect(seatOf(LEFT).status).toBe(1);
        expect(await getRoleType(COMPANY, LEFT)).toBeNull();
    });

    test('changes nothing on a second run', async () => {
        await migration.up(context());
        const counts = await migration.activateCompany(context(), COMPANY);
        expect(counts).toEqual({ activated: 0, found: 0 });
    });
});
