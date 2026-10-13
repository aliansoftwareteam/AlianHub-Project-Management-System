const { dryRunMigrations, verifyMigrations, migrationStatus, LOCK_ID } = require('../migrations');
const { createMemoryStore } = require('../migrations/store');
const { installWriteGuard } = require('../migrations/writeGuard');
const { formatDryRun, formatVerify } = require('../migrations/report');
const { verifyTaskTypeIcons } = require('../migrations/lib/taskTypeIcons');
const taskTypeIconsMigration = require('../migrations/004-task-type-icons');

const quiet = { info() {}, error() {} };
const PERSONAL = 'jane.doe@example.com';

/* Stands in for the MongoDB driver: the guard patches these prototypes the way it
 * patches mongoose.mongo.Collection/Db, and `landed` counts what reached the data. */
function fakeDriver(seed = {}) {
    const data = JSON.parse(JSON.stringify(seed));
    const indexes = {};
    const landed = [];
    const matches = (row, filter = {}) => Object.entries(filter).every(([key, want]) => (
        want && typeof want === 'object' && '$ne' in want ? row[key] !== want.$ne : row[key] === want
    ));
    class Db {
        constructor(name) { this.databaseName = name; }
        collection(name) { return new Collection(this, name); }
        async createCollection(name) { landed.push(`createCollection ${name}`); data[`${this.databaseName}.${name}`] = []; return this.collection(name); }
    }
    class Collection {
        constructor(db, name) { this.s = { db }; this.collectionName = name; }
        get dbName() { return this.s.db.databaseName; }
        get ns() { return `${this.dbName}.${this.collectionName}`; }
        get rows() { if (!data[this.ns]) data[this.ns] = []; return data[this.ns]; }
        find(filter) { const rows = this.rows.filter((r) => matches(r, filter)).map((r) => ({ ...r })); return { toArray: async () => rows }; }
        async findOne(filter) { const row = this.rows.find((r) => matches(r, filter)); return row ? { ...row } : null; }
        async countDocuments(filter) { return this.rows.filter((r) => matches(r, filter)).length; }
        listIndexes() { const list = (indexes[this.ns] || []).map((name) => ({ name })); return { toArray: async () => list }; }
        async insertOne(doc) { landed.push(`insertOne ${this.ns}`); this.rows.push({ ...doc }); return { acknowledged: true, insertedId: doc._id }; }
        async updateOne(filter, update) {
            landed.push(`updateOne ${this.ns}`);
            const row = this.rows.find((r) => matches(r, filter));
            if (row) Object.assign(row, update.$set);
            return { acknowledged: true, matchedCount: row ? 1 : 0, modifiedCount: row ? 1 : 0 };
        }
        async updateMany(filter, update) {
            landed.push(`updateMany ${this.ns}`);
            const rows = this.rows.filter((r) => matches(r, filter));
            rows.forEach((r) => Object.assign(r, update.$set));
            return { acknowledged: true, matchedCount: rows.length, modifiedCount: rows.length };
        }
        async deleteMany(filter) {
            landed.push(`deleteMany ${this.ns}`);
            const keep = this.rows.filter((r) => !matches(r, filter));
            const deletedCount = this.rows.length - keep.length;
            data[this.ns] = keep;
            return { acknowledged: true, deletedCount };
        }
        async findOneAndUpdate(filter, update) {
            landed.push(`findOneAndUpdate ${this.ns}`);
            const row = this.rows.find((r) => matches(r, filter));
            if (row) Object.assign(row, update.$set);
            return row ? { ...row } : null;
        }
        async createIndex(spec) {
            landed.push(`createIndex ${this.ns}`);
            const name = Object.keys(spec).map((k) => `${k}_${spec[k]}`).join('_');
            indexes[this.ns] = [...(indexes[this.ns] || []), name];
            return name;
        }
    }
    return { Db, Collection, data, landed, db: (name) => new Db(name), snapshot: () => JSON.stringify({ data, indexes }) };
}

const setup = (seed, migrations, applied = []) => {
    const driver = fakeDriver(seed);
    const guard = installWriteGuard({ Collection: driver.Collection, Db: driver.Db });
    const store = createMemoryStore();
    applied.forEach((id) => store.docs.set(id, { _id: id, ok: true }));
    const makeContext = () => ({ companies: {}, db: driver.db, logger: quiet });
    return { driver, guard, store, deps: { store, migrations, makeContext, guard, logger: quiet } };
};

