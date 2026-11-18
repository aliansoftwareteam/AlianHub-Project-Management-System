jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));
jest.mock('../Modules/service.js', () => ({}));
jest.mock('../Modules/Company/eventController.js', () => ({ emitListener: jest.fn() }));
jest.mock('../Modules/Company/controller/updateCompany.js', () => ({ updateCompanyFun: jest.fn() }));
jest.mock('../Modules/settings/Members/controller.js', () => ({ updateMemberFunction: jest.fn() }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { myCache } = require('../Config/config');
const { setMiddlewareWithCV2 } = require('../Config/setMiddleware');
const { signSession, startApp } = require('./fixtures/sessionApp');
const invitation = require('../Modules/Auth/controller/sendInvitation');

const COMPANY = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const MEMBER = '6f0000000000000000000003';

let app;

beforeAll(async () => {
    app = await startApp((server) => {
        setMiddlewareWithCV2(server);
        server.post('/api/v1/checkSendInviatation', invitation.checkSendInviatation);
    });
});
afterAll(() => app.close());

beforeEach(() => {
    myCache.flushAll();
    MongoDbCrudOpration.mockReset();
    MongoDbCrudOpration.mockImplementation(async () => ({ status: 2, isDelete: false }));
});

describe('ACC-09 POST /api/v1/checkSendInviatation', () => {
    const check = (options) => app.call('POST', '/api/v1/checkSendInviatation', options);

    it('refuses an anonymous membership probe', async () => {
        const res = await check({ companyId: COMPANY, body: { email: 'someone@example.com', companyId: COMPANY } });
        expect(res.status).toBe(401);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('refuses probing a company other than the signed-in one', async () => {
        const res = await check({ token: signSession(MEMBER, [COMPANY]), companyId: COMPANY, body: { email: 'someone@example.com', companyId: OTHER_COMPANY } });
        expect(res.status).toBe(403);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('answers a signed-in member for their own company', async () => {
        const res = await check({ token: signSession(MEMBER, [COMPANY]), companyId: COMPANY, body: { email: 'someone@example.com', companyId: COMPANY } });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: true, furtherProceed: false });
        expect(MongoDbCrudOpration.mock.calls[0][0]).toBe(COMPANY);
    });
});
