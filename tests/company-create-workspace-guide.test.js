process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));
jest.mock('../event/socketEventEmitter', () => ({}));
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
jest.mock('../Modules/Agents/workspaceGuide', () => ({ onCompanyCreated: jest.fn(async () => ({})) }));

const mongoose = require('mongoose');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { myCache } = require('../Config/config');
const { dbCollections } = require('../Config/collections');
const { setMiddlewareV2, setMiddlewareWithCV2 } = require('../Config/setMiddleware');
const { signSession, startApp } = require('./fixtures/sessionApp');
const { onCompanyCreated } = require('../Modules/Agents/workspaceGuide');
const companyCtrl = require('../Modules/Company/controller');

const COMPANY = '6f0000000000000000000c01';
const CALLER = '6f0000000000000000000001';
const PRESET = '6f0000000000000000000c78';

let app;
const previousFreeCount = process.env.FREE_COMPANY_COUNT;

beforeAll(async () => {
    process.env.FREE_COMPANY_COUNT = '2';
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
    onCompanyCreated.mockClear();
    MongoDbCrudOpration.mockReset();
    MongoDbCrudOpration.mockImplementation(async (db, obj, method) => {
        if (obj.type === dbCollections.USERS && method === 'findOne') {
            return String(obj.data[0]._id) === CALLER ? { _id: CALLER, Employee_Email: 'caller@own.test', AssignCompany: [COMPANY] } : null;
        }
        if (obj.type === dbCollections.PRECOMPANIES && method === 'findOneAndUpdate') return { _id: new mongoose.Types.ObjectId(PRESET) };
        if (method === 'save') return obj.data;
        if (obj.type === dbCollections.USERS && method === 'findOneAndUpdate') return { _id: obj.data[0]._id };
        if (obj.type === dbCollections.COMPANIES && method === 'aggregate') return [];
        return null;
    });
});

describe('POST /api/v2/company/create and the Workspace Guide', () => {
    const create = () => app.call('POST', '/api/v2/company/create', { token: signSession(CALLER, [COMPANY]), body: { companyName: 'Fresh Co', logtimeDays: 8, eventId: 'ev_test' } });

    it('asks for the guide in the new company, for its owner', async () => {
        const res = await create();
        expect(res.body).toMatchObject({ status: true, companyId: PRESET });
        expect(onCompanyCreated).toHaveBeenCalledWith(PRESET, CALLER);
    });

    it('still finishes the workspace when the guide cannot be made', async () => {
        onCompanyCreated.mockRejectedValueOnce(new Error('db down'));
        const res = await create();
        expect(res.body).toMatchObject({ status: true, companyId: PRESET });
    });
});
