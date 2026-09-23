process.env.JWT_SECRET = 'social-sign-in-identity-secret';
process.env.JWT_ALGORITHM = 'HS256';
process.env.JWT_EXP = '24h';
process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';
process.env.GOOGLE_CLIENT_ID = 'google-client.apps.test';
delete process.env.GOOGLE_OAUTH_CLIENT_ID;
delete process.env.GITLAB_BASE_API_URL;

const mockDb = require('./fixtures/fakeMongo').create();
const mockVerifyIdToken = jest.fn();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/service.js', () => ({ SendEmail: jest.fn((subject, mail, to, flag, cb) => cb({ status: true })) }));
jest.mock('../utils/data', () => ({ importUserNotifications: jest.fn(async () => undefined) }));
jest.mock('google-auth-library', () => ({
    OAuth2Client: jest.fn().mockImplementation(() => ({ verifyIdToken: (...args) => mockVerifyIdToken(...args) })),
}));

const axios = require('axios');
const https = require('https');
const { dbCollections } = require('../Config/collections');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { myCache } = require('../Config/config');
const loginSession = require('../Modules/Auth/controller/loginSession');
const createUser = require('../Modules/Auth/controller/createUser');

const COMPANY = '6f0000000000000000000c01';
const VICTIM = { _id: '6f00000000000000000000a1', email: 'victim@example.test' };
const LINKED = { _id: '6f00000000000000000000a2', email: 'linked@example.test' };
const SPARE = { _id: '6f00000000000000000000a3', email: 'spare@example.test' };

/* Each token names the identity the provider answers with; any other token is refused as the provider would.
 * Like the browser, a credential travels with the provider id the client read for it. */
const identities = new Map();

const PROVIDERS = {
    github: {
        idField: 'githubId',
        signup: 'githubSignup',
        token: (id, { email = null, verified = true, publicEmail = null, emailsDenied = false } = {}) => {
            const token = `gh-${id}-${identities.size}`;
            const emails = email ? [{ email, verified, primary: true, visibility: 'private' }] : [];
            identities.set(token, { github: { user: { id, login: `user${id}`, email: publicEmail }, emails, emailsDenied } });
            return { accessToken: token, githubId: String(id) };
        },
    },
    gitlab: {
        idField: 'gitlabId',
        signup: 'gitlabSignup',
        token: (id, { email = null, verified = true } = {}) => {
            const token = `gl-${id}-${identities.size}`;
            identities.set(token, { gitlab: { id, username: `user${id}`, email: email || undefined, confirmed_at: verified && email ? '2024-01-01T00:00:00Z' : null } });
            return { accessToken: token, gitlabId: String(id) };
        },
    },
    google: {
        idField: 'googleId',
        signup: 'googleSignup',
        token: (id, { email = null, verified = true } = {}) => {
            const token = `google-${id}-${identities.size}`;
            const payload = { sub: String(id), aud: process.env.GOOGLE_CLIENT_ID, iss: 'https://accounts.google.com' };
            if (email) Object.assign(payload, { email, email_verified: verified });
            identities.set(token, { google: payload });
            return { idToken: token, googleId: String(id) };
        },
    },
};

const providerRefusal = (status) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status } });

const answerProvider = async (url, options = {}) => {
    const auth = String((options.headers || {}).Authorization || (options.headers || {}).authorization || '');
    const token = auth.replace(/^(token|Bearer)\s+/i, '');
    const known = identities.get(token);
    if (url === 'https://api.github.com/user') {
        if (!(known && known.github)) throw providerRefusal(401);
        return { status: 200, data: known.github.user };
    }
    if (url === 'https://api.github.com/user/emails') {
        if (!(known && known.github)) throw providerRefusal(401);
        if (known.github.emailsDenied) throw providerRefusal(404);
        return { status: 200, data: known.github.emails };
    }
    if (url === 'https://gitlab.com/api/v4/user') {
        if (!(known && known.gitlab)) throw providerRefusal(401);
        return { status: 200, data: known.gitlab };
    }
    throw new Error(`unexpected provider call ${url}`);
};

