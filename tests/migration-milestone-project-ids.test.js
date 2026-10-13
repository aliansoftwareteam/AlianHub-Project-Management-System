/* Task 040 phase 2: migration 045 rewrites a milestone's projectId from text to ObjectId in every
   tenant, leaves anything that is not an id alone and says so. */
const mongoose = require('mongoose');

const mockDbs = {};
const mockDbFor = (companyId) => { mockDbs[companyId] = mockDbs[companyId] || require('./fixtures/fakeMongo').create(); return mockDbs[companyId]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { buildContext, validateMigration, listMigrations, dryRunMigrations, verifyMigrations } = require('../migrations');
const { createMemoryStore } = require('../migrations/store');
const { installWriteGuard } = require('../migrations/writeGuard');
const { formatDryRun, formatVerify } = require('../migrations/report');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { settingsCollectionDocs } = require('../Config/collections');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { milestone: milestoneSchema } = require('../utils/mongo-handler/createSchema');
const { realModelStore, isObjectId } = require('./fixtures/realModelStore');
const migration = require('../migrations/045-milestone-project-ids');

const ID = '045-milestone-project-ids';
const C1 = '6f00000000000000000000c1';
const C2 = '6f00000000000000000000c2';
const PROJECT = '6f0000000000000000000a01';
const OTHER_PROJECT = '6f0000000000000000000a02';
const UPDATED_AT = new Date('2026-01-02T03:04:05.000Z');
const oid = (id) => new mongoose.Types.ObjectId(id);
const quiet = { info: jest.fn(), error: jest.fn() };
const contextFor = (companies, crud = MongoDbCrudOpration) => buildContext({ MongoDbCrudOpration: crud, SCHEMA_TYPE, settingsCollectionDocs, logger: quiet, listCompanies: async () => companies.map((_id) => ({ _id })) });

const milestones = (companyId) => mockDbFor(companyId).store[SCHEMA_TYPE.MILESTONE] || [];
const named = (companyId, name) => milestones(companyId).find((m) => m.milestoneName === name);
const seedMilestone = (companyId, milestoneName, projectId) => mockDbFor(companyId).seed(SCHEMA_TYPE.MILESTONE, { milestoneName, amount: 10, projectId, updatedAt: UPDATED_AT });

/* One tenant as upgrades find it: text ids, an id already converted, a value that is not an id. */
const seedLegacyCompany = (companyId) => {
    seedMilestone(companyId, 'text id', PROJECT);
    seedMilestone(companyId, 'other text id', OTHER_PROJECT);
    seedMilestone(companyId, 'already an ObjectId', oid(PROJECT));
    seedMilestone(companyId, 'legacy key', 'firebase-project');
};

const bulkWrites = (companyId) => mockDbFor(companyId).calls.filter((c) => c.method === 'bulkWrite');

beforeEach(() => {
    Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
    jest.clearAllMocks();
});

describe(ID, () => {
    test('is a valid company-scoped migration listed after 044', () => {
        expect(() => validateMigration(migration, ID)).not.toThrow();
        expect(migration.scope).toBe('company');
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf(ID)).toBe(ids.indexOf('044-task-sprint-ids') + 1);
    });

    test('converts every text id, keeps the rest of the milestone, and reports what it left alone', async () => {
        seedLegacyCompany(C1);
        const ctx = contextFor([C1]);

        await migration.up(ctx);

        expect(ctx.companies[C1]).toEqual({ ok: true, converted: 2, invalid: 1 });
        const converted = named(C1, 'text id');
        expect(isObjectId(converted.projectId)).toBe(true);
        expect({ ...converted, projectId: String(converted.projectId) }).toMatchObject({ milestoneName: 'text id', amount: 10, projectId: PROJECT, updatedAt: UPDATED_AT });
        expect(isObjectId(named(C1, 'other text id').projectId)).toBe(true);
        expect(named(C1, 'legacy key').projectId).toBe('firebase-project');
        expect(quiet.info).toHaveBeenCalledWith(expect.stringContaining(`[migrations] 045 ${C1}`));
    });

    test('rewrites only the project id, only while it still holds the text it read, and keeps updatedAt', async () => {
        seedLegacyCompany(C1);
        await migration.up(contextFor([C1]));

        const [call] = bulkWrites(C1);
        const ops = call.data[0].map((op) => op.updateOne);
        expect(ops).toHaveLength(2);
        ops.forEach((op) => {
            expect(op.timestamps).toBe(false);
            expect(Object.keys(op.update)).toEqual(['$set']);
            expect(Object.keys(op.update.$set)).toEqual(['projectId']);
            expect(op.filter.projectId).toBe(String(op.update.$set.projectId));
        });

        const { writes, error } = await realModelStore('milestone', milestoneSchema).driverWrites('bulkWrite', call.data);
        expect(error).toBeNull();
        writes[0].args[0].forEach(({ updateOne }) => {
            expect(isObjectId(updateOne.update.$set.projectId)).toBe(true);
            expect(typeof updateOne.filter.projectId).toBe('string');
            expect(updateOne.update.$set).not.toHaveProperty('updatedAt');
        });
    });

    test('writes in batches', async () => {
        for (let i = 0; i < migration.BATCH_SIZE + 1; i += 1) seedMilestone(C1, `milestone ${i}`, PROJECT);

        const ctx = contextFor([C1]);
        await migration.up(ctx);

        expect(bulkWrites(C1).map((c) => c.data[0].length)).toEqual([migration.BATCH_SIZE, 1]);
        expect(ctx.companies[C1]).toMatchObject({ converted: migration.BATCH_SIZE + 1 });
        expect(milestones(C1).every((m) => isObjectId(m.projectId))).toBe(true);
    });

    test('is safe to run twice: the second run converts nothing and changes nothing', async () => {
        seedLegacyCompany(C1);
        await migration.up(contextFor([C1]));
        const after = JSON.stringify(milestones(C1));
        mockDbFor(C1).calls.length = 0;

        const again = contextFor([C1]);
        await migration.up(again);

        expect(again.companies[C1]).toEqual({ ok: true, converted: 0, invalid: 1 });
        expect(bulkWrites(C1)).toEqual([]);
        expect(JSON.stringify(milestones(C1))).toBe(after);
    });

    test('keeps every tenant to its own database', async () => {
        seedLegacyCompany(C1);
        seedMilestone(C2, 'other tenant', OTHER_PROJECT);

        const ctx = contextFor([C1, C2]);
        await migration.up(ctx);

        expect(ctx.companies[C2]).toEqual({ ok: true, converted: 1, invalid: 0 });
        [C1, C2].forEach((companyId) => expect(mockDbFor(companyId).calls.every((c) => String(c.companyId) === companyId)).toBe(true));
    });

    test('verify counts the milestones still holding a text id, and reports none after the migration', async () => {
        seedLegacyCompany(C1);
        seedMilestone(C2, 'other tenant', OTHER_PROJECT);

        expect(await migration.verify(contextFor([C1, C2]))).toEqual([
            `${C1} 2 milestones still store a project id as text`,
            `${C2} 1 milestone still stores a project id as text`,
        ]);

        await migration.up(contextFor([C1, C2]));

        expect(await migration.verify(contextFor([C1, C2]))).toEqual([]);
    });
});

