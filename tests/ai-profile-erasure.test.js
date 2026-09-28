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

/* Erasure by person is the one path that forgets a person; their AI profile holds what they told
 * Ask about themselves, so it goes with it. */

const C = '6f0000000000000000000c01';
const OTHER = '6f0000000000000000000c02';
const ALICE = '6f0000000000000000000011';
const BOB = '6f0000000000000000000012';
const PROFILES = SCHEMA_TYPE.AI_PROFILES;

const seed = (companyId, ownerId) => mockDbFor(companyId).seed(PROFILES, { ownerId, enabled: true, nickname: 'n', role: '', preferences: '', facts: [] });
const owners = (companyId) => (mockDbFor(companyId).store[PROFILES] || []).map((row) => row.ownerId);

beforeEach(() => { Object.keys(mockDbs).forEach((key) => { delete mockDbs[key]; }); });

describe('erasure by person', () => {
    it('removes the person\'s AI profile in that workspace and counts it', async () => {
        seed(C, ALICE);
        seed(C, BOB);
        seed(OTHER, ALICE);

        const result = await controls.erasePerson(C, ALICE);

        expect(result).toMatchObject({ removed: { ai_profile: 1 }, total: 1 });
        expect(owners(C)).toEqual([BOB]);
        expect(owners(OTHER)).toEqual([ALICE]);
    });

    it('finds a person who left nothing but an AI profile', async () => {
        expect(await controls.personExists(C, ALICE)).toBe(false);
        seed(C, ALICE);
        expect(await controls.personExists(C, ALICE)).toBe(true);
    });
});
