const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn() }));
jest.mock('../Modules/AdvancedGlobalFilter/helpers/filterHistory', () => ({ recordFilterChange: jest.fn(async () => undefined) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { recordFilterChange } = require('../Modules/AdvancedGlobalFilter/helpers/filterHistory');
const saved = require('../Modules/AdvancedGlobalFilter/helpers/savedFilters');

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const OTHER = '6f0000000000000000000002';

const reply = () => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
};
const call = async (handler, req = {}) => {
    const res = reply();
    await handler({ headers: { companyid: C }, uid: ME, params: {}, query: {}, ...req }, res);
    return res;
};

const rows = () => mockDb.store[SCHEMA_TYPE.GLOBALFILTER] || [];
const seed = (over) => mockDb.seed(SCHEMA_TYPE.GLOBALFILTER, { name: 'Open bugs', userId: ME, ...over });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
});

describe('namesAnotherUser', () => {
    it('is false when no user is named or the caller is named', () => {
        expect(saved.namesAnotherUser({ uid: ME }, undefined)).toBe(false);
        expect(saved.namesAnotherUser({ uid: ME }, ME)).toBe(false);
    });

    it('is true for anyone else, including an empty name', () => {
        expect(saved.namesAnotherUser({ uid: ME }, OTHER)).toBe(true);
        expect(saved.namesAnotherUser({ uid: ME }, '')).toBe(true);
        expect(saved.namesAnotherUser({}, ME)).toBe(true);
    });
});

describe('deleteFilter', () => {
    it('deletes the caller\'s filter and records it in history', async () => {
        const mine = seed();
        const res = await call(saved.deleteFilter, { params: { id: String(mine._id) }, query: { projectId: 'p1' } });
        expect(res.statusCode).toBe(200);
        expect(rows()).toHaveLength(0);
        expect(recordFilterChange).toHaveBeenCalledWith(expect.objectContaining({ companyId: C, uid: ME, projectId: 'p1', verb: 'deleted' }));
    });

    it('answers 404 for another user\'s filter and keeps it', async () => {
        const theirs = seed({ userId: OTHER });
        const res = await call(saved.deleteFilter, { params: { id: String(theirs._id) } });
        expect(res.statusCode).toBe(404);
        expect(rows()).toHaveLength(1);
        expect(recordFilterChange).not.toHaveBeenCalled();
    });

    it('answers 403 when the path names a different company than the header', async () => {
        const mine = seed();
        const res = await call(saved.deleteFilter, { params: { cid: '6f0000000000000000000c02', id: String(mine._id) } });
        expect(res.statusCode).toBe(403);
        expect(rows()).toHaveLength(1);
        expect(mockDb.calls).toHaveLength(0);
    });

    it.each([undefined, '', 'abc', '123'])('answers 400 for the filter id %p', async (id) => {
        const res = await call(saved.deleteFilter, { params: { id } });
        expect(res.statusCode).toBe(400);
        expect(mockDb.calls).toHaveLength(0);
    });

    it('works in the header company only', async () => {
        const mine = seed();
        await call(saved.deleteFilter, { params: { cid: C, id: String(mine._id) } });
        expect(mockDb.calls.map((c) => c.companyId)).toEqual([C]);
    });

    it('answers 500 with a plain message when the database fails', async () => {
        mockDb.crud.mockRejectedValueOnce(new Error('db down'));
        const res = await call(saved.deleteFilter, { params: { id: '6f0000000000000000000999' } });
        expect(res.statusCode).toBe(500);
        expect(res.body.status).toBe(false);
        expect(JSON.stringify(res.body)).not.toContain('db down');
    });
});

describe('updateFilter', () => {
    it('answers 400 when the body is not a [where, update] pair', async () => {
        expect((await call(saved.updateFilter, { body: {} })).statusCode).toBe(400);
        expect((await call(saved.updateFilter, { body: undefined })).statusCode).toBe(400);
        expect((await call(saved.updateFilter, { body: [{ _id: 'bad' }, { $set: { name: 'x' } }] })).statusCode).toBe(400);
    });

    it('answers 400 when nothing editable is being set', async () => {
        const mine = seed();
        const res = await call(saved.updateFilter, { body: [{ _id: String(mine._id) }, { $set: { userId: OTHER, companyId: 'x' } }] });
        expect(res.statusCode).toBe(400);
        expect(rows()[0].userId).toBe(ME);
    });

    it('changes only the editable fields and records the change', async () => {
        const mine = seed();
        const res = await call(saved.updateFilter, {
            body: [{ _id: String(mine._id) }, { $set: { name: 'Renamed', sortByOrder: 'desc', userId: OTHER } }],
            query: { projectId: 'p9' },
        });
        expect(res.statusCode).toBe(200);
        expect(rows()[0]).toMatchObject({ name: 'Renamed', sortByOrder: 'desc', userId: ME });
        expect(recordFilterChange).toHaveBeenCalledWith(expect.objectContaining({ verb: 'updated', projectId: 'p9', uid: ME }));
    });

    it('does not fail the request when writing history fails', async () => {
        recordFilterChange.mockRejectedValueOnce(new Error('history down'));
        const mine = seed();
        const res = await call(saved.updateFilter, { body: [{ _id: String(mine._id) }, { $set: { name: 'Renamed' } }] });
        expect(res.statusCode).toBe(200);
    });
});

describe('saveFilter and listFilters failures', () => {
    it('saves an empty body as a filter owned by the caller in the header company', async () => {
        const res = await call(saved.saveFilter, { body: undefined });
        expect(res.statusCode).toBe(200);
        expect(rows()[0]).toMatchObject({ userId: ME, companyId: C });
    });

    it('never lets the body choose the stored id', async () => {
        const res = await call(saved.saveFilter, { body: { _id: '6f00000000000000000000ff', name: 'x' } });
        expect(res.statusCode).toBe(200);
        expect(String(rows()[0]._id)).not.toBe('6f00000000000000000000ff');
    });

    it('answers 500 when saving fails', async () => {
        mockDb.crud.mockRejectedValueOnce(new Error('db down'));
        expect((await call(saved.saveFilter, { body: { name: 'x' } })).statusCode).toBe(500);
    });

    it('lists nothing as an empty list and reports a database failure as 500', async () => {
        const list = saved.listFilters(() => ({ filter: 'taskFilter' }));
        const empty = await call(list, { params: { userId: ME } });
        expect(empty.body).toEqual({ status: true, data: [] });
        mockDb.crud.mockRejectedValueOnce(new Error('db down'));
        expect((await call(list, { params: { userId: ME } })).statusCode).toBe(500);
    });

    it('lists only the header company\'s query for the caller', async () => {
        seed({ filter: 'taskFilter' });
        const list = saved.listFilters(() => ({ filter: 'taskFilter' }));
        await call(list, { params: {} });
        expect(mockDb.calls[0]).toMatchObject({ companyId: C });
        expect(mockDb.calls[0].data[0]).toMatchObject({ userId: ME, filter: 'taskFilter' });
    });
});
