const mockDbs = {};
const mockDbFor = (companyId) => { mockDbs[companyId] = mockDbs[companyId] || require('./fixtures/fakeMongo').create(); return mockDbs[companyId]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn(), recordAudit: jest.fn() }));

const dns = require('dns');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { myCache } = require('../Config/config');
const instance = require('../Modules/Instance/controller');
const ssoConfig = require('../Modules/SSO/config');

const A = '6f00000000000000000008a0';
const B = '6f00000000000000000008b0';
const OWNER = '6f00000000000000000008e1';
const TOKEN = 'b'.repeat(40);

const oidc = { issuer: 'https://idp.acme.test', clientId: 'acme-client-id', clientSecret: 'acme-secret' };
const verified = [{ domain: 'acme.test', verifiedAt: new Date('2026-09-01T00:00:00Z') }];

const seedConfig = (companyId, over = {}) => mockDbFor(companyId).seed(SCHEMA_TYPE.SSO_CONFIGS, {
    provider: 'oidc', oidc, isEnabled: true, deletedStatusKey: 0, displayName: 'Acme SSO',
    domains: ['acme.test'], domainVerificationToken: TOKEN, verifiedDomains: verified, ...over,
});

const publicConfig = async () => {
    const res = { code: 200 };
    res.status = (c) => { res.code = c; return res; };
    res.send = (b) => { res.body = b; return res; };
    await instance.publicConfig({}, res);
    return res.body;
};
const sso = async () => (await publicConfig()).data.auth.sso;

const asOwner = async (handler, body) => {
    const res = { code: 200 };
    res.status = (c) => { res.code = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    res.send = res.json;
    await handler({ uid: OWNER, headers: { companyid: A }, body, query: {} }, res);
    return res.body;
};
const saveConfig = (over = {}) => asOwner(ssoConfig.setSsoConfig, { provider: 'oidc', oidc, isEnabled: true, domains: ['acme.test'], ...over });

let resolveTxt;
const envBefore = process.env.SSO_LOGIN_ENABLED;

beforeEach(() => {
    myCache.flushAll();
    Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
    delete process.env.SSO_LOGIN_ENABLED;
    const global = mockDbFor(dbCollections.GLOBAL);
    global.seed(dbCollections.COMPANIES, { _id: A, Cst_CompanyName: 'Acme', isDisable: false });
    global.seed(dbCollections.COMPANIES, { _id: B, Cst_CompanyName: 'Beta', isDisable: false });
    mockDbFor(A).seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false, userEmail: 'owner@acme.test' });
    resolveTxt = jest.spyOn(dns.promises, 'resolveTxt').mockRejectedValue(Object.assign(new Error('queryTxt ENOTFOUND'), { code: 'ENOTFOUND' }));
});

afterEach(() => resolveTxt.mockRestore());

afterAll(() => {
    if (envBefore === undefined) delete process.env.SSO_LOGIN_ENABLED;
    else process.env.SSO_LOGIN_ENABLED = envBefore;
});

describe('whether the public config offers SSO', () => {
    it('says no when no workspace has an SSO connection', async () => {
        expect(await sso()).toBe(false);
    });

    it('says no when every connection is disabled or deleted', async () => {
        seedConfig(A, { isEnabled: false });
        seedConfig(B, { deletedStatusKey: 1 });
        expect(await sso()).toBe(false);
    });

    it('says no for an enabled connection with no verified domain, which discovery could never find', async () => {
        seedConfig(A, { verifiedDomains: [] });
        expect(await sso()).toBe(false);
    });

    it('says yes when one workspace has an enabled connection', async () => {
        seedConfig(B);
        expect(await sso()).toBe(true);
    });

    it('says no for a disabled workspace, which discovery skips', async () => {
        mockDbFor(dbCollections.GLOBAL).store[dbCollections.COMPANIES].forEach((c) => { c.isDisable = true; });
        seedConfig(A);
        expect(await sso()).toBe(false);
    });

    it('still says no when the instance switched the button off', async () => {
        process.env.SSO_LOGIN_ENABLED = 'false';
        seedConfig(A);
        expect(await sso()).toBe(false);
    });

    it('answers a bare boolean, never a company, domain or provider', async () => {
        seedConfig(A);
        const body = await publicConfig();
        expect(body.data.auth.sso).toBe(true);
        const text = JSON.stringify(body);
        [A, 'acme.test', 'Acme', 'acme-client-id', 'acme-secret'].forEach((leak) => expect(text).not.toContain(leak));
    });
});

describe('the cached answer', () => {
    it('is reused rather than read again from every workspace', async () => {
        expect(await sso()).toBe(false);
        seedConfig(A);
        expect(await sso()).toBe(false);
    });

    it('is cleared when a connection is added', async () => {
        expect(await sso()).toBe(false);
        mockDbFor(A).seed(SCHEMA_TYPE.SSO_CONFIGS, { provider: 'oidc', oidc, isEnabled: true, deletedStatusKey: 0, domains: ['acme.test'], domainVerificationToken: TOKEN });
        resolveTxt.mockResolvedValue([[`alianhub-sso-verification=${TOKEN}`]]);

        expect((await asOwner(ssoConfig.verifySsoDomain, { domain: 'acme.test' })).status).toBe(true);

        expect(await sso()).toBe(true);
    });

    it('is cleared when a connection is saved enabled', async () => {
        expect(await sso()).toBe(false);
        mockDbFor(A).seed(SCHEMA_TYPE.SSO_CONFIGS, { provider: 'oidc', oidc, isEnabled: false, deletedStatusKey: 0, domains: ['acme.test'], domainVerificationToken: TOKEN, verifiedDomains: verified });

        expect((await saveConfig({ isEnabled: true })).status).toBe(true);

        expect(await sso()).toBe(true);
    });

    it('is cleared when the only connection is disabled', async () => {
        seedConfig(A);
        expect(await sso()).toBe(true);

        expect((await saveConfig({ isEnabled: false })).status).toBe(true);

        expect(await sso()).toBe(false);
    });
});
