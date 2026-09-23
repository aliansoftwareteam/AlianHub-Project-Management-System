const mockDbs = {};
const mockDbFor = (companyId) => { mockDbs[companyId] = mockDbs[companyId] || require('./fixtures/fakeMongo').create(); return mockDbs[companyId]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { discover } = require('../Modules/SSO/discover');

const A = '6f00000000000000000007a0';
const B = '6f00000000000000000007b0';
const OWNER = '6f00000000000000000007e1';

const ask = async (email) => {
    const res = { code: 200 };
    res.status = (c) => { res.code = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    res.send = res.json;
    await discover({ query: { email } }, res);
    return { code: res.code, body: res.body };
};

beforeEach(() => {
    Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
    const global = mockDbFor(dbCollections.GLOBAL);
    global.seed(dbCollections.COMPANIES, { _id: A, Cst_CompanyName: 'Acme', isDisable: false });
    global.seed(dbCollections.COMPANIES, { _id: B, Cst_CompanyName: 'Beta', isDisable: false });
    global.seed(dbCollections.USERS, { _id: OWNER, Employee_Email: 'olivia@owner.test', AssignCompany: [A], lastSelectedCompany: A });
    mockDbFor(A).seed(SCHEMA_TYPE.SSO_CONFIGS, {
        provider: 'oidc', isEnabled: true, deletedStatusKey: 0, displayName: 'Acme SSO',
        domains: ['acme.test', 'outside.test'], domainVerificationToken: 'a'.repeat(40),
        verifiedDomains: [{ domain: 'acme.test', verifiedAt: new Date('2026-09-01T00:00:00Z') }],
        oidc: { issuer: 'https://idp.acme.test' },
    });
});

describe('SSO discovery', () => {
    it('finds the company that verified the email domain', async () => {
        const { code, body } = await ask('someone@acme.test');
        expect(code).toBe(200);
        expect(body.data).toMatchObject({ companyId: A, providerName: 'Acme SSO' });
    });

    it('gives the same answer for a known and an unknown address on that domain', async () => {
        mockDbFor(dbCollections.GLOBAL).seed(dbCollections.USERS, { _id: '6f00000000000000000007e2', Employee_Email: 'known@acme.test', AssignCompany: [B] });
        expect(await ask('known@acme.test')).toEqual(await ask('unknown@acme.test'));
    });

    it('says nothing for a domain the company listed but has not verified', async () => {
        const unknown = await ask('nobody@nowhere.test');
        expect(unknown.code).toBe(404);
        expect(await ask('pat@outside.test')).toEqual(unknown);
    });

    it('does not reveal the SSO company of an existing account on another domain', async () => {
        const unknown = await ask('nobody@owner.test');
        expect(unknown.code).toBe(404);
        expect(await ask('olivia@owner.test')).toEqual(unknown);
    });

    it('ignores a disabled config', async () => {
        mockDbFor(A).store[SCHEMA_TYPE.SSO_CONFIGS][0].isEnabled = false;
        expect((await ask('someone@acme.test')).code).toBe(404);
    });
});
