/* Task 047, AI-6: the work queue a connected agent pulls from. What it lists and to whom, a claim that one caller wins,
   lasts a bounded time and grants nothing, and the person who takes an item back. */
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
const registry = require('../Modules/Agents/registry');
const actions = require('../Modules/Agents/actions');
const { undoAuditRow } = require('../Modules/Agents/undo');
const { RULE } = require('../Modules/Agents/manager/rules');
const findings = require('../Modules/Agents/manager/findings');
const dailyLook = require('../Modules/Agents/manager/dailyLook');
const workQueue = require('../Modules/Agents/manager/workQueue');
const controller = require('../Modules/Agents/manager/controller');
const socketEmitter = require('../event/socketEventEmitter');
const instructions = require('../Modules/Mcp/instructions');
const tools = require('../Modules/Mcp/tools');
const server = require('../Modules/Mcp/server');
const { projectFindingsSchema } = require('../utils/mongo-handler/createSchema');

const { CID, OWNER, MEMBER, OTHER, OUTSIDER, TOKEN, P_OPEN, P_DEST, S_OPEN, S_SECRET, S_DEST, TASKS_GRANT, PLAIN_SCOPES, settle } = world;
const { seed, rows, rules: permissionRules, rpcThrough, listedThrough, audits } = world.create(mockDb);
const rpc = rpcThrough(server);
const listed = listedThrough(server);
const GUEST = OUTSIDER;
const TOKEN_2 = '6f0000000000000000000102';
const NAMES = ['queue.list', 'queue.claim', 'queue.release'];
const { HANDED_OVER } = findings;

const WEDNESDAY = new Date('2026-10-07T09:00:00Z');
const THURSDAY = new Date('2026-10-08T09:00:00Z');
const day = (ymd) => new Date(`${ymd}T00:00:00Z`);
const MINUTE = 60 * 1000;

/* A connection is one token acting for one person. */
const agent = (uid, tokenId = TOKEN, over = {}) => world.ctx(uid, {
    actor: { kind: 'agent', userId: uid, agentName: 'Claude', viaAccount: 'personal', tokenId },
    token: { _id: tokenId, userId: uid, scopes: ['read', 'write'], grants: [TASKS_GRANT], active: true },
    ...over,
});
const narrowed = (uid, projectIds) => agent(uid, TOKEN, { projectIds });

const project = (id) => rows(SCHEMA_TYPE.PROJECTS).find((row) => String(row._id) === String(id));
const stored = () => rows(SCHEMA_TYPE.PROJECT_FINDINGS);
const rowOf = (itemId) => stored().find((row) => String(row._id) === String(itemId));
const switchOn = (id = P_OPEN) => { project(id).agentManager = { on: true }; };
const calm = () => rows(SCHEMA_TYPE.TASKS).filter((row) => [P_OPEN, P_DEST].includes(String(row.ProjectID)))
    .forEach((row) => Object.assign(row, { AssigneeUserId: [OTHER], totalEstimatedTime: 60, updatedAt: day('2026-10-06'), DueDate: day('2026-11-20') }));

let n = 0;
const task = (over = {}) => {
    n += 1;
    return mockDb.seed(SCHEMA_TYPE.TASKS, {
        TaskKey: `CASE-${n}`, TaskName: `Case ${n}`, CompanyId: CID, ProjectID: P_OPEN, sprintId: S_OPEN, sprintArray: { id: S_OPEN, name: 'Sprint 1' },
        AssigneeUserId: [OTHER], watchers: [], isParentTask: true, deletedStatusKey: 0, status: { key: 2, text: 'In Progress', type: 'active' }, statusType: 'active', statusKey: 2,
        totalEstimatedTime: 60, updatedAt: day('2026-10-06'), createdAt: day('2026-09-01'), DueDate: day('2026-11-20'), relations: [], ...over,
    });
};

const look = (at = WEDNESDAY) => dailyLook.runForCompany(CID, at);
const queue = async (caller, args = {}) => (await rpc(caller, 'queue.list', args)).items;
const keys = async (caller, args) => (await queue(caller, args)).map((item) => `${item.kind}:${item.key}`).sort();
const claim = (caller, itemId) => rpc(caller, 'queue.claim', { itemId });
const release = (caller, itemId, finished) => rpc(caller, 'queue.release', { itemId, ...(finished === undefined ? {} : { finished }) });

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
const request = (uid, method, path, params, extra = {}) => ({ uid, method, originalUrl: path, url: path, headers: { companyid: CID }, params, body: {}, ip: '1.1.1.1', ...extra });
const taskLine = (uid, taskId) => through(controller.getTaskQueue, request(uid, 'GET', `/api/v2/agents/work-queue/task/${taskId}`, { taskId: String(taskId) }));
const handOver = (uid, taskId, extra) => through(controller.postHandOver, request(uid, 'POST', `/api/v2/agents/work-queue/task/${taskId}/hand-over`, { taskId: String(taskId) }, extra));
const takeBack = (uid, itemId, extra) => through(controller.postTakeBack, request(uid, 'POST', `/api/v2/agents/work-queue/${itemId}/take-back`, { itemId: String(itemId) }, extra));
const card = async (uid) => (await through(controller.getProjectManager, request(uid, 'GET', `/api/v2/agents/project-manager/${P_OPEN}`, { projectId: P_OPEN }))).body.data;

