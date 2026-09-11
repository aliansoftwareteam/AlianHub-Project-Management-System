const { createApiClient } = require('../../e2e/support/api');
const { createProject, createTask, firstSprint, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const anon = createApiClient({ baseURL: state.baseURL });
const FOREIGN_COMPANY = '0000000000000000000000a1';
const refused = (res) => res.status >= 400 || (res.body && typeof res.body === 'object' && !Array.isArray(res.body) && res.body.status === false);

/* A private project the target role is NOT a member of. The fixtures' "E2E Owner Only"
 * project is private and owner-only, so member/guest are outsiders to it. */
const restrictedId = () => state.projects.restricted._id;

describe('projects and planning — happy paths', () => {
    it('lists the shared project and reads it by id (owner)', async () => {
        const owner = await loginAs('owner');
        const list = await owner.api.get('/api/v1/project');
        expect(list.status).toBe(200);
        expect(list.body.map((p) => p._id)).toContain(state.projects.shared._id);
        const byId = await owner.api.get(`/api/v1/project/${state.projects.shared._id}`);
        expect(byId.status).toBe(200);
        expect(String(byId.body._id)).toBe(state.projects.shared._id);
    });

    it('creates a project that then appears in the list (admin)', async () => {
        const admin = await loginAs('admin');
        const project = await createProject(admin.api, { name: `Int Proj ${uniqueSuffix()}`, assigneeIds: [admin.uid], createdBy: admin.uid });
        const list = await admin.api.get('/api/v1/project');
        expect(list.body.map((p) => String(p._id))).toContain(String(project._id));
    });

    it('runs an epic through create / list / update / recount / delete (owner)', async () => {
        const owner = await loginAs('owner');
        const project = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid });
        const created = await owner.api.post('/api/v2/epics', { name: `Epic ${uniqueSuffix()}`, projectId: project._id, userData: { id: owner.uid } });
        expect(created.body.status).toBe(true);
        const epicId = created.body.data._id;
        const list = await owner.api.get(`/api/v2/epics?projectId=${project._id}`);
        expect(list.body.data.map((e) => String(e._id))).toContain(String(epicId));
        expect((await owner.api.put(`/api/v2/epics/${epicId}`, { name: 'Epic renamed' })).body.status).toBe(true);
        expect((await owner.api.post(`/api/v2/epics/${epicId}/recount`)).body.status).toBe(true);
        expect((await owner.api.delete(`/api/v2/epics/${epicId}`)).body.status).toBe(true);
    });

    it('creates a sprint in a project (owner)', async () => {
        const owner = await loginAs('owner');
        const project = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid });
        const res = await owner.api.post('/api/v1/sprint', {
            companyId: owner.companyId, projectId: project._id, sprintName: `Sprint ${uniqueSuffix()}`,
            userData: { id: owner.uid, Employee_Name: 'Olivia Owner' }, projectName: project.ProjectName, folder: {}, private: false,
        });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(true);
    });

    it('runs a portfolio through create / rollup / update / delete (owner)', async () => {
        const owner = await loginAs('owner');
        const project = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid });
        const created = await owner.api.post('/api/v1/portfolio', { name: `Portfolio ${uniqueSuffix()}`, projectIds: [String(project._id)] });
        expect(created.status).toBe(201);
        const portfolioId = created.body.data._id;
        const rollup = await owner.api.get(`/api/v1/portfolio/${portfolioId}/rollup`);
        expect(rollup.body.status).toBe(true);
        expect(rollup.body.data.projects.map((p) => String(p.projectId))).toContain(String(project._id));
        expect((await owner.api.put(`/api/v1/portfolio/${portfolioId}`, { name: 'Portfolio renamed' })).body.status).toBe(true);
        expect((await owner.api.delete(`/api/v1/portfolio/${portfolioId}`)).body.status).toBe(true);
    });

    it('serves a tokenised read-only calendar feed (owner)', async () => {
        const owner = await loginAs('owner');
        const created = await owner.api.post('/api/v1/calendar/feeds', { scope: 'my', name: `Feed ${uniqueSuffix()}` });
        expect(created.body.status).toBe(true);
        const { token, _id } = created.body.data;
        const ics = await anon.get(`/api/v1/calendar/ics/${token}`);
        expect(ics.status).toBe(200);
        expect(String(ics.headers.get('content-type'))).toContain('text/calendar');
        expect((await owner.api.delete(`/api/v1/calendar/feeds/${_id}`)).body.status).toBe(true);
    });

    it('returns a capacity plan and validates its range (owner)', async () => {
        const owner = await loginAs('owner');
        const ok = await owner.api.get('/api/v1/reports/capacity', { query: { from: '2026-09-01', to: '2026-09-30' } });
        expect(ok.status).toBe(200);
        expect(ok.body.data.totals).toBeDefined();
        expect(refused(await owner.api.get('/api/v1/reports/capacity'))).toBe(true);
    });

    it('reads the project dashboard and the project-close policy (owner)', async () => {
        const owner = await loginAs('owner');
        expect((await owner.api.get(`/api/v1/project-dashboard/${state.projects.shared._id}`)).body.status).toBe(true);
        expect((await owner.api.get('/api/v1/project-close')).body.status).toBe(true);
    });
});

