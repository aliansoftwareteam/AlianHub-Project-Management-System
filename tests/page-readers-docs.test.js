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

describe('the page readers agree on who reaches a page: the docs list', () => {
    it('lists the whole workspace', async () => {
        expect(await listed({ scope: 'all' })).toEqual({
            owner: ['shared', 'company', 'closed'],
            admin: ['shared', 'company', 'closed'],
            inside: ['insidePrivate', 'shared', 'company', 'closed'],
            outside: ['outsidePrivate', 'shared', 'company'],
            guest: ['shared', 'company'],
        });
    });

    it('lists the company-wide docs when no project is named', async () => {
        expect(await listed({})).toEqual({ owner: ['company'], admin: ['company'], inside: ['company'], outside: ['company'], guest: ['company'] });
    });

    it('lists one project', async () => {
        expect(await listed({ projectId: PROJECTS.open })).toEqual({
            owner: ['shared'], admin: ['shared'], inside: ['insidePrivate', 'shared'], outside: ['outsidePrivate', 'shared'], guest: ['shared'],
        });
        expect(await listed({ projectId: PROJECTS.closed })).toEqual({ owner: ['closed'], admin: ['closed'], inside: ['closed'], outside: [], guest: [] });
        expect(await listed({ projectId: PROJECTS.trashed })).toEqual({ owner: [], admin: [], inside: [], outside: [], guest: [] });
    });

    it('lists the docs linked to a task', async () => {
        expect(await listed({ taskId: world.TASK })).toEqual({
            owner: ['shared', 'company', 'closed'],
            admin: ['shared', 'company', 'closed'],
            inside: ['insidePrivate', 'shared', 'company', 'closed'],
            outside: ['outsidePrivate', 'shared', 'company'],
            guest: ['shared', 'company'],
        });
    });

    it('lists the trash', async () => {
        expect(await listed({ scope: 'trash' })).toEqual({ owner: ['deleted'], admin: ['deleted'], inside: ['deleted'], outside: ['deleted'], guest: ['deleted'] });
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
        ['owner', ['shared', 'company', 'closed']],
        ['admin', ['shared', 'company', 'closed']],
        ['inside', ['insidePrivate', 'shared', 'company', 'closed']],
        ['outside', ['outsidePrivate', 'shared', 'company']],
        ['guest', ['shared', 'company']],
    ])('takes the sub-pages the %s can reach', async (who, expected) => {
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
                const options = { uid: PEOPLE[who], companyWide };
                expect(world.named(byRow(options, projectIds))).toEqual(world.named(byFilter({ ...options, projectIds })));
            }
        }
    });

    it('keeps a private doc to its author and a project doc to the people in the project', () => {
        const inOpen = { projectIds: [PROJECTS.open] };
        expect(world.named(byFilter({ uid: PEOPLE.inside, ...inOpen }))).toEqual(['insidePrivate', 'shared', 'company', 'deleted']);
        expect(world.named(byFilter({ uid: PEOPLE.outside, ...inOpen, companyWide: false }))).toEqual(['outsidePrivate', 'shared', 'deleted']);
        const everywhere = { projectIds: Object.values(PROJECTS) };
        expect(world.named(byFilter({ uid: PEOPLE.owner, ...everywhere }))).toEqual(['shared', 'company', 'closed', 'orphaned', 'deleted']);
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
