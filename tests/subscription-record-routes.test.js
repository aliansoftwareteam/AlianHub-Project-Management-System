const { create } = require('./fixtures/fakeMongo');

const mockDbs = {};
const mockDbFor = (name) => (mockDbs[name] = mockDbs[name] || create());

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (db, query, method) => mockDbFor(String(db)).crud(db, query, method) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { setMiddlewareV2 } = require('../Config/setMiddleware');
const { generateToken, hashToken } = require('../Modules/ApiTokens/helpers/apiTokenRules');
const { signSession, startApp } = require('./fixtures/sessionApp');

const COMPANY = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const INSTANCE_ADMIN = '6f0000000000000000000a01';
const OWNER = '6f0000000000000000000a02';
const MEMBER = '6f0000000000000000000a04';
const GUEST = '6f0000000000000000000a05';
const OTHER_OWNER = '6f0000000000000000000a06';
const SEATS = { [INSTANCE_ADMIN]: 1, [OWNER]: 1, [MEMBER]: 3, [GUEST]: 0 };

let app;

const globalDb = () => mockDbFor(SCHEMA_TYPE.GOLBAL);

const seedSeat = (companyId, userId, roleType) => {
    globalDb().seed(SCHEMA_TYPE.USERS, { _id: userId, AssignCompany: [companyId], isProductOwner: userId === INSTANCE_ADMIN });
    mockDbFor(companyId).seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false });
};

const mintToken = (userId, extra = {}) => {
    const raw = generateToken();
    mockDbFor(COMPANY).seed(SCHEMA_TYPE.API_TOKENS, { userId, tokenHash: hashToken(raw), active: true, scopes: ['read', 'write'], createdAt: new Date(), ...extra });
    return raw;
};

const session = (uid, companyId = COMPANY) => () => ({ token: signSession(uid, [companyId]) });
const tokenOf = (uid, extra) => () => ({ token: mintToken(uid, extra), companyId: COMPANY });

beforeAll(async () => {
    app = await startApp((server) => {
        setMiddlewareV2(server);
        require('../Modules/subscription/routes').init(server);
    });
});
afterAll(() => app.close());

beforeEach(() => {
    myCache.flushAll();
    Object.keys(mockDbs).forEach((key) => { delete mockDbs[key]; });
    [COMPANY, OTHER_COMPANY].forEach((companyId) => globalDb().seed(SCHEMA_TYPE.COMPANIES, { _id: companyId }));
    Object.entries(SEATS).forEach(([userId, roleType]) => seedSeat(COMPANY, userId, roleType));
    seedSeat(OTHER_COMPANY, OTHER_OWNER, 1);
    globalDb().seed(SCHEMA_TYPE.SUBSCRIPTIONS, { subscriptionId: 'sub-own', companyId: COMPANY, userId: OWNER, plan: 'Pro' });
    globalDb().seed(SCHEMA_TYPE.SUBSCRIPTIONS, { subscriptionId: 'sub-other', companyId: OTHER_COMPANY, userId: OTHER_OWNER, plan: 'Team' });
});

describe('GET /api/v1/subscriptions/:id answers for a workspace the caller belongs to', () => {
    it.each([
        ['the workspace owner', session(OWNER)],
        ['a member', session(MEMBER)],
        ['a guest', session(GUEST)],
        ['an API token', tokenOf(MEMBER)],
        ['an agent token', tokenOf(MEMBER, { agentId: 'agent-1' })],
    ])('answers %s their own workspace\'s record and not another workspace\'s', async (label, caller) => {
        const own = await app.call('GET', '/api/v1/subscriptions/sub-own', caller());
        expect(own.status).toBe(200);
        expect(own.body.plan).toBe('Pro');

        const other = await app.call('GET', '/api/v1/subscriptions/sub-other', caller());
        const missing = await app.call('GET', '/api/v1/subscriptions/sub-none', caller());
        expect(other.status).toBe(404);
        expect(other.body).toEqual(missing.body);
    });

    it('answers the instance admin any workspace\'s record, but not through an API token', async () => {
        expect((await app.call('GET', '/api/v1/subscriptions/sub-other', session(INSTANCE_ADMIN)())).status).toBe(200);
        expect((await app.call('GET', '/api/v1/subscriptions/sub-other', tokenOf(INSTANCE_ADMIN)())).status).toBe(404);
    });

    it('answers the other workspace\'s owner their record', async () => {
        expect((await app.call('GET', '/api/v1/subscriptions/sub-other', session(OTHER_OWNER, OTHER_COMPANY)())).status).toBe(200);
        expect((await app.call('GET', '/api/v1/subscriptions/sub-own', session(OTHER_OWNER, OTHER_COMPANY)())).status).toBe(404);
    });

    it('refuses a caller with no session', async () => {
        expect((await app.call('GET', '/api/v1/subscriptions/sub-own')).status).toBe(401);
    });
});
