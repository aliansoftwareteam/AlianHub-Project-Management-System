/* Task 047, decision 6: "anything wider than one task waits" also holds across single-task calls. A connection's own
   changes in a project are counted by task, and past the project's count a change to one more task waits for a person. */
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
jest.mock('../Modules/Knowledge/memory/publish', () => mockStub());
jest.mock('../Modules/Agents/triggers', () => ({ fromComment: jest.fn(async () => null), TRIGGER: { MENTION: 'mention', ASSIGN: 'assign' } }));
jest.mock('../Modules/AI/feedback', () => ({ fromDecline: jest.fn(async () => null) }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpManageWorld');
const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const persistence = require('../Modules/AICore/persistence');
const actions = require('../Modules/Agents/actions');
const proposals = require('../Modules/Agents/proposals');
const projectPolicy = require('../Modules/Agents/projectPolicy');
const projectLimits = require('../Modules/Agents/projectLimits');
const directChanges = require('../Modules/Agents/directChanges');
const controller = require('../Modules/Agents/projectLimitsController');
const guard = require('../Modules/Agents/guard');
const server = require('../Modules/Mcp/server');
const { agentWorkMarksSchema } = require('../utils/mongo-handler/createSchema');

mongoHelper.getTotalSprintCount = async () => true;

const { CID, OWNER, MEMBER, TOKEN, P_OPEN, P_DEST, S_OPEN, S_DEST, TASKS_GRANT, settle, ctx, olderToken } = world;
const { seed, stored, rows, audits, rpcThrough } = world.create(mockDb);
const rpc = rpcThrough(server);
const store = persistence.useInMemory();

const { DECISION, DONE, CONNECTED } = projectPolicy;
const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const COUNT = 10;
const OTHER_TOKEN = '6f0000000000000000000202';
const WAITS = /already changed 10 tasks in this project in the last 10 minutes/;

const secondConnection = (uid = OWNER) => ctx(uid, {
    actor: { ...ctx(uid).actor, tokenId: OTHER_TOKEN },
    token: { ...ctx(uid).token, _id: OTHER_TOKEN },
});
const inProduct = (uid = OWNER) => ({ kind: 'agent', userId: uid, agentId: '6f0000000000000000000a91', agentName: 'Triage', runId: '6f0000000000000000000a92', viaAccount: 'workspace', tokenId: null });
const person = (uid) => ({ kind: 'human', userId: uid });

const proposalRows = () => rows(SCHEMA_TYPE.AGENT_PROPOSALS);
const project = (id = P_OPEN) => rows(SCHEMA_TYPE.PROJECTS).find((row) => String(row._id) === String(id));
const counts = () => rows(SCHEMA_TYPE.AGENT_WORK_MARKS).filter((row) => String(row.scope).startsWith('direct:'));
const nameOf = (task) => stored(task._id).TaskName;
const rename = (caller, task, title = 'Renamed') => rpc(caller, 'task.update', { taskId: String(task._id), title });
const comment = (caller, task, body = 'Looks ready') => rpc(caller, 'task.comment', { taskId: String(task._id), body });
const copyOf = (task, over) => {
    const copy = { ...stored(task._id), ...over };
    delete copy._id;
    return mockDb.seed(SCHEMA_TYPE.TASKS, copy);
};
const renameEach = async (caller, list) => {
    const outcomes = [];
    for (const task of list) outcomes.push(await rename(caller, task));
    return outcomes;
};
const older = (minutes, entries) => entries.forEach((entry) => { entry.at = new Date(new Date(entry.at).getTime() - minutes * MINUTE); });

const through = async (handlers, req) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(sent) { this.body = sent; return this; }, send(sent) { this.body = sent; return this; }, on() {} };
    let passed = false;
    for (const handler of [].concat(handlers)) {
        passed = false;
        await handler(req, res, () => { passed = true; });
        if (!passed) break;
    }
    await settle();
    return { passed, code: res.statusCode, body: res.body };
};
const limitsRequest = (uid, body) => ({
    uid, method: 'PUT', originalUrl: `/api/v2/agents/project-limits/${P_OPEN}`, url: `/api/v2/agents/project-limits/${P_OPEN}`,
    headers: { companyid: CID }, params: { projectId: P_OPEN }, body, ip: '1.1.1.1',
});
const putLimits = (uid, body) => through(controller.putProjectLimits, limitsRequest(uid, body));
const onTaskRoute = (task, extra = {}) => through(guard.taskPatchGuard((sent) => sent.task._id), {
    uid: OWNER, method: 'PATCH', originalUrl: '/api/v2/tasks', url: '/api/v2/tasks', headers: { companyid: CID },
    body: { action: 'updatePriority', task: { _id: String(task._id) } }, ip: '1.1.1.1', ...extra,
});
const agentToken = { apiToken: { _id: TOKEN, kind: 'agent', userId: OWNER, name: 'CLI' } };

