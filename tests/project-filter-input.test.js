const mockDbs = {};
const mockDbFor = (id) => { mockDbs[id] = mockDbs[id] || require('./fixtures/fakeMongo').create(); return mockDbs[id]; };
const mockCrud = jest.fn();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockCrud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/settings/securityPermissions/controller', () => ({ fetchRules: jest.fn(async () => []) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const filters = require('../Modules/Project/controller/manageGlobalFilter');
const { getRemainingProject } = require('../Modules/Project/controller/getProjectFilterData');

const COMPANY = '6f00000000000000000cc001';
const OWNER = '6f00000000000000000cc011';
const OTHER = '6f00000000000000000cc012';
const FOREIGN_COMPANY = '6f00000000000000000cc0ff';

const run = async (handler, { uid = OWNER, body = {} } = {}) => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (payload) => { res.body = payload; return res; };
    await handler({ uid, body, params: {}, query: {}, headers: { companyid: COMPANY } }, res);
    return res;
};

const stored = () => mockDbFor(COMPANY).store[SCHEMA_TYPE.GLOBALFILTER] || [];

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => { delete mockDbs[key]; });
    jest.clearAllMocks();
    mockCrud.mockImplementation((companyId, query, method) => mockDbFor(String(companyId)).crud(companyId, query, method));
});

describe('creating a saved project filter with bad input (PRJ-06)', () => {
    test.each([
        [{ filter: 'projectFilter', typeFilter: 'projects' }, 'name'],
        [{ name: '   ', filter: 'projectFilter', typeFilter: 'projects' }, 'name'],
        [{ name: 'x'.repeat(201), filter: 'projectFilter', typeFilter: 'projects' }, 'name'],
        [{ name: 'Mine', typeFilter: 'projects' }, 'filter'],
        [{ name: 'Mine', filter: 'projectFilter' }, 'typeFilter'],
        [{ name: 'Mine', filter: 'projectFilter', typeFilter: 'projects', filters: 'all' }, 'filters'],
    ])('%j is a 400 naming %s, before the database is touched', async (body, field) => {
        const res = await run(filters.saveFilter, { body });
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual(expect.objectContaining({ status: false, field }));
        expect(typeof res.body.statusText).toBe('string');
        expect(mockCrud).not.toHaveBeenCalled();
    });

    test('a schema validation failure is a 400 that leaks no schema internals', async () => {
        mockCrud.mockRejectedValueOnce(Object.assign(new Error('global_filter validation failed: userId: Path `userId` is required.'), { name: 'ValidationError' }));
        const res = await run(filters.saveFilter, { body: { name: 'Mine', filter: 'projectFilter', typeFilter: 'projects' } });
        expect(res.statusCode).toBe(400);
        expect(res.body.status).toBe(false);
        expect(JSON.stringify(res.body)).not.toMatch(/userId|validation failed|Path/);
    });

    test('a valid filter is saved for the caller, whatever user or company the body names', async () => {
        const res = await run(filters.saveFilter, { body: { name: ' Mine ', filter: 'projectFilter', typeFilter: 'projects', userId: OTHER, companyId: FOREIGN_COMPANY } });
        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe(true);
        expect(stored()[0]).toEqual(expect.objectContaining({ name: 'Mine', userId: OWNER, companyId: COMPANY, filters: [] }));
    });
});

describe('remaining projects with bad input (PRJ-06)', () => {
    test.each([[{}], [{ dataIds: [] }], [{ dataIds: 'abc' }], [{ dataIds: ['not-an-id'] }]])('%j is a 400, not a 500', async (body) => {
        const res = await run(getRemainingProject, { body });
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual(expect.objectContaining({ status: false, field: 'dataIds' }));
        expect(mockCrud).not.toHaveBeenCalled();
    });
});
