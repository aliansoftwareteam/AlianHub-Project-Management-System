/* Task 047, T-2: naming your own connected AI with "@" in chat. Who is offered it, what a message that names it
   leaves in that AI's work queue, who is given the question, and what holds it or takes it out again. */
process.env.STORAGE_TYPE = 'server';
const mockDb = require('./fixtures/fakeMongo').create();
const mockGetProvider = jest.fn(() => { throw new Error('no model is set up'); });

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
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
jest.mock('../Modules/Company/controller/updateCompany', () => ({ getCompanyDataFun: jest.fn(async () => [mockDb.store.companies[0]]) }));
jest.mock('../Modules/notification-count/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());
jest.mock('../Modules/CustomField/controller', () => mockStub());
jest.mock('../utils/planHelper', () => mockStub());
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../common-storage/common-server.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Knowledge/ingest/events', () => ({ publishCommentChanged: jest.fn(), publish: jest.fn() }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider', () => ({ isAnyProviderConfigured: () => false, getProvider: (...args) => mockGetProvider(...args) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { runForAgentOf } = require('../Config/agentRequest');
const socketEmitter = require('../event/socketEventEmitter');
const world = require('./fixtures/mcpManageWorld');
const findings = require('../Modules/Agents/manager/findings');
const workQueue = require('../Modules/Agents/manager/workQueue');
const accounts = require('../Modules/Agents/accounts');
const controller = require('../Modules/Agents/manager/controller');
const commentsCtrl = require('../Modules/Comments/controller');
const { parseMentionIds, parseAgentMentionIds } = require('../Modules/Comments/helpers/parseMentions');
const server = require('../Modules/Mcp/server');
const { projectFindingsSchema, commentSchema } = require('../utils/mongo-handler/createSchema');

const { CID, OWNER, MEMBER, OTHER, OUTSIDER, TOKEN, P_OPEN, P_DEST, S_OPEN, CHAT: DIRECT_SPACE, TASKS_GRANT, settle } = world;
const { seed, rows, rpcThrough } = world.create(mockDb);
const rpc = rpcThrough(server);
const GUEST = OUTSIDER;
const { ASKED_IN_CHAT, HANDED_OVER, LEFT } = findings;
const CHAT_SCOPE = 'chat:read';
const TEAM_SPACE = '6f0000000000000000000c11';
const C_DIRECT = '6f0000000000000000000c20';
const C_OPEN = '6f0000000000000000000c21';
const C_SECRET = '6f0000000000000000000c22';
const HELPER = '6f0000000000000000000a01';
const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const PEOPLE = [SCHEMA_TYPE.COMPANY_USERS, SCHEMA_TYPE.USERS, SCHEMA_TYPE.API_TOKENS, SCHEMA_TYPE.OAUTH_GRANTS];
const OTHERS_WORDS = /Kept between us|Budget is 40k/;

const agent = (uid, grants = [TASKS_GRANT], over = {}) => world.ctx(uid, {
    actor: { kind: 'agent', userId: uid, agentName: 'Claude', viaAccount: 'personal', tokenId: TOKEN },
    token: { _id: TOKEN, userId: uid, scopes: ['read', 'write'], grants, active: true },
    ...over,
});

const connect = (userId, over = {}) => mockDb.seed(SCHEMA_TYPE.API_TOKENS, {
    name: 'Claude Code', tokenHash: `hash-${userId}`, prefix: 'ahp_abc', userId, active: true, kind: 'agent', projectIds: [],
    lastUsedAt: new Date(Date.now() - MINUTE), expiresAt: new Date(Date.now() + 30 * DAY), agentAccount: { mode: 'personal', provider: 'Claude' }, ...over,
});

const project = (id) => rows(SCHEMA_TYPE.PROJECTS).find((row) => String(row._id) === String(id));
const seat = (uid) => rows(SCHEMA_TYPE.COMPANY_USERS).find((row) => String(row.userId) === String(uid));
const asked = () => rows(SCHEMA_TYPE.PROJECT_FINDINGS).filter((row) => row.rule === ASKED_IN_CHAT);
const message = (id) => rows(SCHEMA_TYPE.COMMENTS).find((row) => String(row._id) === String(id));
const snapshot = (types) => JSON.stringify(types.map((type) => rows(type)));
const mine = (uid) => `@[Claude](myai_${uid})`;

const inProject = { projectId: P_OPEN, sprintId: S_OPEN, taskId: 'default' };
const inSpace = { projectId: TEAM_SPACE, sprintId: C_OPEN, taskId: 'default' };
const inSecret = { projectId: TEAM_SPACE, sprintId: C_SECRET, taskId: 'default' };
const conversation = (people, extra = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, {
    TaskName: 'Quiet word', TaskKey: '--', CompanyId: CID, ProjectID: DIRECT_SPACE, sprintId: C_DIRECT, sprintArray: { id: C_DIRECT, name: 'direct' }, mainChat: true,
    AssigneeUserId: people, watchers: people, isParentTask: true, ParentTaskId: '', deletedStatusKey: 0, TaskType: 'task', TaskTypeKey: 1,
    status: { key: 1, text: 'To Do', type: 'default_active' }, statusType: 'default_active', statusKey: 1, Task_Priority: 'MEDIUM', ...extra,
});
const direct = (task) => ({ projectId: DIRECT_SPACE, sprintId: C_DIRECT, taskId: String(task._id) });
const said = (thread, userId, text) => mockDb.seed(SCHEMA_TYPE.COMMENTS, { ...thread, userId, type: 'text', message: text, createdAt: new Date('2026-10-01T09:00:00Z') });

const through = async (handlers, req) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(sent) { this.body = sent; return this; }, send(sent) { this.body = sent; return this; }, on() {} };
    for (const handler of [].concat(handlers)) {
        let passed = false;
        // eslint-disable-next-line no-await-in-loop
        await handler(req, res, () => { passed = true; });
        if (!passed) break;
    }
    await settle();
    return { code: res.statusCode, body: res.body };
};
const request = (uid, method, path, extra = {}) => ({ uid, method, originalUrl: path, url: path, headers: { companyid: CID }, params: {}, query: {}, body: {}, ip: '1.1.1.1', ...extra });
const shown = (uid, extra) => through(controller.getConnectedAgents, request(uid, 'GET', '/api/v2/agents/connected', extra));
const offered = async (uid, thread) => (await shown(uid, { query: thread })).body.data;
const post = async (uid, thread, text, extra = {}) => {
    const sent = await through(commentsCtrl.save, request(uid, 'POST', '/api/v1/comments', {
        ...extra,
        body: { data: {
            message: text, type: 'text', project: false, userId: uid, ...(thread.taskId === 'default' ? { taskId: 'default' } : {}), ...(extra.data || {}),
            objId: { projectId: thread.projectId, sprintId: thread.sprintId, ...(thread.taskId === 'default' ? {} : { taskId: thread.taskId }) },
        } },
    }));
    expect(sent.code).toBe(200);
    return sent.body;
};
const ask = async (uid, thread, text = 'what is left for the launch?') => String((await post(uid, thread, `${mine(uid)} ${text}`)).data._id);
const listed = async (caller, args = {}) => (await rpc(caller, 'queue.list', args)).items;
const questions = async (caller, args) => (await listed(caller, args)).filter((item) => item.kind === ASKED_IN_CHAT);
const claim = (caller, itemId) => rpc(caller, 'queue.claim', { itemId });

beforeAll(() => mockDb.uniqueFromSchema(SCHEMA_TYPE.PROJECT_FINDINGS, projectFindingsSchema));

beforeEach(() => {
    jest.clearAllMocks();
    seed();
    process.env.MCP_TOOLS_WORK = 'on';
    process.env.MCP_TOOLS_DATA = 'on';
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: GUEST, roleType: 0, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: TEAM_SPACE, default: false, ProjectName: 'Team chat' });
    const channel = (_id, name, projectId, extra = {}) => mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id, name, projectId, deletedStatusKey: 0, ...extra });
    channel(C_DIRECT, 'direct', DIRECT_SPACE);
    channel(C_OPEN, 'scratch', TEAM_SPACE);
    channel(C_SECRET, 'leads', TEAM_SPACE, { private: true, AssigneeUserId: [OTHER] });
});
afterEach(settle);
afterAll(() => { delete process.env.MCP_TOOLS_WORK; delete process.env.MCP_TOOLS_DATA; delete process.env.MCP_TOOLS_MANAGE; });

