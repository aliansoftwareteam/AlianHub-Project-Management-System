const { createApiClient } = require('../../e2e/support/api');
const { emailFor, inviteMember, login, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const anonymous = createApiClient({ baseURL: state.baseURL });
const OTHER_COMPANY = '0123456789abcdef01234567';

const refused = (res) => res.status >= 400 || Boolean(res.body && typeof res.body === 'object' && res.body.status === false);
const forbidden = (res) => res.status === 403 && Boolean(res.body) && res.body.status === false;

const sessions = {};
const as = async (role) => {
    if (!sessions[role]) sessions[role] = await loginAs(role);
    return sessions[role];
};

async function freshUser(role) {
    const owner = await as('owner');
    const suffix = uniqueSuffix();
    const email = emailFor(role, `insfix${suffix}`);
    const user = await inviteMember({ baseURL: state.baseURL, ownerApi: owner.api, companyId: state.companyId, role, email, firstName: 'QA', lastName: `Instance fix ${suffix}` });
    const session = await login(state.baseURL, email);
    return { ...user, api: createApiClient({ baseURL: state.baseURL, accessToken: session.accessToken, companyId: state.companyId }) };
}

async function waitFor(check, { timeoutMs = 15000, intervalMs = 250 } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = await check();
        if (value || Date.now() > deadline) return value;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
}

const memberRow = async (userId) => {
    const owner = await as('owner');
    return (await owner.api.get(`/api/v1/members/${userId}`)).body;
};
const statusTemplate = (TemplateName) => ({ TemplateName, ActiveStatusList: [], DoneStatusList: [], defaultActive: {}, defaultComplete: {} });
const marker = () => `qa-instance-fix-${uniqueSuffix()}`;

describe('INS-01 and INS-02 role and membership changes', () => {
    it('INS-01 refuses a member promoting themselves to owner through PUT /api/v1/members', async () => {
        const user = await freshUser('member');
        const res = await user.api.put('/api/v1/members', { id: user.companyUserId, data: { roleType: 1 } });
        expect(forbidden(res)).toBe(true);
        expect((await memberRow(user.userId)).roleType).toBe(3);
    });

    it('INS-02 refuses a guest promoting themselves to admin through PUT /api/v1/root-members', async () => {
        const user = await freshUser('guest');
        const res = await user.api.put('/api/v1/root-members', { id: user.companyUserId, data: { roleType: 2 }, companyId: state.companyId });
        expect(forbidden(res)).toBe(true);
        expect((await memberRow(user.userId)).roleType).toBe(0);
    });

    it('lets a member lock their own dashboard but not someone else', async () => {
        const user = await freshUser('member');
        const other = await freshUser('member');
        expect((await user.api.put('/api/v1/members', { id: user.companyUserId, data: { dashboardLocked: true } })).body.status).toBe(true);
        expect(forbidden(await user.api.put('/api/v1/members', { id: other.companyUserId, data: { dashboardLocked: true } }))).toBe(true);
        expect((await memberRow(user.userId)).dashboardLocked).toBe(true);
    });

    it('lets only the owner grant admin, and an admin make a member a guest', async () => {
        const owner = await as('owner');
        const admin = await as('admin');
        const user = await freshUser('member');

        expect(forbidden(await admin.api.put('/api/v1/members', { id: user.companyUserId, data: { roleType: 2 } }))).toBe(true);
        expect((await memberRow(user.userId)).roleType).toBe(3);

        const promoted = await owner.api.put('/api/v1/members', { id: user.companyUserId, data: { roleType: 2 } });
        expect(promoted.body).toMatchObject({ status: true, data: { roleType: 2 } });
        expect((await owner.api.put('/api/v1/members', { id: user.companyUserId, data: { roleType: 3 } })).body.status).toBe(true);

        const demoted = await admin.api.put('/api/v1/members', { id: user.companyUserId, data: { roleType: 0 } });
        expect(demoted.body).toMatchObject({ status: true, data: { roleType: 0 } });
    });

    it('refuses the owner changing their own role or removing the last owner', async () => {
        const owner = await as('owner');
        const self = await memberRow(owner.uid);
        expect(forbidden(await owner.api.put('/api/v1/members', { id: self._id, data: { roleType: 2 } }))).toBe(true);
        expect(forbidden(await owner.api.put('/api/v1/members', { id: self._id, data: { isDelete: true } }))).toBe(true);
        expect(await memberRow(owner.uid)).toMatchObject({ roleType: 1, isDelete: false });
    });

    it('accepts an invitation with the role stored on it, never one from the request', async () => {
        const owner = await as('owner');
        const email = emailFor('member', `insaccept${uniqueSuffix()}`);
        const invite = await owner.api.post('/api/v2/sendInvitationEmail', { email, companyId: state.companyId, companyName: state.companyName, role: 3, designation: 0 });
        const inviteRow = invite.body.data;
        expect(inviteRow._id).toBeTruthy();
        await anonymous.post('/api/v2/createUser', { firstName: 'QA', lastName: 'Accept', email, password: state.password, isInvitation: true, assignCompany: state.companyId });
        const session = await login(state.baseURL, email);
        const api = createApiClient({ baseURL: state.baseURL, accessToken: session.accessToken, companyId: state.companyId });

        const escalated = await api.put('/api/v1/root-members', { id: inviteRow._id, data: { userId: session.uid, status: 2, roleType: 1 }, companyId: state.companyId });
        expect(forbidden(escalated)).toBe(true);

        const accepted = await api.put('/api/v1/root-members', { id: inviteRow._id, data: { userId: session.uid, status: 2 }, companyId: state.companyId });
        expect(accepted.body).toMatchObject({ status: true, data: { roleType: 3, status: 2, userId: session.uid } });

        const stranger = await freshUser('member');
        const second = await owner.api.post('/api/v2/sendInvitationEmail', { email: emailFor('member', `insother${uniqueSuffix()}`), companyId: state.companyId, companyName: state.companyName, role: 3, designation: 0 });
        expect(forbidden(await stranger.api.put('/api/v1/root-members', { id: second.body.data._id, data: { userId: stranger.userId, status: 2 }, companyId: state.companyId }))).toBe(true);
    });

    it('keeps invitations to owners and admins with the owner', async () => {
        const member = await as('member');
        const admin = await as('admin');
        const invite = (role) => ({ email: emailFor('guest', `insinv${uniqueSuffix()}`), companyId: state.companyId, companyName: state.companyName, role, designation: 0 });
        expect(forbidden(await member.api.post('/api/v2/sendInvitationEmail', invite(3)))).toBe(true);
        expect(forbidden(await admin.api.post('/api/v2/sendInvitationEmail', invite(2)))).toBe(true);
        expect(forbidden(await admin.api.post('/api/v2/sendInvitationEmail', { ...invite(3), companyId: OTHER_COMPANY }))).toBe(true);
    });
});

describe('INS-06 company settings writes', () => {
    const WRITES = [
        ['PUT /api/v1/setting/roles/update', 'put', '/api/v1/setting/roles/update', () => ({ queryFilter: { name: marker() }, queryObj: { $set: { qaMarker: true } } })],
        ['PUT /api/v1/setting/designation/update', 'put', '/api/v1/setting/designation/update', () => ({ queryFilter: { name: marker() }, queryObj: { $set: { qaMarker: true } } })],
        ['PUT /api/v1/commonDateFormate', 'put', '/api/v1/commonDateFormate', () => ({ key: '$set', updateObject: { qaMarker: marker() } })],
        ['PUT /api/v1/taskPriority', 'put', '/api/v1/taskPriority', () => ({ key: '$set', updateObject: { qaMarker: marker() } })],
        ['PUT /api/v1/fileExtensions', 'put', '/api/v1/fileExtensions', () => ({ key: '$set', updateObject: { qaMarker: marker() } })],
        ['PUT /api/v1/milestoneStatus', 'put', '/api/v1/milestoneStatus', () => ({ key: '$set', updateObject: { qaMarker: marker() } })],
        ['POST /api/v1/templates/taskStatus', 'post', '/api/v1/templates/taskStatus', () => ({ updateObject: statusTemplate(`[QA instance] ${marker()}`) })],
        ['PUT /api/v1/setting/skills', 'put', '/api/v1/setting/skills', () => ({ operation: 'add', name: `QA ${marker()}` })],
    ];
    const cases = ['guest', 'member'].flatMap((role) => WRITES.map(([label, method, path, body]) => [role, label, method, path, body]));

    it.each(cases)('INS-06 refuses a %s on %s', async (role, label, method, path, body) => {
        const { api } = await as(role);
        const res = await api.request(method.toUpperCase(), path, { body: body() });
        expect(forbidden(res)).toBe(true);
    });

    it('INS-06 refuses a guest editing a security permission rule', async () => {
        const { api } = await as('guest');
        const rules = await api.get('/api/v1/securityPermissions');
        const rule = rules.body.find((r) => !r.isParent);
        const res = await api.put('/api/v1/securityPermissions', { type: 'updateOne', key: '$set', id: rule._id, updateObject: { qaMarker: marker() } });
        expect(forbidden(res)).toBe(true);
    });

    it('lets an admin create and delete a task status template', async () => {
        const { api } = await as('admin');
        const created = await api.post('/api/v1/templates/taskStatus', { updateObject: statusTemplate(`[QA instance fix] ${marker()}`) });
        expect(created.status).toBe(200);
        expect((await api.delete(`/api/v1/templates/taskStatus/${created.body._id}`)).status).toBe(200);
    });

    it('keeps the settings reads open to a guest', async () => {
        const { api } = await as('guest');
        for (const path of ['/api/v1/setting/roles', '/api/v1/setting/designation', '/api/v1/taskPriority', '/api/v1/securityPermissions', '/api/v1/templates/taskStatus', '/api/v1/currency']) {
            const res = await api.get(path);
            expect({ path, status: res.status }).toEqual({ path, status: 200 });
        }
    });
});

describe('INS-05 currency writes', () => {
    it('INS-05 refuses a currency write aimed at another company', async () => {
        const { api } = await as('admin');
        const [currency] = (await api.get('/api/v1/currency')).body;
        const res = await api.put(`/api/v1/currency/${OTHER_COMPANY}/${currency._id}`, { key: '$set', updateObject: { qaMarker: true } });
        expect(forbidden(res)).toBe(true);
    });

    it('writes to the session company', async () => {
        const { api } = await as('admin');
        const [currency] = (await api.get('/api/v1/currency')).body;
        const res = await api.put(`/api/v1/currency/${state.companyId}/${currency._id}`, { key: '$set', updateObject: { isDelete: Boolean(currency.isDelete) } });
        expect(res.body).toMatchObject({ status: true });
    });
});

describe('INS-07 instance settings from the owner session', () => {
    it('INS-07 saves a setting from the owner session, shows it in the public config and restores it', async () => {
        const { api } = await as('owner');
        const before = await api.get('/api/v2/instance/settings');
        const appName = before.body.data.settings.find((s) => s.key === 'APP_NAME');
        const restore = appName.source === 'saved' ? appName.value : '';
        const name = `[QA instance fix] ${uniqueSuffix()}`;
        try {
            const saved = await api.put('/api/v2/instance/settings', { APP_NAME: name });
            expect(saved.status).toBe(200);
            expect(saved.body.data.applied).toEqual(['APP_NAME']);
            expect((await anonymous.get('/api/v2/instance/public-config')).body.data.appName).toBe(name);
        } finally {
            await api.put('/api/v2/instance/settings', { APP_NAME: restore });
        }
        const after = await api.get('/api/v2/instance/settings');
        expect(after.body.data.settings.find((s) => s.key === 'APP_NAME').value).toBe(appName.value);
    });
});

describe('INS-08 and INS-09 audit export', () => {
    it('INS-08 exports every row of the filter, not only the first 100', async () => {
        const owner = await as('owner');
        const user = await freshUser('member');
        for (let i = 0; i < 101; i += 1) {
            await owner.api.put('/api/v1/members', { id: user.companyUserId, data: { designation: 0 } });
        }
        const total = await waitFor(async () => {
            const res = await owner.api.get('/api/v1/audit-logs', { query: { entityId: user.companyUserId, limit: 1 } });
            return res.body.metadata.total >= 101 ? res.body.metadata.total : 0;
        });
        expect(total).toBe(101);

        const csv = await owner.api.get('/api/v1/audit-logs/export', { query: { entityId: user.companyUserId } });
        expect(String(csv.body).split('\n').length - 1).toBe(total);
    }, 120000);

    it('INS-09 records the signed-in actor, not a name from the request body', async () => {
        const owner = await as('owner');
        const user = await freshUser('member');
        await owner.api.put('/api/v1/members', { id: user.companyUserId, data: { designation: 0 }, userData: { name: '=HYPERLINK("http://example.invalid","Rahul")' } });

        const row = await waitFor(async () => (await owner.api.get('/api/v1/audit-logs', { query: { entityId: user.companyUserId } })).body.data[0]);
        expect(row.actorId).toBe(owner.uid);
        expect(row.actorName).not.toContain('HYPERLINK');

        const csv = await owner.api.get('/api/v1/audit-logs/export', { query: { entityId: user.companyUserId } });
        expect(String(csv.body)).not.toMatch(/(^|,)"?=HYPERLINK/m);
    });
});

describe('INS-10 private views', () => {
    it('INS-10 refuses a member editing another member private views', async () => {
        const user = await freshUser('member');
        const other = await freshUser('member');
        const res = await user.api.post('/api/v1/members/private-view', { id: other.companyUserId, operation: 'push', data: { id: `qa-${uniqueSuffix()}`, name: '[QA instance] view' } });
        expect(forbidden(res)).toBe(true);
    });

    it('lets a member add and remove their own private view', async () => {
        const user = await freshUser('member');
        const id = `qa-${uniqueSuffix()}`;
        expect((await user.api.post('/api/v1/members/private-view', { id: user.companyUserId, operation: 'push', data: { id, name: '[QA instance fix] view' } })).body.status).toBe(true);
        expect((await memberRow(user.userId)).ProjectRequiredComponent.map((v) => v.id)).toContain(id);
        expect((await user.api.post('/api/v1/members/private-view', { id: user.companyUserId, operation: 'delete', data: { id } })).body.status).toBe(true);
    });
});

describe('INS-12 getTime', () => {
    it('INS-12 answers getTime without a zone with the standard error shape', async () => {
        const res = await anonymous.get('/api/v1/getTime');
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ status: false, statusText: expect.any(String) });
    });

    it('answers a zone with the standard envelope', async () => {
        const res = await anonymous.get('/api/v1/getTime', { query: { zone: 'UTC' } });
        expect(res.body).toMatchObject({ status: true, data: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) });
        expect(refused(res)).toBe(false);
    });
});
