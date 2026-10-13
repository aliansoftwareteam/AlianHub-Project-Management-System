process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../utils/data', () => ({ importUserNotifications: jest.fn(async () => undefined) }));
jest.mock('../Modules/Auth/controller/sendVerificationMail', () => ({ storeVerificationToken: jest.fn(async () => 'token'), mailVerificationLink: jest.fn(async () => undefined) }));
jest.mock('../Modules/Auth/controller', () => ({ addAndRemoveUserInMongodbNotificationCount: jest.fn(async () => undefined), insertAuthFun: jest.fn() }));
jest.mock('../Modules/notification/defaults', () => ({ ensureNotificationDefaults: jest.fn(async () => undefined) }));
jest.mock('../Modules/ImportSettings/controller', () => ({ importSettingsFunction: jest.fn() }));
jest.mock('../Modules/Company/controller/updateCompany', () => ({ updateCompanyFun: jest.fn(async () => ({})) }));
jest.mock('../Modules/Users/controller', () => ({ updateUserFun: jest.fn(async () => ({})) }));
jest.mock('../Modules/Affiliate/controller', () => ({ storeRefferalCode: jest.fn(async () => undefined) }));
jest.mock('../Modules/Setup/demoProject', () => ({ createDemoProject: jest.fn(async () => undefined) }));
jest.mock('../common-storage/common-server.js', () => ({ handleCreateCompanyDataStorageFun: jest.fn() }));
jest.mock('../Modules/Knowledge/vectorStore', () => ({ prepareCompany: jest.fn() }));
jest.mock('../Modules/projectTabs/catalogue', () => ({ ensureViewCatalogue: jest.fn(async () => undefined) }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { importSettingsFunction } = require('../Modules/ImportSettings/controller');
const { addAndRemoveUserInMongodbNotificationCount } = require('../Modules/Auth/controller');
const { ensureNotificationDefaults } = require('../Modules/notification/defaults');
const { updateCompanyFun } = require('../Modules/Company/controller/updateCompany');
const { updateUserFun } = require('../Modules/Users/controller');
const { handleCreateCompanyDataStorageFun } = require('../common-storage/common-server.js');
const { createFirstCompany } = require('../Modules/Setup/createCompany');

const OWNER = '6f0000000000000000000001';
const setUp = () => createFirstCompany({ userId: OWNER, email: 'owner@example.com', companyName: 'Acme', sampleData: false });
const savedCompany = () => MongoDbCrudOpration.mock.calls.find(([, query, method]) => method === 'save' && query.type === SCHEMA_TYPE.COMPANIES)[1].data;
const companyTakenBack = () => updateCompanyFun.mock.calls.filter(([, , method]) => method === 'deleteOne').map(([, query]) => query.data[0]);
const ownerGivenTheCompany = () => updateUserFun.mock.calls.some(([, query]) => Boolean(query.data[1].$push));

beforeEach(() => {
    jest.clearAllMocks();
    MongoDbCrudOpration.mockImplementation(async (db, query, method) => (method === 'save' ? { ...query.data } : null));
    importSettingsFunction.mockImplementation((payload, cb) => cb({ status: true }));
    handleCreateCompanyDataStorageFun.mockResolvedValue();
    addAndRemoveUserInMongodbNotificationCount.mockResolvedValue();
    ensureNotificationDefaults.mockResolvedValue();
});

describe('the first company, made by the setup wizard', () => {
    it('is made whole when every step works', async () => {
        const companyId = await setUp();

        expect(companyId).toBe(String(savedCompany()._id));
        expect(ownerGivenTheCompany()).toBe(true);
        expect(companyTakenBack()).toEqual([]);
    });

    it.each([
        ['the owner\'s seat and starting settings', () => importSettingsFunction.mockImplementation((payload, cb) => cb({ status: false, statusText: 'the import stopped' }))],
        ['its storage', () => handleCreateCompanyDataStorageFun.mockRejectedValue(new Error('no room'))],
    ])('is not reported as set up without %s: the row is taken back and the owner is not given the company', async (label, breakIt) => {
        breakIt();

        await expect(setUp()).rejects.toThrow(/could not be set up/);

        expect(companyTakenBack()).toEqual([{ _id: savedCompany()._id, userId: OWNER }]);
        expect(ownerGivenTheCompany()).toBe(false);
    });

    it.each([
        ['the unread counter row', () => addAndRemoveUserInMongodbNotificationCount.mockRejectedValue(new Error('no counter'))],
        ['the notification defaults', () => ensureNotificationDefaults.mockRejectedValue(new Error('no defaults'))],
    ])('still opens without %s', async (label, breakIt) => {
        breakIt();

        await expect(setUp()).resolves.toBe(String(savedCompany()._id));

        expect(ownerGivenTheCompany()).toBe(true);
        expect(companyTakenBack()).toEqual([]);
    });
});
