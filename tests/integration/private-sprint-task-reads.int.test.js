const { createProject, createTask, firstSprint, loginAs, readState } = require('../../e2e/support/fixtures');

const state = readState();

jest.setTimeout(90000);

async function projectWithTask(owner, assignees) {
    const project = await createProject(owner.api, { assigneeIds: assignees.map((s) => s.uid), createdBy: owner.uid });
    let lastErr;
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            const task = await createTask(owner.api, { project, user: state.users.owner, companyOwnerId: owner.uid });
            return { project, task };
        } catch (err) {
            lastErr = err;
            await new Promise((resolve) => setTimeout(resolve, 300));
        }
    }
    throw lastErr;
}

/* What the sprint row's "Share With: Private" toggle sends (SprintsList.vue). */
async function makeSprintPrivate(owner, { project }, assigneeIds) {
    const sprint = await firstSprint(owner.api, project._id);
    const res = await owner.api.patch(`/api/v1/sprint/${sprint._id}`, {
        type: 'updateSprint',
        companyId: state.companyId,
        projectId: String(project._id),
        updateObject: { $set: { private: true, AssigneeUserId: assigneeIds.map(String) } },
    });
    expect(res.body.status).toBe(true);
    return String(sprint._id);
}

const findTasks = (session, projectId) => session.api.post('/api/v1/task/find', {
    findQuery: [{ $match: { objId: { ProjectID: String(projectId) } } }],
});

describe('a private sprint hides its tasks from everyone who is not on it', () => {
    it('leaves the tasks out of POST /api/v1/task/find for a member of the project', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const target = await projectWithTask(owner, [owner, member]);

        const before = await findTasks(member, target.project._id);
        expect(before.status).toBe(200);
        expect(before.body.map((task) => String(task._id))).toContain(String(target.task._id));

        await makeSprintPrivate(owner, target, [owner.uid]);

        const after = await findTasks(member, target.project._id);
        expect(after.status).toBe(200);
        expect(after.body.map((task) => String(task._id))).not.toContain(String(target.task._id));
    });

    it('answers GET /api/v1/task/:id like a task that does not exist', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const target = await projectWithTask(owner, [owner, member]);

        await makeSprintPrivate(owner, target, [owner.uid]);

        const res = await member.api.get(`/api/v1/task/${target.task._id}`);
        expect(res.status).toBe(404);
    });

    it('keeps the tasks for a member the sprint is shared with', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const target = await projectWithTask(owner, [owner, member]);

        await makeSprintPrivate(owner, target, [owner.uid, member.uid]);

        const list = await findTasks(member, target.project._id);
        expect(list.body.map((task) => String(task._id))).toContain(String(target.task._id));
        expect((await member.api.get(`/api/v1/task/${target.task._id}`)).status).toBe(200);
    });

    it('keeps the tasks for an owner and an admin who are not on the sprint', async () => {
        const owner = await loginAs('owner');
        const admin = await loginAs('admin');
        const member = await loginAs('member');
        const target = await projectWithTask(owner, [owner, admin, member]);

        await makeSprintPrivate(owner, target, [member.uid]);

        for (const session of [owner, admin]) {
            const list = await findTasks(session, target.project._id);
            expect(list.body.map((task) => String(task._id))).toContain(String(target.task._id));
            expect((await session.api.get(`/api/v1/task/${target.task._id}`)).status).toBe(200);
        }
    });

    it('leaves a public sprint in the same project alone', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const target = await projectWithTask(owner, [owner, member]);

        const list = await findTasks(member, target.project._id);
        expect(list.status).toBe(200);
        expect(list.body.map((task) => String(task._id))).toContain(String(target.task._id));
        expect((await member.api.get(`/api/v1/task/${target.task._id}`)).status).toBe(200);
    });
});
