const path = require('node:path');
const { execFile } = require('node:child_process');
const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { readState } = require('../../e2e/support/fixtures');

/* `npm run migrate -- up --dry-run` and `-- verify` against the harness database, through the real
 * CLI: the driver-level guard has to hold for Mongoose and MongoDbCrudOpration, not just a fake. */

const ROOT = path.resolve(__dirname, '..', '..');
const state = readState();
const SWEEP_INDEX = 'sourceType_1_extractDueAt_1';
const ICON_FIELDS = ['iconType', 'iconValue', 'iconColor', 'taskImage'];

let client;
let company;
let schemaVersions;
let savedRecords;
let savedTypes;
let sweepIndex;

const migrate = (...args) => new Promise((resolve) => {
    execFile(process.execPath, [path.join(ROOT, 'scripts', 'migrate.js'), ...args], {
        cwd: ROOT,
        env: { ...process.env, MONGODB_URL: resolveMongoUrl(), MIGRATIONS_AUTO: 'false' },
        timeout: 90000,
    }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
});

const sorted = (rows) => rows.map((row) => JSON.stringify(row)).sort();
const snapshot = async () => ({
    projects: sorted(await company.collection('projects').find({}).toArray()),
    tasks: sorted(await company.collection('tasks').find({}).toArray()),
    settings: sorted(await company.collection('settings').find({}).toArray()),
    templates: sorted(await company.collection('task_type_templates').find({}).toArray()),
    chunkIndexes: (await company.collection('knowledge_chunks').indexes().catch(() => [])).map((i) => i.name).sort(),
    schemaVersions: sorted(await schemaVersions.find({ _id: { $ne: '__lock' } }).toArray()),
});

beforeAll(async () => {
    client = await MongoClient.connect(resolveMongoUrl());
    company = client.db(state.companyId);
    schemaVersions = client.db('global').collection('schema_versions');

    savedRecords = await schemaVersions.find({ _id: { $in: ['004-task-type-icons', '032-knowledge-file-sweep'] } }).toArray();
    expect(savedRecords.map((r) => r._id).sort()).toEqual(['004-task-type-icons', '032-knowledge-file-sweep']);
    await schemaVersions.deleteMany({ _id: { $in: savedRecords.map((r) => r._id) } });

    const project = await company.collection('projects').findOne({ _id: new ObjectId(state.projects.shared._id) });
    savedTypes = project.taskTypeCounts;
    const stripped = savedTypes.map((entry) => Object.fromEntries(Object.entries(entry).filter(([key]) => !ICON_FIELDS.includes(key))));
    await company.collection('projects').updateOne({ _id: project._id }, { $set: { taskTypeCounts: stripped } });

    sweepIndex = (await company.collection('knowledge_chunks').indexes().catch(() => [])).find((i) => i.name === SWEEP_INDEX);
    if (sweepIndex) await company.collection('knowledge_chunks').dropIndex(SWEEP_INDEX);
});

afterAll(async () => {
    if (!client) return;
    if (savedTypes) await company.collection('projects').updateOne({ _id: new ObjectId(state.projects.shared._id) }, { $set: { taskTypeCounts: savedTypes } });
    for (const record of savedRecords || []) await schemaVersions.replaceOne({ _id: record._id }, record, { upsert: true });
    if (sweepIndex) {
        const { key, name, v, ns, ...options } = sweepIndex;
        await company.collection('knowledge_chunks').createIndex(key, { name, ...options }).catch(() => {});
    }
    await client.close();
});

it('up --dry-run plans 004, reports 032 as cannot dry-run, writes nothing and records nothing', async () => {
    const before = await snapshot();

    const { code, stdout, stderr } = await migrate('up', '--dry-run');

    expect({ code, stderr: code ? stderr : '' }).toEqual({ code: 0, stderr: '' });
    expect(stdout).toMatch(/004-task-type-icons/);
    expect(stdout).toMatch(/updateOne\s+projects/);
    expect(stdout).toMatch(/032-knowledge-file-sweep[\s\S]*cannot dry-run[\s\S]*knowledge_chunks/);
    expect(stdout).not.toContain(state.projects.shared.name);
    expect(await snapshot()).toEqual(before);
    expect(await schemaVersions.countDocuments({ _id: { $in: ['004-task-type-icons', '032-knowledge-file-sweep'] } })).toBe(0);
});

it('verify fails 004 while a project has types without icons, lists the rest, and passes once they are back', async () => {
    const record = savedRecords.find((r) => r._id === '004-task-type-icons');
    await schemaVersions.replaceOne({ _id: record._id }, record, { upsert: true });
    const before = await snapshot();

    const failing = await migrate('verify');

    expect(failing.code).toBe(1);
    expect(failing.stdout).toMatch(/004-task-type-icons\s+fail/);
    expect(failing.stdout).toContain(`project ${state.projects.shared._id}`);
    expect(failing.stdout).toMatch(/001-baseline\s+no check/);
    expect(await snapshot()).toEqual(before);

    await company.collection('projects').updateOne({ _id: new ObjectId(state.projects.shared._id) }, { $set: { taskTypeCounts: savedTypes } });
    const passing = await migrate('verify');

    expect(passing.stdout).toMatch(/004-task-type-icons\s+pass/);
    expect(passing.code).toBe(0);
});
