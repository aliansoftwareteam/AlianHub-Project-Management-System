const mockDbs = {};
const mockDbFor = (id) => { mockDbs[id] = mockDbs[id] || require('./fixtures/fakeMongo').create(); return mockDbs[id]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method) }));
jest.mock('../Config/config', () => ({ WEBURL: 'https://hub.test', myCache: { get: () => undefined, set: () => {}, del: () => {}, getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn() }));

const { buildContext, validateMigration, listMigrations } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { settingsCollectionDocs } = require('../Config/collections');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const { hashFeedToken } = require('../Modules/Calendar/helpers/icalRules');
const ctrl = require('../Modules/Calendar/controller');
const migration = require('../migrations/012-hash-calendar-feed-tokens');

const COMPANY = '6f00000000000000000cb001';
const OWNER = '6f00000000000000000cb011';
const PROJECT = '6f00000000000000000cb021';
const LEGACY_TOKEN = 'a1b2c3'.repeat(6);
const HASHED_ONLY = 'f'.repeat(64);

const logger = { info: jest.fn(), error: jest.fn() };
const context = () => buildContext({ MongoDbCrudOpration, SCHEMA_TYPE, settingsCollectionDocs, logger, listCompanies: async () => [] });
const feeds = () => mockDbFor(SCHEMA_TYPE.GOLBAL).store[SCHEMA_TYPE.CALENDAR_FEEDS] || [];

const fetchIcs = async (token) => {
    const res = { statusCode: 200, headers: {} };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (payload) => { res.body = payload; return res; };
    res.setHeader = (key, value) => { res.headers[key] = value; };
    await ctrl.getIcs({ params: { token }, headers: {} }, res);
    return res;
};

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => { delete mockDbs[key]; });
    jest.clearAllMocks();
    visibleProjectIds.mockResolvedValue([PROJECT]);
    const company = mockDbFor(COMPANY);
    company.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    company.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Legacy feed task', ProjectID: PROJECT, AssigneeUserId: [OWNER], DueDate: new Date('2026-09-22T00:00:00Z'), deletedStatusKey: 0 });
    const global = mockDbFor(SCHEMA_TYPE.GOLBAL);
    global.seed(SCHEMA_TYPE.CALENDAR_FEEDS, { token: LEGACY_TOKEN, companyId: COMPANY, userId: OWNER, scope: 'my', name: 'Legacy', enabled: true, deletedStatusKey: 0 });
    global.seed(SCHEMA_TYPE.CALENDAR_FEEDS, { tokenHash: HASHED_ONLY, companyId: COMPANY, userId: OWNER, scope: 'my', name: 'Already hashed', enabled: true, deletedStatusKey: 0 });
});

describe('012-hash-calendar-feed-tokens', () => {
    test('is a valid global migration listed after 011', () => {
        expect(() => validateMigration(migration, '012-hash-calendar-feed-tokens')).not.toThrow();
        expect(migration.scope).toBe('global');
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf('012-hash-calendar-feed-tokens')).toBeGreaterThan(ids.indexOf('011-member-default-rules'));
    });

    test('an already subscribed feed URL keeps working once its token is replaced by a hash', async () => {
        expect(await migration.up(context())).toEqual({ hashed: 1 });

        const legacy = feeds().find((feed) => feed.name === 'Legacy');
        expect(legacy.token).toBeUndefined();
        expect(legacy.tokenHash).toBe(hashFeedToken(LEGACY_TOKEN));
        const res = await fetchIcs(LEGACY_TOKEN);
        expect(res.statusCode).toBe(200);
        expect(res.body).toContain('Legacy feed task');
    });

    test('a feed the migration has not reached still answers, and is hashed on first use', async () => {
        const res = await fetchIcs(LEGACY_TOKEN);
        expect(res.statusCode).toBe(200);
        expect(res.body).toContain('Legacy feed task');

        const legacy = feeds().find((feed) => feed.name === 'Legacy');
        expect(legacy.token).toBeUndefined();
        expect(legacy.tokenHash).toBe(hashFeedToken(LEGACY_TOKEN));
        expect(await migration.up(context())).toEqual({ hashed: 0 });
        expect((await fetchIcs(LEGACY_TOKEN)).statusCode).toBe(200);
    });

    test('a deleted or disabled legacy feed is not revived by its clear token', async () => {
        const legacy = feeds().find((feed) => feed.name === 'Legacy');
        legacy.deletedStatusKey = 1;
        expect((await fetchIcs(LEGACY_TOKEN)).statusCode).toBe(404);
        expect(legacy.tokenHash).toBeUndefined();
    });

    test('is idempotent and leaves a feed that already holds only a hash alone', async () => {
        await migration.up(context());
        const after = feeds().map((feed) => feed.tokenHash);

        expect(await migration.up(context())).toEqual({ hashed: 0 });
        expect(feeds().map((feed) => feed.tokenHash)).toEqual(after);
        expect(feeds().find((feed) => feed.name === 'Already hashed').tokenHash).toBe(HASHED_ONLY);
    });
});