/* One task nobody owns, in the open list, found by the day's look. */
const orphanItem = async () => {
    const orphan = task({ TaskKey: 'OPN-ORPHAN', AssigneeUserId: [] });
    switchOn();
    await look();
    const row = stored().find((found) => found.rule === RULE.NO_OWNER && found.taskId === String(orphan._id));
    return { orphan, itemId: String(row._id) };
};

beforeAll(() => mockDb.uniqueFromSchema(SCHEMA_TYPE.PROJECT_FINDINGS, projectFindingsSchema));

beforeEach(() => {
    jest.clearAllMocks();
    n = 0;
    seed();
    process.env.MCP_TOOLS_WORK = 'on';
    calm();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: GUEST, roleType: 0, status: 2, isDelete: false });
});
afterEach(settle);
afterAll(() => { delete process.env.MCP_TOOLS_WORK; delete process.env.MCP_TOOLS_MANAGE; });

describe('the tools exist only while their flag is on', () => {
    it('off, nothing is listed, registered or callable', async () => {
        delete process.env.MCP_TOOLS_WORK;
        expect((await listed(agent(OWNER))).filter((name) => NAMES.includes(name))).toEqual([]);
        NAMES.forEach((name) => expect(registry.has(name)).toBe(false));
        expect((await rpc(agent(OWNER), 'queue.list', {})).rpcError).toMatchObject({ code: -32601 });
    });

    it('on, they are listed, rated, and named in the instructions only for a connection that may take work', async () => {
        expect(await listed(agent(OWNER))).toEqual(expect.arrayContaining(NAMES));
        expect(actions.rating('queue.claim')).toMatchObject({ write: true, reversible: true, scope: 'task' });
        expect(instructions.forCaller(agent(OWNER))).toMatch(/`queue\.list`.*`queue\.claim`.*`queue\.release`/);
        expect(instructions.forCaller(world.readOnly(OWNER))).not.toMatch(/queue\./);
        expect(tools.usable(world.readOnly(OWNER)).map((tool) => tool.name)).toContain('queue.list');
    });
});

describe('what the queue lists', () => {
    const seedQueue = async () => {
        task({ TaskKey: 'OPN-ORPHAN', AssigneeUserId: [] });
        task({ TaskKey: 'OPN-BARE', totalEstimatedTime: 0 });
        task({ TaskKey: 'OPN-MAIL', origin: { kind: 'email', ref: 'm1' }, AssigneeUserId: [], totalEstimatedTime: 0 });
        task({ TaskKey: 'OPN-QUIET', updatedAt: day('2026-09-30') });
        task({ TaskKey: 'OPN-LATE', DueDate: day('2026-10-04') });
        task({ TaskKey: 'HID-1', sprintId: S_SECRET, sprintArray: { id: S_SECRET, name: 'Secret' }, AssigneeUserId: [] });
        const loaded = task({ TaskKey: 'OPN-LOAD', AssigneeUserId: [MEMBER] });
        mockDb.seed(SCHEMA_TYPE.ESTIMATES_TIME, { ProjectId: P_OPEN, TaskId: String(loaded._id), UserId: MEMBER, userId: MEMBER, Date: day('2026-10-06'), EstimatedTime: 42 * 60 });
        switchOn();
        await look();
    };
    const OPEN_ITEMS = ['no_estimate:OPN-BARE', 'no_owner:OPN-ORPHAN', 'overloaded:OPN-LOAD', 'untriaged:OPN-MAIL'];

    it('holds the findings that need judgement, each with its reason, and none that came with a ready change', async () => {
        await seedQueue();
        const items = await queue(agent(OWNER));
        expect(items.map((item) => `${item.kind}:${item.key}`).sort()).toEqual([...OPEN_ITEMS, 'no_owner:HID-1'].sort());
        expect(items.map((item) => item.kind)).toEqual(['untriaged', 'overloaded', 'no_owner', 'no_owner', 'no_estimate']);
        expect(items.find((item) => item.key === 'OPN-ORPHAN')).toMatchObject({
            itemId: expect.stringMatching(/^[a-f0-9]{24}$/), projectId: P_OPEN, project: 'Open', title: expect.any(String),
            why: 'The task is open and nobody owns it.', asked: 'Choose an owner.',
        });
        expect(items.find((item) => item.kind === 'overloaded')).toMatchObject({ personId: MEMBER, why: expect.stringContaining('42 hours') });
        expect((await rpc(agent(OWNER), 'queue.list', {})).claimMinutes).toBe(30);
    });

    it('a person on the private list reads its items, and a member outside it reads none of them and no count of them', async () => {
        await seedQueue();
        expect(await keys(agent(OTHER))).toEqual([...OPEN_ITEMS, 'no_owner:HID-1'].sort());
        expect(await keys(agent(MEMBER))).toEqual(OPEN_ITEMS);
        const answer = await rpc(agent(MEMBER), 'queue.list', {});
        expect(JSON.stringify(answer)).not.toMatch(/HID-|Secret/);
        expect(Object.keys(answer).sort()).toEqual(['claimMinutes', 'items']);
    });

    it('a guest reads none', async () => {
        await seedQueue();
        const out = await rpc(agent(GUEST), 'queue.list', {});
        expect(out.items || []).toEqual([]);
        expect(JSON.stringify(out)).not.toMatch(/OPN-|HID-/);
        expect(await workQueue.itemsFor({ companyId: CID, uid: GUEST, connection: `token:${TOKEN}` })).toEqual([]);
    });

    it('a token kept to other projects reads none, and one kept to this project reads it', async () => {
        await seedQueue();
        expect(await queue(narrowed(OWNER, [P_DEST]))).toEqual([]);
        expect(await queue(narrowed(OWNER, [P_DEST]), { projectId: P_OPEN })).toEqual([]);
        expect(await keys(narrowed(MEMBER, [P_OPEN]))).toEqual(OPEN_ITEMS);
    });

    it('a project whose switch is off lists nothing, whoever asks', async () => {
        await seedQueue();
        project(P_OPEN).agentManager = { on: false };
        expect(await queue(agent(OWNER))).toEqual([]);
        expect(await queue(agent(OWNER), { projectId: P_OPEN })).toEqual([]);
    });

    it('keeps to one project when asked, and to the size asked for', async () => {
        await seedQueue();
        mockDb.seed(SCHEMA_TYPE.TASKS, { ...task({ TaskKey: 'DST-ORPHAN', AssigneeUserId: [] }), _id: undefined, ProjectID: P_DEST, sprintId: S_DEST });
        expect(await queue(agent(OWNER), { projectId: P_DEST })).toEqual([]);
        expect(await queue(agent(OWNER), { limit: 2 })).toHaveLength(2);
        expect((await rpc(agent(OWNER), 'queue.list', { limit: 99 })).rpcError).toMatchObject({ code: -32602 });
    });

    it('leaves out an item whose task was closed or deleted since the look', async () => {
        await seedQueue();
        rows(SCHEMA_TYPE.TASKS).find((row) => row.TaskKey === 'OPN-ORPHAN').statusType = 'close';
        rows(SCHEMA_TYPE.TASKS).find((row) => row.TaskKey === 'OPN-BARE').deletedStatusKey = 1;
        expect(await keys(agent(MEMBER))).toEqual(['overloaded:OPN-LOAD', 'untriaged:OPN-MAIL']);
    });
});

