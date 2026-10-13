process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';

const mockViewDbs = {};
const mockViewDbFor = (companyId) => { mockViewDbs[companyId] = mockViewDbs[companyId] || require('./fixtures/fakeMongo').create(); return mockViewDbs[companyId]; };

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

const mongoose = require('mongoose');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { myCache } = require('../Config/config');
const { dbCollections } = require('../Config/collections');
const { setMiddlewareV2, setMiddlewareWithCV2 } = require('../Config/setMiddleware');
const { signSession, startApp } = require('./fixtures/sessionApp');
const { seedSampleProject } = require('../Modules/createProject/sampleProject.js');
const companyCtrl = require('../Modules/Company/controller');

const COMPANY = '6f0000000000000000000c01';
const CALLER = '6f0000000000000000000001';
const PRESET = '6f0000000000000000000c78';
const T = dbCollections.PROJECT_TAB_COMPONENTS;

/* A preset company seeded before the catalogue import stopped wiping and refilling. */
const PRESET_ROWS = [
    { _id: '6a97261fb28e840202058560', keyName: 'ProjectListView', name: 'List', sortIndex: 1, value: 'list', setAsDefault: false, viewStatus: false },
    { _id: '6a97261fb28e840202058561', keyName: 'GanttView', name: 'Gantt View', sortIndex: 12, value: 'ganttview', setAsDefault: false, viewStatus: false },
];

const rows = () => mockViewDbFor(PRESET).store[T] || [];

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
    Object.keys(mockViewDbs).forEach((k) => { delete mockViewDbs[k]; });
    PRESET_ROWS.forEach((row) => mockViewDbFor(PRESET).seed(T, { ...row }));
    MongoDbCrudOpration.mockReset();
    MongoDbCrudOpration.mockImplementation(async (db, obj, method) => {
        if (obj.type === T) return mockViewDbFor(String(db)).crud(db, obj, method);
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

describe('POST /api/v2/company/create', () => {
    const create = (body) => app.call('POST', '/api/v2/company/create', { token: signSession(CALLER, [COMPANY]), body });

    it('completes the preset company catalogue to all 20 views, keeping the rows it had', async () => {
        const res = await create({ companyName: 'Fresh Co', logtimeDays: 8, eventId: 'ev_test' });

        expect(res.body).toMatchObject({ status: true, companyId: PRESET });
        expect(rows()).toHaveLength(20);
        expect(new Set(rows().map((row) => row.keyName)).size).toBe(20);
        PRESET_ROWS.forEach((row) => expect(rows().find((r) => r.keyName === row.keyName)._id).toBe(row._id));
    });

    it('has the catalogue in place before the sample project picks its views', async () => {
        let viewsAtSample = null;
        seedSampleProject.mockImplementation(async () => { viewsAtSample = rows().length; });

        await create({ companyName: 'Fresh Co', logtimeDays: 8, eventId: 'ev_test', teamFocus: 'software' });

        expect(viewsAtSample).toBe(20);
    });
});