let fx;
let tasks;

beforeAll(() => { mockDb.uniqueFromSchema(SCHEMA_TYPE.AGENT_WORK_MARKS, agentWorkMarksSchema); });

beforeEach(() => {
    jest.clearAllMocks();
    store.reset();
    fx = seed();
    mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS] = [];
    mockDb.store[SCHEMA_TYPE.AGENT_STANDING_APPROVALS] = [];
    mockDb.store[SCHEMA_TYPE.API_TOKENS] = [];
    mockDb.seed(SCHEMA_TYPE.API_TOKENS, { _id: TOKEN, userId: OWNER, name: 'Claude', active: true, scopes: ['read', 'write'], grants: [TASKS_GRANT], projectIds: [], expiresAt: new Date(Date.now() + DAY) });
    tasks = Array.from({ length: 14 }, (unused, at) => copyOf(fx.bug, { TaskKey: `BLK-${at + 1}`, TaskName: `Bulk ${at + 1}`, ProjectID: P_OPEN, sprintId: S_OPEN }));
});
afterEach(settle);
afterAll(() => { ['MCP_TOOLS_MANAGE', 'MCP_TOOLS_WORK', 'MCP_TOOLS_V2'].forEach((key) => { delete process.env[key]; }); });

describe('a connected agent that changes one task after another, in a project left at its default', () => {
    it('changes ten different tasks at once, and its change to an eleventh waits as a proposal', async () => {
        const first = await renameEach(ctx(OWNER), tasks.slice(0, COUNT));
        expect(first.map((out) => out.ok)).toEqual(Array(COUNT).fill(true));

        const out = await rename(ctx(OWNER), tasks[10]);
        expect(out).toMatchObject({ ok: false, pending: true, approval: 'pending' });
        expect(out.message).toMatch(/nothing has changed yet/);
        expect(out.message).toMatch(WAITS);
        expect(out.message).toMatch(/as one tasks\.batch call/);
        expect(nameOf(tasks[10])).toBe('Bulk 11');
        expect(proposalRows()).toHaveLength(1);
        expect(proposalRows()[0]).toMatchObject({ status: 'pending', source: 'mcp', requestedBy: OWNER, tokenId: TOKEN });
        expect(String(proposalRows()[0]._id)).toBe(out.proposalId);
        expect(proposalRows()[0].why).toMatch(WAITS);
        expect(audits('task.edit', 'applied')).toHaveLength(COUNT);
    });

    it('goes on changing a task it has already changed, however often', async () => {
        await renameEach(ctx(OWNER), tasks.slice(0, COUNT));
        expect(await rename(ctx(OWNER), tasks[10])).toMatchObject({ pending: true });
        expect(await rename(ctx(OWNER), tasks[3], 'Again')).toMatchObject({ ok: true });
        expect(await comment(ctx(OWNER), tasks[3])).toMatchObject({ ok: true });
        expect(await rename(ctx(OWNER), tasks[9], 'And again')).toMatchObject({ ok: true });
        expect([nameOf(tasks[3]), nameOf(tasks[9]), nameOf(tasks[10])]).toEqual(['Again', 'And again', 'Bulk 11']);
    });

    it('several changes to one task count as one task', async () => {
        for (let turn = 0; turn < COUNT + 2; turn += 1) {
            expect(await rename(ctx(OWNER), tasks[0], `Turn ${turn}`)).toMatchObject({ ok: true });
        }
        expect((await renameEach(ctx(OWNER), tasks.slice(1, COUNT))).map((out) => out.ok)).toEqual(Array(COUNT - 1).fill(true));
        expect(await rename(ctx(OWNER), tasks[10])).toMatchObject({ pending: true });
    });

    it('counts the last ten minutes: a task changed longer ago makes room for another', async () => {
        await renameEach(ctx(OWNER), tasks.slice(0, COUNT));
        expect(counts()).toHaveLength(1);
        older(11, counts()[0].changed.slice(0, 1));
        expect(await rename(ctx(OWNER), tasks[10])).toMatchObject({ ok: true });
        expect(await rename(ctx(OWNER), tasks[11])).toMatchObject({ pending: true });
        older(11, counts()[0].changed);
        expect((await renameEach(ctx(OWNER), tasks.slice(11, 14))).map((out) => out.ok)).toEqual([true, true, true]);
    });

    it('a task changed again inside the ten minutes stays counted from its last change', async () => {
        await renameEach(ctx(OWNER), tasks.slice(0, COUNT));
        older(9, counts()[0].changed);
        expect(await rename(ctx(OWNER), tasks[0], 'Once more')).toMatchObject({ ok: true });
        older(2, counts()[0].changed);
        expect(await rename(ctx(OWNER), tasks[10])).toMatchObject({ ok: true });
        expect((await renameEach(ctx(OWNER), tasks.slice(11, 13))).map((out) => out.ok)).toEqual([true, true]);
        expect(counts()[0].changed.map((entry) => entry.id)).toContain(`task:${String(tasks[0]._id)}`);
    });

    it('counts each connection on its own', async () => {
        await renameEach(ctx(OWNER), tasks.slice(0, COUNT));
        expect(await rename(ctx(OWNER), tasks[10])).toMatchObject({ pending: true });
        expect(await rename(secondConnection(), tasks[10], 'By the second')).toMatchObject({ ok: true });
        expect(nameOf(tasks[10])).toBe('By the second');
        expect(counts().map((row) => row.key).sort()).toEqual([`token:${OTHER_TOKEN}`, `token:${TOKEN}`].sort());
    });

    it('counts each project on its own', async () => {
        const elsewhere = copyOf(fx.bug, { TaskKey: 'DST-1', TaskName: 'Elsewhere', ProjectID: P_DEST, sprintId: S_DEST });
        await renameEach(ctx(OWNER), tasks.slice(0, COUNT));
        expect(await rename(ctx(OWNER), elsewhere, 'There')).toMatchObject({ ok: true });
        expect(await rename(ctx(OWNER), tasks[10])).toMatchObject({ pending: true });
    });

    it('counts a new task as a task of its own', async () => {
        for (let at = 0; at < COUNT; at += 1) {
            expect(await rpc(ctx(OWNER), 'task.create', { projectId: P_OPEN, title: `New ${at}` })).toMatchObject({ ok: true });
        }
        const out = await rpc(ctx(OWNER), 'task.create', { projectId: P_OPEN, title: 'One more' });
        expect(out).toMatchObject({ pending: true });
        expect(rows(SCHEMA_TYPE.TASKS).map((task) => task.TaskName)).not.toContain('One more');
    });

    it('tells a connection that has no batch tool to tell the person', async () => {
        for (const task of tasks.slice(0, COUNT)) {
            expect(await comment(olderToken(OWNER), task)).toMatchObject({ ok: true });
        }
        const out = await comment(olderToken(OWNER), tasks[10]);
        expect(out).toMatchObject({ pending: true });
        expect(out.message).toMatch(WAITS);
        expect(out.message).not.toMatch(/tasks\.batch/);
        expect(out.message).toMatch(/tell the person/);
        expect(rows(SCHEMA_TYPE.COMMENTS)).toHaveLength(COUNT);
    });

    it('of two changes made at the same moment for the last place, one is applied', async () => {
        await renameEach(ctx(OWNER), tasks.slice(0, COUNT - 1));
        const outcomes = await Promise.all([rename(ctx(OWNER), tasks[10], 'Raced'), rename(ctx(OWNER), tasks[11], 'Raced')]);
        expect(outcomes.filter((out) => out.ok === true)).toHaveLength(1);
        const [held] = outcomes.filter((out) => out.ok !== true);
        expect(held.pending === true || held.refused === true).toBe(true);
        expect(held.pending ? held.message : held.reason).toMatch(WAITS);
        expect([nameOf(tasks[10]), nameOf(tasks[11])].filter((name) => name === 'Raced')).toHaveLength(1);
        expect(counts()[0].changed).toHaveLength(COUNT);
    });

    it('gives the last place once when two calls reach for it together', async () => {
        const reach = (task) => directChanges.admit({ companyId: CID, projectId: P_OPEN, actor: ctx(OWNER).actor, params: { taskId: String(task._id) }, limit: 1, keep: true });
        const outcomes = await Promise.all([reach(tasks[0]), reach(tasks[1])]);
        expect(outcomes.map((out) => out.ok).sort()).toEqual([false, true]);
        expect(counts()).toHaveLength(1);
        expect(counts()[0].changed).toHaveLength(1);
    });

    it('reads and writes the count in the caller\'s company only', async () => {
        mockDb.calls.length = 0;
        await renameEach(ctx(OWNER), tasks.slice(0, COUNT + 1));
        const touched = mockDb.calls.filter((call) => call.type === SCHEMA_TYPE.AGENT_WORK_MARKS);
        expect(touched.length).toBeGreaterThan(COUNT);
        expect(touched.every((call) => call.companyId === CID)).toBe(true);
        expect(counts().every((row) => row.scope === `direct:${P_OPEN}` && row.key === `token:${TOKEN}`)).toBe(true);
    });
});

