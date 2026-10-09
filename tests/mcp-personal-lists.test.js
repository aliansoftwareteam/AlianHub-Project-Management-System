process.env.MCP_TOOLS_DATA = 'on';
process.env.AGENT_PERFORMANCE_READ = 'on';
const fakeMongo = require('./fixtures/fakeMongo');

const mockDb = fakeMongo.create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Automations/engine/tools', () => ({ oid: (id) => (/^[0-9a-fA-F]{24}$/.test(String(id)) ? String(id) : null) }));
jest.mock('../Modules/Agents/actions', () => {
    const real = jest.requireActual('../Modules/Agents/actions');
    class RefusedError extends Error {
        constructor(message) { super(message); this.name = 'RefusedError'; this.status = 403; }
    }
    return {
        RefusedError,
        SCOPE: real.SCOPE,
        rating: real.rating,
        unrated: real.unrated,
        authorizeRead: jest.fn(async () => true),
        perform: jest.fn(async () => ({ auditId: 'audit-1', result: { ok: 1 } })),
        refusal: jest.fn(async (companyId, actor, { reason }) => new RefusedError(reason)),
    };
});
jest.mock('../Modules/Agents/performanceRead', () => ({ ...jest.requireActual('../Modules/Agents/performanceRead'), read: jest.fn(async () => ({ projects: [] })) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { seedTaskListRules } = require('./fixtures/taskListRules');
const actions = require('../Modules/Agents/actions');
const performanceRead = require('../Modules/Agents/performanceRead');
const tools = require('../Modules/Mcp/tools');
const sessionAccess = require('../Modules/AgentSessions/access');
const { companyWideMatch, readsCompanyWide } = require('../Modules/Tasks/helpers/taskQueryGuard');

const C = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const MEMBER = '6f0000000000000000000003';
const SOMEONE = '6f0000000000000000000004';
const P_OPEN = '6f0000000000000000000a01';
const PL_SOMEONE = '6f0000000000000000000a02';
const PL_OWNER = '6f0000000000000000000a03';
const PL_ADMIN = '6f0000000000000000000a04';
const CHAT = '6f0000000000000000000a09';

const PRIVILEGED = [['an owner', OWNER], ['an admin', ADMIN]];

let fx;
let tokenProjects;

const ctx = (uid) => ({
    companyId: C,
    userId: uid,
    actor: { kind: 'agent', userId: uid },
    ip: '1.1.1.1',
    projectIds: tokenProjects,
    token: { _id: 'tok', userId: uid, scopes: [], active: true },
    canWrite: true,
});
const call = (uid, name, args) => tools.call(ctx(uid), name, args);
const keys = (out) => out.tasks.map((t) => t.key).sort();
const refused = (promise) => expect(promise).rejects.toMatchObject({ name: 'RefusedError', status: 403, message: expect.stringMatching(/^not_visible/) });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    myCache.flushAll();
    tokenProjects = [];
    delete process.env.MCP_TOOLS_V2;

    [[OWNER, 1], [ADMIN, 2], [MEMBER, 3], [SOMEONE, 3]].forEach(([userId, roleType]) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false }));
    seedTaskListRules(mockDb);
    const project = (_id, ProjectName, extra = {}) => mockDb.seed(SCHEMA_TYPE.PROJECTS, {
        _id, ProjectName, ProjectCode: ProjectName.toUpperCase(), isPrivateSpace: false, AssigneeUserId: [], taskStatusData: [], deletedStatusKey: 0, ...extra,
    });
    const personalList = (_id, uid) => project(_id, 'Personal', { isPrivateSpace: true, isPersonal: true, personalOwner: uid, AssigneeUserId: [uid] });
    project(P_OPEN, 'Open');
    personalList(PL_SOMEONE, SOMEONE);
    personalList(PL_OWNER, OWNER);
    personalList(PL_ADMIN, ADMIN);
    mockDb.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: CHAT, default: true });

    const task = (TaskKey, ProjectID, AssigneeUserId, extra = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, {
        TaskKey, TaskName: `Task ${TaskKey}`, CompanyId: C, ProjectID, AssigneeUserId, statusType: 'open', deletedStatusKey: 0, ...extra,
    });
    const comment = (t, message) => mockDb.seed(SCHEMA_TYPE.COMMENTS, {
        taskId: t._id, projectId: t.ProjectID, message, userId: SOMEONE, type: 'text', isDeleted: false, createdAt: new Date('2026-09-01T00:00:00Z'),
    });
    const page = (title, ProjectID) => mockDb.seed(SCHEMA_TYPE.PAGES, {
        title, ProjectID, content: { html: `<p>${title} body</p>` }, createdBy: SOMEONE, visibility: 'project', deletedStatusKey: 0, updatedAt: new Date('2026-09-03T00:00:00Z'),
    });
    const entry = (Loggeduser, ProjectId, t, minutes) => mockDb.seed(SCHEMA_TYPE.TIMESHEET, {
        Loggeduser, ProjectId, TicketID: t._id, LogStartTime: Date.parse('2026-09-01T09:00:00Z') / 1000, LogTimeDuration: minutes, LogDescription: `${minutes} minutes`, billable: true,
    });

    const open = task('OPEN-1', P_OPEN, [OWNER, ADMIN, MEMBER]);
    const theirs = task('THEIRS-1', PL_SOMEONE, [SOMEONE]);
    const theirsGiven = task('THEIRS-2', PL_SOMEONE, [OWNER, ADMIN]);
    const ownerOwn = task('OWNER-1', PL_OWNER, [OWNER]);
    const adminOwn = task('ADMIN-1', PL_ADMIN, [ADMIN]);
    const chatTheirs = task('CHAT-THEIRS', CHAT, [SOMEONE, MEMBER], { mainChat: true });
    const chatOwner = task('CHAT-OWNER', CHAT, [OWNER, SOMEONE], { mainChat: true });
    comment(open, 'on the open task');
    comment(theirs, 'on their personal task');
    comment(chatTheirs, 'a message between two other people');
    comment(chatOwner, 'a message to the owner');
    fx = {
        open, theirs, theirsGiven, ownerOwn, adminOwn, chatTheirs, chatOwner,
        sprintTheirs: mockDb.seed(SCHEMA_TYPE.SPRINTS, { projectId: PL_SOMEONE, name: 'Their list', AssigneeUserId: [] }),
        pgOpen: page('open page', P_OPEN),
        pgTheirs: page('their page', PL_SOMEONE),
        pgOwner: page('owner page', PL_OWNER),
        theirTimeOnOpen: entry(SOMEONE, P_OPEN, open, 30),
        theirTimeOnList: entry(SOMEONE, PL_SOMEONE, theirs, 45),
    };
});

