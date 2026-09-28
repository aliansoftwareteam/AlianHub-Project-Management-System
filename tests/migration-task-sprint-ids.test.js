/* Task 040 phase 2: migration 044 rewrites a task's sprintArray.id and sprintArray.folderId from
   text to ObjectId in every tenant, leaves anything that is not an id alone and says so. */
const mongoose = require('mongoose');
const sift = require('sift');

const mockDbs = {};
const mockDbFor = (companyId) => { mockDbs[companyId] = mockDbs[companyId] || require('./fixtures/fakeMongo').create(); return mockDbs[companyId]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Comments/controller', () => ({ updateCommentSprint: jest.fn(async () => true) }));

const { buildContext, validateMigration, listMigrations, dryRunMigrations, verifyMigrations } = require('../migrations');
const { createMemoryStore } = require('../migrations/store');
const { installWriteGuard } = require('../migrations/writeGuard');
const { formatDryRun, formatVerify } = require('../migrations/report');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { settingsCollectionDocs } = require('../Config/collections');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { driverWrites, isObjectId } = require('./fixtures/realTaskStore');
const migration = require('../migrations/044-task-sprint-ids');

const ID = '044-task-sprint-ids';
const C1 = '6f00000000000000000000c1';
const C2 = '6f00000000000000000000c2';
const PROJECT = '6f0000000000000000000a01';
const SPRINT = '6f0000000000000000000e01';
const OTHER_SPRINT = '6f0000000000000000000e02';
const FOLDER = '6f0000000000000000000f01';
const oid = (id) => new mongoose.Types.ObjectId(id);
const quiet = { info: jest.fn(), error: jest.fn() };
const contextFor = (companies, crud = MongoDbCrudOpration) => buildContext({ MongoDbCrudOpration: crud, SCHEMA_TYPE, settingsCollectionDocs, logger: quiet, listCompanies: async () => companies.map((_id) => ({ _id })) });

const tasks = (companyId) => mockDbFor(companyId).store[SCHEMA_TYPE.TASKS] || [];
const taskNamed = (companyId, name) => tasks(companyId).find((t) => t.TaskName === name);
const seedTask = (companyId, TaskName, sprintArray) => mockDbFor(companyId).seed(SCHEMA_TYPE.TASKS, { TaskName, ProjectID: oid(PROJECT), sprintArray });

/* One tenant as upgrades find it: text ids, ids already converted, a Firebase key, a sprint at the root. */
const seedLegacyCompany = (companyId) => {
    seedTask(companyId, 'text ids', { id: SPRINT, name: 'Sprint 1', value: 'SPRINT_1', folderId: FOLDER, folderName: 'Design' });
    seedTask(companyId, 'text sprint, no folder', { id: OTHER_SPRINT, name: 'Sprint 2' });
    seedTask(companyId, 'already ObjectIds', { id: oid(SPRINT), name: 'Sprint 1', folderId: oid(FOLDER), folderName: 'Design' });
    seedTask(companyId, 'legacy key at the root', { id: 'firebase-sprint', name: 'Old', folderId: '' });
};

const bulkWrites = (companyId) => mockDbFor(companyId).calls.filter((c) => c.method === 'bulkWrite');

beforeEach(() => {
    Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
    jest.clearAllMocks();
});

describe(ID, () => {
    test('is a valid company-scoped migration listed after 043', () => {
        expect(() => validateMigration(migration, ID)).not.toThrow();
        expect(migration.scope).toBe('company');
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf(ID)).toBe(ids.indexOf('043-knowledge-chunk-size') + 1);
    });

    test('converts every text id, keeps the rest of the element, and reports what it left alone', async () => {
        seedLegacyCompany(C1);
        const ctx = contextFor([C1]);

        await migration.up(ctx);

        expect(ctx.companies[C1]).toEqual({ ok: true, tasks: 2, converted: 3, invalid: 1, empty: 1 });
        const converted = taskNamed(C1, 'text ids').sprintArray;
        expect(isObjectId(converted.id) && isObjectId(converted.folderId)).toBe(true);
        expect({ ...converted, id: String(converted.id), folderId: String(converted.folderId) }).toEqual({ id: SPRINT, name: 'Sprint 1', value: 'SPRINT_1', folderId: FOLDER, folderName: 'Design' });
        expect(isObjectId(taskNamed(C1, 'text sprint, no folder').sprintArray.id)).toBe(true);
        expect(taskNamed(C1, 'text sprint, no folder').sprintArray).not.toHaveProperty('folderId');
        expect(taskNamed(C1, 'legacy key at the root').sprintArray).toEqual({ id: 'firebase-sprint', name: 'Old', folderId: '' });
        expect(quiet.info).toHaveBeenCalledWith(expect.stringContaining(`[migrations] 044 ${C1}`));
    });

    test('rewrites only the id paths, only while they still hold the text it read, and keeps updatedAt', async () => {
        seedLegacyCompany(C1);
        await migration.up(contextFor([C1]));

        const [call] = bulkWrites(C1);
        const { writes } = await driverWrites('bulkWrite', call.data);
        const ops = writes[0].args[0].map((op) => op.updateOne);
        expect(ops).toHaveLength(2);
        ops.forEach(({ filter, update }) => {
            expect(Object.keys(update)).toEqual(['$set']);
            Object.entries(update.$set).forEach(([key, value]) => {
                expect(['sprintArray.id', 'sprintArray.folderId']).toContain(key);
                expect(isObjectId(value)).toBe(true);
                expect(filter[key]).toBe(String(value));
            });
        });
    });

    test('writes in batches', async () => {
        for (let i = 0; i < migration.BATCH_SIZE + 1; i += 1) seedTask(C1, `task ${i}`, { id: SPRINT, name: 'Sprint 1' });

        const ctx = contextFor([C1]);
        await migration.up(ctx);

        expect(bulkWrites(C1).map((c) => c.data[0].length)).toEqual([migration.BATCH_SIZE, 1]);
        expect(ctx.companies[C1]).toMatchObject({ tasks: migration.BATCH_SIZE + 1, converted: migration.BATCH_SIZE + 1 });
        expect(tasks(C1).every((t) => isObjectId(t.sprintArray.id))).toBe(true);
    });

    test('is safe to run twice: the second run converts nothing and changes nothing', async () => {
        seedLegacyCompany(C1);
        await migration.up(contextFor([C1]));
        const after = JSON.stringify(tasks(C1));
        mockDbFor(C1).calls.length = 0;

        const again = contextFor([C1]);
        await migration.up(again);

        expect(again.companies[C1]).toEqual({ ok: true, tasks: 0, converted: 0, invalid: 1, empty: 1 });
        expect(bulkWrites(C1)).toEqual([]);
        expect(JSON.stringify(tasks(C1))).toBe(after);
    });

    test('keeps every tenant to its own database', async () => {
        seedLegacyCompany(C1);
        seedTask(C2, 'other tenant', { id: OTHER_SPRINT, name: 'Sprint 2', folderId: FOLDER });

        const ctx = contextFor([C1, C2]);
        await migration.up(ctx);

        expect(ctx.companies[C2]).toEqual({ ok: true, tasks: 1, converted: 2, invalid: 0, empty: 0 });
        [C1, C2].forEach((companyId) => expect(mockDbFor(companyId).calls.every((c) => String(c.companyId) === companyId)).toBe(true));
    });

    test('verify counts the tasks still holding a text id, and reports none after the migration', async () => {
        seedLegacyCompany(C1);
        seedTask(C2, 'other tenant', { id: OTHER_SPRINT, name: 'Sprint 2' });

        expect(await migration.verify(contextFor([C1, C2]))).toEqual([
            `${C1} 2 tasks still store a sprint or folder id as text`,
            `${C2} 1 task still stores a sprint or folder id as text`,
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
        seedTask(C2, 'other tenant', { id: OTHER_SPRINT, name: 'Sprint 2', folderId: FOLDER });
        const before = JSON.stringify([tasks(C1), tasks(C2)]);

        const result = await dryRunMigrations({ store: createMemoryStore(), migrations: [migration], makeContext: () => contextFor([C1, C2], driverCrud), guard });

        expect(JSON.stringify([tasks(C1), tasks(C2)])).toBe(before);
        expect(bulkWrites(C1).concat(bulkWrites(C2))).toEqual([]);
        const [plan] = result.results;
        expect(plan).toMatchObject({ id: ID, status: 'plan' });
        expect(plan.writes.map(({ collection, op }) => `${op} ${collection}`)).toEqual(['bulkWrite tasks', 'bulkWrite tasks']);
        expect(plan.writes.reduce((sum, w) => sum + w.documents, 0)).toBe(3);
        expect(plan.companies).toEqual({
            [C1]: { ok: true, tasks: 2, converted: 3, invalid: 1, empty: 1 },
            [C2]: { ok: true, tasks: 1, converted: 2, invalid: 0, empty: 0 },
        });
        const text = formatDryRun(result);
        expect(text).toContain(`    ${C1}  tasks 2, converted 3, invalid 1, empty 1`);
        expect(text).toContain(`    ${C2}  tasks 1, converted 2, invalid 0, empty 0`);
        process.stdout.write(`\n${text}\n`);
    });

    test('verify runs read-only and passes once the migration has run', async () => {
        seedLegacyCompany(C1);
        const store = createMemoryStore();
        store.docs.set(ID, { _id: ID, ok: true });
        const makeContext = () => contextFor([C1], driverCrud);

        const failing = await verifyMigrations({ store, migrations: [migration], makeContext, guard });
        expect(failing.results).toEqual([{ id: ID, status: 'fail', problems: [`${C1} 2 tasks still store a sprint or folder id as text`], error: null }]);

        await migration.up(contextFor([C1]));
        const passing = await verifyMigrations({ store, migrations: [migration], makeContext, guard });
        expect(passing.results).toEqual([{ id: ID, status: 'pass', problems: [], error: null }]);
        expect(formatVerify(passing)).toContain(`${ID}  pass`);
    });
});

/* An ObjectId equals only an ObjectId, as on the server; tagging keeps sift from reading it as its hex text. */
const bson = (value) => {
    if (value instanceof mongoose.Types.ObjectId) return { objectId: value.toHexString() };
    if (Array.isArray(value)) return value.map(bson);
    if (value && typeof value === 'object' && !(value instanceof Date) && !(value instanceof RegExp)) {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, bson(v)]));
    }
    return value;
};

