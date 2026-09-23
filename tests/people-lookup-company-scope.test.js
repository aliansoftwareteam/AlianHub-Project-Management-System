jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));
jest.mock('../event/socketEventEmitter', () => ({}));
process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';
jest.mock('../Modules/ImportSettings/controller.js', () => ({ importSettingsV2Function: jest.fn((req, cb) => cb({ status: true })) }));
jest.mock('../Modules/notification/defaults', () => ({ ensureNotificationDefaults: jest.fn(async () => {}) }));
jest.mock('../Modules/Knowledge/vectorStore', () => ({ prepareCompany: jest.fn() }));
jest.mock('../Modules/Auth/controller/helper.js', () => ({}));
jest.mock('../Modules/Auth/controller.js', () => ({ addAndRemoveUserInMongodbNotificationCount: jest.fn(async () => {}) }));
jest.mock('../Modules/Company/eventController.js', () => ({ emitListener: jest.fn() }));
jest.mock('../Modules/service.js', () => ({ sendAttachMail: jest.fn() }));
jest.mock('../Modules/Affiliate/controller.js', () => ({ storeRefferalCode: jest.fn(async () => {}), checkAndStoreRefferalCode: jest.fn(async () => {}) }));
jest.mock('../common-storage/common-server.js', () => ({ handleCreateCompanyDataStorageFunForUpload: jest.fn(async () => {}), handleCreateCompanyDataStorageFun: jest.fn(async () => {}) }));
jest.mock('../Modules/createProject/sampleProject.js', () => ({ seedSampleProject: jest.fn(async () => {}) }));

const mongoose = require('mongoose');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { myCache } = require('../Config/config');
const { dbCollections } = require('../Config/collections');
const { setMiddlewareV2, setMiddlewareWithCV2 } = require('../Config/setMiddleware');
const { signSession, startApp } = require('./fixtures/sessionApp');
const companyCtrl = require('../Modules/Company/controller');
const { importSettingsV2Function } = require('../Modules/ImportSettings/controller.js');

const COMPANY = '6f0000000000000000000c01';
const CALLER = '6f0000000000000000000001';
const OUTSIDER = '6f0000000000000000000009';
const UNKNOWN = '6f00000000000000000000ff';
const NEW_COMPANY = '6f0000000000000000000c77';
const CALLER_EMAIL = 'caller@own.test';

const OWNED_COMPANIES = {
    [CALLER]: ['Caller Co'],
    [OUTSIDER]: ['Elsewhere Inc', 'Elsewhere Labs'],
};

let app;
const previousFreeCount = process.env.FREE_COMPANY_COUNT;

beforeAll(async () => {
    process.env.FREE_COMPANY_COUNT = '2';
    app = await startApp((server) => {
        setMiddlewareWithCV2(server);
        setMiddlewareV2(server);
        server.get('/api/v1/freeCompanyCount/:userId', companyCtrl.checkFreeCompanyCountsApi);
        server.post('/api/v2/company/create', companyCtrl.createCompanyV2);
    });
});
afterAll(() => {
    if (previousFreeCount === undefined) delete process.env.FREE_COMPANY_COUNT;
    else process.env.FREE_COMPANY_COUNT = previousFreeCount;
    return app.close();
});

beforeEach(() => {
    myCache.flushAll();
    MongoDbCrudOpration.mockReset();
    MongoDbCrudOpration.mockImplementation(async (db, obj, method) => {
        if (obj.type === dbCollections.USERS && method === 'findOne') {
            return String(obj.data[0]._id) === CALLER ? { _id: CALLER, Employee_Email: CALLER_EMAIL, AssignCompany: [COMPANY] } : null;
        }
        if (obj.type === dbCollections.PRECOMPANIES && method === 'findOneAndUpdate') return { _id: new mongoose.Types.ObjectId(NEW_COMPANY) };
        if (method === 'save') return obj.data;
        if (obj.type === dbCollections.USERS && method === 'findOneAndUpdate') return { _id: obj.data[0]._id };
        if (obj.type === dbCollections.COMPANIES && method === 'aggregate') {
            const owner = String(obj.data[0][0].$match.userId);
            const names = OWNED_COMPANIES[owner];
            return names ? [{ defaultSubscriptionCount: names.length, Cst_CompanyName: names }] : [];
        }
        return null;
    });
});

describe('GET /api/v1/freeCompanyCount/:userId', () => {
    const lookup = (userId) => app.call('GET', `/api/v1/freeCompanyCount/${userId}`, { token: signSession(CALLER, [COMPANY]) });

    it('answers for a user of another company exactly as for an unknown user', async () => {
        const outsider = await lookup(OUTSIDER);
        const unknown = await lookup(UNKNOWN);

        expect(outsider.status).toBe(unknown.status);
        expect(outsider.body).toEqual(unknown.body);
        expect(JSON.stringify(outsider.body)).not.toContain('Elsewhere');
    });

    it('still answers the caller about their own companies', async () => {
        const own = await lookup(CALLER);

        expect(own.status).toBe(200);
        expect(own.body).toMatchObject({ status: true, isFree: true, companies: ['Caller Co'] });
    });
});

