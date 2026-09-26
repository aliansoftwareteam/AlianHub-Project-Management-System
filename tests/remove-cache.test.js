jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));
jest.mock('../Config/permissionGuard', () => ({ ...jest.requireActual('../Config/permissionGuard'), getRoleType: jest.fn() }));

const express = require('express');
const { myCache } = require('../Config/config');
const { setMiddlewareWithCV2 } = require('../Config/setMiddleware');
const { getRoleType, ROLE_OWNER, ROLE_ADMIN, ROLE_MEMBER, ROLE_GUEST } = require('../Config/permissionGuard');
const { removeCacheHandler, removeCallerCache } = require('../Modules/Auth/controller/removeCache');

const COMPANY = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const USER = '6f0000000000000000000001';
const OTHER_USER = '6f0000000000000000000002';

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    return res;
};
const call = async (body, { companyId = COMPANY, uid = USER } = {}) => {
    const res = response();
    await removeCacheHandler({ body, headers: { companyid: companyId }, uid }, res);
    return res;
};

describe('POST /api/v1/removeCache without a session', () => {
    let server;
    let baseURL;

    beforeAll(async () => {
        const app = express();
        app.use(express.json());
        setMiddlewareWithCV2(app);
        app.post('/api/v1/removeCache', removeCacheHandler);
        await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
        baseURL = `http://127.0.0.1:${server.address().port}`;
    });
    afterAll(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));

    beforeEach(() => {
        myCache.flushAll();
        myCache.set(`UserProjectData:${COMPANY}:${USER}`, 'a');
    });

    const post = (body, headers = {}) => fetch(`${baseURL}/api/v1/removeCache`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
    });

    it('refuses a global flush with 401 and keeps the cache', async () => {
        const res = await post({ global: true });
        expect(res.status).toBe(401);
        expect(myCache.keys()).toHaveLength(1);
    });

    it('refuses a keyed flush with 401 even when a company id is supplied', async () => {
        const res = await post({ cacheKey: 'UserProjectData:', isPrefix: true }, { companyid: COMPANY });
        expect(res.status).toBe(401);
        expect(myCache.keys()).toHaveLength(1);
    });

    it('refuses a forged bearer token with 401', async () => {
        const res = await post({ cacheKey: 'UserProjectData:', isPrefix: true }, { companyid: COMPANY, authorization: 'Bearer not-a-jwt' });
        expect(res.status).toBe(401);
    });
});

