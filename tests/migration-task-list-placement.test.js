/* Task 046: migration 068 removes from a task's sprintArray everything but the list's id and name and the
   folder's id and name, in every tenant, and leaves the four as they are. */
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
const { driverWrites, isObjectId } = require('./fixtures/realTaskStore');
const migration = require('../migrations/068-task-list-placement');

const ID = '068-task-list-placement';
const C1 = '6f00000000000000000000c1';
const C2 = '6f00000000000000000000c2';
const PROJECT = '6f0000000000000000000a01';
const SPRINT = '6f0000000000000000000e01';
const OTHER_SPRINT = '6f0000000000000000000e02';
const FOLDER = '6f0000000000000000000f01';
const MEMBER = '6f0000000000000000000003';
const oid = (id) => new mongoose.Types.ObjectId(id);
const quiet = { info: jest.fn(), error: jest.fn() };
const contextFor = (companies, crud = MongoDbCrudOpration) => buildContext({ MongoDbCrudOpration: crud, SCHEMA_TYPE, settingsCollectionDocs, logger: quiet, listCompanies: async () => companies.map((_id) => ({ _id })) });

const tasks = (companyId) => mockDbFor(companyId).store[SCHEMA_TYPE.TASKS] || [];
const taskNamed = (companyId, name) => tasks(companyId).find((t) => t.TaskName === name);
const listOf = (companyId, name) => JSON.parse(JSON.stringify(taskNamed(companyId, name).sprintArray));
let seeded = 0;
const seedTask = (companyId, TaskName, sprintArray, extra = {}) => {
    seeded += 1;
    return mockDbFor(companyId).seed(SCHEMA_TYPE.TASKS, { _id: oid(`6f00000000000000${String(seeded).padStart(8, '0')}`), TaskName, ProjectID: oid(PROJECT), updatedAt: new Date('2026-09-01T00:00:00.000Z'), ...(sprintArray === undefined ? {} : { sprintArray }), ...extra });
};

/* A list as the pickers handed it to a move before this release. */
const wholeList = (extra = {}) => ({
    _id: SPRINT, id: oid(SPRINT), name: 'Sprint 1', value: 'SPRINT_1', projectId: PROJECT, tasks: 4, archiveTaskCount: 1, private: true, deletedStatusKey: 0,
    AssigneeUserId: [MEMBER], watchers: { [MEMBER]: 'all' }, favouriteTasks: [{ userId: MEMBER }], isDuplicateSprint: true, ...extra,
});

/* One tenant as upgrades find it. */
const seedOlderCompany = (companyId) => {
    seedTask(companyId, 'whole list', wholeList());
    seedTask(companyId, 'whole list in a folder', wholeList({ folderId: oid(FOLDER), folderName: 'Design' }));
    seedTask(companyId, 'older element', { id: oid(OTHER_SPRINT), name: 'Sprint 2', value: 'SPRINT_2' });
    seedTask(companyId, 'stored document', { _id: oid(OTHER_SPRINT), name: 'Sprint 2', projectId: PROJECT, tasks: 2 });
    seedTask(companyId, 'four fields', { id: oid(SPRINT), name: 'Sprint 1', folderId: oid(FOLDER), folderName: 'Design' });
    seedTask(companyId, 'two fields', { id: oid(SPRINT), name: 'Sprint 1' });
    seedTask(companyId, 'legacy key at the root', { id: 'firebase-sprint', name: 'Old', folderId: '' });
    seedTask(companyId, 'a list that is not an object', []);
    seedTask(companyId, 'no list at all', undefined);
};

const bulkWrites = (companyId) => mockDbFor(companyId).calls.filter((c) => c.method === 'bulkWrite');
const opsOf = (companyId) => bulkWrites(companyId).flatMap((c) => c.data[0].map((op) => op.updateOne));

beforeEach(() => {
    Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
    seeded = 0;
    jest.clearAllMocks();
});

