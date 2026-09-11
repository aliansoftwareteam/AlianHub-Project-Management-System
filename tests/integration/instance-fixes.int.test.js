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

const memberRow = async (userId) => {
    const owner = await as('owner');
    return (await owner.api.get(`/api/v1/members/${userId}`)).body;
};
const statusTemplate = (TemplateName) => ({ TemplateName, ActiveStatusList: [], DoneStatusList: [], defaultActive: {}, defaultComplete: {} });
const marker = () => `qa-instance-fix-${uniqueSuffix()}`;

describe('INS-01 and INS-02 role and membership changes', () => {
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
    it('writes to the session company', async () => {
        const { api } = await as('admin');
        const [currency] = (await api.get('/api/v1/currency')).body;
        const res = await api.put(`/api/v1/currency/${state.companyId}/${currency._id}`, { key: '$set', updateObject: { isDelete: Boolean(currency.isDelete) } });
        expect(res.body).toMatchObject({ status: true });
    });
});

describe('INS-10 private views', () => {
    it('lets a member add and remove their own private view', async () => {
        const user = await freshUser('member');
        const id = `qa-${uniqueSuffix()}`;
        expect((await user.api.post('/api/v1/members/private-view', { id: user.companyUserId, operation: 'push', data: { id, name: '[QA instance fix] view' } })).body.status).toBe(true);
        expect((await memberRow(user.userId)).ProjectRequiredComponent.map((v) => v.id)).toContain(id);
        expect((await user.api.post('/api/v1/members/private-view', { id: user.companyUserId, operation: 'delete', data: { id } })).body.status).toBe(true);
    });
});

describe('INS-12 getTime', () => {
    it('answers a zone with the standard envelope', async () => {
        const res = await anonymous.get('/api/v1/getTime', { query: { zone: 'UTC' } });
        expect(res.body).toMatchObject({ status: true, data: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) });
        expect(refused(res)).toBe(false);
    });
});