describe('projects and planning — refusals that hold', () => {
    it('refuses unauthenticated reads', async () => {
        for (const url of ['/api/v1/project', '/api/v2/epics?projectId=x', '/api/v1/portfolio']) {
            expect((await anon.get(url)).status).toBe(401);
        }
    });

    it('refuses a company id outside the token audience', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.withCompany(FOREIGN_COMPANY).get(`/api/v1/project/${state.projects.shared._id}`);
        expect(res.status).toBeGreaterThanOrEqual(401);
        expect(res.status).toBeLessThan(404);
    });

    it('lets only an owner/admin change the project-close policy', async () => {
        const admin = await loginAs('admin');
        expect((await admin.api.put('/api/v1/project-close', { enabled: false })).status).toBe(200);
        for (const role of ['member', 'guest']) {
            const session = await loginAs(role);
            expect((await session.api.put('/api/v1/project-close', { enabled: false })).status).toBe(403);
        }
    });

    it('rejects an unknown sprint patch type', async () => {
        const owner = await loginAs('owner');
        const project = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid });
        const sprint = await firstSprint(owner.api, project._id);
        const res = await owner.api.patch(`/api/v1/sprint/${sprint._id}`, { type: 'constructor', companyId: owner.companyId });
        expect(res.status).toBe(400);
        expect(res.body.status).toBe(false);
    });

    it('hides a private project a member is not assigned to, from the list', async () => {
        const member = await loginAs('member');
        const list = await member.api.get('/api/v1/project');
        expect(list.body.map((p) => String(p._id))).not.toContain(restrictedId());
    });
});

describe('projects and planning — regressions (fail until the bug is fixed)', () => {
    it.failing('PRJ-01: another user\'s personal calendar feed token is not exposed', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const feed = await owner.api.post('/api/v1/calendar/feeds', { scope: 'my', name: `Owner feed ${uniqueSuffix()}` });
        const token = feed.body.data.token;
        try {
            const list = await member.api.get('/api/v1/calendar/feeds');
            const exposed = (list.body.data || []).some((f) => f.token === token);
            expect(exposed).toBe(false);
        } finally {
            await owner.api.delete(`/api/v1/calendar/feeds/${feed.body.data._id}`);
        }
    });

    it('PRJ-02: a member cannot read a private project by id when not a member of it', async () => {
        const member = await loginAs('member');
        const res = await member.api.get(`/api/v1/project/${restrictedId()}`);
        expect(refused(res)).toBe(true);
    });

    it('PRJ-03: a guest cannot create an epic in a private project they are not in', async () => {
        const guest = await loginAs('guest');
        const res = await guest.api.post('/api/v2/epics', { name: 'Guest epic', projectId: restrictedId(), userData: { id: guest.uid } });
        expect(refused(res)).toBe(true);
    });

    it('PRJ-04: allTask/:id cannot mutate tasks in a different project via findObject', async () => {
        const owner = await loginAs('owner');
        const projectA = await createProject(owner.api, { name: `A ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid });
        const projectB = await createProject(owner.api, { name: `B ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid, isPrivate: true });
        const task = await createTask(owner.api, { project: projectB, name: 'Original B name', user: state.users.owner, companyOwnerId: owner.uid });
        await owner.api.put(`/api/v1/project/allTask/${projectA._id}`, {
            findObject: { ProjectID: projectB._id, _id: task._id }, updateObject: { TaskName: 'Renamed across projects' },
        });
        const [row] = (await owner.api.get(`/api/v1/projectdata/taskData?taskId=${task._id}&projectId=${projectB._id}&subTaskLimit=1`)).body;
        expect(row.tasks[0].TaskName).toBe('Original B name');
    });

    it('PRJ-05: deleting a saved filter rejects a company id outside the token', async () => {
        const owner = await loginAs('owner');
        const created = await owner.api.post('/api/v1/project/filter/create', {
            companyId: owner.companyId, userId: owner.uid, name: `Filter ${uniqueSuffix()}`, filter: 'projectFilter', typeFilter: 'projects',
        });
        const filterId = created.body.data._id;
        const res = await owner.api.delete(`/api/v1/project/filter/delete/${FOREIGN_COMPANY}/${filterId}`);
        expect(refused(res)).toBe(true);
        await owner.api.delete(`/api/v1/project/filter/delete/${owner.companyId}/${filterId}`);
    });

    it.failing('PRJ-06: get-remaining-projects with no dataIds is a clean 4xx, not a 500', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.post('/api/v1/get-remaining-projects', {});
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
        expect(res.body.status).toBe(false);
    });
});
