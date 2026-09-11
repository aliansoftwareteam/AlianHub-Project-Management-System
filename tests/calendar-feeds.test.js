const crypto = require('crypto');

const mockDbs = {};
const mockDbFor = (id) => { mockDbs[id] = mockDbs[id] || require('./fixtures/fakeMongo').create(); return mockDbs[id]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method) }));
jest.mock('../Config/config', () => ({ WEBURL: 'https://hub.test/', myCache: { get: () => undefined, set: () => {}, del: () => {}, getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const ctrl = require('../Modules/Calendar/controller');

const COMPANY = '6f00000000000000000ca001';
const OTHER_COMPANY = '6f00000000000000000ca0ff';
const OWNER = '6f00000000000000000ca011';
const MEMBER = '6f00000000000000000ca012';
const SHARED = '6f00000000000000000ca021';
const HIDDEN = '6f00000000000000000ca022';

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const feeds = () => mockDbFor(SCHEMA_TYPE.GOLBAL).store[SCHEMA_TYPE.CALENDAR_FEEDS] || [];

const run = async (handler, { uid, params = {}, body = {}, aud } = {}) => {
    const res = { statusCode: 200, headers: {} };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (payload) => { res.body = payload; return res; };
    res.send = (payload) => { res.body = payload; return res; };
    res.setHeader = (key, value) => { res.headers[key] = value; };
    await handler({ uid, aud, params, body, query: {}, headers: { companyid: COMPANY }, protocol: 'https', get: () => 'hub.test' }, res);
    return res;
};

const createFeed = (uid, body = { scope: 'my' }) => run(ctrl.createFeed, { uid, body });
const fetchIcs = (token) => run(ctrl.getIcs, { params: { token } });

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => { delete mockDbs[key]; });
    jest.clearAllMocks();
    visibleProjectIds.mockImplementation(async (companyId, uid) => (uid === OWNER ? [SHARED, HIDDEN] : [SHARED]));
    const company = mockDbFor(COMPANY);
    company.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    company.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: 3, status: 2, isDelete: false });
    company.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Shared owner task', TaskKey: 'S-1', ProjectID: SHARED, AssigneeUserId: [OWNER], DueDate: new Date('2026-09-20T00:00:00Z'), deletedStatusKey: 0 });
    company.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Hidden owner task', TaskKey: 'H-1', ProjectID: HIDDEN, AssigneeUserId: [OWNER], DueDate: new Date('2026-09-21T00:00:00Z'), deletedStatusKey: 0 });
});

