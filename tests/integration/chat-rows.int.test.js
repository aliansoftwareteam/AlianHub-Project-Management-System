const crypto = require('node:crypto');
const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');

// The clauses that keep chat rows out of a read are written for two stored forms of each id, and the fake database
// of the unit tests casts nothing. Here they run through Mongoose, as a find and as an aggregate, on rows stored in
// both forms in a tenant database of their own: Mongoose casts the filter of a find to the schema and leaves an
// aggregate alone, and a row a clause misses in either would be a row someone reads.

const ENV_KEYS = ['MONGODB_URL', 'JWT_SECRET', 'STORAGE_TYPE'];
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
process.env.MONGODB_URL = resolveMongoUrl();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'chat-rows-integration-secret';
process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';

const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const mongoConnections = require('../../middlewares/mongoConnector/helper');
const { runForAgentOf } = require('../../Config/agentRequest');
const { keptFromAgent, mentionsKeptFromAgent, noticesKeptFromAgent, withoutKept } = require('../../Modules/Comments/helpers/agentChatRows');
const { keptFromCaller } = require('../../Modules/Comments/helpers/conversationRows');
const { withoutConversationsOfOthers } = require('../../Modules/Comments/helpers/conversationReaders');
const { visibilityStage } = require('../../Modules/Tasks/helpers/taskQueryGuard');
const { searchComments } = require('../../Modules/Comments/controller');
const { globalSearch } = require('../../Modules/GlobalSearch/controller');

jest.setTimeout(60000);

const COMPANY = crypto.randomBytes(12).toString('hex');
const id = () => new ObjectId();
const [OWNER, ADMIN, INSIDER, OUTSIDER, GUEST] = [id(), id(), id(), id(), id()].map(String);
const [P_OPEN, SPACE, DM_SPACE] = [id(), id(), id()];
const [L_OPEN, L_SECRET, CHANNEL] = [id(), id(), id()];
const [T_OPEN, DM, CONVERSATION] = [id(), id(), id()];
const IN_IT = [ADMIN, INSIDER];
const ROLES = [[OWNER, 1], [ADMIN, 2], [INSIDER, 3], [OUTSIDER, 3], [GUEST, 0]];

const ON_A_TASK = 'on a task';
const IN_A_LIST_CHANNEL = 'in the channel of a list';
const IN_A_PRIVATE_LIST_CHANNEL = 'in the channel of a private list';
const IN_A_CHANNEL = 'in a channel';
const IN_A_DM = 'in a direct message';
const IN_A_CONVERSATION = 'in a conversation kept in a project';

/* [what the row is of, its project, its list, its task] */
const THREADS = [
    [ON_A_TASK, P_OPEN, L_OPEN, T_OPEN],
    [IN_A_LIST_CHANNEL, P_OPEN, L_OPEN, 'default'],
    [IN_A_PRIVATE_LIST_CHANNEL, P_OPEN, L_SECRET, 'default'],
    [IN_A_CHANNEL, SPACE, CHANNEL, 'default'],
    [IN_A_DM, DM_SPACE, L_OPEN, DM],
    [IN_A_CONVERSATION, P_OPEN, L_OPEN, CONVERSATION],
];
const AS_TEXT = 'its ids stored as text';
const AS_IDS = 'its ids stored as ids';
const FORMS = [[AS_TEXT, (value) => (value instanceof ObjectId ? String(value) : value)], [AS_IDS, (value) => value]];
const bothForms = (names) => names.flatMap((name) => FORMS.map(([form]) => `${name}, ${form}`)).sort();

let client;
let db;

/* comments.projectId and sprintId are ids by the schema and its taskId is whatever was written; a mention and a
 * notice hold their project and list in either form and their task as text. */
