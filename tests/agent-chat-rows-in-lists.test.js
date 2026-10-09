require('./fixtures/mcpFlagsOff');
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
jest.mock('../Modules/notification-count/controller', () => ({ updateUnReadCommentsCountFun: jest.fn(async () => ({ status: true })) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { Notification_key: KEY } = require('../Config/notificationKey');
const world = require('./fixtures/accessWorld');
const { agentPerimeter } = require('../Modules/Agents/guard');

const { CID, OWNER, INSIDER, P_OPEN, L_OPEN, T_OPEN, settle } = world;
const { seed } = world.create(mockDb);

const SPACE = '6f0000000000000000000ca1';
const DM_SPACE = '6f0000000000000000000ca2';
const CHANNEL = '6f0000000000000000000cb1';
const DM = '6f0000000000000000000cd1';
const DM_IN_A_PROJECT = '6f0000000000000000000cd2';

const SEARCH = 'POST /api/v1/advance/filter/search/comments';
const EVERYWHERE = 'POST /api/v2/search';
const INBOX = 'GET /api/v1/inbox';
const COUNTS = 'GET /api/v1/inbox/counts';
const MENTIONS = 'GET /api/v1/app-notification/mentions';
const NOTICES = 'GET /api/v1/app-notification/notification';

const routes = {};
const register = (method) => (routePath, ...handlers) => { routes[`${method} ${routePath}`] = handlers; };
const app = { get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') };
['AdvancedGlobalFilter', 'GlobalSearch', 'Inbox', 'notification/app-notification'].forEach((name) => require(`../Modules/${name}/routes`).init(app));

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

const inDm = { projectId: DM_SPACE, taskId: DM };
const inChannel = { projectId: SPACE, sprintId: CHANNEL, taskId: 'default' };
const inListChannel = { projectId: P_OPEN, sprintId: L_OPEN, taskId: 'default' };
const onTask = { projectId: P_OPEN, sprintId: L_OPEN, taskId: T_OPEN };
const inDmOfProject = { projectId: P_OPEN, sprintId: L_OPEN, taskId: DM_IN_A_PROJECT };

const ON_A_TASK = 'plan on a task';
const IN_A_LIST_CHANNEL = 'plan in the channel of a list';
const IN_A_CHANNEL = 'plan in a channel';
const IN_A_DM = 'plan in a direct message';
const IN_A_DM_OF_A_PROJECT = 'plan in a direct message kept in a project';
const WORK = [ON_A_TASK];
const CHANNELS = [IN_A_CHANNEL, IN_A_LIST_CHANNEL];
const DIRECT = [IN_A_DM, IN_A_DM_OF_A_PROJECT];
const THREADS = [[ON_A_TASK, onTask], [IN_A_LIST_CHANNEL, inListChannel], [IN_A_CHANNEL, inChannel], [IN_A_DM, inDm], [IN_A_DM_OF_A_PROJECT, inDmOfProject]];

const at = (minute) => new Date(Date.UTC(2026, 9, 1, 10, minute));

/* The task row is the oldest of each kind, so a page cut after the chat rows would leave it out. */
const seedRows = () => {
    seed();
    mockDb.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: SPACE, ProjectName: 'Team', default: false });
    mockDb.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: DM_SPACE, ProjectName: 'Direct messages', default: true });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: CHANNEL, name: 'general', projectId: SPACE, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: DM, TaskName: 'Olive and Ian', ProjectID: DM_SPACE, mainChat: true, AssigneeUserId: [OWNER, INSIDER], deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: DM_IN_A_PROJECT, TaskName: 'Olive and Ian again', ProjectID: P_OPEN, sprintId: L_OPEN, mainChat: true, AssigneeUserId: [OWNER, INSIDER], deletedStatusKey: 0 });
    THREADS.forEach(([message, thread], minute) => {
        mockDb.seed(SCHEMA_TYPE.COMMENTS, { ...thread, userId: INSIDER, type: 'text', message, createdAt: at(minute) });
        mockDb.seed(SCHEMA_TYPE.MENTIONS, {
            ...thread, userId: INSIDER, mentionIds: [OWNER], notSeen: [OWNER], comment_id: `c${minute}`, comment_message: `mention: ${message}`,
            type: 'task', mainChat: thread.taskId === 'default' || thread.projectId !== P_OPEN, createdAt: at(minute),
        });
    });
    const notice = (message, minute, fields) => mockDb.seed(SCHEMA_TYPE.NOTIFICATIONS, {
        key: KEY.COMMENT_REPLY, type: 'tasks', message: `notice: ${message}`, userId: INSIDER, assigneeUsers: [OWNER], notSeen: [OWNER], receiverID: OWNER,
        notificationType: 'push', createdAt: at(minute), ...fields,
    });
    notice(ON_A_TASK, 0, onTask);
    notice(IN_A_LIST_CHANNEL, 1, { ...inListChannel, taskId: L_OPEN, changeType: 'chat_thread_reply' });
    notice(IN_A_CHANNEL, 2, { ...inChannel, key: KEY.COMMENT_ASSIGNED });
    notice(IN_A_DM, 3, { ...inDm, changeType: 'chat_thread_reply' });
    notice(IN_A_DM_OF_A_PROJECT, 4, { ...inDmOfProject, key: KEY.COMMENT_ASSIGNED });
};

