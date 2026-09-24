const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createProject, createTask, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const DEADLINE_MS = 10000;
const THIRTY_DAYS = 30 * 24 * 60 * 60;

jest.setTimeout(60000);

let client;
let owner;
let admin;
let member;
let thread;

const db = () => client.db(state.companyId);
const notifications = () => db().collection('notifications');
const mentions = () => db().collection('mentions');

const seedNotice = async (session, extra = {}) => {
    const row = {
        key: 'task_status',
        message: `<p>status changed ${uniqueSuffix()}</p>`,
        projectId: thread.projectId,
        sprintId: thread.sprintId,
        taskId: thread.taskId,
        type: 'tasks',
        userId: owner.uid,
        assigneeUsers: [session.uid],
        notSeen: [session.uid],
        receiverID: session.uid,
        notificationType: 'push',
        companyId: state.companyId,
        uniqueId: uniqueSuffix(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...extra,
    };
    const { insertedId } = await notifications().insertOne(row);
    return { sourceType: 'notification', sourceId: String(insertedId) };
};

const seedMention = async (readers) => {
    const { insertedId } = await mentions().insertOne({
        comment_id: uniqueSuffix(),
        comment_message: `hello ${uniqueSuffix()}`,
        comment_type: 'text',
        mentionIds: readers.map((s) => s.uid),
        notSeen: readers.map((s) => s.uid),
        projectId: thread.projectId,
        sprintId: thread.sprintId,
        taskId: thread.taskId,
        type: 'task',
        userId: owner.uid,
        createdAt: new Date(),
        updatedAt: new Date(),
    });
    return { sourceType: 'mention', sourceId: String(insertedId) };
};

const post = async (session, path, body) => {
    const res = await session.api.post(`/api/v1/inbox${path}`, body);
    expect(res.status).toBe(200);
    return res.body;
};
const tabIds = async (session, tab) => {
    const res = await session.api.get('/api/v1/inbox', { query: { tab, limit: '50' } });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe(true);
    return res.body.data.items;
};
const idsIn = async (session, tab) => (await tabIds(session, tab)).map((i) => i.sourceId);
const unreadIn = async (session, tab, id) => (await tabIds(session, tab)).find((i) => i.sourceId === id);

const waitFor = async (read, what) => {
    const deadline = Date.now() + DEADLINE_MS;
    for (;;) {
        const found = await read();
        if (found) return found;
        if (Date.now() > deadline) throw new Error(`${what} did not happen within ${DEADLINE_MS}ms`);
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
};

beforeAll(async () => {
    client = await MongoClient.connect(resolveMongoUrl());
    [owner, admin, member] = await Promise.all(['owner', 'admin', 'member'].map((role) => loginAs(role)));
    const project = await createProject(owner.api, { name: `Inbox snooze ${uniqueSuffix()}`, assigneeIds: [owner.uid, admin.uid, member.uid], createdBy: owner.uid });
    const task = await createTask(owner.api, { project, user: state.users.owner, companyOwnerId: owner.uid });
    thread = { projectId: String(project._id), sprintId: String(task.sprintId), taskId: String(task._id) };
});

afterAll(async () => {
    if (client) await client.close();
});

describe('snooze', () => {
    it('moves the caller\'s row from Primary to Later with its return time', async () => {
        const item = await seedNotice(member);
        expect(await idsIn(member, 'primary')).toContain(item.sourceId);
        const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        const body = await post(member, '/snooze', { items: [item], until });
        expect(body).toEqual(expect.objectContaining({ status: true, data: { count: 1 } }));
        expect(await idsIn(member, 'primary')).not.toContain(item.sourceId);
        const later = (await tabIds(member, 'later')).find((i) => i.sourceId === item.sourceId);
        expect(later).toEqual(expect.objectContaining({ snoozedUntil: until, snoozeUntilChange: false }));
    });

    it('cannot touch someone else\'s row', async () => {
        const item = await seedNotice(member);
        const body = await post(admin, '/snooze', { items: [item], until: new Date(Date.now() + 60000).toISOString() });
        expect(body.data.count).toBe(0);
        const row = await notifications().findOne({ _id: new ObjectId(item.sourceId) });
        expect(row.snoozedUntil).toBeUndefined();
        expect(await idsIn(member, 'primary')).toContain(item.sourceId);
    });

    it('returns a row to Primary as unread when its time passes', async () => {
        const item = await seedNotice(member);
        await post(member, '/snooze', { items: [item], until: new Date(Date.now() + 1500).toISOString() });
        expect(await idsIn(member, 'later')).toContain(item.sourceId);
        const back = await waitFor(() => unreadIn(member, 'primary', item.sourceId), 'the snoozed row coming back');
        expect(back.unread).toBe(true);
        expect(await idsIn(member, 'later')).not.toContain(item.sourceId);
    });

    it('"until it changes" returns the row when the item gets new activity', async () => {
        const item = await seedNotice(admin);
        await post(admin, '/snooze', { items: [item], untilChange: true });
        expect(await idsIn(admin, 'later')).toContain(item.sourceId);
        const res = await owner.api.post('/api/v1/comments', { data: {
            objId: thread, project: false, type: 'text', userId: owner.uid, mentionIds: [],
            message: `@[Ada Admin](${admin.uid}) a new update`,
        } });
        expect(res.body.status).toBe(true);
        const back = await waitFor(() => unreadIn(admin, 'primary', item.sourceId), 'the row waking on new activity');
        expect(back.unread).toBe(true);
    });

    it('snoozes a mention for one reader only', async () => {
        const item = await seedMention([admin, member]);
        await post(admin, '/snooze', { items: [item], until: new Date(Date.now() + 60000).toISOString() });
        expect(await idsIn(admin, 'later')).toContain(item.sourceId);
        expect(await idsIn(admin, 'primary')).not.toContain(item.sourceId);
        expect(await idsIn(member, 'primary')).toContain(item.sourceId);
    });
});

describe('clear and restore', () => {
    it('moves a row to Cleared and restores it to Primary as unread', async () => {
        const item = await seedNotice(member);
        expect((await post(member, '/clear', { items: [item] })).data.count).toBe(1);
        expect(await idsIn(member, 'primary')).not.toContain(item.sourceId);
        const cleared = (await tabIds(member, 'cleared')).find((i) => i.sourceId === item.sourceId);
        expect(cleared && cleared.clearedAt).toBeTruthy();

        expect((await post(member, '/restore', { items: [item] })).data.count).toBe(1);
        expect(await idsIn(member, 'cleared')).not.toContain(item.sourceId);
        expect((await unreadIn(member, 'primary', item.sourceId)).unread).toBe(true);
    });

    it('cannot clear or restore someone else\'s row', async () => {
        const item = await seedNotice(member);
        expect((await post(admin, '/clear', { items: [item] })).data.count).toBe(0);
        await post(member, '/clear', { items: [item] });
        expect((await post(admin, '/restore', { items: [item] })).data.count).toBe(0);
        expect(await idsIn(member, 'cleared')).toContain(item.sourceId);
    });

    it('clears a shared mention for one reader and leaves it with the other', async () => {
        const item = await seedMention([admin, member]);
        await post(admin, '/clear', { items: [item] });
        expect(await idsIn(admin, 'cleared')).toContain(item.sourceId);
        expect(await idsIn(member, 'primary')).toContain(item.sourceId);
        const row = await mentions().findOne({ _id: new ObjectId(item.sourceId) });
        expect(row.purgeAt).toBeUndefined();
    });

    it('sets a purge time once the last reader clears a mention', async () => {
        const item = await seedMention([member]);
        await post(member, '/clear', { items: [item] });
        const row = await mentions().findOne({ _id: new ObjectId(item.sourceId) });
        expect(row.purgeAt).toBeInstanceOf(Date);
        expect(row.purgeAt.getTime()).toBeGreaterThan(Date.now() + (THIRTY_DAYS - 60) * 1000);
    });

    it('clear all empties only the caller\'s current tab', async () => {
        const mine = await seedNotice(member);
        const watching = await seedNotice(member, { reason: 'watching' });
        const theirs = await seedNotice(admin);
        const body = await post(member, '/clear-all', { tab: 'primary' });
        expect(body.status).toBe(true);
        expect(await idsIn(member, 'primary')).not.toContain(mine.sourceId);
        expect(await idsIn(member, 'cleared')).toContain(mine.sourceId);
        expect(await idsIn(member, 'other')).toContain(watching.sourceId);
        expect(await idsIn(admin, 'primary')).toContain(theirs.sourceId);
    });

    it('keeps cleared notifications for 30 days through a TTL index on clearedAt', async () => {
        const index = await waitFor(async () => (await notifications().indexes()).find((i) => i.key && i.key.clearedAt === 1), 'the clearedAt TTL index');
        expect(index.expireAfterSeconds).toBe(THIRTY_DAYS);
        const purge = await waitFor(async () => (await mentions().indexes()).find((i) => i.key && i.key.purgeAt === 1), 'the mention purge index');
        expect(purge.expireAfterSeconds).toBe(0);
    });
});

describe('Other', () => {
    it('holds updates the reader only watches, and counts them apart from Primary', async () => {
        const watching = await seedNotice(admin, { reason: 'watching' });
        const direct = await seedNotice(admin, { reason: 'direct' });
        expect(await idsIn(admin, 'other')).toContain(watching.sourceId);
        expect(await idsIn(admin, 'other')).not.toContain(direct.sourceId);
        expect(await idsIn(admin, 'primary')).toContain(direct.sourceId);
        expect(await idsIn(admin, 'primary')).not.toContain(watching.sourceId);
        const counts = (await admin.api.get('/api/v1/inbox/counts')).body.data;
        expect(counts.other).toBeGreaterThanOrEqual(1);
    });
});
