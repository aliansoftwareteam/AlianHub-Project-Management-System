const { createApiClient } = require('../../e2e/support/api');
const { loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const anon = createApiClient({ baseURL: state.baseURL });
const anonWithCompany = createApiClient({ baseURL: state.baseURL, companyId: state.companyId });
const refused = (res) => res.status === 401 || res.status === 403 || (res.body && res.body.status === false);
const randomId = () => uniqueSuffix() + uniqueSuffix() + uniqueSuffix() + uniqueSuffix();
const SECRET_FIELDS = ['webTokens', 'verificationToken', 'verificationTokenTime', 'forgotPasswordToken', 'forgotPasswordTokenTime', 'passwordHash'];
const exposesSecret = (doc) => SECRET_FIELDS.some((field) => doc && Object.prototype.hasOwnProperty.call(doc, field));

describe('access — authentication happy paths', () => {
    it('logs in every role', async () => {
        for (const role of ['owner', 'admin', 'member', 'guest']) {
            const session = await loginAs(role);
            expect(session.accessToken).toBeTruthy();
            expect(session.uid).toBe(state.users[role].userId);
        }
    });

    it('reports the instance as already set up', async () => {
        const res = await anon.get('/api/v2/setup/status');
        expect(res.status).toBe(200);
        expect(res.body.data.installed).toBe(true);
    });

    it('refuses a second setup on an installed instance', async () => {
        const res = await anon.post('/api/v2/setup/complete', {
            firstName: 'Dup', lastName: 'Owner', email: `dup.${uniqueSuffix()}@e2e.test`,
            password: state.password, companyName: `Dup ${uniqueSuffix()}`, sampleData: false,
        });
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.body.status).toBe(false);
    });
});

describe('access — SSO / SCIM admin config is owner/admin only', () => {
    it('lets an admin read SSO config', async () => {
        const admin = await loginAs('admin');
        const res = await admin.api.get('/api/v2/sso/config');
        expect(res.status).toBe(200);
    });

    it('refuses a member reading SSO config', async () => {
        const member = await loginAs('member');
        const res = await member.api.get('/api/v2/sso/config');
        expect(res.status).toBe(403);
    });

    it('lets an admin read SCIM config and refuses a guest', async () => {
        const admin = await loginAs('admin');
        const guest = await loginAs('guest');
        expect((await admin.api.get('/api/v2/scim/config')).status).toBe(200);
        expect((await guest.api.get('/api/v2/scim/config')).status).toBe(403);
    });

    it('rejects the SCIM protocol without a bearer token', async () => {
        const res = await anon.get('/scim/v2/Users');
        expect(res.status).toBe(401);
    });
});

describe('access — API tokens', () => {
    it('lets a user create, list and revoke their own token', async () => {
        const admin = await loginAs('admin');
        const created = await admin.api.post('/api/v2/api-tokens', { name: `[QA access] ${uniqueSuffix()}`, scopes: ['read'] });
        expect(created.status).toBe(200);
        const id = created.body.data && (created.body.data._id || created.body.data.id);
        expect(id).toBeTruthy();

        const list = await admin.api.get('/api/v2/api-tokens');
        expect(list.body.data.some((t) => String(t._id || t.id) === String(id))).toBe(true);

        const del = await admin.api.delete(`/api/v2/api-tokens/${id}`);
        expect(del.status).toBe(200);
        expect(del.body.status).toBe(true);
    });

    it('shows a user only their own tokens', async () => {
        const admin = await loginAs('admin');
        const member = await loginAs('member');
        const created = await admin.api.post('/api/v2/api-tokens', { name: `[QA access] ${uniqueSuffix()}`, scopes: ['read'] });
        const id = created.body.data && (created.body.data._id || created.body.data.id);
        try {
            const memberList = await member.api.get('/api/v2/api-tokens');
            expect(memberList.body.data.every((t) => String(t._id || t.id) !== String(id))).toBe(true);
        } finally {
            await admin.api.delete(`/api/v2/api-tokens/${id}`);
        }
    });

    it('rejects the public API namespace without a token', async () => {
        expect((await anon.get('/api/public-v1/projects')).status).toBe(401);
    });
});

