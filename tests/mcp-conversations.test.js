/* Task 047: chat is a permission of its own. A conversation is stored beside tasks and a channel beside lists, and
   no task, list or project tool lists, reads or changes either, for any person and any connection. */
process.env.STORAGE_TYPE = 'server';
const mockDb = require('./fixtures/fakeMongo').create();
const mockElsewhere = require('./fixtures/fakeMongo').create();
const mockOtherCompany = '6f00000000000000000000c2';

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => (String(companyId) === mockOtherCompany ? mockElsewhere : mockDb).crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
const mockStub = () => new Proxy({}, {
    get: (target, name) => {
        if (name === 'then' || name === '__esModule') return undefined;
        target[name] = target[name] || jest.fn(() => Promise.resolve({}));
        return target[name];
    },
});
jest.mock('../Modules/Sprints/controller', () => mockStub());
jest.mock('../Modules/Tasks/helpers/handleNotification', () => mockStub());
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => mockStub());
jest.mock('../Modules/Company/eventController', () => mockStub());
jest.mock('../Modules/Company/controller/updateCompany', () => mockStub());
jest.mock('../Modules/notification-count/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());
jest.mock('../Modules/CustomField/controller', () => mockStub());
jest.mock('../utils/planHelper', () => mockStub());
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../common-storage/common-server.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Knowledge/ingest/events', () => ({ publishCommentChanged: jest.fn(), publish: jest.fn() }));
jest.mock('../Modules/Agents/triggers', () => ({ fromComment: jest.fn(async () => null) }));
jest.mock('../Modules/Agents/proposals', () => ({ create: jest.fn(async (companyId, proposal) => ({ _id: 'proposal-1', ...proposal })) }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpManageWorld');
const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const visibility = require('../Modules/Mcp/visibility');
const server = require('../Modules/Mcp/server');

mongoHelper.getTotalSprintCount = async () => true;

const {
    CID, OWNER, ADMIN, MEMBER, OTHER, P_OPEN, S_NEXT, CHAT: DIRECT_SPACE, F, TASKS_GRANT, DOCS_GRANT, PLAIN_SCOPES, settle, ctx, withGrants, outside,
} = world;
const { seed, rows, rpcThrough } = world.create(mockDb);
const rpc = rpcThrough(server);

const CHAT_SCOPE = 'chat:read';
const MISSING = '6f0000000000000000000fff';
const TEAM_SPACE = '6f0000000000000000000c11';
const C_DIRECT = '6f0000000000000000000c20';
const C_OPEN = '6f0000000000000000000c21';
const C_SECRET = '6f0000000000000000000c22';
const BASE = 'https://hub.example.test';
const FLAGS = ['MCP_TOOLS_DATA', 'MCP_TOOLS_WORK', 'MCP_TOOLS_MANAGE', 'MCP_TOOLS_V2'];
const WRITTEN = [SCHEMA_TYPE.TASKS, SCHEMA_TYPE.COMMENTS, SCHEMA_TYPE.TIMESHEET, SCHEMA_TYPE.PAGES, SCHEMA_TYPE.SPRINTS, SCHEMA_TYPE.HISTORY];
const OF_CHAT = /Quiet word|Kept between us|scratch|leads|Team chat/;

const PEOPLE = [['an owner', OWNER], ['an admin', ADMIN], ['a member', MEMBER]];
const APP_SCOPES = [...PLAIN_SCOPES, 'time:read', 'time:write', TASKS_GRANT, DOCS_GRANT];
const CONNECTIONS = [
    ['a token without the chat permission', (uid) => withGrants(uid, [TASKS_GRANT, DOCS_GRANT])],
    ['a token with the chat permission', (uid) => withGrants(uid, [TASKS_GRANT, DOCS_GRANT, CHAT_SCOPE])],
    ['an app without the chat permission', (uid) => outside(uid, APP_SCOPES)],
    ['an app with the chat permission', (uid) => outside(uid, [...APP_SCOPES, CHAT_SCOPE])],
];
const CALLERS = PEOPLE.flatMap(([who, uid]) => CONNECTIONS.map(([how, connect]) => [`${who} through ${how}`, uid, connect]));

let fx;
let talks;

const conversation = (people, extra = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, {
    TaskName: 'Quiet word', TaskKey: '--', CompanyId: CID, ProjectID: DIRECT_SPACE, sprintId: C_DIRECT, sprintArray: { id: C_DIRECT, name: 'direct' }, mainChat: true,
    AssigneeUserId: people, watchers: people, isParentTask: true, ParentTaskId: '', deletedStatusKey: 0, TaskType: 'task', TaskTypeKey: 1,
    status: { key: 1, text: 'To Do', type: 'default_active' }, statusType: 'default_active', statusKey: 1, Task_Priority: 'MEDIUM', ...extra,
});
const said = (task, text = 'Kept between us') => mockDb.seed(SCHEMA_TYPE.COMMENTS, {
    projectId: String(task.ProjectID), sprintId: String(task.sprintId), taskId: String(task._id), userId: OTHER, type: 'text', message: text, createdAt: new Date('2026-10-01T09:00:00Z'),
});
const idOf = (row) => String(row._id);
const written = () => JSON.stringify(WRITTEN.map((type) => rows(type)));
/* Each refusal leaves an audit row of its own, at the top of an answer and on each item of a batch. */
const withoutAudit = (answer) => JSON.parse(JSON.stringify(answer, (key, value) => (key === 'auditId' ? undefined : value)));

/* Every tool that names a task, each with arguments it takes for a task the person can open. */
const TASK_READS = {
    'task.get': (taskId) => ({ taskId }),
    'comments.list': (taskId) => ({ taskId }),
    'task.history': (taskId) => ({ taskId }),
    'task.links.list': (taskId) => ({ taskId }),
    'subtasks.list': (taskId) => ({ taskId }),
    'task.relations.list': (taskId) => ({ taskId }),
    'task.lists.list': (taskId) => ({ taskId }),
    'task.fields.list': (taskId) => ({ taskId }),
    'screen.link': (taskId) => ({ screen: 'task', taskId }),
};
const TASK_WRITES = {
    'task.comment': (taskId) => ({ taskId, body: 'Noted' }),
    'comment.create': (taskId) => ({ taskId, text: 'Noted' }),
    'comment.update': (taskId) => ({ taskId, commentId: idOf(talks.line), text: 'Changed' }),
    'task.status.set': (taskId) => ({ taskId, status: 'In Progress' }),
    'task.link': (taskId) => ({ taskId, url: 'https://example.test/pr/1' }),
    'subtask.create': (taskId) => ({ taskId, title: 'A part of it' }),
    'timelog.start': (taskId) => ({ taskId }),
    'timelog.stop': (taskId) => ({ taskId }),
    'timelog.create': (taskId) => ({ taskId, minutes: 5 }),
    'task.update': (taskId) => ({ taskId, title: 'Renamed' }),
    'task.assign': (taskId) => ({ taskId, mode: 'add', userIds: [MEMBER] }),
    'task.field.set': (taskId) => ({ taskId, fieldId: F.number, value: 3 }),
    'task.move': (taskId) => ({ taskId, projectId: P_OPEN, sprintId: S_NEXT }),
    'task.archive': (taskId) => ({ taskId }),
    'task.restore': (taskId) => ({ taskId }),
    'task.tags.add': (taskId) => ({ taskId, tag: 'Bug' }),
    'task.tags.remove': (taskId) => ({ taskId, tag: 'Bug' }),
    'task.relation.add': (taskId) => ({ taskId, relatedTaskId: idOf(fx.bug), type: 'relates_to' }),
    'task.relation.remove': (taskId) => ({ taskId, relatedTaskId: idOf(fx.bug) }),
    'task.lists.add': (taskId) => ({ taskId, projectId: P_OPEN, sprintId: S_NEXT }),
    'task.lists.remove': (taskId) => ({ taskId, projectId: P_OPEN, sprintId: S_NEXT }),
    'page.create': (taskId) => ({ title: 'Notes', taskId }),
    'tasks.batch': (taskId) => ({ operations: [{ tool: 'task.comment', arguments: { taskId, body: 'Noted' } }] }),
};
/* The same task named as the other end of a link. */
const LINKED_WRITES = {
    'task.relation.add': (taskId) => ({ taskId: idOf(fx.bug), relatedTaskId: taskId, type: 'relates_to' }),
    'task.relation.remove': (taskId) => ({ taskId: idOf(fx.bug), relatedTaskId: taskId }),
};
const EVERY_CALL = [
    ...Object.entries(TASK_READS).map(([tool, args]) => [tool, args]),
    ...Object.entries(TASK_WRITES).map(([tool, args]) => [tool, args]),
    ...Object.entries(LINKED_WRITES).map(([tool, args]) => [`${tool} (as the linked task)`, args, tool]),
];

const SEARCHES = [
    ['tasks.next', () => ({})],
    ['tasks.next', () => ({ projectId: DIRECT_SPACE })],
    ['tasks.search', () => ({})],
    ['tasks.search', () => ({ query: 'Quiet' })],
    ['tasks.search', () => ({ projectId: DIRECT_SPACE })],
    ['tasks.search', () => ({ sprintId: C_DIRECT })],
    ['tasks.search', (uid) => ({ assigneeId: uid })],
    ['person.place', () => ({})],
    ['queue.list', () => ({})],
    ['projects.list', () => ({})],
];

beforeEach(() => {
    jest.clearAllMocks();
    fx = seed();
    FLAGS.forEach((flag) => { process.env[flag] = 'on'; });
    process.env.WEBURL = BASE;
    mockDb.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: TEAM_SPACE, default: false, ProjectName: 'Team chat' });
    const channel = (_id, name, projectId, extra = {}) => mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id, name, projectId, deletedStatusKey: 0, ...extra });
    channel(C_DIRECT, 'direct', DIRECT_SPACE);
    channel(C_OPEN, 'scratch', TEAM_SPACE);
    channel(C_SECRET, 'leads', TEAM_SPACE, { private: true, AssigneeUserId: [OTHER] });
    const own = Object.fromEntries(PEOPLE.map(([, uid]) => [uid, conversation([uid, OTHER])]));
    talks = { own, line: null };
    Object.values(own).forEach((task) => { talks.line = said(task); });
    said(fx.chat);
    PEOPLE.forEach(([, uid]) => {
        mockDb.seed(SCHEMA_TYPE.RECENTVISITS, { userId: uid, entityType: 'task', entityId: idOf(own[uid]), visitedAt: new Date() });
        mockDb.seed(SCHEMA_TYPE.RECENTVISITS, { userId: uid, entityType: 'sprint', entityId: C_OPEN, visitedAt: new Date() });
        mockDb.seed(SCHEMA_TYPE.RECENTVISITS, { userId: uid, entityType: 'project', entityId: TEAM_SPACE, visitedAt: new Date() });
    });
    Object.keys(mockElsewhere.store).forEach((type) => { mockElsewhere.store[type].length = 0; });
    mockElsewhere.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
});
afterEach(settle);
afterAll(() => [...FLAGS, 'WEBURL'].forEach((key) => { delete process.env[key]; }));

