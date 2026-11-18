const mockDbs = {};
const mockDbFor = (companyId) => { mockDbs[companyId] = mockDbs[companyId] || require('./fixtures/fakeMongo').create(); return mockDbs[companyId]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));

const { buildContext, validateMigration, listMigrations } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { settingsCollectionDocs } = require('../Config/collections');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const migration = require('../migrations/023-agent-project-scope');

const COMPANY = '6f0000000000000000000e01';
const ALPHA = '6f0000000000000000000e11';
const BETA = '6f0000000000000000000e12';
const GONE = '6f0000000000000000000e13';
const logger = { info: jest.fn(), error: jest.fn() };
const contextFor = (companies) => buildContext({ MongoDbCrudOpration, SCHEMA_TYPE, settingsCollectionDocs, logger, listCompanies: async () => companies.map((_id) => ({ _id })) });

const agents = (companyId) => mockDbFor(companyId).store[SCHEMA_TYPE.AGENTS] || [];
const named = (companyId, name) => agents(companyId).find((a) => a.name === name);
const scopeOf = (companyId, name) => (named(companyId, name).projectIds || []).map(String);

const seedCompany = (companyId) => {
    const db = mockDbFor(companyId);
    db.seed(SCHEMA_TYPE.PROJECTS, { _id: ALPHA, ProjectName: 'Alpha', deletedStatusKey: 0 });
    db.seed(SCHEMA_TYPE.PROJECTS, { _id: BETA, ProjectName: 'Beta', deletedStatusKey: 0 });
    db.seed(SCHEMA_TYPE.PROJECTS, { _id: GONE, ProjectName: 'Archived', deletedStatusKey: 1 });
    return db;
};

beforeEach(() => {
    Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
    jest.clearAllMocks();
});

describe('023-agent-project-scope', () => {
    test('is a valid company-scoped migration listed after 022', () => {
        expect(() => validateMigration(migration, '023-agent-project-scope')).not.toThrow();
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf('023-agent-project-scope')).toBeGreaterThan(ids.indexOf('022-seed-reporter-and-guide-skills'));
    });

    test('gives an acting agent with no scope the live projects it was already writing to', async () => {
        const db = seedCompany(COMPANY);
        db.seed(SCHEMA_TYPE.AGENTS, { name: 'Sweep Intake', autonomy: 2, projectIds: [], deletedStatusKey: 0 });

        await migration.up(contextFor([COMPANY]));

        expect(scopeOf(COMPANY, 'Sweep Intake')).toEqual([ALPHA, BETA]);
    });

    test('leaves an agent below L2 unscoped, because it proposes every change to a person', async () => {
        const db = seedCompany(COMPANY);
        db.seed(SCHEMA_TYPE.AGENTS, { name: 'Reporter', autonomy: 1, projectIds: [], deletedStatusKey: 0 });
        db.seed(SCHEMA_TYPE.AGENTS, { name: 'QA', autonomy: 0, projectIds: [], deletedStatusKey: 0 });

        await migration.up(contextFor([COMPANY]));

        expect(scopeOf(COMPANY, 'Reporter')).toEqual([]);
        expect(scopeOf(COMPANY, 'QA')).toEqual([]);
    });

    test('never widens a scope somebody already chose, and skips deleted agents', async () => {
        const db = seedCompany(COMPANY);
        db.seed(SCHEMA_TYPE.AGENTS, { name: 'Scoped', autonomy: 3, projectIds: [ALPHA], deletedStatusKey: 0 });
        db.seed(SCHEMA_TYPE.AGENTS, { name: 'Deleted', autonomy: 2, projectIds: [], deletedStatusKey: 1 });

        await migration.up(contextFor([COMPANY]));

        expect(scopeOf(COMPANY, 'Scoped')).toEqual([ALPHA]);
        expect(scopeOf(COMPANY, 'Deleted')).toEqual([]);
    });

    test('reports what it touched per company and is safe to run twice', async () => {
        const db = seedCompany(COMPANY);
        db.seed(SCHEMA_TYPE.AGENTS, { name: 'Sweep Intake', autonomy: 2, projectIds: [], deletedStatusKey: 0 });
        db.seed(SCHEMA_TYPE.AGENTS, { name: 'Reporter', autonomy: 1, projectIds: [], deletedStatusKey: 0 });

        const first = contextFor([COMPANY]);
        await migration.up(first);
        expect(first.companies[COMPANY]).toMatchObject({ ok: true, acting: 1, scoped: 1, projects: 2 });

        const second = contextFor([COMPANY]);
        await migration.up(second);
        expect(second.companies[COMPANY]).toMatchObject({ ok: true, acting: 1, scoped: 0, projects: 0 });
        expect(scopeOf(COMPANY, 'Sweep Intake')).toEqual([ALPHA, BETA]);
    });
});
