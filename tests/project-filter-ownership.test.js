const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn((...a) => mockDb.crud(...a)) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const projectFilters = require('../Modules/Project/controller/manageGlobalFilter');

const C = '6f0000000000000000000d01';
const OTHER_COMPANY = '6f0000000000000000000d02';
const ME = '6f0000000000000000000d11';
const OTHER = '6f0000000000000000000d12';

const call = async (handler, { uid = ME, params = {}, body } = {}) => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (payload) => { res.body = payload; return res; };
    await handler({ headers: { companyid: C }, uid, params, body, query: {} }, res);
    return res;
};

const stored = () => mockDb.store[SCHEMA_TYPE.GLOBALFILTER] || [];
const seedFilter = (over) => mockDb.seed(SCHEMA_TYPE.GLOBALFILTER, { name: 'Active', filters: [], userId: ME, companyId: C, filter: 'projectFilter', typeFilter: 'projects', ...over });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
});

describe('saved project filters are bound to their owner', () => {
    it('lists only the caller\'s own project filters', async () => {
        seedFilter({ name: 'Mine' });
        seedFilter({ name: 'Theirs', userId: OTHER });
        seedFilter({ name: 'A task filter', filter: 'taskFilter', typeFilter: 'projectTask' });
        const res = await call(projectFilters.getFilter, { params: { userId: ME } });
        expect(res.statusCode).toBe(200);
        expect(res.body.data.map((f) => f.name)).toEqual(['Mine']);
    });

    it('refuses to list another user\'s project filters', async () => {
        seedFilter({ userId: OTHER });
        const res = await call(projectFilters.getFilter, { params: { userId: OTHER } });
        expect(res.statusCode).toBe(403);
        expect(res.body.status).toBe(false);
        expect(JSON.stringify(res.body)).not.toContain('Active');
    });

    it('never plants a project filter in another user\'s list, whatever user the body names', async () => {
        expect((await call(projectFilters.saveFilter, { body: { name: 'Planted', userId: OTHER, filter: 'projectFilter', typeFilter: 'projects' } })).statusCode).toBe(200);
        expect((await call(projectFilters.saveFilter, { body: { name: 'Plain', filter: 'projectFilter', typeFilter: 'projects' } })).statusCode).toBe(200);
        expect(stored().map((f) => f.userId)).toEqual([ME, ME]);
        expect((await call(projectFilters.getFilter, { uid: OTHER, params: { userId: OTHER } })).body.data).toEqual([]);
    });

    it('refuses to delete another user\'s project filter and leaves it in place', async () => {
        const theirs = seedFilter({ userId: OTHER });
        const res = await call(projectFilters.deleteFilter, { params: { cid: C, id: String(theirs._id) } });
        expect(res.statusCode).toBe(404);
        expect(stored()).toHaveLength(1);
    });

    it('lets the owner delete their project filter', async () => {
        const mine = seedFilter();
        const res = await call(projectFilters.deleteFilter, { params: { cid: C, id: String(mine._id) } });
        expect(res.statusCode).toBe(200);
        expect(stored()).toHaveLength(0);
    });

    it('answers a delete for a filter that does not exist with 404', async () => {
        const res = await call(projectFilters.deleteFilter, { params: { cid: C, id: '6f0000000000000000000dff' } });
        expect(res.statusCode).toBe(404);
    });

    it('refuses a malformed filter id on delete with 400 before the database is touched', async () => {
        const res = await call(projectFilters.deleteFilter, { params: { cid: C, id: 'not-an-id' } });
        expect(res.statusCode).toBe(400);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('still refuses a delete aimed at another company', async () => {
        const mine = seedFilter();
        const res = await call(projectFilters.deleteFilter, { params: { cid: OTHER_COMPANY, id: String(mine._id) } });
        expect(res.statusCode).toBe(403);
        expect(stored()).toHaveLength(1);
    });
});