describe(ID, () => {
    test('is a valid company-scoped migration, the last one listed', () => {
        expect(() => validateMigration(migration, ID)).not.toThrow();
        expect(migration.scope).toBe('company');
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf(ID)).toBeGreaterThan(ids.indexOf('067-everything-indexes'));
        expect(ids.filter((id) => id.startsWith('068-'))).toEqual([ID]);
    });

    test('leaves each task the id, the name and the folder of its list', async () => {
        seedOlderCompany(C1);
        const ctx = contextFor([C1]);

        await migration.up(ctx);

        expect(ctx.companies[C1]).toEqual({ ok: true, tasks: 4, named: 1, unaddressable: 0 });
        expect(listOf(C1, 'whole list')).toEqual({ id: SPRINT, name: 'Sprint 1' });
        expect(listOf(C1, 'whole list in a folder')).toEqual({ id: SPRINT, name: 'Sprint 1', folderId: FOLDER, folderName: 'Design' });
        expect(listOf(C1, 'older element')).toEqual({ id: OTHER_SPRINT, name: 'Sprint 2' });
        expect(listOf(C1, 'stored document')).toEqual({ id: OTHER_SPRINT, name: 'Sprint 2' });
        expect(isObjectId(taskNamed(C1, 'stored document').sprintArray.id)).toBe(true);
        expect(listOf(C1, 'four fields')).toEqual({ id: SPRINT, name: 'Sprint 1', folderId: FOLDER, folderName: 'Design' });
        expect(listOf(C1, 'legacy key at the root')).toEqual({ id: 'firebase-sprint', name: 'Old', folderId: '' });
        expect(taskNamed(C1, 'a list that is not an object').sprintArray).toEqual([]);
        expect(taskNamed(C1, 'no list at all')).not.toHaveProperty('sprintArray');
        expect(quiet.info).toHaveBeenCalledWith(expect.stringContaining(`[migrations] 068 ${C1}`));
    });

    test('removes keys and never rewrites the four, so a task moved meanwhile keeps its new list', async () => {
        seedOlderCompany(C1);

        await migration.up(contextFor([C1]));

        const ops = opsOf(C1);
        expect(ops).toHaveLength(4);
        ops.forEach(({ filter, update, timestamps }) => {
            expect(timestamps).toBe(false);
            expect(Object.keys(update.$unset).every((path) => /^sprintArray\.[^.]+$/.test(path))).toBe(true);
            expect(Object.keys(update.$unset).map((path) => path.split('.')[1]).filter((key) => ['id', 'name', 'folderId', 'folderName'].includes(key))).toEqual([]);
            expect(Object.keys(update.$set || {})).toEqual(update.$set ? ['sprintArray.id'] : []);
            expect(Object.keys(filter)).toEqual(update.$set ? ['_id', 'sprintArray.id'] : ['_id']);
        });
        const named = ops.find((op) => op.update.$set);
        expect(named.filter['sprintArray.id']).toEqual({ $exists: false });
        expect(String(named.update.$set['sprintArray.id'])).toBe(OTHER_SPRINT);
    });

    test('reaches the driver as written and keeps updatedAt', async () => {
        seedOlderCompany(C1);
        await migration.up(contextFor([C1]));

        const [call] = bulkWrites(C1);
        const { writes, error } = await driverWrites('bulkWrite', call.data);

        expect(error).toBeNull();
        const sent = writes[0].args[0].map((op) => op.updateOne);
        expect(sent).toHaveLength(4);
        sent.forEach(({ update }) => {
            expect(Object.keys(update).filter((key) => !['$unset', '$set'].includes(key))).toEqual([]);
            expect(Object.keys(update.$set || {}).filter((path) => path !== 'sprintArray.id')).toEqual([]);
        });
        expect(sent.flatMap(({ update }) => Object.keys(update.$unset))).toEqual(expect.arrayContaining(['sprintArray.AssigneeUserId', 'sprintArray.watchers', 'sprintArray.value', 'sprintArray._id']));
        expect(tasks(C1).every((task) => task.updatedAt.toISOString() === '2026-09-01T00:00:00.000Z')).toBe(true);
    });

    test('leaves a key it cannot address in an update and counts it', async () => {
        seedTask(C1, 'dotted key', { id: oid(SPRINT), name: 'Sprint 1', 'a.b': 1, $where: 2 });
        seedTask(C1, 'dotted and plain', { id: oid(SPRINT), name: 'Sprint 1', 'a.b': 1, tasks: 4 });
        const ctx = contextFor([C1]);

        await migration.up(ctx);

        expect(ctx.companies[C1]).toEqual({ ok: true, tasks: 1, named: 0, unaddressable: 3 });
        expect(listOf(C1, 'dotted and plain')).toEqual({ id: SPRINT, name: 'Sprint 1', 'a.b': 1 });
        expect(await migration.verify(contextFor([C1]))).toEqual([]);
    });

    test('reads every task in pages and writes in batches of 500', async () => {
        const total = migration.PAGE_SIZE + migration.BATCH_SIZE + 1;
        for (let i = 0; i < total; i += 1) seedTask(C1, `task ${i}`, i % 2 ? wholeList() : { id: oid(SPRINT), name: 'Sprint 1' });

        const ctx = contextFor([C1]);
        await migration.up(ctx);

        const finds = mockDbFor(C1).calls.filter((c) => c.method === 'find');
        expect(finds.map((c) => c.data[2].limit)).toEqual([migration.PAGE_SIZE, migration.PAGE_SIZE]);
        expect(finds.every((c) => Object.keys(c.data[1]).join() === 'sprintArray')).toBe(true);
        expect(migration.BATCH_SIZE).toBe(500);
        expect(bulkWrites(C1).map((c) => c.data[0].length)).toEqual([migration.BATCH_SIZE, migration.BATCH_SIZE, Math.floor(total / 2) - 2 * migration.BATCH_SIZE]);
        expect(ctx.companies[C1]).toMatchObject({ tasks: Math.floor(total / 2) });
        expect(tasks(C1).every((t) => Object.keys(t.sprintArray).every((key) => ['id', 'name'].includes(key)))).toBe(true);
    });

    test('is safe to run twice: the second run finds nothing and changes nothing', async () => {
        seedOlderCompany(C1);
        await migration.up(contextFor([C1]));
        const after = JSON.stringify(tasks(C1));
        mockDbFor(C1).calls.length = 0;

        const again = contextFor([C1]);
        await migration.up(again);

        expect(again.companies[C1]).toEqual({ ok: true, tasks: 0, named: 0, unaddressable: 0 });
        expect(bulkWrites(C1)).toEqual([]);
        expect(JSON.stringify(tasks(C1))).toBe(after);
    });

    test('keeps every tenant to its own database', async () => {
        seedOlderCompany(C1);
        seedTask(C2, 'other tenant', wholeList({ _id: OTHER_SPRINT, id: oid(OTHER_SPRINT), name: 'Sprint 2' }));
        seedTask(C2, 'other tenant, clean', { id: oid(SPRINT), name: 'Sprint 1' });

        const ctx = contextFor([C1, C2]);
        await migration.up(ctx);

        expect(ctx.companies[C2]).toEqual({ ok: true, tasks: 1, named: 0, unaddressable: 0 });
        expect(listOf(C2, 'other tenant')).toEqual({ id: OTHER_SPRINT, name: 'Sprint 2' });
        [C1, C2].forEach((companyId) => expect(mockDbFor(companyId).calls.every((c) => String(c.companyId) === companyId)).toBe(true));
        const c1Ids = new Set(tasks(C1).map((task) => String(task._id)));
        expect(opsOf(C2).every((op) => !c1Ids.has(String(op.filter._id)))).toBe(true);
    });

    test('one failing tenant does not stop the others', async () => {
        seedOlderCompany(C1);
        seedTask(C2, 'other tenant', wholeList());
        const failingFirst = (companyId, q, method) => (String(companyId) === C1 ? Promise.reject(new Error('unreachable')) : MongoDbCrudOpration(companyId, q, method));
        const ctx = contextFor([C1, C2], failingFirst);

        await expect(migration.up(ctx)).rejects.toThrow('1 of 2 companies failed');

        expect(ctx.companies[C1]).toEqual({ ok: false, error: 'unreachable' });
        expect(listOf(C2, 'other tenant')).toEqual({ id: SPRINT, name: 'Sprint 1' });
    });

    test('verify counts the tasks it would still rewrite, and none on a database written by this release', async () => {
        seedOlderCompany(C1);
        seedTask(C2, 'other tenant', wholeList());
        const healthy = '6f00000000000000000000c3';
        seedTask(healthy, 'in a folder', { id: oid(SPRINT), name: 'Sprint 1', folderId: oid(FOLDER), folderName: 'Design' });
        seedTask(healthy, 'at the root', { id: oid(SPRINT), name: 'Sprint 1' });
        seedTask(healthy, 'raw insert', []);
        seedTask(healthy, 'no list', undefined);

        expect(await migration.verify(contextFor([C1, C2, healthy, '6f00000000000000000000c4']))).toEqual([
            `${C1} 4 tasks still store more of a list than its id, name and folder`,
            `${C2} 1 task still stores more of a list than its id, name and folder`,
        ]);

        await migration.up(contextFor([C1, C2, healthy]));

        expect(await migration.verify(contextFor([C1, C2, healthy]))).toEqual([]);
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

    test('plans the rewrite per company and writes nothing', async () => {
        seedOlderCompany(C1);
        seedTask(C2, 'other tenant', wholeList());
        const before = JSON.stringify([tasks(C1), tasks(C2)]);

        const result = await dryRunMigrations({ store: createMemoryStore(), migrations: [migration], makeContext: () => contextFor([C1, C2], driverCrud), guard });

        expect(JSON.stringify([tasks(C1), tasks(C2)])).toBe(before);
        expect(bulkWrites(C1).concat(bulkWrites(C2))).toEqual([]);
        const [plan] = result.results;
        expect(plan).toMatchObject({ id: ID, status: 'plan' });
        expect(plan.writes.map(({ collection, op }) => `${op} ${collection}`)).toEqual(['bulkWrite tasks', 'bulkWrite tasks']);
        expect(plan.writes.reduce((sum, w) => sum + w.documents, 0)).toBe(5);
        expect(plan.companies).toEqual({
            [C1]: { ok: true, tasks: 4, named: 1, unaddressable: 0 },
            [C2]: { ok: true, tasks: 1, named: 0, unaddressable: 0 },
        });
        const text = formatDryRun(result);
        expect(text).toContain(`    ${C1}  tasks 4, named 1, unaddressable 0`);
        expect(text).not.toContain('Sprint 1');
        expect(text).not.toContain(MEMBER);
    });

    test('verify is not run for a migration that has not been applied', async () => {
        seedOlderCompany(C1);
        const makeContext = () => contextFor([C1], driverCrud);

        const pending = await verifyMigrations({ store: createMemoryStore(), migrations: [migration], makeContext, guard });

        expect(pending).toEqual({ results: [], notApplied: [ID] });
    });

    test('verify runs read-only, passes on a clean database and passes once the migration has run', async () => {
        const store = createMemoryStore();
        store.docs.set(ID, { _id: ID, ok: true });
        const makeContext = () => contextFor([C1], driverCrud);
        seedTask(C1, 'clean', { id: oid(SPRINT), name: 'Sprint 1' });

        const clean = await verifyMigrations({ store, migrations: [migration], makeContext, guard });
        expect(clean.results).toEqual([{ id: ID, status: 'pass', problems: [], error: null }]);

        seedOlderCompany(C1);
        const failing = await verifyMigrations({ store, migrations: [migration], makeContext, guard });
        expect(failing.results).toEqual([{ id: ID, status: 'fail', problems: [`${C1} 4 tasks still store more of a list than its id, name and folder`], error: null }]);

        await migration.up(contextFor([C1]));
        const passing = await verifyMigrations({ store, migrations: [migration], makeContext, guard });
        expect(passing.results).toEqual([{ id: ID, status: 'pass', problems: [], error: null }]);
        expect(formatVerify(passing)).toContain(`${ID}  pass`);
    });
});