describe('removeCacheHandler scope', () => {
    beforeEach(() => {
        getRoleType.mockReset().mockResolvedValue(ROLE_MEMBER);
        myCache.flushAll();
        myCache.set(`UserProjectData:${COMPANY}:${USER}`, 'a');
        myCache.set(`UserProjectData:${COMPANY}:${OTHER_USER}`, 'b');
        myCache.set(`UserProjectData:${OTHER_COMPANY}:${OTHER_USER}`, 'c');
        myCache.set(`rules:${COMPANY}`, 'd');
        myCache.set(`rules:${OTHER_COMPANY}`, 'e');
        myCache.set(`dashboard_${USER}`, 'f');
        myCache.set(`dashboard_${OTHER_USER}`, 'g');
        myCache.set('file_extensions_caches', 'h');
    });

    it.each([
        ['an owner', ROLE_OWNER],
        ['an admin', ROLE_ADMIN],
    ])('lets %s flush only their company', async (_, role) => {
        getRoleType.mockResolvedValue(role);
        const res = await call({ global: true });
        expect(getRoleType).toHaveBeenCalledWith(COMPANY, USER);
        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ status: true, data: { removed: 3 } });
        expect(myCache.keys().sort()).toEqual([
            `UserProjectData:${OTHER_COMPANY}:${OTHER_USER}`,
            `dashboard_${OTHER_USER}`,
            `dashboard_${USER}`,
            'file_extensions_caches',
            `rules:${OTHER_COMPANY}`,
        ].sort());
    });

    it('matches the company slot of each key type, not the id anywhere in the key', async () => {
        getRoleType.mockResolvedValue(ROLE_OWNER);
        const foreign = [
            `milestone:${COMPANY}:${OTHER_COMPANY}`,
            `UserProjectData:${OTHER_COMPANY}:${COMPANY}`,
            `notification:${COMPANY}:${OTHER_COMPANY}`,
            `dashboard_${COMPANY}`,
            `mystery:${COMPANY}`,
        ];
        foreign.forEach((key) => myCache.set(key, 'x'));
        myCache.set(`milestone:${OTHER_USER}:${COMPANY}`, 'mine');
        myCache.set(`roleType:active:${COMPANY}:${USER}`, 'mine');
        myCache.set(`companyData_${COMPANY}`, 'mine');

        const res = await call({ global: true });

        expect(res.body).toMatchObject({ data: { removed: 6 } });
        foreign.forEach((key) => expect(myCache.has(key)).toBe(true));
        expect(myCache.has(`milestone:${OTHER_USER}:${COMPANY}`)).toBe(false);
        expect(myCache.has(`roleType:active:${COMPANY}:${USER}`)).toBe(false);
        expect(myCache.has(`companyData_${COMPANY}`)).toBe(false);
    });

    it.each([
        ['a member', ROLE_MEMBER],
        ['a guest', ROLE_GUEST],
        ['a user without a seat', null],
    ])('refuses a company flush from %s', async (_, role) => {
        getRoleType.mockResolvedValue(role);
        const res = await call({ global: true });
        expect(res.statusCode).toBe(403);
        expect(myCache.keys()).toHaveLength(8);
    });

    it('never flushes anything when the company id is not an object id', async () => {
        getRoleType.mockResolvedValue(ROLE_OWNER);
        const res = await call({ global: true }, { companyId: '.*' });
        expect(res.body).toMatchObject({ data: { removed: 0 } });
        expect(myCache.keys()).toHaveLength(8);
    });

    it('drops a prefix only within the caller company', async () => {
        const res = await call({ cacheKey: 'UserProjectData:', isPrefix: true });
        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ status: true, data: { removed: 2 } });
        expect(myCache.has(`UserProjectData:${OTHER_COMPANY}:${OTHER_USER}`)).toBe(true);
        expect(myCache.has(`UserProjectData:${COMPANY}:${OTHER_USER}`)).toBe(false);
    });

    it('drops the company rules cache but not another company', async () => {
        await call({ cacheKey: 'rules:', isPrefix: true });
        expect(myCache.has(`rules:${COMPANY}`)).toBe(false);
        expect(myCache.has(`rules:${OTHER_COMPANY}`)).toBe(true);
    });

    it("drops the caller's own per-user key", async () => {
        const res = await call({ cacheKey: `dashboard_${USER}` });
        expect(res.statusCode).toBe(200);
        expect(myCache.has(`dashboard_${USER}`)).toBe(false);
    });

    it("refuses another user's per-user key and instance-wide keys", async () => {
        expect((await call({ cacheKey: `dashboard_${OTHER_USER}` })).statusCode).toBe(403);
        expect((await call({ cacheKey: 'file_extensions_caches' })).statusCode).toBe(403);
        expect((await call({ cacheKey: `rules:${OTHER_COMPANY}` })).statusCode).toBe(403);
        expect(myCache.keys()).toHaveLength(8);
    });

    it('leaves instance-wide keys alone on a prefix that matches them', async () => {
        await call({ cacheKey: 'file_', isPrefix: true });
        expect(myCache.has('file_extensions_caches')).toBe(true);
    });

    it('requires a cache key', async () => {
        expect((await call({})).statusCode).toBe(400);
    });

    it('matches nothing without a valid company or user id', async () => {
        expect(removeCallerCache({ cacheKey: 'rules:', isPrefix: true, companyId: '', uid: '' })).toEqual([]);
        expect(removeCallerCache({ cacheKey: 'rules:', isPrefix: true, companyId: '.*', uid: 'undefined' })).toEqual([]);
    });
});
