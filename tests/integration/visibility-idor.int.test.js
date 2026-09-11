const { createApiClient } = require('../../e2e/support/api');
const { createProject, createTask, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const anon = createApiClient({ baseURL: state.baseURL });
const refused = (res) => res.status >= 400 || (res.body && typeof res.body === 'object' && res.body.status === false);
const sameId = (a, b) => String(a) === String(b);

async function ownerOnlyTask(owner, name) {
    const project = await createProject(owner.api, { name: `VIS Restricted ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid, isPrivate: true });
    const task = await createTask(owner.api, { project, name: name || `VIS Secret ${uniqueSuffix()}`, user: state.users.owner, companyOwnerId: owner.uid });
    return { project, task };
}

async function sharedTask(owner, member) {
    const project = await createProject(owner.api, { name: `VIS Shared ${uniqueSuffix()}`, assigneeIds: [owner.uid, member.uid], createdBy: owner.uid });
    const task = await createTask(owner.api, { project, name: `VIS Shared Task ${uniqueSuffix()}`, user: state.users.owner, companyOwnerId: owner.uid });
    return { project, task };
}

describe('TSK-05 global search follows project visibility', () => {
    it('keeps a private project, its tasks and its comments out of a member\'s and a guest\'s results', async () => {
        const owner = await loginAs('owner');
        const marker = `Zsec${uniqueSuffix()}`;
        const project = await createProject(owner.api, { name: `Vault ${marker}`, assigneeIds: [owner.uid], createdBy: owner.uid, isPrivate: true });
        const task = await createTask(owner.api, { project, name: `Secret ${marker}`, user: state.users.owner, companyOwnerId: owner.uid });
        const comment = await owner.api.post('/api/v1/comments', {
            data: { message: `note ${marker}`, type: 'text', project: false, taskId: task._id, projectId: project._id, sprintId: task.sprintId },
        });
        expect(comment.body.status).toBe(true);

        for (const role of ['member', 'guest']) {
            const res = await (await loginAs(role)).api.post('/api/v2/search', { query: marker });
            expect(res.body.status).toBe(true);
            const { tasks, projects, comments } = res.body.data;
            expect(tasks.some((t) => sameId(t.ProjectID, project._id))).toBe(false);
            expect(projects.some((p) => sameId(p._id, project._id))).toBe(false);
            expect(comments.some((c) => sameId(c.projectId, project._id))).toBe(false);
        }

        const own = await owner.api.post('/api/v2/search', { query: marker });
        expect(own.body.data.tasks.some((t) => sameId(t._id, task._id))).toBe(true);
        expect(own.body.data.comments.some((c) => sameId(c.taskId, task._id))).toBe(true);
    });

    it('still finds a task in a project the member is on', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const marker = `Zshr${uniqueSuffix()}`;
        const project = await createProject(owner.api, { name: `VIS Shared ${uniqueSuffix()}`, assigneeIds: [owner.uid, member.uid], createdBy: owner.uid });
        const task = await createTask(owner.api, { project, name: `Shared ${marker}`, user: state.users.owner, companyOwnerId: owner.uid });

        const res = await member.api.post('/api/v2/search', { query: marker });
        expect(res.body.data.tasks.some((t) => sameId(t._id, task._id))).toBe(true);
    });
});

describe('TSK-06 the activity log follows project visibility', () => {
    it('answers 404 to a member for a private project they are not on, and serves the owner', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const { project, task } = await ownerOnlyTask(owner);
        const query = { fromProject: 'true', projectId: project._id, skip: '0', limit: '5' };

        const hidden = await member.api.get('/api/v1/activity-log', { query });
        expect(hidden.status).toBe(404);
        expect(hidden.body.status).toBe(false);
        const hiddenTask = await member.api.get('/api/v1/activity-log', { query: { ...query, fromProject: 'false', taskId: task._id } });
        expect(hiddenTask.status).toBe(404);

        const own = await owner.api.get('/api/v1/activity-log', { query });
        expect(own.status).toBe(200);
        expect(Array.isArray(own.body)).toBe(true);
    });

    it('answers 403 for a task log in a visible project while the member\'s Task Activity Log is off', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const { project, task } = await sharedTask(owner, member);
        const query = { fromProject: 'false', projectId: project._id, taskId: task._id, skip: '0', limit: '5' };

        const res = await member.api.get('/api/v1/activity-log', { query });
        expect(res.status).toBe(403);
        expect((await member.api.get('/api/v1/activity-log', { query: { ...query, fromProject: 'true' } })).status).toBe(200);
        expect((await owner.api.get('/api/v1/activity-log', { query })).status).toBe(200);
    });
});
