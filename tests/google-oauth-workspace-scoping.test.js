process.env.GOOGLE_OAUTH_URL = 'https://google.example.test/token';
process.env.GOOGLE_CLIENT_ID = 'client-id';
process.env.GOOGLE_CLIENT_SECRET = 'client-secret';

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
const mockDb = require('./fixtures/fakeMongo').create();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));

const { WORKSPACE, MEMBER, serveModule, tokenFor } = require('./fixtures/workspaceScoping');

/* Sign-in step: the caller has no session yet (public by design in tests/conventions/route-guard-coverage.test.js), the provider's authorization code is the credential,
 * and the handler holds no workspace data: it opens no database and sends the provider nothing but the code and the instance's own client credentials. */
const ROUTES = [
    { method: 'POST', path: '/api/v1/google/access-token' },
];

let app;
let providerCalls;
const realFetch = global.fetch;

beforeAll(async () => {
    app = await serveModule((server) => require('../Modules/googleOAuth/routes').init(server));
    global.fetch = jest.fn((url, init) => (String(url).startsWith('https://google.example.test')
        ? (providerCalls.push({ url: String(url), init }), Promise.resolve({ json: async () => providerReply }))
        : realFetch(url, init)));
});
afterAll(async () => {
    global.fetch = realFetch;
    await app.close();
});

let providerReply;
beforeEach(() => {
    mockDb.calls.length = 0;
    providerCalls = [];
    providerReply = { access_token: 'ya29.token', expires_in: 3599 };
});

describe.each(ROUTES)('$method $path', ({ method, path }) => {
    it('answers a caller without a session, since the code is the credential, and makes no database call', async () => {
        const res = await app.call(method, path, { body: { code: 'abc' } });
        expect(res.status).toBe(200);
        expect(res.body).toEqual(providerReply);
        expect(mockDb.calls).toEqual([]);
    });

    it.each([
        ['a session for the workspace', { token: tokenFor(MEMBER), companyId: WORKSPACE }],
        ['a workspace named only in the body', { body: { companyId: WORKSPACE } }],
    ])('sends the provider only the code and the client credentials, with %s', async (label, extra) => {
        const res = await app.call(method, path, { ...extra, body: { code: 'abc', ...(extra.body || {}) } });
        expect(res.status).toBe(200);
        expect(providerCalls).toHaveLength(1);
        expect(Object.fromEntries(new URLSearchParams(providerCalls[0].init.body))).toEqual({
            code: 'abc',
            client_id: 'client-id',
            client_secret: 'client-secret',
            redirect_uri: 'postmessage',
            grant_type: 'authorization_code',
        });
        expect(mockDb.calls).toEqual([]);
    });

    it('refuses a request with no code before it reaches the provider', async () => {
        const res = await app.call(method, path, { body: {} });
        expect(res.status).toBe(400);
        expect(providerCalls).toEqual([]);
        expect(mockDb.calls).toEqual([]);
    });

    it('refuses with 400 and no token when the provider refuses the code', async () => {
        providerReply = { error: 'invalid_grant', error_description: 'Bad Request' };
        const res = await app.call(method, path, { body: { code: 'stale' } });
        expect(res.status).toBe(400);
        expect(res.body.access_token).toBeUndefined();
        expect(mockDb.calls).toEqual([]);
    });
});