describe('a migrated task is still found by the phase 1 readers, which match either form for one release', () => {
    const settle = async () => { for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

    test('relinking a project to its sprints and folders matches the converted ids and the rows left as they were', async () => {
        const { updateTaksSprints, updateTaksFolders } = require('../Modules/projectSetting/controller');
        seedLegacyCompany(C1);
        const db = mockDbFor(C1);
        db.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(SPRINT), projectId: oid(PROJECT) });
        db.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(OTHER_SPRINT), legacyId: 'firebase-sprint', projectId: oid(PROJECT) });
        db.seed(SCHEMA_TYPE.FOLDERS, { _id: oid(FOLDER), legacyId: 'firebase-folder', projectId: oid(PROJECT) });
        await migration.up(contextFor([C1]));
        const rows = tasks(C1).map((t) => ({ ...t }));
        db.calls.length = 0;

        await updateTaksSprints(PROJECT, C1);
        await updateTaksFolders(PROJECT, C1);
        await settle();

        const filters = db.calls.filter((c) => c.type === SCHEMA_TYPE.TASKS && c.method === 'updateMany').map((c) => c.data[0]);
        const found = (filter) => rows.filter((row) => sift(bson(filter))(bson(row))).map((row) => row.TaskName).sort();
        expect(filters.map(found)).toEqual([
            ['already ObjectIds', 'text ids'],
            ['legacy key at the root', 'text sprint, no folder'],
            ['already ObjectIds', 'text ids'],
        ]);
    });
});
