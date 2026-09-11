const { createApiClient } = require('../../e2e/support/api');
const { ROLE_NAMES, createProject, loginAs, readState } = require('../../e2e/support/fixtures');

const state = readState();
const anonymous = createApiClient({ baseURL: state.baseURL });
const refused = (res) => res.status >= 400 || (res.body && res.body.status === false);

describe('harness', () => {
    it('answers /health with a healthy database', async () => {
        const res = await anonymous.get('/health');
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: 'ok', db: { ok: true } });
    });

    it('answers /version with the running version', async () => {
        const res = await anonymous.get('/version');
        expect(res.status).toBe(200);
        expect(res.body.data.version).toMatch(/^14\./);
    });

    it.each(ROLE_NAMES)('signs %s in with the fixture password', async (role) => {
        const session = await loginAs(role);
        expect(session.accessToken).toBeTruthy();
        expect(session.uid).toBe(state.users[role].userId);
    });
});

describe('projects', () => {
    it('lets the owner list projects', async () => {
        const { api } = await loginAs('owner');
        const res = await api.get('/api/v1/project');
        expect(res.status).toBe(200);
        expect(res.body.map((project) => project._id)).toContain(state.projects.shared._id);
    });

    // Known gap: PUT /api/v1/project/:id checks no project membership for a web session,
    // so today the member's edit lands. Flip to it() once the route enforces it.
    it.failing('refuses a member editing a project they are not in', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const project = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid, isPrivate: true });

        const res = await member.api.put(`/api/v1/project/${project._id}`, { updateObject: { ProjectName: 'Renamed by member' } });
        const after = await owner.api.get(`/api/v1/project/${project._id}`);

        expect(refused(res)).toBe(true);
        expect(after.body.ProjectName).toBe(project.ProjectName);
    });
});

describe('instance console', () => {
    it('refuses a member', async () => {
        const { api } = await loginAs('member');
        const res = await api.get('/api/v2/instance/stats');
        expect(res.status).toBe(403);
    });

    it('answers the owner', async () => {
        const { api } = await loginAs('owner');
        const res = await api.get('/api/v2/instance/stats');
        expect(res.status).toBe(200);
        expect(res.body.data.version).toMatch(/^14\./);
    });
});
