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
const { formatDryRun, formatVerify } = require('../migrations/report');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { notificationsSchema, mentionsSchema } = require('../utils/mongo-handler/createSchema');
const migration = require('../migrations/072-reader-row-indexes');

const ID = '072-reader-row-indexes';
const C1 = '6f00000000000000000000c1';
const C2 = '6f00000000000000000000c2';
const NOTICES_BY_READER = { receiverID: 1, taskId: 1 };
const MENTIONS_BY_READER = { mentionIds: 1, taskId: 1 };
const quiet = { info: jest.fn(), error: jest.fn() };
const contextFor = (companies, crud = MongoDbCrudOpration) => buildContext({ MongoDbCrudOpration: crud, SCHEMA_TYPE, logger: quiet, listCompanies: async () => companies.map((_id) => ({ _id })) });
const declaredOn = (schema, key) => schema.indexes().map(([fields]) => JSON.stringify(fields)).filter((fields) => fields === JSON.stringify(key));

beforeEach(() => {
    mockBuilt.length = 0;
    mockFailing.clear();
});

describe(ID, () => {
    test('is a company migration listed after the workspace rows, and the only 072', () => {
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf(ID)).toBeGreaterThan(ids.indexOf('071-workspace-company-rows'));
        expect(ids.filter((id) => id.startsWith('072-'))).toEqual([ID]);
        expect(migration).toMatchObject({ id: ID, scope: 'company', NOTICES_BY_READER, MENTIONS_BY_READER });
    });

    test('the two schemas declare the indexes, so a new workspace has them from its first row', () => {
        expect(declaredOn(notificationsSchema, NOTICES_BY_READER)).toHaveLength(1);
        expect(declaredOn(mentionsSchema, MENTIONS_BY_READER)).toHaveLength(1);
    });

    test('the read of the tasks a person\'s rows name asks by the fields the indexes lead with', async () => {
        const asked = [];
        jest.resetModules();
        jest.doMock('../utils/mongo-handler/mongoQueries', () => ({
            MongoDbCrudOpration: async (companyId, query, method) => { asked.push({ type: query.type, method, data: query.data }); return []; },
            validateObjectId: () => true,
        }));
        jest.doMock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {} } }));
        // eslint-disable-next-line global-require
        await require('../Modules/Comments/helpers/readerRows').noticesKeptFromReader(C1, '6f0000000000000000000001');

        const distinct = asked.filter((call) => call.method === 'distinct').map((call) => [call.type, call.data[0], Object.keys(call.data[1])]);
        expect(distinct).toEqual([
            [SCHEMA_TYPE.NOTIFICATIONS, 'taskId', ['receiverID']],
            [SCHEMA_TYPE.MENTIONS, 'taskId', ['mentionIds']],
        ]);
    });

    test('rewrites no row: it only builds indexes', () => {
        expect(Object.keys(migration).sort()).toEqual(['MENTIONS_BY_READER', 'NOTICES_BY_READER', 'id', 'indexCompany', 'scope', 'up']);
    });

    test('builds the declared indexes of both collections in every workspace, and never drops one', async () => {
        const ctx = contextFor([C1, C2]);
        await migration.up(ctx);
        expect(mockBuilt).toEqual([
            { companyId: C1, type: SCHEMA_TYPE.NOTIFICATIONS, data: [] },
            { companyId: C1, type: SCHEMA_TYPE.MENTIONS, data: [] },
            { companyId: C2, type: SCHEMA_TYPE.NOTIFICATIONS, data: [] },
            { companyId: C2, type: SCHEMA_TYPE.MENTIONS, data: [] },
        ]);
        expect(ctx.companies).toEqual({ [C1]: { ok: true, indexes: 2 }, [C2]: { ok: true, indexes: 2 } });
    });

    test('running it again is harmless', async () => {
        await migration.up(contextFor([C1]));
        await expect(migration.up(contextFor([C1]))).resolves.toBeUndefined();
        expect(mockBuilt).toHaveLength(4);
    });

    test('goes on past a workspace that fails, and says which one', async () => {
        mockFailing.add(C1);
        const ctx = contextFor([C1, C2]);
        await expect(migration.up(ctx)).rejects.toThrow(`1 of 2 companies failed: ${C1}`);
        expect(mockBuilt.map((call) => call.companyId)).toEqual([C2, C2]);
        expect(ctx.companies[C1]).toEqual({ ok: false, error: 'index build failed' });
    });
});

/* The dry run's write guard patches the driver's Collection; here that class answers from the mock
   above, so the migration runs its own code under the guard and its writes are only recorded. */
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

    test('says which index builds it would make in each workspace, and builds nothing', async () => {
        const result = await dryRunMigrations({ store: createMemoryStore(), migrations: [migration], makeContext: () => contextFor([C1, C2], driverCrud), guard });

        expect(mockBuilt).toEqual([]);
        const [plan] = result.results;
        expect(plan).toMatchObject({ id: ID, status: 'plan' });
        expect(plan.writes).toEqual([
            expect.objectContaining({ collection: SCHEMA_TYPE.NOTIFICATIONS, op: 'createIndexes', calls: 2, databases: 2 }),
            expect.objectContaining({ collection: SCHEMA_TYPE.MENTIONS, op: 'createIndexes', calls: 2, databases: 2 }),
        ]);
        const said = formatDryRun(result);
        [ID, SCHEMA_TYPE.NOTIFICATIONS, SCHEMA_TYPE.MENTIONS, 'createIndexes'].forEach((word) => expect(said).toContain(word));
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
