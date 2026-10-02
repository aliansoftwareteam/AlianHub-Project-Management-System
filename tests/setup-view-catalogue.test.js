process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';

const mockDbs = {};
const mockDbFor = (companyId) => { mockDbs[companyId] = mockDbs[companyId] || require('./fixtures/fakeMongo').create(); return mockDbs[companyId]; };

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn((companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method)) }));
jest.mock('../utils/data', () => ({ importUserNotifications: jest.fn(async () => undefined) }));
jest.mock('../Modules/Auth/controller/sendVerificationMail', () => ({ storeVerificationToken: jest.fn(async () => 'token'), mailVerificationLink: jest.fn(async () => undefined) }));
jest.mock('../Modules/Auth/controller', () => ({ addAndRemoveUserInMongodbNotificationCount: jest.fn(async () => undefined), insertAuthFun: jest.fn() }));
jest.mock('../Modules/notification/defaults', () => ({ ensureNotificationDefaults: jest.fn() }));
jest.mock('../Modules/ImportSettings/controller', () => ({ importSettingsFunction: jest.fn() }));
jest.mock('../Modules/Company/controller/updateCompany', () => ({ updateCompanyFun: jest.fn() }));
jest.mock('../Modules/Users/controller', () => ({ updateUserFun: jest.fn() }));
jest.mock('../Modules/Affiliate/controller', () => ({ storeRefferalCode: jest.fn() }));
jest.mock('../Modules/Setup/demoProject', () => ({ createDemoProject: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => ({ handleCreateCompanyDataStorageFun: jest.fn() }));
jest.mock('../Modules/Knowledge/vectorStore', () => ({ prepareCompany: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { importSettingsFunction } = require('../Modules/ImportSettings/controller');
const { createDemoProject } = require('../Modules/Setup/demoProject');
const { createFirstCompany } = require('../Modules/Setup/createCompany');

const T = SCHEMA_TYPE.PROJECT_TAB_COMPONENTS;
const rowsOf = (companyId) => mockDbFor(companyId).store[T] || [];

beforeEach(() => {
    Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
    jest.clearAllMocks();
});

describe('the setup wizard seeds the whole view catalogue', () => {
    it('stores all 20 views even when the settings import stored only some of them', async () => {
        importSettingsFunction.mockImplementation((payload, cb) => {
            mockDbFor(payload.body.companyId).seed(T, { keyName: 'ProjectListView', name: 'List' });
            mockDbFor(payload.body.companyId).seed(T, { keyName: 'ProjectKanban', name: 'Board' });
            cb({ status: true });
        });

        const companyId = await createFirstCompany({ userId: '6f0000000000000000000001', email: 'owner@example.com', companyName: 'Acme', sampleData: false });

        expect(rowsOf(companyId)).toHaveLength(20);
        expect(new Set(rowsOf(companyId).map((row) => row.keyName)).size).toBe(20);
    });

    it('has the catalogue in place before the sample project picks its views', async () => {
        importSettingsFunction.mockImplementation((payload, cb) => cb({ status: true }));
        let viewsAtSample = null;
        createDemoProject.mockImplementation(async (companyId) => { viewsAtSample = rowsOf(companyId).length; });

        await createFirstCompany({ userId: '6f0000000000000000000001', email: 'owner@example.com', companyName: 'Acme' });

        expect(viewsAtSample).toBe(20);
    });

    it('does not open a company whose settings import stopped: the catalogue alone does not make it usable', async () => {
        importSettingsFunction.mockImplementation((payload, cb) => cb({ status: false, statusText: 'Batch update stopped due to failure in batch 1' }));

        await expect(createFirstCompany({ userId: '6f0000000000000000000001', email: 'owner@example.com', companyName: 'Acme', sampleData: false }))
            .rejects.toThrow(/could not be set up/);
    });
});
