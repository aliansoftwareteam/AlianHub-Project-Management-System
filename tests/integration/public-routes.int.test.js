const { createApiClient } = require('../../e2e/support/api');
const { loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const anonymous = createApiClient({ baseURL: state.baseURL });
const anonymousWithCompany = createApiClient({ baseURL: state.baseURL, companyId: state.companyId });

const REFUSED_WITHOUT_SESSION = [
    ['post', '/api/v1/removeCache', { global: true }],
    ['post', '/api/v1/mongoOpration', { dbName: 'global', collection: 'users', methodName: 'find', dataObj: [{}] }],
    ['put', '/api/v1/task', { firstParameter: {}, secondParameter: {}, key: 'deleteMany' }],
    ['post', '/api/v1/importTemplate', {}],
    ['post', '/api/v1/importSettingsNotification', {}],
    ['post', '/api/v1/export/csv', {}],
    ['post', '/api/v1/recurring-tasks/run-due', {}],
    ['get', '/api/v1/reminders'],
    ['post', '/api/v1/reminders/run-due', {}],
    ['get', '/api/v1/clips'],
    ['post', '/api/v3/timeTracker/start', {}],
    ['post', '/api/v3/timetracker/capture', {}],
    ['get', '/api/v2/timesheet-approval/queue'],
    ['post', '/api/v1/manageTrackerUserPermission', {}],
    ['post', '/api/v1/projectSetting/autoArchive', {}],
    ['post', '/api/v1/projectSetting/estimationScale', {}],
    ['post', '/api/v1/pushupdateunreadcommentscount', {}],
    ['post', '/api/v1/unsetCommentCounts', {}],
    ['post', '/api/v1/generatePrompt', {}],
    ['post', '/api/v1/generatePromptChat', {}],
    ['post', '/api/v1/deleteUserChat', {}],
    ['post', '/api/v1/getPrompts', {}],
    ['post', '/api/v1/ai/description', {}],
    ['put', '/api/v1/push-mark-read', {}],
    ['get', '/api/v1/setting/skills'],
    ['get', '/api/v1/milestoneRange'],
    ['post', '/api/v1/checkSendInviatation', {}],
    ['put', '/api/v1/notifications', {}],
    ['get', '/api/v1/notifications/000000000000000000000000'],
    ['get', '/api/v1/freeCompanyCount/000000000000000000000000'],
    ['post', '/api/v1/getUserProfile', { path: 'x.png' }],
    ['post', '/api/v1/getTaskTypeImage', { path: 'x.png' }],
    ['patch', '/api/v2/auth/000000000000000000000000/change-password', {}],
    ['delete', '/api/v2/session/delete/000000000000000000000000'],
    ['delete', '/api/v2/session/delete'],
    ['get', '/api/v1/settings/oauth'],
    ['post', '/api/v1/settings/oauth', {}],
    ['post', '/api/v1/updateEmailTemplate', {}],
    ['post', '/api/v1/updateAiModel', {}],
    ['post', '/api/v1/subscriptions', {}],
    ['post', '/api/v1/projectSetting/migrateSprintsFun', {}],
    ['post', '/api/v1/tracker/create', {}],
    ['post', '/api/v1/versionUpdateNotify', {}],
];

const withBody = (rows) => rows.map(([method, path, body]) => [method, path, body]);
const call = (api, method, path, body) => (method === 'get' || method === 'delete' ? api[method](path) : api[method](path, body));

describe('routes that answered without a session', () => {
    it.each(withBody(REFUSED_WITHOUT_SESSION))('%s %s answers 401 with only a company id', async (method, path, body) => {
        const res = await call(anonymousWithCompany, method, path, body);
        expect(res.status).toBe(401);
    });

    it.each([
        ['post', '/api/v2/session/register', { userId: '000000000000000000000000' }],
        ['post', '/api/v1/generateToken', { uid: '000000000000000000000000' }],
        ['post', '/api/v2/auth/register', { email: 'squat@e2e.alianhub.test', password: 'x' }],
    ])('%s %s is gone', async (method, path, body) => {
        const res = await call(anonymous, method, path, body);
        expect(res.status).toBe(404);
    });
});

describe('the same routes with a session', () => {
    it.each(withBody([
        ['get', '/api/v1/setting/skills'],
        ['get', '/api/v1/milestoneRange'],
        ['get', '/api/v1/reminders'],
        ['get', '/api/v1/clips'],
        ['get', '/api/v2/timesheet-approval/mine'],
        ['post', '/api/v1/getPrompts', {}],
        ['post', '/api/v1/export/csv', { columns: ['a'], rows: [['1']] }],
    ]))('%s %s answers a member', async (method, path, body) => {
        const { api } = await loginAs('member');
        const res = await call(api, method, path, body);
        expect([401, 403]).not.toContain(res.status);
        expect(res.status).toBeLessThan(500);
    });

    it('answers freeCompanyCount with a token and no company', async () => {
        const member = await loginAs('member');
        const api = createApiClient({ baseURL: state.baseURL, accessToken: member.accessToken });
        const res = await api.get(`/api/v1/freeCompanyCount/${member.uid}`);
        expect(res.status).toBe(200);
    });

    it('checks an invitation for the member company', async () => {
        const { api } = await loginAs('owner');
        const res = await api.post('/api/v1/checkSendInviatation', { email: state.users.member.email, companyId: state.companyId });
        expect(res.status).toBe(200);
    });

    it('reads the member own company through mongoOpration', async () => {
        const { api } = await loginAs('member');
        const res = await api.post('/api/v1/mongoOpration', {
            dbName: state.companyId, collection: 'timesheets', methodName: 'aggregate', dataObj: [[{ $match: { TicketID: state.tasks[0]._id } }]],
        });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(true);
        expect(Array.isArray(res.body.data)).toBe(true);
    });

    it.each([
        [{ dbName: 'global', collection: 'users', methodName: 'find', dataObj: [{}] }],
        [{ dbName: 'COMPANY', collection: 'tasks', methodName: 'deleteMany', dataObj: [{}] }],
        [{ dbName: 'COMPANY', collection: 'tasks', methodName: 'aggregate', dataObj: [[{ $match: {} }, { $out: 'stolen' }]] }],
    ])('refuses mongoOpration outside a read of the caller company %#', async (body) => {
        const { api } = await loginAs('member');
        const res = await api.post('/api/v1/mongoOpration', { ...body, dbName: body.dbName === 'COMPANY' ? state.companyId : body.dbName });
        expect(res.status).toBe(403);
    });

    it('refuses anything but the project cascade on PUT /api/v1/task', async () => {
        const { api } = await loginAs('member');
        const res = await api.put('/api/v1/task', { firstParameter: { _id: state.tasks[0]._id }, secondParameter: {}, key: 'deleteMany' });
        expect(res.status).toBe(403);
    });

    it('imports notification settings only for the caller', async () => {
        const member = await loginAs('member');
        const own = await member.api.post('/api/v1/importSettingsNotification', { companyId: state.companyId, userId: member.uid });
        expect(own.body.status).toBe(true);
        const other = await member.api.post('/api/v1/importSettingsNotification', { companyId: state.companyId, userId: state.users.owner.userId });
        expect(other.status).toBe(403);
    });

    it("refuses changing someone else's password", async () => {
        const { api } = await loginAs('member');
        const res = await api.patch(`/api/v2/auth/${state.users.owner.userId}/change-password`, { oldPassword: 'x', newPassword: 'y' });
        expect(res.status).toBe(403);
    });

    it('keeps instance settings to the instance owner', async () => {
        const member = await loginAs('member');
        expect((await member.api.get('/api/v1/settings/oauth')).status).toBe(403);
        const owner = await loginAs('owner');
        expect([401, 403]).not.toContain((await owner.api.get('/api/v1/settings/oauth')).status);
    });
});

describe('invitations', () => {
    it('previews a pending invitation without a session', async () => {
        const { api } = await loginAs('owner');
        const email = `preview-${uniqueSuffix()}@e2e.alianhub.test`;
        const invite = await api.post('/api/v2/sendInvitationEmail', { email, companyId: state.companyId, companyName: 'E2E', role: 3, designation: 0 });
        const res = await anonymous.post('/api/v2/auth/invitation-preview', { companyId: state.companyId, memberId: invite.body.data._id });
        expect(res.body.status).toBe(true);
        expect(res.body.data).toMatchObject({ status: 1, email });
        expect(res.body.data.workspaceName).toBeTruthy();
    });

    it('does not join a company the email was never invited to', async () => {
        const email = `uninvited-${uniqueSuffix()}@e2e.alianhub.test`;
        const res = await anonymous.post('/api/v2/createUser', {
            firstName: 'No', lastName: 'Invite', email, password: 'Str0ng!pass', isInvitation: true, assignCompany: state.companyId,
        });
        expect(res.body.status).toBe(true);
        expect(res.body.statusText.AssignCompany).toEqual([]);
        expect(res.body.statusText.isEmailVerified).toBe(false);
    });

    it('gives an existing account a 256-bit invitation link token', async () => {
        const email = `link-token-${uniqueSuffix()}@e2e.alianhub.test`;
        const created = await anonymous.post('/api/v2/createUser', { firstName: 'Link', lastName: 'Token', email, password: 'Str0ng!pass' });
        expect(created.body.status).toBe(true);
        const { api } = await loginAs('owner');
        const invite = await api.post('/api/v2/sendInvitationEmail', { email, companyId: state.companyId, companyName: 'E2E', role: 3, designation: 0 });
        expect(invite.body.data.linkId).toMatch(/^[0-9a-f]{64}$/);
    });
});

describe('verification email', () => {
    const password = 'Str0ng!pass';
    const newAccount = async () => {
        const email = `verify-${uniqueSuffix()}@e2e.alianhub.test`;
        const created = await anonymous.post('/api/v2/createUser', { firstName: 'Verify', lastName: 'Me', email, password });
        expect(created.body.status).toBe(true);
        return { email, uid: String(created.body.statusText._id) };
    };

    // The harness points mail at a closed port, so a resend the server accepts fails at delivery, after every refusal check.
    const expectDeliveryAttempted = (res) => {
        expect(res.status).toBe(200);
        expect(res.body.statusText).toMatch(/ECONNREFUSED/);
    };

    it('resends with only the account id the login screen gets from an unverified login', async () => {
        const { email, uid } = await newAccount();
        const login = await anonymous.post('/api/v2/auth/login', { email, password, isLoginType: 'frontend' });
        expect(login.status).toBe(400);
        expect(login.body.isEmailVerified).toBe(false);
        expect(String(login.body.userData._id)).toBe(uid);
        expectDeliveryAttempted(await anonymous.post('/api/v2/sendVerificationEmail', { uid: login.body.userData._id }));
    });

    it('resends with only the account id the verify-email screen reads from the link', async () => {
        const { uid } = await newAccount();
        const verify = await anonymous.post('/api/v2/verifyEmail', { uid, token: 'f'.repeat(64) });
        expect(verify.body.showResendVerification).toBe(true);
        expectDeliveryAttempted(await anonymous.post('/api/v2/sendVerificationEmail', { uid }));
    });

    it('refuses an account id that does not exist', async () => {
        const res = await anonymous.post('/api/v2/sendVerificationEmail', { uid: '000000000000000000000000', email: `someone-${uniqueSuffix()}@e2e.alianhub.test` });
        expect(res.body.status).toBe(false);
    });
});
