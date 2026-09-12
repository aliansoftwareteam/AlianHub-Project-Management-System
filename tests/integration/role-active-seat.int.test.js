const { createApiClient } = require('../../e2e/support/api');
const { PASSWORD, assertOk, login, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const companyId = state.companyId;

/* One invited admin per test, taken exactly as far through the invitation as that test needs:
 * `invite` stops at the pending company_users row, `register` gives them an account and a session
 * whose token already carries the company, and `accept` is the call Invitation.vue makes last. */
async function invite(ownerApi, role = 2) {
    const email = `seat-${uniqueSuffix()}@e2e.alianhub.test`;
    const res = await ownerApi.post('/api/v2/sendInvitationEmail', {
        email, companyId, companyName: state.companyName, role, designation: 0,
    });
    const row = res.body && res.body.data;
    if (!row || !row._id) throw new Error(`invite failed (${res.status}): ${JSON.stringify(res.body).slice(0, 300)}`);
    return { email, memberId: String(row._id) };
}

async function register(invited) {
    const anon = createApiClient({ baseURL: state.baseURL });
    assertOk(await anon.post('/api/v2/createUser', {
        firstName: 'Seat', lastName: 'Test', email: invited.email, password: PASSWORD, isInvitation: true, assignCompany: companyId,
    }), `register ${invited.email}`);
    const session = await login(state.baseURL, invited.email);
    return { ...invited, uid: session.uid, api: createApiClient({ baseURL: state.baseURL, accessToken: session.accessToken, companyId }) };
}

const accept = async (user) => assertOk(
    await user.api.put('/api/v1/root-members', { id: user.memberId, data: { userId: user.uid, status: 2 }, companyId }),
    `accept ${user.email}`,
);

let owner;

beforeAll(async () => {
    owner = await loginAs('owner');
});

describe('a role comes from a live company seat', () => {
    it('gives an invited admin nothing until they accept, and the audit log once they do', async () => {
        const user = await register(await invite(owner.api));

        const pending = await user.api.get('/api/v1/audit-logs');
        expect(pending.status).toBe(403);
        expect(pending.body).toMatchObject({ status: false, statusText: 'Owner/admin only.' });

        await accept(user);

        const accepted = await user.api.get('/api/v1/audit-logs');
        expect(accepted.status).toBe(200);
        expect(accepted.body.status).toBe(true);
    });

    it('takes the role back the moment the owner cancels the seat', async () => {
        const user = await register(await invite(owner.api));
        await accept(user);
        expect((await user.api.get('/api/v1/audit-logs')).body.status).toBe(true);

        assertOk(await owner.api.put('/api/v1/members', { id: user.memberId, data: { isDelete: true } }), 'remove member');

        const res = await user.api.get('/api/v1/audit-logs');
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ status: false, statusText: 'Owner/admin only.' });
    });
});

describe('the company routes that take their company from the body', () => {
    it('refuses a caller whose membership is gone, instead of running the handler', async () => {
        const user = await register(await invite(owner.api));
        await accept(user);
        assertOk(await owner.api.put('/api/v1/members', { id: user.memberId, data: { isDelete: true } }), 'remove member');
        assertOk(await owner.api.put('/api/v1/user', {
            userId: user.uid,
            updateObject: { $pull: { AssignCompany: companyId } },
            newObj: { returnDocument: 'after' },
        }), 'drop company from the user');

        for (const path of ['/api/v1/admin/company', '/api/v1/company-invitation']) {
            const res = await user.api.put(path, { updateObject: { Cst_CompanyName: 'Renamed' }, companyId });
            expect(res.status).toBe(403);
            expect(res.body).toMatchObject({ error: 'You are no longer a member of this company' });
        }
    });
});