describe('access — regression tests for confirmed findings (flip to it() once fixed)', () => {
    // ACC-01: POST /api/v1/mongoOpration runs arbitrary Mongo with no auth.
    it('ACC-01 refuses an anonymous arbitrary Mongo operation', async () => {
        const res = await anon.post('/api/v1/mongoOpration', {
            dbName: 'global', collection: 'users', methodName: 'countDocuments', dataObj: [{}],
        });
        expect(res.status).toBe(401);
    });

    it('ACC-02 refuses minting a token for an arbitrary user id', async () => {
        const owner = await loginAs('owner');
        const res = await anon.post('/api/v1/generateToken', { uid: owner.uid });
        expect([401, 403, 404]).toContain(res.status);
        expect(res.body && res.body.token).toBeFalsy();
    });

    it('ACC-03 refuses registering a session anonymously', async () => {
        const owner = await loginAs('owner');
        const res = await anon.post('/api/v2/session/register', { userId: owner.uid });
        expect([401, 403, 404]).toContain(res.status);
        expect(res.body && res.body.data && res.body.data.refreshToken).toBeFalsy();
    });

    it('ACC-03 refuses deleting another user\'s sessions anonymously', async () => {
        const res = await anon.delete(`/api/v2/session/delete/${randomId()}`);
        expect(res.status).toBe(401);
    });

    // ACC-04: /api/v1/settings/oauth reads secrets and rewrites .env with no auth.
    it('ACC-04 refuses reading OAuth credentials anonymously', async () => {
        const res = await anon.get('/api/v1/settings/oauth');
        expect(res.status).toBe(401);
    });

    // A teammate's public profile stays readable because the member list needs it;
    // secrets and users of other companies do not.
    it('ACC-05 gives a guest only the public profile of another user', async () => {
        const guest = await loginAs('guest');
        const res = await guest.api.get(`/api/v1/user/${state.users.owner.userId}`);
        expect(res.status).toBe(200);
        expect(exposesSecret(res.body)).toBe(false);
        expect(res.body.isProductOwner).toBeUndefined();
    });

    it('ACC-05 refuses a guest updating an arbitrary user', async () => {
        const guest = await loginAs('guest');
        const res = await guest.api.put('/api/v1/user', { userId: randomId(), updateObject: { isActive: true } });
        expect(refused(res)).toBe(true);
    });

    it('ACC-06 refuses a guest listing all companies via the admin route', async () => {
        const guest = await loginAs('guest');
        const res = await guest.api.post('/api/v1/admin/company', { fetchAllCompany: true, companyIds: [] });
        expect(refused(res)).toBe(true);
    });

    // ACC-07: manageTrackerUserPermission is unauthenticated.
    it('ACC-07 refuses an anonymous tracker-permission change', async () => {
        const res = await anon.post('/api/v1/manageTrackerUserPermission', {
            CompanyId: state.companyId, DataObj: { ops: true, data: { status: 2, userId: randomId() } },
        });
        expect(refused(res)).toBe(true);
    });

    // ACC-08: change-password requires no session (only the old password).
    it('ACC-08 refuses an anonymous change-password', async () => {
        const res = await anon.patch(`/api/v2/auth/${randomId()}/change-password`, { oldPassword: 'x', newPassword: 'y' });
        expect(res.status).toBe(401);
    });

    // ACC-09: checkSendInviatation is an unauthenticated membership oracle.
    it('ACC-09 refuses an anonymous membership probe', async () => {
        const res = await anonWithCompany.post('/api/v1/checkSendInviatation', {
            email: state.users.member.email, companyId: state.companyId,
        });
        expect(res.status).toBe(401);
    });
});

describe('access — sessions are the caller\'s own', () => {
    it('refuses deleting every session anonymously', async () => {
        expect((await anon.delete('/api/v2/session/delete')).status).toBe(401);
    });

    it('refuses a member signing out the admin', async () => {
        const member = await loginAs('member');
        expect((await member.api.delete(`/api/v2/session/delete/${state.users.admin.userId}`)).status).toBe(403);
    });

    it('lets a user sign out their own sessions, as change-password does', async () => {
        const guest = await loginAs('guest');
        expect((await guest.api.delete(`/api/v2/session/delete/${guest.uid}`)).status).toBe(200);
        expect((await guest.api.get('/api/v2/users/sessions')).status).toBe(401);
    });
});

describe('access — OAuth settings mask secrets and accept only OAuth keys', () => {
    it('refuses a company admin who is not the instance owner', async () => {
        const admin = await loginAs('admin');
        expect((await admin.api.get('/api/v1/settings/oauth')).status).toBe(403);
    });

    it('shows the instance owner whether secrets are set, never their values', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.get('/api/v1/settings/oauth');
        expect(res.status).toBe(200);
        expect(res.body.data).not.toHaveProperty('clientSecret');
        expect(res.body.data).not.toHaveProperty('githubClientSecret');
        expect(res.body.data).toHaveProperty('clientSecretSet');
    });

    it('refuses the instance owner writing a key outside the OAuth allowlist', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.post('/api/v1/settings/oauth', { pathType: 'root', variables: [{ variableName: 'JWT_SECRET', variableValue: 'x' }] });
        expect(res.status).toBe(400);
    });
});

