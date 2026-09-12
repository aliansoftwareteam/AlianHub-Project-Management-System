const { createApiClient } = require('../../e2e/support/api');
const { readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const anon = createApiClient({ baseURL: state.baseURL });
const SECRET_FIELDS = ['webTokens', 'verificationToken', 'verificationTokenTime', 'forgotPasswordToken', 'forgotPasswordTokenTime', 'passwordHash', 'twoFactor', 'customerId', 'customerIds', 'isProductOwner'];
const exposesSecret = (body) => SECRET_FIELDS.some((field) => JSON.stringify(body || {}).includes(`"${field}"`));

/* Every string in the refusal, so a token hidden under any key would still be tried. */
const stringsIn = (value) => {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(stringsIn);
    if (value && typeof value === 'object') return Object.values(value).flatMap(stringsIn);
    return [];
};

async function signUpUnverified() {
    const email = `login.unverified.${uniqueSuffix()}@e2e.alianhub.test`;
    const created = await anon.post('/api/v2/createUser', { firstName: 'Una', lastName: 'Verified', email, password: state.password });
    expect(created.body.status).toBe(true);
    const uid = String(created.body.statusText._id);
    // Mail points at a closed port, so this fails to send — but it stores the verification token first.
    await anon.post('/api/v2/sendVerificationEmail', { uid });
    return { uid, email, created };
}

describe('an unverified login refusal carries no verification token', () => {
    it('answers the signup itself with a self view only', async () => {
        const { created } = await signUpUnverified();
        expect(created.body.statusText.isEmailVerified).toBe(false);
        expect(exposesSecret(created.body)).toBe(false);
    });

    it('refuses the login and cannot be replayed at verifyEmail', async () => {
        const { uid, email } = await signUpUnverified();

        const refused = await anon.post('/api/v2/auth/login', { email, password: state.password });
        expect(refused.status).toBe(400);
        expect(refused.body.isEmailVerified).toBe(false);
        expect(String(refused.body.userData._id)).toBe(uid);
        expect(refused.body.userData.Employee_Email).toBe(email);
        expect(refused.body.userData.AssignCompany).toEqual([]);

        for (const token of stringsIn(refused.body)) {
            const attempt = await anon.post('/api/v2/verifyEmail', { uid, token });
            expect(attempt.body.status).toBe(false);
        }
        expect(exposesSecret(refused.body)).toBe(false);

        const stillRefused = await anon.post('/api/v2/auth/login', { email, password: state.password });
        expect(stillRefused.status).toBe(400);
        expect(stillRefused.body.isEmailVerified).toBe(false);
    });

    it.each([
        ['/api/v2/google-signup', 'googleId'],
        ['/api/v2/github-signup', 'githubId'],
        ['/api/v2/gitlab-signup', 'gitlabId'],
    ])('answers %s with a self view only', async (path, idField) => {
        const suffix = uniqueSuffix();
        const res = await anon.post(path, {
            firstName: 'Olly', lastName: 'Oauth', email: `selfview.oauth.${suffix}@e2e.alianhub.test`, [idField]: `id-${suffix}`,
        });

        expect(res.status).toBe(200);
        expect(res.body.data.isEmailVerified).toBe(true);
        expect(exposesSecret(res.body)).toBe(false);
    });
});
