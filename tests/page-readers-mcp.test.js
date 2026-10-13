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
        owner: ['shared', 'company', 'closed', 'namedEdit'],
        admin: ['shared', 'company', 'closed', 'namedEdit'],
        inside: ['insidePrivate', 'shared', 'company', 'closed', 'namedView', 'namedEdit'],
        outside: ['outsidePrivate', 'shared', 'company'],
        guest: ['shared', 'company'],
        viewer: ['shared', 'company', 'namedView'],
        editor: ['shared', 'company', 'namedEdit'],
    };

    const KEPT_TO_OPEN = {
        owner: ['shared'], admin: ['shared'], inside: ['insidePrivate', 'shared'], outside: ['outsidePrivate', 'shared'], guest: ['shared'], viewer: ['shared'], editor: ['shared'],
    };

    const KEPT_TO_CLOSED = {
        owner: ['closed', 'namedEdit'], admin: ['closed', 'namedEdit'], inside: ['closed', 'namedView', 'namedEdit'], outside: [], guest: [], viewer: ['namedView'], editor: ['namedEdit'],
    };

    const NOTHING = { owner: [], admin: [], inside: [], outside: [], guest: [], viewer: [], editor: [] };

    it('a token that is not kept to some projects reads what its person can open', async () => {
        expect(await searched([])).toEqual(UNNARROWED);
        expect(await opened([])).toEqual(UNNARROWED);
    });

    it('a token kept to some projects reads inside them only', async () => {
        expect(await searched([PROJECTS.open])).toEqual(KEPT_TO_OPEN);
        expect(await opened([PROJECTS.open])).toEqual(KEPT_TO_OPEN);
        expect(await searched([PROJECTS.closed])).toEqual(KEPT_TO_CLOSED);
        expect(await opened([PROJECTS.closed])).toEqual(KEPT_TO_CLOSED);
        expect(await searched([PROJECTS.trashed])).toEqual(NOTHING);
        expect(await opened([PROJECTS.trashed])).toEqual(NOTHING);
    });

    it('leaves another person\'s personal list out for an owner', async () => {
        mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: 'b000000000000000000000b9', ProjectName: 'Mine', isPersonal: true, personalOwner: PEOPLE.inside, isPrivateSpace: true, AssigneeUserId: [PEOPLE.inside], deletedStatusKey: 0 });
        mockDb.store[SCHEMA_TYPE.PAGES].find((page) => String(page._id) === PAGES.closed).ProjectID = 'b000000000000000000000b9';

        expect(await searched([])).toEqual({ ...UNNARROWED, owner: ['shared', 'company', 'namedEdit'], admin: ['shared', 'company', 'namedEdit'] });
        expect(await opened([])).toEqual({ ...UNNARROWED, owner: ['shared', 'company', 'namedEdit'], admin: ['shared', 'company', 'namedEdit'] });
    });

    it('a page shared with the person by name is read by a token kept to some projects only inside them', async () => {
        const kept = async (projectIds) => visibility.forCaller({ companyId: C, userId: PEOPLE.viewer, projectIds });
        const page = mockDb.store[SCHEMA_TYPE.PAGES].find((row) => String(row._id) === PAGES.namedView);

        expect((await kept([])).allowsPage(page)).toBe(true);
        expect((await kept([PROJECTS.closed])).allowsPage(page)).toBe(true);
        expect((await kept([PROJECTS.open])).allowsPage(page)).toBe(false);
        await expect(visibility.assertWritable(C, await kept([PROJECTS.open]), { pageId: PAGES.namedView })).rejects.toMatchObject({ notVisible: true });

        delete page.ProjectID;
        expect((await kept([])).allowsPage(page)).toBe(true);
        expect((await kept([PROJECTS.closed])).allowsPage(page)).toBe(false);
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
