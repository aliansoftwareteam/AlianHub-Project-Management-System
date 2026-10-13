const mockDbs = {};
const mockDbFor = (companyId) => { mockDbs[companyId] = mockDbs[companyId] || require('./fixtures/fakeMongo').create(); return mockDbs[companyId]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));

const { buildContext, validateMigration, listMigrations } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { settingsCollectionDocs } = require('../Config/collections');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../utils/commonFunctions');
const migration = require('../migrations/056-project-view-catalogue');

const T = SCHEMA_TYPE.PROJECT_TAB_COMPONENTS;
const PARTIAL = '6f0000000000000000000e01';
const EMPTY = '6f0000000000000000000e02';
const FULL = '6f0000000000000000000e03';
const logger = { info: jest.fn(), error: jest.fn() };
const contextFor = (companies) => buildContext({ MongoDbCrudOpration, SCHEMA_TYPE, settingsCollectionDocs, logger, listCompanies: async () => companies.map((_id) => ({ _id })) });

const rows = (companyId) => mockDbFor(companyId).store[T] || [];
const writes = (companyId) => mockDbFor(companyId).calls.filter((call) => call.method !== 'find');
const DASHBOARD = { _id: '6a8ef08c2b6984dc41edb199', keyName: 'ProjectDashboard', name: 'Dashboard', sortIndex: 8, value: 'dashboard', setAsDefault: false, viewStatus: false };
const LIST = { _id: '6a97261fb28e840202058560', keyName: 'ProjectListView', name: 'My list', sortIndex: 4, value: 'list', setAsDefault: true, viewStatus: true };
const GANTT = { _id: '6a97261fb28e840202058561', keyName: 'GanttView', name: 'Gantt View', sortIndex: 12, value: 'ganttview', setAsDefault: false, viewStatus: false };

const seedPartial = () => [DASHBOARD, LIST, GANTT].forEach((row) => mockDbFor(PARTIAL).seed(T, { ...row }));

beforeEach(() => {
    Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
    jest.clearAllMocks();
});

describe('056-project-view-catalogue', () => {
    test('is a valid company-scoped migration listed after 055', () => {
        expect(() => validateMigration(migration, '056-project-view-catalogue')).not.toThrow();
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf('056-project-view-catalogue')).toBeGreaterThan(ids.indexOf('055-agent-session-project-ids'));
    });

    test('adds the missing views to every company and leaves stored rows as they are', async () => {
        seedPartial();

        const ctx = contextFor([PARTIAL, EMPTY]);
        await migration.up(ctx);

        expect(ctx.companies[PARTIAL]).toEqual({ ok: true, added: 17 });
        expect(ctx.companies[EMPTY]).toEqual({ ok: true, added: 20 });
        expect(rows(PARTIAL)).toHaveLength(20);
        expect(rows(EMPTY)).toHaveLength(20);
        expect(rows(PARTIAL).find((row) => row.keyName === 'ProjectListView')).toEqual(LIST);
        expect(rows(PARTIAL).find((row) => row.keyName === 'ProjectDashboard')).toEqual(DASHBOARD);
        expect(removeCache).toHaveBeenCalledWith(`ProjectTabs:${PARTIAL}`);
        expect(removeCache).toHaveBeenCalledWith(`ProjectTabs:${EMPTY}`);
        expect(mockDbFor(PARTIAL).calls.every((call) => call.companyId === PARTIAL)).toBe(true);
    });

    test('is idempotent: a second run adds nothing and clears no cache', async () => {
        seedPartial();
        await migration.up(contextFor([PARTIAL]));
        const after = rows(PARTIAL).map((row) => ({ ...row }));
        mockDbFor(PARTIAL).calls.length = 0;
        removeCache.mockClear();

        const again = contextFor([PARTIAL]);
        await migration.up(again);

        expect(again.companies[PARTIAL]).toEqual({ ok: true, added: 0 });
        expect(rows(PARTIAL)).toEqual(after);
        expect(writes(PARTIAL)).toHaveLength(0);
        expect(removeCache).not.toHaveBeenCalled();
    });

    test('writes nothing to a company that already has every view', async () => {
        await migration.up(contextFor([FULL]));
        mockDbFor(FULL).calls.length = 0;
        removeCache.mockClear();

        const ctx = contextFor([FULL]);
        await migration.up(ctx);

        expect(ctx.companies[FULL]).toEqual({ ok: true, added: 0 });
        expect(writes(FULL)).toHaveLength(0);
        expect(removeCache).not.toHaveBeenCalled();
    });
});
