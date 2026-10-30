/* Migration 079 builds task 064's connector indexes in every workspace, so the live-only unique indexes hold on
   a workspace whose connector_connections existed before they were declared. */
const mockBuilt = [];
const mockDropped = [];
const mockFailing = new Set();
const mockExisting = new Map();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: async (companyId, query, method) => {
        const id = String(companyId);
        if (method === 'listIndexes') {
            if (!mockExisting.has(id)) throw Object.assign(new Error('ns does not exist'), { code: 26 });
            return mockExisting.get(id);
        }
        if (method === 'dropIndex') {
            mockDropped.push({ companyId: id, type: query.type, name: query.data[0] });
            return undefined;
        }
        if (method !== 'createIndexes') throw new Error(`unexpected ${method} on ${query.type}`);
        if (mockFailing.has(id)) throw new Error('index build failed');
        mockBuilt.push({ companyId: id, type: query.type, data: query.data });
        return undefined;
    },
}));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { buildContext, listMigrations, dryRunMigrations, verifyMigrations } = require('../migrations');
const { createMemoryStore } = require('../migrations/store');
const { installWriteGuard } = require('../migrations/writeGuard');
const { formatDryRun } = require('../migrations/report');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { connectorConnectionsSchema, connectorAppsSchema, connectorUsageSchema } = require('../utils/mongo-handler/createSchema');
const migration = require('../migrations/079-connector-indexes');

const ID = '079-connector-indexes';
const C1 = '6f00000000000000000000c1';
const C2 = '6f00000000000000000000c2';
const TYPES = [SCHEMA_TYPE.CONNECTOR_CONNECTIONS, SCHEMA_TYPE.CONNECTOR_APPS, SCHEMA_TYPE.CONNECTOR_USAGE];
const quiet = { info: jest.fn(), error: jest.fn() };
const contextFor = (companies, crud = MongoDbCrudOpration) => buildContext({ MongoDbCrudOpration: crud, SCHEMA_TYPE, logger: quiet, listCompanies: async () => companies.map((_id) => ({ _id })) });

beforeEach(() => {
    mockBuilt.length = 0;
    mockDropped.length = 0;
    mockFailing.clear();
    mockExisting.clear();
});

describe(ID, () => {
    test('is a company migration, the only one of its number, listed after the ones before it', () => {
        const ids = listMigrations().map((m) => m.id);
        expect(ids.filter((id) => id.startsWith('079-'))).toEqual([ID]);
        expect(ids.indexOf(ID)).toBeGreaterThan(ids.indexOf('078-ai-access-rules'));
        expect(migration).toMatchObject({ id: ID, scope: 'company' });
    });

    test.each([
        ['connector_connections', connectorConnectionsSchema],
        ['connector_apps', connectorAppsSchema],
        ['connector_usage', connectorUsageSchema],
    ])('the %s schema declares every unique index it builds', (collection, schema) => {
        const declared = schema.indexes().filter(([, options]) => options.unique).map(([, options]) => options.name);
        expect(declared.sort()).toEqual([...migration.UNIQUE[collection]].sort());
    });

    test('builds the three connector collections in every workspace, and never drops an index', async () => {
        const ctx = contextFor([C1, C2]);
        await migration.up(ctx);
        expect(mockBuilt).toEqual([C1, C2].flatMap((companyId) => TYPES.map((type) => ({ companyId, type, data: [] }))));
        expect(ctx.companies).toEqual({ [C1]: { ok: true, indexes: migration.UNIQUE, dropped: [] }, [C2]: { ok: true, indexes: migration.UNIQUE, dropped: [] } });
        expect(mockDropped).toEqual([]);
    });

    test('drops the one-account-per-provider index of the first build and the account index without the companyId filter', async () => {
        mockExisting.set(C1, [
            { name: '_id_', key: { _id: 1 } },
            { name: 'connector_1_deletedStatusKey_1', key: { connector: 1, deletedStatusKey: 1 } },
            { name: 'one_live_per_provider', unique: true, partialFilterExpression: { provider: { $type: 'string' }, deletedStatusKey: { $eq: 0 } } },
            { name: 'one_live_per_account', unique: true, partialFilterExpression: { provider: { $type: 'string' }, 'account.id': { $type: 'string' }, deletedStatusKey: { $eq: 0 } } },
        ]);
        await migration.up(contextFor([C1]));
        expect(mockDropped).toEqual([
            { companyId: C1, type: SCHEMA_TYPE.CONNECTOR_CONNECTIONS, name: 'one_live_per_provider' },
            { companyId: C1, type: SCHEMA_TYPE.CONNECTOR_CONNECTIONS, name: 'one_live_per_account' },
        ]);
        expect(mockBuilt).toHaveLength(3);
    });

    test('leaves an account index that already filters on companyId', async () => {
        mockExisting.set(C1, [{ name: 'one_live_per_account', unique: true, partialFilterExpression: { companyId: { $type: 'string' }, provider: { $type: 'string' } } }]);
        await migration.up(contextFor([C1]));
        expect(mockDropped).toEqual([]);
    });

    test('running it again is harmless', async () => {
        await migration.up(contextFor([C1]));
        await expect(migration.up(contextFor([C1]))).resolves.toBeUndefined();
        expect(mockBuilt).toHaveLength(6);
    });

    test('goes on past a workspace that fails, and says which one', async () => {
        mockFailing.add(C1);
        const ctx = contextFor([C1, C2]);
        await expect(migration.up(ctx)).rejects.toThrow(`1 of 2 companies failed: ${C1}`);
        expect(mockBuilt.map((call) => call.companyId)).toEqual([C2, C2, C2]);
    });
});

describe(`${ID} under migrate up --dry-run and migrate verify`, () => {
    class Collection {
        constructor(db, name) { this.dbName = db; this.collectionName = name; }

        listIndexes() { return MongoDbCrudOpration(this.dbName, { type: this.collectionName, data: [] }, 'listIndexes'); }

        createIndexes(...data) { return MongoDbCrudOpration(this.dbName, { type: this.collectionName, data }, 'createIndexes'); }
    }
    class Db {}
    const driverCrud = (companyId, { type, data }, method) => new Collection(String(companyId), type)[method](...data);
    let guard;
    beforeAll(() => { guard = installWriteGuard({ Collection, Db }); });
    afterAll(() => guard.uninstall());

    test('plans one index build per collection and workspace, and builds nothing', async () => {
        const result = await dryRunMigrations({ store: createMemoryStore(), migrations: [migration], makeContext: () => contextFor([C1, C2], driverCrud), guard });
        expect(mockBuilt).toEqual([]);
        const [plan] = result.results;
        expect(plan).toMatchObject({ id: ID, status: 'plan' });
        expect(plan.writes).toEqual(expect.arrayContaining(TYPES.map((collection) => expect.objectContaining({ collection, op: 'createIndexes', calls: 2, databases: 2 }))));
        expect(formatDryRun(result)).toContain(ID);
    });

    test('migrate verify passes whether or not it has run', async () => {
        const pending = await verifyMigrations({ store: createMemoryStore(), migrations: [migration], makeContext: () => contextFor([C1], driverCrud), guard });
        expect(pending).toEqual({ results: [], notApplied: [ID] });
    });
});
