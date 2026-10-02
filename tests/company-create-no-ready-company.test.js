process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));
jest.mock('../event/socketEventEmitter', () => ({}));
jest.mock('../Modules/ImportSettings/controller.js', () => ({
    importSettingsFunction: jest.fn((req, cb) => cb({ status: true })),
    importSettingsV2Function: jest.fn((req, cb) => cb({ status: true })),
}));
jest.mock('../Modules/notification/defaults', () => ({ ensureNotificationDefaults: jest.fn(async () => {}) }));
jest.mock('../Modules/Knowledge/vectorStore', () => ({ prepareCompany: jest.fn() }));
jest.mock('../Modules/Auth/controller/helper.js', () => ({}));
jest.mock('../Modules/Auth/controller.js', () => ({ addAndRemoveUserInMongodbNotificationCount: jest.fn(async () => {}) }));
jest.mock('../Modules/Company/eventController.js', () => ({ emitListener: jest.fn() }));
jest.mock('../Modules/service.js', () => ({ sendAttachMail: jest.fn() }));
jest.mock('../Modules/Affiliate/controller.js', () => ({ storeRefferalCode: jest.fn(async () => {}), checkAndStoreRefferalCode: jest.fn(async () => {}) }));
jest.mock('../common-storage/common-server.js', () => ({ handleCreateCompanyDataStorageFunForUpload: jest.fn(async () => {}), handleCreateCompanyDataStorageFun: jest.fn(async () => {}) }));
jest.mock('../Modules/createProject/sampleProject.js', () => ({ seedSampleProject: jest.fn(async () => {}) }));
jest.mock('../Modules/projectTabs/catalogue.js', () => ({ ensureViewCatalogue: jest.fn(async () => {}) }));

const mongoose = require('mongoose');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { myCache } = require('../Config/config');
const { dbCollections } = require('../Config/collections');
const { setMiddlewareV2, setMiddlewareWithCV2 } = require('../Config/setMiddleware');
const { signSession, startApp } = require('./fixtures/sessionApp');
const { importSettingsFunction } = require('../Modules/ImportSettings/controller.js');
const { handleCreateCompanyDataStorageFun } = require('../common-storage/common-server.js');
const { emitListener } = require('../Modules/Company/eventController.js');
const companyCtrl = require('../Modules/Company/controller');

const COMPANY = '6f0000000000000000000c01';
const CALLER = '6f0000000000000000000001';
const READY = '6f0000000000000000000c78';
const MADE_NOW = '6f0000000000000000000c99';

let app;
let readyCompany;
let saved;
const previousFreeCount = process.env.FREE_COMPANY_COUNT;

beforeAll(async () => {
    process.env.FREE_COMPANY_COUNT = '-1';
    app = await startApp((server) => {
        setMiddlewareWithCV2(server);
        setMiddlewareV2(server);
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
    readyCompany = null;
    saved = [];
    emitListener.mockClear();
    handleCreateCompanyDataStorageFun.mockClear();
    importSettingsFunction.mockReset();
    importSettingsFunction.mockImplementation((req, cb) => cb({ status: true }));
    MongoDbCrudOpration.mockReset();
    MongoDbCrudOpration.mockImplementation(async (db, obj, method) => {
        if (obj.type === dbCollections.USERS && method === 'findOne') {
            return String(obj.data[0]._id) === CALLER ? { _id: CALLER, Employee_Email: 'caller@own.test', AssignCompany: [COMPANY] } : null;
        }
        if (obj.type === dbCollections.PRECOMPANIES && method === 'findOneAndUpdate') return readyCompany;
        if (method === 'save') {
            saved.push({ db, type: obj.type, data: obj.data });
            return obj.type === dbCollections.PRECOMPANIES ? { ...obj.data, _id: new mongoose.Types.ObjectId(MADE_NOW) } : obj.data;
        }
        if (obj.type === dbCollections.USERS && method === 'findOneAndUpdate') return { _id: obj.data[0]._id };
        return null;
    });
});

const create = (body = {}) => app.call('POST', '/api/v2/company/create', {
    token: signSession(CALLER, [COMPANY]),
    body: { companyName: 'Fresh Co', logtimeDays: 8, eventId: 'ev_test', ...body },
});
const stopEvents = () => emitListener.mock.calls.filter(([, data]) => data.step === 'STOP').map(([, data]) => data);

describe('POST /api/v2/company/create with no ready-made company', () => {
    it('makes the workspace on the spot, on a server whose ready-made companies were never filled', async () => {
        const res = await create();

        expect(res.body).toMatchObject({ status: true, companyId: MADE_NOW });
        expect(handleCreateCompanyDataStorageFun).toHaveBeenCalledWith({}, MADE_NOW);
        expect(importSettingsFunction).toHaveBeenCalledTimes(1);
        expect(importSettingsFunction.mock.calls[0][0].body).toMatchObject({ companyId: MADE_NOW, isFromBackend: true });
        expect(saved.find((row) => row.type === dbCollections.COMPANIES).data).toMatchObject({ Cst_CompanyName: 'Fresh Co', userId: CALLER });
        expect(stopEvents()).toEqual([{ step: 'STOP', companyId: MADE_NOW }]);
    });

    it('never offers the company it is making to another sign-up', async () => {
        await create();

        const reserved = saved.filter((row) => row.type === dbCollections.PRECOMPANIES);
        expect(reserved).toHaveLength(1);
        expect(reserved[0]).toMatchObject({ db: 'global', data: { isAvailable: false, pickupCount: 1 } });
    });

    it('says in plain words why, on the reply and on the progress stream, when the workspace cannot be prepared', async () => {
        importSettingsFunction.mockImplementation((req, cb) => cb({ status: false }));

        const res = await create();

        expect(res.body.status).toBe(false);
        expect(res.body.statusText).toBe('The server could not set up the workspace\'s storage and starting settings.');
        expect(stopEvents()).toEqual([{ step: 'STOP', error: 'The server could not set up the workspace\'s storage and starting settings.' }]);
        expect(saved.some((row) => row.type === dbCollections.COMPANIES)).toBe(false);
    });

    it('still takes a ready-made company when there is one, without preparing another', async () => {
        readyCompany = { _id: new mongoose.Types.ObjectId(READY) };

        const res = await create();

        expect(res.body).toMatchObject({ status: true, companyId: READY });
        expect(importSettingsFunction).not.toHaveBeenCalled();
        expect(saved.some((row) => row.type === dbCollections.PRECOMPANIES)).toBe(false);
    });
});
