/* Task 046 M2, slice N1: migration 064 stores on every subtask its chain of parents (`ancestors`,
   root first). A chain it cannot build (a missing parent, a cycle) and a subtask outside its
   root's sprint are counted and left as they are; a row below level three, which the automation
   createSubtask could make, is re-hung on its level-two ancestor. */
const mongoose = require('mongoose');

const mockDbs = {};
const mockIndexes = {};
const mockDbFor = (companyId) => { mockDbs[companyId] = mockDbs[companyId] || require('./fixtures/fakeMongo').create(); return mockDbs[companyId]; };
const mockIndexesOf = (companyId) => mockIndexes[companyId] || [{ name: '_id_', key: { _id: 1 } }];

/* fakeMongo keeps no indexes: createIndexes builds here what the task schema declares. */
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: async (companyId, q, method) => {
        const id = String(companyId);
        if (method === 'listIndexes') return mockIndexesOf(id);
        if (method === 'createIndexes') {
            const { taskSchema } = jest.requireActual('../utils/mongo-handler/createSchema');
            mockIndexes[id] = [{ name: '_id_', key: { _id: 1 } }, ...taskSchema.indexes().map(([key]) => ({ name: Object.keys(key).join('_'), key }))];
        }
        return mockDbFor(id).crud(companyId, q, method);
    },
}));
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
const { driverWrites } = require('./fixtures/realTaskStore');
const migration = require('../migrations/064-task-ancestors');

const ID = '064-task-ancestors';
const C1 = '6f00000000000000000000c1';
const C2 = '6f00000000000000000000c2';
const SPRINT = '6f0000000000000000000e01';
const OTHER_SPRINT = '6f0000000000000000000e02';
const UPDATED_AT = new Date('2026-01-02T03:04:05.000Z');
const T = Object.fromEntries([
    'root', 'child', 'secondChild', 'grandchild', 'deep', 'deeper',
    'gone', 'orphan', 'underOrphan', 'loopA', 'loopB', 'underLoop',
    'otherRoot', 'elsewhere', 'legacyKey', 'plain',
].map((name, index) => [name, `6f00000000000000000001${String(index + 1).padStart(2, '0')}`]));
const oid = (id) => new mongoose.Types.ObjectId(id);
const quiet = { info: jest.fn(), error: jest.fn() };
const contextFor = (companies, crud = MongoDbCrudOpration) => buildContext({ MongoDbCrudOpration: crud, SCHEMA_TYPE, settingsCollectionDocs, logger: quiet, listCompanies: async () => companies.map((_id) => ({ _id })) });

const tasks = (companyId) => mockDbFor(companyId).store[SCHEMA_TYPE.TASKS] || [];
const task = (companyId, name) => tasks(companyId).find((t) => String(t._id) === T[name]);
const seedTask = (companyId, name, parent, extra = {}) => mockDbFor(companyId).seed(SCHEMA_TYPE.TASKS, {
    _id: oid(T[name]), TaskName: name, sprintId: oid(SPRINT), updatedAt: UPDATED_AT,
    ...(parent === undefined ? { isParentTask: true } : { isParentTask: false, ParentTaskId: parent }),
    ...extra,
});

/* root > child > grandchild > deep > deeper is two levels too deep; secondChild is a plain subtask. */
const seedTree = (companyId) => {
    seedTask(companyId, 'root', undefined, { subTasks: 2 });
    seedTask(companyId, 'child', T.root, { subTasks: 1 });
    seedTask(companyId, 'secondChild', T.root);
    seedTask(companyId, 'grandchild', T.child, { subTasks: 1 });
    seedTask(companyId, 'deep', T.grandchild, { subTasks: 1 });
    seedTask(companyId, 'deeper', T.deep);
};

const seedUnbuildable = (companyId) => {
    seedTask(companyId, 'orphan', T.gone);
    seedTask(companyId, 'underOrphan', T.orphan);
    seedTask(companyId, 'legacyKey', 'firebase-task-key');
    seedTask(companyId, 'loopA', T.loopB);
    seedTask(companyId, 'loopB', T.loopA);
    seedTask(companyId, 'underLoop', T.loopA);
    seedTask(companyId, 'otherRoot', undefined, { subTasks: 1 });
    seedTask(companyId, 'elsewhere', T.otherRoot, { sprintId: oid(OTHER_SPRINT) });
    seedTask(companyId, 'plain', undefined, { ParentTaskId: '' });
};

const seedCompany = (companyId) => { seedTree(companyId); seedUnbuildable(companyId); };
const LEFT_ALONE = ['orphan', 'underOrphan', 'legacyKey', 'loopA', 'loopB', 'underLoop', 'elsewhere'];
const FULL_COUNTS = { subtasks: 12, written: 5, rehung: 2, recounted: 3, orphans: 3, cycles: 3, otherSprint: 1 };

