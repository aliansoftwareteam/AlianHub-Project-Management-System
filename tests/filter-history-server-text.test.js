const mockDb = require('./fixtures/fakeMongo').create({ mongooseCasting: true });

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/projectAccess', () => ({ canReadProject: jest.fn(async () => ({ allowed: true })) }));
jest.mock('../Modules/Tasks/helpers/handleNotification', () => ({ HandleBothNotification: jest.fn(async () => ({ status: true })) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { canReadProject } = require('../Config/projectAccess');
const taskFilters = require('../Modules/Tasks/helpers/manageGlobalFilter');

/* Follow-up 111: saved filter changes are written to the open project's history by the filter routes. */

const CID = '6f00000000000000000000c1';
const OWNER = '6f0000000000000000000001';
const MEMBER = '6f0000000000000000000003';
const PROJECT = '6f0000000000000000000a01';
const HTML = '<img src=x onerror=alert(1)>';
const ESCAPED = '&lt;img src=x onerror=alert&#40;1&#41;&gt;';

const settle = async () => { for (let i = 0; i < 40; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const clone = (value) => JSON.parse(JSON.stringify(value));
const reply = () => {
    const r = { code: 200, body: null };
    r.status = (code) => { r.code = code; return r; };
    r.json = (body) => { r.body = body; return r; };
    r.send = r.json;
    return r;
};
const call = async (handler, req) => {
    const r = reply();
    await handler({ headers: { companyid: CID }, uid: MEMBER, query: {}, params: {}, ...req }, r);
    await settle();
    return r;
};
const messages = () => clone(mockDb.store[SCHEMA_TYPE.HISTORY] || []).map((row) => [row.Key, row.ProjectId, row.UserId, row.Message]);

let filter;
beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    filter = mockDb.seed(SCHEMA_TYPE.GLOBALFILTER, { name: `Mine ${HTML}`, userId: MEMBER, filter: 'taskFilter', typeFilter: 'tasks', filters: [] });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: MEMBER, Employee_Name: 'Max Member' });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: OWNER, Employee_Name: 'Olivia Owner' });
});

describe('a saved filter change made from a project', () => {
    test('an update names the stored filter for the signed-in user in that project', async () => {
        const r = await call(taskFilters.updateFilter, { query: { projectId: PROJECT }, body: [{ _id: String(filter._id) }, { $set: { name: 'Renamed' } }] });
        expect(r.code).toBe(200);
        expect(messages()).toEqual([['Project_Filter', PROJECT, MEMBER, `<b>Max Member</b> has been updated <b>Mine ${ESCAPED}</b> filter`]]);
    });

    test('a delete names the stored filter', async () => {
        const r = await call(taskFilters.deleteFilter, { query: { projectId: PROJECT }, params: { cid: CID, id: String(filter._id) } });
        expect(r.code).toBe(200);
        expect(mockDb.store[SCHEMA_TYPE.GLOBALFILTER]).toHaveLength(0);
        expect(messages()).toEqual([['Project_Filter', PROJECT, MEMBER, `<b>Max Member</b> has been deleted <b>Mine ${ESCAPED}</b> filter`]]);
    });

    test('no project, a project the caller cannot read, or a filter that is not theirs writes no row', async () => {
        await call(taskFilters.updateFilter, { body: [{ _id: String(filter._id) }, { $set: { name: 'A' } }] });
        canReadProject.mockResolvedValueOnce({ allowed: false });
        await call(taskFilters.updateFilter, { query: { projectId: PROJECT }, body: [{ _id: String(filter._id) }, { $set: { name: 'B' } }] });
        await call(taskFilters.deleteFilter, { uid: OWNER, query: { projectId: PROJECT }, params: { cid: CID, id: String(filter._id) } });
        expect(messages()).toEqual([]);
    });
});

describe('the generic history route leaves filter changes to the server', () => {
    const handlers = {};
    const app = { post: (path, ...fns) => { handlers[`POST ${path}`] = fns[fns.length - 1]; }, get: () => {}, put: () => {} };
    require('../Modules/notification1/routes').init(app);

    test('a Project_Filter row sent by the web app is not stored', async () => {
        const r = await call(handlers['POST /api/v1/handleHistory'], {
            body: { type: 'project', companyId: CID, projectId: PROJECT, taskId: null, object: { key: 'Project_Filter', message: `<b>${HTML}</b>` }, userData: { id: MEMBER } },
        });
        expect(r.body).toMatchObject({ status: true });
        expect(messages()).toEqual([]);
    });
});
