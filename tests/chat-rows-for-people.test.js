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
const world = require('./fixtures/accessWorld');
const { matches } = require('./fixtures/fakeMongo');
const { getTask, getTaskByQyery } = require('../Modules/Tasks/helpers/getTasksData');
const { getTabSyncTasks } = require('../Modules/Tasks/controller/getTabSyncTasks');
const { commentThreadAccess } = require('../Modules/Comments/helpers/threadAccess');

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, L_OPEN, L_SECRET, T_OPEN, settle } = world;
const { seed, task } = world.create(mockDb);

const DM_SPACE = '6f0000000000000000000ca2';
const DM = '6f0000000000000000000cd1';
const DM_IN_A_PROJECT = '6f0000000000000000000cd2';

const SEARCH = 'POST /api/v1/advance/filter/search/comments';
const TASK_SEARCH = 'POST /api/v1/advance/filter/search/tasks';
const LINKS = 'POST /api/v1/advance/filter/search/links';
const FILES = 'POST /api/v1/advance/filter/search/files';
const EVERYWHERE = 'POST /api/v2/search';

const routes = {};
const register = (method) => (routePath, ...handlers) => { routes[`${method} ${routePath}`] = handlers; };
const app = { get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') };
['AdvancedGlobalFilter', 'GlobalSearch'].forEach((name) => require(`../Modules/${name}/routes`).init(app));

const answered = (run) => new Promise((resolve) => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (answer) => { resolve({ code: res.statusCode, body: answer }); return res; };
    res.json = res.send;
    run(res);
}).then(async (answer) => { await settle(); return answer; });

const requestOf = (uid, extra = {}) => ({ uid, headers: { companyid: CID }, aud: CID, query: {}, params: {}, body: {}, ip: '1.1.1.1', ...extra });

const ask = async (route, uid, body = {}) => {
    const [method, url] = route.split(' ');
    const chain = routes[route];
    const req = requestOf(uid, { method, originalUrl: url, url, body });
    return (await answered((res) => { const step = (at) => Promise.resolve(chain[at](req, res, () => step(at + 1))); step(0); })).body;
};

const IN_IT = [ADMIN, INSIDER];
/* Each can open the project and the list the conversation is kept in. */
const NOT_IN_IT = [['the owner', OWNER], ['a member', OUTSIDER], ['a guest', GUEST]];
const EVERYONE = [['an admin who is in it', ADMIN], ['a member who is in it', INSIDER], ...NOT_IN_IT];
/* The fake database does not work out which lists a member is on inside the comment search's join, so that search is
 * asked here as an owner and an admin; tests/integration/chat-rows.int.test.js asks it as members. */
const OWNER_AND_ADMIN = EVERYONE.filter(([, uid]) => [OWNER, ADMIN].includes(uid));

const onTask = { projectId: P_OPEN, sprintId: L_OPEN, taskId: T_OPEN };
const inListChannel = { projectId: P_OPEN, sprintId: L_OPEN, taskId: 'default' };
const inPrivateListChannel = { projectId: P_OPEN, sprintId: L_SECRET, taskId: 'default' };
const inDm = { projectId: DM_SPACE, taskId: DM };
const inDmOfProject = { projectId: P_OPEN, sprintId: L_OPEN, taskId: DM_IN_A_PROJECT };

const ON_A_TASK = 'plan on a task';
const IN_A_LIST_CHANNEL = 'plan in the channel of a list';
const IN_A_PRIVATE_LIST_CHANNEL = 'plan in the channel of a private list';
const IN_A_DM = 'plan in a direct message';
const IN_A_DM_OF_A_PROJECT = 'plan in a conversation kept in a project';
const THREADS = [
    [ON_A_TASK, onTask], [IN_A_LIST_CHANNEL, inListChannel], [IN_A_PRIVATE_LIST_CHANNEL, inPrivateListChannel], [IN_A_DM, inDm], [IN_A_DM_OF_A_PROJECT, inDmOfProject],
];
const CONVERSATION = 'Adam and Ian in a project';

const at = (minute) => new Date(Date.UTC(2026, 9, 1, 10, minute));

