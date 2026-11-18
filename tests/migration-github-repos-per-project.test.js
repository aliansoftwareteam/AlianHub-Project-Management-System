/* Task 049: migration 075 turns a GitHub connection's one repository and its linked projects into a per-project mapping. */
const mockDbs = {};
const mockDbFor = (companyId) => { mockDbs[companyId] = mockDbs[companyId] || require('./fixtures/fakeMongo').create(); return mockDbs[companyId]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { buildContext, validateMigration, listMigrations } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { settingsCollectionDocs } = require('../Config/collections');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const migration = require('../migrations/075-github-repos-per-project');

const ID = '075-github-repos-per-project';
const C1 = '6f00000000000000000000c1';
const C2 = '6f00000000000000000000c2';
const P1 = '6f0000000000000000000a01';
const P2 = '6f0000000000000000000a02';
const CONN = SCHEMA_TYPE.INTEGRATION_CONNECTIONS;
const quiet = { info: jest.fn(), error: jest.fn() };
const contextFor = (companies) => buildContext({ MongoDbCrudOpration, SCHEMA_TYPE, settingsCollectionDocs, logger: quiet, listCompanies: async () => companies.map((_id) => ({ _id })) });
const rows = (companyId) => mockDbFor(companyId).store[CONN] || [];
const seed = (companyId, row) => mockDbFor(companyId).seed(CONN, { type: 'github', name: 'GitHub', enabled: true, deletedStatusKey: 0, ...row });

beforeEach(() => { Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; }); });

describe(ID, () => {
    test('is a valid company-scoped migration listed after 074', () => {
        expect(() => validateMigration(migration, ID)).not.toThrow();
        expect(migration.scope).toBe('company');
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf(ID)).toBe(ids.indexOf('074-mcp-old-defaults-for-existing-installs') + 1);
    });

    test('moves the repository and its projects into one entry with the cursor, in every workspace, and a second run changes nothing', async () => {
        const one = seed(C1, { config: { token: 'sealed', repo: 'acme/web', auth: 'oauth' }, projectIds: [P1, P2], sync: { cursor: '2026-10-05T00:00:00Z', lastSyncAt: new Date('2026-10-05T00:00:00Z'), failures: 2 } });
        const none = seed(C1, { config: { token: 'sealed' }, projectIds: [P1] });
        const noProject = seed(C1, { config: { token: 'sealed', repo: 'acme/api' } });
        const slack = mockDbFor(C1).seed(CONN, { type: 'slack', config: { default_channel: '#x' }, projectIds: [P1] });
        const other = seed(C2, { config: { token: 'sealed', repo: 'acme/api' }, projectIds: [P2] });

        await migration.up(contextFor([C1, C2]));
        expect(one.repos).toEqual([{ repo: 'acme/web', projectIds: [P1, P2], sync: { cursor: '2026-10-05T00:00:00Z', lastSyncAt: new Date('2026-10-05T00:00:00Z') } }]);
        expect(one.config).toEqual({ token: 'sealed', auth: 'oauth' });
        expect(one.projectIds).toBeUndefined();
        expect(other.repos).toEqual([{ repo: 'acme/api', projectIds: [P2], sync: {} }]);
        expect(none.repos).toBeUndefined();
        expect(noProject.repos).toBeUndefined();
        expect(noProject.config.repo).toBe('acme/api');
        expect(slack.repos).toBeUndefined();
        expect(slack.projectIds).toEqual([P1]);

        const before = JSON.stringify(rows(C1));
        await migration.up(contextFor([C1, C2]));
        expect(JSON.stringify(rows(C1))).toBe(before);
    });

    test('down puts a one-entry mapping back, and leaves a row mapping several repositories mapped', async () => {
        const single = seed(C1, { config: { token: 'sealed' }, repos: [{ repo: 'acme/web', projectIds: [P1], sync: { cursor: '2026-10-06T00:00:00Z' } }], sync: { lastSyncAt: null } });
        const several = seed(C1, { config: { token: 'sealed' }, repos: [{ repo: 'acme/web', projectIds: [P1], sync: {} }, { repo: 'acme/api', projectIds: [P2], sync: {} }] });
        await migration.down(contextFor([C1]));
        expect(single.config.repo).toBe('acme/web');
        expect(single.projectIds).toEqual([P1]);
        expect(single.sync.cursor).toBe('2026-10-06T00:00:00Z');
        expect(single.repos).toBeUndefined();
        expect(several.repos).toHaveLength(2);
    });
});