describe('a claim', () => {
    it('is taken by one connection for one person, says who, and lasts thirty minutes', async () => {
        const { itemId } = await orphanItem();
        const before = Date.now();
        const out = await claim(agent(OTHER), itemId);
        expect(out).toMatchObject({ ok: true, undoable: true, result: { itemId, minutes: 30 } });
        const held = rowOf(itemId).claim;
        expect(held).toMatchObject({ by: `token:${TOKEN}`, userId: OTHER, name: 'Claude, for Priya Other' });
        expect(new Date(held.until).getTime() - before).toBeGreaterThanOrEqual(30 * MINUTE);
        expect(new Date(held.until).getTime() - before).toBeLessThan(31 * MINUTE);
        expect(audits('queue.claim', 'applied')).toHaveLength(1);
    });

    it('by an outside client belongs to its grant and names the client', async () => {
        const { itemId } = await orphanItem();
        expect(await claim(world.outside(OTHER, PLAIN_SCOPES), itemId)).toMatchObject({ ok: true });
        expect(rowOf(itemId).claim).toMatchObject({ by: `grant:${world.GRANT_ID}`, userId: OTHER, name: 'Outside agent, for Priya Other' });
        expect(await claim(agent(OTHER), itemId)).toMatchObject({ isError: true, error: workQueue.REFUSAL.TAKEN });
        expect(await claim(world.outside(OTHER, ['tasks:read']), itemId)).toMatchObject({ isError: true, error: expect.stringContaining('tasks:write') });
    });

    it('hides the item from every other connection and marks it for its holder', async () => {
        const { itemId } = await orphanItem();
        await claim(agent(OTHER), itemId);
        expect(await queue(agent(OTHER))).toMatchObject([{ itemId, yours: true, claimedUntil: expect.any(String) }]);
        expect(await queue(agent(OTHER, TOKEN_2))).toEqual([]);
        expect(await queue(agent(OWNER, TOKEN_2))).toEqual([]);
    });

    it('is refused to a second connection, and kept longer by the first', async () => {
        const { itemId } = await orphanItem();
        await claim(agent(OTHER), itemId);
        const until = new Date(rowOf(itemId).claim.until).getTime();
        expect(await claim(agent(OWNER, TOKEN_2), itemId)).toMatchObject({ isError: true, error: workQueue.REFUSAL.TAKEN });
        expect(rowOf(itemId).claim.userId).toBe(OTHER);
        rowOf(itemId).claim.until = new Date(until - 10 * MINUTE);
        expect(await claim(agent(OTHER), itemId)).toMatchObject({ ok: true });
        expect(new Date(rowOf(itemId).claim.until).getTime()).toBeGreaterThanOrEqual(until);
    });

    it('goes to exactly one of several callers asking at once', async () => {
        const { itemId } = await orphanItem();
        const callers = [agent(OWNER, '6f0000000000000000000111'), agent(OTHER, '6f0000000000000000000112'), agent(MEMBER, '6f0000000000000000000113'), agent(OWNER, '6f0000000000000000000114'), agent(OTHER, '6f0000000000000000000115')];
        const outcomes = await Promise.all(callers.map((caller) => claim(caller, itemId)));
        expect(outcomes.filter((out) => out.ok === true)).toHaveLength(1);
        expect(outcomes.filter((out) => out.error === workQueue.REFUSAL.TAKEN)).toHaveLength(4);
        const winner = callers[outcomes.findIndex((out) => out.ok === true)];
        expect(rowOf(itemId).claim.by).toBe(`token:${winner.token._id}`);
    });

    it('frees itself when its time has passed', async () => {
        const { itemId } = await orphanItem();
        await claim(agent(OTHER), itemId);
        rowOf(itemId).claim.until = new Date(Date.now() - MINUTE);
        expect(await queue(agent(OWNER, TOKEN_2))).toMatchObject([{ itemId }]);
        expect((await queue(agent(OWNER, TOKEN_2)))[0].yours).toBeUndefined();
        expect(await claim(agent(OWNER, TOKEN_2), itemId)).toMatchObject({ ok: true });
        expect(rowOf(itemId).claim).toMatchObject({ by: `token:${TOKEN_2}`, userId: OWNER });
        expect(await release(agent(OTHER), itemId)).toMatchObject({ isError: true, error: workQueue.REFUSAL.NOT_HELD });
    });

    it('is released when its person can no longer open the task', async () => {
        const hidden = task({ TaskKey: 'HID-1', sprintId: S_SECRET, sprintArray: { id: S_SECRET, name: 'Secret' }, AssigneeUserId: [] });
        switchOn();
        await look();
        const itemId = String(stored().find((row) => row.taskId === String(hidden._id) && row.rule === RULE.NO_OWNER)._id);
        await claim(agent(OTHER), itemId);
        rows(SCHEMA_TYPE.SPRINTS).find((row) => String(row._id) === S_SECRET).AssigneeUserId = [];
        expect(await queue(agent(OWNER, TOKEN_2))).toMatchObject([{ itemId }]);
        expect(rowOf(itemId).claim).toBeUndefined();
        expect(await release(agent(OTHER), itemId)).toMatchObject({ ok: false, error: 'That item was not found. Check queue.list.' });
    });

    it('answers a hidden item, a missing one and one of another kind alike, and holds nothing', async () => {
        const hidden = task({ TaskKey: 'HID-1', sprintId: S_SECRET, sprintArray: { id: S_SECRET, name: 'Secret' }, AssigneeUserId: [] });
        task({ TaskKey: 'OPN-QUIET', updatedAt: day('2026-09-30') });
        switchOn();
        await look();
        const secret = String(stored().find((row) => row.taskId === String(hidden._id) && row.rule === RULE.NO_OWNER)._id);
        const withChange = String(stored().find((row) => row.rule === RULE.STALE && row.facts.taskKey === 'OPN-QUIET')._id);
        const missing = { ok: false, error: 'That item was not found. Check queue.list.' };
        expect(await claim(agent(MEMBER), secret)).toEqual(missing);
        expect(await claim(agent(MEMBER), '6f0000000000000000000fff')).toEqual(missing);
        expect(await claim(agent(OWNER), withChange)).toEqual(missing);
        expect(await claim(narrowed(OWNER, [P_DEST]), secret)).toEqual(missing);
        expect(await claim(agent(GUEST), secret)).toEqual(missing);
        project(P_OPEN).agentManager = { on: false };
        expect(await claim(agent(OWNER), secret)).toEqual(missing);
        expect(stored().filter((row) => row.claim)).toEqual([]);
    });

    it('is refused to a connection that only reads', async () => {
        const { itemId } = await orphanItem();
        const out = await claim(world.readOnly(OWNER), itemId);
        expect(out).toMatchObject({ isError: true, error: 'This connection can only read. Ask the person to connect you again and allow changes.' });
        expect(rowOf(itemId).claim).toBeUndefined();
    });

    it('gives no new rights: the change itself is still held to the person\'s permissions', async () => {
        const { orphan, itemId } = await orphanItem();
        permissionRules.setRule(null, 'task_assignee', false);
        expect(await claim(agent(MEMBER), itemId)).toMatchObject({ ok: true });
        const out = await rpc(agent(MEMBER), 'task.assign', { taskId: String(orphan._id), mode: 'set', userIds: [MEMBER] });
        expect(out).toMatchObject({ refused: true });
        expect(rows(SCHEMA_TYPE.TASKS).find((row) => String(row._id) === String(orphan._id)).AssigneeUserId).toEqual([]);
    });
});

