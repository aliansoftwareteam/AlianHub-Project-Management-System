const fakeMongo = require('./fixtures/fakeMongo');
const world = require('./fixtures/pageReachWorld');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));

const { myCache } = require('../Config/config');
const audit = require('../Modules/Agents/agentAudit');
const { undoStateOf } = require('../Modules/Agents/undo');

const { C, PROJECTS } = world;

const draftedPage = (pageId, kind) => ({
    action: audit.ACTION_DONE,
    createdAt: new Date(),
    projectId: PROJECTS.open,
    meta: { undo: { kind, pageId } },
});

const undoable = (kind) => world.askEveryone(async (uid) => {
    const states = await Promise.all(world.pageRows().map(async (page) => ({
        _id: page._id,
        state: await undoStateOf(C, draftedPage(page._id, kind), { userId: uid }, { undoHours: 24, run: null }),
    })));
    return states.filter(({ state }) => state.undoable);
});

beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    world.seed(mockDb);
});

describe('the page readers agree on who reaches a page: undoing an agent\'s page', () => {
    const EXPECTED = {
        owner: ['shared', 'company', 'closed', 'orphaned', 'deleted'],
        admin: ['shared', 'company', 'closed', 'orphaned', 'deleted'],
        inside: ['insidePrivate', 'shared', 'company', 'closed', 'orphaned', 'deleted'],
        outside: ['outsidePrivate', 'shared', 'company', 'closed', 'orphaned', 'deleted'],
        guest: ['shared', 'company', 'closed', 'orphaned', 'deleted'],
    };

    it.each(['page', 'pageVersion'])('offers undo of a %s action filed under a project the person can open', async (kind) => {
        expect(await undoable(kind)).toEqual(EXPECTED);
    });
});