const seed = async () => {
    await db.collection('company_users').insertMany(ROLES.map(([userId, roleType]) => ({ userId, roleType, status: 2, isDelete: false })));
    const rules = await db.collection('rules').insertOne({ key: 'task', name: 'Task', isParent: true, roles: [] });
    await db.collection('rules').insertOne({ key: 'task_list', name: 'Task list', isParent: false, parentId: String(rules.insertedId), roles: [{ key: 3, permission: true }, { key: 0, permission: true }] });
    await db.collection('projects').insertOne({ _id: P_OPEN, ProjectName: 'Open', isPrivateSpace: false, isGlobalPermission: true, AssigneeUserId: [], deletedStatusKey: 0 });
    await db.collection('main_chats').insertMany([{ _id: SPACE, ProjectName: 'Team', default: false }, { _id: DM_SPACE, ProjectName: 'Direct messages', default: true }]);
    await db.collection('sprints').insertMany([
        { _id: L_OPEN, name: 'Open list', projectId: P_OPEN, deletedStatusKey: 0 },
        { _id: L_SECRET, name: 'Private list', projectId: P_OPEN, private: true, AssigneeUserId: [INSIDER], deletedStatusKey: 0 },
        { _id: CHANNEL, name: 'general', projectId: SPACE, mainChat: true, deletedStatusKey: 0 },
    ]);
    const task = (_id, TaskName, ProjectID, extra = {}) => ({ _id, TaskName, TaskKey: 'T-1', ProjectID, sprintId: L_OPEN, isParentTask: true, AssigneeUserId: [], deletedStatusKey: 0, updatedAt: new Date(), ...extra });
    await db.collection('tasks').insertMany([
        task(T_OPEN, 'plan of the work', P_OPEN),
        task(DM, 'plan of two people', DM_SPACE, { mainChat: true, AssigneeUserId: IN_IT }),
        task(CONVERSATION, 'plan of two people in a project', P_OPEN, { mainChat: true, AssigneeUserId: IN_IT }),
    ]);
    const rows = THREADS.flatMap(([name, projectId, sprintId, taskId]) => FORMS.map(([form, stored]) => ({ name: `${name}, ${form}`, projectId, sprintId, taskId, stored })));
    await db.collection('comments').insertMany(rows.map(({ name, projectId, sprintId, taskId, stored }) => ({
        message: `plan ${name}`, type: 'text', userId: INSIDER, project: false, projectId, sprintId, taskId: stored(taskId), isDeleted: false, createdAt: new Date(),
    })));
    await db.collection('mentions').insertMany(rows.map(({ name, projectId, sprintId, taskId, stored }) => ({
        comment_id: String(id()), comment_message: `plan ${name}`, type: 'task', userId: INSIDER, mentionIds: [OWNER], notSeen: [OWNER],
        projectId: stored(projectId), sprintId: stored(sprintId), taskId: String(taskId), mainChat: taskId === 'default' || !projectId.equals(P_OPEN), createdAt: new Date(),
    })));
    await db.collection('notifications').insertMany(rows.map(({ name, projectId, sprintId, taskId, stored }) => ({
        key: 'comment_reply', message: `plan ${name}`, type: 'tasks', userId: INSIDER, assigneeUsers: [OWNER], notSeen: [OWNER], receiverID: OWNER, notificationType: 'push',
        projectId: stored(projectId), sprintId: stored(sprintId), taskId: taskId === 'default' ? String(sprintId) : String(taskId),
        ...(taskId === 'default' || !projectId.equals(P_OPEN) ? { changeType: 'chat_thread_reply' } : {}), createdAt: new Date(),
    })));
};

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    db = client.db(COMPANY);
    await seed();
});

afterAll(async () => {
    if (client) {
        await db.dropDatabase().catch(() => {});
        await client.close();
    }
    [...mongoConnections.connections].forEach((connection) => mongoConnections.closeConnection(connection.db));
    ENV_KEYS.forEach((key) => { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key]; });
});

/* The rows a filter leaves, read each way the routes read them. */
const READS = [
    ['a find', (type, filter) => MongoDbCrudOpration(COMPANY, { type, data: [filter] }, 'find')],
    ['an aggregate', (type, filter) => MongoDbCrudOpration(COMPANY, { type, data: [[{ $match: filter }]] }, 'aggregate')],
];
const labels = (rows) => (rows || []).map((row) => String(row.comment_message || row.message).replace(/^plan /, '')).sort();
const asAgent = (uid, chat, run) => runForAgentOf(uid, { chat }, run);

const WORK = [ON_A_TASK];
const CHANNELS = [IN_A_LIST_CHANNEL, IN_A_PRIVATE_LIST_CHANNEL, IN_A_CHANNEL];
const DIRECT = [IN_A_DM, IN_A_CONVERSATION];

describe('the rows an agent is kept from, on a real database', () => {
    /* [the rows, their collection, the clause, the rows of the person it is read beside] */
    const KINDS = [
        ['comments', SCHEMA_TYPE.COMMENTS, keptFromAgent, {}],
        ['mentions', SCHEMA_TYPE.MENTIONS, mentionsKeptFromAgent, { mentionIds: OWNER }],
        ['notices', SCHEMA_TYPE.NOTIFICATIONS, noticesKeptFromAgent, { receiverID: OWNER }],
    ];
    const cases = KINDS.flatMap((kind) => READS.map((read) => [kind[0], read[0], kind, read[1]]));

    it.each(cases)('the %s read by %s leave an agent the rows of tasks alone, in both stored forms', async (name, how, [, type, clauseOf, own], read) => {
        const rows = await asAgent(OWNER, false, async () => read(type, withoutKept(own, await clauseOf(COMPANY, OWNER))));

        expect(labels(rows)).toEqual(bothForms(WORK));
    });

    it.each(cases)('the %s read by %s leave an agent whose token was given chat the rows of tasks and channels, and none of a direct message', async (name, how, [, type, clauseOf, own], read) => {
        const rows = await asAgent(OWNER, true, async () => read(type, withoutKept(own, await clauseOf(COMPANY, OWNER))));

        expect(labels(rows)).toEqual(bothForms([...WORK, ...CHANNELS]));
    });

    it.each(cases)('the %s read by %s leave a person every row', async (name, how, [, type, clauseOf, own], read) => {
        const rows = await read(type, withoutKept(own, await clauseOf(COMPANY, OWNER)));

        expect(labels(rows)).toEqual(bothForms([...WORK, ...CHANNELS, ...DIRECT]));
    });
});

