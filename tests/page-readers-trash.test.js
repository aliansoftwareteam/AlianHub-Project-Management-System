const fakeMongo = require('./fixtures/fakeMongo');
const world = require('./fixtures/pageReachWorld');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));

const { myCache } = require('../Config/config');
const { visibleTrash } = require('../Modules/Trash/listAccess');

const { C } = world;

beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    world.seed(mockDb);
});

describe('the page readers agree on who reaches a page: the trash', () => {
    it('lists the trashed docs a person could open without being named on them', async () => {
        const trashed = world.pageRows().map((page) => ({ ...page, deletedStatusKey: 1 }));
        const listed = await world.askEveryone((uid) => visibleTrash(C, uid, 'docs', trashed));

        expect(listed).toEqual({
            owner: ['shared', 'company', 'closed', 'deleted', 'namedEdit'],
            admin: ['shared', 'company', 'closed', 'deleted', 'namedEdit'],
            inside: ['insidePrivate', 'shared', 'company', 'closed', 'deleted', 'namedView', 'namedEdit'],
            outside: ['outsidePrivate', 'shared', 'company', 'deleted'],
            guest: ['shared', 'company', 'deleted'],
            viewer: ['shared', 'company', 'deleted'],
            editor: ['shared', 'company', 'deleted'],
        });
    });

    it('lists nothing to someone without a seat', async () => {
        const trashed = world.pageRows().map((page) => ({ ...page, deletedStatusKey: 1 }));
        expect(await visibleTrash(C, 'a000000000000000000000af', 'docs', trashed)).toEqual([]);
    });
});
