/* Migration 077 builds the unique { builtIn } agents index in every workspace, so the Workspace Guide is made
   once on a workspace that existed before the index was declared. */
const mockBuilt = [];
const mockFailing = new Set();

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
const { formatDryRun } = require('../migrations/report');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { agentsSchema } = require('../utils/mongo-handler/createSchema');
const migration = require('../migrations/077-agents-built-in-index');

const ID = '077-agents-built-in-index';
const C1 = '6f00000000000000000000c1';
const C2 = '6f00000000000000000000c2';
const quiet = { info: jest.fn(), error: jest.fn() };
const contextFor = (companies, crud = MongoDbCrudOpration) => buildContext({ MongoDbCrudOpration: crud, SCHEMA_TYPE, logger: quiet, listCompanies: async () => companies.map((_id) => ({ _id })) });

beforeEach(() => {
    mockBuilt.length = 0;
    mockFailing.clear();
});

describe(ID, () => {
    test('is a company migration, the only one of its number, listed after the ones before it', () => {
        const ids = listMigrations().map((m) => m.id);
        expect(ids.filter((id) => id.startsWith('077-'))).toEqual([ID]);
        expect(ids.indexOf(ID)).toBeGreaterThan(ids.indexOf('076-project-guide-without-stored-guide'));
        expect(migration).toMatchObject({ id: ID, scope: 'company', BUILT_IN: { builtIn: 1 } });
    });

    test('the schema declares the unique index it builds', () => {
        const declared = agentsSchema.indexes().filter(([fields]) => JSON.stringify(fields) === JSON.stringify(migration.BUILT_IN));
        expect(declared).toEqual([[migration.BUILT_IN, expect.objectContaining({ unique: true })]]);
    });

    test('builds the agents indexes in every workspace, and never drops one', async () => {
        const ctx = contextFor([C1, C2]);
        await migration.up(ctx);
        expect(mockBuilt).toEqual([
            { companyId: C1, type: SCHEMA_TYPE.AGENTS, data: [] },
            { companyId: C2, type: SCHEMA_TYPE.AGENTS, data: [] },
        ]);
        expect(ctx.companies).toEqual({ [C1]: { ok: true, index: migration.INDEX }, [C2]: { ok: true, index: migration.INDEX } });
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
    });
});

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
        expect(plan.writes).toEqual([expect.objectContaining({ collection: SCHEMA_TYPE.AGENTS, op: 'createIndexes', calls: 2, databases: 2 })]);
        expect(formatDryRun(result)).toContain(ID);
    });

    test('migrate verify passes whether or not it has run', async () => {
        const pending = await verifyMigrations({ store: createMemoryStore(), migrations: [migration], makeContext: () => contextFor([C1], driverCrud), guard });
        expect(pending).toEqual({ results: [], notApplied: [ID] });
    });
});
