process.env.JWT_SECRET = 'sso-account-linking-secret';
process.env.JWT_ALGORITHM = 'HS256';
process.env.JWT_EXP = '24h';

const mockDbs = {};
const mockDbFor = (companyId) => { mockDbs[companyId] = mockDbs[companyId] || require('./fixtures/fakeMongo').create(); return mockDbs[companyId]; };
const mockIdentity = { claims: {} };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn(), recordAudit: jest.fn() }));
jest.mock('../Modules/Auth/controller/authHelpers', () => ({
    ...jest.requireActual('../Modules/Auth/controller/authHelpers'),
    addAndRemoveUserInMongodbNotificationCount: jest.fn(async () => {}),
}));
jest.mock('openid-client', () => {
    class Issuer { constructor(meta) { this.meta = meta; } static async discover() { return new Issuer({}); } }
    Issuer.prototype.Client = class { async callback() { return { claims: () => mockIdentity.claims }; } };
    return { Issuer, generators: {} };
});
jest.mock('samlify', () => ({
    setSchemaValidator: () => {},
    Constants: { namespace: { binding: { post: 'post', redirect: 'redirect' } } },
    ServiceProvider: () => ({ parseLoginResponse: async () => ({ extract: { attributes: mockIdentity.claims, nameID: mockIdentity.claims.email } }) }),
    IdentityProvider: () => ({}),
}));
jest.mock('@authenio/samlify-xsd-schema-validator', () => ({}), { virtual: true });

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { myCache } = require('../Config/config');
const { SEAT_ACTIVE, SEAT_PENDING } = require('../Config/seatStatus');
const { recordAudit } = require('../Modules/Audit/recorder');
const oidc = require('../Modules/SSO/oidc');
const saml = require('../Modules/SSO/saml');

const A = '6f00000000000000000006a0';
const B = '6f00000000000000000006b0';
const OUTSIDER = '6f00000000000000000006e1';
const MEMBER = '6f00000000000000000006e2';
const ACME_USER = '6f00000000000000000006e3';
const LEAVER = '6f00000000000000000006e4';

const globalDb = () => mockDbFor(dbCollections.GLOBAL);
const rows = (companyId, type) => mockDbFor(companyId).store[type] || [];
const seatsIn = (companyId) => rows(companyId, SCHEMA_TYPE.COMPANY_USERS);
const userRow = (uid) => (globalDb().store[dbCollections.USERS] || []).find((u) => String(u._id) === uid);
const userByEmail = (email) => (globalDb().store[dbCollections.USERS] || []).find((u) => u.Employee_Email === email);
const authByEmail = (email) => (globalDb().store[dbCollections.USER_AUTH] || []).find((u) => u.email === email);
const sessionsOf = (uid) => (globalDb().store[dbCollections.SESSIONS] || []).filter((s) => String(s.userId) === uid);

const seedAccount = (uid, email, companies, name = 'Pat Outside') => {
    globalDb().seed(dbCollections.USER_AUTH, { _id: uid, email, isBlocked: false });
    globalDb().seed(dbCollections.USERS, {
        _id: uid, Employee_Email: email, Employee_Name: name, Employee_FName: name.split(' ')[0], Employee_LName: name.split(' ')[1],
        AssignCompany: [...companies], isEmailVerified: true, isActive: true,
    });
};
const seedSeat = (companyId, uid, email, over = {}) => mockDbFor(companyId).seed(SCHEMA_TYPE.COMPANY_USERS, {
    companyId, userId: uid, userEmail: email, roleType: 3, designation: 0, status: SEAT_ACTIVE, isDelete: false, ...over,
});
const seedConfig = (provider, over = {}) => mockDbFor(A).seed(SCHEMA_TYPE.SSO_CONFIGS, {
    provider, isEnabled: true, deletedStatusKey: 0, autoProvisionUsers: true, defaultRoleType: 3,
    domains: ['acme.test', 'outside.test'], domainVerificationToken: 'a'.repeat(40),
    verifiedDomains: [{ domain: 'acme.test', verifiedAt: new Date('2026-09-01T00:00:00Z') }],
    oidc: { issuer: 'https://idp.acme.test', clientId: 'c', clientSecret: 's' },
    saml: { entryPoint: 'https://idp.acme.test/sso', idpCert: 'CERT' },
    ...over,
});

const redirectOf = (handler, req) => new Promise((resolve, reject) => {
    const res = { cookie: jest.fn(), status: () => res, send: reject, redirect: (url) => resolve(url) };
    handler(req, res);
});

const SIGN_IN = {
    oidc: (email) => {
        mockIdentity.claims = { email, given_name: 'Idp', family_name: 'Name', sub: `sub-${email}` };
        myCache.set('sso:oidc:state-1', { companyId: A, nonce: 'n', codeVerifier: 'v' }, 60);
        return redirectOf(oidc.oidcCallback, { query: { state: 'state-1', code: 'code' }, headers: { 'user-agent': 'jest' }, ip: '127.0.0.1' });
    },
    saml: (email) => {
        mockIdentity.claims = { email, given_name: 'Idp', family_name: 'Name' };
        return redirectOf(saml.samlAcs, { query: { companyId: A }, body: {}, headers: { 'user-agent': 'jest' }, ip: '127.0.0.1' });
    },
};

const REFUSED = '/login?ssoError=not_allowed';

