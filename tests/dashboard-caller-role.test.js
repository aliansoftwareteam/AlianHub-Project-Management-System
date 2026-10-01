jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/settings/securityPermissions/controller', () => ({ fetchRules: jest.fn(async () => []) }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { resolveCallerRoleType, resolveVisibleProjectFilter } = require('../Modules/UserDashboard/controller');

const COMPANY = '6a9954186dd786246031e47b';
const USER = '6a9954186dd786246031e47c';

beforeEach(() => jest.clearAllMocks());

describe('dashboard resolveCallerRoleType', () => {
    it('keeps a guest (0) a guest instead of promoting them to member', async () => {
        MongoDbCrudOpration.mockResolvedValueOnce({ roleType: 0 });
        await expect(resolveCallerRoleType(COMPANY, USER)).resolves.toBe(0);
    });

    it.each([1, 2, 3])('returns the stored roleType %s', async (roleType) => {
        MongoDbCrudOpration.mockResolvedValueOnce({ roleType });
        await expect(resolveCallerRoleType(COMPANY, USER)).resolves.toBe(roleType);
    });

    it('fails closed to the guest role when the member row is missing', async () => {
        MongoDbCrudOpration.mockResolvedValueOnce(null);
        await expect(resolveCallerRoleType(COMPANY, USER)).resolves.toBe(0);
    });

    it('fails closed to the guest role when the stored value is not a role', async () => {
        MongoDbCrudOpration.mockResolvedValueOnce({ roleType: 'owner' });
        await expect(resolveCallerRoleType(COMPANY, USER)).resolves.toBe(0);
    });

    it('reads the role of an active seat only', async () => {
        MongoDbCrudOpration.mockResolvedValueOnce({ roleType: 2 });
        await resolveCallerRoleType(COMPANY, USER);
        const [companyId, { type, data }] = MongoDbCrudOpration.mock.calls[0];
        expect(companyId).toBe(COMPANY);
        expect(type).toBe(SCHEMA_TYPE.COMPANY_USERS);
        expect(data[0]).toEqual({ userId: USER, status: 2, isDelete: { $ne: true } });
    });

    it('fails closed to the guest role without a caller or on a lookup error', async () => {
        await expect(resolveCallerRoleType(COMPANY, '')).resolves.toBe(0);
        MongoDbCrudOpration.mockRejectedValueOnce(new Error('down'));
        await expect(resolveCallerRoleType(COMPANY, USER)).resolves.toBe(0);
    });
});

describe('dashboard resolveVisibleProjectFilter', () => {
    const NO_PROJECT = { _id: { $in: [] } };
    const TEAM = '6a9954186dd786246031e47d';
    const withSeat = (seat) => MongoDbCrudOpration.mockImplementation(async (_companyId, { type }) => (
        type === SCHEMA_TYPE.COMPANY_USERS ? seat : [{ _id: TEAM }]
    ));

    afterEach(() => MongoDbCrudOpration.mockReset());

    it('matches no project without an active seat', async () => {
        withSeat(null);
        await expect(resolveVisibleProjectFilter(COMPANY, USER)).resolves.toEqual(NO_PROJECT);
    });

    it('matches no project when the seat cannot be read', async () => {
        MongoDbCrudOpration.mockImplementation(async (_companyId, { type }) => {
            if (type === SCHEMA_TYPE.COMPANY_USERS) throw new Error('down');
            return [];
        });
        await expect(resolveVisibleProjectFilter(COMPANY, USER)).resolves.toEqual(NO_PROJECT);
    });

    it.each([1, 2])('leaves every project to role %s', async (roleType) => {
        withSeat({ roleType });
        await expect(resolveVisibleProjectFilter(COMPANY, USER)).resolves.toBeNull();
    });

    it.each([0, 3])('keeps role %s to the projects they or their teams are assigned to', async (roleType) => {
        withSeat({ roleType });
        const assigned = { $in: [USER, `tId_${TEAM}`] };
        await expect(resolveVisibleProjectFilter(COMPANY, USER)).resolves.toEqual({
            $or: [
                { isPrivateSpace: true, AssigneeUserId: assigned },
                { isPrivateSpace: false, AssigneeUserId: assigned },
            ],
        });
    });
});
