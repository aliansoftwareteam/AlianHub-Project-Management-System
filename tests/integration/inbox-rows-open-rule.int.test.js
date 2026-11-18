const crypto = require('node:crypto');
const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');

// The clause that keeps a person's notices and mentions to the threads they can open compares ids that the rows
// store in more than one form: a notice holds its task as text and its list as an id or as text, and a list's
// channel is told of with the list in the task's place. The fake database of the unit tests compares all of them
// alike; here the clause runs through Mongoose on a real database, as a find and as an aggregate.

const ENV_KEYS = ['MONGODB_URL', 'JWT_SECRET', 'STORAGE_TYPE'];
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
process.env.MONGODB_URL = resolveMongoUrl();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'inbox-rows-integration-secret';
process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';

const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { myCache } = require('../../Config/config');
const mongoConnections = require('../../middlewares/mongoConnector/helper');
const { inboxRowsKeptFromReader, withoutKept } = require('../../Modules/Comments/helpers/readerRows');
const inbox = require('../../Modules/Inbox/controller');

jest.setTimeout(60000);

const COMPANY = crypto.randomBytes(12).toString('hex');
const id = () => new ObjectId();
const [OWNER, ON_THE_LIST, MEMBER, GUEST] = [id(), id(), id(), id()].map(String);
const P_OPEN = id();
const [L_OPEN, L_SECRET] = [id(), id()];
const [T_OPEN, T_SECRET, T_MOVED] = [id(), id(), id()];
const EVERYONE = [OWNER, ON_THE_LIST, MEMBER, GUEST];

const ON_A_TASK = 'on a task';
const ON_A_TASK_OF_A_PRIVATE_LIST = 'on a task of a private list';
const ON_A_TASK_MOVED_THERE = 'on a task moved into a private list since';
const A_REMINDER_THERE = 'a reminder of a task of a private list';
const IN_A_LIST_CHANNEL = 'in the channel of a list';
const IN_A_PRIVATE_LIST_CHANNEL = 'in the channel of a private list';
const ON_THE_PROJECT = 'on the project';

/* [what the row is of, the list written on it, the task written on it] A reminder carries no list at all. */
const NOTICES = [
    [ON_A_TASK, L_OPEN, String(T_OPEN)],
    [ON_A_TASK_OF_A_PRIVATE_LIST, L_SECRET, String(T_SECRET)],
    [ON_A_TASK_MOVED_THERE, L_OPEN, String(T_MOVED)],
    [A_REMINDER_THERE, undefined, String(T_SECRET)],
    [IN_A_LIST_CHANNEL, L_OPEN, String(L_OPEN)],
    [IN_A_PRIVATE_LIST_CHANNEL, L_SECRET, String(L_SECRET)],
    [ON_THE_PROJECT, undefined, undefined],
];
const AS_TEXT = 'its ids stored as text';
const AS_IDS = 'its ids stored as ids';
const FORMS = [[AS_TEXT, (value) => (value instanceof ObjectId ? String(value) : value)], [AS_IDS, (value) => value]];
const bothForms = (names) => names.flatMap((name) => FORMS.map(([form]) => `${name}, ${form}`)).sort();

/* What each person opens: a guest's role does not list tasks, so they read the project and its open channel. */
const OPENS = {
    [OWNER]: NOTICES.map(([name]) => name),
    [ON_THE_LIST]: NOTICES.map(([name]) => name),
    [MEMBER]: [ON_A_TASK, IN_A_LIST_CHANNEL, ON_THE_PROJECT],
    [GUEST]: [IN_A_LIST_CHANNEL, ON_THE_PROJECT],
};
const WHO = [['the owner', OWNER], ['a member on the private list', ON_THE_LIST], ['a member', MEMBER], ['a guest whose role does not list tasks', GUEST]];

let client;
let db;

const seed = async () => {
    await db.collection('company_users').insertMany([[OWNER, 1], [ON_THE_LIST, 3], [MEMBER, 3], [GUEST, 0]].map(([userId, roleType]) => ({ userId, roleType, status: 2, isDelete: false })));
    const rules = await db.collection('rules').insertOne({ key: 'task', name: 'Task', isParent: true, roles: [] });
    await db.collection('rules').insertOne({ key: 'task_list', name: 'Task list', isParent: false, parentId: String(rules.insertedId), roles: [{ key: 3, permission: true }] });
    await db.collection('projects').insertOne({ _id: P_OPEN, ProjectName: 'Open', isPrivateSpace: false, isGlobalPermission: true, AssigneeUserId: [], deletedStatusKey: 0 });
    await db.collection('sprints').insertMany([
        { _id: L_OPEN, name: 'Open list', projectId: P_OPEN, deletedStatusKey: 0 },
        { _id: L_SECRET, name: 'Private list', projectId: P_OPEN, private: true, AssigneeUserId: [ON_THE_LIST], deletedStatusKey: 0 },
    ]);
    const task = (_id, TaskName, sprintId) => ({ _id, TaskName, TaskKey: 'T-1', ProjectID: P_OPEN, sprintId, isParentTask: true, AssigneeUserId: [], deletedStatusKey: 0 });
    await db.collection('tasks').insertMany([task(T_OPEN, 'Open task', L_OPEN), task(T_SECRET, 'Secret task', L_SECRET), task(T_MOVED, 'Moved task', L_SECRET)]);

    const rows = NOTICES.flatMap(([name, sprintId, taskId]) => FORMS.map(([form, stored]) => ({ name: `${name}, ${form}`, sprintId, taskId, stored })));
    await db.collection('notifications').insertMany(EVERYONE.flatMap((uid) => rows.map(({ name, sprintId, taskId, stored }, at) => ({
        key: 'task_edit', type: 'tasks', message: name, userId: OWNER, receiverID: uid, assigneeUsers: [uid], notSeen: [uid], notificationType: 'push', companyId: COMPANY,
        projectId: stored(P_OPEN), ...(sprintId ? { sprintId: stored(sprintId) } : {}), ...(taskId ? { taskId } : {}), createdAt: new Date(Date.UTC(2026, 8, 20, 10, at)),
    }))));
    await db.collection('mentions').insertMany(rows.filter(({ taskId }) => taskId).map(({ name, sprintId, taskId, stored }, at) => ({
        comment_id: String(id()), comment_message: name, type: 'task', userId: OWNER, mentionIds: EVERYONE, notSeen: EVERYONE, mainChat: false,
        projectId: stored(P_OPEN), ...(sprintId ? { sprintId: stored(sprintId) } : {}), taskId: taskId === String(sprintId) ? 'default' : taskId, createdAt: new Date(Date.UTC(2026, 8, 20, 11, at)),
    })));
};

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    db = client.db(COMPANY);
    await seed();
});