const told = (prefix, messages) => messages.map((message) => `${prefix}${message}`).sort();

/* [what is read, how, the text each row is told by] */
const READS = {
    'the comment search': {
        read: async (caller, page = {}) => (await ask(SEARCH, caller, { body: { searchText: 'plan', pids: [P_OPEN, SPACE, DM_SPACE], batchSize: 50, ...page } })).data.map((row) => row.message).sort(),
        person: [ON_A_TASK, IN_A_LIST_CHANNEL, IN_A_DM_OF_A_PROJECT],
        prefix: '',
    },
    'the mentions of the person': {
        read: async (caller) => (await ask(MENTIONS, caller)).data.map((row) => row.comment_message).sort(),
        person: [...WORK, ...CHANNELS, ...DIRECT],
        prefix: 'mention: ',
    },
    'the notices of the person': {
        read: async (caller) => (await ask(NOTICES, caller, { query: { batchSize: '50' } })).data.map((row) => row.message).sort(),
        person: [...WORK, ...CHANNELS, ...DIRECT],
        prefix: 'notice: ',
    },
    'the mentions in the inbox': {
        read: async (caller) => (await ask(INBOX, caller, { query: { tab: 'mentions', limit: '50' } })).data.items.map((row) => row.message).sort(),
        person: [...WORK, ...CHANNELS, ...DIRECT],
        prefix: 'mention: ',
    },
    'the notices in the inbox': {
        read: async (caller) => (await ask(INBOX, caller, { query: { tab: 'notifications', limit: '50' } })).data.items.map((row) => row.message).sort(),
        person: [...WORK, ...CHANNELS, ...DIRECT],
        prefix: 'notice: ',
    },
};
const reads = Object.entries(READS).map(([name, row]) => [name, row]);
const among = (person, messages) => messages.filter((message) => person.includes(message));

beforeEach(seedRows);
afterEach(() => { process.env.MCP_TOOLS_DATA = 'off'; });

describe('chat among the rows a read lists across threads', () => {
    it.each(reads)('%s leaves a person every row they had', async (name, { read, person, prefix }) => {
        for (const caller of [session(OWNER), personalToken(OWNER)]) {
            expect(await read(caller)).toEqual(told(prefix, person));
        }
    });

    it.each(reads)('%s gives an agent no row of a channel or a direct message', async (name, { read, person, prefix }) => {
        process.env.MCP_TOOLS_DATA = 'on';

        for (const caller of [agentToken(OWNER), agentToken(OWNER, { grants: ['tasks:manage'] }), agentRun(OWNER)]) {
            expect(await read(caller)).toEqual(told(prefix, among(person, WORK)));
        }
    });

    it.each(reads)('%s gives an agent whose token was given chat the rows of channels, and still none of a direct message', async (name, { read, person, prefix }) => {
        process.env.MCP_TOOLS_DATA = 'on';

        expect(await read(withChat(OWNER))).toEqual(told(prefix, among(person, [...WORK, ...CHANNELS])));
    });

    it.each(reads)('%s gives that token no row of a channel while the read tools are off', async (name, { read, person, prefix }) => {
        expect(await read(withChat(OWNER))).toEqual(told(prefix, among(person, WORK)));
    });
});

