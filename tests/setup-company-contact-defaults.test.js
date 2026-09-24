process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../utils/data', () => ({ importUserNotifications: jest.fn(async () => undefined) }));
jest.mock('../Modules/Auth/controller/sendVerificationMail', () => ({ sendVerificationEmailPromise: jest.fn(async () => undefined) }));
jest.mock('../Modules/Auth/controller', () => ({ addAndRemoveUserInMongodbNotificationCount: jest.fn(async () => undefined), insertAuthFun: jest.fn() }));
jest.mock('../Modules/notification/defaults', () => ({ ensureNotificationDefaults: jest.fn() }));
jest.mock('../Modules/ImportSettings/controller', () => ({ importSettingsFunction: jest.fn((payload, cb) => cb({ status: true })) }));
jest.mock('../Modules/Company/controller/updateCompany', () => ({ updateCompanyFun: jest.fn() }));
jest.mock('../Modules/Users/controller', () => ({ updateUserFun: jest.fn() }));
jest.mock('../Modules/Affiliate/controller', () => ({ storeRefferalCode: jest.fn() }));
jest.mock('../Modules/Setup/demoProject', () => ({ createDemoProject: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => ({ handleCreateCompanyDataStorageFun: jest.fn() }));
jest.mock('../Modules/Knowledge/vectorStore', () => ({ prepareCompany: jest.fn() }));

const mongoose = require('mongoose');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { schema } = require('../utils/mongo-handler/schema');
const { createFirstCompany } = require('../Modules/Setup/createCompany');

beforeEach(() => {
    jest.clearAllMocks();
    MongoDbCrudOpration.mockImplementation(async (db, query, method) => (method === 'save' ? { ...query.data } : null));
});

it('the setup wizard stores the company phone, state and city empty rather than as placeholders', async () => {
    await createFirstCompany({ userId: '6f0000000000000000000001', email: 'owner@example.com', companyName: 'Acme', sampleData: false });
    const saved = MongoDbCrudOpration.mock.calls.find(([, query, method]) => method === 'save' && query.type === SCHEMA_TYPE.COMPANIES)[1].data;
    expect(saved).toMatchObject({ Cst_Phone: '', Cst_State: '', Cst_City: '' });
});

it('the company schema accepts a company with no phone, state or city', async () => {
    const Company = mongoose.model('CcfCompanyContact', new mongoose.Schema(schema.companies, { strict: true }));
    const company = new Company({
        Cst_CompanyName: 'Acme', Cst_Country: 'India', Cst_DialCode: { name: '' }, Cst_LogTimeDays: '8',
        Cst_Phone: '', Cst_State: '', Cst_City: '',
    });
    await expect(company.validate()).resolves.toBeUndefined();
});