describe('what is held before the count is asked', () => {
    it('a paused project refuses the change, counted task or not, and files nothing', async () => {
        await renameEach(ctx(OWNER), tasks.slice(0, COUNT));
        project().agentLimits = { paused: true };
        for (const task of [tasks[10], tasks[0]]) {
            expect(await rename(ctx(OWNER), task, 'While paused')).toMatchObject({ refused: true, reason: projectLimits.REASON.PAUSED });
        }
        expect(proposalRows()).toHaveLength(0);
        expect([nameOf(tasks[10]), nameOf(tasks[0])]).not.toContain('While paused');
    });

    it('a close the project leaves to people is refused, not filed', async () => {
        project().agentPolicy = { done: DONE.NEVER };
        await renameEach(ctx(OWNER), tasks.slice(0, COUNT));
        expect(await rpc(ctx(OWNER), 'task.status.set', { taskId: String(tasks[10]._id), status: 'Done' })).toMatchObject({ refused: true, reason: projectPolicy.REASON.NEVER });
        expect(proposalRows()).toHaveLength(0);
    });
});

describe('who is not counted', () => {
    it('a change a person approved is applied past the count, and is not counted afterwards', async () => {
        await renameEach(ctx(OWNER), tasks.slice(0, COUNT));
        const waiting = await rename(ctx(OWNER), tasks[10], 'Approved');
        const approved = await proposals.approve(CID, waiting.proposalId, { decider: person(MEMBER), isPrivileged: false, ip: '' });
        await settle();
        expect(approved.error).toBeUndefined();
        expect(nameOf(tasks[10])).toBe('Approved');
        expect(counts()[0].changed).toHaveLength(COUNT);
        expect(counts()[0].changed.map((entry) => entry.id)).not.toContain(`task:${String(tasks[10]._id)}`);
    });

    it('a batch a person approved changes more tasks than the count at once', async () => {
        const out = await rpc(ctx(OWNER), 'tasks.batch', { reason: 'Tidy', operations: tasks.map((task) => ({ tool: 'task.update', arguments: { taskId: String(task._id), title: 'Together' } })) });
        expect(out).toMatchObject({ pending: true, waiting: tasks.length });
        expect(counts()).toHaveLength(0);
        const approved = await proposals.approve(CID, out.proposalId, { decider: person(MEMBER), isPrivileged: false, ip: '' });
        await settle();
        expect(approved.applied.map((change) => change.ok)).toEqual(Array(tasks.length).fill(true));
        expect(tasks.map(nameOf)).toEqual(Array(tasks.length).fill('Together'));
        expect(counts()).toHaveLength(0);
    });

    it('an in-product agent and a person are not counted or held', async () => {
        for (const task of tasks.slice(0, COUNT + 2)) {
            expect((await actions.perform({ companyId: CID, actor: inProduct(), action: 'task.comment', params: { taskId: String(task._id), body: 'Reviewed' } })).auditId).toBeTruthy();
        }
        expect(rows(SCHEMA_TYPE.COMMENTS)).toHaveLength(COUNT + 2);
        expect(counts()).toHaveLength(0);

        await renameEach(ctx(OWNER), tasks.slice(0, COUNT));
        const change = { companyId: CID, action: 'task.edit', params: { taskId: String(tasks[10]._id), fields: { TaskName: 'x' } } };
        expect(await projectPolicy.ask({ ...change, actor: ctx(OWNER).actor })).toMatchObject({ decision: DECISION.PROPOSE, manyTasks: true });
        expect(await projectPolicy.ask({ ...change, actor: ctx(OWNER).actor, approved: true })).toMatchObject({ decision: DECISION.ACT });
        expect(await projectPolicy.ask({ ...change, actor: inProduct() })).toMatchObject({ decision: DECISION.ACT });
        expect(await projectPolicy.ask({ ...change, actor: person(OWNER) })).toMatchObject({ decision: DECISION.ACT });
        expect((await onTaskRoute(tasks[10])).passed).toBe(true);
    });

    it('asking is not counting: only a change that is being applied takes a place', async () => {
        const change = (task) => ({ companyId: CID, actor: ctx(OWNER).actor, action: 'task.edit', params: { taskId: String(task._id), fields: { TaskName: 'x' } } });
        for (const task of tasks) {
            expect(await projectPolicy.ask(change(task))).toMatchObject({ decision: DECISION.ACT });
        }
        expect(counts()).toHaveLength(0);
    });

    it('taking and giving back a queue item changes no task, so neither is counted or held', async () => {
        await renameEach(ctx(OWNER), tasks.slice(0, COUNT));
        for (const action of ['queue.claim', 'queue.release']) {
            expect(await projectPolicy.ask({ companyId: CID, actor: ctx(OWNER).actor, action, params: { itemId: '6f0000000000000000000b01', projectId: P_OPEN }, applying: true })).toMatchObject({ decision: DECISION.ACT });
        }
        expect(counts()[0].changed).toHaveLength(COUNT);
    });
});

