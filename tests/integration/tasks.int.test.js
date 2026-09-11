const { createApiClient } = require('../../e2e/support/api');
const { createProject, createTask, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const anon = createApiClient({ baseURL: state.baseURL });
const refused = (res) => res.status >= 400 || (res.body && typeof res.body === 'object' && res.body.status === false);

// A task in the owner-only ("restricted") fixture project — the member/guest are not on it.
async function ownerOnlyTask(owner) {
    const project = await createProject(owner.api, {
        name: `TSK Restricted ${uniqueSuffix()}`,
        assigneeIds: [owner.uid],
        createdBy: owner.uid,
        isPrivate: true,
    });
    const task = await createTask(owner.api, { project, name: `TSK Secret ${uniqueSuffix()}`, user: state.users.owner, companyOwnerId: owner.uid });
    return { project, task };
}

describe('tasks & collaboration — happy paths', () => {
    it('owner creates a task, comments, reacts, and records a recent visit', async () => {
        const owner = await loginAs('owner');
        const project = await createProject(owner.api, { name: `TSK HP ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid });
        const task = await createTask(owner.api, { project, name: `TSK Task ${uniqueSuffix()}`, user: state.users.owner, companyOwnerId: owner.uid });

        const comment = await owner.api.post('/api/v1/comments', {
            data: { message: 'first comment', type: 'text', project: false, taskId: task._id, projectId: project._id, sprintId: task.sprintId },
        });
        expect(comment.status).toBe(200);
        expect(comment.body.status).toBe(true);

        const reaction = await owner.api.post('/api/v2/reactions', {
            targetType: 'task', targetId: task._id, emoji: '👍', userData: { id: owner.uid },
        });
        expect(reaction.body.status).toBe(true);
        expect(reaction.body.data.reactions.some((r) => r.emoji === '👍')).toBe(true);

        const visit = await owner.api.post('/api/v2/recent-visits', { entityType: 'task', entityId: task._id, userData: { id: owner.uid } });
        expect(visit.body.status).toBe(true);
        const list = await owner.api.get('/api/v2/recent-visits', { query: { uid: owner.uid } });
        expect(list.body.status).toBe(true);
        expect(list.body.data.some((row) => String(row.task._id) === String(task._id))).toBe(true);
    });

    it('owner can create, list, update and delete a personal note', async () => {
        const owner = await loginAs('owner');
        const created = await owner.api.post('/api/v1/notes', { title: `TSK Note ${uniqueSuffix()}`, content: 'body', userData: { id: owner.uid } });
        expect(created.body.status).toBe(true);
        const id = created.body.data._id;

        const listed = await owner.api.get('/api/v1/notes');
        expect(listed.body.status).toBe(true);
        expect(listed.body.data.some((n) => String(n._id) === String(id))).toBe(true);

        expect((await owner.api.patch(`/api/v1/notes/${id}`, { content: 'edited' })).body.status).toBe(true);
        expect((await owner.api.delete(`/api/v1/notes/${id}`)).body.status).toBe(true);
    });

    it('owner can create and list a clip', async () => {
        const owner = await loginAs('owner');
        const created = await owner.api.post('/api/v1/clips', { title: `TSK Clip ${uniqueSuffix()}`, url: 'clips/x.webm', mediaType: 'video', userData: { id: owner.uid } });
        expect(created.body.status).toBe(true);
        const listed = await owner.api.get('/api/v1/clips', { query: { userId: owner.uid } });
        expect(listed.body.data.some((c) => String(c._id) === String(created.body.data._id))).toBe(true);
    });

    it('owner can save a company custom field and read it back', async () => {
        const owner = await loginAs('owner');
        const title = `[QA tasks] Field ${uniqueSuffix()}`;
        const save = await owner.api.post('/api/v1/customField', {
            type: 'save',
            updateObject: { fieldTitle: title, fieldDescription: title, fieldType: 'text', type: 'task', global: true, isDelete: true, projectId: [], userId: owner.uid },
        });
        expect(save.status).toBe(200);
        const read = await owner.api.get('/api/v1/customField', { query: { global: 'false' } });
        expect(Array.isArray(read.body)).toBe(true);
        expect(read.body.some((f) => f.fieldTitle === title)).toBe(true);
    });

    it('owner global search finds a task in their own project', async () => {
        const owner = await loginAs('owner');
        const marker = `Zqx${uniqueSuffix()}`;
        const project = await createProject(owner.api, { name: `TSK Search ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid });
        const task = await createTask(owner.api, { project, name: `Findable ${marker}`, user: state.users.owner, companyOwnerId: owner.uid });
        const res = await owner.api.post('/api/v2/search', { query: marker });
        expect(res.body.status).toBe(true);
        expect(res.body.data.tasks.some((t) => String(t._id) === String(task._id))).toBe(true);
    });

    it('owner lists the trash without error', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.get('/api/v2/trash', { query: { kind: 'tasks' } });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(true);
    });

    it('a member can list task relations on a shared task', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const project = await createProject(owner.api, { name: `TSK Rel ${uniqueSuffix()}`, assigneeIds: [owner.uid, member.uid], createdBy: owner.uid });
        const task = await createTask(owner.api, { project, name: `TSK Rel Task ${uniqueSuffix()}`, user: state.users.owner, companyOwnerId: owner.uid });
        const res = await member.api.post('/api/v2/tasks/relations', { action: 'list', taskId: task._id });
        expect(res.body.status).toBe(true);
    });
});

