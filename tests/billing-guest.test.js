jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn() }));

const { getRoleType } = require('../Config/permissionGuard');
const { refuseGuest } = require('../Modules/Milestone/controller/billing');

const COMPANY = '6a9954186dd786246031e47b';
const USER = '6a9954186dd786246031e47c';

const call = async (roleType) => {
    getRoleType.mockResolvedValueOnce(roleType);
    const res = { send: jest.fn() };
    const refused = await refuseGuest({ headers: { companyid: COMPANY }, uid: USER, body: {}, query: {} }, res);
    return { refused, res };
};

beforeEach(() => jest.clearAllMocks());

describe('billing refuseGuest', () => {
    it('refuses the seeded guest role (0)', async () => {
        const { refused, res } = await call(0);
        expect(refused).toBe(true);
        expect(res.send).toHaveBeenCalledWith(expect.objectContaining({ status: false }));
        expect(getRoleType).toHaveBeenCalledWith(COMPANY, USER);
    });

    it.each([1, 2, 3])('lets roleType %s through', async (roleType) => {
        const { refused, res } = await call(roleType);
        expect(refused).toBe(false);
        expect(res.send).not.toHaveBeenCalled();
    });

    it('lets a caller who is not a member of the company through to the endpoint checks', async () => {
        const { refused } = await call(null);
        expect(refused).toBe(false);
    });

    it('does not treat the retired value 4 as a guest', async () => {
        const { refused } = await call(4);
        expect(refused).toBe(false);
    });
});
