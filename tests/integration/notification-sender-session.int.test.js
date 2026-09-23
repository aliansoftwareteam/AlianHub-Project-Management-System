const { MongoClient } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { loginAs, readState } = require('../../e2e/support/fixtures');
const { SEAT_CANCELLED, newId, tag, seedUser, ensureSettings, waitFor, settle } = require('./notificationSeed');

const state = readState();
const PROJECT = state.projects.shared;
const TASK = state.tasks[0];
const COMPANY_B = newId();

let client;
let member;
let owner;
let admin;
let insider;
let former;
let outsider;

const rows = (message) => client.db(state.companyId).collection('notifications').find({ message }).toArray();

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    member = await loginAs('member');
    owner = await loginAs('owner');
    admin = await loginAs('admin');
    await ensureSettings(client, state.companyId, owner.userId);
    insider = await seedUser(client, { name: 'Ivy Insider', seatIn: state.companyId, settingsIn: [state.companyId] });
    former = await seedUser(client, { name: 'Fay Former', seatIn: state.companyId, seatStatus: SEAT_CANCELLED, settingsIn: [state.companyId] });
    outsider = await seedUser(client, { name: 'Otto Outsider', seatIn: COMPANY_B, settingsIn: [COMPANY_B, state.companyId] });
});

afterAll(async () => {
    if (!client) return;
    const ids = [insider, former, outsider].filter(Boolean);
    await client.db(state.companyId).collection('company_users').deleteMany({ userId: { $in: ids } });
    await client.db(state.companyId).collection('notifications_settings').deleteMany({ userId: { $in: ids } });
    await client.db('global').collection('sessions').deleteMany({ userId: { $in: ids } });
    await client.db(COMPANY_B).dropDatabase();
    await client.close();
});

describe('POST /api/v2/prepare-notification-data acts for the signed-in user', () => {
    const prepare = (session, message, overrides = {}) => session.api.post('/api/v2/prepare-notification-data', {
        companyId: session.companyId,
        key: 'task_edit',
        type: 'tasks',
        projectId: PROJECT._id,
        taskId: TASK._id,
        message,
        userId: session.userId,
        assigneeUsers: [insider],
        ...overrides,
    });

    it('stores the caller as the sender when the body names someone else', async () => {
        const message = `sender ${tag()}`;
        const res = await prepare(member, message, { userId: admin.userId });
        expect(res.body).toMatchObject({ status: true });

        const stored = await waitFor(async () => (await rows(message)).find((row) => row.receiverID === insider));
        expect(stored).toBeTruthy();
        expect({ userId: stored.userId, name: stored.User_Employee_Name }).toEqual({ userId: member.userId, name: 'Max Member' });
    });

    it('notifies active members only', async () => {
        const message = `recipients ${tag()}`;
        await prepare(member, message, { assigneeUsers: [insider, former, outsider], task_leader_ID: outsider });

        await waitFor(async () => (await rows(message)).some((row) => row.receiverID === insider));
        await settle();
        const receivers = [...new Set((await rows(message)).map((row) => row.receiverID))];
        expect(receivers).toEqual([insider]);
    });

    it('refuses a body that names another company', async () => {
        const res = await prepare(member, `steer ${tag()}`, { companyId: COMPANY_B });
        expect([res.status, res.body && res.body.status]).toEqual([403, false]);
    });
});

describe('POST /api/v1/handleNotification acts for the signed-in user', () => {
    const notify = (session, message, userData) => session.api.post('/api/v1/handleNotification', {
        type: 'project',
        companyId: session.companyId,
        projectId: PROJECT._id,
        object: { key: 'project_name', message },
        userData,
    });

    it('stores the caller as the sender when userData names someone else', async () => {
        const message = `project sender ${tag()}`;
        const res = await notify(member, message, { id: admin.userId, companyOwnerId: owner.userId });
        expect(res.body).toMatchObject({ status: true });

        const stored = await waitFor(async () => (await rows(message)).find((row) => row.receiverID === owner.userId));
        expect(stored).toBeTruthy();
        expect(stored.userId).toBe(member.userId);
    });

    it('does not add a company owner who holds no seat in the company', async () => {
        const message = `project owner ${tag()}`;
        await notify(member, message, { id: member.userId, companyOwnerId: former });

        await settle(2500);
        expect((await rows(message)).filter((row) => row.receiverID === former)).toEqual([]);
    });

    it('delivers a normal notification that the recipient can read and mark read', async () => {
        const message = `normal flow ${tag()}`;
        await notify(member, message, { id: member.userId, companyOwnerId: owner.userId });
        const stored = await waitFor(async () => (await rows(message)).find((row) => row.receiverID === owner.userId && row.notificationType === 'push'));
        expect(stored).toBeTruthy();

        const feed = await owner.api.get('/api/v1/app-notification/notification', { query: { batchSize: 50 } });
        expect((feed.body.data || []).some((row) => row.message === message)).toBe(true);

        const read = await owner.api.put('/api/v1/app-notification/mark-read', { key: 'notifications', id: String(stored._id) });
        expect(read.body).toMatchObject({ status: true });
        const after = await client.db(state.companyId).collection('notifications').findOne({ _id: stored._id });
        expect(after.notSeen).not.toContain(owner.userId);
    });
});