describe('the fields this keeps', () => {
    it('are declared, so a strict schema does not drop them', () => {
        expect(commentSchema.path('ownAiAsk')).toBeDefined();
        ['userId', 'facts', 'claim', 'leftQueue'].forEach((field) => expect(projectFindingsSchema.path(field)).toBeDefined());
    });
});

describe('who is offered their own AI in a chat conversation', () => {
    it('offers the person their own AI, named as the member list names it, in a channel and in a conversation they are in', async () => {
        connect(MEMBER);
        const talk = conversation([MEMBER, OTHER]);
        const [onMembersPage] = (await shown(MEMBER)).body.data;
        for (const thread of [inProject, inSpace, direct(talk)]) {
            // eslint-disable-next-line no-await-in-loop
            expect(await offered(MEMBER, thread)).toEqual([onMembersPage]);
        }
        expect(onMembersPage).toMatchObject({ ownerId: MEMBER, name: 'Claude', shownAs: 'Claude, for Mia Member', mine: true });
    });

    it('offers nobody another person\'s AI, and a guest none', async () => {
        connect(MEMBER);
        connect(GUEST);
        const withGuest = conversation([MEMBER, GUEST]);
        expect(await offered(OTHER, inProject)).toEqual([]);
        expect(await offered(OWNER, inSpace)).toEqual([]);
        expect(await offered(GUEST, direct(withGuest))).toEqual([]);
        expect(await offered('6f0000000000000000000fff', inProject)).toEqual([]);
    });

    it('offers none where the person cannot write, on a task, or in a conversation with an in-product agent', async () => {
        connect(MEMBER);
        const others = conversation([OTHER, OWNER]);
        const withAgent = conversation([MEMBER], { agentId: HELPER, agentName: 'Helper' });
        const task = rows(SCHEMA_TYPE.TASKS).find((row) => row.TaskKey === 'OPN-1');
        expect(await offered(MEMBER, inSecret)).toEqual([]);
        expect(await offered(MEMBER, direct(others))).toEqual([]);
        expect(await offered(MEMBER, direct(withAgent))).toEqual([]);
        expect(await offered(MEMBER, { projectId: P_OPEN, sprintId: S_OPEN, taskId: String(task._id) })).toEqual([]);
        expect(await offered(MEMBER, { projectId: P_OPEN, sprintId: P_DEST, taskId: 'default' })).toEqual([]);
        expect(await offered(MEMBER, { projectId: { $ne: '' }, sprintId: S_OPEN, taskId: 'default' })).toEqual([]);
    });

    it('leaves out a connection that is kept to other projects, and chat outside every project for one kept to some', async () => {
        const token = connect(MEMBER, { projectIds: [P_DEST] });
        const talk = conversation([MEMBER, OTHER]);
        expect(await offered(MEMBER, inProject)).toEqual([]);
        token.projectIds = [P_OPEN];
        expect(await offered(MEMBER, inProject)).toHaveLength(1);
        expect(await offered(MEMBER, inSpace)).toEqual([]);
        expect(await offered(MEMBER, direct(talk))).toEqual([]);
    });

    it('is not given to an API token', async () => {
        connect(MEMBER);
        expect(await shown(MEMBER, { query: inProject, apiToken: { _id: TOKEN, userId: MEMBER, name: 'Script' } })).toMatchObject({ code: 403 });
    });
});