describe('access — user routes are scoped to shared companies', () => {
    it('returns the owner their own profile without secrets', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.get(`/api/v1/user/${owner.uid}`);
        expect(res.status).toBe(200);
        expect(res.body.isProductOwner).toBe(true);
        expect(exposesSecret(res.body)).toBe(false);
    });

    it('does not reveal an unknown user id', async () => {
        const guest = await loginAs('guest');
        expect((await guest.api.get(`/api/v1/user/${randomId()}`)).status).toBe(404);
    });

    it('lists only the caller company members, without secrets', async () => {
        const guest = await loginAs('guest');
        const res = await guest.api.post('/api/v1/user/find', { query: { isActive: true }, companyId: state.companyId });
        expect(res.status).toBe(200);
        expect(res.body.length).toBeGreaterThanOrEqual(4);
        expect(res.body.every((user) => user.AssignCompany.includes(state.companyId) && !exposesSecret(user))).toBe(true);
    });

    it('refuses listing users of another company', async () => {
        const guest = await loginAs('guest');
        expect((await guest.api.post('/api/v1/user/find', { query: {}, companyId: randomId() })).status).toBe(403);
    });

    it('refuses a filter that probes a secret field', async () => {
        const guest = await loginAs('guest');
        const res = await guest.api.post('/api/v1/user/find', { query: { forgotPasswordToken: { $exists: true } }, companyId: state.companyId });
        expect(res.status).toBe(400);
    });

    it('refuses a guest deactivating the owner', async () => {
        const guest = await loginAs('guest');
        const res = await guest.api.put('/api/v1/user', { userId: state.users.owner.userId, updateObject: { $set: { isActive: false } } });
        expect(res.status).toBe(403);
    });

    it('refuses a guest making themself instance owner', async () => {
        const guest = await loginAs('guest');
        const res = await guest.api.put('/api/v1/user', { userId: guest.uid, updateObject: { $set: { isProductOwner: true } } });
        expect(res.status).toBe(403);
    });

    it('lets a user save their own profile preferences', async () => {
        const member = await loginAs('member');
        const res = await member.api.put('/api/v1/user', { userId: member.uid, updateObject: { $set: { Time_Format: '24' } }, newObj: { returnDocument: 'after' } });
        expect(res.status).toBe(200);
        expect(res.body.data.Time_Format).toBe('24');
        expect(exposesSecret(res.body.data)).toBe(false);
    });
});

describe('access — company reads are the caller\'s own companies', () => {
    it('returns a guest only their own company', async () => {
        const guest = await loginAs('guest');
        const res = await guest.api.post('/api/v1/admin/company', { companyIds: [state.companyId, randomId()] });
        expect(res.status).toBe(200);
        expect(res.body.map((company) => String(company._id))).toEqual([state.companyId]);
    });

    it('scopes the aggregate route the desktop tracker uses', async () => {
        const guest = await loginAs('guest');
        const res = await guest.api.post('/api/v1/admin/company/find', { findQuery: [{ $match: {} }] });
        expect(res.status).toBe(200);
        expect(res.body.map((company) => String(company._id))).toEqual([state.companyId]);
    });

    it('refuses a guest joining another collection through the aggregate route', async () => {
        const guest = await loginAs('guest');
        const res = await guest.api.post('/api/v1/admin/company/find', { findQuery: [{ $lookup: { from: 'users', pipeline: [], as: 'users' } }] });
        expect(res.status).toBe(403);
    });

    it('lets the instance owner list every company', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.post('/api/v1/admin/company', { fetchAllCompany: true, companyIds: [] });
        expect(res.status).toBe(200);
        expect(res.body.some((company) => String(company._id) === state.companyId)).toBe(true);
    });
});

describe('access — only owners and admins change the company', () => {
    const readCompany = async (session) => (await session.api.post('/api/v1/admin/company', { companyIds: [state.companyId] })).body[0];

    it.each([
        ['member', '/api/v1/company'],
        ['member', '/api/v1/admin/company'],
        ['guest', '/api/v1/company-invitation'],
    ])('refuses a %s renaming the company through %s', async (role, path) => {
        const session = await loginAs(role);
        const before = await readCompany(session);
        const res = await session.api.put(path, { updateObject: { Cst_CompanyName: `Taken ${uniqueSuffix()}` }, companyId: state.companyId });
        expect(res.status).toBe(403);
        expect(res.body.status).toBe(false);
        expect((await readCompany(session)).Cst_CompanyName).toBe(before.Cst_CompanyName);
    });

    it('lets an admin save the company details', async () => {
        const admin = await loginAs('admin');
        const before = await readCompany(admin);
        const res = await admin.api.put('/api/v1/company', { updateObject: { Cst_CompanyName: before.Cst_CompanyName } });
        expect(res.status).toBe(200);
        expect(res.body.Cst_CompanyName).toBe(before.Cst_CompanyName);
    });

    it('lets a member switch a project between private and public', async () => {
        const member = await loginAs('member');
        const swap = (toPrivate) => member.api.put('/api/v1/company', {
            key: '$inc',
            updateObject: { 'projectCount.privateCount': toPrivate ? 1 : -1, 'projectCount.publicCount': toPrivate ? -1 : 1 },
        });
        expect((await swap(true)).status).toBe(200);
        expect((await swap(false)).status).toBe(200);
    });

    it('refuses a guest releasing a seat', async () => {
        const guest = await loginAs('guest');
        const res = await guest.api.put('/api/v1/company', {
            key: '$inc',
            updateObject: { 'companyData.$[elementIndex].users': -1 },
            arrayFilters: [{ 'elementIndex.users': { $exists: true } }],
        });
        expect(res.status).toBe(403);
    });
});

describe('access — the invitation check stays inside the signed-in company', () => {
    it('refuses probing another company', async () => {
        const admin = await loginAs('admin');
        const res = await admin.api.post('/api/v1/checkSendInviatation', { email: state.users.member.email, companyId: randomId() });
        expect(res.status).toBe(403);
    });
});
