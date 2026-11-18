/* Task 040 phase 2: migrations 058 to 060 rewrite history.ProjectId, and projectId, sprintId and folderId
   on notifications and mentions, from text to ObjectId in every tenant. These are the largest collections,
   so a company is read a page at a time, only each page's bounds are kept, and each page is converted on
   the server; "none" and anything that is not an id are left alone, and the migration says so. */
const mongoose = require('mongoose');

const mockDbs = {};
const mockDbFor = (companyId) => { mockDbs[companyId] = mockDbs[companyId] || require('./fixtures/fakeMongo').create(); return mockDbs[companyId]; };

/* fakeMongo has no update pipelines: the one shape these migrations send is run here the way MongoDB runs it. */
const mockPipelineUpdate = (companyId, { type, data }) => {
    const db = mockDbFor(String(companyId));
    db.calls.push({ companyId, type, method: 'updateMany', data });
    const { matches } = require('./fixtures/fakeMongo');
    const [filter, pipeline] = data;
    const hit = (db.store[type] || []).filter((row) => matches(row, filter));
    hit.forEach((row) => pipeline.forEach(({ $set }) => Object.entries($set).forEach(([field, { $toObjectId }]) => {
        row[field] = new mongoose.Types.ObjectId(row[$toObjectId.slice(1)]);
    })));
    return { matchedCount: hit.length, modifiedCount: hit.length };
};

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => (method === 'updateMany' && Array.isArray(q.data[1])
        ? mockPipelineUpdate(companyId, q)
        : mockDbFor(String(companyId)).crud(companyId, q, method)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { buildContext, validateMigration, listMigrations, dryRunMigrations, verifyMigrations } = require('../migrations');
const { createMemoryStore } = require('../migrations/store');
const { installWriteGuard } = require('../migrations/writeGuard');
const { formatDryRun, formatVerify } = require('../migrations/report');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { settingsCollectionDocs } = require('../Config/collections');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { historySchema, notificationsSchema, mentionsSchema } = require('../utils/mongo-handler/createSchema');
const { realModelStore, isObjectId } = require('./fixtures/realModelStore');

const C1 = '6f00000000000000000000c1';
const C2 = '6f00000000000000000000c2';
const PROJECT = '6f0000000000000000000a01';
const OTHER_PROJECT = '6f0000000000000000000a02';
const SPRINT = '6f0000000000000000000b01';
const FOLDER = '6f0000000000000000000f01';
const UPDATED_AT = new Date('2026-01-02T03:04:05.000Z');
const oid = (id) => new mongoose.Types.ObjectId(id);
const quiet = { info: jest.fn(), error: jest.fn() };
const contextFor = (companies, crud = MongoDbCrudOpration) => buildContext({ MongoDbCrudOpration: crud, SCHEMA_TYPE, settingsCollectionDocs, logger: quiet, listCompanies: async () => companies.map((_id) => ({ _id })) });

const CASES = [
    {
        id: '058-history-project-ids', type: SCHEMA_TYPE.HISTORY, schema: historySchema, fields: ['ProjectId'], one: 'history entry', many: 'history entries',
        row: { Key: 'Task_Status', Message: 'm', Type: 'task', UserId: 'u', TaskId: 't' },
    },
    {
        id: '059-notification-ids', type: SCHEMA_TYPE.NOTIFICATIONS, schema: notificationsSchema, fields: ['projectId', 'sprintId', 'folderId'], one: 'notification', many: 'notifications',
        row: { key: 'tasks', message: 'm', type: 'tasks', userId: 'u', assigneeUsers: [], uniqueId: 'x', taskId: 't' },
    },
    {
        id: '060-mention-ids', type: SCHEMA_TYPE.MENTIONS, schema: mentionsSchema, fields: ['projectId', 'sprintId', 'folderId'], one: 'mention', many: 'mentions',
        row: { comment_id: 'c', comment_type: 'text', mentionIds: ['u'], userId: 'u', type: 'task', taskId: 't' },
    },
];

test('the three migrations follow 057 in this order', () => {
    const ids = listMigrations().map((m) => m.id);
    const at = ids.indexOf('057-favourites-store');
    expect(ids.slice(at + 1, at + 1 + CASES.length)).toEqual(CASES.map((c) => c.id));
});

describe.each(CASES)('$id', ({ id, type, schema, fields, one, many, row }) => {
    const migration = require(`../migrations/${id}`);
    const tag = id.slice(0, 3);
    const [projectField, ...placeFields] = fields;
    const rows = (companyId) => mockDbFor(companyId).store[type] || [];
    const named = (companyId, name) => rows(companyId).find((r) => r.seedName === name);
    const seed = (companyId, name, ids) => mockDbFor(companyId).seed(type, { ...row, seedName: name, ...ids, updatedAt: UPDATED_AT });
    const place = (sprintId, folderId) => (placeFields.length ? { sprintId, folderId } : {});
    const counts = (converted, invalid) => ({ ...Object.fromEntries(fields.map((field) => [field, converted[field] || 0])), invalid });
    /* One tenant as upgrades find it: text ids, ids already converted, none, and values that are not ids. */
    const seedLegacyCompany = (companyId) => {
        seed(companyId, 'text ids', { [projectField]: PROJECT, ...place(SPRINT, FOLDER) });
        seed(companyId, 'other text id', { [projectField]: OTHER_PROJECT, ...place('', '') });
        seed(companyId, 'already ObjectIds', { [projectField]: oid(PROJECT), ...place(oid(SPRINT), oid(FOLDER)) });
        seed(companyId, 'a sentinel', { [projectField]: 'ai-alerts', ...place('', '') });
        seed(companyId, 'no project', { [projectField]: '' });
    };
    const legacyCounts = counts({ [projectField]: 2, sprintId: 1, folderId: 1 }, 1);
    const updates = (companyId) => mockDbFor(companyId).calls.filter((c) => c.method === 'updateMany');

    beforeEach(() => {
        Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
        jest.clearAllMocks();
    });

    test('is a valid company-scoped migration', () => {
        expect(() => validateMigration(migration, id)).not.toThrow();
        expect(migration.scope).toBe('company');
    });

    test('converts every text id, keeps the rest of the row, and reports what it left alone', async () => {
        seedLegacyCompany(C1);
        const ctx = contextFor([C1]);

        await migration.up(ctx);

        expect(ctx.companies[C1]).toEqual({ ok: true, ...legacyCounts });
        const converted = named(C1, 'text ids');
        fields.forEach((field) => expect(isObjectId(converted[field])).toBe(true));
        expect({ ...converted, ...Object.fromEntries(fields.map((field) => [field, String(converted[field])])) })
            .toMatchObject({ ...row, seedName: 'text ids', [projectField]: PROJECT, ...place(SPRINT, FOLDER), updatedAt: UPDATED_AT });
        expect(isObjectId(named(C1, 'other text id')[projectField])).toBe(true);
        placeFields.forEach((field) => expect(named(C1, 'other text id')[field]).toBe(''));
        expect(named(C1, 'a sentinel')[projectField]).toBe('ai-alerts');
        expect(named(C1, 'no project')[projectField]).toBe('');
        expect(quiet.info).toHaveBeenCalledWith(`[migrations] ${tag} ${C1}: 1 of 1 batches of ${many} converted`);
        expect(quiet.info).toHaveBeenCalledWith(`[migrations] ${tag} ${C1}: ${JSON.stringify(legacyCounts)}`);
    });

    test('converts each field on the server, only within the page it read, only while it is hex text, and keeps updatedAt', async () => {
        seedLegacyCompany(C1);
        await migration.up(contextFor([C1]));

        const sent = updates(C1).map((c) => c.data);
        expect(sent.map(([filter]) => Object.keys(filter).find((key) => key !== '_id'))).toEqual(fields);
        const [first, last] = [named(C1, 'text ids')._id, named(C1, 'a sentinel')._id];
        sent.forEach(([filter, pipeline, options]) => {
            const field = Object.keys(filter).find((key) => key !== '_id');
            expect(filter).toEqual({ _id: { $gte: first, $lte: last }, [field]: { $type: 'string', $regex: '^[0-9a-fA-F]{24}$' } });
            expect(pipeline).toEqual([{ $set: { [field]: { $toObjectId: `$${field}` } } }]);
            expect(options).toEqual({ timestamps: false });
        });

        const store = realModelStore(type, schema);
        const writes = (await Promise.all(sent.map(async (data) => {
            const { writes: driver, error } = await store.driverWrites('updateMany', data);
            expect(error).toBeNull();
            return driver;
        }))).flat();
        writes.forEach(({ args: [filter, pipeline] }) => {
            expect(isObjectId(filter._id.$gte)).toBe(true);
            expect(JSON.stringify(pipeline)).not.toContain('updatedAt');
            expect(pipeline).toHaveLength(1);
        });
    });

    test('reads every candidate a page of 500 at a time in _id order before any write, and writes one page at a time', async () => {
        for (let i = 0; i < migration.BATCH_SIZE + 1; i += 1) seed(C1, `row ${i}`, { [projectField]: PROJECT });
        seed(C1, 'not an id', { [projectField]: 'general-reminder' });

        const ctx = contextFor([C1]);
        await migration.up(ctx);

        const reads = mockDbFor(C1).calls.filter((c) => c.method === 'find');
        expect(reads.map((c) => c.data[2])).toEqual([
            { sort: { _id: 1 }, limit: migration.BATCH_SIZE, lean: true },
            { sort: { _id: 1 }, limit: migration.BATCH_SIZE, lean: true },
        ]);
        expect(reads[1].data[0]._id.$gt).toBe(rows(C1)[migration.BATCH_SIZE - 1]._id);
        const calls = mockDbFor(C1).calls.map((c) => c.method);
        expect(calls.lastIndexOf('find')).toBeLessThan(calls.indexOf('updateMany'));
        expect(updates(C1).map((c) => c.data[0]._id)).toEqual([
            { $gte: rows(C1)[0]._id, $lte: rows(C1)[migration.BATCH_SIZE - 1]._id },
            { $gte: rows(C1)[migration.BATCH_SIZE]._id, $lte: rows(C1)[migration.BATCH_SIZE + 1]._id },
        ]);
        expect(ctx.companies[C1]).toEqual({ ok: true, ...counts({ [projectField]: migration.BATCH_SIZE + 1 }, 1) });
        expect(rows(C1).filter((r) => r.seedName.startsWith('row')).every((r) => isObjectId(r[projectField]))).toBe(true);
    });

    test('logs its progress every 20 pages and at the end of each company', async () => {
        const total = migration.BATCH_SIZE * migration.LOG_EVERY + 1;
        for (let i = 0; i < total; i += 1) seed(C1, `row ${i}`, { [projectField]: PROJECT });

        await migration.up(contextFor([C1]));

        expect(migration.LOG_EVERY).toBe(20);
        expect(quiet.info.mock.calls.map(([line]) => line).filter((line) => line.startsWith(`[migrations] ${tag} ${C1}:`))).toEqual([
            `[migrations] ${tag} ${C1}: read ${migration.BATCH_SIZE * migration.LOG_EVERY} ${many}`,
            `[migrations] ${tag} ${C1}: ${migration.LOG_EVERY} of ${migration.LOG_EVERY + 1} batches of ${many} converted`,
            `[migrations] ${tag} ${C1}: ${migration.LOG_EVERY + 1} of ${migration.LOG_EVERY + 1} batches of ${many} converted`,
            `[migrations] ${tag} ${C1}: ${JSON.stringify(counts({ [projectField]: total }, 0))}`,
        ]);
    });

    test('is safe to run twice: the second run converts nothing and changes nothing', async () => {
        seedLegacyCompany(C1);
        await migration.up(contextFor([C1]));
        const after = JSON.stringify(rows(C1));
        mockDbFor(C1).calls.length = 0;

        const again = contextFor([C1]);
        await migration.up(again);

        expect(again.companies[C1]).toEqual({ ok: true, ...counts({}, 1) });
        expect(updates(C1)).toEqual([]);
        expect(JSON.stringify(rows(C1))).toBe(after);
    });

    test('keeps every tenant to its own database', async () => {
        seedLegacyCompany(C1);
        seed(C2, 'other tenant', { [projectField]: OTHER_PROJECT });

        const ctx = contextFor([C1, C2]);
        await migration.up(ctx);

        expect(ctx.companies[C2]).toEqual({ ok: true, ...counts({ [projectField]: 1 }, 0) });
        [C1, C2].forEach((companyId) => expect(mockDbFor(companyId).calls.every((c) => String(c.companyId) === companyId)).toBe(true));
    });

    test('verify counts each field still holding a text id, and reports none after the migration', async () => {
        seedLegacyCompany(C1);
        seed(C2, 'other tenant', { [projectField]: OTHER_PROJECT });

        expect(await migration.verify(contextFor([C1, C2]))).toEqual([
            `${C1} 2 ${many} still store ${projectField} as text`,
            ...placeFields.map((field) => `${C1} 1 ${one} still stores ${field} as text`),
            `${C2} 1 ${one} still stores ${projectField} as text`,
        ]);

        await migration.up(contextFor([C1, C2]));

        expect(await migration.verify(contextFor([C1, C2]))).toEqual([]);
    });

    /* The dry run's write guard patches the driver's Collection; here that class answers from fakeMongo,
       so the migration runs its own code under the guard and every write it tries is only recorded. */
    describe('under migrate up --dry-run and migrate verify', () => {
        class Collection {
            constructor(db, name) { this.dbName = db; this.collectionName = name; }

            run(method, data) { return mockDbFor(this.dbName).crud(this.dbName, { type: this.collectionName, data }, method); }

            find(...data) { return this.run('find', data); }

            countDocuments(...data) { return this.run('countDocuments', data); }

            updateMany(...data) { return this.run('updateMany', data); }
        }
        class Db {}
        const driverCrud = (companyId, { type: collection, data }, method) => new Collection(String(companyId), collection)[method](...data);
        let guard;
        beforeAll(() => { guard = installWriteGuard({ Collection, Db }); });
        afterAll(() => guard.uninstall());

        test('plans the conversion per company and writes nothing', async () => {
            seedLegacyCompany(C1);
            seed(C2, 'other tenant', { [projectField]: OTHER_PROJECT });
            const before = JSON.stringify([rows(C1), rows(C2)]);

            const result = await dryRunMigrations({ store: createMemoryStore(), migrations: [migration], makeContext: () => contextFor([C1, C2], driverCrud), guard });

            expect(JSON.stringify([rows(C1), rows(C2)])).toBe(before);
            expect(updates(C1).concat(updates(C2))).toEqual([]);
            const [plan] = result.results;
            expect(plan).toMatchObject({ id, status: 'plan' });
            expect(plan.writes.every(({ collection, op, update }) => collection === type && op === 'updateMany' && update === 'pipeline')).toBe(true);
            expect(plan.writes.reduce((sum, w) => sum + w.documents, 0)).toBe(2 + placeFields.length + 1);
            expect(plan.companies).toEqual({
                [C1]: { ok: true, ...legacyCounts },
                [C2]: { ok: true, ...counts({ [projectField]: 1 }, 0) },
            });
            const text = formatDryRun(result);
            expect(text).toContain(`    ${C1}  ${fields.map((field) => `${field} ${legacyCounts[field]}`).join(', ')}, invalid 1`);
            process.stdout.write(`\n${text}\n`);
        });

        test('verify runs read-only and passes once the migration has run', async () => {
            seedLegacyCompany(C1);
            const store = createMemoryStore();
            store.docs.set(id, { _id: id, ok: true });
            const makeContext = () => contextFor([C1], driverCrud);

            const failing = await verifyMigrations({ store, migrations: [migration], makeContext, guard });
            expect(failing.results[0]).toMatchObject({ id, status: 'fail', error: null });
            expect(failing.results[0].problems[0]).toBe(`${C1} 2 ${many} still store ${projectField} as text`);
            expect(formatVerify(failing)).toContain(`${id}  fail`);

            await migration.up(contextFor([C1]));
            const passing = await verifyMigrations({ store, migrations: [migration], makeContext, guard });
            expect(passing.results).toEqual([{ id, status: 'pass', problems: [], error: null }]);
        });
    });
});
