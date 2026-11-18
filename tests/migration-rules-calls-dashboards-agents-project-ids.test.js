/* Task 040 phase 2: migrations 049 to 055 rewrite projectId from text to ObjectId on project rules,
   call notes, dashboards, agent findings, runs, proposals and delegated sessions in every tenant, a
   page at a time, leave "no project" and anything that is not an id alone, and say so. */
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
const {
    projectRulesSchema, callsSchema, userDashboard, agentFindingsSchema, agentRunsSchema, agentProposalsSchema, agentSessionsSchema,
} = require('../utils/mongo-handler/createSchema');
const { realModelStore, isObjectId } = require('./fixtures/realModelStore');

const C1 = '6f00000000000000000000c1';
const C2 = '6f00000000000000000000c2';
const PROJECT = '6f0000000000000000000a01';
const OTHER_PROJECT = '6f0000000000000000000a02';
const UPDATED_AT = new Date('2026-01-02T03:04:05.000Z');
const oid = (id) => new mongoose.Types.ObjectId(id);
const quiet = { info: jest.fn(), error: jest.fn() };
const contextFor = (companies, crud = MongoDbCrudOpration) => buildContext({ MongoDbCrudOpration: crud, SCHEMA_TYPE, settingsCollectionDocs, logger: quiet, listCompanies: async () => companies.map((_id) => ({ _id })) });

const CASES = [
    { id: '049-project-rule-project-ids', type: SCHEMA_TYPE.PROJECT_RULES, schema: projectRulesSchema, one: 'project rule', many: 'project rules', row: { key: 'task_create', isParent: false, roles: [] } },
    { id: '050-call-project-ids', type: SCHEMA_TYPE.CALLS, schema: callsSchema, one: 'call note', many: 'call notes', row: { callId: 'call', participants: [] } },
    { id: '051-dashboard-project-ids', type: SCHEMA_TYPE.USERDASHBOARD, schema: userDashboard, one: 'dashboard', many: 'dashboards', row: { userId: 'u', cards: [], title: 'Team', isDeleted: false, visibility: 'project' } },
    { id: '052-agent-finding-project-ids', type: SCHEMA_TYPE.AGENT_FINDINGS, schema: agentFindingsSchema, one: 'agent finding', many: 'agent findings', row: { taskId: 't', factId: 'f' } },
    { id: '053-agent-run-project-ids', type: SCHEMA_TYPE.AGENT_RUNS, schema: agentRunsSchema, one: 'agent run', many: 'agent runs', row: { agentId: 'a', status: 'done' } },
    { id: '054-agent-proposal-project-ids', type: SCHEMA_TYPE.AGENT_PROPOSALS, schema: agentProposalsSchema, one: 'agent proposal', many: 'agent proposals', row: { agentId: 'a', what: 'w', status: 'approved' } },
    { id: '055-agent-session-project-ids', type: SCHEMA_TYPE.AGENT_SESSIONS, schema: agentSessionsSchema, one: 'agent session', many: 'agent sessions', row: { taskId: 't', clientId: 'c', grantId: 'g', delegatedBy: 'u', state: 'ended' } },
];

test('the seven migrations follow 048 in this order', () => {
    const ids = listMigrations().map((m) => m.id);
    const at = ids.indexOf('048-estimate-project-ids');
    expect(ids.slice(at + 1, at + 1 + CASES.length)).toEqual(CASES.map((c) => c.id));
});

