jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));
jest.mock('../utils/envUpdater', () => ({
    getEnvVariablesUtil: jest.fn(),
    updateEnvVariablesUtil: jest.fn(async () => 'Updated'),
}));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { getEnvVariablesUtil, updateEnvVariablesUtil } = require('../utils/envUpdater');
const { myCache } = require('../Config/config');
const { signSession, startApp } = require('./fixtures/sessionApp');
const { validateOAuthUpdate, maskOAuthCred } = require('../Modules/OAuth/helpers/oauthSettingsRules');
const oauthRoutes = require('../Modules/OAuth/routes');

const COMPANY = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000001';
const MEMBER = '6f0000000000000000000003';

describe('validateOAuthUpdate', () => {
    it('accepts the OAuth client keys', () => {
        const result = validateOAuthUpdate('root', [
            { variableName: 'GOOGLE_CLIENT_ID', variableValue: '123-abc.apps.googleusercontent.com' },
            { variableName: 'GOOGLE_CLIENT_SECRET', variableValue: 'GOCSPX-abc_DEF' },
        ]);
        expect(result.ok).toBe(true);
    });

    it('normalises the login flags to true/false strings', () => {
        const result = validateOAuthUpdate('frontend', [{ variableName: 'VUE_APP_IS_GITHUB_LOGIN', variableValue: true }]);
        expect(result.variables).toEqual([{ variableName: 'VUE_APP_IS_GITHUB_LOGIN', variableValue: 'true' }]);
    });

    it.each([
        ['an arbitrary key', 'root', [{ variableName: 'JWT_SECRET', variableValue: 'x' }]],
        ['a key from the other file', 'frontend', [{ variableName: 'GOOGLE_CLIENT_SECRET', variableValue: 'x' }]],
        ['the admin file', 'admin', [{ variableName: 'GOOGLE_CLIENT_ID', variableValue: 'x' }]],
        ['a newline that injects a variable', 'root', [{ variableName: 'GOOGLE_CLIENT_ID', variableValue: 'x"\nJWT_SECRET="owned' }]],
        ['a quote', 'root', [{ variableName: 'GOOGLE_CLIENT_ID', variableValue: 'x"' }]],
        ['a non-boolean login flag', 'frontend', [{ variableName: 'VUE_APP_IS_GOOGLE_LOGIN', variableValue: 'yes' }]],
        ['a duplicate key', 'root', [{ variableName: 'GITHUB_CLIENT_ID', variableValue: 'a' }, { variableName: 'GITHUB_CLIENT_ID', variableValue: 'b' }]],
        ['an empty list', 'root', []],
    ])('refuses %s', (label, pathType, variables) => {
        expect(validateOAuthUpdate(pathType, variables).ok).toBe(false);
    });
});

describe('maskOAuthCred', () => {
    it('reports whether each secret is set without returning it', () => {
        const masked = maskOAuthCred({ GOOGLE_CLIENT_SECRET: 's1', GITLAB_CLIENT_SECRET: '' }, {});
        expect(JSON.stringify(masked)).not.toContain('s1');
        expect(masked).toMatchObject({ clientSecretSet: true, githubClientSecretSet: false, gitlabClientSecretSet: false });
    });
});

describe('ACC-04 /api/v1/settings/oauth', () => {
    let app;

    beforeAll(async () => {
        app = await startApp((server) => oauthRoutes.init(server));
    });
    afterAll(() => app.close());

    beforeEach(() => {
        myCache.flushAll();
        updateEnvVariablesUtil.mockClear();
        getEnvVariablesUtil.mockImplementation(async (pathType) => (pathType === 'root'
            ? { GOOGLE_CLIENT_ID: 'client-id', GOOGLE_CLIENT_SECRET: 'super-secret', GITHUB_CLIENT_SECRET: 'gh-secret' }
            : { VUE_APP_IS_GOOGLE_LOGIN: 'true' }));
        MongoDbCrudOpration.mockImplementation(async (db, obj) => ({ isProductOwner: String(obj.data[0]._id) === OWNER }));
    });

    it('refuses an anonymous read', async () => {
        const res = await app.call('GET', '/api/v1/settings/oauth');
        expect(res.status).toBe(401);
        expect(JSON.stringify(res.body)).not.toContain('super-secret');
    });

    it('refuses an anonymous write', async () => {
        const res = await app.call('POST', '/api/v1/settings/oauth', { body: { pathType: 'root', variables: [{ variableName: 'GOOGLE_CLIENT_ID', variableValue: 'x' }] } });
        expect(res.status).toBe(401);
        expect(updateEnvVariablesUtil).not.toHaveBeenCalled();
    });

    it('refuses a company member who is not the instance owner', async () => {
        const res = await app.call('GET', '/api/v1/settings/oauth', { token: signSession(MEMBER, [COMPANY]) });
        expect(res.status).toBe(403);
    });

    it('shows the instance owner which secrets are set, never their values', async () => {
        const res = await app.call('GET', '/api/v1/settings/oauth', { token: signSession(OWNER, [COMPANY]) });
        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body)).not.toMatch(/super-secret|gh-secret/);
        expect(res.body.data).toMatchObject({ clientId: 'client-id', clientSecretSet: true, githubClientSecretSet: true, gitlabClientSecretSet: false, isGoogleLogin: true });
    });

    it('refuses the instance owner writing a key outside the OAuth allowlist', async () => {
        const res = await app.call('POST', '/api/v1/settings/oauth', {
            token: signSession(OWNER, [COMPANY]),
            body: { pathType: 'root', variables: [{ variableName: 'MONGODB_URL', variableValue: 'mongodb://evil' }] },
        });
        expect(res.status).toBe(400);
        expect(updateEnvVariablesUtil).not.toHaveBeenCalled();
    });

    it('writes validated OAuth keys for the instance owner', async () => {
        const variables = [{ variableName: 'GITHUB_CLIENT_ID', variableValue: 'Iv1.abc123' }];
        const res = await app.call('POST', '/api/v1/settings/oauth', { token: signSession(OWNER, [COMPANY]), body: { pathType: 'root', variables } });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: true, statusText: 'Updated' });
        expect(updateEnvVariablesUtil).toHaveBeenCalledWith('root', variables);
    });
});