describe('POST /api/v2/company/create', () => {
    const create = (body) => app.call('POST', '/api/v2/company/create', { token: signSession(CALLER, [COMPANY]), body });
    const baseBody = { companyName: 'Fresh Co', logtimeDays: 8, eventId: 'ev_test' };
    const savedCompany = () => MongoDbCrudOpration.mock.calls.find(([, obj, method]) => obj.type === dbCollections.COMPANIES && method === 'save')[1].data;
    const assignedUser = () => String(MongoDbCrudOpration.mock.calls.find(([, obj, method]) => obj.type === dbCollections.USERS && method === 'findOneAndUpdate')[1].data[0]._id);

    it('creates the company for the signed-in caller, whatever user and email the body names', async () => {
        const res = await create({
            ...baseBody, userId: OUTSIDER, email: 'someone@elsewhere.test',
            totalProjects: 0, isInactive: false, isFree: true,
            subscriptionData: { storage: 0, trackers: 0, users: 5 }, totalData: { storage: 0, trackers: 0, users: 1 },
        });

        expect(res.body).toMatchObject({ status: true, companyId: NEW_COMPANY });
        expect(savedCompany().userId).toBe(CALLER);
        expect(assignedUser()).toBe(CALLER);
        expect(importSettingsV2Function.mock.calls.at(-1)[0].body).toMatchObject({ uid: CALLER, email: CALLER_EMAIL });
    });

    it('sets the plan and billing fields itself', async () => {
        const res = await create({
            ...baseBody, userId: CALLER, email: CALLER_EMAIL,
            totalProjects: 999, isInactive: true, isFree: false,
            subscriptionData: { storage: 1e6, trackers: 1e6, users: 1e6 }, totalData: { storage: 0, trackers: 0, users: 0 },
        });

        expect(res.body.status).toBe(true);
        expect(savedCompany()).toMatchObject({
            totalProjects: 0, isInactive: false, isFree: true,
            subscriptionData: { storage: 0, trackers: 0, users: 5 }, totalData: { storage: 0, trackers: 0, users: 1 },
        });
    });

    it('needs no user, email or plan fields in the body', async () => {
        const res = await create(baseBody);

        expect(res.body).toMatchObject({ status: true, companyId: NEW_COMPANY });
        expect(savedCompany().userId).toBe(CALLER);
    });
});

describe('GET /api/v1/wasabi/retriveUserProfile/:companyId/:path', () => {
    it('lets no shared cache keep the signed address it answers with', async () => {
        const wasabi = require('../Modules/storage/wasabi/controller');
        const path = `${CALLER}_1_photo.png`;
        myCache.set(`imageExists:${path}`, 'https://signed.example/photo', 60);
        const headers = {};
        const res = { set: (key, value) => { headers[key] = value; }, send: jest.fn() };

        await wasabi.getUserProfilePresignedUrl({ params: { companyId: COMPANY, path } }, res);

        expect(res.send).toHaveBeenCalledWith(expect.objectContaining({ status: true }));
        expect(headers['Cache-Control']).toMatch(/^private\b/);
    });
});

describe('verifyCompanyMembership', () => {
    const { verifyCompanyMembership } = require('../Config/jwt');
    const OTHER_COMPANY = '6f0000000000000000000c02';
    let seats;
    const membershipReads = () => MongoDbCrudOpration.mock.calls.map(([db, obj]) => `${db}/${obj.type}`);

    beforeEach(() => {
        seats = new Set();
        MongoDbCrudOpration.mockImplementation(async (db, obj) => {
            const filter = obj.data[0];
            if (obj.type === dbCollections.USERS) return String(filter._id) === CALLER && filter.AssignCompany === COMPANY ? { _id: CALLER } : null;
            if (obj.type === dbCollections.COMPANY_USERS) return seats.has(`${db}:${filter.userId}`) && filter.status === 2 ? { _id: 'seat' } : null;
            return null;
        });
    });

    it('needs an active seat as well as the listed company', async () => {
        expect(await verifyCompanyMembership(CALLER, COMPANY)).toBe(false);
        myCache.flushAll();
        seats.add(`${COMPANY}:${CALLER}`);
        expect(await verifyCompanyMembership(CALLER, COMPANY)).toBe(true);
    });

    it('reads nothing more once the answer is cached', async () => {
        seats.add(`${COMPANY}:${CALLER}`);
        await verifyCompanyMembership(CALLER, COMPANY);
        const first = membershipReads().length;
        await verifyCompanyMembership(CALLER, COMPANY);
        await verifyCompanyMembership(CALLER, COMPANY);

        expect(first).toBe(2);
        expect(membershipReads()).toHaveLength(first);
    });

    it('opens no company database for a company the account does not list', async () => {
        expect(await verifyCompanyMembership(CALLER, OTHER_COMPANY)).toBe(false);
        expect(membershipReads()).toEqual([`global/${dbCollections.USERS}`]);
    });
});
