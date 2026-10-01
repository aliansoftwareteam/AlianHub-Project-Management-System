/* Task 047, T-2: a person's connected AI shown beside them. Who is shown the entry, that it is read from the
   connection and never stored as a person, and that choosing it hands the task over through the work queue. */
process.env.STORAGE_TYPE = 'server';
const mockDb = require('./fixtures/fakeMongo').create();

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
jest.mock('../Modules/Agents/triggers', () => ({ fromComment: jest.fn(async () => null) }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpManageWorld');
const findings = require('../Modules/Agents/manager/findings');
const workQueue = require('../Modules/Agents/manager/workQueue');
const controller = require('../Modules/Agents/manager/controller');
const commentsCtrl = require('../Modules/Comments/controller');
const { parseMentionIds, parseAgentMentionIds } = require('../Modules/Comments/helpers/parseMentions');
const server = require('../Modules/Mcp/server');
const { projectFindingsSchema } = require('../utils/mongo-handler/createSchema');

const { CID, OWNER, MEMBER, OTHER, OUTSIDER, TOKEN, P_OPEN, P_DEST, S_OPEN, TASKS_GRANT, settle } = world;
const { seed, rows, rules: permissionRules, rpcThrough } = world.create(mockDb);
const rpc = rpcThrough(server);
const GUEST = OUTSIDER;
const { HANDED_OVER } = findings;
const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const PEOPLE = [SCHEMA_TYPE.COMPANY_USERS, SCHEMA_TYPE.USERS, SCHEMA_TYPE.API_TOKENS, SCHEMA_TYPE.OAUTH_GRANTS];

const agent = (uid) => world.ctx(uid, {
    actor: { kind: 'agent', userId: uid, agentName: 'Claude', viaAccount: 'personal', tokenId: TOKEN },
    token: { _id: TOKEN, userId: uid, scopes: ['read', 'write'], grants: [TASKS_GRANT], active: true },
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
const switchOn = (id = P_OPEN) => { project(id).agentManager = { on: true }; };
const handed = () => rows(SCHEMA_TYPE.PROJECT_FINDINGS).filter((row) => row.rule === HANDED_OVER);
const seat = (uid) => rows(SCHEMA_TYPE.COMPANY_USERS).find((row) => String(row.userId) === String(uid));
const snapshot = (types) => JSON.stringify(types.map((type) => rows(type)));

let n = 0;
const task = (over = {}) => {
    n += 1;
    return mockDb.seed(SCHEMA_TYPE.TASKS, {
        TaskKey: `CASE-${n}`, TaskName: `Case ${n}`, CompanyId: CID, ProjectID: P_OPEN, sprintId: S_OPEN, sprintArray: { id: S_OPEN, name: 'Sprint 1' },
        AssigneeUserId: [OTHER], watchers: [], isParentTask: true, deletedStatusKey: 0, status: { key: 2, text: 'In Progress', type: 'active' }, statusType: 'active', statusKey: 2,
        totalEstimatedTime: 60, relations: [], ...over,
    });
};

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
const shown = async (uid, extra) => through(controller.getConnectedAgents, request(uid, 'GET', '/api/v2/agents/connected', extra));
const seenBy = async (uid) => ((await shown(uid)).body.data || []).map((entry) => entry.shownAs);
const offered = async (uid, taskId) => (await shown(uid, { query: { taskId: String(taskId) } })).body.data;
const taskLine = async (uid, taskId) => (await through(controller.getTaskQueue, request(uid, 'GET', `/api/v2/agents/work-queue/task/${taskId}`, { params: { taskId: String(taskId) } }))).body.data;
const handTo = (uid, taskId, to) => through(controller.postHandOver, request(uid, 'POST', `/api/v2/agents/work-queue/task/${taskId}/hand-over`, { params: { taskId: String(taskId) }, body: { to } }));
const queued = async (caller) => (await rpc(caller, 'queue.list', {})).items.map((item) => item.key);

beforeAll(() => mockDb.uniqueFromSchema(SCHEMA_TYPE.PROJECT_FINDINGS, projectFindingsSchema));

beforeEach(() => {
    jest.clearAllMocks();
    n = 0;
    seed();
    process.env.MCP_TOOLS_WORK = 'on';
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: GUEST, roleType: 0, status: 2, isDelete: false });
});
afterEach(async () => {
    await settle();
    delete process.env.MCP_OAUTH;
    delete process.env.MCP_OAUTH_ISSUER;
});
afterAll(() => { delete process.env.MCP_TOOLS_WORK; delete process.env.MCP_TOOLS_MANAGE; });

describe('who is shown a person\'s connected AI', () => {
    it('shows it to the person, to another member and to the owner, and to no guest', async () => {
        connect(OTHER);
        expect((await shown(OTHER)).body.data).toMatchObject([{ ownerId: OTHER, name: 'Claude', ownerName: 'Priya Other', shownAs: 'Claude, for Priya Other', mine: true }]);
        expect((await shown(MEMBER)).body.data).toMatchObject([{ ownerId: OTHER, shownAs: 'Claude, for Priya Other', mine: false }]);
        expect(await seenBy(OWNER)).toEqual(['Claude, for Priya Other']);
        expect(await seenBy(GUEST)).toEqual([]);
        expect(await seenBy('6f0000000000000000000fff')).toEqual([]);
    });

    it('carries when it last worked and nothing that names a token or an app', async () => {
        const token = connect(OTHER);
        const [entry] = (await shown(MEMBER)).body.data;
        expect(new Date(entry.lastWorkedAt).getTime()).toBe(new Date(token.lastUsedAt).getTime());
        expect(Object.keys(entry).sort()).toEqual(['lastWorkedAt', 'mine', 'name', 'ownerId', 'ownerName', 'shownAs']);
    });

    it('goes with the person: a removed seat, an invitation not yet accepted and a guest have no entry', async () => {
        connect(OTHER);
        connect(GUEST);
        seat(OTHER).isDelete = true;
        expect(await seenBy(MEMBER)).toEqual([]);
        expect(await seenBy(OTHER)).toEqual([]);
        Object.assign(seat(OTHER), { isDelete: false, status: 1 });
        expect(await seenBy(OWNER)).toEqual([]);
        expect(await seenBy(GUEST)).toEqual([]);
    });

    it('goes with the connection: unused, switched off, ended, or not an AI\'s token', async () => {
        connect(OTHER, { lastUsedAt: undefined });
        connect(OTHER, { active: false });
        connect(OTHER, { expiresAt: new Date(Date.now() - DAY) });
        connect(OTHER, { kind: 'personal' });
        expect(await seenBy(MEMBER)).toEqual([]);
        const live = connect(OTHER);
        expect(await seenBy(MEMBER)).toEqual(['Claude, for Priya Other']);
        live.active = false;
        expect(await seenBy(MEMBER)).toEqual([]);
    });

    it('counts a connected app only while apps are switched on, and until it is taken back', async () => {
        const app = grant(OTHER);
        mockDb.seed(SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS, { companyId: CID, clientId: app.clientId, clientName: 'ChatGPT', status: 'approved' });
        expect(await seenBy(MEMBER)).toEqual([]);
        process.env.MCP_OAUTH = 'on';
        process.env.MCP_OAUTH_ISSUER = 'https://hub.example.com';
        expect(await seenBy(MEMBER)).toEqual(['ChatGPT, for Priya Other']);
        app.revokedAt = new Date();
        expect(await seenBy(MEMBER)).toEqual([]);
    });

    it('is one entry a person, named after the connection that worked last', async () => {
        connect(OTHER, { lastUsedAt: new Date(Date.now() - 5 * MINUTE), agentAccount: { mode: 'personal', provider: 'Codex' } });
        connect(OTHER);
        connect(MEMBER, { agentAccount: { mode: 'personal', provider: 'Codex' } });
        expect(await seenBy(OWNER)).toEqual(['Codex, for Mia Member', 'Claude, for Priya Other']);
    });

    it('is not given to an API token', async () => {
        connect(OTHER);
        expect(await shown(OWNER, { apiToken: { _id: TOKEN, userId: OWNER, name: 'Script' } })).toMatchObject({ code: 403 });
    });
});

describe('it is read from the connection and stored nowhere', () => {
    it('adds no seat, no person and no assignee when it is listed, offered and handed a task', async () => {
        connect(MEMBER);
        switchOn();
        const mine = task({ TaskKey: 'OPN-MINE', AssigneeUserId: [OTHER], watchers: [OWNER] });
        const noted = task({ TaskKey: 'OPN-NOTE' });
        const kept = Object.keys(mockDb.store).filter((type) => type !== SCHEMA_TYPE.PROJECT_FINDINGS);
        const before = snapshot(kept);
        const seats = () => rows(SCHEMA_TYPE.COMPANY_USERS).filter((row) => row.status === 2 && row.isDelete !== true).length;
        const seatsBefore = seats();

        await shown(OWNER);
        await offered(MEMBER, mine._id);
        expect(await handTo(MEMBER, mine._id, MEMBER)).toMatchObject({ code: 200 });
        await workQueue.handOverFromComment(CID, { authorId: MEMBER, taskId: String(noted._id), message: `@[Claude](myai_${MEMBER}) please` });

        expect(handed()).toHaveLength(2);
        expect(snapshot(kept)).toBe(before);
        expect(snapshot(PEOPLE)).toBe(JSON.stringify(PEOPLE.map((type) => JSON.parse(before)[kept.indexOf(type)] || [])));
        expect(seats()).toBe(seatsBefore);
    });
});

describe('handing a task to your own AI', () => {
    it('files a hand-over that names the person, and the task says who it went to', async () => {
        connect(MEMBER);
        switchOn();
        const mine = task({ TaskKey: 'OPN-MINE' });
        const sent = await handTo(MEMBER, mine._id, MEMBER);
        expect(sent).toMatchObject({ code: 200, body: { data: { canHandOver: false, items: [{ rule: HANDED_OVER, to: 'Claude, for Mia Member', canTakeBack: true }] } } });
        expect(handed()).toMatchObject([{ status: 'open', taskId: String(mine._id), facts: { handedBy: MEMBER, handedTo: MEMBER } }]);
        expect((await taskLine(OWNER, mine._id)).items).toMatchObject([{ to: 'Claude, for Mia Member' }]);
    });

    it('is offered to that person\'s agent and to nobody else\'s', async () => {
        connect(MEMBER);
        connect(OTHER);
        switchOn();
        const mine = task({ TaskKey: 'OPN-MINE' });
        const open = task({ TaskKey: 'OPN-ANY' });
        await handTo(MEMBER, mine._id, MEMBER);
        await handTo(MEMBER, open._id);
        expect(await queued(agent(MEMBER))).toEqual(['OPN-MINE', 'OPN-ANY']);
        expect(await queued(agent(OTHER))).toEqual(['OPN-ANY']);
        expect(await queued(agent(OWNER))).toEqual(['OPN-ANY']);
        const itemId = String(handed().find((row) => row.taskId === String(mine._id))._id);
        expect(await rpc(agent(OTHER), 'queue.claim', { itemId })).toMatchObject({ ok: false, error: workQueue.REFUSAL.NO_ITEM });
        expect(await rpc(agent(MEMBER), 'queue.claim', { itemId })).toMatchObject({ ok: true, result: { itemId } });
    });

    it('is refused for another person\'s AI, and for a person with no AI connected', async () => {
        connect(OTHER);
        switchOn();
        const mine = task({ TaskKey: 'OPN-MINE' });
        const forOther = await handTo(MEMBER, mine._id, OTHER);
        const forNobody = await handTo(MEMBER, mine._id, '6f0000000000000000000fff');
        const forMine = await handTo(MEMBER, mine._id, MEMBER);
        expect(forOther).toMatchObject({ code: 403 });
        expect([forNobody.code, forNobody.body.statusText]).toEqual([forOther.code, forOther.body.statusText]);
        expect([forMine.code, forMine.body.statusText]).toEqual([forOther.code, forOther.body.statusText]);
        expect(await handTo(MEMBER, mine._id, { $ne: '' })).toMatchObject({ code: 400 });
        expect(handed()).toEqual([]);
    });

    it('keeps the checks of every hand-over: the switch, a task the person can open, the right to assign', async () => {
        connect(MEMBER);
        connect(GUEST);
        const mine = task({ TaskKey: 'OPN-MINE' });
        expect(await handTo(MEMBER, mine._id, MEMBER)).toMatchObject({ code: 404 });
        switchOn();
        expect(await handTo(GUEST, mine._id, GUEST)).toMatchObject({ code: 404 });
        permissionRules.setRule(null, 'task_assignee', false);
        expect(await handTo(MEMBER, mine._id, MEMBER)).toMatchObject({ code: 403 });
        expect(handed()).toEqual([]);
    });

    it('offers the person their own AI on a task they may hand over, and nothing anywhere else', async () => {
        connect(MEMBER);
        connect(OTHER);
        const mine = task({ TaskKey: 'OPN-MINE' });
        expect(await offered(MEMBER, mine._id)).toEqual([]);
        switchOn();
        expect(await offered(MEMBER, mine._id)).toMatchObject([{ ownerId: MEMBER, shownAs: 'Claude, for Mia Member', mine: true }]);
        expect(await offered(OWNER, mine._id)).toEqual([]);
        expect(await offered(GUEST, mine._id)).toEqual([]);
        expect(await offered(MEMBER, '6f0000000000000000000fff')).toEqual([]);
        await handTo(MEMBER, mine._id, MEMBER);
        expect(await offered(MEMBER, mine._id)).toEqual([]);
    });

    it('leaves out a connection that is kept to other projects', async () => {
        const token = connect(MEMBER, { projectIds: [P_DEST] });
        switchOn();
        const mine = task({ TaskKey: 'OPN-MINE' });
        expect(await seenBy(MEMBER)).toEqual(['Claude, for Mia Member']);
        expect(await offered(MEMBER, mine._id)).toEqual([]);
        expect(await handTo(MEMBER, mine._id, MEMBER)).toMatchObject({ code: 403 });
        token.projectIds = [P_OPEN];
        expect(await offered(MEMBER, mine._id)).toHaveLength(1);
    });

    it('goes back to people when the connection ends, and when the person leaves', async () => {
        const token = connect(MEMBER);
        switchOn();
        const mine = task({ TaskKey: 'OPN-MINE' });
        const other = task({ TaskKey: 'OPN-TWO' });
        await handTo(MEMBER, mine._id, MEMBER);
        await handTo(MEMBER, other._id, MEMBER);

        token.active = false;
        expect(await taskLine(OWNER, mine._id)).toMatchObject({ on: true, canHandOver: true, items: [] });
        expect(handed().find((row) => row.taskId === String(mine._id))).toMatchObject({ status: 'closed', leftQueue: { why: workQueue.LEFT.WITHDRAWN } });

        token.active = true;
        seat(MEMBER).isDelete = true;
        await workQueue.closeFinished(CID, P_OPEN);
        expect(handed().map((row) => row.status)).toEqual(['closed', 'closed']);
        expect(rows(SCHEMA_TYPE.TASKS).find((row) => String(row._id) === String(other._id)).AssigneeUserId).toEqual([OTHER]);
    });

    it('can be taken back by the person who handed it over', async () => {
        connect(MEMBER);
        switchOn();
        const mine = task({ TaskKey: 'OPN-MINE' });
        await handTo(MEMBER, mine._id, MEMBER);
        const itemId = String(handed()[0]._id);
        const back = await through(controller.postTakeBack, request(MEMBER, 'POST', `/api/v2/agents/work-queue/${itemId}/take-back`, { params: { itemId } }));
        expect(back).toMatchObject({ code: 200, body: { data: { canHandOver: true, items: [] } } });
        expect(await queued(agent(MEMBER))).toEqual([]);
    });
});

describe('naming your own AI with @ in a comment', () => {
    const say = (authorId, taskId, message) => workQueue.handOverFromComment(CID, { authorId, taskId: String(taskId), message });

    it('hands the task to it, once', async () => {
        connect(MEMBER);
        switchOn();
        const mine = task({ TaskKey: 'OPN-MINE' });
        await say(MEMBER, mine._id, `@[Claude](myai_${MEMBER}) can you draft this?`);
        await say(MEMBER, mine._id, `@[Claude](myai_${MEMBER}) and the tests`);
        expect(handed()).toMatchObject([{ status: 'open', taskId: String(mine._id), facts: { handedBy: MEMBER, handedTo: MEMBER } }]);
        expect(await queued(agent(MEMBER))).toEqual(['OPN-MINE']);
    });

    it('does nothing for someone else\'s AI, for a comment that names none, or where the person may not hand over', async () => {
        connect(MEMBER);
        connect(OTHER);
        const mine = task({ TaskKey: 'OPN-MINE' });
        await say(MEMBER, mine._id, `@[Claude](myai_${MEMBER}) before the switch is on`);
        switchOn();
        await say(MEMBER, mine._id, `@[Claude](myai_${OTHER}) not mine`);
        await say(MEMBER, mine._id, `@[Priya Other](${OTHER}) a person`);
        await say(GUEST, mine._id, `@[Claude](myai_${GUEST}) a guest`);
        expect(handed()).toEqual([]);
    });

    it('is a comment like any other: the name is no person, and a comment sent with a token hands nothing over', async () => {
        connect(MEMBER);
        switchOn();
        const mine = task({ TaskKey: 'OPN-MINE' });
        const message = `@[Claude](myai_${MEMBER}) please`;
        expect(parseMentionIds(message)).toEqual([]);
        expect(parseAgentMentionIds(message)).toEqual([]);
        const post = (extra) => through(commentsCtrl.save, request(MEMBER, 'POST', '/api/v1/comments', {
            ...extra, body: { data: { objId: { projectId: P_OPEN, sprintId: S_OPEN, taskId: String(mine._id) }, message, type: 'text', userId: MEMBER } },
        }));

        await post({ apiToken: { _id: TOKEN, kind: 'agent', userId: MEMBER, name: 'CLI' } });
        await post({ mcp: true });
        expect(handed()).toEqual([]);

        await post();
        expect(handed()).toMatchObject([{ taskId: String(mine._id), facts: { handedBy: MEMBER, handedTo: MEMBER } }]);
        const comments = rows(SCHEMA_TYPE.COMMENTS).filter((row) => String(row.taskId) === String(mine._id));
        expect(comments.length).toBeGreaterThan(0);
        comments.forEach((row) => expect(row.mentionIds || []).toEqual([]));
        expect(rows(SCHEMA_TYPE.TASKS).find((row) => String(row._id) === String(mine._id)).AssigneeUserId).toEqual([OTHER]);
    });
});
