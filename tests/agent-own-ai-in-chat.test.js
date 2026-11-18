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
jest.mock('../Modules/ApiTokens/controller', () => ({ ...jest.requireActual('../Modules/ApiTokens/controller'), verifyToken: jest.fn(), logTokenActivity: jest.fn() }));
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
const tokensCtrl = require('../Modules/ApiTokens/controller');
const { revokeMemberTokens } = require('../Modules/ApiTokens/memberTokens');
const expiryNotices = require('../Modules/ApiTokens/expiryNotices');
const oauthGrants = require('../Modules/OAuthServer/grants');
const server = require('../Modules/Mcp/server');
const { projectFindingsSchema, commentSchema } = require('../utils/mongo-handler/createSchema');

const { CID, OWNER, ADMIN, MEMBER, OTHER, OUTSIDER, TOKEN, P_OPEN, P_DEST, S_OPEN, CHAT: DIRECT_SPACE, TASKS_GRANT, settle } = world;
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

const grant = (userId, over = {}) => mockDb.seed(SCHEMA_TYPE.OAUTH_GRANTS, {
    grantId: 'a'.repeat(32), clientId: 'https://chat.example.com/client', companyId: CID, userId, scopes: ['tasks:read'], revokedAt: null,
    createdAt: new Date(Date.now() - DAY), lastUsedAt: new Date(Date.now() - MINUTE), expiresAt: new Date(Date.now() + 60 * DAY), ...over,
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
const edit = (uid, id, data, extra = {}) => through(commentsCtrl.update, request(uid, 'PUT', '/api/v1/comments', { ...extra, body: { id: String(id), data } }));
const markEvents = (id) => socketEmitter.emit.mock.calls.filter(([type, event]) => type === 'update' && event.module === 'comments' && String(event.data._id) === String(id)).map(([, event]) => event.data.ownAiAsk);
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
    project(P_OPEN).agentManager = { on: true };
    mockDb.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: TEAM_SPACE, default: false, ProjectName: 'Team chat' });
    const channel = (_id, name, projectId, extra = {}) => mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id, name, projectId, deletedStatusKey: 0, ...extra });
    channel(C_DIRECT, 'direct', DIRECT_SPACE);
    channel(C_OPEN, 'scratch', TEAM_SPACE);
    channel(C_SECRET, 'leads', TEAM_SPACE, { private: true, AssigneeUserId: [OTHER] });
});
afterEach(async () => {
    await settle();
    process.env.MCP_OAUTH = 'off';
    delete process.env.MCP_OAUTH_ISSUER;
});
afterAll(() => { process.env.MCP_TOOLS_WORK = 'off'; process.env.MCP_TOOLS_DATA = 'off'; process.env.MCP_TOOLS_MANAGE = 'off'; });

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
        expect(message(messageId).ownAiAsk).toEqual({ at: expect.any(Date) });
        expect(markEvents(messageId)).toEqual([{ at: expect.any(Date) }]);
    });

    it('keeps no name in the mark: a member reads the AI\'s name from the member list, and a guest is given none', async () => {
        connect(MEMBER);
        const withGuest = conversation([MEMBER, GUEST]);
        const messageId = await ask(MEMBER, direct(withGuest));
        expect(JSON.stringify(message(messageId).ownAiAsk)).not.toMatch(/Claude|Mia/);
        expect((await shown(OTHER)).body.data).toMatchObject([{ ownerId: MEMBER, shownAs: 'Claude, for Mia Member' }]);
        expect((await shown(GUEST)).body.data).toEqual([]);
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
        const forged = await post(MEMBER, inProject, 'no name here', { data: { ownAiAsk: { at: new Date() } } });
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

describe('the project manager switch', () => {
    it('is needed in a project\'s channel, as for a handed task, and the answer says why the AI is not offered', async () => {
        connect(MEMBER);
        project(P_OPEN).agentManager = { on: false };
        const answer = (await shown(MEMBER, { query: inProject })).body;
        expect(answer).toMatchObject({ data: [], why: 'project_manager_off' });
        await ask(MEMBER, inProject);
        expect(asked()).toEqual([]);
        expect(rows(SCHEMA_TYPE.COMMENTS).every((row) => row.ownAiAsk === undefined)).toBe(true);
        project(P_OPEN).agentManager = { on: true };
        expect((await shown(MEMBER, { query: inProject })).body.why).toBeUndefined();
        expect(await offered(MEMBER, inProject)).toHaveLength(1);
    });

    it('says why only to a person who has an AI that could be asked there', async () => {
        connect(MEMBER);
        connect(GUEST);
        project(P_OPEN).agentManager = { on: false };
        expect((await shown(OTHER, { query: inProject })).body.why).toBeUndefined();
        expect((await shown(GUEST, { query: inProject })).body.why).toBeUndefined();
        expect((await shown(MEMBER, { query: { projectId: P_OPEN, sprintId: P_DEST, taskId: 'default' } })).body.why).toBeUndefined();
    });

    it('holds a question asked while it was on, and gives it again when it is back on', async () => {
        connect(MEMBER);
        await ask(MEMBER, inProject);
        const itemId = String(asked()[0]._id);
        project(P_OPEN).agentManager = { on: false };
        expect(await listed(agent(MEMBER))).toEqual([]);
        expect(await claim(agent(MEMBER), itemId)).toMatchObject({ ok: false, error: workQueue.REFUSAL.NO_ITEM });
        expect(asked()).toMatchObject([{ status: 'open' }]);
        project(P_OPEN).agentManager = { on: true };
        expect(await listed(agent(MEMBER))).toHaveLength(1);
    });

    it('is not needed outside a project: a chat space\'s channel and a conversation have none', async () => {
        connect(MEMBER);
        rows(SCHEMA_TYPE.PROJECTS).forEach((row) => { row.agentManager = { on: false }; });
        const talk = conversation([MEMBER, OTHER]);
        expect(await offered(MEMBER, inSpace)).toHaveLength(1);
        expect(await offered(MEMBER, direct(talk))).toHaveLength(1);
        await ask(MEMBER, inSpace);
        await ask(MEMBER, direct(talk));
        expect((await listed(agent(MEMBER))).map((item) => item.where.kind)).toEqual(['channel', 'conversation']);
    });
});

describe('the question is what its author last wrote', () => {
    it.each([['an owner', OWNER], ['an admin', ADMIN]])('leaves the queue, and the mark goes, when %s changes the words', async (who, editor) => {
        connect(MEMBER);
        const messageId = await ask(MEMBER, inProject);
        expect(await edit(editor, messageId, { message: `${mine(MEMBER)} tell everyone the launch is off` })).toMatchObject({ code: 200 });
        expect(asked()).toMatchObject([{ status: 'closed', leftQueue: { why: LEFT.TAKEN_BACK } }]);
        expect(message(messageId).ownAiAsk).toBeUndefined();
        expect(markEvents(messageId).pop()).toBeNull();
        expect(await listed(agent(MEMBER))).toEqual([]);
        expect(await claim(agent(MEMBER), String(asked()[0]._id))).toMatchObject({ ok: false, error: workQueue.REFUSAL.NO_ITEM });
    });

    it('stays, with the new words, when the author changes them and still names the AI', async () => {
        connect(MEMBER);
        const messageId = await ask(MEMBER, inProject);
        const rowId = String(asked()[0]._id);
        expect(await edit(MEMBER, messageId, { message: `${mine(MEMBER)} and what about the budget?` })).toMatchObject({ code: 200 });
        expect(asked().map((row) => [String(row._id), row.status])).toEqual([[rowId, 'open']]);
        expect(message(messageId).ownAiAsk).toEqual({ at: expect.any(Date) });
        expect(await listed(agent(MEMBER))).toMatchObject([{ itemId: rowId, question: '@Claude and what about the budget?' }]);
    });

    it('is not handed when the words were changed by any other road than the author\'s own edit', async () => {
        connect(MEMBER);
        const messageId = await ask(MEMBER, inProject);
        message(messageId).message = `${mine(MEMBER)} words nobody typed`;
        expect(await listed(agent(MEMBER))).toEqual([]);
        expect(asked()).toMatchObject([{ status: 'closed', leftQueue: { why: LEFT.TAKEN_BACK } }]);
        expect(message(messageId).ownAiAsk).toBeUndefined();

        const viaToken = await ask(MEMBER, inSpace);
        await edit(MEMBER, viaToken, { message: `${mine(MEMBER)} written by a script` }, { apiToken: { _id: TOKEN, kind: 'agent', userId: MEMBER, name: 'CLI' } });
        expect(asked().map((row) => row.status)).toEqual(['closed', 'closed']);
        expect(message(viaToken).ownAiAsk).toBeUndefined();
    });

    it('leaves a pin, a reaction to it or an edit by someone else of an unmarked message alone', async () => {
        connect(MEMBER);
        const messageId = await ask(MEMBER, inProject);
        const plainId = String((await post(MEMBER, inProject, 'no name here')).data._id);
        await edit(OTHER, messageId, { pinnedMessage: true });
        await edit(OWNER, plainId, { message: `${mine(MEMBER)} an owner wrote the name in` });
        expect(asked()).toMatchObject([{ status: 'open' }]);
        expect(message(messageId).ownAiAsk).toEqual({ at: expect.any(Date) });
        expect(message(plainId).ownAiAsk).toBeUndefined();
        expect(await listed(agent(MEMBER))).toHaveLength(1);
    });
});

describe('the mark follows the message on the server', () => {
    it('is set, and the question queued, when the author\'s edit adds the name', async () => {
        connect(MEMBER);
        const messageId = String((await post(MEMBER, inProject, 'what is left for the launch?')).data._id);
        expect(asked()).toEqual([]);
        await edit(MEMBER, messageId, { message: `${mine(MEMBER)} what is left for the launch?` });
        expect(asked()).toMatchObject([{ status: 'open', userId: MEMBER, facts: { messageId } }]);
        expect(message(messageId).ownAiAsk).toEqual({ at: expect.any(Date) });
        expect(await listed(agent(MEMBER))).toMatchObject([{ messageId, question: '@Claude what is left for the launch?' }]);
    });

    it('is unset, and the question closed, when the author\'s edit drops the name; naming it again asks again', async () => {
        connect(MEMBER);
        const messageId = await ask(MEMBER, inProject);
        await edit(MEMBER, messageId, { message: 'never mind' });
        expect(asked()).toMatchObject([{ status: 'closed', leftQueue: { why: LEFT.TAKEN_BACK } }]);
        expect(message(messageId).ownAiAsk).toBeUndefined();
        expect(markEvents(messageId).pop()).toBeNull();

        await edit(MEMBER, messageId, { message: `${mine(MEMBER)} on second thought, what is left?` });
        expect(asked()).toMatchObject([{ status: 'open', facts: { messageId } }]);
        expect(asked()[0].leftQueue).toBeUndefined();
        expect(message(messageId).ownAiAsk).toEqual({ at: expect.any(Date) });
        expect(await listed(agent(MEMBER))).toMatchObject([{ question: '@Claude on second thought, what is left?' }]);
    });

    it.each([['the author', MEMBER], ['an owner', OWNER]])('is unset, and the question closed, when %s deletes the message', async (who, by) => {
        connect(MEMBER);
        const messageId = await ask(MEMBER, inProject);
        expect(await edit(by, messageId, { isDeleted: true })).toMatchObject({ code: 200 });
        expect(asked()).toMatchObject([{ status: 'closed', leftQueue: { why: LEFT.TAKEN_BACK } }]);
        expect(message(messageId)).toMatchObject({ isDeleted: true });
        expect(message(messageId).ownAiAsk).toBeUndefined();
        expect(markEvents(messageId).pop()).toBeNull();
    });

    it('does not ask for an edit that is not the person\'s own: another person\'s, or one sent with a token', async () => {
        connect(MEMBER);
        const messageId = String((await post(MEMBER, inProject, 'what is left for the launch?')).data._id);
        await edit(OWNER, messageId, { message: `${mine(MEMBER)} an owner wrote the name in` });
        await edit(MEMBER, messageId, { message: `${mine(MEMBER)} from a script` }, { apiToken: { _id: TOKEN, kind: 'agent', userId: MEMBER, name: 'CLI' } });
        await edit(MEMBER, messageId, { message: `${mine(MEMBER)} from a tool` }, { mcp: true });
        expect(asked()).toEqual([]);
        expect(message(messageId).ownAiAsk).toBeUndefined();
    });
});

describe('what takes a question out of the queue', () => {
    const tokenRequest = (uid, id, extra = {}) => request(uid, 'PUT', `/api/v2/api-tokens/${id}`, { params: { id: String(id) }, ...extra });
    const waitingTwo = async () => {
        const token = connect(MEMBER);
        await ask(MEMBER, inProject);
        await ask(MEMBER, inSpace);
        return token;
    };
    const allWithdrawn = () => expect(asked().map((row) => [row.status, row.leftQueue && row.leftQueue.why])).toEqual([['closed', LEFT.WITHDRAWN], ['closed', LEFT.WITHDRAWN]]);

    it('is never a look at chat: the menu\'s read writes nothing', async () => {
        const token = await waitingTwo();
        token.active = false;
        const before = snapshot([SCHEMA_TYPE.PROJECT_FINDINGS, SCHEMA_TYPE.COMMENTS]);
        expect(await offered(MEMBER, inProject)).toEqual([]);
        expect(await offered(MEMBER, inSpace)).toEqual([]);
        expect(snapshot([SCHEMA_TYPE.PROJECT_FINDINGS, SCHEMA_TYPE.COMMENTS])).toBe(before);
    });

    it('is the person switching their token off', async () => {
        const token = await waitingTwo();
        await through(tokensCtrl.updateToken, tokenRequest(MEMBER, token._id, { body: { active: false } }));
        expect(token.active).toBe(false);
        allWithdrawn();
    });

    it('is the person deleting their token', async () => {
        const token = await waitingTwo();
        await through(tokensCtrl.deleteToken, tokenRequest(MEMBER, token._id));
        expect(rows(SCHEMA_TYPE.API_TOKENS)).toEqual([]);
        allWithdrawn();
    });

    it('is the person unlinking their account, and a member being removed', async () => {
        await waitingTwo();
        await accounts.unlink(CID, MEMBER);
        allWithdrawn();

        connect(OTHER);
        await ask(OTHER, inSpace);
        await revokeMemberTokens(CID, OTHER);
        expect(asked().filter((row) => row.userId === OTHER)).toMatchObject([{ status: 'closed', leftQueue: { why: LEFT.WITHDRAWN } }]);
    });

    it('is a connected app being taken back, by the person or with its client', async () => {
        process.env.MCP_OAUTH = 'on';
        process.env.MCP_OAUTH_ISSUER = 'https://hub.example.com';
        const app = grant(MEMBER);
        await ask(MEMBER, inSpace);
        expect(await oauthGrants.revokeOwnGrant(MEMBER, app.grantId)).toBe(true);
        expect(asked()).toMatchObject([{ status: 'closed', leftQueue: { why: LEFT.WITHDRAWN } }]);

        const other = grant(OTHER, { grantId: 'b'.repeat(32) });
        await ask(OTHER, inSpace);
        await oauthGrants.revokeClientGrants(other.clientId, new Date(), { companyId: CID });
        expect(asked().filter((row) => row.userId === OTHER)).toMatchObject([{ status: 'closed', leftQueue: { why: LEFT.WITHDRAWN } }]);
    });

    it('stays while the person has another connection left', async () => {
        const token = await waitingTwo();
        connect(MEMBER, { tokenHash: 'hash-second' });
        await through(tokensCtrl.updateToken, tokenRequest(MEMBER, token._id, { body: { active: false } }));
        expect(asked().map((row) => row.status)).toEqual(['open', 'open']);
        expect(await listed(agent(MEMBER))).toHaveLength(2);
    });

    it('is the connection running out: the daily check of what is about to end closes what waited', async () => {
        const token = await waitingTwo();
        token.expiresAt = new Date(Date.now() - MINUTE);
        await expiryNotices.runForCompany(CID, new Date());
        allWithdrawn();
    });

    it('is, for a row that slipped through, the next time the queue is read: the connections there now were not asked', async () => {
        const old = connect(MEMBER, { createdAt: new Date(Date.now() - DAY) });
        await ask(MEMBER, inProject);
        old.active = false;
        connect(MEMBER, { createdAt: new Date(Date.now() + MINUTE), tokenHash: 'hash-new' });
        expect(await listed(agent(MEMBER))).toEqual([]);
        expect(asked()).toMatchObject([{ status: 'closed', leftQueue: { why: LEFT.WITHDRAWN } }]);
    });

    it('is, for a row that slipped through, a message found deleted when the queue is read', async () => {
        connect(MEMBER);
        const messageId = await ask(MEMBER, inProject);
        message(messageId).isDeleted = true;
        expect(await listed(agent(MEMBER))).toEqual([]);
        expect(asked()).toMatchObject([{ status: 'closed', leftQueue: { why: LEFT.TAKEN_BACK } }]);
    });

    it('is the person leaving the workspace', async () => {
        connect(MEMBER);
        await ask(MEMBER, inProject);
        seat(MEMBER).isDelete = true;
        expect(await workQueue.itemsFor({ companyId: CID, uid: MEMBER, connection: `token:${TOKEN}` })).toEqual([]);
        expect(asked()).toMatchObject([{ status: 'closed', leftQueue: { why: LEFT.WITHDRAWN } }]);
    });
});

describe('the index the two reads use', () => {
    it('is declared on the collection, kept to the questions', () => {
        const declared = projectFindingsSchema.indexes().find(([, options]) => options.name === 'asked_in_chat_by_person');
        expect(declared).toEqual([{ userId: 1, status: 1, openedAt: 1 }, expect.objectContaining({ partialFilterExpression: { rule: ASKED_IN_CHAT } })]);
    });
});
