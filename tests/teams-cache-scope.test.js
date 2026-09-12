jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: jest.fn(async (companyId, { data }, method) => (
        method === 'save' ? { _id: 'saved', ...data } : [{ _id: `team-${companyId}`, name: `Team of ${companyId}` }]
    )),
}));

const { myCache } = require('../Config/config');
const { teamsListKey, teamIdentitiesKey } = require('../Modules/Teams/cacheKeys');
const { getTeams, addTeam } = require('../Modules/Teams/controller');

const A = '6f0000000000000000000a01';
const B = '6f0000000000000000000b01';
const USER = '6f0000000000000000000001';

const response = () => {
    const res = { statusCode: 0, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    res.set = jest.fn(() => res);
    return res;
};

const get = async (companyId) => {
    const res = response();
    await getTeams({ headers: { companyid: companyId }, uid: USER, body: {} }, res);
    return res;
};

beforeEach(() => myCache.flushAll());

describe('the team list cache is keyed by company', () => {
    it('never serves one company the team list of another', async () => {
        expect((await get(A)).body).toEqual([{ _id: `team-${A}`, name: `Team of ${A}` }]);
        expect((await get(B)).body).toEqual([{ _id: `team-${B}`, name: `Team of ${B}` }]);
    });

    it('serves the second read of the same company from its own cached entry', async () => {
        await get(A);
        const second = await get(A);
        expect(second.body).toEqual([{ _id: `team-${A}`, name: `Team of ${A}` }]);
        expect(second.set).toHaveBeenCalledWith(expect.objectContaining({ FromCache: 'true' }));
        expect(myCache.has(teamsListKey(A))).toBe(true);
        expect(myCache.has(teamsListKey(B))).toBe(false);
    });
});

describe('a team write drops the caller company cache only', () => {
    it('drops the list and the sprint identities of that company, and nothing of another', async () => {
        myCache.set(teamsListKey(A), ['stale']);
        myCache.set(teamIdentitiesKey(A, USER), [USER]);
        myCache.set(teamsListKey(B), ['kept']);
        myCache.set(teamIdentitiesKey(B, USER), [USER]);

        await addTeam({ headers: { companyid: A }, uid: USER, body: { name: 'New' } }, response());

        expect(myCache.has(teamsListKey(A))).toBe(false);
        expect(myCache.has(teamIdentitiesKey(A, USER))).toBe(false);
        expect(myCache.has(teamsListKey(B))).toBe(true);
        expect(myCache.has(teamIdentitiesKey(B, USER))).toBe(true);
    });
});
