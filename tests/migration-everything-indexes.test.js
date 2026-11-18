/* Task 046 M2, slice E1: migration 067 builds in every workspace the two indexes the Everything
   view pages on. A workspace made afterwards gets them from the task schema. */
const mockBuilt = [];
const mockFailing = new Set();

/* No database here: createIndexes records which workspace asked, and nothing else is expected. */
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: async (companyId, query, method) => {
        if (method !== 'createIndexes') throw new Error(`unexpected ${method} on ${query.type}`);
        if (mockFailing.has(String(companyId))) throw new Error('index build failed');
        mockBuilt.push({ companyId: String(companyId), type: query.type, data: query.data });
        return undefined;
    },
}));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { buildContext, listMigrations, dryRunMigrations, verifyMigrations } = require('../migrations');
const { createMemoryStore } = require('../migrations/store');
const { installWriteGuard } = require('../migrations/writeGuard');
const { formatDryRun, formatVerify } = require('../migrations/report');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { taskSchema } = require('../utils/mongo-handler/createSchema');
const migration = require('../migrations/067-everything-indexes');

const ID = '067-everything-indexes';
const C1 = '6f00000000000000000000c1';
const C2 = '6f00000000000000000000c2';
const BY_UPDATED = { ProjectID: 1, deletedStatusKey: 1, updatedAt: -1, _id: 1 };
const BY_DUE = { ProjectID: 1, deletedStatusKey: 1, DueDate: 1, _id: 1 };
const quiet = { info: jest.fn(), error: jest.fn() };
const contextFor = (companies, crud = MongoDbCrudOpration) => buildContext({ MongoDbCrudOpration: crud, SCHEMA_TYPE, logger: quiet, listCompanies: async () => companies.map((_id) => ({ _id })) });

beforeEach(() => {
    mockBuilt.length = 0;
    mockFailing.clear();
});

describe(ID, () => {
    test('is a company migration listed after the task tree ones', () => {
        const ids = listMigrations().map((m) => m.id);
        expect(ids).toContain(ID);
        expect(ids.indexOf(ID)).toBeGreaterThan(ids.indexOf('064-task-ancestors'));
        expect(migration).toMatchObject({ id: ID, scope: 'company' });
    });

    test('the task schema declares both indexes, so a new workspace has them from its first task', () => {
        const declared = taskSchema.indexes().map(([key]) => key);
        expect(declared).toContainEqual(BY_UPDATED);
        expect(declared).toContainEqual(BY_DUE);
        expect(declared.filter((key) => JSON.stringify(key) === JSON.stringify(BY_UPDATED))).toHaveLength(1);
        expect(declared.filter((key) => JSON.stringify(key) === JSON.stringify(BY_DUE))).toHaveLength(1);
    });

    test('builds the declared task indexes in every workspace, and never drops one', async () => {
        const ctx = contextFor([C1, C2]);
        await migration.up(ctx);
        expect(mockBuilt).toEqual([
            { companyId: C1, type: SCHEMA_TYPE.TASKS, data: [] },
            { companyId: C2, type: SCHEMA_TYPE.TASKS, data: [] },
        ]);
        expect(ctx.companies).toEqual({ [C1]: { ok: true, indexes: 2 }, [C2]: { ok: true, indexes: 2 } });
    });

    test('running it again is harmless', async () => {
        await migration.up(contextFor([C1]));
        await expect(migration.up(contextFor([C1]))).resolves.toBeUndefined();
        expect(mockBuilt).toHaveLength(2);
    });

    test('goes on past a workspace that fails, and says which one', async () => {
        mockFailing.add(C1);
        const ctx = contextFor([C1, C2]);
        await expect(migration.up(ctx)).rejects.toThrow(`1 of 2 companies failed: ${C1}`);
        expect(mockBuilt.map((call) => call.companyId)).toEqual([C2]);
        expect(ctx.companies[C1]).toEqual({ ok: false, error: 'index build failed' });
    });
});

/* The dry run's write guard patches the driver's Collection; here that class answers from the mock
   above, so the migration runs its own code under the guard and its write is only recorded. */
describe(`${ID} under migrate up --dry-run and migrate verify`, () => {
    class Collection {
        constructor(db, name) { this.dbName = db; this.collectionName = name; }

        createIndexes(...data) { return MongoDbCrudOpration(this.dbName, { type: this.collectionName, data }, 'createIndexes'); }
    }
    class Db {}
    const driverCrud = (companyId, { type, data }, method) => new Collection(String(companyId), type)[method](...data);
    let guard;
    beforeAll(() => { guard = installWriteGuard({ Collection, Db }); });
    afterAll(() => guard.uninstall());

    test('plans one index build per workspace and builds nothing', async () => {
        const result = await dryRunMigrations({ store: createMemoryStore(), migrations: [migration], makeContext: () => contextFor([C1, C2], driverCrud), guard });

        expect(mockBuilt).toEqual([]);
        const [plan] = result.results;
        expect(plan).toMatchObject({ id: ID, status: 'plan' });
        expect(plan.writes).toEqual([expect.objectContaining({ collection: SCHEMA_TYPE.TASKS, op: 'createIndexes', calls: 2, databases: 2 })]);
        expect(formatDryRun(result)).toContain(ID);
    });

    /* `migrate verify` exits 1 on any failing check, and CI runs it against a database this has
       not run on yet as well as one it has. */
    test('migrate verify passes whether or not it has run, and reads nothing', async () => {
        const pending = await verifyMigrations({ store: createMemoryStore(), migrations: [migration], makeContext: () => contextFor([C1], driverCrud), guard });
        expect(pending).toEqual({ results: [], notApplied: [ID] });

        const store = createMemoryStore();
        store.docs.set(ID, { _id: ID, ok: true });
        const applied = await verifyMigrations({ store, migrations: [migration], makeContext: () => contextFor([C1, C2], driverCrud), guard });
        expect(applied.results).toEqual([{ id: ID, status: 'no-check', problems: [] }]);
        expect(formatVerify(applied)).toContain('0 fail');
        expect(mockBuilt).toEqual([]);
    });
});
