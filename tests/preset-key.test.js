jest.mock('../Modules/Instance/guard', () => ({ requireInstanceAdmin: jest.fn() }));
jest.mock('../Config/config.js', () => ({ PRECOMPANYKEY: 'preset-secret' }));
jest.mock('../middlewares/mongoConnector/helper.js', () => ({ connections: [] }));
jest.mock('../Modules/common/controller.js', () => ({ versionUpdateNotifyToClient: jest.fn() }));
jest.mock('../Modules/Company/controller2.js', () => ({ preCompanySetup: jest.fn() }));

const fs = require('fs');
const { preCompanySetup } = require('../Modules/Company/controller2.js');

const handlers = {};
beforeAll(() => {
    jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    const app = { get: (p, h) => { handlers[`GET ${p}`] = h; }, post: (p, ...h) => { handlers[`POST ${p}`] = h[h.length - 1]; } };
    require('../Modules/common/routes').init(app);
});
afterAll(() => jest.restoreAllMocks());

const call = (route, req) => {
    const res = { code: 200 };
    res.status = (c) => { res.code = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    res.send = res.json;
    handlers[route](req, res);
    return res;
};

const blank = { headers: {}, params: {}, query: {}, body: {} };
const connections = (req) => call('GET /connections', { ...blank, ...req });
const preset = (req) => call('POST /api/v1/setPresetCompany', { ...blank, ...req });

beforeEach(() => preCompanySetup.mockClear());

describe('QA-13 the preset key never travels in the URL', () => {
    it('reads the connection list when the key comes in a header', () => {
        const res = connections({ headers: { 'x-preset-key': 'preset-secret' } });
        expect(res.code).toBe(200);
        expect(res.body).toMatchObject({ total: 0, data: [] });
    });

    it('refuses the connection list without the header', () => {
        expect(connections({}).code).toBe(401);
    });

    it('refuses the connection list with the wrong key', () => {
        expect(connections({ headers: { 'x-preset-key': 'nope' } }).code).toBe(401);
    });

    it('starts the preset company when the key comes in a header', () => {
        const res = preset({ headers: { 'x-preset-key': 'preset-secret' } });
        expect(res.code).toBe(200);
        expect(preCompanySetup).toHaveBeenCalled();
    });

    it('starts the preset company when the key comes in the body', () => {
        expect(preset({ body: { presetKey: 'preset-secret' } }).code).toBe(200);
        expect(preCompanySetup).toHaveBeenCalled();
    });

    it('refuses the preset company without a key', () => {
        expect(preset({}).code).toBe(401);
        expect(preCompanySetup).not.toHaveBeenCalled();
    });

    it('never accepts the key from the query string', () => {
        expect(connections({ query: { id: 'preset-secret' } }).code).toBe(401);
        expect(preset({ query: { id: 'preset-secret' } }).code).toBe(401);
        expect(preCompanySetup).not.toHaveBeenCalled();
    });

    it('answers the old key-in-path shape with guidance and never runs the setup', () => {
        const old = call('GET /connections/:id', { ...blank, params: { id: 'preset-secret' } });
        expect(old.code).toBe(400);
        expect(String(old.body.message)).toMatch(/x-preset-key/);
        const oldPreset = call('GET /api/v1/setPresetCompany/:id', { ...blank, params: { id: 'preset-secret' } });
        expect(oldPreset.code).toBe(400);
        expect(preCompanySetup).not.toHaveBeenCalled();
    });
});