describe.each(CASES)('$id', ({ id, type, schema, one, many, row }) => {
    const migration = require(`../migrations/${id}`);
    const tag = id.slice(0, 3);
    const rows = (companyId) => mockDbFor(companyId).store[type] || [];
    const named = (companyId, name) => rows(companyId).find((r) => r.seedName === name);
    const seed = (companyId, name, projectId) => mockDbFor(companyId).seed(type, { ...row, seedName: name, projectId, updatedAt: UPDATED_AT });
    /* One tenant as upgrades find it: text ids, an id already converted, no project, a value that is not an id. */
    const seedLegacyCompany = (companyId) => {
        seed(companyId, 'text id', PROJECT);
        seed(companyId, 'other text id', OTHER_PROJECT);
        seed(companyId, 'already an ObjectId', oid(PROJECT));
        seed(companyId, 'no project', '');
        seed(companyId, 'legacy key', 'firebase-project');
    };
    const bulkWrites = (companyId) => mockDbFor(companyId).calls.filter((c) => c.method === 'bulkWrite');

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

        expect(ctx.companies[C1]).toEqual({ ok: true, converted: 2, invalid: 1 });
        const converted = named(C1, 'text id');
        expect(isObjectId(converted.projectId)).toBe(true);
        expect({ ...converted, projectId: String(converted.projectId) }).toMatchObject({ ...row, seedName: 'text id', projectId: PROJECT, updatedAt: UPDATED_AT });
        expect(isObjectId(named(C1, 'other text id').projectId)).toBe(true);
        expect(named(C1, 'no project').projectId).toBe('');
        expect(named(C1, 'legacy key').projectId).toBe('firebase-project');
        expect(quiet.info).toHaveBeenCalledWith(`[migrations] ${tag} ${C1}: 2 of 2 ${many} converted`);
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

        const { writes, error } = await realModelStore(type, schema).driverWrites('bulkWrite', call.data);
        expect(error).toBeNull();
        writes[0].args[0].forEach(({ updateOne }) => {
            expect(isObjectId(updateOne.update.$set.projectId)).toBe(true);
            expect(typeof updateOne.filter.projectId).toBe('string');
            expect(updateOne.update.$set).not.toHaveProperty('updatedAt');
        });
    });

    test('reads every candidate a page of 500 at a time in _id order before writing in batches of 500', async () => {
        for (let i = 0; i < migration.BATCH_SIZE + 1; i += 1) seed(C1, `row ${i}`, PROJECT);

        const ctx = contextFor([C1]);
        await migration.up(ctx);

        const reads = mockDbFor(C1).calls.filter((c) => c.method === 'find');
        expect(reads.map((c) => c.data[2])).toEqual([
            { sort: { _id: 1 }, limit: migration.BATCH_SIZE, lean: true },
            { sort: { _id: 1 }, limit: migration.BATCH_SIZE, lean: true },
        ]);
        expect(reads[1].data[0]._id.$gt).toBeDefined();
        const calls = mockDbFor(C1).calls.map((c) => c.method);
        expect(calls.lastIndexOf('find')).toBeLessThan(calls.indexOf('bulkWrite'));
        expect(bulkWrites(C1).map((c) => c.data[0].length)).toEqual([migration.BATCH_SIZE, 1]);
        expect(ctx.companies[C1]).toMatchObject({ converted: migration.BATCH_SIZE + 1 });
        expect(rows(C1).every((r) => isObjectId(r.projectId))).toBe(true);
        expect(quiet.info.mock.calls.map(([line]) => line).filter((line) => line.startsWith(`[migrations] ${tag} ${C1}:`))).toEqual([
            `[migrations] ${tag} ${C1}: read ${migration.BATCH_SIZE} ${many}`,
            `[migrations] ${tag} ${C1}: ${migration.BATCH_SIZE} of ${migration.BATCH_SIZE + 1} ${many} converted`,
            `[migrations] ${tag} ${C1}: ${migration.BATCH_SIZE + 1} of ${migration.BATCH_SIZE + 1} ${many} converted`,
            `[migrations] ${tag} ${C1}: {"converted":${migration.BATCH_SIZE + 1},"invalid":0}`,
        ]);
    });

    test('is safe to run twice: the second run converts nothing and changes nothing', async () => {
        seedLegacyCompany(C1);
        await migration.up(contextFor([C1]));
        const after = JSON.stringify(rows(C1));
        mockDbFor(C1).calls.length = 0;

        const again = contextFor([C1]);
        await migration.up(again);

        expect(again.companies[C1]).toEqual({ ok: true, converted: 0, invalid: 1 });
        expect(bulkWrites(C1)).toEqual([]);
        expect(JSON.stringify(rows(C1))).toBe(after);
    });

    test('keeps every tenant to its own database', async () => {
        seedLegacyCompany(C1);
        seed(C2, 'other tenant', OTHER_PROJECT);

        const ctx = contextFor([C1, C2]);
        await migration.up(ctx);

        expect(ctx.companies[C2]).toEqual({ ok: true, converted: 1, invalid: 0 });
        [C1, C2].forEach((companyId) => expect(mockDbFor(companyId).calls.every((c) => String(c.companyId) === companyId)).toBe(true));
    });

    test('verify counts the rows still holding a text id, and reports none after the migration', async () => {
        seedLegacyCompany(C1);
        seed(C2, 'other tenant', OTHER_PROJECT);

        expect(await migration.verify(contextFor([C1, C2]))).toEqual([
            `${C1} 2 ${many} still store a project id as text`,
            `${C2} 1 ${one} still stores a project id as text`,
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

            bulkWrite(...data) { return this.run('bulkWrite', data); }
        }
        class Db {}
        const driverCrud = (companyId, { type: collection, data }, method) => new Collection(String(companyId), collection)[method](...data);
        let guard;
        beforeAll(() => { guard = installWriteGuard({ Collection, Db }); });
        afterAll(() => guard.uninstall());

        test('plans the conversion per company and writes nothing', async () => {
            seedLegacyCompany(C1);
            seed(C2, 'other tenant', OTHER_PROJECT);
            const before = JSON.stringify([rows(C1), rows(C2)]);

            const result = await dryRunMigrations({ store: createMemoryStore(), migrations: [migration], makeContext: () => contextFor([C1, C2], driverCrud), guard });

            expect(JSON.stringify([rows(C1), rows(C2)])).toBe(before);
            expect(bulkWrites(C1).concat(bulkWrites(C2))).toEqual([]);
            const [plan] = result.results;
            expect(plan).toMatchObject({ id, status: 'plan' });
            expect(plan.writes.every(({ collection, op }) => collection === type && op === 'bulkWrite')).toBe(true);
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
            store.docs.set(id, { _id: id, ok: true });
            const makeContext = () => contextFor([C1], driverCrud);

            const failing = await verifyMigrations({ store, migrations: [migration], makeContext, guard });
            expect(failing.results).toEqual([{ id, status: 'fail', problems: [`${C1} 2 ${many} still store a project id as text`], error: null }]);
            expect(formatVerify(failing)).toContain(`${id}  fail`);

            await migration.up(contextFor([C1]));
            const passing = await verifyMigrations({ store, migrations: [migration], makeContext, guard });
            expect(passing.results).toEqual([{ id, status: 'pass', problems: [], error: null }]);
        });
    });
});
