const { createApiClient } = require('../../e2e/support/api');
const { loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const anon = createApiClient({ baseURL: state.baseURL });
const SECRET_FIELDS = ['webTokens', 'verificationToken', 'verificationTokenTime', 'forgotPasswordToken', 'forgotPasswordTokenTime', 'passwordHash', 'twoFactor'];
const exposesSecret = (body) => SECRET_FIELDS.some((field) => JSON.stringify(body || {}).includes(`"${field}"`));
const CHECK = '/api/v1/userAndCompanyCheck';

async function signUpStranger() {
    const email = `check.stranger.${uniqueSuffix()}@e2e.alianhub.test`;
    const res = await anon.post('/api/v2/createUser', { firstName: 'Sam', lastName: 'Stranger', email, password: state.password });
    expect(res.body.status).toBe(true);
    return String(res.body.statusText._id);
}

describe('POST /api/v1/userAndCompanyCheck answers only for the signed-in user', () => {
    it('refuses an anonymous caller', async () => {
        const res = await anon.post(CHECK, { userId: state.users.owner.userId });
        expect(res.status).toBe(401);
    });

    it('gives the owner their own account and workspace without secrets', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.post(CHECK, { userId: owner.uid });

        expect(res.status).toBe(200);
        expect(res.body.status).toBe(true);
        const { userData, companyId, isCompanyFind, companies } = res.body.data;
        expect(isCompanyFind).toBe(true);
        expect(String(companyId)).toBe(state.companyId);
        expect(String(userData._id)).toBe(owner.uid);
        expect(userData.isEmailVerified).toBe(true);
        expect(userData.Employee_Email).toBe(state.users.owner.email);
        expect(userData.AssignCompany).toContain(state.companyId);
        expect(companies.map((c) => String(c._id))).toContain(state.companyId);
        expect(exposesSecret(res.body)).toBe(false);
    });

    it('answers for the caller when no userId is sent', async () => {
        const member = await loginAs('member');
        const res = await member.api.post(CHECK, {});
        expect(res.status).toBe(200);
        expect(String(res.body.data.userData._id)).toBe(member.uid);
        expect(exposesSecret(res.body)).toBe(false);
    });

    it('refuses a member asking about the owner', async () => {
        const member = await loginAs('member');
        const res = await member.api.post(CHECK, { userId: state.users.owner.userId });
        expect(res.status).toBe(403);
        expect(res.body.status).toBe(false);
        expect(res.body.data).toBeUndefined();
    });

    it('refuses a guest reading an unrelated sign-up, so its verification token stays private', async () => {
        const strangerId = await signUpStranger();
        const guest = await loginAs('guest');
        const res = await guest.api.post(CHECK, { userId: strangerId });
        expect(res.status).toBe(403);
        expect(res.body.data).toBeUndefined();
        expect(exposesSecret(res.body)).toBe(false);
    });
});