describe('the project\'s rule for agents is asked for a claim, as for any write', () => {
    it('a project where people close their tasks still lets an agent take an item, because a claim closes nothing', async () => {
        const { itemId } = await orphanItem();
        project(P_OPEN).agentPolicy = { done: 'never', connected: 'single_task' };
        expect(await claim(agent(OTHER), itemId)).toMatchObject({ ok: true });
    });

    it.each([
        ['a personal token', () => agent(OTHER)],
        ['an outside client', () => world.outside(OTHER, PLAIN_SCOPES)],
    ])('a project where connected agents propose everything refuses a claim by %s, files nothing, and still lists the item', async (_who, caller) => {
        const { itemId } = await orphanItem();
        project(P_OPEN).agentPolicy = { done: 'approval', connected: 'propose_all' };
        const out = await claim(caller(), itemId);
        expect(out).toMatchObject({ refused: true, reason: expect.stringContaining('in this project a connected agent has to ask a person before every change') });
        expect(rowOf(itemId).claim).toBeUndefined();
        expect(rows(SCHEMA_TYPE.AGENT_PROPOSALS)).toEqual([]);
        expect(audits('queue.claim', 'applied')).toEqual([]);
        expect(await queue(caller())).toMatchObject([{ itemId }]);
    });

    it('an in-product agent, which is no connection, is refused by the queue itself', async () => {
        const { itemId } = await orphanItem();
        const inProduct = { kind: 'agent', userId: OTHER, agentId: '6f0000000000000000000a01', agentName: 'Reporter', viaAccount: 'workspace' };
        await expect(actions.perform({ companyId: CID, actor: inProduct, action: 'queue.claim', params: { itemId, projectId: P_OPEN } })).rejects.toThrow(workQueue.REFUSAL.NOT_CONNECTED);
        expect(rowOf(itemId).claim).toBeUndefined();
    });
});

