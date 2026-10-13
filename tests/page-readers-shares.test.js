const fakeMongo = require('./fixtures/fakeMongo');
const world = require('./fixtures/pageReachWorld');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));

const { myCache } = require('../Config/config');
const { canManageShare } = require('../Modules/PublicShares/helpers/shareAccess');

const { C } = world;

const decisions = (keep) => world.askEveryone(async (uid) => {
    const all = await Promise.all(world.pageRows().map(async (page) => ({
        _id: page._id,
        decision: await canManageShare({ companyId: C, uid, entityType: 'page', entityId: page._id }),
    })));
    return all.filter(({ decision }) => keep(decision));
});

beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    world.seed(mockDb);
});

describe('the page readers agree on who reaches a page: public links', () => {
    it('lets a person manage the link of a doc they can change', async () => {
        expect(await decisions((decision) => decision.ok)).toEqual({
            owner: ['shared', 'company', 'closed', 'namedEdit'],
            admin: ['shared', 'company', 'closed', 'namedEdit'],
            inside: ['insidePrivate', 'shared', 'company', 'closed', 'namedView', 'namedEdit'],
            outside: ['outsidePrivate', 'shared', 'company'],
            guest: [],
            viewer: ['shared', 'company'],
            editor: ['shared', 'company'],
        });
    });

    it('marks the author\'s own private doc, which takes no new link', async () => {
        expect(await decisions((decision) => decision.privateDoc === true)).toEqual({
            owner: [], admin: [], inside: ['insidePrivate', 'namedView'], outside: ['outsidePrivate'], guest: [], viewer: [], editor: [],
        });
    });

    it('refuses a guest the link of a doc they read, and answers not found for everything else', async () => {
        expect(await decisions((decision) => !decision.ok && decision.statusCode !== 404)).toEqual({
            owner: [], admin: [], inside: [], outside: [], guest: ['shared', 'company'], viewer: [], editor: [],
        });
    });
});
