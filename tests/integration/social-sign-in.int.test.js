const { createApiClient } = require('../../e2e/support/api');
const { gitlabToken } = require('../../e2e/support/gitlab');
const { loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const anonymous = createApiClient({ baseURL: state.baseURL });

let ownerSession;
const owner = async () => {
    if (!ownerSession) ownerSession = await loginAs('owner');
    return ownerSession;
};

const gitlabIdFor = () => 700000 + parseInt(uniqueSuffix(), 16);

/* The browser sends the id and email it read from GitLab alongside the token, as GitlabAuth.vue does. */
const gitlabLogin = (identity, email) => anonymous.post('/api/v2/auth/login', {
    authProvider: 'gitlab', isLoginType: 'frontend', accessToken: gitlabToken(identity), gitlabId: String(identity.id), ...(email ? { email } : {}),
});

/* A verified password account with no GitLab link, made the way the fixtures make invitees. */
const passwordAccount = async () => {
    const email = `social.member.${uniqueSuffix()}@e2e.alianhub.test`;
    const { api } = await owner();
    const invite = await api.post('/api/v2/sendInvitationEmail', { email, companyId: state.companyId, companyName: 'E2E Workspace', role: 3, designation: 0 });
    expect(invite.status).toBe(200);
    const created = await anonymous.post('/api/v2/createUser', {
        firstName: 'Vic', lastName: 'Tim', email, password: state.password, isInvitation: true, assignCompany: state.companyId,
    });
    expect(created.body.status).toBe(true);
    return { email, userId: String(created.body.statusText._id) };
};

describe('social sign-in through /api/v2/auth/login binds to the provider identity', () => {
    it('refuses a provider account with no email that names another account', async () => {
        const member = await passwordAccount();

        const res = await gitlabLogin({ id: gitlabIdFor() }, member.email);

        expect(res.status).toBe(400);
        expect(res.body.accessToken).toBeUndefined();
    });

    it('refuses an email the provider has not confirmed', async () => {
        const member = await passwordAccount();

        const res = await gitlabLogin({ id: gitlabIdFor(), email: member.email, confirmed: false }, member.email);

        expect(res.status).toBe(400);
        expect(res.body.accessToken).toBeUndefined();
    });

    it('links an account by its confirmed email, then keeps it bound to that provider id', async () => {
        const account = await passwordAccount();
        const gitlabId = gitlabIdFor();

        const linked = await gitlabLogin({ id: gitlabId, email: account.email }, account.email);
        expect(linked.status).toBe(200);
        expect(String(linked.body.uid)).toBe(account.userId);
        expect(linked.body.accessToken).toBeTruthy();

        const again = await gitlabLogin({ id: gitlabId });
        expect(again.status).toBe(200);
        expect(String(again.body.uid)).toBe(account.userId);

        const otherId = await gitlabLogin({ id: gitlabIdFor(), email: account.email }, account.email);
        expect(otherId.status).toBe(400);
        expect(otherId.body.accessToken).toBeUndefined();
    });

    it('refuses a token GitLab does not accept', async () => {
        const member = await passwordAccount();

        const res = await anonymous.post('/api/v2/auth/login', {
            authProvider: 'gitlab', accessToken: 'not-a-gitlab-token', gitlabId: String(gitlabIdFor()), email: member.email,
        });

        expect(res.status).toBe(400);
        expect(res.body.accessToken).toBeUndefined();
    });
});

describe('social signup takes the account email from the provider', () => {
    it('creates a verified account for the confirmed GitLab email and signs it in', async () => {
        const email = `social.signup.${uniqueSuffix()}@e2e.alianhub.test`;
        const identity = { id: gitlabIdFor(), email };

        const signup = await anonymous.post('/api/v2/gitlab-signup', { firstName: 'Gil', lastName: 'Lab', email, gitlabId: String(identity.id), accessToken: gitlabToken(identity) });
        expect(signup.status).toBe(200);
        expect(signup.body.data).toMatchObject({ Employee_Email: email, isEmailVerified: true });

        const signedIn = await gitlabLogin(identity, email);
        expect(signedIn.status).toBe(200);
        expect(String(signedIn.body.uid)).toBe(String(signup.body.data._id));
    });

    it('refuses a GitLab signup whose email the provider has not confirmed', async () => {
        const email = `social.unconfirmed.${uniqueSuffix()}@e2e.alianhub.test`;

        const identity = { id: gitlabIdFor(), email, confirmed: false };

        const signup = await anonymous.post('/api/v2/gitlab-signup', {
            firstName: 'Gil', lastName: 'Lab', email, gitlabId: String(identity.id), accessToken: gitlabToken(identity),
        });

        expect(signup.status).toBeGreaterThanOrEqual(400);
        expect(signup.body.status).toBe(false);
    });

    it.each([
        ['/api/v2/google-signup', 'googleId'],
        ['/api/v2/github-signup', 'githubId'],
        ['/api/v2/gitlab-signup', 'gitlabId'],
    ])('refuses %s without a provider token', async (path, idField) => {
        const suffix = uniqueSuffix();
        const email = `social.tokenless.${suffix}@e2e.alianhub.test`;

        const signup = await anonymous.post(path, { firstName: 'No', lastName: 'Token', email, [idField]: `id-${suffix}` });

        expect(signup.status).toBeGreaterThanOrEqual(400);
        expect(signup.body.status).toBe(false);
    });
});