/* The dry run's write guard patches the driver's Collection; here that class answers from fakeMongo,
   so the migration runs its own code under the guard and every write it tries is only recorded. */
describe(`${ID} under migrate up --dry-run and migrate verify`, () => {
    class Collection {
        constructor(db, name) { this.dbName = db; this.collectionName = name; }

        run(method, data) { return mockDbFor(this.dbName).crud(this.dbName, { type: this.collectionName, data }, method); }

        find(...data) { return this.run('find', data); }

        countDocuments(...data) { return this.run('countDocuments', data); }

        bulkWrite(...data) { return this.run('bulkWrite', data); }
    }
    class Db {}
    const driverCrud = (companyId, { type, data }, method) => new Collection(String(companyId), type)[method](...data);
    let guard;
    beforeAll(() => { guard = installWriteGuard({ Collection, Db }); });
    afterAll(() => guard.uninstall());

    test('plans the conversion per company and writes nothing', async () => {
        seedLegacyCompany(C1);
        seedMilestone(C2, 'other tenant', OTHER_PROJECT);
        const before = JSON.stringify([milestones(C1), milestones(C2)]);

        const result = await dryRunMigrations({ store: createMemoryStore(), migrations: [migration], makeContext: () => contextFor([C1, C2], driverCrud), guard });

        expect(JSON.stringify([milestones(C1), milestones(C2)])).toBe(before);
        expect(bulkWrites(C1).concat(bulkWrites(C2))).toEqual([]);
        const [plan] = result.results;
        expect(plan).toMatchObject({ id: ID, status: 'plan' });
        expect(plan.writes.map(({ collection, op }) => `${op} ${collection}`)).toEqual([`bulkWrite ${SCHEMA_TYPE.MILESTONE}`, `bulkWrite ${SCHEMA_TYPE.MILESTONE}`]);
        expect(plan.writes.reduce((sum, w) => sum + w.documents, 0)).toBe(3);
        expect(plan.companies).toEqual({
            [C1]: { ok: true, converted: 2, invalid: 1 },
            [C2]: { ok: true, converted: 1, invalid: 0 },
        });
        const text = formatDryRun(result);
        expect(text).toContain(`    ${C1}  converted 2, invalid 1`);
        expect(text).toContain(`    ${C2}  converted 1, invalid 0`);
        process.stdout.write(`\n${text}\n`);
    });

    test('verify runs read-only and passes once the migration has run', async () => {
        seedLegacyCompany(C1);
        const store = createMemoryStore();
        store.docs.set(ID, { _id: ID, ok: true });
        const makeContext = () => contextFor([C1], driverCrud);

        const failing = await verifyMigrations({ store, migrations: [migration], makeContext, guard });
        expect(failing.results).toEqual([{ id: ID, status: 'fail', problems: [`${C1} 2 milestones still store a project id as text`], error: null }]);

        await migration.up(contextFor([C1]));
        const passing = await verifyMigrations({ store, migrations: [migration], makeContext, guard });
        expect(passing.results).toEqual([{ id: ID, status: 'pass', problems: [], error: null }]);
        expect(formatVerify(passing)).toContain(`${ID}  pass`);
    });
});
