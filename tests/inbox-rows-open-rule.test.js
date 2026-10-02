jest.setTimeout(30000);
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/notification-count/controller', () => ({ updateUnReadCommentsCountFun: jest.fn(async () => ({ status: true })) }));
jest.mock('../Modules/Inbox/helpers/approvalQueue', () => ({ readQueue: jest.fn(async () => []), readApplied: jest.fn(async () => []), waitingCount: () => 0 }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/accessWorld');
const { commentThreadAccess } = require('../Modules/Comments/helpers/threadAccess');
const inbox = require('../Modules/Inbox/controller');
const bell = require('../Modules/notification/app-notification/controller');

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, P_PERSONAL, L_OPEN, L_SECRET, L_PRIVATE, L_PERSONAL, T_OPEN, T_SECRET, T_PRIVATE, T_PERSONAL, settle } = world;
const { seed, rows, setRule } = world.create(mockDb);

const DM_SPACE = '6f0000000000000000000ca2';
const DM = '6f0000000000000000000cd1';
const CONVERSATION = '6f0000000000000000000cd2';
const IN_IT = [ADMIN, INSIDER];
const EVERYONE = [['the owner', OWNER], ['an admin', ADMIN], ['a member on everything private', INSIDER], ['a member', OUTSIDER], ['a guest', GUEST]];

const THREADS = {
    'a task': { projectId: P_OPEN, sprintId: L_OPEN, taskId: T_OPEN },
    'a task of a private list': { projectId: P_OPEN, sprintId: L_SECRET, taskId: T_SECRET },
    'a task of a private project': { projectId: P_PRIVATE, sprintId: L_PRIVATE, taskId: T_PRIVATE },
    'a task of a personal list': { projectId: P_PERSONAL, sprintId: L_PERSONAL, taskId: T_PERSONAL },
    'the channel of a list': { projectId: P_OPEN, sprintId: L_OPEN, taskId: 'default' },
    'the channel of a private list': { projectId: P_OPEN, sprintId: L_SECRET, taskId: 'default' },
    'a direct message': { projectId: DM_SPACE, sprintId: L_OPEN, taskId: DM },
    'a conversation kept in a project': { projectId: P_OPEN, sprintId: L_OPEN, taskId: CONVERSATION },
};
/* A notice of a list's channel names the list where a task's notice names the task. */
const asNoticed = (thread) => (thread.taskId === 'default' ? { ...thread, taskId: thread.sprintId } : thread);

const conversation = (extra) => ({ TaskName: 'Adam and Ian', TaskKey: '--', CompanyId: CID, mainChat: true, isParentTask: true, AssigneeUserId: [...IN_IT], watchers: IN_IT, deletedStatusKey: 0, ...extra });

const seedRows = () => {
    seed();
    mockDb.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: DM_SPACE, ProjectName: 'Direct messages', default: true });
    mockDb.seed(SCHEMA_TYPE.TASKS, conversation({ _id: DM, ProjectID: DM_SPACE, sprintId: L_OPEN }));
    mockDb.seed(SCHEMA_TYPE.TASKS, conversation({ _id: CONVERSATION, ProjectID: P_OPEN, sprintId: L_OPEN }));
    Object.entries(THREADS).forEach(([name, thread], at) => {
        const createdAt = new Date(Date.UTC(2026, 8, 20, 10, at));
        EVERYONE.forEach(([, uid]) => mockDb.seed(SCHEMA_TYPE.NOTIFICATIONS, {
            ...asNoticed(thread), key: 'task_edit', type: 'tasks', message: `notice of ${name}`, userId: OWNER, receiverID: uid, assigneeUsers: [uid], notSeen: [uid],
            notificationType: 'push', companyId: CID, createdAt,
        }));
        mockDb.seed(SCHEMA_TYPE.MENTIONS, {
            ...thread, comment_message: `mention in ${name}`, comment_id: `c-${at}`, userId: OWNER, type: 'task', mainChat: false,
            mentionIds: EVERYONE.map(([, uid]) => uid), notSeen: EVERYONE.map(([, uid]) => uid), createdAt,
        });
    });
    EVERYONE.forEach(([, uid]) => mockDb.seed(SCHEMA_TYPE.NOTIFICATIONS, {
        key: 'doc_mention', type: 'docs', message: 'notice of a page', userId: OWNER, receiverID: uid, assigneeUsers: [uid], notSeen: [uid], notificationType: 'push', companyId: CID,
        createdAt: new Date(Date.UTC(2026, 8, 20, 9)),
    }));
};