describe('what the size of a page tells an agent', () => {
    it('the comment search fills a page of one with the row the agent may read, and has no second page', async () => {
        const { read } = READS['the comment search'];

        expect(await read(agentToken(OWNER), { batchSize: 1 })).toEqual([ON_A_TASK]);
        expect(await read(agentToken(OWNER), { batchSize: 1, skip: 1 })).toEqual([]);
        expect(await read(session(OWNER), { batchSize: 1 })).toEqual([IN_A_DM_OF_A_PROJECT]);
    });

    it('the inbox has nothing more for an agent after the rows it may read', async () => {
        const page = (caller) => ask(INBOX, caller, { query: { tab: 'all', limit: '2' } });

        const forAgent = (await page(agentToken(OWNER))).data;
        expect(forAgent.items.map((row) => row.message).sort()).toEqual([`mention: ${ON_A_TASK}`, `notice: ${ON_A_TASK}`]);
        expect(forAgent.hasMore).toBe(false);
        expect((await page(session(OWNER))).data.hasMore).toBe(true);
    });

    it('the inbox counts leave out what the agent may not read', async () => {
        process.env.MCP_TOOLS_DATA = 'on';
        const counted = async (caller) => { const { data } = await ask(COUNTS, caller); return [data.notifications, data.mentions, data.all]; };

        expect(await counted(session(OWNER))).toEqual([5, 5, 10]);
        expect(await counted(agentToken(OWNER))).toEqual([1, 1, 2]);
        expect(await counted(withChat(OWNER))).toEqual([3, 3, 6]);
    });
});

describe('the links and files of the projects a search names', () => {
    const LINKS = 'POST /api/v1/advance/filter/search/links';
    const FILES = 'POST /api/v1/advance/filter/search/files';
    const { matches } = require('./fixtures/fakeMongo');

    beforeEach(() => THREADS.forEach(([message, thread]) => {
        mockDb.seed(SCHEMA_TYPE.COMMENTS, { ...thread, userId: INSIDER, type: 'link', message: `link: ${message}` });
        mockDb.seed(SCHEMA_TYPE.COMMENTS, { ...thread, userId: INSIDER, type: 'image', mediaOriginalName: `file: ${message}`, mediaURL: 'Project/file.png' });
    }));

    const links = async (caller) => (await ask(LINKS, caller, { body: { pids: [P_OPEN] } })).data[0].commentsLink.map((row) => row.message).sort();

    /* The comments the files search joins to a project, read from the join it sends. */
    const files = async (caller) => {
        mockDb.calls.length = 0;
        await ask(FILES, caller, { body: { pids: [P_OPEN] } });
        const [pipeline] = mockDb.calls.filter((call) => call.method === 'aggregate' && call.type === SCHEMA_TYPE.PROJECTS).pop().data;
        const join = pipeline.find((stage) => stage.$lookup && stage.$lookup.from === 'comments').$lookup.pipeline;
        return (mockDb.store[SCHEMA_TYPE.COMMENTS] || [])
            .filter((row) => String(row.projectId) === P_OPEN && join.every((stage) => matches(row, stage.$match)))
            .map((row) => row.mediaOriginalName).sort();
    };

    const inProject = [ON_A_TASK, IN_A_LIST_CHANNEL, IN_A_DM_OF_A_PROJECT];

    it.each([['links', links, 'link: '], ['files', files, 'file: ']])('the %s leave a person every row they had', async (name, read, prefix) => {
        expect(await read(session(OWNER))).toEqual(told(prefix, inProject));
        expect(await read(personalToken(OWNER))).toEqual(told(prefix, inProject));
    });

    it.each([['links', links, 'link: '], ['files', files, 'file: ']])('the %s give an agent no row of a channel or a direct message, and a token given chat the rows of channels', async (name, read, prefix) => {
        process.env.MCP_TOOLS_DATA = 'on';

        expect(await read(agentToken(OWNER))).toEqual(told(prefix, WORK));
        expect(await read(agentRun(OWNER))).toEqual(told(prefix, WORK));
        expect(await read(withChat(OWNER))).toEqual(told(prefix, [ON_A_TASK, IN_A_LIST_CHANNEL]));
    });
});

describe('the search across everything', () => {
    const found = async (caller, query) => {
        const { data } = await ask(EVERYWHERE, caller, { body: { query } });
        return { comments: data.comments.map((row) => row.message).sort(), tasks: data.tasks.map((row) => row.TaskName).sort() };
    };

    it('leaves a person the rows they had', async () => {
        expect((await found(session(OWNER), 'plan')).comments).toEqual([ON_A_TASK, IN_A_DM_OF_A_PROJECT].sort());
        expect((await found(session(OWNER), 'Olive')).tasks).toEqual(['Olive and Ian again']);
    });

    it.each([
        ['a token created for an agent', agentToken(OWNER)],
        ['a token given chat', withChat(OWNER)],
        ['an agent run', agentRun(OWNER)],
    ])('gives %s no message of a direct message, and no conversation among the tasks', async (label, caller) => {
        process.env.MCP_TOOLS_DATA = 'on';

        expect((await found(caller, 'plan')).comments).toEqual([ON_A_TASK]);
        expect((await found(caller, 'Olive')).tasks).toEqual([]);
    });
});