const mig = (id, up, extra = {}) => ({ id, scope: 'company', up, ...extra });

const SEED = {
    'c1.tasks': [
        { _id: 't1', TaskType: 'bug', TaskTypeKey: 3, reporter: PERSONAL },
        { _id: 't2', TaskType: 'bug', TaskTypeKey: 3, reporter: PERSONAL },
        { _id: 't3', TaskType: 'story', TaskTypeKey: 4, reporter: PERSONAL },
    ],
    'c2.tasks': [{ _id: 't9', TaskType: 'bug', TaskTypeKey: 3 }],
    'c1.projects': [{ _id: 'p1', archived: false }],
};

describe('migrate up --dry-run', () => {
    it('plans every write a pending migration would make and lets none of them reach the database', async () => {
        const { driver, deps } = setup(SEED, [
            mig('001-applied', () => { throw new Error('an applied migration must not run'); }),
            mig('002-rekey-bugs', async (ctx) => {
                for (const company of ['c1', 'c2']) {
                    await ctx.db(company).collection('tasks').updateMany({ TaskType: 'bug', reporter: { $ne: PERSONAL } }, { $set: { TaskTypeKey: 7 } });
                }
                await ctx.db('c1').collection('audit').insertOne({ _id: 'a1', note: `rekeyed for ${PERSONAL}` });
                await ctx.db('c1').collection('projects').deleteMany({ archived: true });
            }),
        ], ['001-applied']);
        const before = driver.snapshot();

        const result = await dryRunMigrations(deps);

        expect(driver.landed).toEqual([]);
        expect(driver.snapshot()).toBe(before);
        expect(result.results).toHaveLength(1);
        const [plan] = result.results;
        expect(plan).toMatchObject({ id: '002-rekey-bugs', status: 'plan' });
        expect(plan.writes).toEqual([
            expect.objectContaining({ collection: 'tasks', op: 'updateMany', calls: 2, databases: 2, documents: 1, filter: ['TaskType', 'reporter'], update: '$set {TaskTypeKey}' }),
            expect.objectContaining({ collection: 'audit', op: 'insertOne', calls: 1, databases: 1, documents: 1 }),
            expect.objectContaining({ collection: 'projects', op: 'deleteMany', calls: 1, documents: 0, filter: ['archived'] }),
        ]);
        const text = formatDryRun(result);
        expect(text).toMatch(/002-rekey-bugs/);
        expect(text).toMatch(/updateMany\s+tasks/);
        expect(JSON.stringify(result)).not.toContain(PERSONAL);
        expect(text).not.toContain(PERSONAL);
    });

    it('does not record the migration as applied and takes no lock', async () => {
        const { store, deps } = setup(SEED, [mig('002-touch', async (ctx) => { await ctx.db('c1').collection('projects').updateOne({ _id: 'p1' }, { $set: { archived: true } }); })]);
        const put = jest.spyOn(store, 'put');
        const tryLock = jest.spyOn(store, 'tryLock');

        await dryRunMigrations(deps);

        expect(put).not.toHaveBeenCalled();
        expect(tryLock).not.toHaveBeenCalled();
        expect(store.docs.has(LOCK_ID)).toBe(false);
        expect((await migrationStatus(deps)).pending.map((m) => m.id)).toEqual(['002-touch']);
    });

    it('reports a migration that reads back what it just wrote as cannot dry-run, and still writes nothing', async () => {
        const { driver, deps } = setup(SEED, [
            mig('002-index-then-check', async (ctx) => {
                const chunks = ctx.db('c1').collection('knowledge_chunks');
                await chunks.createIndex({ sourceType: 1 });
                const found = await chunks.listIndexes().toArray();
                if (!found.length) throw new Error('index missing after createIndex');
            }),
            mig('003-update-then-read', async (ctx) => {
                const projects = ctx.db('c1').collection('projects');
                await projects.updateOne({ _id: 'p1' }, { $set: { archived: true } });
                await projects.findOne({ _id: 'p1' });
            }),
        ]);

        const { results } = await dryRunMigrations(deps);

        expect(driver.landed).toEqual([]);
        expect(results.map((r) => [r.id, r.status])).toEqual([['002-index-then-check', 'cannot-dry-run'], ['003-update-then-read', 'cannot-dry-run']]);
        expect(results[0].reason).toMatch(/knowledge_chunks/);
        expect(results[1].reason).toMatch(/projects/);
        expect(formatDryRun({ results })).toMatch(/cannot dry-run/);
    });

    it('reports a migration that reads what an earlier pending migration would write as cannot dry-run', async () => {
        const { deps } = setup(SEED, [
            mig('002-writer', async (ctx) => { await ctx.db('c1').collection('projects').updateOne({ _id: 'p1' }, { $set: { archived: true } }); }),
            mig('003-reader', async (ctx) => { await ctx.db('c1').collection('projects').find({ archived: true }).toArray(); }),
        ]);

        const { results } = await dryRunMigrations(deps);

        expect(results.map((r) => r.status)).toEqual(['plan', 'cannot-dry-run']);
        expect(results[1].reason).toMatch(/002-writer/);
    });

    it('treats a write that returns the document it wrote as a read-after-write', async () => {
        const { driver, deps } = setup(SEED, [
            mig('002-upsert-and-use', async (ctx) => {
                await ctx.db('c1').collection('projects').findOneAndUpdate({ _id: 'p1' }, { $set: { archived: true } }, { returnDocument: 'after' });
            }),
        ]);

        const { results } = await dryRunMigrations(deps);

        expect(driver.landed).toEqual([]);
        expect(results[0].status).toBe('cannot-dry-run');
    });

    it('reports a migration that throws as failed and still plans the ones after it', async () => {
        const { deps } = setup(SEED, [
            mig('002-broken', async () => { throw new Error('bad data'); }),
            mig('003-fine', async (ctx) => { await ctx.db('c1').collection('projects').updateOne({ _id: 'p1' }, { $set: { archived: true } }); }),
        ]);

        const { results } = await dryRunMigrations(deps);

        expect(results.map((r) => [r.id, r.status])).toEqual([['002-broken', 'failed'], ['003-fine', 'plan']]);
        expect(results[0].error).toBe('bad data');
    });

    it('turns the guard off afterwards, so the same process can write again', async () => {
        const { driver, deps } = setup(SEED, [mig('002-x', async () => {})]);
        await dryRunMigrations(deps);
        await driver.db('c1').collection('projects').updateOne({ _id: 'p1' }, { $set: { archived: true } });
        expect(driver.landed).toEqual(['updateOne c1.projects']);
    });
});

