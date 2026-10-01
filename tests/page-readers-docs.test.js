const verified = require('./fixtures/verifiedRequest');
const fakeMongo = require('./fixtures/fakeMongo');
const world = require('./fixtures/pageReachWorld');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Pages/helpers/pageAi', () => ({ composePage: jest.fn(), isAiConfigured: () => false }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const pages = require('../Modules/Pages/controller');
const { pageReachFilter, pageReachedBy } = require('../Modules/Pages/helpers/pageRules');
const { visibleProjectIds } = require('../Config/contentAccess');

const { C, PEOPLE, PROJECTS, PAGES } = world;

const call = async (handler, { uid, params = {}, query = {} }) => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (body) => { res.body = body; return res; };
    res.json = res.send;
    await handler(verified({ uid, params, body: {}, query, headers: { companyid: C } }), res);
    return res.body;
};

const listed = (query) => world.askEveryone(async (uid) => (await call(pages.listPages, { uid, query })).data);

beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    world.seed(mockDb);
});

const EVERYONE_REACHES = {
    owner: ['shared', 'company', 'closed', 'namedEdit'],
    admin: ['shared', 'company', 'closed', 'namedEdit'],
    inside: ['insidePrivate', 'shared', 'company', 'closed', 'namedView', 'namedEdit'],
    outside: ['outsidePrivate', 'shared', 'company'],
    guest: ['shared', 'company'],
    viewer: ['shared', 'company', 'namedView'],
    editor: ['shared', 'company', 'namedEdit'],
};

const each = (pages) => Object.fromEntries(Object.keys(PEOPLE).map((who) => [who, pages]));

describe('the page readers agree on who reaches a page: the docs list', () => {
    it('lists the whole workspace', async () => {
        expect(await listed({ scope: 'all' })).toEqual(EVERYONE_REACHES);
    });

    it('lists the company-wide docs when no project is named', async () => {
        expect(await listed({})).toEqual(each(['company']));
    });

    it('lists one project', async () => {
        expect(await listed({ projectId: PROJECTS.open })).toEqual({
            ...each(['shared']), inside: ['insidePrivate', 'shared'], outside: ['outsidePrivate', 'shared'],
        });
        expect(await listed({ projectId: PROJECTS.closed })).toEqual({
            owner: ['closed', 'namedEdit'], admin: ['closed', 'namedEdit'], inside: ['closed', 'namedView', 'namedEdit'], outside: [], guest: [], viewer: ['namedView'], editor: ['namedEdit'],
        });
        expect(await listed({ projectId: PROJECTS.trashed })).toEqual(each([]));
    });

    it('lists the docs linked to a task', async () => {
        expect(await listed({ taskId: world.TASK })).toEqual(EVERYONE_REACHES);
    });

    it('lists the docs shared with a person by name', async () => {
        expect(await listed({ scope: 'shared' })).toEqual({ ...each([]), viewer: ['namedView'], editor: ['namedEdit'] });
    });

    it('lists the trash, where a doc shared by name does not follow', async () => {
        expect(await listed({ scope: 'trash' })).toEqual(each(['deleted']));
        mockDb.store[SCHEMA_TYPE.PAGES].forEach((page) => { page.deletedStatusKey = 1; });
        const trashed = await listed({ scope: 'trash' });
        expect(trashed.viewer).toEqual(['shared', 'company', 'deleted']);
        expect(trashed.editor).toEqual(['shared', 'company', 'deleted']);
        expect(trashed.inside).toEqual(['insidePrivate', 'shared', 'company', 'closed', 'deleted', 'namedView', 'namedEdit']);
    });

    it('tells a reader that a doc is shared with them, never who else it is shared with', async () => {
        const rows = (await call(pages.listPages, { uid: PEOPLE.viewer, query: { scope: 'all' } })).data;
        expect(rows.find((row) => String(row._id) === PAGES.namedView)).toMatchObject({ sharedWithMe: 'viewer' });
        expect(rows.find((row) => String(row._id) === PAGES.shared)).toMatchObject({ sharedWithMe: '' });
        expect(rows.every((row) => row.sharedWith === undefined)).toBe(true);
    });
});

describe('the page readers agree on who reaches a page: deleting a doc with its sub-pages', () => {
    const trashedBy = async (uid) => {
        mockDb.store[SCHEMA_TYPE.PAGES].forEach((page) => {
            if (String(page._id) !== PAGES.shared) page.parentPageId = PAGES.shared;
        });
        await call(pages.deletePage, { uid, params: { id: PAGES.shared } });
        return mockDb.store[SCHEMA_TYPE.PAGES].filter((page) => page.deletedStatusKey === 1 && String(page._id) !== PAGES.deleted);
    };

    it.each([
        ['owner', ['shared', 'company', 'closed', 'namedEdit']],
        ['admin', ['shared', 'company', 'closed', 'namedEdit']],
        ['inside', ['insidePrivate', 'shared', 'company', 'closed', 'namedView', 'namedEdit']],
        ['outside', ['outsidePrivate', 'shared', 'company']],
        ['guest', []],
        ['viewer', ['shared', 'company']],
        ['editor', ['shared', 'company']],
    ])('takes the sub-pages the %s can reach without being named on them', async (who, expected) => {
        expect(world.named(await trashedBy(PEOPLE[who]))).toEqual(expected);
    });
});

