const { createProject, createTask, listSprints, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const FOREIGN_COMPANY = '0000000000000000000000a1';
const refusedAs = (res, codes) => codes.includes(res.status) && res.body && res.body.status === false;
const idsIn = (list) => (list || []).map((p) => String(p._id || p.projectId));

let owner;
let admin;
let member;
let guest;
let restricted;
let shared;
let restrictedSprint;

beforeAll(async () => {
    owner = await loginAs('owner');
    admin = await loginAs('admin');
    member = await loginAs('member');
    guest = await loginAs('guest');
    restricted = state.projects.restricted._id;
    shared = state.projects.shared._id;
    [restrictedSprint] = await listSprints(owner.api, restricted);
});

describe('PRJ-02: a private project\'s contents are not readable by a user outside it', () => {
    it.each(['member', 'guest'])('answers 404 to the %s reading the project by id', async (role) => {
        const session = role === 'member' ? member : guest;
        const res = await session.api.get(`/api/v1/project/${restricted}`);
        expect(refusedAs(res, [404])).toBe(true);
    });

    it('answers 404 on every by-id read of the project', async () => {
        const reads = [
            () => member.api.get(`/api/v1/project/sprintFolder/${restricted}`, { query: { collection: 'sprints' } }),
            () => member.api.get(`/api/v1/project-dashboard/${restricted}`),
            () => member.api.get('/api/v2/epics', { query: { projectId: restricted } }),
            () => member.api.get(`/api/v1/milestone/project/${restricted}`),
            () => member.api.get('/api/v2/billing/contract', { query: { projectId: restricted } }),
            () => member.api.get('/api/v2/billing/hourly', { query: { projectId: restricted } }),
            () => member.api.get(`/api/v1/recurring-tasks/project/${restricted}`),
            () => member.api.get(`/api/v1/projectRules/${restricted}`),
            () => member.api.get(`/api/v1/projectSetting/autoArchive/${restricted}`),
            () => member.api.post('/api/v2/sprints/hours', { sprintId: restrictedSprint._id }),
            () => member.api.post('/api/v2/sprints/burndown', { sprintId: restrictedSprint._id }),
            () => member.api.get('/api/v2/sprints/report', { query: { sprintId: restrictedSprint._id } }),
        ];
        for (const read of reads) {
            const res = await read();
            expect({ url: res.url, refused: refusedAs(res, [404]) }).toMatchObject({ refused: true });
        }
    });

    it('drops the project from get-remaining-projects for the member, not for the owner', async () => {
        const asMember = await member.api.post('/api/v1/get-remaining-projects', { dataIds: [restricted, shared] });
        expect(idsIn(asMember.body.data)).toEqual([shared]);
        const asOwner = await owner.api.post('/api/v1/get-remaining-projects', { dataIds: [restricted, shared] });
        expect(idsIn(asOwner.body.data).sort()).toEqual([restricted, shared].sort());
    });

    it('rolls a portfolio up over the visible projects only', async () => {
        const created = await owner.api.post('/api/v1/portfolio', { name: `Isolation ${uniqueSuffix()}`, projectIds: [restricted, shared] });
        const portfolioId = created.body.data._id;
        try {
            const asMember = await member.api.get(`/api/v1/portfolio/${portfolioId}/rollup`);
            expect(idsIn(asMember.body.data.projects)).toEqual([shared]);
            const asOwner = await owner.api.get(`/api/v1/portfolio/${portfolioId}/rollup`);
            expect(idsIn(asOwner.body.data.projects).sort()).toEqual([restricted, shared].sort());
        } finally {
            await owner.api.delete(`/api/v1/portfolio/${portfolioId}`);
        }
    });
});

describe('PRJ-03: a private project\'s contents are not writable by a user outside it', () => {
    it('refuses a guest creating an epic', async () => {
        const res = await guest.api.post('/api/v2/epics', { name: 'Guest epic', projectId: restricted, userData: { id: guest.uid } });
        expect(refusedAs(res, [404])).toBe(true);
    });

    it('refuses a member creating a sprint', async () => {
        const res = await member.api.post('/api/v1/sprint', {
            companyId: member.companyId, projectId: restricted, sprintName: 'Member sprint', userData: { id: member.uid }, projectName: 'x',
        });
        expect(refusedAs(res, [404])).toBe(true);
    });

    it('refuses a member starting the project\'s sprint', async () => {
        const res = await member.api.post('/api/v2/sprints/start', { sprintId: restrictedSprint._id });
        expect(refusedAs(res, [404])).toBe(true);
    });

    it('refuses a guest creating a recurring rule', async () => {
        const res = await guest.api.post('/api/v1/recurring-tasks', { name: 'Guest rule', taskName: 'x', freq: 'daily', projectData: { _id: restricted } });
        expect(refusedAs(res, [404])).toBe(true);
    });

    it('refuses a member creating a project calendar feed', async () => {
        const res = await member.api.post('/api/v1/calendar/feeds', { scope: 'project', projectId: restricted, name: 'Member feed' });
        expect(refusedAs(res, [404])).toBe(true);
    });
});

describe('the people inside a project keep their access', () => {
    it('lets an assigned member read the shared project and its screens', async () => {
        const project = await member.api.get(`/api/v1/project/${shared}`);
        expect(project.status).toBe(200);
        expect(String(project.body._id)).toBe(shared);
        expect((await member.api.get('/api/v2/epics', { query: { projectId: shared } })).body.status).toBe(true);
        expect((await member.api.get(`/api/v1/project-dashboard/${shared}`)).body.status).toBe(true);
        expect((await listSprints(member.api, shared)).length).toBeGreaterThan(0);
    });

    it('lets an admin read a private project they are not assigned to', async () => {
        const project = await admin.api.get(`/api/v1/project/${restricted}`);
        expect(project.status).toBe(200);
        expect((await admin.api.get(`/api/v1/project-dashboard/${restricted}`)).body.status).toBe(true);
    });
});

describe('PRJ-04: PUT /api/v1/project/allTask/:id stays inside its own project', () => {
    it('refuses a findObject naming another project and leaves that project\'s task alone', async () => {
        const projectA = await createProject(owner.api, { name: `A ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid });
        const projectB = await createProject(owner.api, { name: `B ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid, isPrivate: true });
        const task = await createTask(owner.api, { project: projectB, name: 'Original B name', user: state.users.owner, companyOwnerId: owner.uid });
        const res = await owner.api.put(`/api/v1/project/allTask/${projectA._id}`, {
            findObject: { ProjectID: projectB._id, _id: task._id }, updateObject: { TaskName: 'Renamed across projects' },
        });
        expect(refusedAs(res, [400])).toBe(true);
        await owner.api.put(`/api/v1/project/allTask/${projectA._id}`, { findObject: { _id: task._id }, updateObject: { TaskName: 'Renamed across projects' } });
        const [row] = (await owner.api.get('/api/v1/projectdata/taskData', { query: { taskId: task._id, projectId: projectB._id, subTaskLimit: 1 } })).body;
        expect(row.tasks[0].TaskName).toBe('Original B name');
    });
});

describe('PRJ-05: deleting a saved filter uses the session company', () => {
    it('refuses a company id outside the session and deletes within it', async () => {
        const created = await owner.api.post('/api/v1/project/filter/create', {
            companyId: owner.companyId, userId: owner.uid, name: `Filter ${uniqueSuffix()}`, filter: 'projectFilter', typeFilter: 'projects',
        });
        const filterId = created.body.data._id;
        const foreign = await owner.api.delete(`/api/v1/project/filter/delete/${FOREIGN_COMPANY}/${filterId}`);
        expect(refusedAs(foreign, [403])).toBe(true);
        const own = await owner.api.delete(`/api/v1/project/filter/delete/${owner.companyId}/${filterId}`);
        expect(own.body.status).toBe(true);
    });
});
