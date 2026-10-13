jest.mock('../Modules/Instance/guard', () => ({ requireInstanceAdmin: jest.fn() }));
jest.mock('../Config/config.js', () => ({ PRECOMPANYKEY: 'k' }));
jest.mock('../middlewares/mongoConnector/helper.js', () => ({ connections: [] }));
jest.mock('../Modules/common/controller.js', () => ({ versionUpdateNotifyToClient: jest.fn() }));

const fs = require('fs');

const handlers = {};
beforeAll(() => {
    jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    const app = { get: (p, h) => { handlers[`GET ${p}`] = h; }, post: (p, ...h) => { handlers[`POST ${p}`] = h; } };
    require('../Modules/common/routes').init(app);
});
afterAll(() => jest.restoreAllMocks());

const getTime = (query) => {
    const res = { code: 200 };
    res.status = (c) => { res.code = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    res.send = res.json;
    handlers['GET /api/v1/getTime']({ query }, res);
    return res;
};

describe('INS-12 GET /api/v1/getTime', () => {
    it('answers a missing zone with 400 and the standard error shape', () => {
        const res = getTime({});
        expect(res.code).toBe(400);
        expect(res.body).toMatchObject({ status: false, statusText: expect.any(String) });
    });

    it('answers an unknown zone with 400', () => {
        expect(getTime({ zone: 'Mars/Olympus' }).code).toBe(400);
    });

    it('answers a zone with the standard envelope', () => {
        const res = getTime({ zone: 'Asia/Kolkata' });
        expect(res.code).toBe(200);
        expect(res.body).toMatchObject({ status: true, data: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*\+05:30$/) });
    });
});
