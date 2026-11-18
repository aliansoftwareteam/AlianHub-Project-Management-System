const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn(), recordAudit: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');

const CID = '6f00000000000000000000c1';
const USERS = {
    owner: ['6f0000000000000000000001', 1],
    admin: ['6f0000000000000000000002', 2],
    member: ['6f0000000000000000000003', 3],
    guest: ['6f0000000000000000000004', 0],
};

const routes = [];
const app = ['get', 'put', 'post', 'delete', 'patch'].reduce((acc, method) => {
    acc[method] = (routePath, ...handlers) => routes.push({ method, path: routePath, handlers });
    return acc;
}, {});
require('../Modules/Milestone/routes').init(app);
const route = routes.find((r) => r.method === 'post' && r.path === '/api/v1/milestone');

const makeRes = () => {
    const res = { code: 200 };
    res.status = (c) => { res.code = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    res.send = res.json;
    res.set = () => res;
    return res;
};

const send = async (role, body) => {
    const req = { uid: USERS[role][0], headers: { companyid: CID }, body, params: {}, query: {} };
    const res = makeRes();
    for (const handler of route.handlers) {
        let passed = false;
        await handler(req, res, () => { passed = true; });
        if (!passed) break;
    }
    return res;
};

const settingWrites = () => mockDb.calls.filter((c) => c.method !== 'find' && c.method !== 'findOne' && c.query && c.query.type === SCHEMA_TYPE.SETTINGS);
const storedRange = () => mockDb.store[SCHEMA_TYPE.SETTINGS].find((d) => d.name === SCHEMA_TYPE.HOURLY_MILESTONE_WEEKLY_RANGE).settings;

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    Object.values(USERS).forEach(([userId, roleType]) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false }));
    mockDb.seed(SCHEMA_TYPE.SETTINGS, { name: SCHEMA_TYPE.HOURLY_MILESTONE_WEEKLY_RANGE, settings: ['Mon - Sun'] });
});

describe('POST /api/v1/milestone (company milestone week)', () => {
    it.each(['member', 'guest'])('refuses a %s and leaves the setting alone', async (role) => {
        const res = await send(role, { action: 'Sun - Mon' });
        expect(res.code).toBe(403);
        expect(settingWrites()).toEqual([]);
        expect(storedRange()).toEqual(['Mon - Sun']);
    });

    it.each(['owner', 'admin'])('lets the %s pick one of the offered weeks', async (role) => {
        const res = await send(role, { action: 'Sun - Mon' });
        expect(res.code).toBe(200);
        expect(storedRange()).toEqual(['Sun - Mon']);
    });

    it.each([
        ['an unknown week', 'Tue - Mon'],
        ['an object', { $gt: '' }],
        ['a list', ['Mon - Sun']],
        ['nothing', undefined],
    ])('refuses %s as the week', async (_label, action) => {
        const res = await send('owner', { action });
        expect(res.code).toBe(400);
        expect(settingWrites()).toEqual([]);
        expect(storedRange()).toEqual(['Mon - Sun']);
    });
});
