const { createApiClient } = require('../../e2e/support/api');
const { emailFor, login, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const anonymous = createApiClient({ baseURL: state.baseURL });
const GRANTS = { isProductOwner: true, isVesionUpdate: true, customerId: 'cus_signup', customerIds: ['cus_signup'], webTokens: ['x'], agentAccount: { mode: 'x' } };

const expectNoGrants = (doc) => {
    ['isProductOwner', 'isVesionUpdate', 'customerId', 'agentAccount'].forEach((field) => expect([field, doc[field]]).toEqual([field, undefined]));
    expect(doc.customerIds || []).toEqual([]);
    expect(doc.webTokens || []).toEqual([]);
};

/* One login per role per file: the refresh token is derived from the second a session starts. */
let ownerSession;
const owner = async () => {
    if (!ownerSession) ownerSession = await loginAs('owner');
    return ownerSession;
};

const sessionFor = async (email) => {
    const session = await login(state.baseURL, email);
    return createApiClient({ baseURL: state.baseURL, accessToken: session.accessToken, companyId: state.companyId });
};

describe('a signup request never grants instance ownership', () => {
    it('drops ownership, billing and token fields from an anonymous signup', async () => {
        const email = `signup.stranger.${uniqueSuffix()}@e2e.alianhub.test`;
        const res = await anonymous.post('/api/v2/createUser', { firstName: 'Sam', lastName: 'Stranger', email, password: state.password, ...GRANTS });

        expect(res.body.status).toBe(true);
        expectNoGrants(res.body.statusText);
        expect(res.body.statusText.isEmailVerified).toBe(false);
    });

    it('keeps an invitee who asks for ownership out of the instance console', async () => {
        const { api: ownerApi } = await owner();
        const email = emailFor('member', `own${uniqueSuffix()}`);
        const invite = await ownerApi.post('/api/v2/sendInvitationEmail', { email, companyId: state.companyId, companyName: 'E2E Workspace', role: 3, designation: 0 });
        expect(invite.status).toBe(200);

        const created = await anonymous.post('/api/v2/createUser', {
            firstName: 'Ivy', lastName: 'Invitee', email, password: state.password, isInvitation: true, assignCompany: state.companyId, ...GRANTS,
        });
        expect(created.body.status).toBe(true);
        expect(created.body.statusText.isEmailVerified).toBe(true);

        const invitee = await sessionFor(email);
        const access = await invitee.get('/api/v2/instance/access');
        expect(access.status).toBe(403);
        const settings = await invitee.get('/api/v2/instance/settings');
        expect(settings.status).toBe(403);
        expectNoGrants(created.body.statusText);
        const check = await invitee.post('/api/v1/userAndCompanyCheck', {});
        expect(check.body.data.userData.isProductOwner).toBeUndefined();
    });

    it.each([
        ['/api/v2/google-signup', 'googleId'],
        ['/api/v2/github-signup', 'githubId'],
        ['/api/v2/gitlab-signup', 'gitlabId'],
    ])('drops ownership from %s', async (path, idField) => {
        const suffix = uniqueSuffix();
        const res = await anonymous.post(path, {
            firstName: 'Olly', lastName: 'Oauth', email: `signup.oauth.${suffix}@e2e.alianhub.test`, [idField]: `id-${suffix}`, ...GRANTS,
        });

        expect(res.status).toBe(200);
        expectNoGrants(res.body.data);
    });
});

describe('the setup wizard still creates the instance owner', () => {
    it('lets the account that ran setup into the instance console', async () => {
        const { api, uid } = await owner();
        expect(uid).toBe(state.users.owner.userId);

        const access = await api.get('/api/v2/instance/access');
        expect(access.status).toBe(200);
        expect(access.body.data).toEqual({ allowed: true, via: 'owner' });

        const check = await api.post('/api/v1/userAndCompanyCheck', {});
        expect(check.body.data.userData.isProductOwner).toBe(true);
    });

    it('refuses a second run of the wizard, so it cannot mint another owner', async () => {
        const email = `setup.again.${uniqueSuffix()}@e2e.alianhub.test`;
        const res = await anonymous.post('/api/v2/setup/complete', {
            firstName: 'Second', lastName: 'Owner', email, password: state.password, companyName: `Again ${uniqueSuffix()}`, sampleData: false,
        });

        expect(res.status).toBe(409);
        const signIn = await anonymous.post('/api/v2/auth/login', { email, password: state.password });
        expect(signIn.body.accessToken).toBeUndefined();
    });
});
