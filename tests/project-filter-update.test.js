const mockDbs = {};
const mockDbFor = (id) => { mockDbs[id] = mockDbs[id] || require('./fixtures/fakeMongo').create(); return mockDbs[id]; };
const mockCrud = jest.fn();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockCrud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const filters = require('../Modules/Project/controller/manageGlobalFilter');

const COMPANY = '6f00000000000000000ce001';
const OWNER = '6f00000000000000000ce011';
const OTHER = '6f00000000000000000ce012';
const UNKNOWN_FILTER = '6f00000000000000000ce099';

const run = async (body, uid = OWNER) => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (payload) => { res.body = payload; return res; };
    await filters.updateFilter({ uid, body, params: {}, query: {}, headers: { companyid: COMPANY } }, res);
    return res;
};

const stored = () => mockDbFor(COMPANY).store[SCHEMA_TYPE.GLOBALFILTER] || [];
const seedFilter = (userId = OWNER) => mockDbFor(COMPANY).seed(SCHEMA_TYPE.GLOBALFILTER, {
    name: 'Before', filters: [], userId, companyId: COMPANY, filter: 'projectFilter', typeFilter: 'projects',
});

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => { delete mockDbs[key]; });
    jest.clearAllMocks();
    mockCrud.mockImplementation((companyId, query, method) => mockDbFor(String(companyId)).crud(companyId, query, method));
});

describe('updating a saved project filter (PRJ-08)', () => {
    test('the owner\'s update reports success and changes only the editable fields', async () => {
        const filter = seedFilter();
        const res = await run({ id: filter._id, name: 'After', filters: [{ key: 'status' }], userId: OTHER, companyId: UNKNOWN_FILTER });
        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe(true);
        expect(stored()[0]).toEqual(expect.objectContaining({ name: 'After', filters: [{ key: 'status' }], userId: OWNER, companyId: COMPANY }));
        const [companyId, query, method] = mockCrud.mock.calls[0];
        expect(companyId).toBe(COMPANY);
        expect(method).toBe('findOneAndUpdate');
        expect(query.data).toEqual([expect.objectContaining({ userId: OWNER }), { $set: { name: 'After', filters: [{ key: 'status' }] } }, { new: true }]);
    });

    test('someone else\'s filter is a 404 and stays unchanged', async () => {
        const filter = seedFilter(OTHER);
        const res = await run({ id: filter._id, name: 'Hijacked' });
        expect(res.statusCode).toBe(404);
        expect(res.body.status).toBe(false);
        expect(stored()[0].name).toBe('Before');
    });

    test.each([
        [{ name: 'After' }, 'id'],
        [{ id: 'nope', name: 'After' }, 'id'],
        [{ id: UNKNOWN_FILTER }, 'name'],
        [{ id: UNKNOWN_FILTER, name: '' }, 'name'],
        [{ id: UNKNOWN_FILTER, filters: {} }, 'filters'],
    ])('%j is a 400 naming %s', async (body, field) => {
        const res = await run(body);
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual(expect.objectContaining({ status: false, field }));
        expect(mockCrud).not.toHaveBeenCalled();
    });
});
