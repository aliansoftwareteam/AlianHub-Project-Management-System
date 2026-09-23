const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createProject, createTask, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

/* Follow-up 107. Manual log time names the signed-in user in its history, and writes another
 * person's time only for a caller whose timesheet scope covers everyone. */

const state = readState();
const BODY_NAME = 'Someone Else';

let client;
let owner;
let member;
let project;
let task;

const db = () => client.db(state.companyId);
const entryById = (id) => db().collection('timesheets').findOne({ _id: new ObjectId(String(id)) });
const entriesDescribed = (description) => db().collection('timesheets').find({ LogDescription: description }).toArray();

/* The project is this suite's own, so its history rows are only ours; since narrows them to one call. */
const timeLogHistory = (since) => db().collection('history')
    .find({ ProjectId: String(project._id), Key: 'TimeLog', createdAt: { $gte: since } }).toArray();

const logBody = (session, overrides = {}) => ({
    logTimeDate: '2026-03-02',
    description: `MLO ${uniqueSuffix()}`,
    startLogTime: '09:00',
    endLogTime: '10:00',
    timeDuration: '1:00',
    ticketId: task._id,
    projectId: project._id,
    companyId: state.companyId,
    userId: session.uid,
    isEdit: false,
    userName: BODY_NAME,
    dateFormat: 'DD/MM/YYYY',
    taskName: 'MLO task',
    projectName: project.ProjectName,
    sprintId: task.sprintId,
    companyOwnerId: state.users.owner.userId,
    timeZone: 'UTC',
    ...overrides,
});

const deleteBody = (session, timeSheetId, overrides = {}) => ({ ...logBody(session), timeSheetId, timeDuration: 60, ...overrides });

const logFor = async (session, overrides) => {
    const body = logBody(session, overrides);
    const res = await session.api.post('/api/v2/manualLogtime', body);
    return { res, body };
};

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    owner = await loginAs('owner');
    member = await loginAs('member');
    project = await createProject(owner.api, { name: `MLO ${uniqueSuffix()}`, assigneeIds: [owner.uid, member.uid], createdBy: owner.uid });
    task = await createTask(owner.api, { project, user: state.users.owner, companyOwnerId: owner.uid, assigneeIds: [owner.uid, member.uid] });
});

afterAll(async () => {
    if (client) await client.close();
});

describe('manual log time records the signed-in user', () => {
    it('logs a member\'s own time and names them in the history', async () => {
        const since = new Date();
        const { res } = await logFor(member);

        expect(res.body.status).toBe(true);
        expect((await entryById(res.body.data._id)).Loggeduser).toBe(member.uid);
        const history = await timeLogHistory(since);
        expect(history.map((row) => row.UserId)).toEqual([member.uid]);
        expect(history[0].Message).not.toContain(BODY_NAME);
    });

    it('refuses a member logging the owner\'s time and writes nothing', async () => {
        const since = new Date();
        const { res, body } = await logFor(member, { userId: owner.uid });

        expect(res.status).toBe(403);
        expect(res.body.status).toBe(false);
        expect(await entriesDescribed(body.description)).toHaveLength(0);
        expect(await timeLogHistory(since)).toHaveLength(0);
    });

    it('lets the owner log a member\'s time, naming the owner in the history', async () => {
        const since = new Date();
        const { res } = await logFor(owner, { userId: member.uid });

        expect(res.body.status).toBe(true);
        expect((await entryById(res.body.data._id)).Loggeduser).toBe(member.uid);
        expect((await timeLogHistory(since)).map((row) => row.UserId)).toEqual([owner.uid]);
    });

    it('refuses a member editing or deleting the owner\'s entry', async () => {
        const { res: created } = await logFor(owner);
        const id = String(created.body.data._id);

        const edit = await member.api.post('/api/v2/manualLogtime', logBody(member, { isEdit: true, timeSheetId: id, previousLoggedTime: '1:00', description: 'MLO taken over' }));
        const del = await member.api.post('/api/v2/deleteManualLogtime', deleteBody(member, id));

        expect([edit.status, del.status]).toEqual([403, 403]);
        expect(await entryById(id)).toMatchObject({ Loggeduser: owner.uid, LogDescription: created.body.data.LogDescription });
    });

    it('lets the owner delete a member\'s entry, naming the owner in the history', async () => {
        const { res: created } = await logFor(member);
        const id = String(created.body.data._id);
        const since = new Date();

        const res = await owner.api.post('/api/v2/deleteManualLogtime', deleteBody(owner, id, { userId: member.uid }));

        expect(res.body.status).toBe(true);
        expect(await entryById(id)).toBeNull();
        expect((await timeLogHistory(since)).map((row) => row.UserId)).toEqual([owner.uid]);
    });
});
