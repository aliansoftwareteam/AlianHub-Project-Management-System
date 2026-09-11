jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/settings/securityPermissions/controller', () => ({ fetchRules: jest.fn(async () => []) }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { resolveCallerRoleType } = require('../Modules/UserDashboard/controller');

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

    it('fails closed to the guest role without a caller or on a lookup error', async () => {
        await expect(resolveCallerRoleType(COMPANY, '')).resolves.toBe(0);
        MongoDbCrudOpration.mockRejectedValueOnce(new Error('down'));
        await expect(resolveCallerRoleType(COMPANY, USER)).resolves.toBe(0);
    });
});
