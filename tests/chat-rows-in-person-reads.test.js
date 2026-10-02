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
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/notification-count/controller', () => ({ updateUnReadCommentsCountFun: jest.fn(async () => ({ status: true })) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/accessWorld');
const { matches } = require('./fixtures/fakeMongo');
const { updateUnReadCommentsCountFun } = require('../Modules/notification-count/controller');
const { commentThreadAccess } = require('../Modules/Comments/helpers/threadAccess');
const { bumpUnreadCounts } = require('../Modules/Comments/helpers/unreadBumps');
const media = require('../Modules/MediaFiles/controller');
const { visibleTask, visibleTasks } = require('../Modules/AI/taskAccess');
const { judge } = require('../Modules/storage/downloadScope');
const { privateWorkOf, commentClause, runClause, proposalClause, readsRun, readsProposal } = require('../Modules/Agents/privateWork');
const { scopeTimesheetPipeline } = require('../Modules/TimeSheet/helpers/timesheetQueryScope');

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, L_OPEN, L_SECRET, L_PRIVATE, T_OPEN, T_SECRET, T_PRIVATE, settle } = world;
const { seed, rows } = world.create(mockDb);

const DM_SPACE = '6f0000000000000000000ca2';
const DM = '6f0000000000000000000cd1';
const CONVERSATION = '6f0000000000000000000cd2';
const IN_IT = [ADMIN, INSIDER];
const EVERYONE = [['the owner', OWNER], ['an admin who is in it', ADMIN], ['a member who is in it', INSIDER], ['a member', OUTSIDER], ['a guest', GUEST]];
const isIn = (uid) => IN_IT.includes(uid);

/* [the thread, how the files panel names it] */
const THREADS = {
    'a task': [{ projectId: P_OPEN, sprintId: L_OPEN, taskId: T_OPEN }, 'task'],
    'a task of a private list': [{ projectId: P_OPEN, sprintId: L_SECRET, taskId: T_SECRET }, 'task'],
    'a task of a private project': [{ projectId: P_PRIVATE, sprintId: L_PRIVATE, taskId: T_PRIVATE }, 'task'],
    'the channel of a list': [{ projectId: P_OPEN, sprintId: L_OPEN, taskId: 'default' }, 'chat'],
    'the channel of a private list': [{ projectId: P_OPEN, sprintId: L_SECRET, taskId: 'default' }, 'chat'],
    'a direct message': [{ projectId: DM_SPACE, sprintId: L_OPEN, taskId: DM }, 'chat'],
    'a conversation kept in a project': [{ projectId: P_OPEN, sprintId: L_OPEN, taskId: CONVERSATION }, 'chat'],
    'a conversation kept in a project, asked for as a task': [{ projectId: P_OPEN, sprintId: L_OPEN, taskId: CONVERSATION }, 'task'],
};

const conversation = (extra) => ({
    TaskName: 'Adam and Ian', TaskKey: '--', CompanyId: CID, mainChat: true, isParentTask: true, AssigneeUserId: IN_IT, watchers: IN_IT, deletedStatusKey: 0,
    attachments: [{ url: 'Project/shared.png' }], ...extra,
});

const seedRows = () => {
    seed();
    mockDb.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: DM_SPACE, ProjectName: 'Direct messages', default: true });
    mockDb.seed(SCHEMA_TYPE.TASKS, conversation({ _id: DM, ProjectID: DM_SPACE, sprintId: L_OPEN }));
    mockDb.seed(SCHEMA_TYPE.TASKS, conversation({ _id: CONVERSATION, ProjectID: P_OPEN, sprintId: L_OPEN }));
    Object.entries(THREADS).forEach(([name, [thread]]) => ['image', 'audio'].forEach((type) => mockDb.seed(SCHEMA_TYPE.COMMENTS, {
        ...thread, project: false, userId: INSIDER, type, isDeleted: false, mediaName: `${type} of ${name}`, mediaOriginalName: `${type} of ${name}`, mediaURL: `Project/${type}.bin`,
    })));
    mockDb.seed(SCHEMA_TYPE.COMMENTS, { projectId: P_OPEN, project: true, userId: INSIDER, type: 'image', isDeleted: false, mediaName: 'image of the project', mediaURL: 'Project/image.bin' });
    mockDb.seed(SCHEMA_TYPE.COMMENTS, { projectId: P_PRIVATE, project: true, userId: INSIDER, type: 'image', isDeleted: false, mediaName: 'image of the private project', mediaURL: 'Project/image.bin' });
};

const answered = (handler, req) => new Promise((resolve) => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (answer) => { resolve({ code: res.statusCode, body: answer }); return res; };
    res.send = res.json;
    handler({ headers: { companyid: CID }, aud: CID, query: {}, params: {}, body: {}, ...req }, res);
}).then(async (answer) => { await settle(); return answer; });