describe('a message that names your own AI', () => {
    it('waits in that AI\'s work queue with its text, where it was asked and who asked', async () => {
        connect(MEMBER);
        const messageId = await ask(MEMBER, inProject);
        expect(asked()).toMatchObject([{ status: 'open', rule: ASKED_IN_CHAT, userId: MEMBER, taskIds: [], facts: { messageId } }]);
        const [item] = await listed(agent(MEMBER));
        expect(item).toMatchObject({
            itemId: String(asked()[0]._id), kind: ASKED_IN_CHAT, messageId, question: '@Claude what is left for the launch?',
            askedBy: { id: MEMBER, name: 'Mia Member' }, where: { kind: 'channel', channelId: S_OPEN, channel: 'Sprint 1', projectId: P_OPEN, project: 'Open' },
        });
        expect(item.taskId).toBeUndefined();
    });

    it('marks the message as asked, for everyone who reads the conversation', async () => {
        connect(MEMBER);
        const messageId = await ask(MEMBER, inSpace);
        expect(message(messageId).ownAiAsk).toMatchObject({ ownerId: MEMBER, name: 'Claude, for Mia Member', at: expect.any(Date) });
        const sent = socketEmitter.emit.mock.calls.filter(([type, event]) => type === 'update' && event.module === 'comments');
        expect(sent).toHaveLength(1);
        expect(sent[0][1]).toMatchObject({ companyId: CID, data: { _id: messageId, ownAiAsk: { name: 'Claude, for Mia Member' } } });
    });

    it('calls no model, starts no run and adds no person', async () => {
        connect(MEMBER);
        const before = snapshot(PEOPLE);
        const sent = await post(MEMBER, inProject, `${mine(MEMBER)} can you check the dates?`);
        expect(sent.agents).toBeUndefined();
        expect(sent.ai).toBeUndefined();
        expect(mockGetProvider).not.toHaveBeenCalled();
        expect(rows(SCHEMA_TYPE.AGENT_RUNS)).toEqual([]);
        expect(snapshot(PEOPLE)).toBe(before);
        expect(message(sent.data._id).mentionIds).toEqual([]);
        expect(parseMentionIds(sent.data.message)).toEqual([]);
        expect(parseAgentMentionIds(sent.data.message)).toEqual([]);
    });

    it('comes before the tasks handed over, and is asked once however often the queue is read', async () => {
        connect(MEMBER);
        project(P_OPEN).agentManager = { on: true };
        const task = rows(SCHEMA_TYPE.TASKS).find((row) => row.TaskKey === 'OPN-1');
        await workQueue.handOver(CID, MEMBER, String(task._id), new Date(), { to: MEMBER });
        await ask(MEMBER, inProject);
        await listed(agent(MEMBER));
        expect((await listed(agent(MEMBER))).map((item) => item.kind)).toEqual([ASKED_IN_CHAT, HANDED_OVER]);
        expect(asked()).toHaveLength(1);
    });

    it('does nothing when another person names it, when it is someone else\'s, or when the person has none', async () => {
        connect(MEMBER);
        const stranger = await post(OTHER, inProject, `${mine(MEMBER)} do this for me`);
        const theirs = await post(MEMBER, inProject, `${mine(OTHER)} not mine`);
        const person = await post(MEMBER, inProject, `@[Priya Other](${OTHER}) a person`);
        const none = await post(OWNER, inProject, `${mine(OWNER)} nothing is connected`);
        expect(asked()).toEqual([]);
        [stranger, theirs, person, none].forEach((sent) => expect(message(sent.data._id).ownAiAsk).toBeUndefined());
        expect(await listed(agent(MEMBER))).toEqual([]);
        expect(await listed(agent(OTHER))).toEqual([]);
    });

    it('does nothing for a guest, for a message sent with a token or by an agent, or for a mark the sender wrote itself', async () => {
        connect(MEMBER);
        connect(GUEST);
        const withGuest = conversation([MEMBER, GUEST]);
        await post(GUEST, direct(withGuest), `${mine(GUEST)} a guest`);
        await post(MEMBER, inProject, `${mine(MEMBER)} from a script`, { apiToken: { _id: TOKEN, kind: 'agent', userId: MEMBER, name: 'CLI' } });
        await post(MEMBER, inProject, `${mine(MEMBER)} from a tool`, { mcp: true });
        const forged = await post(MEMBER, inProject, 'no name here', { data: { ownAiAsk: { ownerId: OTHER, name: 'Claude, for Priya Other' } } });
        expect(asked()).toEqual([]);
        expect(message(forged.data._id).ownAiAsk).toBeUndefined();
    });

    it('does nothing on a task: there the task itself is handed over', async () => {
        connect(MEMBER);
        const task = rows(SCHEMA_TYPE.TASKS).find((row) => row.TaskKey === 'OPN-1');
        await post(MEMBER, { projectId: P_OPEN, sprintId: S_OPEN, taskId: String(task._id) }, `${mine(MEMBER)} please`);
        expect(asked()).toEqual([]);
    });
});

