const crypto = require('node:crypto');
const fs = require('fs');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createProject, createTask, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const COMPANY = state.companyId;
const STORAGE_ROOT = path.resolve(__dirname, '..', '..', 'storage');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const SCREENSHOT = Buffer.from(PNG.split(',')[1], 'base64');
const PERIOD = { periodStart: '2024-03-11', periodEnd: '2024-03-17' };
const APPROVED_DAY = '2024-03-13';
const OPEN_DAY = '2024-03-05';
const OTHER_OPEN_DAY = '2024-03-06';

let client;
let owner;
let member;
let project;
let task;
let trackerWas;

const randomId = () => crypto.randomBytes(12).toString('hex');
const db = () => client.db(COMPANY);
const entryById = (id) => db().collection('timesheets').findOne({ _id: new ObjectId(String(id)) });
const memberCompanyUser = () => ({ userId: { $in: [member.uid, new ObjectId(member.uid)] } });
const trackerPath = () => `Project/${project._id}/Sprint/${randomId()}/TimeLog/${randomId()}/${Date.now()}.png`;
const storedUnder = (filePath) => fs.existsSync(path.join(STORAGE_ROOT, COMPANY, path.dirname(filePath)));

const startTimer = async (session) => {
    const res = await session.api.post('/api/v2/timeTracker/start', {
        description: `CAP ${uniqueSuffix()}`, projectId: project._id, taskId: task._id, companyId: COMPANY, userId: session.uid,
    });
    expect(res.body.status).toBe(true);
    return String(res.body.statusText);
};

/* Same fields, in the same order, as TrackerController.ScreenShotCapture in time-tracker-app. */
async function capture(session, version, timeSheetId, filePath) {
    const headers = { authorization: `Bearer ${session.accessToken}`, companyid: COMPANY };
    const fields = {
        strokes: '[]', companyId: COMPANY, timeSheetId, imageName: path.basename(filePath), prevscreenShot: String(Date.now()),
        memoName: 'qa capture', screenShotTime: String(Date.now()), key: '0', type: 'timesheets', projectId: project._id, path: filePath,
    };
    let body;
    if (version === 'v2') {
        headers['content-type'] = 'application/json';
        body = JSON.stringify({ ...fields, file: PNG });
    } else {
        body = new FormData();
        for (const [key, value] of Object.entries(fields)) body.append(key, value);
        body.append('file', new Blob([SCREENSHOT], { type: 'image/png' }), 'screenshot.png');
    }
    const res = await fetch(new URL(`/api/${version}/timetracker/capture`, state.baseURL), { method: 'POST', headers, body });
    const text = await res.text();
    let parsed = text;
    try { parsed = JSON.parse(text); } catch {}
    return { status: res.status, body: parsed };
}

const logBody = (overrides = {}) => ({
    logTimeDate: OPEN_DAY,
    description: `CAP ${uniqueSuffix()}`,
    startLogTime: '09:00',
    endLogTime: '10:00',
    timeDuration: '1:00',
    ticketId: task._id,
    projectId: project._id,
    companyId: COMPANY,
    userId: member.uid,
    isEdit: false,
    userName: 'Member',
    dateFormat: 'DD/MM/YYYY',
    taskName: 'CAP task',
    projectName: project.ProjectName,
    sprintId: task.sprintId,
    companyOwnerId: state.users.owner.userId,
    timeZone: 'UTC',
    ...overrides,
});

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    owner = await loginAs('owner');
    member = await loginAs('member');
    project = await createProject(owner.api, { name: `CAP ${uniqueSuffix()}`, assigneeIds: [owner.uid, member.uid], createdBy: owner.uid });
    task = await createTask(owner.api, { project, user: state.users.owner, companyOwnerId: owner.uid, assigneeIds: [owner.uid, member.uid] });

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

describe('tracker captures apply only to the caller\'s own session', () => {
    it.each(['v3', 'v4'])('accepts a %s capture on the member\'s own session', async (version) => {
        const timeSheetId = await startTimer(member);
        const filePath = trackerPath();
        const res = await capture(member, version, timeSheetId, filePath);

        expect(res.status).toBe(200);
        expect(res.body.status).toBe(true);
        expect((await entryById(timeSheetId)).trackShots).toHaveLength(1);
        expect(fs.readFileSync(path.join(STORAGE_ROOT, COMPANY, filePath))).toEqual(SCREENSHOT);
    });

    it.each(['v2', 'v3', 'v4'])('refuses a %s capture on the owner\'s session and writes nothing', async (version) => {
        const timeSheetId = await startTimer(owner);
        const before = await entryById(timeSheetId);
        const filePath = trackerPath();
        const res = await capture(member, version, timeSheetId, filePath);

        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ status: false, statusText: 'You can only track your own time.' });
        expect(await entryById(timeSheetId)).toEqual(before);
        expect(storedUnder(filePath)).toBe(false);
    });
});

describe('editing a manual entry into an approved period', () => {
    let entryId;

    beforeAll(async () => {
        await db().collection('timesheet_approval').deleteMany({ userId: member.uid, periodStart: { $lte: new Date(`${PERIOD.periodEnd}T23:59:59Z`) }, periodEnd: { $gte: new Date(`${PERIOD.periodStart}T00:00:00Z`) } });
        const inPeriod = await member.api.post('/api/v2/manualLogtime', logBody({ logTimeDate: '2024-03-12' }));
        expect(inPeriod.body.status).toBe(true);
        const submitted = await member.api.post('/api/v2/timesheet-approval/submit', PERIOD);
        expect(submitted.body.status).toBe(true);
        const approved = await owner.api.post(`/api/v2/timesheet-approval/${submitted.body.data._id}/review`, { action: 'approve' });
        expect(approved.body).toMatchObject({ status: true, data: { status: 'approved' } });

        const open = await member.api.post('/api/v2/manualLogtime', logBody());
        expect(open.body.status).toBe(true);
        entryId = String(open.body.data._id);
    });

    const edit = (logTimeDate) => member.api.post('/api/v2/manualLogtime', logBody({ logTimeDate, isEdit: true, timeSheetId: entryId, previousLoggedTime: '1:00' }));

    it('refuses moving an entry from an open day into the approved period', async () => {
        const before = await entryById(entryId);
        const res = await edit(APPROVED_DAY);

        expect(res.body).toMatchObject({ status: false, code: 'period_locked' });
        expect((await entryById(entryId)).LogStartTime).toBe(before.LogStartTime);
    });

    it('still moves an entry between open days', async () => {
        const res = await edit(OTHER_OPEN_DAY);

        expect(res.body.status).toBe(true);
        expect((await entryById(entryId)).LogStartTime).toBe(Date.parse(`${OTHER_OPEN_DAY}T09:00:00Z`) / 1000);
    });
});