describe('the messages a person is kept from, on a real database', () => {
    const PEOPLE = [['the owner', OWNER, false], ['an admin who is in the conversations', ADMIN, true], ['a member who is in them', INSIDER, true], ['a member', OUTSIDER, false], ['a guest', GUEST, false]];
    const cases = PEOPLE.flatMap((person) => READS.map((read) => [person[0], read[0], person[1], person[2], read[1]]));

    it.each(cases)('%s reading the comments by %s is left the messages of the conversations they are in, in both stored forms', async (who, how, uid, isIn, read) => {
        const rows = await read(SCHEMA_TYPE.COMMENTS, await keptFromCaller(COMPANY, uid));

        expect(labels(rows)).toEqual(bothForms([...WORK, ...CHANNELS, ...(isIn ? DIRECT : [])]));
    });

    it.each(cases)('%s reading the tasks by %s is left the conversations they are in', async (who, how, uid, isIn, read) => {
        const rows = await read(SCHEMA_TYPE.TASKS, withoutConversationsOfOthers(uid));

        expect((rows || []).map((row) => row.TaskName).sort()).toEqual(['plan of the work', ...(isIn ? ['plan of two people', 'plan of two people in a project'] : [])].sort());
    });

    it.each(PEOPLE)('%s reading the tasks of the projects they open is left the conversation kept there only when they are in it', async (who, uid, isIn) => {
        const rows = await MongoDbCrudOpration(COMPANY, { type: SCHEMA_TYPE.TASKS, data: [[await visibilityStage(COMPANY, uid), { $match: { ProjectID: P_OPEN } }]] }, 'aggregate');

        expect(rows.map((row) => row.TaskName).sort()).toEqual(['plan of the work', ...(isIn ? ['plan of two people in a project'] : [])].sort());
    });
});

describe('the searches, asked as the people of the company on a real database', () => {
    const answered = (handler, req) => new Promise((resolve) => {
        const res = { statusCode: 200 };
        res.status = (code) => { res.statusCode = code; return res; };
        res.send = (answer) => { resolve(answer); return res; };
        res.json = res.send;
        handler({ headers: { companyid: COMPANY }, aud: COMPANY, query: {}, params: {}, ...req }, res);
    });
    /* [who, what they are, whether they are in the conversation, whether they are on the private list or read past it] */
    const PEOPLE = [['the owner', OWNER, false, true], ['an admin who is in it', ADMIN, true, true], ['a member who is in it', INSIDER, true, true], ['a member', OUTSIDER, false, false], ['a guest', GUEST, false, false]];
    const inProject = (isIn, readsPrivateList) => bothForms([ON_A_TASK, IN_A_LIST_CHANNEL, ...(readsPrivateList ? [IN_A_PRIVATE_LIST_CHANNEL] : []), ...(isIn ? [IN_A_CONVERSATION] : [])]);

    it.each(PEOPLE)('the comment search gives %s the messages of the threads they read, in its rows and in its pages', async (who, uid, isIn, readsPrivateList) => {
        const search = async (page) => labels((await answered(searchComments, { uid, body: { searchText: 'plan', pids: [String(P_OPEN)], batchSize: 50, ...page } })).data);
        const expected = inProject(isIn, readsPrivateList);

        expect(await search({})).toEqual(expected);
        expect(await search({ batchSize: expected.length, skip: 0 })).toEqual(expected);
        expect(await search({ batchSize: 1, skip: expected.length })).toEqual([]);
    });

    it.each(PEOPLE)('the search across everything gives %s the conversation and its messages only when they are in it', async (who, uid, isIn) => {
        const { data } = await answered(globalSearch, { uid, body: { query: 'plan' } });

        expect(data.tasks.map((row) => row.TaskName).sort()).toEqual(['plan of the work', ...(isIn ? ['plan of two people in a project'] : [])].sort());
        expect(labels(data.comments)).toEqual(bothForms([ON_A_TASK, ...(isIn ? [IN_A_CONVERSATION] : [])]));
    });
});
