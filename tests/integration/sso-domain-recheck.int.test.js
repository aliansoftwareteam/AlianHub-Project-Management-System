const crypto = require('node:crypto');
const dns = require('node:dns');
const { MongoClient } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');

/* Follow-up 116. A verified SSO domain is re-checked every day against its TXT record; three misses in a
 * row unverify it and leave an audit row. DNS is mocked, the database is real. */

process.env.MONGODB_URL = resolveMongoUrl();

const { dbCollections } = require('../../Config/collections');
const { closeConnection } = require('../../middlewares/mongoConnector/helper');
const { isVerifiedDomain } = require('../../Modules/SSO/helpers/ssoRules');
const recheck = require('../../Modules/SSO/domainRecheck');

const COMPANY = crypto.randomBytes(12).toString('hex');
const TOKEN = crypto.randomBytes(20).toString('hex');
const VERIFIED_AT = new Date('2026-09-01T00:00:00Z');

let client;
let resolveTxt;

const configRow = () => client.db(COMPANY).collection('sso_configs').findOne({ deletedStatusKey: 0 });

const waitFor = async (read) => {
    const deadline = Date.now() + 10000;
    for (;;) {
        const found = await read();
        if (found) return found;
        if (Date.now() > deadline) return null;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
};

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    await client.db(COMPANY).collection('sso_configs').insertOne({
        provider: 'oidc', isEnabled: true, deletedStatusKey: 0, domains: ['acme.test', 'other.test'], domainVerificationToken: TOKEN,
        verifiedDomains: [{ domain: 'acme.test', verifiedAt: VERIFIED_AT }, { domain: 'other.test', verifiedAt: VERIFIED_AT }],
    });
    resolveTxt = jest.spyOn(dns.promises, 'resolveTxt').mockImplementation(async (name) => {
        if (name === '_alianhub-sso.acme.test') throw Object.assign(new Error('queryTxt ENOTFOUND'), { code: 'ENOTFOUND' });
        return [[`alianhub-sso-verification=${TOKEN}`]];
    });
});

afterAll(async () => {
    if (resolveTxt) resolveTxt.mockRestore();
    if (client) {
        await client.db(COMPANY).dropDatabase().catch(() => {});
        await client.close();
    }
    closeConnection(COMPANY);
    closeConnection(dbCollections.GLOBAL);
});

it('unverifies a domain whose TXT record is gone for three checks in a row and records it', async () => {
    await recheck.recheckCompanyDomains(COMPANY);
    await recheck.recheckCompanyDomains(COMPANY);

    let row = await configRow();
    expect(row.verifiedDomains.find((v) => v.domain === 'acme.test')).toMatchObject({ failedChecks: 2 });
    expect(isVerifiedDomain(row, 'acme.test')).toBe(true);

    await recheck.recheckCompanyDomains(COMPANY);

    row = await configRow();
    expect(isVerifiedDomain(row, 'acme.test')).toBe(false);
    expect(isVerifiedDomain(row, 'other.test')).toBe(true);
    expect(row.verifiedDomains.find((v) => v.domain === 'other.test')).toMatchObject({ failedChecks: 0, lastCheckedAt: expect.any(Date) });
    expect(row.lapsedDomains).toEqual([{ domain: 'acme.test', lapsedAt: expect.any(Date) }]);

    const audit = await waitFor(() => client.db(COMPANY).collection('audit_logs').findOne({ action: 'sso.domain_unverified' }));
    expect(audit).toMatchObject({ entityType: 'sso', entityName: 'acme.test' });
});