describe('an agent\'s token on the web app\'s own task route', () => {
    it('is counted with the same connection\'s tool calls, and refused past the count', async () => {
        for (const task of tasks.slice(0, COUNT)) {
            expect((await onTaskRoute(task, agentToken)).passed).toBe(true);
        }
        const refused = await onTaskRoute(tasks[10], agentToken);
        expect(refused).toMatchObject({ passed: false, code: 403 });
        expect(refused.body.message).toMatch(WAITS);
        expect(refused.body.message).toMatch(/a route cannot propose one/);
        expect((await onTaskRoute(tasks[2], agentToken)).passed).toBe(true);
        expect(await rename(ctx(OWNER), tasks[11])).toMatchObject({ pending: true });
    });
});

describe('"Always do this" and the count', () => {
    it('lets the agent through as before up to the count, and no further', async () => {
        project().agentPolicy = { done: DONE.YES, connected: CONNECTED.PROPOSE_ALL };
        mockDb.seed(SCHEMA_TYPE.AGENT_STANDING_APPROVALS, {
            projectId: P_OPEN, action: 'task.edit', tokenId: TOKEN, requestedBy: OWNER, agentId: `mcp:${TOKEN}`, agentName: 'Claude (MCP)', madeBy: MEMBER,
            madeAt: new Date(), expiresAt: new Date(Date.now() + 90 * DAY), status: 'active', uses: 0,
        });
        const first = await renameEach(ctx(OWNER), tasks.slice(0, COUNT));
        expect(first.every((out) => out.ok === true && typeof out.standingApprovalId === 'string')).toBe(true);
        const out = await rename(ctx(OWNER), tasks[10]);
        expect(out).toMatchObject({ pending: true });
        expect(out.message).toMatch(WAITS);
        expect(nameOf(tasks[10])).toBe('Bulk 11');
        expect(await rename(ctx(OWNER), tasks[4], 'Still mine')).toMatchObject({ ok: true, standingApprovalId: expect.any(String) });
    });
});

