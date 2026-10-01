const fakeMongo = require('./fixtures/fakeMongo');
const world = require('./fixtures/pageReachWorld');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { resolveVisibleSet, clausesFor, chunkClausesFor, recheck } = require('../Modules/Knowledge/visibleSet');

const { C, PROJECTS } = world;

const WHOLE_COMPANY = {
    owner: ['shared', 'company', 'closed'],
    admin: ['shared', 'company', 'closed'],
    inside: ['insidePrivate', 'shared', 'company', 'closed'],
    outside: ['outsidePrivate', 'shared', 'company'],
    guest: ['shared', 'company'],
};

const ONE_PROJECT = { owner: ['shared'], admin: ['shared'], inside: ['insidePrivate', 'shared'], outside: ['outsidePrivate', 'shared'], guest: ['shared'] };

const setFor = (uid, { scope, tokenProjectIds } = {}) => resolveVisibleSet({ companyId: C, caller: { kind: 'user', userId: uid, tokenProjectIds }, scope });

const find = (type, filter) => mockDb.crud(C, { type, data: [filter] }, 'find');

const rowsFor = (options) => world.askEveryone(async (uid) => find(SCHEMA_TYPE.PAGES, clausesFor(await setFor(uid, options)).page));

const chunksFor = (options) => world.askEveryone(async (uid) => (await find(SCHEMA_TYPE.KNOWLEDGE_CHUNKS, chunkClausesFor(await setFor(uid, options)).page))
    .map((chunk) => chunk.sourceId));

beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    world.seed(mockDb);
    world.pageRows().forEach((page) => mockDb.seed(SCHEMA_TYPE.KNOWLEDGE_CHUNKS, {
        companyId: C,
        sourceType: 'page',
        sourceId: page._id,
        projectId: page.ProjectID || null,
        visibility: page.visibility,
        createdBy: page.createdBy,
        deleted: page.deletedStatusKey === 1,
    }));
});

describe('the page readers agree on who reaches a page: knowledge retrieval', () => {
    it('searches the docs a person can open', async () => {
        expect(await rowsFor()).toEqual(WHOLE_COMPANY);
        expect(await chunksFor()).toEqual(WHOLE_COMPANY);
    });

    it('stays inside a project the search is scoped to', async () => {
        const scope = { projectId: PROJECTS.open };
        expect(await rowsFor({ scope })).toEqual(ONE_PROJECT);
        expect(await chunksFor({ scope })).toEqual(ONE_PROJECT);
    });

    it('stays inside the projects a token is kept to', async () => {
        const tokenProjectIds = [PROJECTS.open];
        expect(await rowsFor({ tokenProjectIds })).toEqual(ONE_PROJECT);
        expect(await chunksFor({ tokenProjectIds })).toEqual(ONE_PROJECT);
    });

    it('rechecks ranked passages against the live docs', async () => {
        const passages = world.pageRows().map((page) => ({ sourceType: 'page', sourceId: page._id, updatedAt: page.updatedAt }));
        const kept = await world.askEveryone(async (uid) => recheck({ set: await setFor(uid), passages }));
        expect(kept).toEqual(WHOLE_COMPANY);
    });
});
