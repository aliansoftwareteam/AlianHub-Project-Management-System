const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createApiClient } = require('../../e2e/support/api');
const { createProject, createTask, login, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

/* Sprint 8 slice 2. The server runs with PERMISSION_ENFORCEMENT_CACHE_TTL_SECONDS=0, so a
 * workspace mode written here applies to the next request. */

const state = readState();
const MEMBER_ROLE = 3;
const ROW_DEADLINE_MS = 10000;

let client;
let owner;
let member;
let companies;
let decisions;
let audits;

const setWorkspaceMode = (mode) => companies.updateOne(
    { _id: new ObjectId(state.companyId) },
    mode ? { $set: { permissionEnforcement: { mode } } } : { $unset: { permissionEnforcement: '' } },
);

const waitFor = async (read, what) => {
    const deadline = Date.now() + ROW_DEADLINE_MS;
    for (;;) {
        const found = await read();
        if (found) return found;
        if (Date.now() > deadline) throw new Error(`${what} did not appear within ${ROW_DEADLINE_MS}ms`);
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
};

/* A project whose own rules give the Member role None on task priority, and a task in it. */
async function taskWherePriorityIsNone() {
    const project = await createProject(owner.api, { assigneeIds: [owner.uid, member.uid], createdBy: owner.uid });
    const imported = await owner.api.post('/api/v1/importSettingsProjectFunction', { companyId: state.companyId, type: 'project', projectId: project._id });
    expect(imported.body.status).toBe(true);
    expect((await owner.api.put(`/api/v1/project/${project._id}`, { updateObject: { isGlobalPermission: false } })).status).toBe(200);
    const rule = (await owner.api.get(`/api/v1/projectRules/${project._id}`)).body.find((r) => r.key === 'task_priority');
    const roles = [...rule.roles.filter((r) => r.key !== MEMBER_ROLE), { key: MEMBER_ROLE, permission: null }];
    expect((await owner.api.put('/api/v1/projectRules/update', { updateObject: { roles }, key: '$set', id: rule._id, projectId: project._id })).status).toBe(200);
    const task = await createTask(owner.api, { project, user: owner, companyOwnerId: owner.uid });
    return { project, task };
}

const updatePriority = ({ project, task }, marker) => member.api.patch('/api/v2/tasks', {
    action: 'updatePriority',
    firebaseObj: { Task_Priority: 'HIGH' },
    projectData: { _id: project._id, CompanyId: state.companyId },
    taskData: { _id: task._id, sprintId: task.sprintId },
    priorityObj: {},
    isUpdateTask: true,
    note: marker,
}, { query: { probe: marker } });

const shape = (res) => ({ status: res.status, ok: res.body && res.body.status });

beforeAll(async () => {
    client = await MongoClient.connect(resolveMongoUrl());
    companies = client.db('global').collection('companies');
    decisions = client.db(state.companyId).collection('permission_decisions');
    audits = client.db(state.companyId).collection('audit_logs');
    owner = await loginAs('owner');
    member = await loginAs('member');
});

afterAll(async () => {
    if (companies) await setWorkspaceMode(null);
    if (client) await client.close();
});

describe('report-only enforcement for browser sessions', () => {
    let target;
    let today;

    beforeAll(async () => {
        target = await taskWherePriorityIsNone();
        await setWorkspaceMode(null);
        today = shape(await updatePriority(target, `off-${uniqueSuffix()}`));
    });

    it('lets a member through today, with enforcement off', () => {
        expect(today).toEqual({ status: 200, ok: true });
    });

    it('in report, gives the member the same response and records the would-be denial', async () => {
        await setWorkspaceMode('report');
        const marker = `report-${uniqueSuffix()}`;
        const res = await updatePriority(target, marker);
        expect(shape(res)).toEqual(today);

        const row = await waitFor(() => decisions.findOne({ mode: 'report', scope: target.project._id, permission: 'task.task_priority', userIds: member.uid }), 'a report row');
        expect(row).toMatchObject({
            method: 'PATCH',
            route: '/api/v2/tasks',
            role: MEMBER_ROLE,
            reason: 'denied',
            count: 1,
            userIds: [member.uid],
        });
        expect(row.firstSeen).toBeInstanceOf(Date);
        expect(JSON.stringify(row)).not.toContain(marker);

        expect(shape(await updatePriority(target, marker))).toEqual(today);
        await waitFor(async () => ((await decisions.findOne({ _id: row._id })).count === 2), 'the second count');
        expect(await audits.countDocuments({ action: 'permission.refused', entityId: 'task.task_priority', 'meta.scope': String(target.project._id) })).toBe(0);
    });

    it('builds the TTL and key indexes on permission_decisions', async () => {
        const indexes = await waitFor(async () => {
            const list = await decisions.indexes().catch(() => []);
            return list.some((index) => index.expireAfterSeconds !== undefined) && list.some((index) => index.unique) ? list : null;
        }, 'the indexes');
        expect(indexes).toContainEqual(expect.objectContaining({ key: { day: 1 }, expireAfterSeconds: 30 * 24 * 60 * 60 }));
        expect(indexes).toContainEqual(expect.objectContaining({ name: 'decision_key', unique: true }));
    });

    it('in enforce, refuses the same action and writes a permission.refused audit row', async () => {
        await setWorkspaceMode('enforce');
        const res = await updatePriority(target, `enforce-${uniqueSuffix()}`);
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ status: false, error: 'Forbidden', permission: 'task.task_priority' });

        await waitFor(() => decisions.findOne({ mode: 'enforce', scope: target.project._id, permission: 'task.task_priority' }), 'an enforce row');
        const audit = await waitFor(() => audits.findOne({ action: 'permission.refused', actorId: member.uid, entityId: 'task.task_priority', 'meta.scope': String(target.project._id) }), 'the audit row');
        expect(audit).toMatchObject({ entityType: 'permission', entityId: 'task.task_priority', meta: expect.objectContaining({ route: '/api/v2/tasks', mode: 'enforce' }) });
    });

    it('lets an owner through in enforce', async () => {
        await setWorkspaceMode('enforce');
        const res = await owner.api.patch('/api/v2/tasks', {
            action: 'updatePriority',
            firebaseObj: { Task_Priority: 'LOW' },
            projectData: { _id: target.project._id, CompanyId: state.companyId },
            taskData: { _id: target.task._id, sprintId: target.task.sprintId },
            priorityObj: {},
            isUpdateTask: true,
        });
        expect(shape(res)).toEqual({ status: 200, ok: true });
    });

    it('back to off, lets the member through again without recording', async () => {
        await setWorkspaceMode(null);
        const before = await decisions.countDocuments({});
        expect(shape(await updatePriority(target, `off-${uniqueSuffix()}`))).toEqual(today);
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(await decisions.countDocuments({})).toBe(before);
    });
});

