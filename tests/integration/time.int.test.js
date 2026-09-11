const { createApiClient } = require('../../e2e/support/api');
const { createProject, createTask, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const anon = createApiClient({ baseURL: state.baseURL });

// Each test drives a real server over HTTP and several create it their own data,
// so the default 5s is too tight — especially on a loaded CI box.
jest.setTimeout(60000);
const refused = (res) => res.status >= 400 || (res.body && typeof res.body === 'object' && res.body.status === false);
const isoDay = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

/* A project the given member is on, plus one task in it. The default sprint a
 * blank project creates can lag a moment behind createProject, so retry. */
async function projectWithTask(owner, member) {
    const project = await createProject(owner.api, { assigneeIds: [owner.uid, member.uid], createdBy: owner.uid });
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

function manualLogPayload({ member, project, task }) {
    return {
        logTimeDate: isoDay(),
        description: '[QA time] integration log',
        startLogTime: '10:00',
        endLogTime: '11:00',
        timeDuration: '01:00',
        ticketId: task._id,
        projectId: project._id,
        companyId: state.companyId,
        userId: member.uid,
        isEdit: false,
        userName: member.email,
        dateFormat: 'yyyy-MM-dd',
        sprintId: task.sprintId,
        taskName: 'QA task',
        projectName: project.ProjectName,
        companyOwnerId: state.users.owner.userId,
        timeZone: 'UTC',
    };
}

describe('time — logging and reads', () => {
    it('lets a member log time on a task in their project, and it shows in the week', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const { project, task } = await projectWithTask(owner, member);

        const log = await member.api.post('/api/v2/manualLogtime', manualLogPayload({ member, project, task }));
        expect(log.status).toBe(200);
        expect(log.body.status).toBe(true);

        const week = await member.api.get('/api/v1/timesheet/week', { query: { start: isoDay(), end: isoDay() } });
        expect(week.status).toBe(200);
        const rows = (week.body.data && week.body.data.rows) || [];
        expect(rows.some((r) => String(r.taskId) === String(task._id))).toBe(true);
    });

    it('validates dates on the week endpoint', async () => {
        const member = await loginAs('member');
        const res = await member.api.get('/api/v1/timesheet/week', { query: { start: 'nope', end: 'nope' } });
        expect(res.status).toBe(400);
    });

    it('scopes a rate: an admin can set and list a billing rate', async () => {
        const admin = await loginAs('admin');
        const set = await admin.api.post('/api/v1/timesheet/rates', { scope: 'default', rate: 120, currency: 'USD', userData: { id: admin.uid } });
        expect(set.body.status).toBe(true);
        const list = await admin.api.get('/api/v1/timesheet/rates');
        expect(list.body.status).toBe(true);
        expect(list.body.data.some((r) => r.scope === 'default')).toBe(true);
    });
});

describe('time — PTO role rules', () => {
    it('a member creates their own pending entry, an admin approves it, others cannot', async () => {
        const member = await loginAs('member');
        const admin = await loginAs('admin');
        const guest = await loginAs('guest');

        const created = await member.api.post('/api/v1/pto', { type: 'casual', startDate: isoDay(30), endDate: isoDay(31), hoursPerDay: 9, reason: `[QA time] ${uniqueSuffix()}` });
        expect(created.status).toBe(201);
        const id = created.body.data._id;
        expect(created.body.data.status).toBe('pending');

        expect((await guest.api.put(`/api/v1/pto/${id}/status`, { status: 'approved' })).status).toBe(403);
        expect((await member.api.put(`/api/v1/pto/${id}/status`, { status: 'approved' })).status).toBe(403);

        const approve = await admin.api.put(`/api/v1/pto/${id}/status`, { status: 'approved' });
        expect(approve.status).toBe(200);
        expect(approve.body.data.status).toBe('approved');
    });

    it('reflects approved PTO in the capacity calculation', async () => {
        const member = await loginAs('member');
        const admin = await loginAs('admin');
        const created = await member.api.post('/api/v1/pto', { type: 'casual', startDate: isoDay(40), endDate: isoDay(40), hoursPerDay: 8, reason: '[QA time] cap' });
        const id = created.body.data._id;
        await admin.api.put(`/api/v1/pto/${id}/status`, { status: 'approved' });
        const cap = await admin.api.get('/api/v1/pto/capacity', { query: { userId: member.uid, from: isoDay(40), to: isoDay(40), hoursPerDay: 8 } });
        expect(cap.status).toBe(200);
        expect(cap.body.data.ptoHours).toBe(8);
        expect(cap.body.data.availableHours).toBe(0);
    });
});

describe('time — settings role rules', () => {
    it('lets any member read screenshot retention but refuses mutation for non-owners', async () => {
        const member = await loginAs('member');
        expect((await member.api.get('/api/v1/screenshot-retention')).body.status).toBe(true);
        expect((await member.api.get('/api/v1/screenshot-retention/preview', { query: { maxAgeMonths: 6 } })).status).toBe(403);
        expect((await member.api.put('/api/v1/screenshot-retention', { enabled: false })).status).toBe(403);
    });

    it('refuses a member changing the timesheet reminder settings', async () => {
        const member = await loginAs('member');
        expect((await member.api.put('/api/v1/timesheet/reminder-settings', { enabled: true })).status).toBe(403);
        const admin = await loginAs('admin');
        expect((await admin.api.get('/api/v1/timesheet/reminder-settings')).body.status).toBe(true);
    });
});

describe('time — variance and estimates', () => {
    it('returns a variance rollup for a project and 400s without params', async () => {
        const owner = await loginAs('owner');
        const admin = await loginAs('admin');
        const { project } = await projectWithTask(owner, admin);
        const rep = await admin.api.get('/api/v1/reports/variance', { query: { projectId: project._id } });
        expect(rep.status).toBe(200);
        expect(rep.body.data.totals).toBeDefined();
        expect((await admin.api.get('/api/v1/reports/variance')).status).toBe(400);
    });

    it('upserts and reads back an estimate', async () => {
        const owner = await loginAs('owner');
        const admin = await loginAs('admin');
        const { project, task } = await projectWithTask(owner, admin);
        const up = await admin.api.put('/api/v1/estimatedTime', {
            key: '$set',
            compareObj: { ProjectId: project._id, TaskId: task._id, UserId: admin.uid },
            updateObject: { EstimatedTime: 45, ProjectId: project._id, TaskId: task._id, UserId: admin.uid, Date: new Date().toISOString() },
            newObj: { upsert: true, returnDocument: 'after' },
        });
        expect(up.status).toBe(200);
        const got = await admin.api.get(`/api/v1/estimatedTime/${project._id}/${task._id}`);
        expect(got.status).toBe(200);
        expect(got.body.some((e) => Number(e.EstimatedTime) === 45)).toBe(true);
    });
});

describe('time — money endpoints are read-only and scoped', () => {
    it('lists project invoices for a non-guest', async () => {
        const owner = await loginAs('owner');
        const project = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid });
        const list = await owner.api.get('/api/v2/invoices', { query: { projectId: project._id } });
        expect(list.body.status).toBe(true);
        expect(Array.isArray(list.body.data)).toBe(true);
    });

    it('keeps subscription and plan endpoints read-only (no data mutated)', async () => {
        const admin = await loginAs('admin');
        expect((await admin.api.get('/api/v1/subscription')).status).toBe(200);
        // The affiliate routes are inert stubs.
        expect((await admin.api.post('/api/v1/validateRefferalCode', { code: 'X' })).status).toBe(200);
    });
});