const selected = (thread, kind) => (kind === 'project' ? { _id: thread.projectId } : { ProjectID: thread.projectId, sprintId: thread.sprintId, _id: thread.taskId });
/* The handlers send their stages in a list of their own, which the fake database does not run, so the rows a
 * request reads are worked out here from the filter it sent; a request that reads nothing sent none. */
const filesRead = async (handler, query, uid) => {
    mockDb.calls.length = 0;
    const { code } = await answered(handler, { uid, query });
    const read = mockDb.calls.filter((call) => call.type === SCHEMA_TYPE.COMMENTS && call.method === 'aggregate').pop();
    const [first] = read ? read.data.flat(2) : [];
    return { code, files: first ? rows(SCHEMA_TYPE.COMMENTS).filter((row) => matches(row, first.$match)).map((row) => row.mediaName).sort() : [] };
};
const gallery = (uid, thread, kind) => filesRead(media.getPaginateMediaFiles, { handleType: kind, selectedData: JSON.stringify(selected(thread, kind)), excludeMediaTypes: '["text","audio"]', skip: '0', batchSize: '50' }, uid);
const voices = (uid, thread, kind) => filesRead(media.getMediaFileUsers, { fromWhich: kind, selectedData: JSON.stringify(selected(thread, kind)) }, uid);

beforeEach(() => { jest.clearAllMocks(); seedRows(); });

describe('the files of a thread', () => {
    const cases = Object.entries(THREADS).flatMap(([name, [thread, kind]]) => EVERYONE.map(([who, uid]) => [name, who, uid, thread, kind]));

    it.each(cases)('of %s are listed for %s when the comment routes open that thread for them, and are refused as its comments are otherwise', async (name, who, uid, thread, kind) => {
        const opens = (await commentThreadAccess(CID, uid, thread)).allowed;
        /* The two ways of asking for the conversation read the same thread, so each lists the files of both. */
        const inThread = Object.entries(THREADS).filter(([, [other]]) => JSON.stringify(other) === JSON.stringify(thread)).map(([other]) => other);

        expect(await gallery(uid, thread, kind)).toEqual(opens ? { code: 200, files: inThread.map((other) => `image of ${other}`).sort() } : { code: 404, files: [] });
        expect(await voices(uid, thread, kind)).toEqual(opens ? { code: 200, files: inThread.map((other) => `audio of ${other}`).sort() } : { code: 404, files: [] });
    });

    it.each(EVERYONE)('of a project are listed for %s when they can open it', async (who, uid) => {
        expect((await gallery(uid, { projectId: P_OPEN }, 'project')).files).toEqual(['image of the project']);
        expect((await gallery(uid, { projectId: P_PRIVATE }, 'project')).files).toEqual([OWNER, ADMIN, INSIDER].includes(uid) ? ['image of the private project'] : []);
    });

    it.each(EVERYONE)('are none for %s when the request names no kind of thread the panel has', async (who, uid) => {
        expect(await gallery(uid, { projectId: P_OPEN, sprintId: L_OPEN, taskId: T_OPEN }, 'everything')).toEqual({ code: 400, files: [] });
        expect(await voices(uid, { projectId: P_OPEN, sprintId: L_OPEN, taskId: T_OPEN }, 'everything')).toEqual({ code: 400, files: [] });
    });
});

describe('a conversation kept in a project, where a person asks for one row by its id', () => {
    it.each(EVERYONE)('the task an AI summary is asked of is there for %s only when they are in it', async (who, uid) => {
        const found = await visibleTask({ companyId: CID, uid, taskId: CONVERSATION, projection: { TaskName: 1 } });
        const many = await visibleTasks({ companyId: CID, uid, taskIds: [CONVERSATION, T_OPEN], projection: { TaskName: 1 } });

        expect(Boolean(found)).toBe(isIn(uid));
        expect(many.map((task) => String(task._id)).sort()).toEqual(isIn(uid) ? [CONVERSATION, T_OPEN].sort() : [T_OPEN]);
    });

    it.each(EVERYONE)('its files are downloaded by %s only when they are in it', async (who, uid) => {
        const fileOfMessage = await judge({ companyId: CID, uid, key: `Project/${P_OPEN}/${L_OPEN}/${CONVERSATION}/Comments/shared.png`, storage: 'server' });
        const fileOfTask = await judge({ companyId: CID, uid, key: `Project/${P_OPEN}/${L_OPEN}/${T_OPEN}/Comments/shared.png`, storage: 'server' });

        expect(fileOfMessage.allowed).toBe(isIn(uid));
        expect(fileOfTask.allowed).toBe(true);
    });

    it.each(EVERYONE)('a recent visit to it comes back for %s only when they are in it', async (who, uid) => {
        mockDb.seed(SCHEMA_TYPE.RECENTVISITS, { userId: uid, entityType: 'task', entityId: CONVERSATION, visitedAt: new Date() });
        mockDb.seed(SCHEMA_TYPE.RECENTVISITS, { userId: uid, entityType: 'task', entityId: T_OPEN, visitedAt: new Date(Date.now() - 1000) });

        const { body } = await answered(require('../Modules/RecentVisits/controller').listVisits, { uid });

        expect(body.data.map((row) => row.name || row.title || row.TaskName).sort()).toEqual(isIn(uid) ? ['Adam and Ian', 'Open task'] : ['Open task']);
    });

    it.each(EVERYONE)('a favourite of it comes back for %s only when they are in it', async (who, uid) => {
        rows(SCHEMA_TYPE.USERS).find((row) => String(row._id) === uid).favourites = [
            { companyId: CID, type: 'task', id: CONVERSATION }, { companyId: CID, type: 'task', id: T_OPEN },
        ];

        const { body } = await answered(require('../Modules/Users/favourites').listOwnFavourites, { uid });

        expect(body.data.filter((entry) => entry.type === 'task').map((entry) => entry.name).sort()).toEqual(isIn(uid) ? ['Adam and Ian', 'Open task'] : ['Open task']);
    });
});

