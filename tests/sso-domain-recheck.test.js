const mockDbs = {};
const mockDbFor = (companyId) => { mockDbs[companyId] = mockDbs[companyId] || require('./fixtures/fakeMongo').create(); return mockDbs[companyId]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn(), recordAudit: jest.fn() }));

const dns = require('dns');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { ssoConfigsSchema } = require('../utils/mongo-handler/createSchema');
const { recordAudit } = require('../Modules/Audit/recorder');
const { isVerifiedDomain } = require('../Modules/SSO/helpers/ssoRules');
const config = require('../Modules/SSO/config');
const recheck = require('../Modules/SSO/domainRecheck');

const COMPANY = '6f00000000000000000005d1';
const OWNER = '6f00000000000000000005d2';
const TOKEN = 'b'.repeat(40);
const VERIFIED_AT = new Date('2026-09-01T00:00:00Z');

const configRow = () => (mockDbFor(COMPANY).store[SCHEMA_TYPE.SSO_CONFIGS] || [])[0];
const entryFor = (domain) => (configRow().verifiedDomains || []).find((v) => v.domain === domain);

const dnsError = (code) => Object.assign(new Error(`queryTxt ${code}`), { code });
const published = () => [[`alianhub-sso-verification=${TOKEN}`]];

const call = async (handler, body = {}) => {
    const res = { code: 200 };
    res.status = (c) => { res.code = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    res.send = res.json;
    await handler({ uid: OWNER, headers: { companyid: COMPANY }, body, query: {} }, res);
    return res;
};

let resolveTxt;

beforeEach(() => {
    Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
    jest.clearAllMocks();
    mockDbFor(dbCollections.GLOBAL).seed(SCHEMA_TYPE.COMPANIES, { _id: COMPANY, Cst_CompanyName: 'Acme' });
    mockDbFor(COMPANY).seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false, userEmail: 'owner@acme.test' });
    mockDbFor(COMPANY).seed(SCHEMA_TYPE.SSO_CONFIGS, {
        provider: 'oidc', isEnabled: true, deletedStatusKey: 0, domains: ['acme.test', 'other.test'], domainVerificationToken: TOKEN,
        oidc: { issuer: 'https://idp.acme.test', clientId: 'c', clientSecret: 's' },
        verifiedDomains: [{ domain: 'acme.test', verifiedAt: VERIFIED_AT }, { domain: 'other.test', verifiedAt: VERIFIED_AT }],
    });
    resolveTxt = jest.spyOn(dns.promises, 'resolveTxt').mockImplementation(async () => published());
});

afterEach(() => resolveTxt.mockRestore());

const missingFor = (domain, error = dnsError('ENOTFOUND')) => resolveTxt.mockImplementation(async (name) => {
    if (name === `_alianhub-sso.${domain}`) throw error;
    return published();
});

describe('the SSO config schema', () => {
    it('declares the re-check state of a verified domain and the domains whose verification lapsed', () => {
        const verified = ssoConfigsSchema.path('verifiedDomains');
        expect(verified.schema.path('failedChecks')).toBeTruthy();
        expect(verified.schema.path('lastCheckedAt')).toBeTruthy();
        const lapsed = ssoConfigsSchema.path('lapsedDomains');
        expect(lapsed).toBeTruthy();
        expect(lapsed.schema.path('domain')).toBeTruthy();
        expect(lapsed.schema.path('lapsedAt')).toBeTruthy();
    });
});

