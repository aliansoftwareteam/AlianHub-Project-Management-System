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
const { removeCache } = require('../utils/commonFunctions');
const { evaluatePermission } = require('../Config/permissionGuard');

const COMPANY = '6f0000000000000000000e01';
const CLEAN = '6f0000000000000000000e02';
const MEMBER = '6f0000000000000000000003';
const logger = { info: jest.fn(), error: jest.fn() };
const contextFor = (companies) => buildContext({ MongoDbCrudOpration, SCHEMA_TYPE, settingsCollectionDocs, logger, listCompanies: async () => companies.map((_id) => ({ _id })) });

const loadMigration = () => require('../migrations/029-permission-global-flag');
const flagOf = (companyId, name) => {
    const project = mockDbFor(companyId).store[SCHEMA_TYPE.PROJECTS].find((p) => p.ProjectName === name);
    return Object.prototype.hasOwnProperty.call(project, 'isGlobalPermission') ? project.isGlobalPermission : 'missing';
};

const seedCompany = (companyId) => {
    const db = mockDbFor(companyId);
    db.seed(SCHEMA_TYPE.PROJECTS, { ProjectName: 'Global', isGlobalPermission: true });
    db.seed(SCHEMA_TYPE.PROJECTS, { ProjectName: 'Own rules', isGlobalPermission: false });
    return db;
};

beforeEach(() => {
    Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
    jest.clearAllMocks();
});

describe('029-permission-global-flag', () => {
    test('is a valid company-scoped migration listed after 023', () => {
        const migration = loadMigration();
        expect(() => validateMigration(migration, '029-permission-global-flag')).not.toThrow();
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf('029-permission-global-flag')).toBeGreaterThan(ids.indexOf('023-agent-project-scope'));
    });

    test('sets true where the flag is null or missing and leaves true and false alone', async () => {
        const db = seedCompany(COMPANY);
        db.seed(SCHEMA_TYPE.PROJECTS, { ProjectName: 'Null flag', isGlobalPermission: null });
        db.seed(SCHEMA_TYPE.PROJECTS, { ProjectName: 'No flag' });
        seedCompany(CLEAN);

        const ctx = contextFor([COMPANY, CLEAN]);
        await loadMigration().up(ctx);

        expect([flagOf(COMPANY, 'Global'), flagOf(COMPANY, 'Own rules'), flagOf(COMPANY, 'Null flag'), flagOf(COMPANY, 'No flag')]).toEqual([true, false, true, true]);
        expect(ctx.companies[COMPANY]).toEqual({ ok: true, repaired: 2 });
        expect(ctx.companies[CLEAN]).toEqual({ ok: true, repaired: 0 });
        expect(removeCache).toHaveBeenCalledTimes(1);
        expect(removeCache).toHaveBeenCalledWith(`UserProjectData:${COMPANY}:`, true);
        expect(mockDbFor(COMPANY).calls.every((call) => call.companyId === COMPANY)).toBe(true);
    });

    test('is idempotent', async () => {
        mockDbFor(COMPANY).seed(SCHEMA_TYPE.PROJECTS, { ProjectName: 'Null flag', isGlobalPermission: null });
        await loadMigration().up(contextFor([COMPANY]));
        const ctx = contextFor([COMPANY]);
        await loadMigration().up(ctx);
        expect(ctx.companies[COMPANY]).toEqual({ ok: true, repaired: 0 });
        expect(flagOf(COMPANY, 'Null flag')).toBe(true);
    });

    test('changes no server decision: a null project was already judged on the company rules', async () => {
        const db = mockDbFor(COMPANY);
        const project = db.seed(SCHEMA_TYPE.PROJECTS, { ProjectName: 'Null flag', isGlobalPermission: null });
        db.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: 3, status: 2, isDelete: false });
        const parent = db.seed(SCHEMA_TYPE.RULES, { key: 'task', name: 'Task', isParent: true, roles: [] });
        db.seed(SCHEMA_TYPE.RULES, { key: 'task_create', name: 'task_create', isParent: false, parentId: String(parent._id), roles: [{ key: 3, permission: true }] });
        const projectParent = db.seed(SCHEMA_TYPE.PROJECT_RULES, { key: 'task', name: 'Task', isParent: true, roles: [], projectId: String(project._id) });
        db.seed(SCHEMA_TYPE.PROJECT_RULES, { key: 'task_create', name: 'task_create', isParent: false, parentId: String(projectParent._id), roles: [{ key: 3, permission: null }], projectId: String(project._id) });
        const scope = { projectId: String(project._id) };

        const before = await evaluatePermission(COMPANY, MEMBER, 'task.task_create', scope);
        await loadMigration().up(contextFor([COMPANY]));
        const after = await evaluatePermission(COMPANY, MEMBER, 'task.task_create', scope);

        expect([before, after]).toEqual([true, true]);
    });
});