const authRows = () => mockDb.store[dbCollections.USER_AUTH] || [];
const authOf = (id) => authRows().find((row) => String(row._id) === String(id));
const sessionsOf = (id) => (mockDb.store[dbCollections.SESSIONS] || []).filter((s) => String(s.userId) === String(id));
const allSessions = () => mockDb.store[dbCollections.SESSIONS] || [];

const seedAccount = ({ _id, email }, link = {}) => {
    mockDb.seed(dbCollections.USER_AUTH, { _id, email, isBlocked: false, ...link });
    mockDb.seed(dbCollections.USERS, { _id, Employee_Email: email, isEmailVerified: true, AssignCompany: [] });
};

const signIn = (body) => new Promise((resolve) => {
    const req = { headers: { 'user-agent': 'jest' }, ip: '127.0.0.1', body };
    const res = { cookie: jest.fn() };
    res.status = jest.fn(() => res);
    res.json = jest.fn((payload) => resolve({ req, res, payload, refused: false }));
    loginSession.loginAuth(req, res, () => resolve({ req, res, refused: true }));
});

const signUp = async (handler, body) => {
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (payload) => { res.body = payload; return res; };
    res.send = res.json;
    await createUser[handler]({ body }, res);
    return res;
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((key) => { mockDb.store[key].length = 0; });
    myCache.flushAll();
    identities.clear();
    mockVerifyIdToken.mockReset();
    mockVerifyIdToken.mockImplementation(async ({ idToken, audience }) => {
        const known = identities.get(idToken);
        if (!known || !known.google || audience !== process.env.GOOGLE_CLIENT_ID) throw new Error('Invalid token signature');
        return { getPayload: () => ({ ...known.google }) };
    });
    jest.spyOn(axios, 'get').mockImplementation(answerProvider);
    jest.spyOn(axios, 'post').mockImplementation(async (url) => { throw new Error(`unexpected provider call ${url}`); });
    jest.spyOn(https, 'request').mockImplementation(() => { throw new Error('no network in tests'); });
    seedAccount(VICTIM);
    seedAccount(SPARE);
});

afterEach(() => jest.restoreAllMocks());