beforeEach(() => {
    Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
    myCache.flushAll();
    jest.clearAllMocks();
    seedAccount(OUTSIDER, 'pat@outside.test', [B]);
    seedSeat(B, OUTSIDER, 'pat@outside.test');
    seedAccount(MEMBER, 'max@member.test', [A, B], 'Max Member');
    seedSeat(A, MEMBER, 'max@member.test');
    seedAccount(ACME_USER, 'ann@acme.test', [B], 'Ann Acme');
    seedSeat(B, ACME_USER, 'ann@acme.test');
    seedAccount(LEAVER, 'lee@acme.test', [A], 'Lee Leaver');
    seedSeat(A, LEAVER, 'lee@acme.test', { status: 0, isDelete: true });
});

describe.each(['oidc', 'saml'])('%s sign-in to company A', (provider) => {
    const signIn = (email) => SIGN_IN[provider](email);

    beforeEach(() => seedConfig(provider));

    it('refuses an existing account with no seat in A whose domain A has not verified', async () => {
        const before = JSON.parse(JSON.stringify(userRow(OUTSIDER)));

        expect(await signIn('pat@outside.test')).toBe(REFUSED);

        expect(sessionsOf(OUTSIDER)).toHaveLength(0);
        expect(JSON.parse(JSON.stringify(userRow(OUTSIDER)))).toEqual(before);
        expect(seatsIn(A).find((s) => s.userId === OUTSIDER)).toBeUndefined();
        expect(recordAudit).toHaveBeenCalledWith(A, expect.objectContaining({ action: 'sso.login_refused' }));
    });

    it('signs in an account that already holds a seat in A, whatever its domain', async () => {
        expect(await signIn('max@member.test')).toBe(`/${A}`);
        expect(sessionsOf(MEMBER)).toHaveLength(1);
    });

    it('links an existing account whose domain A has verified', async () => {
        expect(await signIn('ann@acme.test')).toBe(`/${A}`);

        expect(sessionsOf(ACME_USER)).toHaveLength(1);
        expect(userRow(ACME_USER).AssignCompany).toEqual([B, A]);
        expect(userRow(ACME_USER).Employee_Name).toBe('Ann Acme');
        expect(seatsIn(A).find((s) => s.userId === ACME_USER)).toMatchObject({ status: SEAT_ACTIVE, isDelete: false, roleType: 3, companyId: A });
    });

    it('creates a new account only for a verified domain', async () => {
        expect(await signIn('new@outside.test')).toBe(REFUSED);
        expect(authByEmail('new@outside.test')).toBeUndefined();
        expect(seatsIn(A).find((s) => s.userEmail === 'new@outside.test')).toBeUndefined();

        expect(await signIn('new@acme.test')).toBe(`/${A}`);
        const created = userByEmail('new@acme.test');
        expect(created.AssignCompany).toEqual([A]);
        expect(sessionsOf(String(created._id))).toHaveLength(1);
        expect(seatsIn(A).find((s) => s.userEmail === 'new@acme.test')).toMatchObject({ status: SEAT_ACTIVE, companyId: A });
    });

    it('answers the same refusal whether or not the account exists', async () => {
        const existing = await signIn('pat@outside.test');
        const missing = await signIn('nobody@outside.test');
        expect(existing).toBe(missing);
    });

    it('does not restore a seat that was deactivated, even on a verified domain', async () => {
        expect(await signIn('lee@acme.test')).toBe(REFUSED);
        expect(sessionsOf(LEAVER)).toHaveLength(0);
        expect(seatsIn(A).find((s) => s.userId === LEAVER)).toMatchObject({ status: 0, isDelete: true });
    });

    it('does not turn a pending invitation into a seat', async () => {
        seedSeat(A, ACME_USER, 'ann@acme.test', { status: SEAT_PENDING });
        expect(await signIn('ann@acme.test')).toBe(REFUSED);
        expect(seatsIn(A).find((s) => s.userId === ACME_USER).status).toBe(SEAT_PENDING);
        expect(userRow(ACME_USER).AssignCompany).toEqual([B]);
    });
});

describe('a company with no verified domain', () => {
    it('signs in its existing members and refuses everyone else', async () => {
        seedConfig('oidc', { domains: [], verifiedDomains: [] });
        expect(await SIGN_IN.oidc('max@member.test')).toBe(`/${A}`);
        expect(await SIGN_IN.oidc('pat@outside.test')).toBe(REFUSED);
        expect(await SIGN_IN.oidc('new@acme.test')).toBe(REFUSED);
        expect(authByEmail('new@acme.test')).toBeUndefined();
    });

    it('does not count a verification left behind for a domain it no longer lists', async () => {
        seedConfig('oidc', { domains: ['outside.test'] });
        expect(await SIGN_IN.oidc('ann@acme.test')).toBe(REFUSED);
        expect(userRow(ACME_USER).AssignCompany).toEqual([B]);
    });
});

describe('a company that turned automatic provisioning off', () => {
    it('adds no one, even on a verified domain, and still signs in its members', async () => {
        seedConfig('oidc', { autoProvisionUsers: false });
        expect(await SIGN_IN.oidc('ann@acme.test')).toBe(REFUSED);
        expect(userRow(ACME_USER).AssignCompany).toEqual([B]);
        expect(await SIGN_IN.oidc('new@acme.test')).toBe(REFUSED);
        expect(authByEmail('new@acme.test')).toBeUndefined();
        expect(await SIGN_IN.oidc('max@member.test')).toBe(`/${A}`);
    });
});
