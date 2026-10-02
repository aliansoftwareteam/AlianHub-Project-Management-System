const fakeMongo = require('./fixtures/fakeMongo');
const world = require('./fixtures/pageReachWorld');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));

const { myCache } = require('../Config/config');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const { globalSearch } = require('../Modules/GlobalSearch/controller');
const { resolveVisits } = require('../Modules/RecentVisits/helpers/resolveVisits');
const { resolveFavourites } = require('../Modules/Users/helpers/favouritesResolve');

const { C, PAGES } = world;

const EVERYONE_REACHES = {
    owner: ['shared', 'company', 'closed', 'namedEdit'],
    admin: ['shared', 'company', 'closed', 'namedEdit'],
    inside: ['insidePrivate', 'shared', 'company', 'closed', 'namedView', 'namedEdit'],
    outside: ['outsidePrivate', 'shared', 'company'],
    guest: ['shared', 'company'],
    viewer: ['shared', 'company', 'namedView'],
    editor: ['shared', 'company', 'namedEdit'],
};

beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    world.seed(mockDb);
});

describe('the page readers agree on who reaches a page: search, recents and favourites', () => {
    it('search finds the docs a person can open', async () => {
        const found = await world.askEveryone(async (uid) => {
            const res = { status: () => res, send: (body) => { res.body = body; return res; } };
            await globalSearch({ headers: { companyid: C }, uid, body: { query: 'atlas' } }, res);
            return res.body.data.pages;
        });
        expect(found).toEqual(EVERYONE_REACHES);
    });

    it('recent visits keep the docs a person can still open', async () => {
        const visits = Object.values(PAGES).map((entityId) => ({ entityType: 'doc', entityId, visitedAt: new Date() }));
        const kept = await world.askEveryone(async (uid) => resolveVisits(C, uid, visits, { visible: await visibleProjectIds(C, uid) }));
        expect(kept).toEqual(EVERYONE_REACHES);
    });

    it('favourites keep the docs a person can still open', async () => {
        const entries = Object.values(PAGES).map((id) => ({ type: 'doc', id }));
        const kept = await world.askEveryone(async (uid) => (await resolveFavourites(C, uid, entries)).filter((item) => item.type === 'doc'));
        expect(kept).toEqual(EVERYONE_REACHES);
    });
});
