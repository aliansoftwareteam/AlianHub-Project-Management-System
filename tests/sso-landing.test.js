process.env.JWT_SECRET = 'sso-landing-secret';
process.env.JWT_ALGORITHM = 'HS256';
process.env.JWT_EXP = '24h';
process.env.WEBURL = 'https://app.example.test/';

const mockDb = require('./fixtures/fakeMongo').create();
const mockIdp = { authorizationParams: null, spSettings: [] };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/knownCompany', () => ({ isKnownCompany: async (id) => id === '6f00000000000000000007c1' }));
jest.mock('../Modules/SSO/provisioning', () => ({ ssoSignInUser: jest.fn(async () => '6f00000000000000000007e1'), SSO_NOT_ALLOWED: 'SSO_NOT_ALLOWED' }));
jest.mock('openid-client', () => {
    class Issuer { constructor(meta) { this.meta = meta; } static async discover() { return new Issuer({}); } }
    Issuer.prototype.Client = class {
        authorizationUrl(params) { mockIdp.authorizationParams = params; return 'https://idp.example.test/authorize'; }
        async callback() { return { claims: () => ({ email: 'max@acme.test', given_name: 'Max', family_name: 'Member', sub: 'sub-max' }) }; }
    };
    return { Issuer, generators: { state: () => 'state-1', nonce: () => 'nonce-1', codeVerifier: () => 'verifier-1', codeChallenge: () => 'challenge-1' } };
});
jest.mock('samlify', () => ({
    setSchemaValidator: () => {},
    Constants: { namespace: { binding: { post: 'post', redirect: 'redirect' } } },
    ServiceProvider: (setting) => {
        mockIdp.spSettings.push(setting);
        return {
            createLoginRequest: () => ({ context: 'https://idp.example.test/sso' }),
            parseLoginResponse: async () => ({ extract: { attributes: { email: 'max@acme.test', given_name: 'Max', family_name: 'Member' }, nameID: 'max@acme.test' } }),
        };
    },
    IdentityProvider: () => ({}),
}));
jest.mock('@authenio/samlify-xsd-schema-validator', () => ({}), { virtual: true });

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { myCache } = require('../Config/config');
const oidc = require('../Modules/SSO/oidc');
const saml = require('../Modules/SSO/saml');

const COMPANY = '6f00000000000000000007c1';
const UNKNOWN = '6f00000000000000000007c9';
const UID = '6f00000000000000000007e1';
const WEB = 'https://app.example.test';
const SIGNED_IN = `${WEB}/#/login?sso=ok&uid=${UID}&workspace=${COMPANY}`;
const NOT_SET_UP = `${WEB}/#/login?ssoError=config`;

const redirectOf = (handler, req) => new Promise((resolve, reject) => {
    const res = { cookie: jest.fn(), status: () => res, send: reject, redirect: (url) => resolve(url) };
    handler({ headers: { 'user-agent': 'jest' }, ip: '127.0.0.1', query: {}, body: {}, ...req }, res);
});

const seedSso = (provider) => mockDb.seed(SCHEMA_TYPE.SSO_CONFIGS, {
    provider, isEnabled: true, deletedStatusKey: 0,
    oidc: { issuer: 'https://idp.example.test', clientId: 'c', clientSecret: 's' },
    saml: { entryPoint: 'https://idp.example.test/sso', idpCert: 'CERT' },
});

const oidcSignIn = async (query) => {
    expect(await redirectOf(oidc.oidcInitiate, { query: { companyId: COMPANY, ...query } })).toBe('https://idp.example.test/authorize');
    return redirectOf(oidc.oidcCallback, { query: { state: 'state-1', code: 'code' } });
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    myCache.flushAll();
    mockIdp.authorizationParams = null;
    mockIdp.spSettings.length = 0;
    mockDb.seed(dbCollections.USERS, { _id: UID, Employee_Email: 'max@acme.test', isEmailVerified: true, AssignCompany: [COMPANY] });
});

describe('OIDC sign-in', () => {
    beforeEach(() => seedSso('oidc'));

    it('lands on the sign-in page with who signed in and the workspace', async () => {
        expect(await oidcSignIn({})).toBe(SIGNED_IN);
    });

    it('brings back the page the person was trying to open', async () => {
        expect(await oidcSignIn({ redirect_url: `/${COMPANY}/project/p1/list` })).toBe(`${SIGNED_IN}&redirect_url=${encodeURIComponent(`/${COMPANY}/project/p1/list`)}`);
    });

    it.each(['//evil.test/x', '/\\evil.test', 'https://evil.test/x', 'project'])('never sends the person to %s', async (redirect) => {
        expect(await oidcSignIn({ redirect_url: redirect })).toBe(SIGNED_IN);
    });

    it('tells the identity provider which address the person typed', async () => {
        await oidcSignIn({ login_hint: 'max@acme.test' });
        expect(mockIdp.authorizationParams).toMatchObject({ login_hint: 'max@acme.test', state: 'state-1', nonce: 'nonce-1', code_challenge: 'challenge-1' });
    });

    it('passes no hint that is not an address', async () => {
        await oidcSignIn({ login_hint: 'max at acme' });
        expect(mockIdp.authorizationParams).not.toHaveProperty('login_hint');
    });

    it('sends a stale or replayed callback back to the sign-in page', async () => {
        await oidcSignIn({});
        expect(await redirectOf(oidc.oidcCallback, { query: { state: 'state-1', code: 'code' } })).toBe(`${WEB}/#/login?ssoError=state`);
    });
});

describe('SAML sign-in', () => {
    beforeEach(() => seedSso('saml'));

    it('asks the identity provider to hand the page back in RelayState', async () => {
        expect(await redirectOf(saml.samlInitiate, { query: { companyId: COMPANY, redirect_url: `/${COMPANY}/inbox` } })).toBe('https://idp.example.test/sso');
        expect(mockIdp.spSettings.at(-1).relayState).toBe(`/${COMPANY}/inbox`);
    });

    it('starts with no RelayState for an address on another site', async () => {
        await redirectOf(saml.samlInitiate, { query: { companyId: COMPANY, redirect_url: 'https://evil.test' } });
        expect(mockIdp.spSettings.at(-1).relayState).toBe('');
    });

    it('lands on the page RelayState names', async () => {
        const landing = await redirectOf(saml.samlAcs, { query: { companyId: COMPANY }, body: { RelayState: `/${COMPANY}/inbox` } });
        expect(landing).toBe(`${SIGNED_IN}&redirect_url=${encodeURIComponent(`/${COMPANY}/inbox`)}`);
    });

    it('ignores a RelayState that points at another site', async () => {
        expect(await redirectOf(saml.samlAcs, { query: { companyId: COMPANY }, body: { RelayState: '//evil.test' } })).toBe(SIGNED_IN);
    });
});

describe('starting single sign-on where it is not set up', () => {
    it.each([
        ['oidc', () => oidc.oidcInitiate, 'saml'],
        ['saml', () => saml.samlInitiate, 'oidc'],
    ])('%s returns to the sign-in page saying so', async (_name, handler, otherProvider) => {
        seedSso(otherProvider);
        expect(await redirectOf(handler(), { query: {} })).toBe(NOT_SET_UP);
        expect(await redirectOf(handler(), { query: { companyId: UNKNOWN } })).toBe(NOT_SET_UP);
        expect(await redirectOf(handler(), { query: { companyId: COMPANY } })).toBe(NOT_SET_UP);
    });
});