const answered = (handler, req) => new Promise((resolve) => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (answer) => { resolve(answer); return res; };
    res.send = res.json;
    handler({ headers: { companyid: CID }, query: {}, params: {}, body: {}, ...req }, res);
}).then(async (answer) => { await settle(); return answer; });

const opened = async (uid) => {
    const names = [];
    for (const [name, thread] of Object.entries(THREADS)) {
        if ((await commentThreadAccess(CID, uid, thread)).allowed) names.push(name);
    }
    return names;
};
const noticesOf = (names) => [...names.map((name) => `notice of ${name}`), 'notice of a page'].sort();
const mentionsOf = (names) => names.map((name) => `mention in ${name}`).sort();

const inInbox = async (uid) => {
    const { data } = await answered(inbox.list, { uid, query: { tab: 'all', limit: '50' } });
    const of = (sourceType) => data.items.filter((item) => item.sourceType === sourceType);
    return { notices: of('notification').map((item) => item.message).sort(), mentions: of('mention').map((item) => item.message).sort(), named: data.items.filter((item) => item.taskName).map((item) => item.message).sort(), hasMore: data.hasMore };
};
const inBell = async (uid) => ({
    notices: (await answered(bell.getNotificationMessages, { uid, query: { batchSize: '50' } })).data.map((row) => row.message).sort(),
    mentions: (await answered(bell.getMentionsMessages, { uid, query: {} })).data.map((row) => row.comment_message).sort(),
});

beforeEach(() => { jest.clearAllMocks(); seedRows(); });

describe('the notices and mentions a person reads', () => {
    it.each(EVERYONE)('are, for %s, those of the threads they can open', async (who, uid) => {
        const names = await opened(uid);
        const read = await inInbox(uid);

        expect(read.notices).toEqual(noticesOf(names));
        expect(read.mentions).toEqual(mentionsOf(names));
        expect(read.hasMore).toBe(false);
        expect(await inBell(uid)).toEqual({ notices: noticesOf(names), mentions: mentionsOf(names) });
    });

    it.each(EVERYONE)('name a task for %s only where they can open it', async (who, uid) => {
        const names = (await opened(uid)).filter((name) => /^[a-f0-9]{24}$/.test(THREADS[name].taskId));
        expect((await inInbox(uid)).named).toEqual([...noticesOf(names).filter((message) => message !== 'notice of a page'), ...mentionsOf(names)].sort());
    });

    it('stay stored, and are read again by the rule of that day, when a person leaves a conversation and a private list', async () => {
        const before = await inInbox(INSIDER);
        const stored = { notices: rows(SCHEMA_TYPE.NOTIFICATIONS).length, mentions: rows(SCHEMA_TYPE.MENTIONS).length };
        rows(SCHEMA_TYPE.TASKS).filter((task) => task.mainChat).forEach((task) => { task.AssigneeUserId = [ADMIN, OWNER]; });
        rows(SCHEMA_TYPE.SPRINTS).find((list) => String(list._id) === L_SECRET).AssigneeUserId = [];

        const names = await opened(INSIDER);
        expect(names).toEqual(['a task', 'a task of a private project', 'a task of a personal list', 'the channel of a list']);
        expect(await inInbox(INSIDER)).toMatchObject({ notices: noticesOf(names), mentions: mentionsOf(names) });
        expect(await inBell(INSIDER)).toEqual({ notices: noticesOf(names), mentions: mentionsOf(names) });
        expect({ notices: rows(SCHEMA_TYPE.NOTIFICATIONS).length, mentions: rows(SCHEMA_TYPE.MENTIONS).length }).toEqual(stored);

        rows(SCHEMA_TYPE.TASKS).filter((task) => task.mainChat).forEach((task) => { task.AssigneeUserId = [...IN_IT]; });
        rows(SCHEMA_TYPE.SPRINTS).find((list) => String(list._id) === L_SECRET).AssigneeUserId = [INSIDER];
        expect(await inInbox(INSIDER)).toEqual(before);
    });

    it('are those of the projects and channels alone for a person whose role does not list tasks', async () => {
        setRule('task_list', null);
        const names = await opened(OUTSIDER);
        expect(names).toEqual(['the channel of a list']);
        expect(await inInbox(OUTSIDER)).toMatchObject({ notices: noticesOf(names), mentions: mentionsOf(names) });
    });
});
