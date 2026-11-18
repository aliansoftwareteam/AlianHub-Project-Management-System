jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: jest.fn(), set: jest.fn(), del: jest.fn() } }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { myCache } = require('../Config/config');
const { removeCache } = require('../utils/commonFunctions');
const ctrl = require('../Modules/trackerDownload/controller');

const ID = '6f0000000000000000000d01';
const CACHE_KEY = 'trackers:frontend';

const reply = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (body) => { res.body = body; return res; };
    return res;
};
const run = async (handler, req) => {
    const res = reply();
    await handler({ params: {}, body: {}, query: {}, ...req }, res);
    return res;
};
const pipeline = () => MongoDbCrudOpration.mock.calls[0][1].data[0];
const facetData = () => pipeline()[1].$facet.data;

let errorSpy;
beforeEach(() => {
    jest.clearAllMocks();
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => errorSpy.mockRestore());

describe('deleteTracker', () => {
    it('answers 400 without an id and deletes nothing', async () => {
        const res = await run(ctrl.deleteTracker, { params: {} });
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ status: false, statusText: 'Tracker ID is required' });
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('deletes one tracker by its ObjectId from the global database and clears the cached list', async () => {
        MongoDbCrudOpration.mockResolvedValue({ deletedCount: 1 });
        const res = await run(ctrl.deleteTracker, { params: { id: ID } });
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ status: true, statusText: 'Item deleted successfully' });
        const [db, query, method] = MongoDbCrudOpration.mock.calls[0];
        expect(db).toBe('global');
        expect(method).toBe('deleteOne');
        expect(query.type).toBe('timeTrackerDownload');
        expect(query.data).toHaveLength(1);
        expect(query.data[0]._id.toHexString()).toBe(ID);
        expect(removeCache).toHaveBeenCalledWith(CACHE_KEY);
    });

    it('answers 404 and keeps the cache when nothing matched', async () => {
        MongoDbCrudOpration.mockResolvedValue({ deletedCount: 0 });
        const res = await run(ctrl.deleteTracker, { params: { id: ID } });
        expect(res.statusCode).toBe(404);
        expect(res.body.statusText).toBe('Item not found');
        expect(removeCache).not.toHaveBeenCalled();
    });

    it('answers 500 for an id that is not an ObjectId, without touching the database', async () => {
        const res = await run(ctrl.deleteTracker, { params: { id: 'not-an-id' } });
        expect(res.statusCode).toBe(500);
        expect(res.body.statusText).toBe('Failed to delete item');
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('answers 500 with the reason when the delete throws', async () => {
        MongoDbCrudOpration.mockRejectedValue(new Error('db down'));
        const res = await run(ctrl.deleteTracker, { params: { id: ID } });
        expect(res.statusCode).toBe(500);
        expect(res.body.error).toBe('db down');
        expect(removeCache).not.toHaveBeenCalled();
    });
});

describe('saveTracker', () => {
    it('answers 400 without a dataObj and saves nothing', async () => {
        const res = await run(ctrl.saveTracker, { body: {} });
        expect(res.statusCode).toBe(400);
        expect(res.body.statusText).toBe('Missing required data');
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('saves the given data in the global database, returns the saved row and clears the cache', async () => {
        const dataObj = { title: 'Mac', downloadUrl: 'https://x/mac.dmg', version: '1.0' };
        MongoDbCrudOpration.mockResolvedValue({ _id: ID, ...dataObj });
        const res = await run(ctrl.saveTracker, { body: { dataObj } });
        expect(res.body).toEqual({ status: true, statusText: 'Tracker saved successfully', data: { _id: ID, ...dataObj } });
        expect(MongoDbCrudOpration).toHaveBeenCalledWith('global', { type: 'timeTrackerDownload', data: dataObj }, 'save');
        expect(removeCache).toHaveBeenCalledWith(CACHE_KEY);
    });

    it('answers 500 with the reason when the save throws and leaves the cache', async () => {
        MongoDbCrudOpration.mockRejectedValue(new Error('write failed'));
        const res = await run(ctrl.saveTracker, { body: { dataObj: { title: 'x' } } });
        expect(res.statusCode).toBe(500);
        expect(res.body.error).toBe('write failed');
        expect(removeCache).not.toHaveBeenCalled();
    });
});

describe('updateTracker', () => {
    it.each([
        ['no dataObj', {}],
        ['an id-less filter', { dataObj: [{}, { title: 'x' }] }],
    ])('answers 400 for %s', async (_label, body) => {
        const res = await run(ctrl.updateTracker, { body });
        expect(res.statusCode).toBe(400);
        expect(res.body.statusText).toBe('Missing required data or ID');
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('answers 500 for an empty dataObj array instead of 400', async () => {
        const res = await run(ctrl.updateTracker, { body: { dataObj: [] } });
        expect(res.statusCode).toBe(500);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('updates the tracker with that ObjectId by the given fields and clears the cache', async () => {
        MongoDbCrudOpration.mockResolvedValue({ _id: ID, title: 'New' });
        const res = await run(ctrl.updateTracker, { body: { dataObj: [{ _id: ID }, { title: 'New' }] } });
        expect(res.body).toEqual({ status: true, statusText: 'Tracker updated successfully', data: { _id: ID, title: 'New' } });
        const [db, query, method] = MongoDbCrudOpration.mock.calls[0];
        expect(db).toBe('global');
        expect(method).toBe('findOneAndUpdate');
        expect(query.type).toBe('timeTrackerDownload');
        expect(query.data[0]._id.toHexString()).toBe(ID);
        expect(query.data[1]).toEqual({ title: 'New' });
        expect(removeCache).toHaveBeenCalledWith(CACHE_KEY);
    });

    it('answers 404 and keeps the cache when no tracker matched', async () => {
        MongoDbCrudOpration.mockResolvedValue(null);
        const res = await run(ctrl.updateTracker, { body: { dataObj: [{ _id: ID }, { title: 'x' }] } });
        expect(res.statusCode).toBe(404);
        expect(res.body.statusText).toBe('Tracker not found');
        expect(removeCache).not.toHaveBeenCalled();
    });

    it('answers 500 for an id that is not an ObjectId', async () => {
        const res = await run(ctrl.updateTracker, { body: { dataObj: [{ _id: 'zzz' }, {}] } });
        expect(res.statusCode).toBe(500);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });
});

describe('getTracker', () => {
    const found = (rows, total) => [{ metadata: total === undefined ? [] : [{ total }], data: rows }];

    it('reads the global download list and reports the total and page count', async () => {
        MongoDbCrudOpration.mockResolvedValue(found([{ title: 'Mac' }], 25));
        const res = await run(ctrl.getTracker, { query: { batchSize: '10' } });
        expect(res.body).toEqual({
            status: true,
            statusText: 'Data fetched successfully',
            data: [{ title: 'Mac' }],
            metadata: { total: 25, totalPages: 3 },
        });
        const [db, query, method] = MongoDbCrudOpration.mock.calls[0];
        expect([db, method, query.type]).toEqual(['global', 'aggregate', 'timeTrackerDownload']);
    });

    it('projects only the public download fields, so no uploader data leaves', async () => {
        MongoDbCrudOpration.mockResolvedValue(found([], 0));
        await run(ctrl.getTracker, { query: {} });
        const project = facetData().find((stage) => stage.$project).$project;
        expect(project).toEqual({ title: 1, type: 1, version: 1, downloadUrl: 1, description: 1 });
    });

    it('returns everything on one page when no batchSize is given, newest first', async () => {
        MongoDbCrudOpration.mockResolvedValue(found([{}], 1));
        const res = await run(ctrl.getTracker, { query: {} });
        expect(res.body.metadata).toEqual({ total: 1, totalPages: 1 });
        const stages = facetData();
        expect(stages.find((s) => s.$sort).$sort).toEqual({ createdAt: -1, _id: 1 });
        expect(stages.find((s) => '$skip' in s).$skip).toBe(0);
        expect(stages.some((s) => s.$limit)).toBe(false);
    });

    it('skips whole pages and limits to the batch size', async () => {
        MongoDbCrudOpration.mockResolvedValue(found([], 100));
        await run(ctrl.getTracker, { query: { currentPage: '3', batchSize: '10' } });
        const stages = facetData();
        expect(stages.find((s) => '$skip' in s).$skip).toBe(20);
        expect(stages.find((s) => s.$limit).$limit).toBe(10);
    });

    it.each([['0'], ['-5'], ['abc'], ['']])('treats the page %j as the first page', async (currentPage) => {
        MongoDbCrudOpration.mockResolvedValue(found([], 100));
        await run(ctrl.getTracker, { query: { currentPage, batchSize: '10' } });
        expect(facetData().find((s) => '$skip' in s).$skip).toBe(0);
    });

    it.each([['0'], ['-1'], ['x']])('ignores the batch size %j', async (batchSize) => {
        MongoDbCrudOpration.mockResolvedValue(found([], 3));
        const res = await run(ctrl.getTracker, { query: { batchSize } });
        expect(facetData().some((s) => s.$limit)).toBe(false);
        expect(res.body.metadata.totalPages).toBe(1);
    });

    it('matches the title as an escaped, case-insensitive pattern', async () => {
        MongoDbCrudOpration.mockResolvedValue(found([], 0));
        await run(ctrl.getTracker, { query: { search: 'a.b(c' } });
        expect(pipeline()[0].$match.$and[0].title).toEqual({ $regex: 'a\\.b\\(c', $options: 'i' });
    });

    it('adds no title filter for an empty or non-string search', async () => {
        MongoDbCrudOpration.mockResolvedValue(found([], 0));
        await run(ctrl.getTracker, { query: { search: { $ne: '' } } });
        expect(pipeline()[0].$match.$and).toEqual([{}]);
    });

    it('keeps only sortable fields with a direction of 1 or -1', async () => {
        MongoDbCrudOpration.mockResolvedValue(found([], 0));
        await run(ctrl.getTracker, { query: { sort: JSON.stringify({ title: 1, createdBy: -1, version: 'asc', createdAt: -1, $where: 1 }) } });
        expect(facetData().find((s) => s.$sort).$sort).toEqual({ title: 1, createdAt: -1 });
    });

    it.each([['not json'], ['[1]'], ['null'], ['"x"'], [JSON.stringify({ createdBy: 1 })]])('falls back to the default order for sort %j', async (sort) => {
        MongoDbCrudOpration.mockResolvedValue(found([], 0));
        await run(ctrl.getTracker, { query: { sort } });
        expect(facetData().find((s) => s.$sort).$sort).toEqual({ createdAt: -1, _id: 1 });
    });

    it('answers "No data found" when the aggregate returns nothing', async () => {
        MongoDbCrudOpration.mockResolvedValue([]);
        const res = await run(ctrl.getTracker, { query: {} });
        expect(res.body).toEqual({ status: false, statusText: 'No data found', data: [], metadata: { total: 0, totalPages: 0 } });
        expect(myCache.set).not.toHaveBeenCalled();
    });

    it('reports a total of 0 for an empty page of results', async () => {
        MongoDbCrudOpration.mockResolvedValue([{ metadata: [{ total: 0 }], data: [] }]);
        const res = await run(ctrl.getTracker, { query: { batchSize: '5' } });
        expect(res.body.metadata).toEqual({ total: 0, totalPages: 0 });
    });

    it('answers 500 with the reason when the aggregate throws', async () => {
        MongoDbCrudOpration.mockRejectedValue(new Error('db down'));
        const res = await run(ctrl.getTracker, { query: {} });
        expect(res.statusCode).toBe(500);
        expect(res.body.error).toBe('db down');
    });

    describe('front page cache', () => {
        it('caches the answer for a week when asked from the front page', async () => {
            const response = found([{ title: 'Mac' }], 1);
            MongoDbCrudOpration.mockResolvedValue(response);
            myCache.get.mockReturnValue(undefined);
            await run(ctrl.getTracker, { query: { source: 'front' } });
            expect(myCache.get).toHaveBeenCalledWith(CACHE_KEY);
            expect(myCache.set).toHaveBeenCalledWith(CACHE_KEY, response, 604800);
        });

        it('serves the cached list without asking the database', async () => {
            myCache.get.mockReturnValue(found([{ title: 'Cached' }], 7));
            const res = await run(ctrl.getTracker, { query: { source: 'front', batchSize: '5' } });
            expect(MongoDbCrudOpration).not.toHaveBeenCalled();
            expect(res.body).toEqual({
                status: true,
                statusText: 'Data fetched successfully from cache',
                data: [{ title: 'Cached' }],
                metadata: { total: 7, totalPages: 2 },
            });
        });

        it('never reads or writes the cache for a call that is not from the front page', async () => {
            myCache.get.mockReturnValue(found([{ title: 'Cached' }], 7));
            MongoDbCrudOpration.mockResolvedValue(found([{ title: 'Fresh' }], 1));
            const res = await run(ctrl.getTracker, { query: {} });
            expect(res.body.data).toEqual([{ title: 'Fresh' }]);
            expect(MongoDbCrudOpration).toHaveBeenCalledTimes(1);
            expect(myCache.set).not.toHaveBeenCalled();
        });
    });
});