describe('who is given the question', () => {
    it('is that person\'s AI and nobody else\'s, to list and to take', async () => {
        connect(MEMBER);
        connect(OTHER);
        connect(OWNER);
        await ask(MEMBER, inProject);
        const itemId = String(asked()[0]._id);
        expect(await questions(agent(MEMBER))).toHaveLength(1);
        expect(await questions(agent(OTHER))).toEqual([]);
        expect(await questions(agent(OWNER))).toEqual([]);
        expect(await claim(agent(OTHER), itemId)).toMatchObject({ ok: false, error: workQueue.REFUSAL.NO_ITEM });
        expect(await claim(agent(OWNER), itemId)).toMatchObject({ ok: false, error: workQueue.REFUSAL.NO_ITEM });
        expect(asked()[0].claim).toBeUndefined();
        expect(asked()[0].status).toBe('open');
        expect(await questions(agent(MEMBER))).toHaveLength(1);
    });

    it('is no person: it is on no list of findings and cannot be taken back as an item', async () => {
        connect(MEMBER);
        project(P_OPEN).agentManager = { on: true };
        await ask(MEMBER, inProject);
        const itemId = String(asked()[0]._id);
        expect(await findings.visibleTo(CID, OWNER, P_OPEN)).toEqual([]);
        expect(await findings.visibleTo(CID, MEMBER, P_OPEN)).toEqual([]);
        expect(await findings.standing(CID, P_OPEN, [])).toEqual([]);
        expect(await workQueue.takeBack(CID, MEMBER, itemId)).toMatchObject({ status: 404 });
        expect(await workQueue.takeBack(CID, OWNER, itemId)).toMatchObject({ status: 404 });
        expect(await workQueue.heldTasks(CID, OWNER)).toEqual([]);
    });

    it('is taken and finished like any item, and then it is gone', async () => {
        connect(MEMBER);
        await ask(MEMBER, inProject);
        const itemId = String(asked()[0]._id);
        expect(await claim(agent(MEMBER), itemId)).toMatchObject({ ok: true, result: { itemId } });
        expect(await listed(agent(MEMBER))).toMatchObject([{ itemId, yours: true }]);
        expect(await rpc(agent(MEMBER), 'queue.release', { itemId, finished: true })).toMatchObject({ ok: true, result: { finished: true } });
        expect(asked()).toMatchObject([{ status: 'closed', leftQueue: { why: LEFT.FINISHED } }]);
        expect(await listed(agent(MEMBER))).toEqual([]);
    });

    it('asked in a conversation, takes the AI\'s one hand and no project\'s place', async () => {
        connect(MEMBER);
        const talk = conversation([MEMBER, OTHER]);
        await ask(MEMBER, direct(talk));
        await ask(MEMBER, inProject, 'and the budget?');
        const [first, second] = asked().map((row) => String(row._id));
        expect(await claim(agent(MEMBER), first)).toMatchObject({ ok: true });
        const places = () => rows(SCHEMA_TYPE.AGENT_WORK_MARKS).filter((mark) => mark.by && String(mark.scope).startsWith('place:'));
        expect(places()).toEqual([]);
        expect(await claim(agent(MEMBER), second)).toMatchObject({ isError: true, error: workQueue.REFUSAL.ONE_AT_A_TIME });
        await rpc(agent(MEMBER), 'queue.release', { itemId: first, finished: true });
        expect(await claim(agent(MEMBER), second)).toMatchObject({ ok: true });
        expect(places()).toMatchObject([{ scope: `place:${P_OPEN}`, ref: second }]);
    });
});