describe('the calls below are ones a task takes', () => {
    it.each(EVERY_CALL)('%s reaches a task its person can open', async (name, args, tool = name.split(' ')[0]) => {
        const answer = JSON.stringify(await rpc(withGrants(OWNER, [TASKS_GRANT, DOCS_GRANT]), tool, args(idOf(fx.top))));
        expect(answer).not.toMatch(/rpcError|not found|not_visible|lacks the/);
    });
});

describe('a conversation is not a task', () => {
    describe.each(CALLERS)('%s', (_who, uid, connect) => {
        const targets = () => ({ 'they are in': idOf(talks.own[uid]), 'between two other people': idOf(fx.chat) });

        it.each(EVERY_CALL)('%s answers for a conversation exactly as for a task that does not exist, and changes nothing', async (name, args, tool = name.split(' ')[0]) => {
            const missing = await rpc(connect(uid), tool, args(MISSING));
            for (const taskId of Object.values(targets())) {
                const before = written();
                const answer = await rpc(connect(uid), tool, args(taskId));
                expect(withoutAudit(answer)).toEqual(withoutAudit(missing));
                expect(JSON.stringify(answer)).not.toMatch(OF_CHAT);
                expect(written()).toBe(before);
            }
        });

        it.each(SEARCHES)('%s %#, lists no conversation and no chat space', async (tool, args) => {
            const answer = JSON.stringify(await rpc(connect(uid), tool, args(uid)));
            expect(answer).not.toMatch(/rpcError/);
            expect(answer).not.toMatch(OF_CHAT);
            [...Object.values(targets()), DIRECT_SPACE, TEAM_SPACE, C_DIRECT].forEach((id) => expect(answer).not.toContain(id));
        });
    });

    it.each(PEOPLE)('%s whose token is kept to the space conversations sit in reads none of them', async (_who, uid) => {
        const kept = withGrants(uid, [TASKS_GRANT, DOCS_GRANT, CHAT_SCOPE]);
        kept.projectIds = [DIRECT_SPACE];
        const taskId = idOf(talks.own[uid]);
        expect(await rpc(kept, 'task.get', { taskId })).toEqual(await rpc(kept, 'task.get', { taskId: MISSING }));
        expect(JSON.stringify(await rpc(kept, 'tasks.search', {}))).not.toMatch(OF_CHAT);
        expect(await rpc(kept, 'task.comment', { taskId, body: 'Noted' })).toMatchObject({ refused: true });
    });

    it('a conversation with an agent is one too', async () => {
        const withAgent = conversation([OWNER], { agentId: '6f0000000000000000000a91', agentName: 'Helper' });
        said(withAgent);
        const caller = withGrants(OWNER, [TASKS_GRANT, DOCS_GRANT, CHAT_SCOPE]);
        expect(await rpc(caller, 'task.get', { taskId: idOf(withAgent) })).toEqual({ error: 'task not found' });
        expect(await rpc(caller, 'task.comment', { taskId: idOf(withAgent), body: 'Noted' })).toMatchObject({ refused: true, reason: expect.stringMatching(/^not_visible/) });
    });

    it('the tools that read the two older ways list none either', async () => {
        delete process.env.MCP_TOOLS_V2;
        for (const [, uid] of PEOPLE) {
            const caller = ctx(uid);
            const answer = JSON.stringify([await rpc(caller, 'tasks.next', {}), await rpc(caller, 'tasks.search', { query: 'Quiet' }), await rpc(caller, 'task.get', { taskId: idOf(talks.own[uid]) })]);
            expect(answer).not.toMatch(OF_CHAT);
        }
    });

    it('another company reads nothing of it', async () => {
        const other = withGrants(OWNER, [TASKS_GRANT, DOCS_GRANT, CHAT_SCOPE]);
        other.companyId = mockOtherCompany;
        const taskId = idOf(talks.own[OWNER]);
        expect(await rpc(other, 'task.get', { taskId })).toEqual({ error: 'task not found' });
        expect(await rpc(other, 'comments.list', { taskId })).toEqual({ error: 'task not found' });
        expect(JSON.stringify(await rpc(other, 'tasks.search', {}))).not.toMatch(OF_CHAT);
        expect(await rpc(other, 'task.comment', { taskId, body: 'Noted' })).toMatchObject({ refused: true });
    });

    it.each(PEOPLE)('the filter of %s matches no conversation, whoever is in it', async (_who, uid) => {
        const vis = await visibility.forCaller(ctx(uid));
        Object.values(talks.own).concat(fx.chat).forEach((task) => expect(vis.allowsTask(task)).toBe(false));
        expect(vis.allowsTask(fx.top)).toBe(true);
        const listed = await mockDb.crud(CID, { type: SCHEMA_TYPE.TASKS, data: [{ deletedStatusKey: { $ne: 1 }, ...vis.taskClause() }] }, 'find');
        expect(listed.length).toBeGreaterThan(0);
        expect(listed.filter((task) => task.mainChat === true)).toEqual([]);
    });
});