/* The row on a task is the oldest of each kind, so a page cut after the conversation's rows would leave it out. */
const seedRows = () => {
    seed();
    task(T_OPEN).updatedAt = at(0);
    mockDb.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: DM_SPACE, ProjectName: 'Direct messages', default: true });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: DM, TaskName: 'Adam and Ian', ProjectID: DM_SPACE, mainChat: true, AssigneeUserId: IN_IT, deletedStatusKey: 0, createdAt: at(1), updatedAt: at(1) });
    mockDb.seed(SCHEMA_TYPE.TASKS, {
        _id: DM_IN_A_PROJECT, TaskName: CONVERSATION, TaskKey: 'CHAT-1', ProjectID: P_OPEN, sprintId: L_OPEN, mainChat: true, isParentTask: true, AssigneeUserId: IN_IT,
        attachments: [{ url: 'Project/shared.png' }], rawDescription: 'https://example.com/shared', deletedStatusKey: 0, createdAt: at(2), updatedAt: at(2),
    });
    THREADS.forEach(([message, thread], minute) => mockDb.seed(SCHEMA_TYPE.COMMENTS, { ...thread, userId: INSIDER, type: 'text', message, createdAt: at(minute) }));
};
const seedLinksAndFiles = () => THREADS.forEach(([message, thread]) => {
    mockDb.seed(SCHEMA_TYPE.COMMENTS, { ...thread, userId: INSIDER, type: 'link', message: `link: ${message}` });
    mockDb.seed(SCHEMA_TYPE.COMMENTS, { ...thread, userId: INSIDER, type: 'image', mediaOriginalName: `file: ${message}`, mediaURL: 'Project/file.png' });
});

const isIn = (uid) => IN_IT.includes(uid);
/* The insider is on the private list; nobody else here reads its channel but an owner or admin. */
const readsPrivateList = (uid) => [OWNER, ADMIN, INSIDER].includes(uid);
const told = (uid, prefix = '') => [ON_A_TASK, IN_A_LIST_CHANNEL, ...(readsPrivateList(uid) ? [IN_A_PRIVATE_LIST_CHANNEL] : []), ...(isIn(uid) ? [IN_A_DM_OF_A_PROJECT] : [])]
    .map((message) => `${prefix}${message}`).sort();

const commentSearch = async (uid, page = {}) => (await ask(SEARCH, uid, { searchText: 'plan', pids: [P_OPEN, DM_SPACE], batchSize: 50, ...page })).data.map((row) => row.message).sort();
const taskSearch = async (uid, page = {}) => ((await ask(TASK_SEARCH, uid, { searchText: 'Adam', pids: [P_OPEN, DM_SPACE], ...page })).data || []).map((row) => row.TaskName);
const links = async (uid) => (await ask(LINKS, uid, { pids: [P_OPEN] })).data[0].commentsLink.map((row) => row.message).sort();

/* The rows a search joins to a project, read from the join it sends. */
const joined = async (route, uid, collection) => {
    mockDb.calls.length = 0;
    await ask(route, uid, { pids: [P_OPEN] });
    const [pipeline] = mockDb.calls.filter((call) => call.method === 'aggregate' && call.type === SCHEMA_TYPE.PROJECTS).pop().data;
    const join = pipeline.find((stage) => stage.$lookup && stage.$lookup.from === collection).$lookup.pipeline;
    const type = collection === 'tasks' ? SCHEMA_TYPE.TASKS : SCHEMA_TYPE.COMMENTS;
    const projectField = collection === 'tasks' ? 'ProjectID' : 'projectId';
    return (mockDb.store[type] || []).filter((row) => String(row[projectField]) === P_OPEN && join.every((stage) => !stage.$match || matches(row, stage.$match)));
};
const files = async (uid) => (await joined(FILES, uid, 'comments')).map((row) => row.mediaOriginalName).sort();
const everywhere = async (uid, query) => {
    const { data } = await ask(EVERYWHERE, uid, { query });
    return { comments: data.comments.map((row) => row.message).sort(), tasks: data.tasks.map((row) => row.TaskName).sort() };
};

const found = async (uid, match) => {
    const { code, body } = await answered((res) => getTaskByQyery(requestOf(uid, { body: { findQuery: [{ $match: match }] } }), res));
    expect(code).toBe(200);
    return body.map((task) => task.TaskName).sort();
};
const opened = async (uid, taskId) => (await answered((res) => getTask(requestOf(uid, { params: { id: taskId } }), res))).code;
const refreshed = async (uid, extra = {}) => {
    const body = { pid: P_OPEN, sprintId: L_OPEN, istableTask: true, tabLeaveTime: 0, userId: uid, item: {}, ...extra };
    const { body: rows } = await answered((res) => getTabSyncTasks(requestOf(uid, { body }), res));
    return rows;
};

beforeEach(seedRows);

