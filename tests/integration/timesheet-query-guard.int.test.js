const { createProject, createTask, loginAs, readState } = require('../../e2e/support/fixtures');

const state = readState();

jest.setTimeout(90000);

const today = () => new Date().toISOString().slice(0, 10);
const windowSeconds = () => {
    const now = Math.floor(Date.now() / 1000);
    return { start: now - 2 * 86400, end: now + 2 * 86400 };
};
const suffix = () => Math.random().toString(36).slice(2, 8);

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

async function logHour(session, { project, task }) {
    const res = await session.api.post('/api/v2/manualLogtime', {
        logTimeDate: today(),
        description: '[QA 635] guard log',
        startLogTime: '10:00',
        endLogTime: '11:00',
        timeDuration: '01:00',
        ticketId: task._id,
        projectId: project._id,
        companyId: state.companyId,
        userId: session.uid,
        isEdit: false,
        userName: session.email,
        dateFormat: 'yyyy-MM-dd',
        sprintId: task.sprintId,
        taskName: 'QA task',
        projectName: project.ProjectName,
        companyOwnerId: state.users.owner.userId,
        timeZone: 'UTC',
    });
    expect(res.body.status).toBe(true);
}

async function planHour(session, { project, task }) {
    const date = `${today()}T00:00:00.000Z`;
    const res = await session.api.put('/api/v1/estimatedTime', {
        key: '$set',
        updateObject: { UserId: session.uid, TaskId: task._id, ProjectId: project._id, EstimatedTime: 90, Date: date },
        compareObj: { userId: session.uid, Date: date, TaskId: task._id },
        newObj: { upsert: true, new: true },
    });
    expect(res.status).toBe(200);
}

/* TotalTaskCardComponent.vue: measure 1 posts to /api/v1/estimatedTime, measure 2 to /api/v1/timesheet. */
const totalCardQuery = (measure, { projectId, userIds, start, end }) => [
    {
        $match: {
            ProjectId: { $in: [projectId] },
            ...(measure === 2 && { LogStartTime: { $gte: start, $lte: end } }),
            ...(measure === 1 && { Date: { dbDate: { $gte: start * 1000, $lte: end * 1000 } } }),
            ...(measure === 2 && { Loggeduser: { $in: userIds } }),
            ...(measure === 1 && { UserId: { $in: userIds } }),
        },
    },
    {
        $lookup: {
            from: 'tasks',
            let: { taskIdRef: { $convert: { input: measure === 1 ? '$TaskId' : '$TicketID', to: 'objectId', onError: null } } },
            pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$taskIdRef'] } } }],
            as: 'matchedTasks',
        },
    },
    { $match: { matchedTasks: { $ne: [] } } },
    { $group: { _id: null, totalEstimatedTime: { $sum: measure === 1 ? '$EstimatedTime' : '$LogTimeDuration' } } },
];