describe('a channel is not a list, and a chat space is not a project', () => {
    const PLACE_READS = [
        ['project.get', (projectId) => ({ projectId })],
        ['sprints.list', (projectId) => ({ projectId })],
        ['statuses.list', (projectId) => ({ projectId })],
        ['lists.list', (projectId) => ({ projectId })],
        ['tags.list', (projectId) => ({ projectId })],
        ['fields.list', (projectId) => ({ projectId })],
        ['members.list', (projectId) => ({ projectId })],
        ['workdays.get', (projectId) => ({ projectId })],
        ['screen.link', (projectId) => ({ screen: 'project', projectId })],
        ['screen.link', (projectId, sprintId) => ({ screen: 'list', sprintId })],
        ['tasks.search', (projectId, sprintId) => ({ sprintId })],
    ];
    const PLACE_WRITES = [
        ['task.create', (projectId, sprintId) => ({ projectId, sprintId, title: 'Filed in chat' })],
        ['task.move', (projectId, sprintId) => ({ taskId: idOf(fx.top), projectId, sprintId })],
        ['task.lists.add', (projectId, sprintId) => ({ taskId: idOf(fx.bug), projectId, sprintId })],
        ['list.create', (projectId) => ({ projectId, name: 'Filed in chat' })],
        ['list.rename', (projectId, sprintId) => ({ projectId, sprintId, name: 'Renamed' })],
        ['list.move', (projectId, sprintId) => ({ projectId, sprintId, folderId: null })],
        ['page.create', (projectId) => ({ title: 'Notes', projectId })],
    ];
    const PLACES = [
        ['the channel they are in', TEAM_SPACE, C_OPEN],
        ['a channel they are not in', TEAM_SPACE, C_SECRET],
        ['the space direct messages sit in', DIRECT_SPACE, C_DIRECT],
    ];

    describe.each(CALLERS)('%s', (_who, uid, connect) => {
        it.each(PLACES)('%s is named by no project or list read', async (_which, projectId, sprintId) => {
            for (const [tool, args] of PLACE_READS) {
                const answer = JSON.stringify(await rpc(connect(uid), tool, args(projectId, sprintId)));
                expect(answer).not.toMatch(/rpcError/);
                expect(answer).not.toMatch(OF_CHAT);
                expect(answer).not.toMatch(/direct/);
            }
        });

        it.each(PLACES)('%s takes no task, list or doc', async (_which, projectId, sprintId) => {
            const before = written();
            for (const [tool, args] of PLACE_WRITES) {
                const answer = await rpc(connect(uid), tool, args(projectId, sprintId));
                expect(answer).toMatchObject({ refused: true });
                expect(JSON.stringify(answer)).not.toMatch(OF_CHAT);
            }
            expect(written()).toBe(before);
        });
    });
});