describe('the messages of a conversation kept in a project, in the searches of the people who can open that project', () => {
    it.each(OWNER_AND_ADMIN)('the comment search gives %s the messages of the threads they read', async (label, uid) => {
        expect(await commentSearch(uid)).toEqual(told(uid));
    });

    it.each(EVERYONE)('the search across everything gives %s the messages of the threads they read', async (label, uid) => {
        expect((await everywhere(uid, 'plan')).comments).toEqual(isIn(uid) ? [ON_A_TASK, IN_A_DM_OF_A_PROJECT].sort() : [ON_A_TASK]);
    });

    it.each(EVERYONE)('the links give %s the links of the threads they read', async (label, uid) => {
        seedLinksAndFiles();

        expect(await links(uid)).toEqual(told(uid, 'link: '));
    });

    it.each(EVERYONE)('the files give %s the files of the threads they read', async (label, uid) => {
        seedLinksAndFiles();

        expect(await files(uid)).toEqual(told(uid, 'file: '));
    });

    it('a page of one is filled with a row the person reads, and the pages end where those rows do', async () => {
        const uid = OWNER;
        const rows = told(uid);
        const pages = [];
        for (let skip = 0; skip <= rows.length; skip += 1) pages.push(await commentSearch(uid, { batchSize: 1, skip }));

        expect(pages.flat().sort()).toEqual(rows);
        expect(pages[rows.length]).toEqual([]);
    });

    it.each(OWNER_AND_ADMIN)('each thread the comment search tells %s of is one the chat screen opens for them', async (label, uid) => {
        for (const [message, thread] of THREADS.filter(([, named]) => named.projectId === P_OPEN)) {
            const opens = (await commentThreadAccess(CID, uid, thread)).allowed;

            expect([message, (await commentSearch(uid)).includes(message)]).toEqual([message, opens]);
        }
    });
});

describe('a conversation kept in a project, among the tasks of that project', () => {
    it.each(EVERYONE)('the search across everything finds it for %s only when they are in it', async (label, uid) => {
        expect((await everywhere(uid, 'Adam')).tasks).toEqual(isIn(uid) ? [CONVERSATION] : []);
        expect((await everywhere(uid, 'CHAT-1')).tasks).toEqual(isIn(uid) ? [CONVERSATION] : []);
    });

    it.each(EVERYONE)('the task search finds it for %s only when they are in it', async (label, uid) => {
        expect(await taskSearch(uid)).toEqual(isIn(uid) ? [CONVERSATION] : []);
    });

    it.each(EVERYONE)('the task query finds it for %s only when they are in it, by its id, its project or its name', async (label, uid) => {
        const kept = isIn(uid) ? [CONVERSATION] : [];

        expect(await found(uid, { _id: DM_IN_A_PROJECT })).toEqual(kept);
        expect(await found(uid, { ProjectID: P_OPEN, mainChat: true })).toEqual(kept);
        expect(await found(uid, { TaskName: CONVERSATION })).toEqual(kept);
        expect((await found(uid, { ProjectID: P_OPEN })).includes('Open task')).toBe(true);
    });

    it.each(EVERYONE)('the task route opens it for %s only when they are in it, and answers the others as for a task that is not there', async (label, uid) => {
        expect(await opened(uid, DM_IN_A_PROJECT)).toBe(isIn(uid) ? 200 : await opened(uid, '6f0000000000000000000dff'));
        expect(await opened(uid, T_OPEN)).toBe(200);
    });

    it.each(EVERYONE)('the list refreshed after a tab comes back holds it for %s only when they are in it, in its rows and in its count', async (label, uid) => {
        const names = (await refreshed(uid)).map((row) => row.TaskName).sort();
        const [{ count }] = await refreshed(uid, { istableTask: false, indexName: 'createdAt' });

        expect(names).toEqual(isIn(uid) ? ['Open task', CONVERSATION].sort() : ['Open task']);
        expect(count).toEqual([{ count: isIn(uid) ? 2 : 1 }]);
    });

    it.each(EVERYONE)('the files of the project carry its attachments for %s only when they are in it', async (label, uid) => {
        const names = (await joined(FILES, uid, 'tasks')).map((row) => row.TaskName);

        expect(names.includes(CONVERSATION)).toBe(isIn(uid));
    });

    it.each(EVERYONE)('the links of the project carry it for %s only when they are in it', async (label, uid) => {
        const names = (await joined(LINKS, uid, 'tasks')).map((row) => row.TaskName);

        expect(names.includes(CONVERSATION)).toBe(isIn(uid));
    });
});
