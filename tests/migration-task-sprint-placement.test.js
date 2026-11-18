/* Migration 046 repairs the tasks whose sprintArray holds the whole sprint document (an `_id`, no
   `id`), which the sample-task generator stored, into the element the app's writers store. A task
   whose sprint is gone is left as it is and counted. */
const mongoose = require('mongoose');

const mockDbs = {};
const mockDbFor = (companyId) => { mockDbs[companyId] = mockDbs[companyId] || require('./fixtures/fakeMongo').create(); return mockDbs[companyId]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));

const { buildContext, validateMigration, listMigrations, dryRunMigrations, verifyMigrations } = require('../migrations');
const { createMemoryStore } = require('../migrations/store');
const { installWriteGuard } = require('../migrations/writeGuard');
const { formatDryRun, formatVerify } = require('../migrations/report');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { settingsCollectionDocs } = require('../Config/collections');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { driverWrites, isObjectId } = require('./fixtures/realTaskStore');
const migration = require('../migrations/046-task-sprint-placement');

const ID = '046-task-sprint-placement';
const C1 = '6f00000000000000000000c1';
const C2 = '6f00000000000000000000c2';
const PROJECT = '6f0000000000000000000a01';
const ROOT_SPRINT = '6f0000000000000000000e01';
const FOLDER_SPRINT = '6f0000000000000000000e02';
const GONE_SPRINT = '6f0000000000000000000e09';
const FOLDER = '6f0000000000000000000f01';
const STALE_FOLDER = '6f0000000000000000000f02';
const UPDATED_AT = new Date('2026-01-02T03:04:05.000Z');
const oid = (id) => new mongoose.Types.ObjectId(id);
const quiet = { info: jest.fn(), error: jest.fn() };
const contextFor = (companies, crud = MongoDbCrudOpration) => buildContext({ MongoDbCrudOpration: crud, SCHEMA_TYPE, settingsCollectionDocs, logger: quiet, listCompanies: async () => companies.map((_id) => ({ _id })) });

const tasks = (companyId) => mockDbFor(companyId).store[SCHEMA_TYPE.TASKS] || [];
const taskNamed = (companyId, name) => tasks(companyId).find((t) => t.TaskName === name);
const seedTask = (companyId, TaskName, sprintArray, extra = {}) => mockDbFor(companyId).seed(SCHEMA_TYPE.TASKS, { TaskName, ProjectID: oid(PROJECT), sprintArray, updatedAt: UPDATED_AT, ...extra });
const sprintDoc = (_id, name, extra = {}) => ({ _id, name, projectId: PROJECT, tasks: 8, deletedStatusKey: 0, createdAt: '2026-01-01T00:00:00.000Z', ...extra });

const seedSprints = (companyId) => {
    const db = mockDbFor(companyId);
    db.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(ROOT_SPRINT), name: 'Getting started', projectId: oid(PROJECT) });
    db.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(FOLDER_SPRINT), name: 'Sprint 7', projectId: oid(PROJECT), folderId: oid(FOLDER) });
    db.seed(SCHEMA_TYPE.FOLDERS, { _id: oid(FOLDER), name: 'Q4', projectId: oid(PROJECT) });
};

/* One tenant as the sample generator left it: the sprint document stored with its _id as an
   ObjectId or as text (a demo sprint went through JSON), a task already in the app's shape, and a
   task whose sprint has since been removed. */
