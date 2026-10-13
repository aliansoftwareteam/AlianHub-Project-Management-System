/* Task 046 M2, slice N3b: until convert, merge and duplicate maintained `ancestors`, a row they
   moved kept the chain it had. Migration 066 runs 064's plan again for subtasks and clears the
   chain a task still holds from when it was a subtask. Its verify() checks the invariant every
   writer now keeps, so a healthy database passes and a database it has not run on is not judged. */
const mongoose = require('mongoose');

const mockDbs = {};
const mockDbFor = (companyId) => { mockDbs[companyId] = mockDbs[companyId] || require('./fixtures/fakeMongo').create(); return mockDbs[companyId]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: async (companyId, q, method) => (method === 'createIndexes' ? undefined : mockDbFor(String(companyId)).crud(companyId, q, method)) }));
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
const migration = require('../migrations/066-task-ancestors-repair');

const ID = '066-task-ancestors-repair';
const C1 = '6f00000000000000000000c1';
const C2 = '6f00000000000000000000c2';
const NEW_COMPANY = '6f00000000000000000000c3';
const SPRINT = '6f0000000000000000000e01';
const T = Object.fromEntries(['root', 'child', 'grandchild', 'promoted', 'underPromoted', 'reparented', 'otherRoot', 'gone', 'orphan', 'plain']
    .map((name, index) => [name, `6f00000000000000000001${String(index + 1).padStart(2, '0')}`]));
const UPDATED_AT = new Date('2026-01-02T03:04:05.000Z');
const oid = (id) => new mongoose.Types.ObjectId(id);
const quiet = { info: jest.fn(), error: jest.fn() };
const contextFor = (companies, crud = MongoDbCrudOpration) => buildContext({ MongoDbCrudOpration: crud, SCHEMA_TYPE, settingsCollectionDocs, logger: quiet, listCompanies: async () => companies.map((_id) => ({ _id })) });

const tasks = (companyId) => mockDbFor(companyId).store[SCHEMA_TYPE.TASKS] || [];
const task = (companyId, name) => tasks(companyId).find((t) => String(t._id) === T[name]);
const seedTask = (companyId, name, parent, ancestors, extra = {}) => mockDbFor(companyId).seed(SCHEMA_TYPE.TASKS, {
    _id: oid(T[name]), TaskName: name, sprintId: oid(SPRINT), updatedAt: UPDATED_AT, isParentTask: !parent, ParentTaskId: parent || '', ancestors, ...extra,
});
const bulkWrites = (companyId) => mockDbFor(companyId).calls.filter((c) => c.method === 'bulkWrite');

/* What the writers kept: a three-level tree, a task, and a subtask whose parent is gone. */
const seedHealthy = (companyId) => {
    seedTask(companyId, 'root', null, [], { subTasks: 1 });
    seedTask(companyId, 'child', T.root, [T.root], { subTasks: 1 });
    seedTask(companyId, 'grandchild', T.child, [T.root, T.child]);
    seedTask(companyId, 'plain', null, []);
    seedTask(companyId, 'orphan', T.gone, []);
};

/* What convert left before it maintained the chain: a subtask made a task that still names its old
   root, its own subtask one link too long, and a subtask given another parent with the old chain. */
const seedStale = (companyId) => {
    seedHealthy(companyId);
    seedTask(companyId, 'otherRoot', null, [], { subTasks: 1 });
    seedTask(companyId, 'promoted', null, [T.root], { subTasks: 1 });
    seedTask(companyId, 'underPromoted', T.promoted, [T.root, T.promoted]);
    seedTask(companyId, 'reparented', T.otherRoot, [T.root]);
};
const STALE_COUNTS = { subtasks: 5, written: 2, rehung: 0, recounted: 0, orphans: 1, cycles: 0, otherSprint: 0, cleared: 1 };

beforeEach(() => {
    Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
    jest.clearAllMocks();
});

