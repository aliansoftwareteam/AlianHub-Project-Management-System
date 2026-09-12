const { createProject, createTask, firstSprint, loginAs, readState } = require('../../e2e/support/fixtures');

const state = readState();

jest.setTimeout(120000);

async function projectWithTask(owner, assignees, taskAssigneeIds = []) {
    const project = await createProject(owner.api, { assigneeIds: assignees.map((s) => s.uid), createdBy: owner.uid });
    let lastErr;
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            const task = await createTask(owner.api, { project, user: state.users.owner, companyOwnerId: owner.uid, assigneeIds: taskAssigneeIds });
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

async function teamOf(owner, members) {
    const name = `Squad ${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const res = await owner.api.post('/api/v1/teams/addTeam', {
        name,
        value: name,
        teamColor: { color: '#4f46e5' },
        assigneeUsersArray: members.map(String),
    });
    expect(res.status).toBe(200);
    return String(res.body._id);
}

describe('a sprint shared with a team belongs to that team', () => {
    it('keeps the tasks readable for a member who is only on the sprint through their team', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const target = await projectWithTask(owner, [owner, member]);

        const teamId = await teamOf(owner, [member.uid]);
        await makeSprintPrivate(owner, target, [owner.uid, `tId_${teamId}`]);

        const list = await member.api.post('/api/v1/task/find', {
            findQuery: [{ $match: { objId: { ProjectID: String(target.project._id) } } }],
        });
        expect(list.status).toBe(200);
        expect(list.body.map((task) => String(task._id))).toContain(String(target.task._id));
        expect((await member.api.get(`/api/v1/task/${target.task._id}`)).status).toBe(200);
    });

    it('still refuses a member of no assigned team', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const guest = await loginAs('guest');
        const target = await projectWithTask(owner, [owner, member, guest]);

        const teamId = await teamOf(owner, [member.uid]);
        await makeSprintPrivate(owner, target, [`tId_${teamId}`]);

        expect((await guest.api.get(`/api/v1/task/${target.task._id}`)).status).toBe(404);
    });

    it('lists the sprint itself for the team member and hides it from everyone else', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const guest = await loginAs('guest');
        const target = await projectWithTask(owner, [owner, member, guest]);

        const teamId = await teamOf(owner, [member.uid]);
        const sprintId = await makeSprintPrivate(owner, target, [`tId_${teamId}`]);

        const idsFor = async (session) => {
            const res = await session.api.get(`/api/v1/project/sprintFolder/${target.project._id}?collection=sprints`);
            expect(res.status).toBe(200);
            return (res.body || []).map((sprint) => String(sprint._id));
        };
        expect(await idsFor(member)).toContain(sprintId);
        expect(await idsFor(guest)).not.toContain(sprintId);
    });

    it('leaves the private sprint out of the ?count=true sidebar counter', async () => {
        const owner = await loginAs('owner');
        const guest = await loginAs('guest');
        const target = await projectWithTask(owner, [owner, guest]);

        const countFor = async (session) => {
            const res = await session.api.get(`/api/v1/project/sprintFolder/${target.project._id}?collection=sprints&count=true`);
            expect(res.status).toBe(200);
            return (res.body && res.body[0] && res.body[0].count) || 0;
        };
        const before = await countFor(guest);
        await makeSprintPrivate(owner, target, [owner.uid]);
        expect(await countFor(guest)).toBe(before - 1);
        expect(await countFor(owner)).toBe(before);
    });
});

describe('the paths that used to guard at project level only', () => {
    let owner;
    let guest;
    let target;
    let sprintId;

    beforeAll(async () => {
        owner = await loginAs('owner');
        guest = await loginAs('guest');
        /* The dashboard shows a plain member only their own tasks, so the task is the
         * guest's: without the sprint rule it would still be counted for them. */
        target = await projectWithTask(owner, [owner, guest], [guest.uid]);
        sprintId = await makeSprintPrivate(owner, target, [owner.uid]);
    });

    it('answers the scrum board reads with 404 for a project member who is not on the sprint', async () => {
        const refusals = [
            await guest.api.get(`/api/v2/sprints/report?sprintId=${sprintId}&companyId=${state.companyId}`),
            await guest.api.get(`/api/v2/sprints/complete-preview?sprintId=${sprintId}&companyId=${state.companyId}`),
            await guest.api.post('/api/v2/sprints/burndown', { sprintId, companyId: state.companyId }),
            await guest.api.post('/api/v2/sprints/hours', { sprintId, companyId: state.companyId }),
        ];
        refusals.forEach((res) => expect(res.status).toBe(404));
    });

    it('answers the agile reports addressed by sprint id with 404', async () => {
        for (const path of ['burndown', 'sprint-insights', 'provenance']) {
            const res = await guest.api.get(`/api/v1/agile/${path}?sprintId=${sprintId}`);
            expect(res.status).toBe(404);
        }
    });

    it('serves the same reads to the owner', async () => {
        expect((await owner.api.get(`/api/v2/sprints/report?sprintId=${sprintId}&companyId=${state.companyId}`)).status).toBe(200);
        expect((await owner.api.get(`/api/v1/agile/burndown?sprintId=${sprintId}`)).status).toBe(200);
    });

    it('leaves the private sprint\'s task out of the project dashboard counts', async () => {
        /* A fresh project, because the counters are read before and after the toggle. */
        const own = await projectWithTask(owner, [owner, guest], [guest.uid]);
        const totalFor = async (session) => {
            const res = await session.api.get(`/api/v1/project-dashboard/${own.project._id}`);
            expect(res.status).toBe(200);
            return res.body.data.totalTasks;
        };
        expect(await totalFor(guest)).toBe(1);
        await makeSprintPrivate(owner, own, [owner.uid]);
        expect(await totalFor(guest)).toBe(0);
        expect(await totalFor(owner)).toBe(1);
    });

    it('leaves the private sprint out of a custom report grouped by sprint', async () => {
        const config = { source: 'tasks', dimension: 'sprint', metric: 'count', chartType: 'bar', filters: {} };
        const mine = await owner.api.post('/api/v1/reports/custom/run', config);
        expect(mine.status).toBe(200);
        expect(mine.body.data.result.map((row) => String(row.key))).toContain(sprintId);

        const theirs = await guest.api.post('/api/v1/reports/custom/run', config);
        expect(theirs.status).toBe(200);
        expect(theirs.body.data.result.map((row) => String(row.key))).not.toContain(sprintId);
    });

    it('refuses to export the private sprint for someone not on it', async () => {
        const res = await guest.api.post('/api/v2/exports', {
            format: 'csv', projectId: String(target.project._id), sprintId, projectName: 'P',
        });
        expect(res.body.status).toBe(false);
    });

    it('refuses a variance report for the private sprint', async () => {
        const res = await guest.api.get(`/api/v1/reports/variance?sprintId=${sprintId}`);
        expect(res.status).toBe(404);
    });

    it('refuses a public link to the private sprint', async () => {
        const res = await guest.api.post('/api/v2/public-shares', { entityType: 'sprint', entityId: sprintId });
        expect(res.body.status).toBe(false);
        const asOwner = await owner.api.post('/api/v2/public-shares', { entityType: 'sprint', entityId: sprintId });
        expect(asOwner.body.status).toBe(false);
        expect(String(asOwner.body.statusText)).toContain('private');
    });
});