describe('the project\'s own count', () => {
    it('is ten unless the project says otherwise', async () => {
        expect(await projectLimits.read(CID, P_OPEN)).toEqual({ atOnce: 3, paused: false, directTasks: 10 });
        for (const directTasks of [0, 101, 2.5, '5', null]) {
            project().agentLimits = { directTasks };
            expect((await projectLimits.read(CID, P_OPEN)).directTasks).toBe(10);
        }
    });

    it('a lower count holds the agent sooner, and a higher one later', async () => {
        project().agentLimits = { directTasks: 2 };
        expect((await renameEach(ctx(OWNER), tasks.slice(0, 2))).map((out) => out.ok)).toEqual([true, true]);
        const out = await rename(ctx(OWNER), tasks[2]);
        expect(out).toMatchObject({ pending: true });
        expect(out.message).toMatch(/already changed 2 tasks in this project in the last 10 minutes/);
        project().agentLimits = { directTasks: 12 };
        expect((await renameEach(ctx(OWNER), tasks.slice(2, 12))).map((result) => result.ok)).toEqual(Array(10).fill(true));
        expect(await rename(ctx(OWNER), tasks[12])).toMatchObject({ pending: true });
    });

    it('an owner sets it from 1 to 100 through the limits route, beside the other limits, and the change is recorded', async () => {
        const out = await putLimits(OWNER, { directTasks: 25 });
        expect(out).toMatchObject({ code: 200, body: { status: true, data: {
            limits: { atOnce: 3, paused: false, directTasks: 25 }, defaults: { directTasks: 10 }, directTasksRange: { min: 1, max: 100 }, directTasksMinutes: 10, canEdit: true,
        } } });
        expect(project().agentLimits).toMatchObject({ directTasks: 25, updatedBy: OWNER });
        const [change] = rows(SCHEMA_TYPE.AUDIT_LOGS).filter((row) => row.action === 'agent.project_policy_changed');
        expect(change.meta).toMatchObject({ from: { agentsDirectTasks: 10 }, to: { agentsDirectTasks: 25 } });
        expect((await putLimits(OWNER, { atOnce: 5 })).body.data.limits).toMatchObject({ atOnce: 5, directTasks: 25 });
    });

    it('refuses a count out of range, and a member', async () => {
        for (const directTasks of [0, 101, 2.5, '5']) {
            expect(await putLimits(OWNER, { directTasks })).toMatchObject({ code: 400 });
        }
        expect(await putLimits(MEMBER, { directTasks: 100 })).toMatchObject({ code: 403 });
        expect(project().agentLimits).toBeUndefined();
    });
});