const callsOf = (companyId, method) => mockDbFor(companyId).calls.filter((c) => c.method === method);
const bulkWrites = (companyId) => callsOf(companyId, 'bulkWrite');
const opsOf = (companyId) => bulkWrites(companyId).flatMap((c) => c.data[0].map((op) => op.updateOne));
const opFor = (companyId, name, field) => opsOf(companyId).find((op) => String(op.filter._id) === T[name] && field in op.update.$set);

beforeEach(() => {
    Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
    Object.keys(mockIndexes).forEach((k) => { delete mockIndexes[k]; });
    jest.clearAllMocks();
});

describe(ID, () => {
    test('is a valid company-scoped migration listed right after 063', () => {
        expect(() => validateMigration(migration, ID)).not.toThrow();
        expect(migration.scope).toBe('company');
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf(ID)).toBe(ids.indexOf('063-page-comments') + 1);
    });

    test('a subtask and a sub-subtask store their chain root first, and a top-level task is not written', async () => {
        seedCompany(C1);
        const ctx = contextFor([C1]);

        await migration.up(ctx);

        expect(ctx.companies[C1]).toEqual({ ok: true, ...FULL_COUNTS });
        expect(task(C1, 'child').ancestors).toEqual([T.root]);
        expect(task(C1, 'secondChild').ancestors).toEqual([T.root]);
        expect(task(C1, 'grandchild').ancestors).toEqual([T.root, T.child]);
        ['root', 'otherRoot', 'plain'].forEach((name) => expect(task(C1, name)).not.toHaveProperty('ancestors'));
        expect(opsOf(C1).some((op) => [T.root, T.otherRoot, T.plain].includes(String(op.filter._id)))).toBe(false);
        expect(quiet.info).toHaveBeenCalledWith(expect.stringContaining(`[migrations] 064 ${C1}`));
    });

    test('a missing parent, a cycle and a subtask outside its root\'s sprint are counted and left alone', async () => {
        seedCompany(C1);
        const before = JSON.stringify(LEFT_ALONE.map((name) => task(C1, name)));

        await migration.up(contextFor([C1]));

        expect(JSON.stringify(LEFT_ALONE.map((name) => task(C1, name)))).toBe(before);
        LEFT_ALONE.forEach((name) => expect(task(C1, name)).not.toHaveProperty('ancestors'));
        expect(task(C1, 'otherRoot').subTasks).toBe(1);
    });

    test('a row below level three is re-hung on its level-two ancestor, and both parents\' counts follow', async () => {
        seedTree(C1);
        const ctx = contextFor([C1]);

        await migration.up(ctx);

        expect(ctx.companies[C1]).toEqual({ ok: true, subtasks: 5, written: 5, rehung: 2, recounted: 3, orphans: 0, cycles: 0, otherSprint: 0 });
        ['deep', 'deeper'].forEach((name) => {
            expect(task(C1, name).ParentTaskId).toBe(T.child);
            expect(task(C1, name).ancestors).toEqual([T.root, T.child]);
            expect(task(C1, name).isParentTask).toBe(false);
        });
        expect(task(C1, 'grandchild').ParentTaskId).toBe(T.child);
        expect(task(C1, 'child').subTasks).toBe(3);
        expect(task(C1, 'grandchild').subTasks).toBe(0);
        expect(task(C1, 'deep').subTasks).toBe(0);
        expect(task(C1, 'root').subTasks).toBe(2);
    });

    test('a count never goes below zero, and a parent without one is matched as it was read', async () => {
        seedTask(C1, 'root', undefined, { subTasks: 1 });
        seedTask(C1, 'child', T.root);
        seedTask(C1, 'grandchild', T.child);
        seedTask(C1, 'deep', T.grandchild);
        const ctx = contextFor([C1]);

        await migration.up(ctx);

        expect(ctx.companies[C1]).toMatchObject({ rehung: 1, recounted: 1 });
        expect(task(C1, 'child').subTasks).toBe(1);
        expect(opFor(C1, 'child', 'subTasks').filter).toEqual({ _id: oid(T.child), subTasks: null });
        expect(task(C1, 'grandchild')).not.toHaveProperty('subTasks');

        const { writes } = await driverWrites('bulkWrite', bulkWrites(C1)[0].data);
        const counted = writes[0].args[0].map(({ updateOne }) => updateOne).find(({ update }) => 'subTasks' in update.$set);
        expect(counted.filter.subTasks).toBeNull();
        expect(counted.update.$set).toEqual({ subTasks: 1 });
    });

    test('every write names what it read and keeps updatedAt', async () => {
        seedCompany(C1);

        await migration.up(contextFor([C1]));

        expect(opsOf(C1)).toHaveLength(FULL_COUNTS.written + FULL_COUNTS.recounted);
        opsOf(C1).forEach((op) => expect(op.timestamps).toBe(false));
        expect(opFor(C1, 'grandchild', 'ancestors').filter).toEqual({ _id: oid(T.grandchild), ParentTaskId: T.child });
        expect(opFor(C1, 'deep', 'ancestors')).toMatchObject({ filter: { ParentTaskId: T.grandchild }, update: { $set: { ParentTaskId: T.child, ancestors: [T.root, T.child] } } });
        expect(opFor(C1, 'child', 'subTasks')).toMatchObject({ filter: { subTasks: 1 }, update: { $set: { subTasks: 3 } } });
        tasks(C1).forEach((row) => expect(row.updatedAt).toEqual(UPDATED_AT));
    });

    test('the strict task schema hands the writes to the driver whole, without an updatedAt', async () => {
        seedCompany(C1);
        await migration.up(contextFor([C1]));

        const { writes, error } = await driverWrites('bulkWrite', bulkWrites(C1)[0].data);

        expect(error).toBeNull();
        const sent = writes[0].args[0].map(({ updateOne }) => updateOne);
        expect(sent).toHaveLength(FULL_COUNTS.written + FULL_COUNTS.recounted);
        sent.forEach(({ update }) => expect(update.$set).not.toHaveProperty('updatedAt'));
        const deep = sent.find(({ filter, update }) => String(filter._id) === T.deep && update.$set.ancestors);
        expect(deep.filter.ParentTaskId).toBe(T.grandchild);
        expect(deep.update.$set).toEqual({ ParentTaskId: T.child, ancestors: [T.root, T.child] });
    });

    test('a subtask given another parent after the read is skipped', async () => {
        seedCompany(C1);
        const real = contextFor([C1]);
        const racing = contextFor([C1], async (companyId, q, method) => {
            if (method === 'bulkWrite') task(C1, 'secondChild').ParentTaskId = T.otherRoot;
            return real.company(companyId, q, method);
        });

        await migration.up(racing);

        expect(task(C1, 'secondChild')).not.toHaveProperty('ancestors');
        expect(task(C1, 'child').ancestors).toEqual([T.root]);
    });

    test('a parent whose count changed after the read keeps the new count', async () => {
        seedTree(C1);
        const real = contextFor([C1]);
        const racing = contextFor([C1], async (companyId, q, method) => {
            if (method === 'bulkWrite') task(C1, 'child').subTasks = 7;
            return real.company(companyId, q, method);
        });

        await migration.up(racing);

        expect(task(C1, 'child').subTasks).toBe(7);
        expect(task(C1, 'child').ancestors).toEqual([T.root]);
    });

    test('writes in batches', async () => {
        seedTask(C1, 'root', undefined);
        for (let i = 0; i < migration.BATCH_SIZE + 1; i += 1) mockDbFor(C1).seed(SCHEMA_TYPE.TASKS, { TaskName: `subtask ${i}`, ParentTaskId: T.root, sprintId: oid(SPRINT) });

        const ctx = contextFor([C1]);
        await migration.up(ctx);

        expect(bulkWrites(C1).map((c) => c.data[0].length)).toEqual([migration.BATCH_SIZE, 1]);
        expect(ctx.companies[C1]).toMatchObject({ written: migration.BATCH_SIZE + 1 });
        expect(tasks(C1).filter((t) => t.ParentTaskId).every((t) => t.ancestors.length === 1 && t.ancestors[0] === T.root)).toBe(true);
    });

    test('is safe to run twice: the second run plans nothing and changes nothing', async () => {
        seedCompany(C1);
        await migration.up(contextFor([C1]));
        const after = JSON.stringify(tasks(C1));
        mockDbFor(C1).calls.length = 0;

        const again = contextFor([C1]);
        await migration.up(again);

        expect(again.companies[C1]).toEqual({ ok: true, ...FULL_COUNTS, written: 0, rehung: 0, recounted: 0 });
        expect(bulkWrites(C1)).toEqual([]);
        expect(JSON.stringify(tasks(C1))).toBe(after);
    });

    test('keeps every tenant to its own database', async () => {
        seedCompany(C1);
        seedTask(C2, 'root', undefined);
        seedTask(C2, 'child', T.gone);
        seedTask(C2, 'secondChild', T.root);

        const ctx = contextFor([C1, C2]);
        await migration.up(ctx);

        expect(ctx.companies[C2]).toEqual({ ok: true, subtasks: 2, written: 1, rehung: 0, recounted: 0, orphans: 1, cycles: 0, otherSprint: 0 });
        expect(task(C2, 'secondChild').ancestors).toEqual([T.root]);
        expect(task(C2, 'child')).not.toHaveProperty('ancestors');
        [C1, C2].forEach((companyId) => expect(mockDbFor(companyId).calls.every((c) => String(c.companyId) === companyId && c.type === SCHEMA_TYPE.TASKS)).toBe(true));
    });

    test('builds the task indexes in every company, after the rows', async () => {
        seedCompany(C1);
        seedTask(C2, 'root', undefined);

        await migration.up(contextFor([C1, C2]));

        [C1, C2].forEach((companyId) => {
            expect(callsOf(companyId, 'createIndexes')).toHaveLength(1);
            expect(mockIndexesOf(companyId).some((index) => index.key.ancestors === 1)).toBe(true);
        });
        const methods = mockDbFor(C1).calls.map((c) => c.method);
        expect(methods.indexOf('createIndexes')).toBeGreaterThan(methods.lastIndexOf('bulkWrite'));
    });
});