describe('giving an item back', () => {
    it('frees it for another agent', async () => {
        const { itemId } = await orphanItem();
        await claim(agent(OTHER), itemId);
        expect(await release(agent(OTHER), itemId)).toMatchObject({ ok: true, result: { released: true, finished: false } });
        expect(rowOf(itemId).claim).toBeUndefined();
        expect(await queue(agent(OWNER, TOKEN_2))).toMatchObject([{ itemId }]);
    });

    it('finished, it leaves the queue while its cause lasts, stays listed for people, and comes back when undone', async () => {
        const { itemId } = await orphanItem();
        await claim(agent(OTHER), itemId);
        const out = await release(agent(OTHER), itemId, true);
        expect(out).toMatchObject({ ok: true, undoable: true, result: { finished: true } });
        expect(rowOf(itemId)).toMatchObject({ status: 'open', leftQueue: { why: 'finished', userId: OTHER } });
        expect(await queue(agent(OWNER, TOKEN_2))).toEqual([]);
        await look(THURSDAY);
        expect(await queue(agent(OWNER, TOKEN_2))).toEqual([]);
        expect((await card(OWNER)).findings.map((finding) => finding.rule)).toEqual([RULE.NO_OWNER]);
        const [row] = audits('queue.release', 'applied');
        expect(await undoAuditRow(CID, row, { kind: 'human', userId: OWNER }, '1.1.1.1')).toMatchObject({ ok: true });
        expect(await queue(agent(OWNER, TOKEN_2))).toMatchObject([{ itemId }]);
    });

    it('is refused to a connection that does not hold it', async () => {
        const { itemId } = await orphanItem();
        await claim(agent(OTHER), itemId);
        expect(await release(agent(OTHER, TOKEN_2), itemId)).toMatchObject({ isError: true, error: workQueue.REFUSAL.NOT_HELD });
        expect(await release(agent(OWNER, TOKEN_2), itemId, true)).toMatchObject({ isError: true, error: workQueue.REFUSAL.NOT_HELD });
        expect(rowOf(itemId).claim.userId).toBe(OTHER);
    });

    it('undoing a claim gives the item back', async () => {
        const { itemId } = await orphanItem();
        await claim(agent(OTHER), itemId);
        const [row] = audits('queue.claim', 'applied');
        expect(await undoAuditRow(CID, row, { kind: 'human', userId: OWNER }, '1.1.1.1')).toMatchObject({ ok: true });
        expect(rowOf(itemId).claim).toBeUndefined();
    });

    it('an item whose cause is gone leaves the queue with the next look, claimed or not', async () => {
        const { orphan, itemId } = await orphanItem();
        await claim(agent(OTHER), itemId);
        orphan.AssigneeUserId = [MEMBER];
        await look(THURSDAY);
        expect(rowOf(itemId).status).toBe('closed');
        expect(await queue(agent(OTHER))).toEqual([]);
        orphan.AssigneeUserId = [];
        project(P_OPEN).agentManagerLookedOn = '';
        await look(THURSDAY);
        expect(rowOf(itemId)).toMatchObject({ status: 'open' });
        expect(rowOf(itemId).claim).toBeUndefined();
    });
});

