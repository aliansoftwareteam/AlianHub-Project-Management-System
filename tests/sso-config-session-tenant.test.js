const mockDbs = {};
const mockDbFor = (companyId) => { mockDbs[companyId] = mockDbs[companyId] || require('./fixtures/fakeMongo').create(); return mockDbs[companyId]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn(), recordAudit: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const config = require('../Modules/SSO/config');

const COMPANY = '6f00000000000000000007c1';
const OTHER_COMPANY = '6f00000000000000000007c2';
const OWNER = '6f00000000000000000007a1';

const OIDC = { provider: 'oidc', oidc: { issuer: 'https://idp.acme.test', clientId: 'c', clientSecret: 's' }, isEnabled: true, domains: ['acme.test'] };

const call = async (handler, { uid = OWNER, headers = { companyid: COMPANY }, aud = `${COMPANY},${OTHER_COMPANY}`, body = {}, query = {} } = {}) => {
    const res = { code: 200 };
    res.status = (c) => { res.code = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    res.send = res.json;
    await handler({ uid, aud, headers, body, query }, res);
    return res;
};

const configOf = (companyId) => (mockDbFor(companyId).store[SCHEMA_TYPE.SSO_CONFIGS] || [])[0];

beforeEach(() => {
    Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
    for (const companyId of [COMPANY, OTHER_COMPANY]) {
        mockDbFor(companyId).seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
        mockDbFor(companyId).seed(SCHEMA_TYPE.SSO_CONFIGS, { ...OIDC, deletedStatusKey: 0, domainVerificationToken: `token-${companyId}` });
    }
});

describe('the SSO admin config takes the company from the verified request', () => {
    it('reads the header company for a normal call', async () => {
        const res = await call(config.getSsoConfig);

        expect(res.body.status).toBe(true);
        expect(res.body.data.domainVerificationToken).toBe(`token-${COMPANY}`);
    });

    it('refuses a read whose query names another company', async () => {
        const res = await call(config.getSsoConfig, { query: { companyId: OTHER_COMPANY } });

        expect(res.code).toBe(403);
        expect(res.body.data).toBeUndefined();
    });

    it('refuses a save whose body names another company and writes nothing', async () => {
        const res = await call(config.setSsoConfig, { body: { ...OIDC, displayName: 'Steered', companyId: OTHER_COMPANY } });

        expect(res.code).toBe(403);
        expect(configOf(COMPANY).displayName).toBeUndefined();
        expect(configOf(OTHER_COMPANY).displayName).toBeUndefined();
    });

    it('refuses a domain check whose body names another company', async () => {
        const res = await call(config.verifySsoDomain, { body: { domain: 'acme.test', companyId: OTHER_COMPANY } });

        expect(res.code).toBe(403);
    });

    it('saves into the header company for a normal call', async () => {
        const res = await call(config.setSsoConfig, { body: { ...OIDC, displayName: 'Acme' } });

        expect(res.body.status).toBe(true);
        expect(configOf(COMPANY).displayName).toBe('Acme');
    });
});

describe('the login page SSO lookup stays pre-session', () => {
    it('answers the company the login page names, without a session', async () => {
        const res = await call(config.getPublicSsoConfig, { uid: undefined, aud: undefined, headers: {}, query: { companyId: COMPANY } });

        expect(res.body.status).toBe(true);
        expect(res.body.data).toBeTruthy();
    });
});