describe(ID, () => {
    test('is a valid company-scoped migration listed right after 065', () => {
        expect(() => validateMigration(migration, ID)).not.toThrow();
        expect(migration.scope).toBe('company');
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf(ID)).toBe(ids.indexOf('065-task-ancestors-catchup') + 1);
    });

    test('rewrites a subtask\'s stale chain and clears the chain a task still holds', async () => {
        seedStale(C1);
        const ctx = contextFor([C1]);

        await migration.up(ctx);

        expect(ctx.companies[C1]).toEqual({ ok: true, ...STALE_COUNTS });
        expect(task(C1, 'promoted').ancestors).toEqual([]);
        expect(task(C1, 'underPromoted').ancestors).toEqual([T.promoted]);
        expect(task(C1, 'reparented').ancestors).toEqual([T.otherRoot]);
        expect([task(C1, 'child').ancestors, task(C1, 'grandchild').ancestors]).toEqual([[T.root], [T.root, T.child]]);
        expect(task(C1, 'orphan').ancestors).toEqual([]);
        tasks(C1).forEach((row) => expect(row.updatedAt).toEqual(UPDATED_AT));
        expect(quiet.info).toHaveBeenCalledWith(expect.stringContaining(`[migrations] 066 ${C1}`));
    });

    test('every write names what it read and keeps updatedAt through the strict schema', async () => {
        seedStale(C1);
        await migration.up(contextFor([C1]));

        const ops = bulkWrites(C1).flatMap((c) => c.data[0].map((op) => op.updateOne));
        expect(ops).toHaveLength(STALE_COUNTS.written + STALE_COUNTS.cleared);
        ops.forEach((op) => expect(op.timestamps).toBe(false));
        const cleared = ops.find((op) => String(op.filter._id) === T.promoted);
        expect(cleared).toMatchObject({ filter: { ParentTaskId: '' }, update: { $set: { ancestors: [] } } });
        const { writes, error } = await driverWrites('bulkWrite', bulkWrites(C1)[0].data);
        expect(error).toBeNull();
        writes[0].args[0].forEach(({ updateOne }) => expect(updateOne.update.$set).not.toHaveProperty('updatedAt'));
    });

    test('a task made a subtask again after the read keeps the chain its writer gave it', async () => {
        seedStale(C1);
        const real = contextFor([C1]);
        const racing = contextFor([C1], async (companyId, q, method) => {
            if (method === 'bulkWrite') Object.assign(task(C1, 'promoted'), { ParentTaskId: T.otherRoot, ancestors: [T.otherRoot] });
            return real.company(companyId, q, method);
        });

        await migration.up(racing);

        expect(task(C1, 'promoted').ancestors).toEqual([T.otherRoot]);
    });

    test('is safe to run twice, and plans nothing on a healthy company', async () => {
        seedStale(C1);
        seedHealthy(C2);
        await migration.up(contextFor([C1]));
        const after = JSON.stringify(tasks(C1));
        mockDbFor(C1).calls.length = 0;

        const again = contextFor([C1, C2]);
        await migration.up(again);

        expect(again.companies[C1]).toMatchObject({ ok: true, written: 0, rehung: 0, cleared: 0 });
        expect(again.companies[C2]).toEqual({ ok: true, subtasks: 3, written: 0, rehung: 0, recounted: 0, orphans: 1, cycles: 0, otherSprint: 0, cleared: 0 });
        expect(bulkWrites(C1).concat(bulkWrites(C2))).toEqual([]);
        expect(JSON.stringify(tasks(C1))).toBe(after);
    });

    test('keeps every tenant to its own database', async () => {
        seedStale(C1);
        seedStale(C2);

        await migration.up(contextFor([C1]));

        expect(task(C2, 'promoted').ancestors).toEqual([T.root]);
        expect(mockDbFor(C2).calls).toEqual([]);
    });
});