describe('calendar feed management (PRJ-01)', () => {
    test('a feed stores only a hash of its token and hands the link out once, at create', async () => {
        const res = await createFeed(OWNER);
        expect(res.statusCode).toBe(200);
        const { token, url, _id } = res.body.data;
        expect(url).toBe(`https://hub.test/api/v1/calendar/ics/${token}`);
        const [stored] = feeds();
        expect(stored.tokenHash).toBe(sha256(token));
        expect(stored.token).toBeUndefined();
        expect(String(stored._id)).toBe(String(_id));
    });

    test('the list holds only the caller\'s own feeds and never a token, hash or link', async () => {
        const ownerFeed = (await createFeed(OWNER)).body.data;
        await createFeed(MEMBER);
        const res = await run(ctrl.listFeeds, { uid: MEMBER });
        expect(res.statusCode).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].userId).toBe(MEMBER);
        res.body.data.forEach((feed) => ['token', 'tokenHash', 'url'].forEach((key) => expect(feed).not.toHaveProperty(key)));
        expect(JSON.stringify(res.body)).not.toContain(ownerFeed.token);
    });

    test('a user id in the body cannot create a feed for someone else', async () => {
        const res = await createFeed(MEMBER, { scope: 'my', userData: { id: OWNER } });
        expect(res.body.data.userId).toBe(MEMBER);
        expect(feeds()[0].userId).toBe(MEMBER);
    });

    test('a project feed needs a project the caller can see', async () => {
        const res = await createFeed(MEMBER, { scope: 'project', projectId: HIDDEN });
        expect(res.statusCode).toBe(404);
        expect(res.body.status).toBe(false);
        expect(feeds()).toHaveLength(0);
    });

    test('bad input is a 400, and a company outside the token audience a 403', async () => {
        expect((await createFeed(OWNER, { scope: 'project', projectId: 'nope' })).statusCode).toBe(400);
        expect((await createFeed(OWNER, { scope: 'my', name: 'x'.repeat(121) })).statusCode).toBe(400);
        expect((await run(ctrl.regenerateFeed, { uid: OWNER, params: { id: 'nope' } })).statusCode).toBe(400);
        expect((await run(ctrl.listFeeds, { uid: OWNER, aud: OTHER_COMPANY })).statusCode).toBe(403);
    });

    test('regenerating a link kills the old URL and serves the new one', async () => {
        const created = (await createFeed(OWNER)).body.data;
        expect((await fetchIcs(created.token)).statusCode).toBe(200);
        const regenerated = await run(ctrl.regenerateFeed, { uid: OWNER, params: { id: String(created._id) } });
        expect(regenerated.statusCode).toBe(200);
        expect(regenerated.body.data.token).not.toBe(created.token);
        expect((await fetchIcs(created.token)).statusCode).toBe(404);
        const fresh = await fetchIcs(regenerated.body.data.token);
        expect(fresh.statusCode).toBe(200);
        expect(fresh.body).toContain('Shared owner task');
    });

    test('nobody else can regenerate or delete a feed, and the owner\'s link survives the attempt', async () => {
        const created = (await createFeed(OWNER)).body.data;
        const params = { id: String(created._id) };
        expect((await run(ctrl.regenerateFeed, { uid: MEMBER, params })).statusCode).toBe(404);
        expect((await run(ctrl.deleteFeed, { uid: MEMBER, params })).statusCode).toBe(404);
        expect((await fetchIcs(created.token)).statusCode).toBe(200);
    });

    test('a deleted feed stops answering', async () => {
        const created = (await createFeed(OWNER)).body.data;
        expect((await run(ctrl.deleteFeed, { uid: OWNER, params: { id: String(created._id) } })).statusCode).toBe(200);
        expect((await fetchIcs(created.token)).statusCode).toBe(404);
    });
});

describe('the public .ics feed (PRJ-01)', () => {
    test('shows only tasks in projects the feed owner can still see', async () => {
        const { token } = (await createFeed(OWNER)).body.data;
        expect((await fetchIcs(token)).body).toContain('Hidden owner task');
        visibleProjectIds.mockResolvedValue([SHARED]);
        const res = await fetchIcs(token);
        expect(res.statusCode).toBe(200);
        expect(res.headers['Content-Type']).toContain('text/calendar');
        expect(res.body).toContain('Shared owner task');
        expect(res.body).not.toContain('Hidden owner task');
        expect(visibleProjectIds).toHaveBeenLastCalledWith(COMPANY, OWNER);
    });

    test('a project feed goes dark once its owner loses access to the project', async () => {
        const { token } = (await createFeed(OWNER, { scope: 'project', projectId: HIDDEN })).body.data;
        expect((await fetchIcs(token)).body).toContain('Hidden owner task');
        visibleProjectIds.mockResolvedValue([SHARED]);
        expect((await fetchIcs(token)).statusCode).toBe(404);
    });

    test('a removed member\'s feed stops answering', async () => {
        const { token } = (await createFeed(MEMBER)).body.data;
        expect((await fetchIcs(token)).statusCode).toBe(200);
        mockDbFor(COMPANY).store[SCHEMA_TYPE.COMPANY_USERS].find((row) => row.userId === MEMBER).isDelete = true;
        expect((await fetchIcs(token)).statusCode).toBe(404);
    });

    test('a malformed or unknown token is refused', async () => {
        expect((await fetchIcs('not-a-token')).statusCode).toBe(400);
        expect((await fetchIcs('a'.repeat(36))).statusCode).toBe(404);
    });
});
