const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Auth/controller/authHelpers', () => ({ addAndRemoveUserInMongodbNotificationCount: jest.fn(async () => {}) }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { verifyCompanyMembership } = require('../Config/jwt');
const scim = require('../Modules/Scim/provisioning');

const C = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const MEMBER = '6f0000000000000000000a01';
const OTHER_MEMBER = '6f0000000000000000000a02';

const seedMember = (userId) => {
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: new mongoose.Types.ObjectId(userId), AssignCompany: C, Employee_Email: `${userId}@e2e.test` });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType: 3, status: 2, isDelete: false, userEmail: `${userId}@e2e.test` });
};

beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    seedMember(MEMBER);
    seedMember(OTHER_MEMBER);
});

describe('a member deactivated through provisioning', () => {
    it('stops passing the live membership check on the next request', async () => {
        expect(await verifyCompanyMembership(MEMBER, C)).toBe(true);

        await scim.setActive(C, MEMBER, false);

        expect(await verifyCompanyMembership(MEMBER, C)).toBe(false);
    });

    it('passes it again on the next request once reactivated', async () => {
        await scim.setActive(C, MEMBER, false);
        expect(await verifyCompanyMembership(MEMBER, C)).toBe(false);

        await scim.setActive(C, MEMBER, true);

        expect(await verifyCompanyMembership(MEMBER, C)).toBe(true);
    });

    it('leaves the cached membership of other members and other companies alone', async () => {
        expect(await verifyCompanyMembership(OTHER_MEMBER, C)).toBe(true);
        myCache.set(`membership:${MEMBER}:${OTHER_COMPANY}`, true, 60);

        await scim.setActive(C, MEMBER, false);

        expect(myCache.get(`membership:${OTHER_MEMBER}:${C}`)).toBe(true);
        expect(myCache.get(`membership:${MEMBER}:${OTHER_COMPANY}`)).toBe(true);
    });
});