describe('tasks & collaboration — auth refusals that work', () => {
    it.each([
        ['GET', '/api/v1/notes'],
        ['GET', '/api/v1/mediaFiles'],
        ['GET', '/api/v1/comments/get-paginated-messages'],
    ])('refuses an anonymous %s %s', async (method, path) => {
        const res = await anon.request(method, path);
        expect(res.status).toBe(401);
    });

    it('refuses an anonymous reaction', async () => {
        const res = await anon.post('/api/v2/reactions', { targetType: 'task', targetId: 'x', emoji: '👍' });
        expect(res.status).toBe(401);
    });

    it('rejects an unknown relation action', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.post('/api/v2/tasks/relations', { action: 'nope', taskId: 'x' });
        expect(res.body.status).toBe(false);
    });
});

describe('tasks & collaboration — confirmed findings (regressions)', () => {
    // TSK-01
    it.failing('TSK-01: refuses a client-supplied aggregation pipeline on POST /api/v1/task/find', async () => {
        const member = await loginAs('member');
        const res = await member.api.post('/api/v1/task/find', {
            findQuery: [
                { $limit: 1 },
                { $lookup: { from: 'company_users', pipeline: [{ $project: { roleType: 1 } }], as: 'x' } },
                { $project: { n: { $size: '$x' } } },
            ],
        });
        // Should be refused; today it returns an array that has read another collection.
        expect(refused(res)).toBe(true);
    });

    // TSK-02
    it('TSK-02: refuses an arbitrary Mongoose operation key on PUT /api/v1/task', async () => {
        const member = await loginAs('member');
        const res = await member.api.put('/api/v1/task', {
            firstParameter: {}, secondParameter: { _id: 1 }, key: 'estimatedDocumentCount', isConvertFirstParameter: false,
        });
        expect(refused(res)).toBe(true);
    });

    // TSK-04
    it('TSK-04: requires auth for POST /api/v1/getTaskTypeImage', async () => {
        const res = await anon.post('/api/v1/getTaskTypeImage', { companyId: state.companyId, path: 'setting/task_type/task.png' });
        expect(res.status).toBe(401);
    });

    // TSK-05
    it('TSK-05: global search excludes projects the caller is not a member of', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const marker = `Zsec${uniqueSuffix()}`;
        const project = await createProject(owner.api, { name: `TSK Priv ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid, isPrivate: true });
        await createTask(owner.api, { project, name: `Secret ${marker}`, user: state.users.owner, companyOwnerId: owner.uid });
        const res = await member.api.post('/api/v2/search', { query: marker });
        const leaked = (res.body.data.tasks || []).some((t) => String(t.ProjectID) === String(project._id));
        expect(leaked).toBe(false);
    });

    // TSK-06
    it('TSK-06: activity log refuses a project the caller is not a member of', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const { project } = await ownerOnlyTask(owner);
        const res = await member.api.get('/api/v1/activity-log', { query: { fromProject: 'true', projectId: project._id, skip: '0', limit: '5' } });
        // Correct behaviour: refuse. Today it answers 200 with the project's history.
        expect(refused(res)).toBe(true);
    });

    // TSK-08
    it('TSK-08: recent visits are not readable for another user', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const { task } = await ownerOnlyTask(owner);
        await owner.api.post('/api/v2/recent-visits', { entityType: 'task', entityId: task._id, userData: { id: owner.uid } });
        const res = await member.api.get('/api/v2/recent-visits', { query: { uid: owner.uid } });
        const sawOwnersVisit = (res.body.data || []).some((row) => String(row.task._id) === String(task._id));
        expect(sawOwnersVisit).toBe(false);
    });
});
