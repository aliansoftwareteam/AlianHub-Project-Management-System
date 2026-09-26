/* A new tenant has its vector index prepared as it is created, without the setup waiting on it:
 * a hosted store that is slow or down must not hold up or fail the first company. */
process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../utils/data', () => ({ importUserNotifications: jest.fn(async () => undefined) }));
jest.mock('../Modules/Auth/controller/sendVerificationMail', () => ({ storeVerificationToken: jest.fn(async () => 'token'), mailVerificationLink: jest.fn(async () => undefined) }));
jest.mock('../Modules/Auth/controller', () => ({ addAndRemoveUserInMongodbNotificationCount: jest.fn(async () => undefined), insertAuthFun: jest.fn() }));
jest.mock('../Modules/notification/defaults', () => ({ ensureNotificationDefaults: jest.fn() }));
jest.mock('../Modules/ImportSettings/controller', () => ({ importSettingsFunction: jest.fn((payload, cb) => cb({ status: true })) }));
jest.mock('../Modules/Company/controller/updateCompany', () => ({ updateCompanyFun: jest.fn() }));
jest.mock('../Modules/Users/controller', () => ({ updateUserFun: jest.fn() }));
jest.mock('../Modules/Affiliate/controller', () => ({ storeRefferalCode: jest.fn() }));
jest.mock('../Modules/Setup/demoProject', () => ({ createDemoProject: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => ({ handleCreateCompanyDataStorageFun: jest.fn() }));
jest.mock('../Modules/Knowledge/vectorStore', () => ({ prepareCompany: jest.fn() }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const vectorStore = require('../Modules/Knowledge/vectorStore');
const { createFirstCompany } = require('../Modules/Setup/createCompany');

beforeEach(() => {
    jest.clearAllMocks();
    MongoDbCrudOpration.mockImplementation(async (db, query, method) => (method === 'save' ? { ...query.data } : null));
});

it('prepares the vector store for the new company and does not wait for it', async () => {
    vectorStore.prepareCompany.mockImplementation(() => new Promise(() => {}));
    const companyId = await createFirstCompany({ userId: '6f0000000000000000000001', email: 'owner@example.com', companyName: 'Acme', sampleData: false });
    expect(vectorStore.prepareCompany).toHaveBeenCalledWith(companyId);
});
