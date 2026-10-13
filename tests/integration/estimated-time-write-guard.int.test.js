const { createProject, createTask, loginAs, readState } = require('../../e2e/support/fixtures');

const state = readState();

jest.setTimeout(90000);

const today = () => new Date().toISOString().slice(0, 10);
const dateAt = (dayOffset = 0) => {
    const day = new Date(`${today()}T00:00:00.000Z`);
    day.setUTCDate(day.getUTCDate() + dayOffset);
    return day.toISOString();
};

async function projectWithTask(owner, assignees, { isPrivate = false } = {}) {
    const project = await createProject(owner.api, { assigneeIds: assignees.map((s) => s.uid), createdBy: owner.uid, isPrivate });
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

/* EstimateHours.vue saves one planning row per person per day. */
const planBody = (session, { project, task }, { minutes = 90, date = dateAt(), userId, id } = {}) => ({
    ...(id ? { id } : {}),
    userId: userId || session.uid,
    taskId: task._id,
    projectId: project._id,
    date,
    minutes,
});

async function plan(session, target, over = {}) {
    const res = await session.api.put('/api/v1/estimatedTime', planBody(session, target, over));
    return res;
}

async function rowsFor(session, { project, task }) {
    const res = await session.api.get(`/api/v1/estimatedTime/${project._id}/${task._id}`);
    expect(res.status).toBe(200);
    return res.body;
}

const rowOf = (rows, userId) => rows.find((row) => String(row.UserId) === String(userId));

describe('PUT /api/v1/estimatedTime is built on the server, not the request body', () => {
    it('refuses the raw compareObj/key/updateObject body a member could use to rewrite anyone', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const target = await projectWithTask(owner, [owner, member]);

        expect((await plan(owner, target, { minutes: 120 })).status).toBe(200);
        const victim = rowOf(await rowsFor(owner, target), owner.uid);
        expect(victim.EstimatedTime).toBe(120);

        const attack = await member.api.put('/api/v1/estimatedTime', {
            key: '$set',
            compareObj: { _id: victim._id },
            updateObject: { EstimatedTime: 1, UserId: owner.uid, TaskId: target.task._id, ProjectId: target.project._id, Date: victim.Date },
            newObj: { new: true },
        });
        expect(attack.status).toBe(400);

        expect(rowOf(await rowsFor(owner, target), owner.uid).EstimatedTime).toBe(120);
    });

    it('refuses a member who names another member\'s row by id and leaves it alone', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const target = await projectWithTask(owner, [owner, member]);

        expect((await plan(owner, target, { minutes: 120 })).status).toBe(200);
        const victim = rowOf(await rowsFor(owner, target), owner.uid);

        const byId = await plan(member, target, { id: victim._id, minutes: 5, userId: owner.uid });
        expect(byId.status).toBe(403);

        const spoofed = await plan(member, target, { id: victim._id, minutes: 5 });
        expect([403, 404]).toContain(spoofed.status);

        expect(rowOf(await rowsFor(owner, target), owner.uid).EstimatedTime).toBe(120);
    });

    it('refuses a member planning time for someone else on a project they share', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const target = await projectWithTask(owner, [owner, member]);

        const res = await plan(member, target, { userId: owner.uid, minutes: 30, date: dateAt(1) });
        expect(res.status).toBe(403);

        expect(rowOf(await rowsFor(owner, target), owner.uid)).toBeUndefined();
    });

    it('refuses a member on a project they cannot open', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const hidden = await projectWithTask(owner, [owner], { isPrivate: true });

        const res = await plan(member, hidden, { minutes: 30 });
        expect(res.status).toBe(403);
        expect(rowOf(await rowsFor(owner, hidden), member.uid)).toBeUndefined();
    });

    it('lets a member create and then update their own row, the way the planner does', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const target = await projectWithTask(owner, [owner, member]);
        const date = dateAt(2);

        const created = await plan(member, target, { minutes: 45, date });
        expect(created.status).toBe(200);
        expect(created.body.EstimatedTime).toBe(45);
        expect(created.body.UserId).toBe(member.uid);

        const updated = await plan(member, target, { id: created.body._id, minutes: 75, date });
        expect(updated.status).toBe(200);
        expect(updated.body.EstimatedTime).toBe(75);
        expect(String(updated.body._id)).toBe(String(created.body._id));

        const again = await plan(member, target, { minutes: 15, date });
        expect(again.status).toBe(200);
        expect(String(again.body._id)).toBe(String(created.body._id));

        const rows = await rowsFor(owner, target);
        expect(rows.filter((row) => String(row.UserId) === String(member.uid))).toHaveLength(1);
    });

    it('keeps an admin able to plan another person\'s time', async () => {
        const owner = await loginAs('owner');
        const admin = await loginAs('admin');
        const member = await loginAs('member');
        const target = await projectWithTask(owner, [owner, member]);

        const res = await admin.api.put('/api/v1/estimatedTime', planBody(admin, target, { userId: member.uid, minutes: 60, date: dateAt(3) }));
        expect(res.status).toBe(200);
        expect(res.body.UserId).toBe(member.uid);
        expect(res.body.EstimatedTime).toBe(60);
    });

    it('keeps a guest to their own time and to what they can open', async () => {
        const owner = await loginAs('owner');
        const guest = await loginAs('guest');
        const target = await projectWithTask(owner, [owner]);
        const hidden = await projectWithTask(owner, [owner], { isPrivate: true });

        expect((await plan(guest, target, { userId: owner.uid, minutes: 30 })).status).toBe(403);
        expect((await plan(guest, hidden, { minutes: 30 })).status).toBe(403);
        expect((await plan(guest, target, { minutes: 30 })).status).toBe(200);
    });

    it.each([
        ['an operator where the person should be', { userId: { $ne: null } }],
        ['an operator where the task should be', { taskId: { $gt: '' } }],
        ['a minutes value that is not a number', { minutes: { $inc: 5 } }],
        ['a date that is not a date', { date: 'not-a-date' }],
    ])('refuses %s', async (label, over) => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const target = await projectWithTask(owner, [owner, member]);

        const res = await member.api.put('/api/v1/estimatedTime', { ...planBody(member, target), ...over });
        expect([label, res.status]).toEqual([label, 400]);
    });
});