describe('migrate verify', () => {
    it('runs verify on applied migrations only and reports pass, fail and no check', async () => {
        const { deps } = setup(SEED, [
            mig('001-no-check', async () => {}),
            mig('002-good', async () => {}, { verify: async () => [] }),
            mig('003-drifted', async () => {}, { verify: async () => ['c1: 2 tasks point at a missing key'] }),
            mig('004-throws', async () => {}, { verify: async () => { throw new Error('collection missing'); } }),
            mig('005-pending', async () => {}, { verify: async () => { throw new Error('a pending migration must not be verified'); } }),
        ], ['001-no-check', '002-good', '003-drifted', '004-throws']);

        const result = await verifyMigrations(deps);

        expect(result.results).toEqual([
            expect.objectContaining({ id: '001-no-check', status: 'no-check' }),
            expect.objectContaining({ id: '002-good', status: 'pass', problems: [] }),
            expect.objectContaining({ id: '003-drifted', status: 'fail', problems: ['c1: 2 tasks point at a missing key'] }),
            expect.objectContaining({ id: '004-throws', status: 'fail', error: 'collection missing' }),
        ]);
        expect(result.notApplied).toEqual(['005-pending']);
        const text = formatVerify(result);
        expect(text).toMatch(/001-no-check.*no check/);
        expect(text).toMatch(/002-good.*pass/);
        expect(text).toMatch(/003-drifted.*fail/);
    });

    it('fails a verify that tries to write, and the write never lands', async () => {
        const { driver, deps } = setup(SEED, [
            mig('002-sneaky', async () => {}, {
                verify: async (ctx) => {
                    await ctx.db('c1').collection('projects').updateOne({ _id: 'p1' }, { $set: { archived: true } }).catch(() => {});
                    return [];
                },
            }),
        ], ['002-sneaky']);

        const { results } = await verifyMigrations(deps);

        expect(driver.landed).toEqual([]);
        expect(results[0].status).toBe('fail');
        expect(results[0].error).toMatch(/tried to write.*updateOne.*projects/);
    });
});

