jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => [{ _id: 'inv1' }]) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn(), recordAudit: jest.fn() }));

const express = require('express');

const KEY = 'r635-instance-admin-key';
const previousKey = process.env.INSTANCE_ADMIN_KEY;
let server;
let baseURL;

beforeAll(async () => {
    process.env.INSTANCE_ADMIN_KEY = KEY;
    const { setMiddlewareV2 } = require('../Config/setMiddleware');
    const app = express();
    app.use(express.json());
    setMiddlewareV2(app);
    require('../Modules/Invoice/routes').init(app);
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    baseURL = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
    if (previousKey === undefined) delete process.env.INSTANCE_ADMIN_KEY;
    else process.env.INSTANCE_ADMIN_KEY = previousKey;
    await new Promise((resolve) => server.close(resolve));
});

const find = (headers) => fetch(`${baseURL}/api/v1/invoice/find`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ findQuery: [{ $match: {} }, { $limit: 1 }] }),
});

describe('review 635: INSTANCE_ADMIN_KEY on POST /api/v1/invoice/find', () => {
    it('lets a script holding the key in, as on the instance console routes', async () => {
        const res = await find({ adminkey: KEY });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual([{ _id: 'inv1' }]);
    });

    it.each([
        ['no key and no session', {}],
        ['a wrong key', { adminkey: 'not-the-key' }],
        ['a forged session', { authorization: 'Bearer forged' }],
    ])('answers 401 to %s', async (label, headers) => {
        expect((await find(headers)).status).toBe(401);
    });
});
