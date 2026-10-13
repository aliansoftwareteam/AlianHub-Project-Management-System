const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const [TASK] = state.tasks;
const PROJECT = state.projects.shared;

let client;
let owner;
let member;

const timesheets = () => client.db(state.companyId).collection('timesheets');

const startBody = (session, overrides = {}) => ({
    description: `Tracker user ${uniqueSuffix()}`,
    projectId: PROJECT._id,
    taskId: TASK._id,
    companyId: session.companyId,
    userId: session.uid,
    ...overrides,
});

const endBody = (session, timeSheetId, overrides = {}) => ({
    companyId: session.companyId,
    timeSheetId,
    userName: 'Someone Else',
    userId: session.uid,
    sprintId: TASK.sprintId,
    projectId: PROJECT._id,
    taskId: TASK._id,
    taskName: 'E2E Task One',
    projectName: PROJECT.name,
    companyOwnerId: state.users.owner.userId,
    dateFormat: 'DD-MM-yyyy',
    timeZone: 'UTC',
    strokes: [],
    ...overrides,
});

const start = async (session, overrides) => {
    const body = startBody(session, overrides);
    const res = await session.api.post('/api/v2/timeTracker/start', body);
    return { res, body };
};

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    owner = await loginAs('owner');
    member = await loginAs('member');
});

afterAll(async () => {
    if (client) await client.close();
});

describe('the desktop tracker routes act for the signed-in user', () => {
    it('starts, ends and lists the session\'s own timer', async () => {
        const { res, body } = await start(member);
        expect(res.body).toMatchObject({ status: true });
        const timeSheetId = String(res.body.statusText);
        expect(await timesheets().findOne({ _id: new ObjectId(timeSheetId) })).toMatchObject({ Loggeduser: member.uid, LogDescription: body.description });

        const ended = await member.api.post('/api/v2/timetracker/end', endBody(member, timeSheetId));
        expect(ended.body).toMatchObject({ status: true });

        const listed = await member.api.post('/api/v2/timetracker/timelog', { companyId: member.companyId, userId: member.uid });
        expect(listed.body.status).toBe(true);
        expect(listed.body.data.map((entry) => String(entry._id))).toContain(timeSheetId);
    });

    it('refuses a start that names another user and writes nothing', async () => {
        const { res, body } = await start(member, { userId: owner.uid });

        expect(res.status).toBe(403);
        expect(await timesheets().countDocuments({ LogDescription: body.description })).toBe(0);
    });

    it('refuses to end a timer the caller does not own and leaves it running', async () => {
        const { res } = await start(owner);
        const timeSheetId = String(res.body.statusText);

        const ended = await member.api.post('/api/v2/timetracker/end', endBody(member, timeSheetId));

        expect(ended.status).toBe(403);
        expect(await timesheets().findOne({ _id: new ObjectId(timeSheetId) })).toHaveProperty('startTimeTracker');
    });

    it('refuses a time log listing for another user', async () => {
        const res = await member.api.post('/api/v2/timetracker/timelog', { companyId: member.companyId, userId: owner.uid });

        expect(res.status).toBe(403);
        expect(res.body.status).toBe(false);
    });
});
