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

/* The request EstimateHours.vue makes when the planner sidebar opens. */
async function readPlan(session, { project, task }) {
    return session.api.get(`/api/v1/estimatedTime/${project._id}/${task._id}`);
}

async function plan(session, { project, task }, { minutes = 90, date = dateAt(), userId } = {}) {
    return session.api.put('/api/v1/estimatedTime', {
        userId: userId || session.uid,
        taskId: task._id,
        projectId: project._id,
        date,
        minutes,
    });
}

const ownersOf = (rows) => [...new Set(rows.map((row) => String(row.UserId || row.userId)))].sort();

describe('GET /api/v1/estimatedTime/:pid/:tid only returns the plans the caller may read', () => {
    it('hides another person\'s planned hours from a member', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const target = await projectWithTask(owner, [owner, member]);

        expect((await plan(owner, target, { minutes: 120, date: dateAt(1) })).status).toBe(200);
        expect((await plan(member, target, { minutes: 30, date: dateAt(1) })).status).toBe(200);

        const res = await readPlan(member, target);
        expect(res.status).toBe(200);
        expect(ownersOf(res.body)).toEqual([String(member.uid)]);
        expect(res.body.every((row) => row.EstimatedTime === 30)).toBe(true);
    });

    it('hides everyone\'s planned hours from a guest who planned nothing', async () => {
        const owner = await loginAs('owner');
        const guest = await loginAs('guest');
        const target = await projectWithTask(owner, [owner, guest]);

        expect((await plan(owner, target, { minutes: 200, date: dateAt(2) })).status).toBe(200);

        const res = await readPlan(guest, target);
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    it('keeps an owner and an admin reading the whole team\'s plan', async () => {
        const owner = await loginAs('owner');
        const admin = await loginAs('admin');
        const member = await loginAs('member');
        const target = await projectWithTask(owner, [owner, admin, member]);

        expect((await plan(owner, target, { minutes: 60, date: dateAt(3) })).status).toBe(200);
        expect((await plan(member, target, { minutes: 45, date: dateAt(3) })).status).toBe(200);

        for (const session of [owner, admin]) {
            const res = await readPlan(session, target);
            expect(res.status).toBe(200);
            expect(ownersOf(res.body)).toEqual([String(member.uid), String(owner.uid)].sort());
        }
    });

    it('returns nothing on a project the caller cannot open', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const hidden = await projectWithTask(owner, [owner], { isPrivate: true });

        expect((await plan(owner, hidden, { minutes: 90, date: dateAt(4) })).status).toBe(200);

        const res = await readPlan(member, hidden);
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    it('still shows a member the row they just saved, the way the planner reloads it', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const target = await projectWithTask(owner, [owner, member]);
        const date = dateAt(5);

        const created = await plan(member, target, { minutes: 75, date });
        expect(created.status).toBe(200);

        const res = await readPlan(member, target);
        expect(res.status).toBe(200);
        const mine = res.body.find((row) => String(row._id) === String(created.body._id));
        expect(mine).toBeTruthy();
        expect(mine.EstimatedTime).toBe(75);
    });
});