describe.each(PRIVILEGED)('what %s reads over MCP', (_who, uid) => {
    const ownKey = uid === OWNER ? 'OWNER-1' : 'ADMIN-1';

    it('tasks.search leaves out someone else\'s personal list and every chat', async () => {
        expect(keys(await call(uid, 'tasks.search', {}))).toEqual(['OPEN-1', ownKey].sort());
        expect(keys(await call(uid, 'tasks.search', { query: 'THEIRS' }))).toEqual([]);
        expect(keys(await call(uid, 'tasks.search', { projectId: PL_SOMEONE }))).toEqual([]);
    });

    it('tasks.next leaves out a task assigned to them in someone else\'s personal list', async () => {
        expect(keys(await call(uid, 'tasks.next', {}))).not.toContain('THEIRS-2');
        expect((await call(uid, 'tasks.next', { projectId: PL_SOMEONE })).tasks).toEqual([]);
    });

    it('task.get and comments.list answer "not found" for a task in someone else\'s personal list and for a chat, the one they are in included', async () => {
        for (const t of [fx.theirs, fx.theirsGiven, fx.chatTheirs, fx.chatOwner]) {
            expect(await call(uid, 'task.get', { taskId: t._id })).toEqual({ error: 'That task was not found. Ask the person which task they mean.' });
            expect(await call(uid, 'comments.list', { taskId: t._id })).toEqual({ error: 'That task was not found. Ask the person which task they mean.' });
        }
        const own = uid === OWNER ? fx.ownerOwn : fx.adminOwn;
        expect(await call(uid, 'task.get', { taskId: own._id })).toMatchObject({ key: ownKey });
        expect((await call(uid, 'comments.list', { taskId: fx.open._id })).comments.map((c) => c.text)).toEqual(['on the open task']);
    });

    it('projects.list, project.get, sprints.list and statuses.list leave someone else\'s personal list out', async () => {
        const own = uid === OWNER ? PL_OWNER : PL_ADMIN;
        expect((await call(uid, 'projects.list', {})).projects.map((p) => p.projectId).sort()).toEqual([P_OPEN, own].sort());
        for (const tool of ['project.get', 'sprints.list', 'statuses.list']) {
            expect(await call(uid, tool, { projectId: PL_SOMEONE })).toEqual({ error: 'That project was not found. Ask the person which project they mean.' });
        }
    });

    it('pages.search, page.get and docs.read leave out a page in someone else\'s personal list', async () => {
        expect((await call(uid, 'pages.search', {})).pages.map((p) => p.title)).not.toContain('their page');
        expect((await call(uid, 'pages.search', {})).pages.map((p) => p.title)).toContain('open page');
        expect(await call(uid, 'pages.search', { projectId: PL_SOMEONE })).toEqual({ pages: [] });
        expect(await call(uid, 'page.get', { pageId: fx.pgTheirs._id })).toEqual({ error: 'That doc was not found. Ask the person which doc they mean.' });
        expect(await call(uid, 'docs.read', { pageId: fx.pgTheirs._id })).toEqual({ error: 'That doc was not found. Ask the person which doc they mean.' });
        expect(await call(uid, 'page.get', { pageId: fx.pgOpen._id })).toMatchObject({ title: 'open page' });
    });

    it('timesheet.read leaves out the time someone else logged in their personal list', async () => {
        const out = await call(uid, 'timesheet.read', { userId: SOMEONE });
        expect(out.entries.map((e) => e.projectId)).toEqual([P_OPEN]);
        expect((await call(uid, 'timesheet.read', { userId: SOMEONE, projectId: PL_SOMEONE })).entries).toEqual([]);
    });

    it('the performance read refuses someone else\'s personal list', async () => {
        await refused(call(uid, 'performance.read', { projectId: PL_SOMEONE, from: '2026-09-01', to: '2026-09-07' }));
        expect(performanceRead.read).not.toHaveBeenCalled();
    });

    it.each([
        ['task.comment', (t) => ({ taskId: t._id, body: 'x' })],
        ['task.status.set', (t) => ({ taskId: t._id, status: 'In progress' })],
        ['comment.create', (t) => ({ taskId: t._id, text: 'x' })],
        ['timelog.create', (t) => ({ taskId: t._id, minutes: 5 })],
    ])('%s is refused on a task in someone else\'s personal list and on a chat, the one they are in included', async (tool, args) => {
        await refused(call(uid, tool, args(fx.theirs)));
        await refused(call(uid, tool, args(fx.chatTheirs)));
        await refused(call(uid, tool, args(fx.chatOwner)));
        expect(actions.perform).not.toHaveBeenCalled();
        await call(uid, tool, args(fx.open));
        expect(actions.perform).toHaveBeenCalledTimes(1);
    });

    it('task.create is refused in someone else\'s personal list', async () => {
        await refused(call(uid, 'task.create', { projectId: PL_SOMEONE, title: 'x' }));
        expect(actions.perform).not.toHaveBeenCalled();
    });

    it('a token narrowed to projects keeps to them, and gains nothing by naming someone else\'s personal list', async () => {
        tokenProjects = [P_OPEN];
        expect(keys(await call(uid, 'tasks.search', {}))).toEqual(['OPEN-1']);
        tokenProjects = [PL_SOMEONE];
        expect(keys(await call(uid, 'tasks.search', {}))).toEqual([]);
        expect(await call(uid, 'task.get', { taskId: fx.theirs._id })).toEqual({ error: 'That task was not found. Ask the person which task they mean.' });
        expect((await call(uid, 'projects.list', {})).projects).toEqual([]);
    });

    it('a delegated session is not taken up on a task they cannot open', async () => {
        expect(await sessionAccess.canOpenTask(C, uid, await sessionAccess.taskOf(C, fx.theirs._id))).toBe(false);
        expect(await sessionAccess.canOpenTask(C, uid, await sessionAccess.taskOf(C, fx.chatTheirs._id))).toBe(false);
        expect(await sessionAccess.canOpenTask(C, uid, await sessionAccess.taskOf(C, fx.chatOwner._id))).toBe(false);
        expect(await sessionAccess.canOpenTask(C, uid, await sessionAccess.taskOf(C, fx.open._id))).toBe(true);
    });
});