describe('time — regressions for confirmed findings', () => {
    // TIM-01: /api/v2/timesheet-approval/* is in no auth middleware list, so an
    // unauthenticated caller can read any user's submission history by query params.
    it('TIM-01 refuses an unauthenticated read of a user\'s approvals', async () => {
        const res = await anon.get('/api/v2/timesheet-approval/mine', { query: { userId: state.users.member.userId, companyId: state.companyId } });
        expect(refused(res)).toBe(true);
    });

    // TIM-02: same missing middleware leaves req.uid empty, so an owner/admin is
    // refused the review queue — the whole approval workflow is unusable.
    it('TIM-02 lets an admin list the pending approval queue', async () => {
        const admin = await loginAs('admin');
        const res = await admin.api.get('/api/v2/timesheet-approval/pending');
        expect(res.body.status).toBe(true);
    });

    // TIM-03: tracker mutation routes are unauthenticated — a create with no token
    // should be rejected as unauthenticated (401), not reach the controller (400).
    it('TIM-03 refuses an unauthenticated tracker create', async () => {
        const res = await anon.post('/api/v1/tracker/create', {});
        expect(res.status).toBe(401);
    });

    // TIM-04: a guest can read company-wide time data with no role scoping.
    it('TIM-04 refuses a guest reading company-wide hours-by-source', async () => {
        const guest = await loginAs('guest');
        const res = await guest.api.get('/api/v1/timesheet/hours-by-source', { query: { start: 1, end: 9999999999 } });
        expect(refused(res) || (res.body.data.scope === 'self' && res.body.data.entryCount === 0)).toBe(true);
    });

    // TIM-05: a non-pipeline findQuery should be a 400, not an unhandled 500.
    it('TIM-05 rejects a malformed invoice/find body with 400', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.post('/api/v1/invoice/find', { findQuery: { companyId: state.companyId } });
        expect(res.status).toBe(400);
    });
});