describe('while the person can still open the conversation', () => {
    it('gives a conversation\'s question to the AI of a person in it, and to no one else\'s', async () => {
        connect(MEMBER);
        connect(OTHER);
        connect(OWNER);
        const talk = conversation([MEMBER, OTHER]);
        said(direct(talk), OTHER, 'Kept between us');
        const messageId = await ask(MEMBER, direct(talk), 'what did we agree?');
        const [item] = await listed(agent(MEMBER, [TASKS_GRANT, CHAT_SCOPE]));
        expect(item).toMatchObject({ kind: ASKED_IN_CHAT, messageId, question: '@Claude what did we agree?', where: { kind: 'conversation' } });
        const answer = JSON.stringify(item);
        expect(answer).not.toMatch(OTHERS_WORDS);
        [String(talk._id), DIRECT_SPACE, C_DIRECT].forEach((id) => expect(answer).not.toContain(id));
        expect(await listed(agent(OTHER, [TASKS_GRANT, CHAT_SCOPE]))).toEqual([]);
        expect(await listed(agent(OWNER, [TASKS_GRANT, CHAT_SCOPE]))).toEqual([]);
    });

    it('stops when the person leaves the conversation or loses the channel, and comes back with them', async () => {
        connect(MEMBER);
        const talk = conversation([MEMBER, OTHER]);
        await ask(MEMBER, direct(talk));
        await ask(MEMBER, inSpace);
        expect(await listed(agent(MEMBER))).toHaveLength(2);

        const stored = rows(SCHEMA_TYPE.TASKS).find((row) => String(row._id) === String(talk._id));
        const channel = rows(SCHEMA_TYPE.SPRINTS).find((row) => String(row._id) === C_OPEN);
        stored.AssigneeUserId = [OTHER];
        Object.assign(channel, { private: true, AssigneeUserId: [OTHER] });
        expect(await listed(agent(MEMBER))).toEqual([]);
        for (const row of asked()) {
            // eslint-disable-next-line no-await-in-loop
            expect(await claim(agent(MEMBER), String(row._id))).toMatchObject({ ok: false, error: workQueue.REFUSAL.NO_ITEM });
        }
        expect(asked().map((row) => row.status)).toEqual(['open', 'open']);

        stored.AssigneeUserId = [MEMBER, OTHER];
        expect(await listed(agent(MEMBER))).toHaveLength(1);
    });

    it('asks the person\'s own rule, so it holds inside the AI\'s own request too', async () => {
        connect(MEMBER);
        const talk = conversation([MEMBER, OTHER]);
        await ask(MEMBER, direct(talk));
        await ask(MEMBER, inSpace);
        const inside = await runForAgentOf(MEMBER, { chat: false }, () => listed(agent(MEMBER)));
        expect(inside.map((item) => item.where.kind)).toEqual(['conversation', 'channel']);
    });

    it('gives the question itself without the chat permission, and no other message with or without it', async () => {
        connect(MEMBER);
        said(inSpace, OTHER, 'Budget is 40k');
        await ask(MEMBER, inSpace, 'is the budget settled?');
        const [plain] = await listed(agent(MEMBER));
        const [withChat] = await listed(agent(MEMBER, [TASKS_GRANT, CHAT_SCOPE]));
        expect(plain).toMatchObject({ question: '@Claude is the budget settled?', where: { kind: 'channel', channelId: C_OPEN, channel: 'scratch', space: 'Team chat' } });
        expect(plain.around).toMatch(/not allowed to read chat/);
        expect(withChat.around).toMatch(/chat\.messages\.list/);
        expect(withChat.question).toBe(plain.question);
        [plain, withChat].forEach((item) => expect(JSON.stringify(item)).not.toMatch(OTHERS_WORDS));
        expect(JSON.stringify(await rpc(agent(MEMBER), 'chat.messages.list', { channelId: C_OPEN }))).not.toMatch(OTHERS_WORDS);
    });

    it('keeps a connection inside its own limits: chat outside every project is not for one kept to some projects', async () => {
        connect(MEMBER);
        const talk = conversation([MEMBER, OTHER]);
        await ask(MEMBER, direct(talk));
        await ask(MEMBER, inSpace);
        await ask(MEMBER, inProject);
        const where = async (projectIds) => (await listed(agent(MEMBER, [TASKS_GRANT], { projectIds }))).map((item) => item.where.projectId || item.where.kind);
        expect(await where([])).toEqual(['conversation', 'channel', P_OPEN]);
        expect(await where([P_OPEN])).toEqual([P_OPEN]);
        expect(await where([P_DEST])).toEqual([]);
        const elsewhere = asked().find((row) => String(row.projectId) === P_OPEN);
        expect(await claim(agent(MEMBER, [TASKS_GRANT], { projectIds: [P_DEST] }), String(elsewhere._id))).toMatchObject({ ok: false, error: workQueue.REFUSAL.NO_ITEM });
    });
});