/* time-tracker-app/renderer/pages/home.jsx getTasksForList, the worked-tasks half. */
const trackerTodayQuery = ({ userId, projectIDs, startDate, endDate }) => [
    {
        $match: {
            $and: [
                { Loggeduser: { $in: [userId] } },
                { ProjectId: { $in: projectIDs } },
                { LogStartTime: { $gte: (startDate / 1000), $lte: (endDate / 1000) } },
                { logAddType: { $in: [0, 1] } },
            ],
        },
    },
    { $sort: { TicketID: 1, LogStartTime: -1 } },
    { $group: { _id: '$TicketID', doc: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$doc' } },
    { $addFields: { TaskId: { $toObjectId: '$TicketID' } } },
    {
        $lookup: {
            from: 'tasks',
            localField: 'TaskId',
            foreignField: '_id',
            as: 'taskData',
            pipeline: [
                { $lookup: { from: 'folders', localField: 'folderObjId', foreignField: '_id', as: 'folderArray', pipeline: [{ $project: { name: 1 } }] } },
                { $lookup: { from: 'sprints', localField: 'sprintId', foreignField: '_id', as: 'sprintData', pipeline: [{ $project: { name: 1, folderId: 1 } }] } },
            ],
        },
    },
    { $unwind: '$taskData' },
];

const rowsIn = async (owner, collection) => {
    const res = await owner.api.post('/api/v1/timesheet', { queryeta: [{ $limit: 1 }, { $lookup: { from: collection, pipeline: [], as: 'rows' } }] });
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    return res.body[0].rows;
};

describe('review 635 — timesheet and estimate queries against real Mongo', () => {
    it('gives a member a non-zero tracked-time card total on their own project', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const target = await projectWithTask(owner, [owner, member]);
        await logHour(member, target);

        const query = totalCardQuery(2, { projectId: target.project._id, userIds: [member.uid], ...windowSeconds() });
        const res = await member.api.post('/api/v1/timesheet', { queryeta: query });
        expect(res.status).toBe(200);
        expect(res.body[0] && res.body[0].totalEstimatedTime).toBeGreaterThan(0);
    });

    it('gives a member a non-zero planned-time card total on their own project', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const target = await projectWithTask(owner, [owner, member]);
        await planHour(member, target);

        const query = totalCardQuery(1, { projectId: target.project._id, userIds: [member.uid], ...windowSeconds() });
        const res = await member.api.post('/api/v1/estimatedTime', { queryeta: query });
        expect(res.status).toBe(200);
        expect(res.body[0] && res.body[0].totalEstimatedTime).toBe(90);
    });

    it('answers the desktop tracker\'s Today query for a member, with task and sprint names', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const target = await projectWithTask(owner, [owner, member]);
        await logHour(member, target);

        const { start, end } = windowSeconds();
        const res = await member.api.post('/api/v1/timesheet', {
            queryeta: trackerTodayQuery({ userId: member.uid, projectIDs: [target.project._id], startDate: start * 1000, endDate: end * 1000 }),
        });
        expect(res.status).toBe(200);
        const row = res.body.find((r) => String(r.taskData._id) === String(target.task._id));
        expect(row).toBeDefined();
        expect(row.taskData.TaskName).toBeTruthy();
        expect(Array.isArray(row.taskData.folderArray)).toBe(true);
        expect(row.taskData.sprintData).toHaveLength(1);
    });

    it('refuses a member\'s $out and $merge on estimatedTime and writes nothing', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const target = await projectWithTask(owner, [owner, member]);
        await logHour(member, target);
        await planHour(member, target);
        const probe = `r635_probe_${suffix()}`;

        const writes = [
            [{ $match: {} }, { $out: probe }],
            [{ $limit: 1 }, { $merge: { into: probe, whenMatched: 'merge', whenNotMatched: 'insert' } }],
            [{ $limit: 1 }, { $facet: { a: [{ $match: {} }] } }, { $merge: { into: probe } }],
        ];
        for (const queryeta of writes) {
            const res = await member.api.post('/api/v1/estimatedTime', { queryeta });
            expect([JSON.stringify(queryeta), res.status]).toEqual([JSON.stringify(queryeta), 400]);
        }
        expect(await rowsIn(owner, probe)).toEqual([]);
    });

    it('refuses a member\'s $unionWith on estimatedTime and keeps their read to their own plan', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const target = await projectWithTask(owner, [owner, member]);
        await planHour(owner, target);
        await planHour(member, target);

        const union = await member.api.post('/api/v1/estimatedTime', { queryeta: [{ $limit: 1 }, { $unionWith: 'timesheets' }] });
        expect(union.status).toBe(400);

        const mine = await member.api.post('/api/v1/estimatedTime', { queryeta: [{ $match: { ProjectId: target.project._id } }] });
        expect(mine.status).toBe(200);
        expect(mine.body.length).toBeGreaterThan(0);
        expect(mine.body.every((row) => row.UserId === member.uid)).toBe(true);

        const all = await owner.api.post('/api/v1/estimatedTime', { queryeta: [{ $match: { ProjectId: target.project._id } }] });
        expect(all.body.some((row) => row.UserId === owner.uid)).toBe(true);
    });

    it('gives a guest none of the company\'s time or plans', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const guest = await loginAs('guest');
        const target = await projectWithTask(owner, [owner, member]);
        await logHour(member, target);
        await planHour(member, target);

        for (const path of ['/api/v1/timesheet', '/api/v1/estimatedTime']) {
            const res = await guest.api.post(path, { queryeta: [{ $match: { ProjectId: target.project._id } }] });
            expect([path, res.status, res.body]).toEqual([path, 200, []]);
        }
    });

    it('limits logDetail, timelog and milestone to what the member may read', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const shared = await projectWithTask(owner, [owner, member]);
        const privateTarget = await projectWithTask(owner, [owner], { isPrivate: true });
        await logHour(owner, shared);
        await logHour(member, shared);
        await logHour(owner, privateTarget);
        const { start, end } = windowSeconds();

        const detail = await member.api.post('/api/v1/timesheet/logDetail', { startDate: start, endDate: end, userArray: [owner.uid], projectId: [shared.project._id, privateTarget.project._id], taskId: '' });
        expect(detail.status).toBe(200);
        expect(detail.body.length).toBeGreaterThan(0);
        expect(detail.body.every((row) => row.Loggeduser === member.uid)).toBe(true);

        const privateMilestone = { projectId: privateTarget.project._id, startDate: '2000-01-01T00:00:00.000Z', endDate: '2100-01-01T00:00:00.000Z' };
        const hidden = await member.api.post('/api/v1/timesheet/milestone', privateMilestone);
        expect([hidden.status, hidden.body]).toEqual([200, []]);
        expect((await owner.api.post('/api/v1/timesheet/milestone', privateMilestone)).body.length).toBeGreaterThan(0);

        const taskIds = [{ TicketID: shared.task._id }];
        const union = await member.api.post('/api/v1/timesheet/timelog', { taskIds, facet: { $unionWith: 'timesheets' } });
        expect(union.status).toBe(400);
        const window = { startDate: new Date(start * 1000).toISOString(), endDate: new Date(end * 1000).toISOString() };
        const logs = await member.api.post('/api/v1/timesheet/timelog', { taskIds, usersFilterIDsArray: [owner.uid], ...window });
        expect(logs.status).toBe(200);
        expect(logs.body.length).toBeGreaterThan(0);
        expect(logs.body.every((row) => row.Loggeduser === member.uid)).toBe(true);
    });

    it('never runs a body timeZone as an expression', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const target = await projectWithTask(owner, [owner, member]);
        await logHour(member, target);
        const { start, end } = windowSeconds();

        const timeZone = { $function: { body: 'function() { return "Not/AZone"; }', args: [], lang: 'js' } };
        const res = await member.api.post('/api/v1/timesheet/user', { selectedFilter: [], userArray: [], projectArray: [], start, end, timeZone });
        expect(res.status).toBe(200);
        expect(res.body.length).toBeGreaterThan(0);
    });
});
