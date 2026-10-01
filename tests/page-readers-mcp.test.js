const fakeMongo = require('./fixtures/fakeMongo');
const world = require('./fixtures/pageReachWorld');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const visibility = require('../Modules/Mcp/visibility');

const { C, PEOPLE, PROJECTS, PAGES } = world;

const LIVE = { deletedStatusKey: { $ne: 1 } };

const searched = (projectIds) => world.askEveryone(async (uid) => {
    const vis = await visibility.forCaller({ companyId: C, userId: uid, projectIds });
    return mockDb.crud(C, { type: SCHEMA_TYPE.PAGES, data: [{ ...LIVE, ...vis.pageClause() }] }, 'find');
});

const opened = (projectIds) => world.askEveryone(async (uid) => {
    const vis = await visibility.forCaller({ companyId: C, userId: uid, projectIds });
    return mockDb.store[SCHEMA_TYPE.PAGES].filter((page) => page.deletedStatusKey !== 1 && vis.allowsPage(page));
});

beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    world.seed(mockDb);
});

describe('the page readers agree on who reaches a page: MCP tokens', () => {
    const UNNARROWED = {
        owner: ['shared', 'company', 'closed', 'orphaned'],
        admin: ['shared', 'company', 'closed', 'orphaned'],
        inside: ['insidePrivate', 'shared', 'company', 'closed'],
        outside: ['outsidePrivate', 'shared', 'company'],
        guest: ['shared', 'company'],
    };

    const KEPT_TO_OPEN = { owner: ['shared'], admin: ['shared'], inside: ['insidePrivate', 'shared'], outside: ['outsidePrivate', 'shared'], guest: ['shared'] };

    const KEPT_TO_CLOSED = { owner: ['closed'], admin: ['closed'], inside: ['closed'], outside: [], guest: [] };

    it('a token that is not kept to some projects reads what its person can open', async () => {
        expect(await searched([])).toEqual(UNNARROWED);
        expect(await opened([])).toEqual(UNNARROWED);
    });

    it('a token kept to some projects reads inside them only', async () => {
        expect(await searched([PROJECTS.open])).toEqual(KEPT_TO_OPEN);
        expect(await opened([PROJECTS.open])).toEqual(KEPT_TO_OPEN);
        expect(await searched([PROJECTS.closed])).toEqual(KEPT_TO_CLOSED);
        expect(await opened([PROJECTS.closed])).toEqual(KEPT_TO_CLOSED);
    });

    it('leaves another person\'s personal list out for an owner', async () => {
        mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: 'b000000000000000000000b9', ProjectName: 'Mine', isPersonal: true, personalOwner: PEOPLE.inside, isPrivateSpace: true, AssigneeUserId: [PEOPLE.inside], deletedStatusKey: 0 });
        mockDb.store[SCHEMA_TYPE.PAGES].find((page) => String(page._id) === PAGES.closed).ProjectID = 'b000000000000000000000b9';

        expect(await searched([])).toEqual({ ...UNNARROWED, owner: ['shared', 'company', 'orphaned'], admin: ['shared', 'company', 'orphaned'] });
        expect(await opened([])).toEqual({ ...UNNARROWED, owner: ['shared', 'company', 'orphaned'], admin: ['shared', 'company', 'orphaned'] });
    });

    it('writes outside every project only with a token that is not kept to some', async () => {
        const unnarrowed = await visibility.forCaller({ companyId: C, userId: PEOPLE.inside, projectIds: [] });
        const narrowed = await visibility.forCaller({ companyId: C, userId: PEOPLE.inside, projectIds: [PROJECTS.open] });

        await expect(visibility.assertWritable(C, unnarrowed, { companyWide: true })).resolves.toBeUndefined();
        await expect(visibility.assertWritable(C, narrowed, { companyWide: true })).rejects.toMatchObject({ notVisible: true });
        await expect(visibility.assertWritable(C, narrowed, { pageId: PAGES.insidePrivate })).resolves.toBeUndefined();
        await expect(visibility.assertWritable(C, narrowed, { pageId: PAGES.outsidePrivate })).rejects.toMatchObject({ notVisible: true });
        await expect(visibility.assertWritable(C, narrowed, { pageId: PAGES.company })).rejects.toMatchObject({ notVisible: true });
    });
});
