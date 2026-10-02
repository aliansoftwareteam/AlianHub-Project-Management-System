process.env.STORAGE_TYPE = 'server';
jest.setTimeout(30000);
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => ({ handleStoredFileCopy: jest.fn() }));
jest.mock('../Modules/notification-count/controller', () => ({
    updateUnReadCommentsCountFun: jest.fn(async () => ({ status: true })),
    updateCount: jest.fn((companyId, userIds, query, cb) => cb({ status: true })),
    updateMentionCount: jest.fn((companyId, userIds, field, cb) => cb({ status: true })),
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { Notification_key: KEY } = require('../Config/notificationKey');
const world = require('./fixtures/accessWorld');
const { agentPerimeter } = require('../Modules/Agents/guard');

const { CID, OWNER, INSIDER, P_OPEN, L_OPEN, T_OPEN, settle } = world;
const { seed, rows } = world.create(mockDb);

const SPACE = '6f0000000000000000000ca1';
const DM_SPACE = '6f0000000000000000000ca2';
const CHANNEL = '6f0000000000000000000cb1';
const DM = '6f0000000000000000000cd1';
const DM_IN_A_PROJECT = '6f0000000000000000000cd2';

const routes = {};
const register = (method) => (routePath, ...handlers) => { routes[`${method} ${routePath}`] = handlers; };
const app = { get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') };
['Inbox', 'notification/app-notification'].forEach((name) => require(`../Modules/${name}/routes`).init(app));

const session = (uid) => ({ uid });
const agentToken = (uid, extra = {}) => ({ uid, apiToken: { _id: '6f0000000000000000000101', kind: 'agent', name: 'Claude', userId: uid, scopes: ['read', 'write'], ...extra } });
const withChat = (uid) => agentToken(uid, { grants: ['chat:read'] });
const personalToken = (uid) => ({ uid, apiToken: { _id: '6f0000000000000000000102', name: 'A script', userId: uid, scopes: ['read', 'write'] } });
const agentRun = (uid) => ({ uid, agentRun: { _id: '6f0000000000000000000103', agentId: '6f0000000000000000000104', agentName: 'Triage' } });

/* What stands in front of every route, then the route's own guards and its handler. */
const ask = (route, caller, { body = {}, query = {} } = {}) => new Promise((resolve) => {
    const [method, url] = route.split(' ');
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (answer) => { resolve(answer); return res; };
    res.json = res.send;
    const req = { ...caller, method, originalUrl: url, url, query, params: {}, headers: { companyid: CID }, aud: CID, ip: '1.1.1.1', body };
    const chain = [agentPerimeter, ...routes[route]];
    const step = (at) => Promise.resolve(chain[at](req, res, () => step(at + 1)));
    step(0);
}).then(async (answer) => { await settle(); return answer; });

const onTask = { projectId: P_OPEN, sprintId: L_OPEN, taskId: T_OPEN };
const inListChannel = { projectId: P_OPEN, sprintId: L_OPEN, taskId: 'default' };
const inChannel = { projectId: SPACE, sprintId: CHANNEL, taskId: 'default' };
const inDm = { projectId: DM_SPACE, taskId: DM };
const inDmOfProject = { projectId: P_OPEN, sprintId: L_OPEN, taskId: DM_IN_A_PROJECT };

const ON_A_TASK = 'on a task';
const IN_A_LIST_CHANNEL = 'in the channel of a list';
const IN_A_CHANNEL = 'in a channel';
const IN_A_DM = 'in a direct message';
const IN_A_DM_OF_A_PROJECT = 'in a direct message kept in a project';
const WORK = [ON_A_TASK];
const CHANNELS = [IN_A_LIST_CHANNEL, IN_A_CHANNEL];
const DIRECT = [IN_A_DM, IN_A_DM_OF_A_PROJECT];
const EVERY = [...WORK, ...CHANNELS, ...DIRECT];
const THREADS = [[ON_A_TASK, onTask], [IN_A_LIST_CHANNEL, inListChannel], [IN_A_CHANNEL, inChannel], [IN_A_DM, inDm], [IN_A_DM_OF_A_PROJECT, inDmOfProject]];

const at = (minute) => new Date(Date.UTC(2026, 9, 1, 10, minute));
const noticeId = (n) => `6f000000000000000000aa0${n}`;
const mentionId = (n) => `6f000000000000000000bb0${n}`;

const seedRows = () => {
    seed();
    mockDb.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: SPACE, ProjectName: 'Team', default: false });
    mockDb.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: DM_SPACE, ProjectName: 'Direct messages', default: true });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: CHANNEL, name: 'general', projectId: SPACE, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: DM, TaskName: 'Olive and Ian', ProjectID: DM_SPACE, mainChat: true, AssigneeUserId: [OWNER, INSIDER], deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: DM_IN_A_PROJECT, TaskName: 'Olive and Ian again', ProjectID: P_OPEN, sprintId: L_OPEN, mainChat: true, AssigneeUserId: [OWNER, INSIDER], deletedStatusKey: 0 });
    THREADS.forEach(([message, thread], n) => {
        mockDb.seed(SCHEMA_TYPE.MENTIONS, {
            _id: mentionId(n), ...thread, userId: INSIDER, mentionIds: [OWNER], notSeen: [OWNER], comment_id: `c${n}`, comment_message: message,
            type: 'task', mainChat: thread.taskId === 'default' || thread.projectId !== P_OPEN, createdAt: at(n),
        });
    });
    const notice = (message, n, fields) => mockDb.seed(SCHEMA_TYPE.NOTIFICATIONS, {
        _id: noticeId(n), key: KEY.COMMENT_REPLY, type: 'tasks', message, userId: INSIDER, assigneeUsers: [OWNER], notSeen: [OWNER], receiverID: OWNER,
        notificationType: 'push', createdAt: at(n), ...fields,
    });
    notice(ON_A_TASK, 0, onTask);
    notice(IN_A_LIST_CHANNEL, 1, { ...inListChannel, taskId: L_OPEN, changeType: 'chat_thread_reply' });
    notice(IN_A_CHANNEL, 2, { ...inChannel, key: KEY.COMMENT_ASSIGNED });
    notice(IN_A_DM, 3, { ...inDm, changeType: 'chat_thread_reply' });
    notice(IN_A_DM_OF_A_PROJECT, 4, { ...inDmOfProject, key: KEY.COMMENT_ASSIGNED });
};