describe(`${ID} under migrate up --dry-run and migrate verify`, () => {
    class Collection {
        constructor(db, name) { this.dbName = db; this.collectionName = name; }

        run(method, data) { return MongoDbCrudOpration(this.dbName, { type: this.collectionName, data }, method); }

        find(...data) { return this.run('find', data); }

        bulkWrite(...data) { return this.run('bulkWrite', data); }
    }
    class Db {}
    const driverCrud = (companyId, { type, data }, method) => new Collection(String(companyId), type)[method](...data);
    const applied = () => { const store = createMemoryStore(); store.docs.set(ID, { _id: ID, ok: true }); return store; };
    let guard;
    beforeAll(() => { guard = installWriteGuard({ Collection, Db }); });
    afterAll(() => guard.uninstall());

    test('the dry run plans the repair per company and writes nothing', async () => {
        seedStale(C1);
        seedHealthy(C2);
        const before = JSON.stringify([tasks(C1), tasks(C2)]);

        const result = await dryRunMigrations({ store: createMemoryStore(), migrations: [migration], makeContext: () => contextFor([C1, C2], driverCrud), guard });

        expect(JSON.stringify([tasks(C1), tasks(C2)])).toBe(before);
        expect(bulkWrites(C1).concat(bulkWrites(C2))).toEqual([]);
        const [plan] = result.results;
        expect(plan).toMatchObject({ id: ID, status: 'plan' });
        expect(plan.writes.map(({ collection, op, documents }) => `${op} ${collection} ${documents}`)).toEqual(['bulkWrite tasks 3']);
        expect(plan.companies[C1]).toEqual({ ok: true, ...STALE_COUNTS });
        const text = formatDryRun(result);
        expect(text).toContain(`    ${C1}  subtasks 5, written 2, rehung 0, recounted 0, orphans 1, cycles 0, otherSprint 0, cleared 1`);
        process.stdout.write(`\n${text}\n`);
    });

    test('verify names what disagrees, and passes once the migration has run', async () => {
        seedStale(C1);
        const store = applied();
        const makeContext = () => contextFor([C1], driverCrud);

        const failing = await verifyMigrations({ store, migrations: [migration], makeContext, guard });
        expect(failing.results).toEqual([{
            id: ID, status: 'fail', error: null,
            problems: [`${C1} 2 subtasks whose ancestors are not the chain of their parents`, `${C1} 1 task that still holds a chain`],
        }]);

        await migration.up(contextFor([C1]));
        const passing = await verifyMigrations({ store, migrations: [migration], makeContext, guard });
        expect(passing.results).toEqual([{ id: ID, status: 'pass', problems: [], error: null }]);
        expect(formatVerify(passing)).toContain(`${ID}  pass`);
    });

    test('verify reports a row below level three', async () => {
        seedHealthy(C1);
        seedTask(C1, 'underPromoted', T.grandchild, [T.root, T.child, T.grandchild]);

        const result = await verifyMigrations({ store: applied(), migrations: [migration], makeContext: () => contextFor([C1], driverCrud), guard });

        expect(result.results[0]).toMatchObject({ status: 'fail', problems: [`${C1} 1 subtask whose ancestors are not the chain of their parents`, `${C1} 1 subtask below level three`] });
    });

    /* What a database looks like when every row was written after the migration by the current
       writers: chains in place, a workspace with no task at all, a workspace with no tasks
       collection, a subtask whose parent was purged. None of it is a failure. */
    test('a healthy database made after the migration passes verify', async () => {
        seedHealthy(C1);
        seedTask(C2, 'plain', null, []);

        const result = await verifyMigrations({ store: applied(), migrations: [migration], makeContext: () => contextFor([C1, C2, NEW_COMPANY], driverCrud), guard });

        expect(result.results).toEqual([{ id: ID, status: 'pass', problems: [], error: null }]);
        expect(result.results.filter((r) => r.status === 'fail')).toEqual([]);
    });

    test('a database the migration has not run on is not verified, so it cannot fail', async () => {
        seedStale(C1);

        const result = await verifyMigrations({ store: createMemoryStore(), migrations: [migration], makeContext: () => contextFor([C1], driverCrud), guard });

        expect(result.results).toEqual([]);
        expect(result.notApplied).toEqual([ID]);
        expect(formatVerify(result)).toContain('0 fail');
    });
});
