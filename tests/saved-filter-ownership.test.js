const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const taskFilters = require('../Modules/Tasks/helpers/manageGlobalFilter');
const { listFilters } = require('../Modules/AdvancedGlobalFilter/helpers/savedFilters');

const C = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const ME = '6f0000000000000000000001';
const OTHER = '6f0000000000000000000002';

const reply = () => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
};

const call = async (handler, { uid = ME, params = {}, body } = {}) => {
    const res = reply();
    await handler({ headers: { companyid: C }, uid, params, body }, res);
    return res;
};

const filters = () => mockDb.store[SCHEMA_TYPE.GLOBALFILTER] || [];
const seedFilter = (over) => mockDb.seed(SCHEMA_TYPE.GLOBALFILTER, { name: 'Open bugs', filters: [], userId: ME, companyId: C, filter: 'taskFilter', typeFilter: 'projectTask', ...over });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
});

describe('TSK-07 saved filters are bound to their owner', () => {
    it('lists only the caller\'s own task filters', async () => {
        seedFilter({ name: 'Mine' });
        seedFilter({ name: 'Theirs', userId: OTHER });
        const res = await call(taskFilters.getFilter, { params: { userId: ME } });
        expect(res.statusCode).toBe(200);
        expect(res.body.data.map((f) => f.name)).toEqual(['Mine']);
    });

    it('refuses to list another user\'s task or advanced filters', async () => {
        seedFilter({ userId: OTHER });
        const task = await call(taskFilters.getFilter, { params: { userId: OTHER } });
        expect(task.statusCode).toBe(403);
        expect(task.body).toEqual({ status: false, statusText: expect.any(String) });

        const advanced = listFilters((req) => ({ filter: 'advancedFilter', typeFilter: req.params.filterType }));
        expect((await call(advanced, { params: { userId: OTHER, filterType: 'tasks' } })).statusCode).toBe(403);
    });

    it('saves a filter for the caller in the header company, whatever company the body names', async () => {
        const res = await call(taskFilters.saveFilter, { body: { name: 'Mine', filters: [], userId: ME, companyId: OTHER_COMPANY, filter: 'taskFilter', typeFilter: 'projectTask' } });
        expect(res.statusCode).toBe(200);
        expect(mockDb.calls[0].companyId).toBe(C);
        expect(filters()[0]).toMatchObject({ userId: ME, companyId: C });
    });

    it('refuses to save a filter on behalf of another user', async () => {
        const res = await call(taskFilters.saveFilter, { body: { name: 'Planted', filters: [], userId: OTHER, filter: 'taskFilter', typeFilter: 'projectTask' } });
        expect(res.statusCode).toBe(403);
        expect(filters()).toHaveLength(0);
    });

    it('refuses to change another user\'s filter and leaves it as it was', async () => {
        const theirs = seedFilter({ name: 'Theirs', userId: OTHER });
        const res = await call(taskFilters.updateFilter, { body: [{ _id: theirs._id }, { $set: { name: 'Hijacked' } }] });
        expect(res.statusCode).toBe(404);
        expect(filters()[0].name).toBe('Theirs');
    });

    it('lets the owner rename a filter but never move it to another user', async () => {
        const mine = seedFilter({ name: 'Mine' });
        const res = await call(taskFilters.updateFilter, { body: [{ _id: mine._id }, { $set: { name: 'Renamed', userId: OTHER, companyId: OTHER_COMPANY } }] });
        expect(res.statusCode).toBe(200);
        expect(filters()[0]).toMatchObject({ name: 'Renamed', userId: ME, companyId: C });
    });

    it('refuses to delete another user\'s filter', async () => {
        const theirs = seedFilter({ userId: OTHER });
        const res = await call(taskFilters.deleteFilter, { params: { cid: C, id: theirs._id } });
        expect(res.statusCode).toBe(404);
        expect(filters()).toHaveLength(1);
    });

    it('refuses a delete aimed at another company', async () => {
        const mine = seedFilter();
        const res = await call(taskFilters.deleteFilter, { params: { cid: OTHER_COMPANY, id: mine._id } });
        expect(res.statusCode).toBe(403);
        expect(mockDb.crud).not.toHaveBeenCalled();
    });

    it('lets the owner delete their filter', async () => {
        const mine = seedFilter();
        const res = await call(taskFilters.deleteFilter, { params: { cid: C, id: mine._id } });
        expect(res.statusCode).toBe(200);
        expect(filters()).toHaveLength(0);
    });
});