describe('a task a person hands over', () => {
    const handed = () => stored().filter((row) => row.rule === HANDED_OVER);

    it('joins the queue ahead of the findings, and the day\'s look neither closes it nor counts it', async () => {
        const { orphan } = await orphanItem();
        const mine = task({ TaskKey: 'OPN-MINE' });
        expect(await handOver(MEMBER, mine._id)).toMatchObject({ code: 200, body: { data: { on: true, canHandOver: false, items: [{ rule: HANDED_OVER, claim: null, canTakeBack: true }] } } });
        expect(await handOver(MEMBER, mine._id)).toMatchObject({ code: 409 });
        const items = await queue(agent(OTHER));
        expect(items.map((item) => `${item.kind}:${item.key}`)).toEqual(['handed_over:OPN-MINE', 'no_owner:OPN-ORPHAN']);
        expect(items[0]).toMatchObject({ handedOverBy: MEMBER, why: 'A person handed this task to an agent.', asked: 'Do what the task asks.' });
        project(P_OPEN).agentManagerLookedOn = '';
        await look(THURSDAY);
        expect(handed()).toMatchObject([{ status: 'open', taskId: String(mine._id) }]);
        expect(await findings.openedSince(CID, P_OPEN, day('2026-10-01'))).toBe(1);
        expect(orphan).toBeDefined();
    });

    it('needs the switch on, a task the person can open, and the right to assign it', async () => {
        const mine = task({ TaskKey: 'OPN-MINE' });
        const secret = task({ TaskKey: 'HID-1', sprintId: S_SECRET, sprintArray: { id: S_SECRET, name: 'Secret' } });
        expect(await handOver(OWNER, mine._id)).toMatchObject({ code: 404 });
        switchOn();
        expect(await handOver(MEMBER, secret._id)).toMatchObject({ code: 404 });
        expect(await handOver(GUEST, mine._id)).toMatchObject({ code: 404 });
        expect(await handOver(OWNER, '6f0000000000000000000fff')).toMatchObject({ code: 404 });
        permissionRules.setRule(null, 'task_assignee', false);
        expect(await handOver(MEMBER, mine._id)).toMatchObject({ code: 403 });
        expect(handed()).toEqual([]);
        expect(await handOver(OWNER, mine._id)).toMatchObject({ code: 200 });
    });

    it('is refused to an API token and to an agent\'s token', async () => {
        const mine = task({ TaskKey: 'OPN-MINE' });
        switchOn();
        expect(await handOver(OWNER, mine._id, { apiToken: { _id: TOKEN, userId: OWNER, name: 'Script' } })).toMatchObject({ code: 403 });
        expect(await handOver(OWNER, mine._id, { apiToken: { _id: TOKEN, kind: 'agent', userId: OWNER, name: 'CLI' } })).toMatchObject({ code: 403 });
        expect(handed()).toEqual([]);
    });

    it('finished by the agent, it leaves the queue for good, and can be handed over again', async () => {
        const mine = task({ TaskKey: 'OPN-MINE' });
        switchOn();
        await handOver(MEMBER, mine._id);
        const itemId = String(handed()[0]._id);
        await claim(agent(OTHER), itemId);
        expect(await release(agent(OTHER), itemId, true)).toMatchObject({ ok: true });
        expect(rowOf(itemId)).toMatchObject({ status: 'closed' });
        expect(await queue(agent(OTHER))).toEqual([]);
        expect(await handOver(MEMBER, mine._id)).toMatchObject({ code: 200 });
        expect(handed()).toHaveLength(1);
        expect(rowOf(itemId)).toMatchObject({ status: 'open' });
        expect(rowOf(itemId).leftQueue).toBeUndefined();
        expect(await queue(agent(OTHER))).toMatchObject([{ itemId }]);
    });

    it('leaves the queue with the look once its task is closed', async () => {
        const mine = task({ TaskKey: 'OPN-MINE' });
        switchOn();
        await handOver(MEMBER, mine._id);
        mine.statusType = 'close';
        expect(await queue(agent(OTHER))).toEqual([]);
        await look();
        expect(handed()).toMatchObject([{ status: 'closed' }]);
    });
});

