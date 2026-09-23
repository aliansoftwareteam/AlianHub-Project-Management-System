const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createProject, createTask, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

/* Follow-up 109, owner decision: a new time entry in an approved timesheet period is refused,
 * like edits and deletes. The period is this suite's own week, approved through the real flow. */

const state = readState();
const PERIOD = { periodStart: '2024-02-12', periodEnd: '2024-02-18' };
const LOCKED_DAY = '2024-02-14';
const OPEN_DAY = '2024-02-21';
const at = (day, hhmm = '09:00') => Date.parse(`${day}T${hhmm}:00Z`) / 1000;

let client;
let owner;
let member;
let project;
let task;
let earlyEntryId;
let trackerWas;

const db = () => client.db(state.companyId);
const entryById = (id) => db().collection('timesheets').findOne({ _id: new ObjectId(String(id)) });
const entriesDescribed = (description) => db().collection('timesheets').find({ LogDescription: description }).toArray();
const memberCompanyUser = () => ({ userId: { $in: [member.uid, new ObjectId(member.uid)] } });

const logBody = (overrides = {}) => ({
    logTimeDate: LOCKED_DAY,
    description: `APL ${uniqueSuffix()}`,
    startLogTime: '09:00',
    endLogTime: '10:00',
    timeDuration: '1:00',
    ticketId: task._id,
    projectId: project._id,
    companyId: state.companyId,
    userId: member.uid,
    isEdit: false,
    userName: 'Member',
    dateFormat: 'DD/MM/YYYY',
    taskName: 'APL task',
    projectName: project.ProjectName,
    sprintId: task.sprintId,
    companyOwnerId: state.users.owner.userId,
    timeZone: 'UTC',
    ...overrides,
});

const endBody = (timeSheetId) => ({
    companyId: state.companyId, timeSheetId, sprintId: task.sprintId, projectId: project._id, taskId: task._id,
    taskName: 'APL task', projectName: project.ProjectName, companyOwnerId: state.users.owner.userId,
    dateFormat: 'DD/MM/YYYY', timeZone: 'UTC', strokes: [],
});

const expectLocked = (res) => {
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: false, code: 'period_locked' });
};

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    owner = await loginAs('owner');
    member = await loginAs('member');
    project = await createProject(owner.api, { name: `APL ${uniqueSuffix()}`, assigneeIds: [owner.uid, member.uid], createdBy: owner.uid });
    task = await createTask(owner.api, { project, user: state.users.owner, companyOwnerId: owner.uid, assigneeIds: [owner.uid, member.uid] });

    await db().collection('timesheet_approval').deleteMany({ userId: member.uid, periodStart: { $lte: new Date(`${PERIOD.periodEnd}T23:59:59Z`) }, periodEnd: { $gte: new Date(`${PERIOD.periodStart}T00:00:00Z`) } });
    const early = await member.api.post('/api/v2/manualLogtime', logBody({ logTimeDate: '2024-02-13' }));
    expect(early.body.status).toBe(true);
    earlyEntryId = String(early.body.data._id);

    const submitted = await member.api.post('/api/v2/timesheet-approval/submit', PERIOD);
    expect(submitted.body.status).toBe(true);
    const approved = await owner.api.post(`/api/v2/timesheet-approval/${submitted.body.data._id}/review`, { action: 'approve' });
    expect(approved.body).toMatchObject({ status: true, data: { status: 'approved' } });

    const cu = await db().collection('company_users').findOne(memberCompanyUser());
    trackerWas = cu ? cu.isTrackerUser : undefined;
    await db().collection('company_users').updateOne(memberCompanyUser(), { $set: { isTrackerUser: 1 } });
});

afterAll(async () => {
    if (client) {
        await db().collection('company_users').updateOne(memberCompanyUser(), trackerWas === undefined ? { $unset: { isTrackerUser: 1 } } : { $set: { isTrackerUser: trackerWas } });
        await client.close();
    }
});

describe('manual time in an approved period', () => {
    it('refuses a new entry on a day in the approved period and writes nothing', async () => {
        const body = logBody();
        const res = await member.api.post('/api/v2/manualLogtime', body);

        expectLocked(res);
        expect(res.body.statusText).toMatch(/approved and locked/);
        expect(await entriesDescribed(body.description)).toHaveLength(0);
    });

    it('refuses the owner adding a new entry to the member\'s approved period', async () => {
        const body = logBody();
        const res = await owner.api.post('/api/v2/manualLogtime', body);

        expectLocked(res);
        expect(await entriesDescribed(body.description)).toHaveLength(0);
    });

    it('logs a new entry on a day outside the approved period', async () => {
        const body = logBody({ logTimeDate: OPEN_DAY });
        const res = await member.api.post('/api/v2/manualLogtime', body);

        expect(res.body.status).toBe(true);
        expect(await entriesDescribed(body.description)).toHaveLength(1);
    });

    it('still refuses to edit or delete an entry logged before the period was approved', async () => {
        const before = await entryById(earlyEntryId);
        const edit = await member.api.post('/api/v2/manualLogtime', logBody({ isEdit: true, timeSheetId: earlyEntryId, previousLoggedTime: '1:00', logTimeDate: '2024-02-13', description: 'APL changed' }));
        const del = await member.api.post('/api/v2/deleteManualLogtime', { ...logBody({ logTimeDate: '2024-02-13' }), timeSheetId: earlyEntryId, timeDuration: 60 });

        expect(edit.body).toMatchObject({ status: false, statusText: expect.stringMatching(/can't be edited/) });
        expect(del.body).toMatchObject({ status: false, statusText: expect.stringMatching(/can't be deleted/) });
        expect(await entryById(earlyEntryId)).toMatchObject({ LogDescription: before.LogDescription, LogTimeDuration: before.LogTimeDuration });
    });
});

describe('the desktop tracker in an approved period', () => {
    it('refuses a timer back-dated into the approved period and writes nothing', async () => {
        const description = `APL tracker ${uniqueSuffix()}`;
        const res = await member.api.post('/api/v3/timeTracker/start', {
            description, projectId: project._id, taskId: task._id, considerActionTime: true, actionTime: at(LOCKED_DAY),
        });

        expectLocked(res);
        expect(await entriesDescribed(description)).toHaveLength(0);
    });

    it('starts a timer back-dated to an open day', async () => {
        const description = `APL tracker ${uniqueSuffix()}`;
        const res = await member.api.post('/api/v3/timeTracker/start', {
            description, projectId: project._id, taskId: task._id, considerActionTime: true, actionTime: at(OPEN_DAY),
        });

        expect(res.body.status).toBe(true);
        expect(await entriesDescribed(description)).toHaveLength(1);
    });

    it('refuses to stop a timer that started in the approved period, leaving it as it was', async () => {
        const start = at(LOCKED_DAY, '08:00');
        const { insertedId } = await db().collection('timesheets').insertOne({
            Loggeduser: member.uid, TicketID: String(task._id), ProjectId: String(project._id), LogDescription: `APL running ${uniqueSuffix()}`,
            LogStartTime: start, LogEndTime: start, LogTimeDuration: 0, logAddType: 1, trackShots: [], startTimeTracker: start,
        });

        const res = await member.api.post('/api/v2/timetracker/end', endBody(String(insertedId)));

        expectLocked(res);
        expect(await entryById(insertedId)).toMatchObject({ LogEndTime: start, LogTimeDuration: 0, startTimeTracker: start });
    });
});