describe('what holds a question', () => {
    it('is a pause in the project it was asked in, which holds no question asked elsewhere', async () => {
        connect(MEMBER);
        const talk = conversation([MEMBER, OTHER]);
        await ask(MEMBER, inProject);
        await ask(MEMBER, direct(talk));
        const inPaused = asked().find((row) => String(row.projectId) === P_OPEN);
        project(P_OPEN).agentLimits = { paused: true };
        expect((await listed(agent(MEMBER))).map((item) => item.where.kind)).toEqual(['conversation']);
        expect(JSON.stringify(await claim(agent(MEMBER), String(inPaused._id)))).toMatch(/agents are paused in this project/);
        expect(inPaused.claim).toBeUndefined();
        project(P_OPEN).agentLimits = { paused: false };
        expect(await listed(agent(MEMBER))).toHaveLength(2);
    });

    it('is a pause of the workspace\'s connected agents, which holds them all', async () => {
        connect(MEMBER);
        const talk = conversation([MEMBER, OTHER]);
        await ask(MEMBER, inProject);
        await ask(MEMBER, direct(talk));
        await accounts.setPolicy(CID, { connectedPaused: true }, OWNER);
        expect(await listed(agent(MEMBER))).toEqual([]);
        for (const row of asked()) {
            // eslint-disable-next-line no-await-in-loop
            expect(JSON.stringify(await claim(agent(MEMBER), String(row._id)))).toMatch(/connected agents are paused in this workspace/);
        }
        await accounts.setPolicy(CID, { connectedPaused: false }, OWNER);
        expect(await listed(agent(MEMBER))).toHaveLength(2);
    });
});