describe('what people see, and taking an item back', () => {
    it('turning the project manager off or on tells open pages to read the queue again', async () => {
        const turn = (on) => through(controller.putProjectManager, request(OWNER, 'PUT', `/api/v2/agents/project-manager/${P_OPEN}`, { projectId: P_OPEN }, { body: { on } }));
        const announced = () => socketEmitter.emit.mock.calls.filter(([, payload]) => payload && payload.module === 'agent' && payload.data && payload.data.kind === 'claim');
        socketEmitter.emit.mockClear();
        expect(await turn(false)).toMatchObject({ code: 200, body: { status: true } });
        expect(announced()).toHaveLength(1);
        expect(announced()[0][1]).toMatchObject({ type: 'update', companyId: CID });
        expect(await turn(true)).toMatchObject({ code: 200 });
        expect(announced().length).toBeGreaterThanOrEqual(2);
    });

    it('the card and the task say who holds an item, to the people who can open it', async () => {
        const { orphan, itemId } = await orphanItem();
        expect((await card(MEMBER)).findings).toMatchObject([{ id: itemId, rule: RULE.NO_OWNER }]);
        expect((await card(MEMBER)).findings[0].claim).toBeUndefined();
        expect((await taskLine(MEMBER, orphan._id)).body.data).toEqual({ on: true, canHandOver: true, items: [] });
        await claim(agent(OTHER), itemId);
        const shown = { name: 'Claude, for Priya Other', until: expect.any(String) };
        expect((await card(MEMBER)).findings).toMatchObject([{ id: itemId, claim: shown, canTakeBack: true }]);
        expect((await taskLine(MEMBER, orphan._id)).body.data).toMatchObject({ on: true, items: [{ id: itemId, rule: RULE.NO_OWNER, claim: shown, canTakeBack: true }] });
        expect(JSON.stringify(await card(MEMBER))).not.toMatch(/token:/);
    });

    it('a person who could not make the change is not offered it, unless the agent acts for them', async () => {
        const { orphan, itemId } = await orphanItem();
        permissionRules.setRule(null, 'task_assignee', false);
        await claim(agent(OTHER), itemId);
        expect((await taskLine(MEMBER, orphan._id)).body.data.items).toMatchObject([{ canTakeBack: false }]);
        expect((await taskLine(OTHER, orphan._id)).body.data.items).toMatchObject([{ canTakeBack: true }]);
        expect(await takeBack(MEMBER, itemId)).toMatchObject({ code: 403 });
        expect(rowOf(itemId).claim.userId).toBe(OTHER);
        expect(await takeBack(OTHER, itemId)).toMatchObject({ code: 200 });
    });

    it('a task the person cannot open, a missing one and one in a project with the switch off answer alike', async () => {
        const secret = task({ TaskKey: 'HID-1', sprintId: S_SECRET, sprintArray: { id: S_SECRET, name: 'Secret' }, AssigneeUserId: [] });
        const elsewhere = rows(SCHEMA_TYPE.TASKS).find((row) => String(row.ProjectID) === P_DEST) || mockDb.seed(SCHEMA_TYPE.TASKS, { TaskKey: 'DST-1', TaskName: 'Elsewhere', CompanyId: CID, ProjectID: P_DEST, sprintId: S_DEST, AssigneeUserId: [], deletedStatusKey: 0, statusType: 'active' });
        switchOn();
        await look();
        await claim(agent(OTHER), String(stored().find((row) => row.taskId === String(secret._id))._id));
        const nothing = { code: 200, body: { status: true, data: { on: false, canHandOver: false, items: [] } } };
        expect(await taskLine(MEMBER, secret._id)).toMatchObject(nothing);
        expect(await taskLine(MEMBER, '6f0000000000000000000fff')).toMatchObject(nothing);
        expect(await taskLine(OWNER, elsewhere._id)).toMatchObject(nothing);
        expect(await taskLine(GUEST, secret._id)).toMatchObject(nothing);
        expect((await taskLine(OTHER, secret._id)).body.data.items).toHaveLength(1);
    });

    it('a person takes a claimed finding back: the agent loses it, no agent is offered it again, and people still see it', async () => {
        const { orphan, itemId } = await orphanItem();
        await claim(agent(OTHER), itemId);
        expect(await takeBack(MEMBER, itemId)).toMatchObject({ code: 200, body: { data: { on: true, items: [] } } });
        expect(rowOf(itemId)).toMatchObject({ status: 'open', leftQueue: { why: 'taken_back', userId: MEMBER } });
        expect(rowOf(itemId).claim).toBeUndefined();
        expect(await queue(agent(OTHER))).toEqual([]);
        expect(await claim(agent(OTHER), itemId)).toEqual({ ok: false, error: 'That item was not found. Check queue.list.' });
        expect(await release(agent(OTHER), itemId)).toEqual({ ok: false, error: 'That item was not found. Check queue.list.' });
        expect((await card(MEMBER)).findings).toMatchObject([{ id: itemId, rule: RULE.NO_OWNER }]);
        expect(orphan.AssigneeUserId).toEqual([]);
    });

    it('a handed-over task is taken back whether or not an agent holds it', async () => {
        const mine = task({ TaskKey: 'OPN-MINE' });
        switchOn();
        await handOver(MEMBER, mine._id);
        const itemId = String(stored()[0]._id);
        expect(await takeBack(MEMBER, itemId)).toMatchObject({ code: 200, body: { data: { canHandOver: true, items: [] } } });
        expect(rowOf(itemId).status).toBe('closed');
        await handOver(MEMBER, mine._id);
        await claim(agent(OTHER), itemId);
        expect(await takeBack(OWNER, itemId)).toMatchObject({ code: 200 });
        expect(await queue(agent(OTHER))).toEqual([]);
    });

    it('refuses a finding nobody holds, an item the person cannot open, an API token and an agent\'s token', async () => {
        const hidden = task({ TaskKey: 'HID-1', sprintId: S_SECRET, sprintArray: { id: S_SECRET, name: 'Secret' }, AssigneeUserId: [] });
        const { itemId } = await orphanItem();
        const secret = String(stored().find((row) => row.taskId === String(hidden._id))._id);
        expect(await takeBack(MEMBER, itemId)).toMatchObject({ code: 409 });
        await claim(agent(OTHER), itemId);
        await claim(agent(OTHER, TOKEN_2), secret);
        expect(await takeBack(MEMBER, secret)).toMatchObject({ code: 404 });
        expect(await takeBack(GUEST, itemId)).toMatchObject({ code: 404 });
        expect(await takeBack(OWNER, itemId, { apiToken: { _id: TOKEN, userId: OWNER, name: 'Script' } })).toMatchObject({ code: 403 });
        expect(await takeBack(OWNER, itemId, { apiToken: { _id: TOKEN, kind: 'agent', userId: OWNER, name: 'CLI' } })).toMatchObject({ code: 403 });
        expect(rowOf(itemId).claim.userId).toBe(OTHER);
        expect(rowOf(secret).claim.userId).toBe(OTHER);
    });
});

