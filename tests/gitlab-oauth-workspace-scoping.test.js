process.env.GITLAB_BASE_OAUTH_URL = 'https://gitlab.example.test/oauth';
process.env.GITLAB_CLIENT_ID = 'client-id';
process.env.GITLAB_CLIENT_SECRET = 'client-secret';

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('axios', () => ({ post: jest.fn() }));
const mockDb = require('./fixtures/fakeMongo').create();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));

const axios = require('axios');
const { WORKSPACE, MEMBER, serveModule, tokenFor } = require('./fixtures/workspaceScoping');

/* Sign-in step: the caller has no session yet (public by design in tests/conventions/route-guard-coverage.test.js), the provider's authorization code is the credential,
 * and the handler holds no workspace data: it opens no database and sends the provider nothing but the code, the redirect and the instance's own client credentials. */
const ROUTES = [
    { method: 'POST', path: '/api/v1/gitlab/access-token' },
];

let app;
beforeAll(async () => { app = await serveModule((server) => require('../Modules/gitlabOAuth/routes').init(server)); });
afterAll(() => app.close());

beforeEach(() => {
    mockDb.calls.length = 0;
    axios.post.mockReset();
    axios.post.mockResolvedValue({ data: { access_token: 'glpat_token' } });
});

describe.each(ROUTES)('$method $path', ({ method, path }) => {
    it('answers a caller without a session, since the code is the credential, and makes no database call', async () => {
        const res = await app.call(method, path, { body: { code: 'abc', redirectUri: 'https://hub.example.test/cb' } });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: true, accessToken: 'glpat_token' });
        expect(mockDb.calls).toEqual([]);
    });

    it.each([
        ['a session for the workspace', { token: tokenFor(MEMBER), companyId: WORKSPACE }],
        ['a workspace named only in the body', { body: { companyId: WORKSPACE } }],
    ])('sends the provider only the code, the redirect and the client credentials, with %s', async (label, extra) => {
        const res = await app.call(method, path, { ...extra, body: { code: 'abc', redirectUri: 'https://hub.example.test/cb', ...(extra.body || {}) } });
        expect(res.status).toBe(200);
        expect(axios.post).toHaveBeenCalledTimes(1);
        const [url, payload] = axios.post.mock.calls[0];
        expect(url).toBe('https://gitlab.example.test/oauth/token');
        expect(payload).toEqual({
            client_id: 'client-id',
            client_secret: 'client-secret',
            code: 'abc',
            grant_type: 'authorization_code',
            redirect_uri: 'https://hub.example.test/cb',
        });
        expect(mockDb.calls).toEqual([]);
    });

    it('refuses a request with no code before it reaches the provider', async () => {
        const res = await app.call(method, path, { body: {} });
        expect(res.body).toEqual({ status: false, statusText: 'Missing authorization code' });
        expect(axios.post).not.toHaveBeenCalled();
        expect(mockDb.calls).toEqual([]);
    });

    it('answers status false, not a token, when the provider refuses', async () => {
        axios.post.mockRejectedValue(new Error('invalid_grant'));
        const res = await app.call(method, path, { body: { code: 'stale' } });
        expect(res.body.status).toBe(false);
        expect(res.body.accessToken).toBeUndefined();
        expect(mockDb.calls).toEqual([]);
    });
});
