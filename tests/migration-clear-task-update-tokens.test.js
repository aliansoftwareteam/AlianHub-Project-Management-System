const mockDbs = {};
const mockDbFor = (companyId) => { mockDbs[companyId] = mockDbs[companyId] || require('./fixtures/fakeMongo').create(); return mockDbs[companyId]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));

const fs = require('fs');
const path = require('path');
const { buildContext, validateMigration, listMigrations } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { settingsCollectionDocs } = require('../Config/collections');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');

const ID = '028-clear-task-update-tokens';
const loadMigration = () => require(`../migrations/${ID}`);

const ACME = '6f0000000000000000028001';
const GLOBEX = '6f0000000000000000028002';
const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOiJ1c2VyLTEifQ.c2lnbmF0dXJlLXZhbHVl';
const logger = { info: jest.fn(), error: jest.fn() };
const contextFor = (companies) => buildContext({ MongoDbCrudOpration, SCHEMA_TYPE, settingsCollectionDocs, logger, listCompanies: async () => companies.map((_id) => ({ _id })) });

const tasks = (companyId) => mockDbFor(companyId).store[SCHEMA_TYPE.TASKS] || [];
const named = (companyId, name) => tasks(companyId).find((t) => t.TaskName === name);

const seedCompany = (companyId) => {
    const db = mockDbFor(companyId);
    db.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Dragged by status', TaskKey: 'AH-1', Task_Priority: 'HIGH', islocalSnapStop: true, updateToken: { user: JWT, timeStamp: 1700000000000 } });
    db.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Dragged by priority', TaskKey: 'AH-2', updateToken: { user: JWT, timeStamp: 1700000000001 } });
    db.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Never dragged', TaskKey: 'AH-3' });
    return db;
};

beforeEach(() => {
    Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
    jest.clearAllMocks();
});

describe(ID, () => {
    test('is a valid company-scoped migration listed after 023', () => {
        expect(fs.existsSync(path.join(__dirname, '..', 'migrations', `${ID}.js`))).toBe(true);
        const migration = loadMigration();
        expect(() => validateMigration(migration, ID)).not.toThrow();
        expect(migration.scope).toBe('company');
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf(ID)).toBeGreaterThan(ids.indexOf('023-agent-project-scope'));
    });

    test('removes the stored update marker from every task in every company and nothing else', async () => {
        seedCompany(ACME);
        seedCompany(GLOBEX);

        await loadMigration().up(contextFor([ACME, GLOBEX]));

        [ACME, GLOBEX].forEach((companyId) => {
            tasks(companyId).forEach((task) => expect(task).not.toHaveProperty('updateToken'));
            expect(named(companyId, 'Dragged by status')).toMatchObject({ TaskKey: 'AH-1', Task_Priority: 'HIGH', islocalSnapStop: true });
        });
    });

    test('reports what it cleared per company and is safe to run twice', async () => {
        seedCompany(ACME);

        const first = contextFor([ACME]);
        await loadMigration().up(first);
        expect(first.companies[ACME]).toMatchObject({ ok: true, cleared: 2 });

        const second = contextFor([ACME]);
        await loadMigration().up(second);
        expect(second.companies[ACME]).toMatchObject({ ok: true, cleared: 0 });
    });
});