describe('a task a lead routed to a role through the dispatcher', () => {
    const TRIAGER = 'it-company/bug-triager';
    const routed = async (uid, over = {}) => {
        const routedTask = task({ TaskKey: 'OPN-BUG', ...over });
        mockDb.seed(SCHEMA_TYPE.ASSIGNMENT_RULES, { projectId: P_OPEN, dispatcher: { mode: 'suggest', roles: [TRIAGER], rules: [{ role: TRIAGER, when: { taskTypeKeys: [2] } }] } });
        const decision = mockDb.seed(SCHEMA_TYPE.DISPATCH_DECISIONS, {
            taskId: String(routedTask._id), projectId: P_OPEN, state: 'suggested', mode: 'suggest', role: TRIAGER, source: 'rule', ruleIndex: 0, agentId: null, createdAt: new Date(),
        });
        await require('../Modules/AssignmentRules/dispatcher/decisions').accept(CID, { id: uid }, String(routedTask._id), String(decision._id));
        return String(stored().find((row) => row.taskId === String(routedTask._id))._id);
    };

    beforeEach(() => { process.env.DISPATCHER = 'on'; });
    afterEach(() => { delete process.env.DISPATCHER; });

    it('is in that role\'s queue with the manager off, can be claimed and released, and finished it leaves', async () => {
        const itemId = await routed(OWNER);
        expect(project(P_OPEN).agentManager).toBeUndefined();
        expect(rowOf(itemId)).toMatchObject({ rule: HANDED_OVER, status: 'open', facts: { role: TRIAGER, agentId: '' } });
        expect(await queue(agent(OWNER), { role: TRIAGER })).toMatchObject([{ itemId, kind: HANDED_OVER, key: 'OPN-BUG', role: TRIAGER, handedOverBy: OWNER }]);
        expect(await queue(agent(OWNER))).toMatchObject([{ itemId }]);
        expect(await queue(agent(OWNER), { role: 'it-company/code-reviewer' })).toEqual([]);
        expect(await claim(agent(OWNER), itemId)).toMatchObject({ ok: true });
        expect(rowOf(itemId).claim).toMatchObject({ userId: OWNER });
        expect(await queue(agent(OWNER, TOKEN_2), { role: TRIAGER })).toEqual([]);
        expect(await release(agent(OWNER), itemId)).toMatchObject({ ok: true });
        expect(rowOf(itemId).claim).toBeUndefined();
        await claim(agent(OWNER), itemId);
        expect(await release(agent(OWNER), itemId, true)).toMatchObject({ ok: true });
        expect(rowOf(itemId)).toMatchObject({ status: 'closed', leftQueue: { why: 'finished' } });
        expect(await queue(agent(OWNER), { role: TRIAGER })).toEqual([]);
    });

    it('marks the task as held on its line and in lists with the manager off, to those who can open it, until agents are paused', async () => {
        const itemId = await routed(OTHER, { TaskKey: 'HID-BUG', sprintId: S_SECRET, sprintArray: { id: S_SECRET, name: 'Secret' } });
        const taskId = rowOf(itemId).taskId;
        expect((await taskLine(OTHER, taskId)).body.data).toMatchObject({ on: true, canHandOver: false, items: [{ id: itemId, rule: HANDED_OVER, claim: null }] });
        await claim(agent(OTHER), itemId);
        expect((await taskLine(OTHER, taskId)).body.data.items).toMatchObject([{ id: itemId, claim: { name: expect.any(String) } }]);
        expect(await workQueue.heldTasks(CID, OTHER)).toMatchObject([{ taskId, projectId: P_OPEN }]);
        expect(await workQueue.heldTasks(CID, MEMBER)).toEqual([]);
        expect((await taskLine(MEMBER, taskId)).body.data).toMatchObject({ on: false, items: [] });
        project(P_OPEN).agentLimits = { paused: true };
        expect(await workQueue.heldTasks(CID, OTHER)).toEqual([]);
        expect((await taskLine(OTHER, taskId)).body.data).toMatchObject({ on: false, items: [] });
    });

    it('leaves the line of a task nobody routed empty with the manager off', async () => {
        const plainTask = task({ TaskKey: 'OPN-PLAIN' });
        expect((await taskLine(OWNER, plainTask._id)).body.data).toMatchObject({ on: false, canHandOver: false, items: [] });
    });

    it('stays out of reach of a person who cannot open the task, and of a paused project', async () => {
        const itemId = await routed(OTHER, { TaskKey: 'HID-BUG', sprintId: S_SECRET, sprintArray: { id: S_SECRET, name: 'Secret' } });
        expect(await queue(agent(MEMBER), { role: TRIAGER })).toEqual([]);
        expect(await claim(agent(MEMBER), itemId)).toMatchObject({ error: workQueue.REFUSAL.NO_ITEM });
        expect(rowOf(itemId).claim).toBeUndefined();
        expect(await queue(agent(OTHER), { role: TRIAGER })).toMatchObject([{ itemId }]);
        project(P_OPEN).agentLimits = { paused: true };
        expect(await queue(agent(OTHER), { role: TRIAGER })).toEqual([]);
    });
});

describe('the stored fields', () => {
    it('are declared, so a strict schema keeps them', () => {
        expect(Object.keys(projectFindingsSchema.paths)).toEqual(expect.arrayContaining(['claim', 'leftQueue']));
    });
});
