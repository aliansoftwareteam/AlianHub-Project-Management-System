/* Task 046 M2, slice N2: migration 064 ran before the create paths stored `ancestors`, so a subtask
   made in between holds an empty chain. Migration 065 runs 064's plan once more: it repairs those
   rows and plans nothing in a company that has none. */
const mongoose = require('mongoose');

const mockDbs = {};
const mockDbFor = (companyId) => { mockDbs[companyId] = mockDbs[companyId] || require('./fixtures/fakeMongo').create(); return mockDbs[companyId]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));

const { buildContext, validateMigration, listMigrations } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { settingsCollectionDocs } = require('../Config/collections');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const first = require('../migrations/064-task-ancestors');
const migration = require('../migrations/065-task-ancestors-catchup');

const ID = '065-task-ancestors-catchup';
const C1 = '6f00000000000000000000c1';
const C2 = '6f00000000000000000000c2';
const SPRINT = '6f0000000000000000000e01';
const ROOT = '6f0000000000000000000101';
const CHILD = '6f0000000000000000000102';
const LATE_CHILD = '6f0000000000000000000103';
const LATE_GRANDCHILD = '6f0000000000000000000104';
const UPDATED_AT = new Date('2026-01-02T03:04:05.000Z');
const oid = (id) => new mongoose.Types.ObjectId(id);
const quiet = { info: jest.fn(), error: jest.fn() };
const contextFor = (companies) => buildContext({ MongoDbCrudOpration, SCHEMA_TYPE, settingsCollectionDocs, logger: quiet, listCompanies: async () => companies.map((_id) => ({ _id })) });

const tasks = (companyId) => mockDbFor(companyId).store[SCHEMA_TYPE.TASKS] || [];
const task = (companyId, id) => tasks(companyId).find((t) => String(t._id) === id);
const seedTask = (companyId, id, parent, extra = {}) => mockDbFor(companyId).seed(SCHEMA_TYPE.TASKS, {
    _id: oid(id), TaskName: id, sprintId: oid(SPRINT), updatedAt: UPDATED_AT,
    ...(parent ? { isParentTask: false, ParentTaskId: parent } : { isParentTask: true, ParentTaskId: '', ancestors: [] }),
    ...extra,
});
const bulkWrites = (companyId) => mockDbFor(companyId).calls.filter((c) => c.method === 'bulkWrite');

/* A company after 064: one subtask it wrote, then two the old create path saved with the schema's empty default. */
const seedAfterFirstRun = async (companyId) => {
    seedTask(companyId, ROOT, null, { subTasks: 2 });
    seedTask(companyId, CHILD, ROOT, { subTasks: 1 });
    await first.up(contextFor([companyId]));
    seedTask(companyId, LATE_CHILD, ROOT, { ancestors: [] });
    seedTask(companyId, LATE_GRANDCHILD, CHILD, { ancestors: [] });
    mockDbFor(companyId).calls.length = 0;
};

beforeEach(() => {
    Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
    jest.clearAllMocks();
});

describe(ID, () => {
    test('is a valid company-scoped migration listed right after 064', () => {
        expect(() => validateMigration(migration, ID)).not.toThrow();
        expect(migration.scope).toBe('company');
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf(ID)).toBe(ids.indexOf('064-task-ancestors') + 1);
    });

    test('repairs a subtask created with an empty chain, and keeps updatedAt', async () => {
        await seedAfterFirstRun(C1);
        const ctx = contextFor([C1]);

        await migration.up(ctx);

        expect(ctx.companies[C1]).toEqual({ ok: true, subtasks: 3, written: 2, rehung: 0, recounted: 0, orphans: 0, cycles: 0, otherSprint: 0 });
        expect(task(C1, LATE_CHILD).ancestors).toEqual([ROOT]);
        expect(task(C1, LATE_GRANDCHILD).ancestors).toEqual([ROOT, CHILD]);
        expect(task(C1, CHILD).ancestors).toEqual([ROOT]);
        tasks(C1).forEach((row) => expect(row.updatedAt).toEqual(UPDATED_AT));
        expect(quiet.info).toHaveBeenCalledWith(expect.stringContaining(`[migrations] 065 ${C1}`));
    });

    test('plans nothing in a company where every chain is already right', async () => {
        await seedAfterFirstRun(C1);
        await migration.up(contextFor([C1]));
        const after = JSON.stringify(tasks(C1));
        mockDbFor(C1).calls.length = 0;
        seedTask(C2, ROOT, null);

        const ctx = contextFor([C1, C2]);
        await migration.up(ctx);

        expect(ctx.companies[C1]).toMatchObject({ ok: true, written: 0, rehung: 0, recounted: 0 });
        expect(ctx.companies[C2]).toMatchObject({ ok: true, subtasks: 0, written: 0 });
        expect(bulkWrites(C1).concat(bulkWrites(C2))).toEqual([]);
        expect(JSON.stringify(tasks(C1))).toBe(after);
    });

    test('carries no verify check, so rows saved after it never fail migrate verify', () => {
        expect(migration.verify).toBeUndefined();
        expect(first.verify).toBeUndefined();
    });

    test('keeps every tenant to its own database', async () => {
        await seedAfterFirstRun(C1);
        await seedAfterFirstRun(C2);

        await migration.up(contextFor([C1]));

        expect(task(C1, LATE_CHILD).ancestors).toEqual([ROOT]);
        expect(task(C2, LATE_CHILD).ancestors).toEqual([]);
        expect(mockDbFor(C2).calls).toEqual([]);
    });
});