describe('verify for 004-task-type-icons', () => {
    const icon = (key, value) => ({ key, value, name: value, iconType: 'library', iconValue: `mdi:${value}`, iconColor: '#2F3990' });
    const fakeCrud = (rows) => async (companyId, { type, data }, method) => {
        const [filter = {}] = data;
        if (type === 'projects' && method === 'find') return rows.projects;
        if (type === 'settings' && method === 'findOne') return rows.settings;
        if (type === 'task_type_templates' && method === 'find') return rows.templates;
        if (type === 'tasks' && method === 'countDocuments') {
            return rows.tasks.filter((t) => t.ProjectID === filter.ProjectID && t.TaskType === filter.TaskType && t.TaskTypeKey !== filter.TaskTypeKey.$ne).length;
        }
        throw new Error(`unexpected ${method} on ${type}`);
    };
    const ctxFor = (rows) => ({
        SCHEMA_TYPE: { PROJECTS: 'projects', TASKS: 'tasks', SETTINGS: 'settings', TASK_TYPE_TEMPLATES: 'task_type_templates' },
        settingsCollectionDocs: { TASK_TYPE: 'TaskType' },
        company: fakeCrud(rows),
        companies: {},
        async forEachCompany(fn) { await fn('c1'); return 1; },
    });

    it('passes when every type shows an icon and has a unique integer key and every task points at its key', async () => {
        const uploaded = { key: 3, value: 'task', name: 'Task', iconType: 'upload', iconValue: '', iconColor: null, taskImage: 'setting/task_type/task.png' };
        const rows = {
            projects: [{ _id: 'p1', ProjectName: 'Acme client work', taskTypeCounts: [icon(1, 'bug'), icon(2, 'story'), uploaded] }],
            tasks: [{ ProjectID: 'p1', TaskType: 'bug', TaskTypeKey: 1 }],
            settings: { settings: [icon(1, 'bug'), { key: 2, value: 'task', taskImage: 'setting/task_type/task.png' }] },
            templates: [{ _id: 'tpl1', taskTypes: [icon(1, 'bug'), { key: 2, value: 'task', taskImage: 'setting/task_type/task.png' }] }],
        };
        expect(await verifyTaskTypeIcons(ctxFor(rows), 'c1')).toEqual([]);
        expect(await taskTypeIconsMigration.verify(ctxFor(rows))).toEqual([]);
    });

    it('names each broken project, catalogue and template by id with counts, never by name', async () => {
        const rows = {
            projects: [{ _id: 'p1', ProjectName: 'Acme client work', taskTypeCounts: [{ key: NaN, value: 'bug', name: 'Bug' }, icon(2, 'story'), icon(2, 'epic')] }],
            tasks: [{ ProjectID: 'p1', TaskType: 'story', TaskTypeKey: 9 }, { ProjectID: 'p1', TaskType: 'story', TaskTypeKey: 8 }],
            settings: { settings: [{ key: 1, value: 'bug', name: 'Bug' }] },
            templates: [{ _id: 'tpl1', taskTypes: [{ key: 1, value: 'bug' }] }],
        };
        const problems = await verifyTaskTypeIcons(ctxFor(rows), 'c1');
        const text = problems.join('\n');
        expect(text).toMatch(/project p1: .*1 type without an icon/);
        expect(text).toMatch(/project p1: .*1 key that is not an integer/);
        expect(text).toMatch(/project p1: .*1 duplicate key/);
        expect(text).toMatch(/project p1: .*2 tasks off their type's key/);
        expect(text).toMatch(/task type catalogue: 1 type without an icon/);
        expect(text).toMatch(/template tpl1: 1 type without an icon/);
        expect(text).not.toContain('Acme');
        expect(await taskTypeIconsMigration.verify(ctxFor(rows))).toEqual(problems.map((p) => `c1 ${p}`));
    });
});