describe('the daily re-check of verified SSO domains', () => {
    it('keeps a domain whose TXT record is still published', async () => {
        await recheck.recheckCompanyDomains(COMPANY);

        expect(resolveTxt).toHaveBeenCalledWith('_alianhub-sso.acme.test');
        expect(entryFor('acme.test')).toMatchObject({ verifiedAt: VERIFIED_AT, failedChecks: 0 });
        expect(entryFor('acme.test').lastCheckedAt).toBeInstanceOf(Date);
        expect(recordAudit).not.toHaveBeenCalled();
    });

    it.each([
        ['the name does not resolve', () => missingFor('acme.test')],
        ['the name has no TXT record', () => missingFor('acme.test', dnsError('ENODATA'))],
        ['the record carries another token', () => resolveTxt.mockImplementation(async (name) => (name.endsWith('acme.test') ? [['alianhub-sso-verification=other']] : published()))],
    ])('counts a check where %s, and unverifies the domain on the third in a row', async (_why, arrange) => {
        arrange();

        await recheck.recheckCompanyDomains(COMPANY);
        await recheck.recheckCompanyDomains(COMPANY);
        expect(entryFor('acme.test')).toMatchObject({ failedChecks: 2, verifiedAt: VERIFIED_AT });
        expect(isVerifiedDomain(configRow(), 'acme.test')).toBe(true);
        expect(recordAudit).not.toHaveBeenCalled();

        await recheck.recheckCompanyDomains(COMPANY);
        expect(entryFor('acme.test')).toBeUndefined();
        expect(isVerifiedDomain(configRow(), 'acme.test')).toBe(false);
        expect(isVerifiedDomain(configRow(), 'other.test')).toBe(true);
        expect(configRow().lapsedDomains).toEqual([{ domain: 'acme.test', lapsedAt: expect.any(Date) }]);
        expect(recordAudit).toHaveBeenCalledTimes(1);
        expect(recordAudit).toHaveBeenCalledWith(COMPANY, expect.objectContaining({
            action: 'sso.domain_unverified', entityType: 'sso', entityName: 'acme.test',
        }));
    });

    it('starts the count again when the record comes back', async () => {
        missingFor('acme.test');
        await recheck.recheckCompanyDomains(COMPANY);
        await recheck.recheckCompanyDomains(COMPANY);
        resolveTxt.mockImplementation(async () => published());
        await recheck.recheckCompanyDomains(COMPANY);
        missingFor('acme.test');
        await recheck.recheckCompanyDomains(COMPANY);
        await recheck.recheckCompanyDomains(COMPANY);

        expect(entryFor('acme.test')).toMatchObject({ failedChecks: 2 });
        expect(isVerifiedDomain(configRow(), 'acme.test')).toBe(true);
    });

    it.each(['ETIMEOUT', 'ESERVFAIL', 'ECONNREFUSED'])('does not count a check the resolver could not answer (%s)', async (code) => {
        missingFor('acme.test', dnsError(code));
        for (let i = 0; i < 4; i += 1) await recheck.recheckCompanyDomains(COMPANY); // eslint-disable-line no-await-in-loop

        expect(entryFor('acme.test')).toMatchObject({ verifiedAt: VERIFIED_AT });
        expect(entryFor('acme.test').failedChecks || 0).toBe(0);
        expect(recordAudit).not.toHaveBeenCalled();
    });

    it('runs for every company from the recurring job', async () => {
        missingFor('acme.test');
        for (let i = 0; i < 3; i += 1) await recheck.runSsoDomainRecheckForAllCompanies(); // eslint-disable-line no-await-in-loop
        expect(isVerifiedDomain(configRow(), 'acme.test')).toBe(false);
    });
});

describe('the SSO settings screen', () => {
    it('shows a lapsed domain as lapsed and a failing one with its failed checks', async () => {
        missingFor('acme.test');
        await recheck.recheckCompanyDomains(COMPANY);
        await recheck.recheckCompanyDomains(COMPANY);
        await recheck.recheckCompanyDomains(COMPANY);
        resolveTxt.mockImplementation(async (name) => (name.endsWith('other.test') ? [] : published()));
        await recheck.recheckCompanyDomains(COMPANY);

        const records = (await call(config.getSsoConfig)).body.data.domainRecords;
        expect(records.find((r) => r.domain === 'acme.test')).toMatchObject({ verifiedAt: null, lapsedAt: expect.anything() });
        expect(records.find((r) => r.domain === 'other.test')).toMatchObject({ verifiedAt: expect.anything(), failedChecks: 1, lapsedAt: null });
    });

    it('clears the lapse once the owner verifies the domain again', async () => {
        missingFor('acme.test');
        for (let i = 0; i < 3; i += 1) await recheck.recheckCompanyDomains(COMPANY); // eslint-disable-line no-await-in-loop
        resolveTxt.mockImplementation(async () => published());

        const res = await call(config.verifySsoDomain, { domain: 'acme.test' });

        expect(res.body.status).toBe(true);
        expect(isVerifiedDomain(configRow(), 'acme.test')).toBe(true);
        expect(configRow().lapsedDomains).toEqual([]);
        expect(res.body.data.domainRecords.find((r) => r.domain === 'acme.test')).toMatchObject({ lapsedAt: null, failedChecks: 0 });
    });

    it('keeps the failed-check count when the config is saved', async () => {
        missingFor('acme.test');
        await recheck.recheckCompanyDomains(COMPANY);

        await call(config.setSsoConfig, { provider: 'oidc', oidc: { issuer: 'https://idp.acme.test', clientId: 'c', clientSecret: 's' }, isEnabled: true, domains: ['acme.test'] });

        expect(entryFor('acme.test')).toMatchObject({ failedChecks: 1 });
    });
});
