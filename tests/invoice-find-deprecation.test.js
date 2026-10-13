jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => []) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const logger = require('../Config/loggerConfig');
const { requireInstanceAdmin } = require('../Modules/Instance/guard');
const findCtrl = require('../Modules/Invoice/controller');
const routes = require('../Modules/Invoice/routes');

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    res.send = res.json;
    return res;
};

beforeEach(() => {
    jest.clearAllMocks();
});

describe('POST /api/v1/invoice/find, kept for the instance owner until it is removed', () => {
    it('stays behind the instance owner guard', () => {
        const app = { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
        routes.init(app);
        expect(app.post).toHaveBeenCalledWith('/api/v1/invoice/find', requireInstanceAdmin, findCtrl.getInvoice);
    });

    it('logs one deprecation line each time it is called', async () => {
        const res = response();
        await findCtrl.getInvoice({ headers: {}, body: { findQuery: [{ $match: {} }] } }, res);
        expect(res.statusCode).toBe(200);
        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.warn.mock.calls[0][0]).toMatch(/\/api\/v1\/invoice\/find.*deprecated/i);
        expect(logger.warn.mock.calls[0][0]).not.toMatch(/\n/);
    });

    it('logs the deprecation even when the query is refused', async () => {
        const res = response();
        await findCtrl.getInvoice({ headers: {}, body: {} }, res);
        expect(res.statusCode).toBe(400);
        expect(logger.warn).toHaveBeenCalledTimes(1);
    });
});
