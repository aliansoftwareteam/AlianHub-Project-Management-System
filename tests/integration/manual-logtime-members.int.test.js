const crypto = require('node:crypto');
const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createProject, createTask, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

/* Manual log time for another person accepts only active members of the verified company, even for a caller
 * whose timesheet scope covers everyone. The outsider holds a live seat in a second company only. */

const state = readState();
const SECOND_COMPANY = crypto.randomBytes(12).toString('hex');
const OUTSIDER = new ObjectId().toHexString();
const INVITEE = new ObjectId().toHexString();
const NOBODY = new ObjectId().toHexString();

let client;
let owner;
let member;
let project;
let task;

const db = () => client.db(state.companyId);
const timeOf = (userId) => db().collection('timesheets').countDocuments({ Loggeduser: userId });

const logBody = (userId, overrides = {}) => ({
    logTimeDate: '2019-04-02',
    description: `MLM ${uniqueSuffix()}`,
    startLogTime: '09:00',
    endLogTime: '10:00',
    timeDuration: '1:00',
    ticketId: task._id,
    projectId: project._id,
    companyId: state.companyId,
    userId,
    isEdit: false,
    dateFormat: 'DD/MM/YYYY',
    taskName: 'MLM task',
    projectName: project.ProjectName,
    sprintId: task.sprintId,
    companyOwnerId: owner.uid,
    timeZone: 'UTC',
    ...overrides,
});

beforeAll(async () => {
    client = await MongoClient.connect(resolveMongoUrl());
    await client.db(SECOND_COMPANY).collection('company_users').insertOne({
        companyId: SECOND_COMPANY, userId: OUTSIDER, userEmail: 'otto@outside.test', roleType: 3, designation: 0, status: 2, isDelete: false,
    });
    await db().collection('company_users').insertOne({
        companyId: state.companyId, userId: INVITEE, userEmail: 'ivy@invited.test', roleType: 3, designation: 0, status: 1, isDelete: false,
    });
    owner = await loginAs('owner');
    member = await loginAs('member');
    project = await createProject(owner.api, { name: `MLM ${uniqueSuffix()}`, assigneeIds: [owner.uid, member.uid], createdBy: owner.uid });
    task = await createTask(owner.api, { project, user: state.users.owner, companyOwnerId: owner.uid, assigneeIds: [owner.uid, member.uid] });
});

afterAll(async () => {
    if (!client) return;
    await db().collection('company_users').deleteMany({ userId: INVITEE });
    await db().collection('timesheets').deleteMany({ Loggeduser: { $in: [OUTSIDER, INVITEE, NOBODY] } });
    await client.db(SECOND_COMPANY).dropDatabase();
    await client.close();
});

describe('manual log time for another person', () => {
    it.each([['another company\'s user', OUTSIDER], ['a pending invitee', INVITEE], ['an id nobody holds', NOBODY]])(
        'refuses an entry for %s and stores nothing',
        async (_, who) => {
            const res = await owner.api.post('/api/v2/manualLogtime', logBody(who));
            expect([res.status, res.body.status]).toEqual([400, false]);
            expect(await timeOf(who)).toBe(0);
        },
    );

    it('refuses moving an existing entry onto another company\'s user', async () => {
        const logged = await owner.api.post('/api/v2/manualLogtime', logBody(member.uid));
        expect(logged.body.status).toBe(true);
        const moved = await owner.api.post('/api/v2/manualLogtime', logBody(OUTSIDER, {
            isEdit: true, timeSheetId: logged.body.data._id, previousLoggedTime: 60,
        }));
        expect([moved.status, moved.body.status]).toEqual([400, false]);
        expect(await timeOf(OUTSIDER)).toBe(0);
    });

    it('still logs time for a member of the company', async () => {
        const res = await owner.api.post('/api/v2/manualLogtime', logBody(member.uid));
        expect(res.body.status).toBe(true);
        const stored = await db().collection('timesheets').findOne({ _id: new ObjectId(String(res.body.data._id)) });
        expect(stored.Loggeduser).toBe(member.uid);
    });

    it('still edits an entry already held by someone who has since left', async () => {
        const logged = await owner.api.post('/api/v2/manualLogtime', logBody(member.uid));
        await db().collection('timesheets').updateOne({ _id: new ObjectId(String(logged.body.data._id)) }, { $set: { Loggeduser: NOBODY } });
        const edited = await owner.api.post('/api/v2/manualLogtime', logBody(NOBODY, {
            isEdit: true, timeSheetId: logged.body.data._id, previousLoggedTime: 60, description: 'MLM kept',
        }));
        expect(edited.body.status).toBe(true);
        const stored = await db().collection('timesheets').findOne({ _id: new ObjectId(String(logged.body.data._id)) });
        expect([stored.Loggeduser, stored.LogDescription]).toEqual([NOBODY, 'MLM kept']);
    });
});
