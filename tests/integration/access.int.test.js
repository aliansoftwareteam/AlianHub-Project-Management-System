const { createApiClient } = require('../../e2e/support/api');
const { loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const anon = createApiClient({ baseURL: state.baseURL });
const anonWithCompany = createApiClient({ baseURL: state.baseURL, companyId: state.companyId });
const refused = (res) => res.status === 401 || res.status === 403 || (res.body && res.body.status === false);
const randomId = () => uniqueSuffix() + uniqueSuffix() + uniqueSuffix() + uniqueSuffix();

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
    it.failing('ACC-01 refuses an anonymous arbitrary Mongo operation', async () => {
        const res = await anon.post('/api/v1/mongoOpration', {
            dbName: 'global', collection: 'users', methodName: 'countDocuments', dataObj: [{}],
        });
        expect(res.status).toBe(401);
    });

    // ACC-02: POST /api/v1/generateToken mints a JWT for any uid with no password.
    it.failing('ACC-02 refuses minting a token for an arbitrary user id', async () => {
        const owner = await loginAs('owner');
        const res = await anon.post('/api/v1/generateToken', { uid: owner.uid });
        expect(refused(res)).toBe(true);
        expect(res.body && res.body.token).toBeFalsy();
    });

    // ACC-03: /api/v2/session/* is unauthenticated (forge a session; wipe sessions).
    it.failing('ACC-03 refuses registering a session anonymously', async () => {
        const owner = await loginAs('owner');
        const res = await anon.post('/api/v2/session/register', { userId: owner.uid });
        expect(refused(res)).toBe(true);
    });

    it.failing('ACC-03 refuses deleting another user\'s sessions anonymously', async () => {
        const res = await anon.delete(`/api/v2/session/delete/${randomId()}`);
        expect(res.status).toBe(401);
    });

    // ACC-04: /api/v1/settings/oauth reads secrets and rewrites .env with no auth.
    it.failing('ACC-04 refuses reading OAuth credentials anonymously', async () => {
        const res = await anon.get('/api/v1/settings/oauth');
        expect(res.status).toBe(401);
    });

    // ACC-05: user routes are jwt-only, unscoped — any role reads/edits any user.
    it.failing('ACC-05 refuses a guest reading another user by id', async () => {
        const guest = await loginAs('guest');
        const res = await guest.api.get(`/api/v1/user/${state.users.owner.userId}`);
        expect(refused(res)).toBe(true);
    });

    it.failing('ACC-05 refuses a guest updating an arbitrary user', async () => {
        const guest = await loginAs('guest');
        const res = await guest.api.put('/api/v1/user', { userId: randomId(), updateObject: { isActive: true } });
        expect(refused(res)).toBe(true);
    });

    // ACC-06: admin company routes let any member/guest enumerate companies.
    it.failing('ACC-06 refuses a guest listing all companies via the admin route', async () => {
        const guest = await loginAs('guest');
        const res = await guest.api.post('/api/v1/admin/company', { fetchAllCompany: true, companyIds: [] });
        expect(refused(res)).toBe(true);
    });

    // ACC-07: manageTrackerUserPermission is unauthenticated.
    it.failing('ACC-07 refuses an anonymous tracker-permission change', async () => {
        const res = await anon.post('/api/v1/manageTrackerUserPermission', {
            CompanyId: state.companyId, DataObj: { ops: true, data: { status: 2, userId: randomId() } },
        });
        expect(refused(res)).toBe(true);
    });

    // ACC-08: change-password requires no session (only the old password).
    it.failing('ACC-08 refuses an anonymous change-password', async () => {
        const res = await anon.patch(`/api/v2/auth/${randomId()}/change-password`, { oldPassword: 'x', newPassword: 'y' });
        expect(res.status).toBe(401);
    });

    // ACC-09: checkSendInviatation is an unauthenticated membership oracle.
    it.failing('ACC-09 refuses an anonymous membership probe', async () => {
        const res = await anonWithCompany.post('/api/v1/checkSendInviatation', {
            email: state.users.member.email, companyId: state.companyId,
        });
        expect(res.status).toBe(401);
    });
});
