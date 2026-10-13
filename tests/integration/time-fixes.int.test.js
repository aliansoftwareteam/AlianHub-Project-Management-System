const { createProject, createTask, loginAs, readState } = require('../../e2e/support/fixtures');

const state = readState();

jest.setTimeout(60000);
const isoDay = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

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

async function logHour(member, { project, task }) {
    const res = await member.api.post('/api/v2/manualLogtime', {
        logTimeDate: isoDay(),
        description: '[QA time] fixes log',
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
    });
    expect(res.body.status).toBe(true);
}

describe('time — regressions for confirmed findings', () => {
    it('TIM-04 limits a member\'s variance summary to their own time', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const admin = await loginAs('admin');
        await logHour(owner, await projectWithTask(owner, member));

        const window = { from: isoDay(-1), to: isoDay(1) };
        const mine = await member.api.get('/api/v1/reports/variance/summary', { query: window });
        expect(mine.status).toBe(200);
        expect(mine.body.data.byPerson.every((p) => p.key === member.uid)).toBe(true);
        const all = await admin.api.get('/api/v1/reports/variance/summary', { query: window });
        expect(all.body.data.byPerson.some((p) => p.key === owner.uid)).toBe(true);
    });

    it('TIM-04 refuses a member the variance report of a private project they are not on', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const project = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid, isPrivate: true });
        const res = await member.api.get('/api/v1/reports/variance', { query: { projectId: project._id } });
        expect(res.status).toBe(403);
    });

    it('TIM-04 keeps billing rates from a member', async () => {
        const member = await loginAs('member');
        const list = await member.api.get('/api/v1/timesheet/rates');
        expect(list.body.data).toEqual([]);
        const set = await member.api.post('/api/v1/timesheet/rates', { scope: 'default', rate: 1, currency: 'USD' });
        expect(set.status).toBe(403);
    });

    it('TIM-06 refuses draft-from-month on a project with no billing contract', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const target = await projectWithTask(owner, member);
        await logHour(member, target);
        const res = await owner.api.post('/api/v2/invoices/draft-from-month', { projectId: target.project._id, month: isoDay().slice(0, 7) });
        expect(res.status).toBe(400);
        expect(res.body.statusText).toMatch(/billing contract/);
    });

    it('TIM-06 lets an owner delete a draft invoice, but not an issued one or as a member', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const target = await projectWithTask(owner, member);
        const projectId = target.project._id;
        await logHour(member, target);
        const contract = await owner.api.put('/api/v2/billing/contract', { projectId, clientName: '[QA time] client', billingMode: 'hourly' });
        expect(contract.body.status).toBe(true);

        const draft = async () => {
            const res = await owner.api.post('/api/v2/invoices/draft-from-month', { projectId, month: isoDay().slice(0, 7) });
            expect(res.body.status).toBe(true);
            return res.body.data._id;
        };

        const first = await draft();
        expect((await member.api.delete(`/api/v2/invoices/${first}`, { query: { projectId } })).status).toBe(403);
        const removed = await owner.api.delete(`/api/v2/invoices/${first}`, { query: { projectId } });
        expect(removed.status).toBe(200);
        const list = await owner.api.get('/api/v2/invoices', { query: { projectId } });
        expect(list.body.data.some((inv) => inv._id === first)).toBe(false);

        const second = await draft();
        expect((await owner.api.post(`/api/v2/invoices/${second}/send`, {})).body.status).toBe(true);
        expect((await owner.api.delete(`/api/v2/invoices/${second}`, { query: { projectId } })).status).toBe(409);
    });

    it('16a keeps subscription invoices to the instance owner', async () => {
        const body = { findQuery: [{ $match: {} }, { $limit: 1 }] };
        expect((await (await loginAs('admin')).api.post('/api/v1/invoice/find', body)).status).toBe(403);
        expect((await (await loginAs('member')).api.post('/api/v1/invoice/find', body)).status).toBe(403);
        expect((await (await loginAs('owner')).api.post('/api/v1/invoice/find', body)).status).toBe(200);
    });

    it('16c limits a member\'s timesheet reads to their own time whatever the body claims', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const admin = await loginAs('admin');
        const target = await projectWithTask(owner, member);
        await logHour(owner, target);
        await logHour(member, target);

        const forged = { companyUserDetail: { roleType: 1 }, timeZone: 'UTC' };
        const reads = [
            ['/api/v1/timesheet/user', { selectedFilter: [], userArray: [owner.uid], projectArray: [], start: 0, end: 9999999999, ...forged }],
            ['/api/v1/timesheet/workload', { selectedFilter: [], userArray: [owner.uid], projectArray: [], start: 0, end: 9999999999, ...forged }],
            ['/api/v1/timesheet/project', { filterProjectIds: [], filterUserIds: [owner.uid], projectIds: [target.project._id], startNumber: 0, endNumber: 9999999999000, projectTimesheetPermission: true, userId: owner.uid, ...forged }],
            ['/api/v1/timesheet', { queryeta: [{ $match: { ProjectId: target.project._id } }, { $group: { _id: '$Loggeduser', total: { $sum: '$LogTimeDuration' } } }] }],
        ];
        const loggers = (rows) => rows.flatMap((row) => [
            row.user,
            typeof row._id === 'string' ? row._id : null,
            ...(row.data || []).map((entry) => entry.userId),
        ]).filter(Boolean);

        for (const [path, body] of reads) {
            const mine = await member.api.post(path, body);
            expect([path, mine.status]).toEqual([path, 200]);
            expect([path, loggers(mine.body).length > 0 && loggers(mine.body).every((uid) => uid === member.uid)]).toEqual([path, true]);
            const all = await admin.api.post(path, body);
            expect([path, loggers(all.body).includes(owner.uid)]).toEqual([path, true]);
        }

        const join = await member.api.post('/api/v1/timesheet', { queryeta: [{ $lookup: { from: 'users', localField: 'Loggeduser', foreignField: '_id', as: 'u' } }] });
        expect(join.status).toBe(400);
    });

    it('16d refuses draft-from-milestone on a project with no billing contract', async () => {
        const owner = await loginAs('owner');
        const project = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid });
        const res = await owner.api.post('/api/v2/invoices/draft-from-milestone', { projectId: project._id, milestoneId: '6f0000000000000000000e01' });
        expect(res.status).toBe(400);
        expect(res.body.statusText).toMatch(/billing contract/);
    });
});