describe('with the instance default set in the Instance console', () => {
    let globalDecisions;

    const setInstanceMode = async (mode) => {
        const saved = await owner.api.put('/api/v2/instance/settings', { PERMISSION_ENFORCEMENT_MODE: mode });
        expect(saved.status).toBe(200);
        expect(saved.body.data.applied).toEqual(['PERMISSION_ENFORCEMENT_MODE']);
    };

    /* The calls Invitation.vue makes; the accept is sent without a companyid header, as the page sends it. */
    const invitee = async () => {
        const email = `invitee.enforce.${uniqueSuffix()}@e2e.alianhub.test`;
        const sent = await owner.api.post('/api/v2/sendInvitationEmail', { email, companyId: state.companyId, companyName: 'E2E Workspace', role: MEMBER_ROLE, designation: 0 });
        expect(sent.status).toBe(200);
        const created = await createApiClient({ baseURL: state.baseURL }).post('/api/v2/createUser', {
            firstName: 'Ivy', lastName: 'Invitee', email, password: state.password, isInvitation: true, assignCompany: state.companyId,
            memberId: String(sent.body.data._id), linkId: sent.body.data.linkId,
        });
        expect(created.body.status).toBe(true);
        const session = await login(state.baseURL, email, state.password);
        return { rowId: String(sent.body.data._id), uid: session.uid, api: createApiClient({ baseURL: state.baseURL, accessToken: session.accessToken }) };
    };

    beforeAll(() => {
        globalDecisions = client.db('global').collection('permission_decisions');
    });

    afterAll(async () => {
        if (owner) await owner.api.put('/api/v2/instance/settings', { PERMISSION_ENFORCEMENT_MODE: '' });
    });

    it('under enforce, an invited user still accepts the invitation', async () => {
        const { rowId, uid, api } = await invitee();
        await setInstanceMode('enforce');
        const accepted = await api.put('/api/v1/root-members', { id: rowId, data: { userId: uid, status: 2 }, companyId: state.companyId });
        expect(accepted.status).toBe(200);
        expect(accepted.body).toMatchObject({ status: true, data: { status: 2, userId: uid } });
    });

    it('under report, a would-be denial with no company header is recorded in the instance bucket', async () => {
        const { rowId, uid, api } = await invitee();
        const body = { id: rowId, data: { userId: uid, roleType: 1 }, companyId: state.companyId };
        await setInstanceMode('');
        const today = await api.put('/api/v1/root-members', body);

        await setInstanceMode('report');
        const res = await api.put('/api/v1/root-members', body);
        expect(shape(res)).toEqual(shape(today));

        const row = await waitFor(() => globalDecisions.findOne({ mode: 'report', route: '/api/v1/root-members', userIds: uid }), 'an instance-bucket row');
        expect(row).toMatchObject({ method: 'PUT', permission: 'settings.settings_member_list', scope: 'global', reason: 'no_seat', role: null });
        expect(JSON.stringify(row)).not.toContain(state.companyId);
    });
});