describe('what stays as it is', () => {
    it('the holder of a personal list reads and writes it', async () => {
        expect(keys(await call(SOMEONE, 'tasks.search', {}))).toEqual(['OPEN-1', 'THEIRS-1', 'THEIRS-2']);
        expect(await call(SOMEONE, 'task.get', { taskId: fx.theirs._id })).toMatchObject({ key: 'THEIRS-1' });
        expect((await call(SOMEONE, 'pages.search', { projectId: PL_SOMEONE })).pages.map((p) => p.title)).toEqual(['their page']);
        await call(SOMEONE, 'task.comment', { taskId: fx.theirs._id, body: 'x' });
        expect(actions.perform).toHaveBeenCalledTimes(1);
    });

    it('a member reads the projects they can open', async () => {
        expect(keys(await call(MEMBER, 'tasks.search', {}))).toEqual(['OPEN-1']);
        expect(await call(MEMBER, 'task.get', { taskId: fx.theirs._id })).toEqual({ error: 'That task was not found. Ask the person which task they mean.' });
    });
});

describe('the company-wide task rule has one meaning as a query clause and as a check on a loaded task', () => {
    const TASKS = [
        { ProjectID: P_OPEN },
        { ProjectID: PL_SOMEONE },
        { ProjectID: PL_SOMEONE, AssigneeUserId: [OWNER] },
        { ProjectID: PL_OWNER },
        { ProjectID: CHAT, mainChat: true, AssigneeUserId: [OWNER, SOMEONE] },
        { ProjectID: CHAT, mainChat: true, AssigneeUserId: [SOMEONE, MEMBER] },
        { ProjectID: CHAT, mainChat: true, AssigneeUserId: OWNER },
        { ProjectID: CHAT, mainChat: true },
        { ProjectID: CHAT, mainChat: false, AssigneeUserId: [SOMEONE] },
    ];

    it.each(TASKS.map((task) => [JSON.stringify(task), task]))('%s', (_label, task) => {
        for (const lists of [[PL_SOMEONE], []]) {
            expect(readsCompanyWide(task, OWNER, lists)).toBe(fakeMongo.matches(task, companyWideMatch(OWNER, lists)));
        }
    });

    it('refuses someone else\'s personal list and a chat the caller is not in', () => {
        expect(TASKS.map((task) => readsCompanyWide(task, OWNER, [PL_SOMEONE]))).toEqual([true, false, false, true, true, false, true, false, true]);
    });
});