const notices = () => rows(SCHEMA_TYPE.NOTIFICATIONS);
const mentions = () => rows(SCHEMA_TYPE.MENTIONS);
const textOf = (row) => row.message || row.comment_message;
const sorted = (list) => [...list].sort();
/* The rows of each kind that the person no longer has unread, has cleared, or has put off. */
const read = () => ({
    notices: sorted(notices().filter((row) => !(row.notSeen || []).includes(OWNER)).map(textOf)),
    mentions: sorted(mentions().filter((row) => !(row.notSeen || []).includes(OWNER)).map(textOf)),
});
const cleared = () => ({
    notices: sorted(notices().filter((row) => row.clearedAt).map(textOf)),
    mentions: sorted(mentions().filter((row) => (row.clearedFor || []).some((entry) => entry.userId === OWNER)).map(textOf)),
});
const putOff = () => ({
    notices: sorted(notices().filter((row) => row.snoozedUntil || row.snoozeUntilChange).map(textOf)),
    mentions: sorted(mentions().filter((row) => (row.snoozes || []).some((entry) => entry.userId === OWNER)).map(textOf)),
});
const both = (messages) => ({ notices: sorted(messages), mentions: sorted(messages) });

const everyItem = () => EVERY.flatMap((message, n) => [{ sourceType: 'notification', sourceId: noticeId(n) }, { sourceType: 'mention', sourceId: mentionId(n) }]);
const IN_A_WEEK = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

/* [who asks, the caller, what of the person's rows it acts on] */
const CALLERS = [
    ['a signed-in person', session(OWNER), EVERY, false],
    ['a personal token', personalToken(OWNER), EVERY, false],
    ['a token created for an agent', agentToken(OWNER), WORK, true],
    ['an agent run', agentRun(OWNER), WORK, true],
    ['a token given chat', withChat(OWNER), [...WORK, ...CHANNELS], true],
];

beforeEach(seedRows);
afterEach(() => { delete process.env.MCP_TOOLS_DATA; });