const seedLegacyCompany = (companyId) => {
    seedSprints(companyId);
    seedTask(companyId, 'sample at the root', sprintDoc(oid(ROOT_SPRINT), 'List'), { sprintId: oid(ROOT_SPRINT), folderObjId: oid(STALE_FOLDER) });
    seedTask(companyId, 'sample in a folder', sprintDoc(FOLDER_SPRINT, 'Sprint 7', { folderId: FOLDER }), { sprintId: oid(FOLDER_SPRINT) });
    seedTask(companyId, 'app shape', { id: oid(ROOT_SPRINT), name: 'Getting started' }, { sprintId: oid(ROOT_SPRINT) });
    seedTask(companyId, 'sprint removed', sprintDoc(oid(GONE_SPRINT), 'Old'), { sprintId: oid(GONE_SPRINT) });
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
        expect(ids.indexOf(ID)).toBeGreaterThan(ids.indexOf('044-task-sprint-ids'));
    });

    test('rewrites the sprint document into the element the app stores and leaves an orphan alone', async () => {
        seedLegacyCompany(C1);
        const ctx = contextFor([C1]);

        await migration.up(ctx);

        expect(ctx.companies[C1]).toEqual({ ok: true, converted: 2, orphaned: 1 });
        const root = taskNamed(C1, 'sample at the root');
        expect(root.sprintArray).toEqual({ id: expect.anything(), name: 'Getting started' });
        expect(isObjectId(root.sprintArray.id) && String(root.sprintArray.id) === ROOT_SPRINT).toBe(true);
        expect(root).not.toHaveProperty('folderObjId');
        expect(root.updatedAt).toEqual(UPDATED_AT);

        const inFolder = taskNamed(C1, 'sample in a folder');
        expect(inFolder.sprintArray).toMatchObject({ name: 'Sprint 7', folderName: 'Q4' });
        expect([String(inFolder.sprintArray.id), String(inFolder.sprintArray.folderId)]).toEqual([FOLDER_SPRINT, FOLDER]);
        expect(isObjectId(inFolder.sprintArray.id) && isObjectId(inFolder.sprintArray.folderId)).toBe(true);
        expect(String(inFolder.folderObjId)).toBe(FOLDER);
        expect(String(inFolder.sprintId)).toBe(FOLDER_SPRINT);

        expect(taskNamed(C1, 'app shape').sprintArray).toEqual({ id: oid(ROOT_SPRINT), name: 'Getting started' });
        expect(taskNamed(C1, 'sprint removed').sprintArray).toEqual(sprintDoc(oid(GONE_SPRINT), 'Old'));
        expect(quiet.info).toHaveBeenCalledWith(expect.stringContaining(`[migrations] 046 ${C1}`));
    });

    test('writes only while the task still holds the sprint document it read, and keeps updatedAt', async () => {
        seedLegacyCompany(C1);
        await migration.up(contextFor([C1]));

        const [call] = bulkWrites(C1);
        const ops = call.data[0].map((op) => op.updateOne);
        expect(ops).toHaveLength(2);
        ops.forEach(({ filter, timestamps }) => {
            expect(timestamps).toBe(false);
            expect(filter['sprintArray._id']).toBeDefined();
            expect(filter['sprintArray.id']).toEqual({ $exists: false });
        });

        const { writes, error } = await driverWrites('bulkWrite', call.data);
        expect(error).toBeNull();
        writes[0].args[0].forEach(({ updateOne }) => {
            const { $set } = updateOne.update;
            expect(isObjectId($set.sprintArray.id) && isObjectId($set.sprintId)).toBe(true);
            expect($set).not.toHaveProperty('updatedAt');
        });
    });

    test('a task rewritten after the read is skipped', async () => {
        seedLegacyCompany(C1);
        const real = contextFor([C1]);
        const racing = contextFor([C1], async (companyId, q, method) => {
            if (method === 'bulkWrite') taskNamed(C1, 'sample at the root').sprintArray = { id: oid(FOLDER_SPRINT), name: 'Moved meanwhile' };
            return real.company(companyId, q, method);
        });

        await migration.up(racing);

        expect(taskNamed(C1, 'sample at the root').sprintArray).toEqual({ id: oid(FOLDER_SPRINT), name: 'Moved meanwhile' });
    });

    test('writes in batches', async () => {
        seedSprints(C1);
        for (let i = 0; i < migration.BATCH_SIZE + 1; i += 1) seedTask(C1, `task ${i}`, sprintDoc(oid(ROOT_SPRINT), 'List'), { sprintId: oid(ROOT_SPRINT) });

        const ctx = contextFor([C1]);
        await migration.up(ctx);

        expect(bulkWrites(C1).map((c) => c.data[0].length)).toEqual([migration.BATCH_SIZE, 1]);
        expect(ctx.companies[C1]).toMatchObject({ converted: migration.BATCH_SIZE + 1 });
        expect(tasks(C1).every((t) => isObjectId(t.sprintArray.id))).toBe(true);
    });

    test('is safe to run twice: the second run converts nothing and changes nothing', async () => {
        seedLegacyCompany(C1);
        await migration.up(contextFor([C1]));
        const after = JSON.stringify(tasks(C1));
        mockDbFor(C1).calls.length = 0;

        const again = contextFor([C1]);
        await migration.up(again);

        expect(again.companies[C1]).toEqual({ ok: true, converted: 0, orphaned: 1 });
        expect(bulkWrites(C1)).toEqual([]);
        expect(JSON.stringify(tasks(C1))).toBe(after);
    });

    test('keeps every tenant to its own database', async () => {
        seedLegacyCompany(C1);
        seedSprints(C2);
        seedTask(C2, 'other tenant', sprintDoc(FOLDER_SPRINT, 'Sprint 7', { folderId: FOLDER }), { sprintId: oid(FOLDER_SPRINT) });

        const ctx = contextFor([C1, C2]);
        await migration.up(ctx);

        expect(ctx.companies[C2]).toEqual({ ok: true, converted: 1, orphaned: 0 });
        [C1, C2].forEach((companyId) => expect(mockDbFor(companyId).calls.every((c) => String(c.companyId) === companyId)).toBe(true));
    });

    test('verify counts the tasks it can still repair, and reports none after the migration', async () => {
        seedLegacyCompany(C1);
        seedSprints(C2);
        seedTask(C2, 'other tenant', sprintDoc(ROOT_SPRINT, 'List'), { sprintId: oid(ROOT_SPRINT) });

        expect(await migration.verify(contextFor([C1, C2]))).toEqual([
            `${C1} 2 tasks still store the sprint document as sprintArray`,
            `${C2} 1 task still stores the sprint document as sprintArray`,
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

        findOne(...data) { return this.run('findOne', data); }

        bulkWrite(...data) { return this.run('bulkWrite', data); }
    }
    class Db {}
    const driverCrud = (companyId, { type, data }, method) => new Collection(String(companyId), type)[method](...data);
    let guard;
    beforeAll(() => { guard = installWriteGuard({ Collection, Db }); });
    afterAll(() => guard.uninstall());

    test('plans the repair per company and writes nothing', async () => {
        seedLegacyCompany(C1);
        seedSprints(C2);
        seedTask(C2, 'other tenant', sprintDoc(FOLDER_SPRINT, 'Sprint 7', { folderId: FOLDER }), { sprintId: oid(FOLDER_SPRINT) });
        const before = JSON.stringify([tasks(C1), tasks(C2)]);

        const result = await dryRunMigrations({ store: createMemoryStore(), migrations: [migration], makeContext: () => contextFor([C1, C2], driverCrud), guard });

        expect(JSON.stringify([tasks(C1), tasks(C2)])).toBe(before);
        expect(bulkWrites(C1).concat(bulkWrites(C2))).toEqual([]);
        const [plan] = result.results;
        expect(plan).toMatchObject({ id: ID, status: 'plan' });
        expect(plan.writes.map(({ collection, op }) => `${op} ${collection}`)).toEqual(['bulkWrite tasks', 'bulkWrite tasks']);
        expect(plan.writes.reduce((sum, w) => sum + w.documents, 0)).toBe(3);
        expect(plan.companies).toEqual({
            [C1]: { ok: true, converted: 2, orphaned: 1 },
            [C2]: { ok: true, converted: 1, orphaned: 0 },
        });
        const text = formatDryRun(result);
        expect(text).toContain(`    ${C1}  converted 2, orphaned 1`);
        expect(text).toContain(`    ${C2}  converted 1, orphaned 0`);
        process.stdout.write(`\n${text}\n`);
    });

    test('verify runs read-only and passes once the migration has run', async () => {
        seedLegacyCompany(C1);
        const store = createMemoryStore();
        store.docs.set(ID, { _id: ID, ok: true });
        const makeContext = () => contextFor([C1], driverCrud);

        const failing = await verifyMigrations({ store, migrations: [migration], makeContext, guard });
        expect(failing.results).toEqual([{ id: ID, status: 'fail', problems: [`${C1} 2 tasks still store the sprint document as sprintArray`], error: null }]);

        await migration.up(contextFor([C1]));
        const passing = await verifyMigrations({ store, migrations: [migration], makeContext, guard });
        expect(passing.results).toEqual([{ id: ID, status: 'pass', problems: [], error: null }]);
        expect(formatVerify(passing)).toContain(`${ID}  pass`);
    });
});