describe.each(Object.keys(PROVIDERS))('%s sign-in binds to the provider identity', (provider) => {
    const { idField, token } = PROVIDERS[provider];
    const login = (credentials, extra = {}) => signIn({ authProvider: provider, isLoginType: 'frontend', ...credentials, ...extra });

    it('refuses a provider account with no email when the body names another account', async () => {
        const { refused, req } = await login(token(9001), { email: VICTIM.email, [idField]: '9001' });

        expect(refused).toBe(true);
        expect(req.errorMessageObject.message).toBeTruthy();
        expect(allSessions()).toHaveLength(0);
        expect(authOf(VICTIM._id)[idField]).toBeUndefined();
    });

    it('refuses an email the provider has not verified', async () => {
        const { refused } = await login(token(9002, { email: VICTIM.email, verified: false }), { email: VICTIM.email, [idField]: '9002' });

        expect(refused).toBe(true);
        expect(allSessions()).toHaveLength(0);
        expect(authOf(VICTIM._id)[idField]).toBeUndefined();
    });

    it('refuses when the body names an email other than the verified one', async () => {
        const { refused } = await login(token(9003, { email: 'someone.else@example.test' }), { email: VICTIM.email, [idField]: '9003' });

        expect(refused).toBe(true);
        expect(allSessions()).toHaveLength(0);
        expect(authOf(VICTIM._id)[idField]).toBeUndefined();
    });

    it('signs in the account already bound to the provider id, whatever email the body names', async () => {
        seedAccount(LINKED, { [idField]: '9004' });

        const { refused, payload } = await login(token(9004), { email: VICTIM.email, [idField]: '9004' });

        expect(refused).toBe(false);
        expect(String(payload.uid)).toBe(LINKED._id);
        expect(sessionsOf(LINKED._id)).toHaveLength(1);
        expect(sessionsOf(VICTIM._id)).toHaveLength(0);
        expect(authOf(VICTIM._id)[idField]).toBeUndefined();
    });

    it('trusts the verified provider id over the id the body sends', async () => {
        seedAccount(LINKED, { [idField]: '9005' });

        const { refused } = await login(token(9006), { email: LINKED.email, [idField]: '9005' });

        expect(refused).toBe(true);
        expect(allSessions()).toHaveLength(0);
    });

    it('refuses when the verified email belongs to an account bound to a different provider id', async () => {
        seedAccount(LINKED, { [idField]: '1111' });

        const { refused } = await login(token(9007, { email: LINKED.email }), { email: LINKED.email, [idField]: '9007' });

        expect(refused).toBe(true);
        expect(allSessions()).toHaveLength(0);
        expect(authOf(LINKED._id)[idField]).toBe('1111');
    });

    it('links an unbound account found by the verified email and signs it in', async () => {
        const { refused, payload } = await login(token(9008, { email: 'Victim@Example.test' }), { email: VICTIM.email, [idField]: '9008' });

        expect(refused).toBe(false);
        expect(String(payload.uid)).toBe(VICTIM._id);
        expect(sessionsOf(VICTIM._id)).toHaveLength(1);
        expect(authOf(VICTIM._id)[idField]).toBe('9008');
    });

    it('refuses a token the provider does not accept', async () => {
        const { refused } = await login({ accessToken: 'forged', idToken: 'forged' }, { email: VICTIM.email, [idField]: '9009' });

        expect(refused).toBe(true);
        expect(allSessions()).toHaveLength(0);
        expect(authOf(VICTIM._id)[idField]).toBeUndefined();
    });

    it('refuses a sign-in without a provider token', async () => {
        const { refused } = await login({}, { email: VICTIM.email, [idField]: '9010' });

        expect(refused).toBe(true);
        expect(allSessions()).toHaveLength(0);
        expect(authOf(VICTIM._id)[idField]).toBeUndefined();
    });
});

describe('github verified email', () => {
    it('ignores the public profile email and uses only a verified address from the email list', async () => {
        const { refused } = await signIn({
            authProvider: 'github',
            ...PROVIDERS.github.token(9101, { publicEmail: VICTIM.email }),
            email: VICTIM.email,
            githubId: '9101',
        });

        expect(refused).toBe(true);
        expect(authOf(VICTIM._id).githubId).toBeUndefined();
    });

    it('refuses when the email list cannot be read and no account is bound to the id', async () => {
        const { refused } = await signIn({
            authProvider: 'github',
            ...PROVIDERS.github.token(9102, { email: VICTIM.email, emailsDenied: true, publicEmail: VICTIM.email }),
            email: VICTIM.email,
        });

        expect(refused).toBe(true);
        expect(allSessions()).toHaveLength(0);
    });
});

describe('google id token', () => {
    it('verifies the token against the configured client id', async () => {
        await signIn({ authProvider: 'google', ...PROVIDERS.google.token(9201, { email: VICTIM.email }), email: VICTIM.email });

        expect(mockVerifyIdToken).toHaveBeenCalledWith(expect.objectContaining({ audience: 'google-client.apps.test' }));
    });

    it('refuses every Google sign-in when no client id is configured', async () => {
        const saved = process.env.GOOGLE_CLIENT_ID;
        delete process.env.GOOGLE_CLIENT_ID;
        try {
            const { refused } = await signIn({ authProvider: 'google', ...PROVIDERS.google.token(9202, { email: VICTIM.email }), email: VICTIM.email });
            expect(refused).toBe(true);
            expect(allSessions()).toHaveLength(0);
        } finally {
            process.env.GOOGLE_CLIENT_ID = saved;
        }
    });
});