/* The dry run's write guard patches the driver's Collection; here that class answers from fakeMongo,
   so the migration runs its own code under the guard and every write it tries is only recorded. */
describe(`${ID} under migrate up --dry-run and migrate verify`, () => {
    class Collection {
        constructor(db, name) { this.dbName = db; this.collectionName = name; }

        run(method, data) { return MongoDbCrudOpration(this.dbName, { type: this.collectionName, data }, method); }

        find(...data) { return this.run('find', data); }

        bulkWrite(...data) { return this.run('bulkWrite', data); }

        createIndexes(...data) { return this.run('createIndexes', data); }

        listIndexes(...data) { return this.run('listIndexes', data); }
    }
    class Db {}
    const driverCrud = (companyId, { type, data }, method) => new Collection(String(companyId), type)[method](...data);
    let guard;
    beforeAll(() => { guard = installWriteGuard({ Collection, Db }); });
    afterAll(() => guard.uninstall());

    test('plans the rows per company and writes nothing', async () => {
        seedCompany(C1);
        seedTask(C2, 'root', undefined);
        seedTask(C2, 'child', T.root);
        const before = JSON.stringify([tasks(C1), tasks(C2)]);

        const result = await dryRunMigrations({ store: createMemoryStore(), migrations: [migration], makeContext: () => contextFor([C1, C2], driverCrud), guard });

        expect(JSON.stringify([tasks(C1), tasks(C2)])).toBe(before);
        [C1, C2].forEach((companyId) => {
            expect(bulkWrites(companyId)).toEqual([]);
            expect(callsOf(companyId, 'createIndexes')).toEqual([]);
            expect(mockIndexes[companyId]).toBeUndefined();
        });
        const [plan] = result.results;
        expect(plan).toMatchObject({ id: ID, status: 'plan' });
        expect(plan.writes.map(({ collection, op, documents }) => `${op} ${collection} ${documents}`)).toEqual(['bulkWrite tasks 8', 'createIndexes tasks null', 'bulkWrite tasks 1']);
        expect(plan.companies).toEqual({
            [C1]: { ok: true, ...FULL_COUNTS },
            [C2]: { ok: true, subtasks: 1, written: 1, rehung: 0, recounted: 0, orphans: 0, cycles: 0, otherSprint: 0 },
        });
        const text = formatDryRun(result);
        expect(text).toContain(`    ${C1}  subtasks 12, written 5, rehung 2, recounted 3, orphans 3, cycles 3, otherSprint 1`);
        expect(text).toContain(`    ${C2}  subtasks 1, written 1, rehung 0, recounted 0, orphans 0, cycles 0, otherSprint 0`);
        process.stdout.write(`\n${text}\n`);
    });

    /* `migrate verify` exits 1 on any failing check. What 064 wrote is true of the rows that existed
       when it ran; a subtask a writer saves afterwards, or a workspace made afterwards, is not its
       to judge, so it carries no check and a healthy database verifies clean. */
    test('migrate verify does not fail on rows and workspaces that came after the migration', async () => {
        seedCompany(C1);
        await migration.up(contextFor([C1]));
        mockDbFor(C1).seed(SCHEMA_TYPE.TASKS, { TaskName: 'saved after the migration', isParentTask: false, ParentTaskId: T.root, sprintId: oid(SPRINT), ancestors: [] });
        seedTask(C2, 'root', undefined);
        seedTask(C2, 'child', T.root, { ancestors: [] });
        const store = createMemoryStore();
        store.docs.set(ID, { _id: ID, ok: true });
        mockDbFor(C1).calls.length = 0;

        const result = await verifyMigrations({ store, migrations: [migration], makeContext: () => contextFor([C1, C2, '6f00000000000000000000c3'], driverCrud), guard });

        expect(mockIndexes[C2]).toBeUndefined();
        expect(result.results).toEqual([{ id: ID, status: 'no-check', problems: [] }]);
        expect(result.results.filter((r) => r.status === 'fail')).toEqual([]);
        expect(formatVerify(result)).toContain('0 fail');
        expect(mockDbFor(C1).calls).toEqual([]);
    });
});