describe('what an inbox write changes of the rows of the person', () => {
    it.each(CALLERS)('marking everything read as %s', async (label, caller, acted, isAgent) => {
        if (isAgent) process.env.MCP_TOOLS_DATA = 'on';

        await ask('POST /api/v1/inbox/read-all', caller, { body: { tab: 'primary' } });

        expect(read()).toEqual(both(acted));
    });

    it.each(CALLERS)('clearing everything as %s', async (label, caller, acted, isAgent) => {
        if (isAgent) process.env.MCP_TOOLS_DATA = 'on';

        await ask('POST /api/v1/inbox/clear-all', caller, { body: { tab: 'primary' } });

        expect(cleared()).toEqual(both(acted));
    });

    it.each(CALLERS)('putting every row off as %s', async (label, caller, acted, isAgent) => {
        if (isAgent) process.env.MCP_TOOLS_DATA = 'on';

        await ask('POST /api/v1/inbox/snooze', caller, { body: { items: everyItem(), until: IN_A_WEEK() } });

        expect(putOff()).toEqual(both(acted));
        expect(read()).toEqual(both(acted));
    });

    it.each(CALLERS)('marking every row read, one by one, as %s', async (label, caller, acted, isAgent) => {
        if (isAgent) process.env.MCP_TOOLS_DATA = 'on';

        await ask('POST /api/v1/inbox/read', caller, { body: { items: everyItem() } });

        expect(read()).toEqual(both(acted));
    });

    it.each(CALLERS)('clearing every row, one by one, as %s', async (label, caller, acted, isAgent) => {
        if (isAgent) process.env.MCP_TOOLS_DATA = 'on';

        await ask('POST /api/v1/inbox/clear', caller, { body: { items: everyItem() } });

        expect(cleared()).toEqual(both(acted));
    });

    it.each(CALLERS)('marking everything read on the notification routes as %s', async (label, caller, acted, isAgent) => {
        if (isAgent) process.env.MCP_TOOLS_DATA = 'on';

        await ask('PUT /api/v1/app-notification/mark-all-read', caller, { body: { key: 'notifications' } });
        await ask('PUT /api/v1/app-notification/mark-all-read', caller, { body: { key: 'mentions' } });

        expect(read()).toEqual(both(acted));
    });

    it.each(CALLERS)('marking every row read on the notification routes as %s', async (label, caller, acted, isAgent) => {
        if (isAgent) process.env.MCP_TOOLS_DATA = 'on';

        for (const n of EVERY.keys()) {
            await ask('PUT /api/v1/app-notification/mark-read', caller, { body: { key: 'notifications', id: noticeId(n) } });
            await ask('PUT /api/v1/app-notification/mark-read', caller, { body: { key: 'mentions', id: mentionId(n) } });
        }

        expect(read()).toEqual(both(acted));
    });

    it('a token given chat acts on no channel row while the read tools are off', async () => {
        await ask('POST /api/v1/inbox/read-all', withChat(OWNER), { body: { tab: 'primary' } });

        expect(read()).toEqual(both(WORK));
    });
});

describe('what a person put off or cleared, for an agent', () => {
    const personPutsOff = () => ask('POST /api/v1/inbox/snooze', session(OWNER), { body: { items: everyItem(), until: IN_A_WEEK() } });
    const nextWakeAt = async (caller) => (await ask('GET /api/v1/inbox/counts', caller)).data.nextWakeAt;

    it('the time the next row comes back is told to a person, and to an agent only for a row it may read', async () => {
        await ask('POST /api/v1/inbox/snooze', session(OWNER), { body: { items: everyItem().filter((item, at) => at >= 2), until: IN_A_WEEK() } });

        expect(await nextWakeAt(session(OWNER))).toEqual(expect.any(String));
        expect(await nextWakeAt(agentToken(OWNER))).toBeNull();
        expect(await nextWakeAt(agentRun(OWNER))).toBeNull();
    });

    it('the time is told to an agent when a row of a task was put off', async () => {
        await personPutsOff();

        expect(await nextWakeAt(agentToken(OWNER))).toEqual(await nextWakeAt(session(OWNER)));
    });

    it.each([
        ['a token created for an agent', agentToken(OWNER), WORK],
        ['a signed-in person', session(OWNER), EVERY],
    ])('bringing every notice back as %s brings back the ones it acts on', async (label, caller, acted) => {
        await personPutsOff();

        /* The fake database does not look inside the list of a mention's readers, which that write filters on. */
        await ask('POST /api/v1/inbox/unsnooze', caller, { body: { items: everyItem().filter((item) => item.sourceType === 'notification') } });

        expect(putOff().notices).toEqual(sorted(EVERY.filter((message) => !acted.includes(message))));
    });

    it.each([
        ['a token created for an agent', agentToken(OWNER), WORK],
        ['a signed-in person', session(OWNER), EVERY],
    ])('restoring what was cleared as %s restores the rows it acts on, row by row and all at once', async (label, caller, acted) => {
        const left = both(EVERY.filter((message) => !acted.includes(message)));

        await ask('POST /api/v1/inbox/clear', session(OWNER), { body: { items: everyItem() } });
        await ask('POST /api/v1/inbox/restore', caller, { body: { items: everyItem() } });
        expect(cleared()).toEqual(left);

        seedRows();
        const { data } = await ask('POST /api/v1/inbox/clear-all', session(OWNER), { body: { tab: 'primary' } });
        await ask('POST /api/v1/inbox/restore-all', caller, { body: { clearedAt: data.clearedAt, unread: data.unread } });
        expect(cleared()).toEqual(left);
    });

    it('reading the inbox as an agent leaves a chat row that fell due as the person left it', async () => {
        const due = new Date(Date.now() - 1000);
        notices().forEach((row) => { row.snoozedUntil = due; row.notSeen = []; });
        mentions().forEach((row) => { row.snoozes = [{ userId: OWNER, until: due, untilChange: false }]; row.notSeen = []; });

        await ask('GET /api/v1/inbox', agentToken(OWNER), { query: { tab: 'all' } });
        expect(putOff()).toEqual(both([...CHANNELS, ...DIRECT]));

        await ask('GET /api/v1/inbox', session(OWNER), { query: { tab: 'all' } });
        expect(putOff()).toEqual(both([]));
    });
});