beforeEach(() => myCache.flushAll());

afterAll(async () => {
    if (client) {
        await db.dropDatabase().catch(() => {});
        await client.close();
    }
    [...mongoConnections.connections].forEach((connection) => mongoConnections.closeConnection(connection.db));
    ENV_KEYS.forEach((key) => { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key]; });
});

const READS = [
    ['a find', (type, filter) => MongoDbCrudOpration(COMPANY, { type, data: [filter] }, 'find')],
    ['an aggregate', (type, filter) => MongoDbCrudOpration(COMPANY, { type, data: [[{ $match: filter }]] }, 'aggregate')],
];
const labels = (rows) => (rows || []).map((row) => String(row.comment_message || row.message)).sort();
const mentioned = (names) => names.filter((name) => name !== ON_THE_PROJECT);

describe('the notices and mentions a person reads, on a real database', () => {
    const cases = WHO.flatMap(([who, uid]) => READS.map(([how, read]) => [who, how, uid, read]));

    it.each(cases)('%s reads, by %s, the rows of the threads they can open today, in both stored forms', async (who, how, uid, read) => {
        const kept = await inboxRowsKeptFromReader(COMPANY, uid);

        expect(labels(await read(SCHEMA_TYPE.NOTIFICATIONS, withoutKept({ receiverID: uid }, kept.notification)))).toEqual(bothForms(OPENS[uid]));
        expect(labels(await read(SCHEMA_TYPE.MENTIONS, withoutKept({ mentionIds: uid }, kept.mention)))).toEqual(bothForms(mentioned(OPENS[uid])));
    });

    it.each(WHO)('the inbox of %s lists those rows and no other, and names the tasks among them', async (who, uid) => {
        const res = { body: null };
        res.send = (answer) => { res.body = answer; return res; };
        await inbox.list({ uid, headers: { companyid: COMPANY }, query: { tab: 'all', limit: '50' }, body: {}, params: {} }, res);
        const items = res.body.data.items;
        const tasksNamed = [...new Set(items.filter((item) => item.taskName).map((item) => item.taskName))].sort();

        expect(items.filter((item) => item.sourceType === 'notification').map((item) => item.message).sort()).toEqual(bothForms(OPENS[uid]));
        expect(items.filter((item) => item.sourceType === 'mention').map((item) => item.message).sort()).toEqual(bothForms(mentioned(OPENS[uid])));
        expect(tasksNamed).toEqual(OPENS[uid].includes(ON_A_TASK_OF_A_PRIVATE_LIST) ? ['Moved task', 'Open task', 'Secret task'] : OPENS[uid].includes(ON_A_TASK) ? ['Open task'] : []);
    });

    it('the tasks a person\'s rows name are read through the two indexes the migration builds, however often it runs', async () => {
        // eslint-disable-next-line global-require
        const migration = require('../../migrations/072-reader-row-indexes');
        const ctx = { SCHEMA_TYPE, company: MongoDbCrudOpration };
        const keysOf = async (name) => (await db.collection(name).indexes()).map((index) => JSON.stringify(index.key));
        const planOf = async (name, query) => JSON.stringify((await db.command({ explain: { distinct: name, key: 'taskId', query }, verbosity: 'queryPlanner' })).queryPlanner.winningPlan);

        await migration.indexCompany(ctx, COMPANY);
        const built = { notifications: await keysOf('notifications'), mentions: await keysOf('mentions') };
        await migration.indexCompany(ctx, COMPANY);

        expect(built.notifications).toContain(JSON.stringify(migration.NOTICES_BY_READER));
        expect(built.mentions).toContain(JSON.stringify(migration.MENTIONS_BY_READER));
        expect({ notifications: await keysOf('notifications'), mentions: await keysOf('mentions') }).toEqual(built);
        expect(await planOf('notifications', { receiverID: MEMBER })).not.toContain('COLLSCAN');
        expect(await planOf('mentions', { mentionIds: MEMBER })).not.toContain('COLLSCAN');
    });
});