describe('what takes a question out of the queue', () => {
    it('is the end of the connection: the person\'s next look at chat removes what waited for it', async () => {
        const token = connect(MEMBER);
        await ask(MEMBER, inProject);
        await ask(MEMBER, inSpace);
        token.active = false;
        expect(await offered(MEMBER, inProject)).toEqual([]);
        expect(asked().map((row) => [row.status, row.leftQueue.why])).toEqual([['closed', LEFT.WITHDRAWN], ['closed', LEFT.WITHDRAWN]]);
        token.active = true;
        expect(await listed(agent(MEMBER))).toEqual([]);
    });

    it('is never handed to a connection made after it was asked', async () => {
        const old = connect(MEMBER, { createdAt: new Date(Date.now() - DAY) });
        await ask(MEMBER, inProject);
        old.active = false;
        connect(MEMBER, { createdAt: new Date(Date.now() + MINUTE), tokenHash: 'hash-new' });
        expect(await listed(agent(MEMBER))).toEqual([]);
        expect(asked()).toMatchObject([{ status: 'closed', leftQueue: { why: LEFT.WITHDRAWN } }]);
    });

    it('is the person leaving the workspace', async () => {
        connect(MEMBER);
        await ask(MEMBER, inProject);
        seat(MEMBER).isDelete = true;
        expect(await workQueue.itemsFor({ companyId: CID, uid: MEMBER, connection: `token:${TOKEN}` })).toEqual([]);
        expect(asked()).toMatchObject([{ status: 'closed', leftQueue: { why: LEFT.WITHDRAWN } }]);
    });

    it('is the message being deleted, or no longer naming the AI', async () => {
        connect(MEMBER);
        const deleted = await ask(MEMBER, inProject);
        const reworded = await ask(MEMBER, inSpace);
        message(deleted).isDeleted = true;
        message(reworded).message = 'never mind';
        expect(await listed(agent(MEMBER))).toEqual([]);
        expect(asked().map((row) => [row.status, row.leftQueue.why])).toEqual([['closed', LEFT.TAKEN_BACK], ['closed', LEFT.TAKEN_BACK]]);
    });
});