describe('who is told that a thread has something new', () => {
    const told = () => updateUnReadCommentsCountFun.mock.calls.flatMap(([{ body }]) => body.userIds).sort();
    const comment = (thread) => ({ ...thread, userId: INSIDER, message: 'New', type: 'text' });

    beforeEach(() => {
        rows(SCHEMA_TYPE.PROJECTS).find((row) => String(row._id) === P_OPEN).watchers = { [OWNER]: 'all_activity', [OUTSIDER]: 'all_activity', [ADMIN]: 'all_activity', [GUEST]: 'participating' };
        rows(SCHEMA_TYPE.TASKS).find((row) => String(row._id) === T_OPEN).watchers = [GUEST];
    });

    it('a conversation kept in a project tells the people in it, and nobody who follows everything in the project', async () => {
        await bumpUnreadCounts(CID, comment({ projectId: P_OPEN, sprintId: L_OPEN, taskId: CONVERSATION }), []);

        expect(told()).toEqual([ADMIN]);
    });

    it('the channel of a private list tells the people on that list, and nobody who follows everything in the project', async () => {
        rows(SCHEMA_TYPE.SPRINTS).find((row) => String(row._id) === L_SECRET).AssigneeUserId = [INSIDER, ADMIN];

        await bumpUnreadCounts(CID, comment({ projectId: P_OPEN, sprintId: L_SECRET, taskId: 'default' }), []);

        expect(told()).toEqual([ADMIN]);
    });

    it('a task still tells its watchers and the people who follow everything in the project', async () => {
        await bumpUnreadCounts(CID, comment({ projectId: P_OPEN, sprintId: L_OPEN, taskId: T_OPEN }), []);

        expect(told()).toEqual([OWNER, ADMIN, OUTSIDER, GUEST].sort());
    });
});

describe('the private work an owner or admin does not read', () => {
    const message = (thread) => ({ ...thread, message: 'A message' });
    const kept = async (uid, clauseOf, row) => !matches(row, clauseOf(await privateWorkOf(CID, uid)));

    it.each([['the owner', OWNER], ['an admin who is in it', ADMIN]])('the messages of a conversation kept in a project are among it for %s unless they are in it', async (who, uid) => {
        expect(await kept(uid, commentClause, message({ projectId: P_OPEN, sprintId: L_OPEN, taskId: CONVERSATION }))).toBe(!isIn(uid));
        expect(await kept(uid, commentClause, message({ projectId: DM_SPACE, taskId: DM }))).toBe(!isIn(uid));
        expect(await kept(uid, commentClause, message({ projectId: P_OPEN, sprintId: L_OPEN, taskId: T_OPEN }))).toBe(false);
    });

    it.each([['the owner', OWNER], ['an admin who is in it', ADMIN]])('the runs and proposals about it are read by %s only when they are in it, by the clause and by the check alike', async (who, uid) => {
        const scope = await privateWorkOf(CID, uid);
        const about = { projectId: P_OPEN, taskId: CONVERSATION, startedBy: INSIDER, requestedBy: INSIDER };

        expect(matches(about, runClause(scope))).toBe(isIn(uid));
        expect(readsRun(scope, about)).toBe(isIn(uid));
        expect(matches(about, proposalClause(scope))).toBe(isIn(uid));
        expect(readsProposal(scope, about)).toBe(isIn(uid));
    });

    it.each([['a member', OUTSIDER], ['a member who is in it', INSIDER]])('a join into the tasks made by %s takes the conversation only when they are in it', (who, uid) => {
        const scope = { uid, companyWide: false, everyone: false, visible: [P_OPEN] };
        const [, { $lookup: { pipeline: [first] } }] = scopeTimesheetPipeline([{ $lookup: { from: 'tasks', localField: 'TicketID', foreignField: '_id', as: 'task', pipeline: [{ $project: { TaskName: 1 } }] } }], scope);
        const row = (id) => rows(SCHEMA_TYPE.TASKS).find((task) => String(task._id) === id);

        expect(matches(row(CONVERSATION), first.$match)).toBe(isIn(uid));
        expect(matches(row(T_OPEN), first.$match)).toBe(true);
    });
});
