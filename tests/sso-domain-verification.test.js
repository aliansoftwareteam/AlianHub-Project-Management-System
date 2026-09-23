const mockDbs = {};
const mockDbFor = (companyId) => { mockDbs[companyId] = mockDbs[companyId] || require('./fixtures/fakeMongo').create(); return mockDbs[companyId]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn(), recordAudit: jest.fn() }));

const dns = require('dns');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { ssoConfigsSchema } = require('../utils/mongo-handler/createSchema');
const config = require('../Modules/SSO/config');

const COMPANY = '6f00000000000000000005c1';
const OWNER = '6f00000000000000000005a1';
const MEMBER = '6f00000000000000000005a3';

const configRow = () => (mockDbFor(COMPANY).store[SCHEMA_TYPE.SSO_CONFIGS] || [])[0];

const call = async (handler, { uid = OWNER, body = {} } = {}) => {
    const res = { code: 200 };
    res.status = (c) => { res.code = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    res.send = res.json;
    await handler({ uid, headers: { companyid: COMPANY }, body, query: {} }, res);
    return res;
};

const save = (domains, extra = {}) => call(config.setSsoConfig, {
    body: { provider: 'oidc', oidc: { issuer: 'https://idp.acme.test', clientId: 'c', clientSecret: 's' }, isEnabled: true, domains, ...extra },
});
const verify = (domain, uid) => call(config.verifySsoDomain, { uid, body: { domain } });
const recordFor = (res, domain) => res.body.data.domainRecords.find((r) => r.domain === domain);

let resolveTxt;

beforeEach(() => {
    Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
    mockDbFor(COMPANY).seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false, userEmail: 'owner@acme.test' });
    mockDbFor(COMPANY).seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: 3, status: 2, isDelete: false, userEmail: 'member@acme.test' });
    resolveTxt = jest.spyOn(dns.promises, 'resolveTxt').mockRejectedValue(Object.assign(new Error('queryTxt ENOTFOUND'), { code: 'ENOTFOUND' }));
});

afterEach(() => resolveTxt.mockRestore());

describe('the SSO config schema', () => {
    it('declares the verification token and the per-domain verification time', () => {
        expect(ssoConfigsSchema.path('domainVerificationToken')).toBeTruthy();
        const verified = ssoConfigsSchema.path('verifiedDomains');
        expect(verified).toBeTruthy();
        expect(verified.schema.path('domain')).toBeTruthy();
        expect(verified.schema.path('verifiedAt')).toBeTruthy();
    });
});

describe('saving the SSO config', () => {
    it('gives every listed domain a TXT record to publish, none of them verified yet', async () => {
        const res = await save(['acme.test', 'Other.Test ']);
        expect(res.body.status).toBe(true);
        const token = configRow().domainVerificationToken;
        expect(token).toMatch(/^[a-f0-9]{32,}$/);
        expect(recordFor(res, 'acme.test')).toEqual({
            domain: 'acme.test', name: '_alianhub-sso.acme.test', value: `alianhub-sso-verification=${token}`, verifiedAt: null, failedChecks: 0, lapsedAt: null,
        });
        expect(recordFor(res, 'other.test').name).toBe('_alianhub-sso.other.test');
        expect(configRow().verifiedDomains || []).toEqual([]);
    });

    it('keeps one token for the company across saves', async () => {
        await save(['acme.test']);
        const first = configRow().domainVerificationToken;
        await save(['acme.test', 'other.test']);
        expect(configRow().domainVerificationToken).toBe(first);
    });

    it('ignores verification state sent in the body', async () => {
        await save(['acme.test'], { verifiedDomains: [{ domain: 'acme.test', verifiedAt: new Date() }], domainVerificationToken: 'mine' });
        expect(configRow().verifiedDomains || []).toEqual([]);
        expect(configRow().domainVerificationToken).not.toBe('mine');
    });

    it('drops the verification of a domain that is removed, and keeps the others', async () => {
        await save(['acme.test', 'other.test']);
        resolveTxt.mockResolvedValue([[`alianhub-sso-verification=${configRow().domainVerificationToken}`]]);
        await verify('acme.test');
        await verify('other.test');

        await save(['other.test']);
        expect(configRow().verifiedDomains.map((d) => d.domain)).toEqual(['other.test']);

        await save(['other.test', 'acme.test']);
        expect(configRow().verifiedDomains.map((d) => d.domain)).toEqual(['other.test']);
    });

    it('lists only well-formed domains', async () => {
        await save(['acme.test', 'not a domain', '@acme.test', 'http://x.test', '']);
        expect(configRow().domains).toEqual(['acme.test']);
    });
});

describe('verifying a domain', () => {
    it('records the time once the TXT record carries the company token', async () => {
        await save(['acme.test']);
        const { domainVerificationToken: token } = configRow();
        resolveTxt.mockResolvedValue([['v=spf1 -all'], ['alianhub-sso-', `verification=${token}`]]);

        const res = await verify('ACME.test');
        expect(resolveTxt).toHaveBeenCalledWith('_alianhub-sso.acme.test');
        expect(res.body.status).toBe(true);
        const row = configRow().verifiedDomains.find((d) => d.domain === 'acme.test');
        expect(row.verifiedAt).toBeInstanceOf(Date);

        const read = await call(config.getSsoConfig);
        expect(recordFor(read, 'acme.test').verifiedAt).toBeTruthy();
    });

    it('stays unverified when the record is missing or carries another token', async () => {
        await save(['acme.test']);
        expect((await verify('acme.test')).body.status).toBe(false);

        resolveTxt.mockResolvedValue([['alianhub-sso-verification=someone-else']]);
        const res = await verify('acme.test');
        expect(res.body.status).toBe(false);
        expect(res.body.data).toMatchObject({ name: '_alianhub-sso.acme.test' });
        expect(configRow().verifiedDomains || []).toEqual([]);
    });

    it('refuses a domain the config does not list', async () => {
        await save(['acme.test']);
        resolveTxt.mockResolvedValue([[`alianhub-sso-verification=${configRow().domainVerificationToken}`]]);
        const res = await verify('other.test');
        expect(res.body.status).toBe(false);
        expect(resolveTxt).not.toHaveBeenCalled();
        expect(configRow().verifiedDomains || []).toEqual([]);
    });

    it('is for the owner or an admin only', async () => {
        await save(['acme.test']);
        resolveTxt.mockResolvedValue([[`alianhub-sso-verification=${configRow().domainVerificationToken}`]]);
        const res = await verify('acme.test', MEMBER);
        expect(res.code).toBe(403);
        expect(configRow().verifiedDomains || []).toEqual([]);
    });
});