describe.each(Object.keys(PROVIDERS))('%s signup takes identity from the provider', (provider) => {
    const { idField, signup, token } = PROVIDERS[provider];
    const NEW_EMAIL = 'newcomer@example.test';
    const register = (credentials, extra = {}) => signUp(signup, { firstName: 'Nia', lastName: 'Newcomer', ...credentials, ...extra });

    it('refuses a signup without a provider token and creates nothing', async () => {
        const before = authRows().length;
        const res = await register({}, { email: NEW_EMAIL, [idField]: '9301' });

        expect(res.statusCode).toBeGreaterThanOrEqual(400);
        expect(res.body.status).toBe(false);
        expect(authRows()).toHaveLength(before);
    });

    it('refuses a token the provider does not accept', async () => {
        const before = authRows().length;
        const res = await register({ accessToken: 'forged', idToken: 'forged' }, { email: NEW_EMAIL, [idField]: '9302' });

        expect(res.statusCode).toBeGreaterThanOrEqual(400);
        expect(authRows()).toHaveLength(before);
    });

    it('refuses an email the provider has not verified', async () => {
        const before = authRows().length;
        const res = await register(token(9303, { email: NEW_EMAIL, verified: false }), { email: NEW_EMAIL });

        expect(res.statusCode).toBeGreaterThanOrEqual(400);
        expect(authRows()).toHaveLength(before);
    });

    it('refuses a body email other than the verified one', async () => {
        const before = authRows().length;
        const res = await register(token(9304, { email: NEW_EMAIL }), { email: 'other@example.test' });

        expect(res.statusCode).toBeGreaterThanOrEqual(400);
        expect(authRows()).toHaveLength(before);
    });

    it('stores the verified email and provider id and marks the account verified', async () => {
        const res = await register(token(9305, { email: 'Newcomer@Example.test' }), { email: NEW_EMAIL, [idField]: 'body-id' });

        expect(res.statusCode).toBe(200);
        expect(res.body.data).toMatchObject({ Employee_Email: NEW_EMAIL, isEmailVerified: true, AssignCompany: [] });
        const created = authRows().find((row) => row.email === NEW_EMAIL);
        expect(created[idField]).toBe('9305');
    });

    it('refuses a second account for a provider id that is already bound', async () => {
        seedAccount(LINKED, { [idField]: '9306' });
        const before = authRows().length;

        const res = await register(token(9306, { email: NEW_EMAIL }), { email: NEW_EMAIL });

        expect(res.statusCode).toBe(409);
        expect(authRows()).toHaveLength(before);
    });

    it('does not join an invited company on the email alone', async () => {
        const row = mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userEmail: NEW_EMAIL, status: 1, roleType: 3 });

        const res = await register(token(9307, { email: NEW_EMAIL }), { email: NEW_EMAIL, assignCompany: COMPANY });

        expect(res.statusCode).toBe(200);
        expect(res.body.data.AssignCompany).toEqual([]);
        expect(row.status).toBe(1);
    });

    it('joins the invited company when the invitation row is presented for the verified email', async () => {
        const row = mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { _id: '6f0000000000000000000d01', userEmail: NEW_EMAIL, status: 1, roleType: 3 });

        const res = await register(token(9308, { email: NEW_EMAIL }), { email: NEW_EMAIL, assignCompany: COMPANY, companyUserDocID: row._id });

        expect(res.statusCode).toBe(200);
        expect(res.body.data.AssignCompany).toEqual([COMPANY]);
        expect(row.status).toBe(2);
    });

    it('does not join a company whose invitation was issued to another email', async () => {
        const row = mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { _id: '6f0000000000000000000d02', userEmail: 'invitee@example.test', status: 1, roleType: 3 });

        const res = await register(token(9309, { email: NEW_EMAIL }), { email: NEW_EMAIL, assignCompany: COMPANY, companyUserDocID: row._id });

        expect(res.statusCode).toBe(200);
        expect(res.body.data.AssignCompany).toEqual([]);
        expect(row.status).toBe(1);
    });
});
