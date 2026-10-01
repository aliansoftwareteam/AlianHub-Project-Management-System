const fakeMongo = require('./fixtures/fakeMongo');
const world = require('./fixtures/pageReachWorld');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/taskListProjects', () => require('./fixtures/taskListRules').taskListHeldEverywhere());
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider', () => ({ getProvider: jest.fn(), isAnyProviderConfigured: () => false }));

const { myCache } = require('../Config/config');
const { gather, openProjects } = require('../Modules/AI/ask');
const { openSources } = require('../Modules/AI/askThreads');
const { pinnedSources } = require('../Modules/AI/askContext');
const { taskContext } = require('../Modules/AI/taskContext');

const { C, PAGES, TASK } = world;

const IN_PROJECTS_ONLY = {
    owner: ['shared', 'closed'],
    admin: ['shared', 'closed'],
    inside: ['insidePrivate', 'shared', 'closed'],
    outside: ['outsidePrivate', 'shared'],
    guest: ['shared'],
};

const WITH_COMPANY_WIDE = {
    owner: ['shared', 'company', 'closed'],
    admin: ['shared', 'company', 'closed'],
    inside: ['insidePrivate', 'shared', 'company', 'closed'],
    outside: ['outsidePrivate', 'shared', 'company'],
    guest: ['shared', 'company'],
};

const pagesOf = (sources) => sources.filter((source) => source.kind === 'page');

beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    world.seed(mockDb);
});

describe('the page readers agree on who reaches a page: Ask', () => {
    it('gathers the docs a question may cite', async () => {
        const cited = await world.askEveryone(async (uid) => pagesOf((await gather(C, uid, { question: 'atlas', limit: 20 })).sources));
        expect(cited).toEqual(IN_PROJECTS_ONLY);
    });

    it('re-opens the docs a saved answer cited', async () => {
        const cites = Object.values(PAGES).map((sourceId) => ({ kind: 'page', sourceId }));
        const open = await world.askEveryone(async (uid) => [...(await openSources(C, uid, cites)).keys()].map((key) => key.split(':')[1]));
        expect(open).toEqual(IN_PROJECTS_ONLY);
    });

    it('reads the docs a person attached to a question', async () => {
        const context = Object.values(PAGES).map((id) => ({ kind: 'page', id }));
        const pinned = await world.askEveryone(async (uid) => pagesOf(await pinnedSources(C, uid, { context, projects: await openProjects(C, uid) })));
        expect(pinned).toEqual(WITH_COMPANY_WIDE);
    });

    it('reads the docs linked to a task', async () => {
        const linked = await world.askEveryone(async (uid) => (await taskContext({ companyId: C, uid, taskId: TASK })).docs);
        expect(linked).toEqual(WITH_COMPANY_WIDE);
    });
});
