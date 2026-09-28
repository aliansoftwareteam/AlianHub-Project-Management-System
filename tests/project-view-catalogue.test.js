const mockDbs = {};
const mockDbFor = (companyId) => { mockDbs[companyId] = mockDbs[companyId] || require('./fixtures/fakeMongo').create(); return mockDbs[companyId]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/config', () => { const NodeCache = require('node-cache'); return { myCache: new NodeCache() }; });

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { myCache } = require('../Config/config');
const { getProjectTabs } = require('../Modules/projectTabs/controller');

const T = SCHEMA_TYPE.PROJECT_TAB_COMPONENTS;
const COMPANY = '6a8ee973d625fca52e519a12';
const CACHE_KEY = `ProjectTabs:${COMPANY}`;

const ALL_VIEWS = [
    'ProjectListView', 'ProjectKanban', 'ProjectDetail', 'Comments', 'Calendar', 'ActivityLog', 'Workload',
    'ProjectDashboard', 'TableView', 'Embed', 'Reports', 'GanttView', 'RecurringTasks', 'TimelineView',
    'MindMapView', 'WhiteboardView', 'CanvasView', 'MapView', 'DocsView', 'FormsView',
];

/* The owner's workspace on build 519: Dashboard from the old self-heal, List and Gantt View. */
const OWNER_ROWS = [
    { _id: '6a8ef08c2b6984dc41edb199', keyName: 'ProjectDashboard', name: 'Dashboard', sortIndex: 8, value: 'dashboard', setAsDefault: false, viewStatus: false },
    { _id: '6a97261fb28e840202058560', keyName: 'ProjectListView', name: 'List', sortIndex: 1, value: 'list', setAsDefault: false, viewStatus: false },
    { _id: '6a97261fb28e840202058561', keyName: 'GanttView', name: 'Gantt View', sortIndex: 12, value: 'ganttview', setAsDefault: false, viewStatus: false },
];

const rows = () => mockDbFor(COMPANY).store[T] || [];
const keyNames = (list) => list.map((row) => row.keyName).sort();
const writes = () => mockDbFor(COMPANY).calls.filter((call) => call.method !== 'find');

const fetchTabs = async () => {
    const res = {
        headers: {},
        set(headers) { Object.assign(this.headers, headers); return this; },
        status(code) { this.code = code; return this; },
        json(body) { this.body = body; return this; },
    };
    await getProjectTabs({ headers: { companyid: COMPANY } }, res);
    return res;
};

beforeEach(() => {
    Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
    myCache.flushAll();
});

describe('GET /api/v1/projectTabs heals a partial view catalogue', () => {
    it('adds the 17 missing views to a company holding 3 and answers with all 20', async () => {
        OWNER_ROWS.forEach((row) => mockDbFor(COMPANY).seed(T, { ...row }));

        const res = await fetchTabs();

        expect(res.code).toBe(200);
        expect(keyNames(res.body)).toEqual([...ALL_VIEWS].sort());
        expect(keyNames(rows())).toEqual([...ALL_VIEWS].sort());
    });

    it('keeps the ids, names and order of the views the company already had', async () => {
        OWNER_ROWS.forEach((row) => mockDbFor(COMPANY).seed(T, { ...row }));

        await fetchTabs();

        OWNER_ROWS.forEach((row) => {
            const stored = rows().filter((r) => r.keyName === row.keyName);
            expect(stored).toHaveLength(1);
            expect(stored[0]).toMatchObject({ _id: row._id, name: row.name, sortIndex: row.sortIndex });
        });
    });

    it('never duplicates a view on repeat calls', async () => {
        OWNER_ROWS.forEach((row) => mockDbFor(COMPANY).seed(T, { ...row }));

        await fetchTabs();
        myCache.flushAll();
        await fetchTabs();
        myCache.flushAll();
        const res = await fetchTabs();

        expect(rows()).toHaveLength(20);
        expect(new Set(keyNames(rows())).size).toBe(20);
        expect(res.body).toHaveLength(20);
    });

    it('replaces a partial list already in the 7-day cache instead of serving it', async () => {
        OWNER_ROWS.forEach((row) => mockDbFor(COMPANY).seed(T, { ...row }));
        myCache.set(CACHE_KEY, OWNER_ROWS.map((row) => ({ ...row })), 604800);

        const res = await fetchTabs();

        expect(res.body).toHaveLength(20);
        expect(res.headers.FromCache).toBeUndefined();
        expect(myCache.get(CACHE_KEY)).toHaveLength(20);
    });

    it('serves a complete catalogue from the cache without writing', async () => {
        await fetchTabs();
        mockDbFor(COMPANY).calls.length = 0;

        const res = await fetchTabs();

        expect(res.headers.FromCache).toBe('true');
        expect(res.body).toHaveLength(20);
        expect(writes()).toHaveLength(0);
    });

    it('leaves legacy Timeline and Gantt rows alone and still adds the current views once', async () => {
        mockDbFor(COMPANY).seed(T, { keyName: 'Timeline', name: 'Timeline', sortIndex: 12, value: 'timeline', setAsDefault: false, viewStatus: false });
        mockDbFor(COMPANY).seed(T, { keyName: 'Gantt', name: 'Gantt', sortIndex: 12, value: 'gantt', setAsDefault: false, viewStatus: false });

        await fetchTabs();

        expect(rows()).toHaveLength(22);
        expect(rows().filter((r) => r.keyName === 'TimelineView')).toHaveLength(1);
        expect(rows().filter((r) => r.keyName === 'Timeline')).toHaveLength(1);
    });
});
