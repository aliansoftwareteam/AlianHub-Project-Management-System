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
const migration = require('../migrations/021-project-view-ids');

const BROKEN = '6f0000000000000000000d01';
const CLEAN = '6f0000000000000000000d02';
const logger = { info: jest.fn(), error: jest.fn() };
const contextFor = (companies) => buildContext({ MongoDbCrudOpration, SCHEMA_TYPE, settingsCollectionDocs, logger, listCompanies: async () => companies.map((_id) => ({ _id })) });

const projects = (companyId) => mockDbFor(companyId).store[SCHEMA_TYPE.PROJECTS] || [];
const projectNamed = (companyId, name) => projects(companyId).find((p) => p.ProjectName === name);
const viewIds = (companyId, name) => (projectNamed(companyId, name).ProjectRequiredComponent || []).map((v) => String(v._id));

/* The shape Local360 (6a8ee973d625fca52e519a12) has: a view catalogue with no "Board" row, so
   every project created from a template that offers Board carries a ProjectKanban entry with
   no `_id` at all — and Projects.vue reads `_id.length` on it. */
const LIST_ROW = { _id: '6a97261fb28e840202058560', keyName: 'ProjectListView', name: 'List' };
const GANTT_ROW = { _id: '6a97261fb28e840202058561', keyName: 'GanttView', name: 'Gantt View' };
const BOARD = { keyName: 'ProjectKanban', value: 'ProjectKanban', name: 'Board', viewStatus: true, setAsDefault: false };
const listView = { ...LIST_ROW, viewStatus: true, setAsDefault: true };

const seedCompany = (companyId, { board = true } = {}) => {
    const db = mockDbFor(companyId);
    db.seed(SCHEMA_TYPE.PROJECT_TAB_COMPONENTS, { ...LIST_ROW });
    db.seed(SCHEMA_TYPE.PROJECT_TAB_COMPONENTS, { ...GANTT_ROW });
    if (board) db.seed(SCHEMA_TYPE.PROJECT_TAB_COMPONENTS, { _id: '6a97261fb28e840202058562', keyName: 'ProjectKanban', name: 'Board' });
    return db;
};

beforeEach(() => {
    Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
    jest.clearAllMocks();
});

describe('021-project-view-ids', () => {
    test('is a valid company-scoped migration listed after 020', () => {
        expect(() => validateMigration(migration, '021-project-view-ids')).not.toThrow();
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf('021-project-view-ids')).toBeGreaterThan(ids.indexOf('020-workflow-definitions'));
    });

    test('gives the Board entry an id and leaves every other entry alone', async () => {
        const db = seedCompany(BROKEN, { board: false });
        db.seed(SCHEMA_TYPE.PROJECTS, { ProjectName: 'SPWB', ProjectRequiredComponent: [{ ...listView }, { ...BOARD }] });
        db.seed(SCHEMA_TYPE.PROJECTS, { ProjectName: 'Local Smoke', ProjectRequiredComponent: [{ ...listView }, { ...GANTT_ROW, viewStatus: true }] });

        const ctx = contextFor([BROKEN]);
        await migration.up(ctx);

        expect(ctx.companies[BROKEN]).toEqual({ ok: true, projects: 2, repaired: 1, entries: 1 });
        const [listId, boardId] = viewIds(BROKEN, 'SPWB');
        expect(listId).toBe(LIST_ROW._id);
        expect(boardId).toMatch(/^[0-9a-f]{24}$/);
        expect(projectNamed(BROKEN, 'SPWB').ProjectRequiredComponent[1]).toMatchObject({ keyName: 'ProjectKanban', name: 'Board', viewStatus: true });
        expect(viewIds(BROKEN, 'Local Smoke')).toEqual([LIST_ROW._id, GANTT_ROW._id]);
        expect(removeCache).toHaveBeenCalledWith(`UserProjectData:${BROKEN}:`, true);
        expect(mockDbFor(BROKEN).calls.every((call) => call.companyId === BROKEN)).toBe(true);
    });

    test('takes the id from the company catalogue when it has a row for that view', async () => {
        const db = seedCompany(BROKEN);
        db.seed(SCHEMA_TYPE.PROJECTS, { ProjectName: 'SHOP', ProjectRequiredComponent: [{ ...listView }, { ...BOARD }] });

        await migration.up(contextFor([BROKEN]));

        expect(viewIds(BROKEN, 'SHOP')).toEqual([LIST_ROW._id, '6a97261fb28e840202058562']);
    });

    test('is idempotent: a second run repairs nothing and keeps the ids the first run minted', async () => {
        const db = seedCompany(BROKEN, { board: false });
        db.seed(SCHEMA_TYPE.PROJECTS, { ProjectName: 'SPWC', ProjectRequiredComponent: [{ ...listView }, { ...BOARD }] });
        await migration.up(contextFor([BROKEN]));
        const after = viewIds(BROKEN, 'SPWC');

        const again = contextFor([BROKEN]);
        await migration.up(again);

        expect(again.companies[BROKEN]).toEqual({ ok: true, projects: 1, repaired: 0, entries: 0 });
        expect(viewIds(BROKEN, 'SPWC')).toEqual(after);
    });

    test('writes nothing to a company whose projects all have ids', async () => {
        const db = seedCompany(CLEAN);
        db.seed(SCHEMA_TYPE.PROJECTS, { ProjectName: 'Local Smoke', ProjectRequiredComponent: [{ ...listView }] });
        db.seed(SCHEMA_TYPE.PROJECTS, { ProjectName: 'Embeds', ProjectRequiredComponent: [{ ...listView }, { name: 'Figma', _id: 'ab12cd', id: 'ab12cd' }] });

        const ctx = contextFor([CLEAN]);
        await migration.up(ctx);

        expect(ctx.companies[CLEAN]).toEqual({ ok: true, projects: 2, repaired: 0, entries: 0 });
        expect(mockDbFor(CLEAN).calls.some((call) => call.method === 'updateOne')).toBe(false);
        expect(removeCache).not.toHaveBeenCalled();
        expect(viewIds(CLEAN, 'Embeds')).toEqual([LIST_ROW._id, 'ab12cd']);
    });

    test('a project with no views at all is left as it is', async () => {
        const db = seedCompany(CLEAN);
        db.seed(SCHEMA_TYPE.PROJECTS, { ProjectName: 'Bare', ProjectRequiredComponent: [] });
        db.seed(SCHEMA_TYPE.PROJECTS, { ProjectName: 'Unset' });

        const ctx = contextFor([CLEAN]);
        await migration.up(ctx);

        expect(ctx.companies[CLEAN]).toEqual({ ok: true, projects: 2, repaired: 0, entries: 0 });
        expect(projectNamed(CLEAN, 'Unset').ProjectRequiredComponent).toBeUndefined();
    });
});
