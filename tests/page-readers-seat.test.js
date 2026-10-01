process.env.JWT_SECRET = process.env.JWT_SECRET || 'page-readers-seat-test-secret';

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

const jsonwebtoken = require('jsonwebtoken');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { guardedPrefixes } = require('../Config/setMiddleware');
const { verifyJWTTokenWithCV2, verifyCompanyMembership } = require('../Config/jwt');
const pages = require('../Modules/Pages/controller');
const visibility = require('../Modules/Mcp/visibility');

const { C, PEOPLE, PAGES } = world;
const SEATLESS = 'a000000000000000000000af';

const reply = () => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (body) => { res.body = body; return res; };
    res.json = res.send;
    res.clearCookie = () => res;
    return res;
};

const sessionToken = (uid) => jsonwebtoken.sign(
    { uid, sid: '6f00000000000000000005e1', rti: 'refresh-jti', sexp: Math.floor(Date.now() / 1000) + 3600 },
    process.env.JWT_SECRET,
    { expiresIn: '1h', audience: C },
);

beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    world.seed(mockDb);
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: SEATLESS, roleType: 3, status: 2, isDelete: true });
    [SEATLESS, PEOPLE.inside].forEach((_id) => mockDb.seed(SCHEMA_TYPE.USERS, { _id, AssignCompany: [C] }));
});

describe('the page readers give the same answer: a caller without a live seat', () => {
    it('is stopped by the guard in front of the docs routes', async () => {
        expect(guardedPrefixes).toContain('/api/v2/pages');
        expect(await verifyCompanyMembership(PEOPLE.inside, C)).toBe(true);
        expect(await verifyCompanyMembership(SEATLESS, C)).toBe(false);

        const res = reply();
        const next = jest.fn();
        await verifyJWTTokenWithCV2({ headers: { companyid: C, authorization: `Bearer ${sessionToken(SEATLESS)}` }, ip: '127.0.0.1' }, res, next);
        expect(res.statusCode).toBe(403);
        expect(next).not.toHaveBeenCalled();
    });

    it('is listed no docs by the docs list itself', async () => {
        for (const query of [{}, { scope: 'all' }, { scope: 'trash' }, { taskId: world.TASK }]) {
            const res = reply();
            await pages.listPages(verified({ uid: SEATLESS, params: {}, body: {}, query, headers: { companyid: C } }), res);
            expect(res.body).toMatchObject({ status: true, data: [] });
        }
    });

    it('reads and writes no page over MCP', async () => {
        const vis = await visibility.forCaller({ companyId: C, userId: SEATLESS, projectIds: [] });
        const found = await mockDb.crud(C, { type: SCHEMA_TYPE.PAGES, data: [vis.pageClause()] }, 'find');

        expect(found).toEqual([]);
        expect(mockDb.store[SCHEMA_TYPE.PAGES].filter((page) => vis.allowsPage(page))).toEqual([]);
        await expect(visibility.assertWritable(C, vis, { companyWide: true })).rejects.toMatchObject({ notVisible: true });
        await expect(visibility.assertWritable(C, vis, { pageId: PAGES.company })).rejects.toMatchObject({ notVisible: true });
    });
});
