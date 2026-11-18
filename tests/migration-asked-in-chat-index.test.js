/* Task 047, T-2: migration 073 builds in every workspace the index the work queue reads a person's waiting
   questions through. A workspace made afterwards gets it from the schema. No row is rewritten. */
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
const { projectFindingsSchema } = require('../utils/mongo-handler/createSchema');
const { ASKED_IN_CHAT } = require('../Modules/Agents/manager/findings');
const migration = require('../migrations/073-asked-in-chat-index');

const ID = '073-asked-in-chat-index';
const INDEX = 'asked_in_chat_by_person';
const C1 = '6f00000000000000000000c1';
const C2 = '6f00000000000000000000c2';
const BY_PERSON = { userId: 1, status: 1, openedAt: 1 };
const quiet = { info: jest.fn(), error: jest.fn() };
const contextFor = (companies, crud = MongoDbCrudOpration) => buildContext({ MongoDbCrudOpration: crud, SCHEMA_TYPE, logger: quiet, listCompanies: async () => companies.map((_id) => ({ _id })) });

beforeEach(() => {
    mockBuilt.length = 0;
    mockFailing.clear();
});

describe(ID, () => {
    test('is a company migration, the only one of its number, listed after the ones before it', () => {
        const ids = listMigrations().map((m) => m.id);
        expect(ids.filter((id) => id.startsWith('073-'))).toEqual([ID]);
        expect(ids.indexOf(ID)).toBeGreaterThan(ids.indexOf('071-workspace-company-rows'));
        expect(migration).toMatchObject({ id: ID, scope: 'company', INDEX, BY_PERSON });
    });

    test('the schema declares the index it builds, kept to the questions, so a new workspace has it from its first row', () => {
        const declared = projectFindingsSchema.indexes().filter(([, options]) => options.name === INDEX);
        expect(declared).toEqual([[BY_PERSON, expect.objectContaining({ partialFilterExpression: { rule: ASKED_IN_CHAT } })]]);
    });

    test('writes nothing but the index: it has no row to rewrite', () => {
        expect(Object.keys(migration).sort()).toEqual(['BY_PERSON', 'INDEX', 'id', 'indexCompany', 'scope', 'up']);
    });

    test('builds the declared indexes of the collection in every workspace, and never drops one', async () => {
        const ctx = contextFor([C1, C2]);
        await migration.up(ctx);
        expect(mockBuilt).toEqual([
            { companyId: C1, type: SCHEMA_TYPE.PROJECT_FINDINGS, data: [] },
            { companyId: C2, type: SCHEMA_TYPE.PROJECT_FINDINGS, data: [] },
        ]);
        expect(ctx.companies).toEqual({ [C1]: { ok: true, index: INDEX }, [C2]: { ok: true, index: INDEX } });
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

    test('plans one index build per workspace, names the index it would build, and builds nothing', async () => {
        const result = await dryRunMigrations({ store: createMemoryStore(), migrations: [migration], makeContext: () => contextFor([C1, C2], driverCrud), guard });

        expect(mockBuilt).toEqual([]);
        const [plan] = result.results;
        expect(plan).toMatchObject({ id: ID, status: 'plan' });
        expect(plan.writes).toEqual([expect.objectContaining({ collection: SCHEMA_TYPE.PROJECT_FINDINGS, op: 'createIndexes', calls: 2, databases: 2 })]);
        const report = formatDryRun(result);
        expect(report).toContain(ID);
        [C1, C2].forEach((companyId) => expect(report).toContain(`${companyId}  index ${INDEX}`));
    });

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
