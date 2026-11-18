const { createApiClient } = require('../../e2e/support/api');
const { createProject, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const anonWithCompany = createApiClient({ baseURL: state.baseURL, companyId: state.companyId });
const refusedAs = (res, codes) => codes.includes(res.status) && res.body && res.body.status === false;

async function tokenClientFor(session) {
    const res = await session.api.post('/api/v2/api-tokens', { name: `Project edit ${uniqueSuffix()}`, scopes: ['read', 'write'] });
    if (!res.body || res.body.status !== true) throw new Error(`token for ${session.email} failed: ${JSON.stringify(res.body)}`);
    return createApiClient({ baseURL: state.baseURL, accessToken: res.body.data.token, companyId: state.companyId });
}

let owner;
let admin;
let member;
let ownerOnly;
let shared;

const nameOf = async (projectId) => (await owner.api.get(`/api/v1/project/${projectId}`)).body.ProjectName;

beforeAll(async () => {
    owner = await loginAs('owner');
    admin = await loginAs('admin');
    member = await loginAs('member');
    ownerOnly = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid, isPrivate: true });
    shared = await createProject(owner.api, { assigneeIds: [owner.uid, member.uid], createdBy: owner.uid, isPrivate: true });
});

describe('PUT /api/v1/project/:id', () => {
    it('refuses a member renaming a private project they are not in', async () => {
        const res = await member.api.put(`/api/v1/project/${ownerOnly._id}`, { updateObject: { ProjectName: 'Renamed by member' } });
        expect(refusedAs(res, [403, 404])).toBe(true);
        expect(await nameOf(ownerOnly._id)).toBe(ownerOnly.ProjectName);
    });

    it('refuses the same edit made with the member\'s API token', async () => {
        const memberToken = await tokenClientFor(member);
        const res = await memberToken.put(`/api/v1/project/${ownerOnly._id}`, { updateObject: { ProjectName: 'Renamed by token' } });
        expect(refusedAs(res, [403, 404])).toBe(true);
        expect(await nameOf(ownerOnly._id)).toBe(ownerOnly.ProjectName);
    });

    it('refuses an assigned member whose role has no project_name_edit', async () => {
        const res = await member.api.put(`/api/v1/project/${shared._id}`, { updateObject: { ProjectName: 'Renamed by member' } });
        expect(refusedAs(res, [403])).toBe(true);
        expect(res.body.permission).toBe('project.project_name_edit');
        expect(await nameOf(shared._id)).toBe(shared.ProjectName);
    });

    it('lets an admin rename a project they are not assigned to', async () => {
        const name = `Admin rename ${uniqueSuffix()}`;
        const res = await admin.api.put(`/api/v1/project/${ownerOnly._id}`, { updateObject: { ProjectName: name } });
        expect(res.status).toBe(200);
        expect(await nameOf(ownerOnly._id)).toBe(name);
        ownerOnly.ProjectName = name;
    });

    it('refuses a body companyId that differs from the header', async () => {
        const res = await owner.api.put(`/api/v1/project/${ownerOnly._id}`, { companyId: '0123456789abcdef01234567', updateObject: { ProjectName: 'Cross company' } });
        expect(refusedAs(res, [403])).toBe(true);
        expect(await nameOf(ownerOnly._id)).toBe(ownerOnly.ProjectName);
    });
});

describe('other project-changing routes', () => {
    it('refuses a member changing the task statuses of a private project they are not in', async () => {
        const res = await member.api.post('/api/v1/projectSetting/taskStatus', { companyId: state.companyId, projectId: ownerOnly._id, taskStatusKey: [], oldTaskStatus: [] });
        expect(refusedAs(res, [403, 404])).toBe(true);
    });

    it('refuses a member deleting the rules of a private project they are not in', async () => {
        const res = await member.api.delete(`/api/v1/projectRules/delete/${ownerOnly._id}`);
        expect(refusedAs(res, [403, 404])).toBe(true);
    });

    it('refuses a member tagging a private project they are not in', async () => {
        const res = await member.api.post('/api/v1/project/tags', { id: ownerOnly._id, operation: 'push', items: {} });
        expect(refusedAs(res, [403, 404])).toBe(true);
    });

    it.each(['autoArchive', 'estimationScale'])('requires a session for POST /api/v1/projectSetting/%s', async (setting) => {
        const res = await anonWithCompany.post(`/api/v1/projectSetting/${setting}`, { projectId: ownerOnly._id });
        expect(res.status).toBeGreaterThanOrEqual(401);
        expect(res.status).toBeLessThan(500);
    });

    it('lets the owner set the auto-archive rule', async () => {
        const res = await owner.api.post('/api/v1/projectSetting/autoArchive', { projectId: ownerOnly._id, enabled: true, afterDays: 30 });
        expect(res.status).toBe(200);
    });
});
