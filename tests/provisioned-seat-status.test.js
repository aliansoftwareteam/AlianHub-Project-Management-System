const mockDbs = {};
const mockDbFor = (companyId) => { mockDbs[companyId] = mockDbs[companyId] || require('./fixtures/fakeMongo').create(); return mockDbs[companyId]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Auth/controller/authHelpers', () => ({ addAndRemoveUserInMongodbNotificationCount: jest.fn(async () => {}) }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { SEAT_ACTIVE } = require('../Config/seatStatus');
const { getRoleType } = require('../Config/permissionGuard');
const { jitProvisionUser } = require('../Modules/SSO/provisioning');
const scim = require('../Modules/Scim/provisioning');

const COMPANY = '6f0000000000000000000c01';
const seats = () => mockDbFor(COMPANY).store[SCHEMA_TYPE.COMPANY_USERS] || [];

beforeEach(() => {
    Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
});

/* SSO and SCIM used to write status 1, which the invitation flow means as "invited, not accepted",
 * so a user provisioned that way would hold no role once a role needs a live seat. */
describe('a seat SSO or SCIM provisions', () => {
    it('is active, so the user holds the role it was given', async () => {
        const uid = await jitProvisionUser({ companyId: COMPANY, email: 'Jit@Example.test', firstName: 'Jit', defaultRoleType: 2 });
        expect(seats()[0]).toMatchObject({ status: SEAT_ACTIVE, roleType: 2 });
        expect(await getRoleType(COMPANY, String(uid).padStart(24, '0'))).toBe(2);
    });

    it('is active when SCIM creates it, and deactivating it takes the role away', async () => {
        const { uid } = await scim.provision(COMPANY, { email: 'scim@example.test', firstName: 'Scim', active: true, defaultRoleType: 3 });
        expect(seats()[0]).toMatchObject({ status: SEAT_ACTIVE, isDelete: false });

        await scim.setActive(COMPANY, uid, false);
        expect(seats()[0].isDelete).toBe(true);
        expect(await getRoleType(COMPANY, String(uid).padStart(24, '0'))).toBeNull();
    });
});