describe('the page readers agree on who reaches a page: the rule itself', () => {
    const everyPage = () => mockDb.store[SCHEMA_TYPE.PAGES];

    const byFilter = (options) => everyPage().filter((page) => fakeMongo.matches(page, pageReachFilter(options)));
    const byRow = (options, projectIds) => everyPage().filter((page) => pageReachedBy(page, { ...options, inProject: (id) => projectIds.includes(String(id)) }));

    it('answers the same from a query and from a loaded row', async () => {
        for (const who of Object.keys(PEOPLE)) {
            const projectIds = await visibleProjectIds(C, PEOPLE[who]);
            for (const companyWide of [true, false]) {
                for (const named of [true, false]) {
                    for (const namedProjectIds of [null, [PROJECTS.open], [PROJECTS.closed]]) {
                        const options = { uid: PEOPLE[who], companyWide, named, namedProjectIds };
                        expect(world.named(byRow(options, projectIds))).toEqual(world.named(byFilter({ ...options, projectIds })));
                    }
                }
            }
        }
    });

    it('a named person reaches the page, whatever its project or privacy', () => {
        const viewer = { uid: PEOPLE.viewer };
        expect(world.named(byFilter(viewer))).toEqual(['company', 'namedView']);
        expect(world.named(byFilter({ ...viewer, companyWide: false }))).toEqual(['namedView']);
        expect(world.named(byFilter({ uid: PEOPLE.editor, companyWide: false }))).toEqual(['namedEdit']);
        expect(world.named(byFilter({ uid: PEOPLE.outside, companyWide: false }))).toEqual([]);
    });

    it('leaves the named pages out for a reader that asks without them, or keeps them to some projects', () => {
        const viewer = { uid: PEOPLE.viewer, companyWide: false };
        expect(world.named(byFilter({ ...viewer, named: false }))).toEqual([]);
        expect(world.named(byFilter({ ...viewer, namedProjectIds: [PROJECTS.open] }))).toEqual([]);
        expect(world.named(byFilter({ ...viewer, namedProjectIds: [PROJECTS.closed] }))).toEqual(['namedView']);
        expect(world.named(byFilter({ ...viewer, namedProjectIds: [] }))).toEqual([]);
    });

    it('reads the named people from a copy that keeps them as ids', () => {
        const copy = { visibility: 'private', createdBy: PEOPLE.inside, projectId: PROJECTS.closed, sharedWith: [PEOPLE.viewer] };
        const filterFor = (uid) => pageReachFilter({ uid, projectIds: [PROJECTS.open], projectField: 'projectId', sharedAsIds: true });
        expect(fakeMongo.matches(copy, filterFor(PEOPLE.viewer))).toBe(true);
        expect(fakeMongo.matches(copy, filterFor(PEOPLE.editor))).toBe(false);
    });

    it('keeps a private doc to its author and a project doc to the people in the project', () => {
        const inOpen = { projectIds: [PROJECTS.open] };
        expect(world.named(byFilter({ uid: PEOPLE.inside, ...inOpen }))).toEqual(['insidePrivate', 'shared', 'company', 'deleted']);
        expect(world.named(byFilter({ uid: PEOPLE.outside, ...inOpen, companyWide: false }))).toEqual(['outsidePrivate', 'shared', 'deleted']);
        const everywhere = { projectIds: Object.values(PROJECTS) };
        expect(world.named(byFilter({ uid: PEOPLE.owner, ...everywhere }))).toEqual(['shared', 'company', 'closed', 'orphaned', 'deleted', 'namedEdit']);
        expect(world.named(byFilter({ uid: PEOPLE.owner, ...everywhere, exceptProjectIds: [PROJECTS.closed] }))).toEqual(['shared', 'company', 'orphaned', 'deleted']);
        expect(world.named(byFilter({ uid: PEOPLE.guest }))).toEqual(['company']);
    });

    it('reads the project from the field a copy keeps it under', () => {
        const copy = { visibility: 'project', projectId: PROJECTS.open };
        const filter = pageReachFilter({ uid: PEOPLE.guest, projectIds: [PROJECTS.open], projectField: 'projectId' });
        expect(fakeMongo.matches(copy, filter)).toBe(true);
        expect(fakeMongo.matches({ ...copy, projectId: PROJECTS.closed }, filter)).toBe(false);
    });
});
