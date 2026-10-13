const mockDbs = {};
const mockDbFor = (companyId) => {
    const id = String(companyId);
    if (!mockDbs[id]) mockDbs[id] = require('./fixtures/fakeMongo').create();
    return mockDbs[id];
};

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDbFor(companyId).crud(companyId, q, method),
}));
jest.mock('../Config/config', () => {
    const NodeCache = require('node-cache');
    return { myCache: new NodeCache() };
});
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../common-storage/readStoredFile', () => ({ readStoredFile: jest.fn() }));
jest.mock('../Modules/Agents/budget', () => ({ settings: jest.fn(async () => ({ monthlyBudgetUsd: 25 })) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const controls = require('../Modules/Knowledge/controls');

/* Erasure by person (Instance console, Knowledge) is the one path that forgets a person; their
 * Ask threads hold their questions verbatim, so it removes those too. */

const C = '6f0000000000000000000c01';
const OTHER = '6f0000000000000000000c02';
const ALICE = '6f0000000000000000000011';
const BOB = '6f0000000000000000000012';
const THREADS = SCHEMA_TYPE.ASK_THREADS;

const thread = (companyId, ownerId) => mockDbFor(companyId).seed(THREADS, { ownerId, title: 'q', turns: [], turnCount: 0, lastTurnAt: new Date() });
const owners = (companyId) => (mockDbFor(companyId).store[THREADS] || []).map((t) => t.ownerId);

beforeEach(() => { Object.keys(mockDbs).forEach((key) => { delete mockDbs[key]; }); });

describe('erasure by person', () => {
    it('removes the person\'s Ask threads in that workspace and counts them', async () => {
        thread(C, ALICE);
        thread(C, ALICE);
        thread(C, BOB);
        thread(OTHER, ALICE);

        const result = await controls.erasePerson(C, ALICE);

        expect(result).toMatchObject({ removed: { ask_thread: 2 }, total: 2 });
        expect(owners(C)).toEqual([BOB]);
        expect(owners(OTHER)).toEqual([ALICE]);
    });

    it('finds a person who left nothing but Ask threads', async () => {
        expect(await controls.personExists(C, ALICE)).toBe(false);
        thread(C, ALICE);
        expect(await controls.personExists(C, ALICE)).toBe(true);
    });
});
