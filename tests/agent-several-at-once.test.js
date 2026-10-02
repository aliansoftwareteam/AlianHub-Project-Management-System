/* Task 047, T-5: several agents at once. One item per connected agent, a bounded number of agents at work in a
   project, "changed since you read it" on both agent paths, and a pause that stops agents and never people. */
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
jest.mock('../Modules/Agents/engine/graph', () => ({ runGraph: jest.fn(async () => ({ status: 'abandoned' })) }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpManageWorld');
const socketEmitter = require('../event/socketEventEmitter');
const actions = require('../Modules/Agents/actions');
const runs = require('../Modules/Agents/runs');
const projectPolicy = require('../Modules/Agents/projectPolicy');
const projectLimits = require('../Modules/Agents/projectLimits');
const taskReads = require('../Modules/Agents/taskReads');
const controller = require('../Modules/Agents/projectLimitsController');
const { RULE } = require('../Modules/Agents/manager/rules');
const dailyLook = require('../Modules/Agents/manager/dailyLook');
const workQueue = require('../Modules/Agents/manager/workQueue');
const server = require('../Modules/Mcp/server');
const { projectFindingsSchema, agentWorkMarksSchema } = require('../utils/mongo-handler/createSchema');

const { CID, OWNER, ADMIN, MEMBER, OTHER, OUTSIDER, TOKEN, P_OPEN, S_OPEN, TASKS_GRANT, settle } = world;
const { seed, rows, rpcThrough } = world.create(mockDb);
const rpc = rpcThrough(server);
const GUEST = OUTSIDER;
const { REFUSAL } = workQueue;
const PAUSED = projectLimits.REASON.PAUSED;

const WEDNESDAY = new Date('2026-10-07T09:00:00Z');
const day = (ymd) => new Date(`${ymd}T00:00:00Z`);
const tokenId = (n) => `6f00000000000000000002${String(n).padStart(2, '0')}`;

/* A connection is one token acting for one person. */
const agent = (n, uid = OWNER) => world.ctx(uid, {
    actor: { kind: 'agent', userId: uid, agentName: 'Claude', viaAccount: 'personal', tokenId: tokenId(n) },
    token: { _id: tokenId(n), userId: uid, scopes: ['read', 'write'], grants: [TASKS_GRANT], active: true },
});
const inProduct = (uid = OWNER) => ({ kind: 'agent', userId: uid, agentId: '6f0000000000000000000a91', agentName: 'Triage', runId: '6f0000000000000000000a92', viaAccount: 'workspace', tokenId: null });

const project = () => rows(SCHEMA_TYPE.PROJECTS).find((row) => String(row._id) === P_OPEN);
const findings = () => rows(SCHEMA_TYPE.PROJECT_FINDINGS);
const rowOf = (itemId) => findings().find((row) => String(row._id) === String(itemId));
const heldRows = () => findings().filter((row) => row.claim && new Date(row.claim.until) > new Date());
const taskRow = (id) => rows(SCHEMA_TYPE.TASKS).find((row) => String(row._id) === String(id));

let n = 0;
const orphan = () => {
    n += 1;
    return mockDb.seed(SCHEMA_TYPE.TASKS, {
        TaskKey: `CASE-${n}`, TaskName: `Case ${n}`, CompanyId: CID, ProjectID: P_OPEN, sprintId: S_OPEN, sprintArray: { id: S_OPEN, name: 'Sprint 1' },
        AssigneeUserId: [], watchers: [], isParentTask: true, deletedStatusKey: 0, status: { key: 2, text: 'In Progress', type: 'active' }, statusType: 'active', statusKey: 2,
        totalEstimatedTime: 60, updatedAt: day('2026-10-06'), createdAt: day('2026-09-01'), DueDate: day('2026-11-20'), relations: [], rawDescription: 'before',
    });
};

/* That many tasks nobody owns, each an item of the queue once the day's look has found it. */
const items = async (count) => {
    const tasks = Array.from({ length: count }, orphan);
    project().agentManager = { on: true };
    await dailyLook.runForCompany(CID, WEDNESDAY);
    return tasks.map((task) => ({ taskId: String(task._id), itemId: String(findings().find((row) => row.rule === RULE.NO_OWNER && row.taskId === String(task._id))._id) }));
};

const claim = (caller, itemId) => rpc(caller, 'queue.claim', { itemId });
const release = (caller, itemId, finished) => rpc(caller, 'queue.release', { itemId, ...(finished === undefined ? {} : { finished }) });
const listed = async (caller) => (await rpc(caller, 'queue.list', {})).items;
const read = (caller, taskId) => rpc(caller, 'task.get', { taskId });
const comment = (caller, taskId, body = 'Looks ready') => rpc(caller, 'task.comment', { taskId, body });
/* The fake keeps no timestamps of its own, so a later change is written as the next second on the task's stamp. */
const changedByAPerson = (taskId) => { taskRow(taskId).updatedAt = new Date(new Date(taskRow(taskId).updatedAt).getTime() + 1000); };
const refusals = (reason) => rows(SCHEMA_TYPE.AUDIT_LOGS).filter((row) => row.action === 'agent.action_refused' && String(row.meta.reason || '').includes(reason));

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
const request = (uid, body, extra = {}) => ({
    uid, method: 'PUT', originalUrl: `/api/v2/agents/project-limits/${P_OPEN}`, url: `/api/v2/agents/project-limits/${P_OPEN}`,
    headers: { companyid: CID }, params: { projectId: P_OPEN }, body, ip: '1.1.1.1', ...extra,
});
const put = (uid, body, extra) => through(controller.putProjectLimits, request(uid, body, extra));
const get = (uid, extra) => through(controller.getProjectLimits, { ...request(uid, undefined, extra), method: 'GET' });

beforeAll(() => {
    mockDb.uniqueFromSchema(SCHEMA_TYPE.PROJECT_FINDINGS, projectFindingsSchema);
    mockDb.uniqueFromSchema(SCHEMA_TYPE.AGENT_WORK_MARKS, agentWorkMarksSchema);
});

beforeEach(() => {
    jest.clearAllMocks();
    n = 0;
    seed();
    process.env.MCP_TOOLS_WORK = 'on';
    rows(SCHEMA_TYPE.TASKS).filter((row) => String(row.ProjectID) === P_OPEN)
        .forEach((row) => Object.assign(row, { AssigneeUserId: [OTHER], totalEstimatedTime: 60, updatedAt: day('2026-10-06'), DueDate: day('2026-11-20') }));
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: GUEST, roleType: 0, status: 2, isDelete: false });
});
afterEach(settle);
afterAll(() => { delete process.env.MCP_TOOLS_WORK; delete process.env.MCP_TOOLS_MANAGE; });

describe('one item per agent at a time', () => {
    it('refuses a second item to a connection that holds one, and hands it out once the first is given back', async () => {
        const [first, second] = await items(2);
        expect(await claim(agent(1), first.itemId)).toMatchObject({ ok: true });
        expect(await claim(agent(1), second.itemId)).toMatchObject({ isError: true, error: REFUSAL.ONE_AT_A_TIME });
        expect(rowOf(second.itemId).claim).toBeUndefined();
        expect(await release(agent(1), first.itemId)).toMatchObject({ ok: true });
        expect(await claim(agent(1), second.itemId)).toMatchObject({ ok: true });
    });

    it('keeps its own item longer, and takes another once its claim has run out or a person took the item back', async () => {
        const [first, second, third] = await items(3);
        await claim(agent(1), first.itemId);
        expect(await claim(agent(1), first.itemId)).toMatchObject({ ok: true });
        rowOf(first.itemId).claim.until = new Date(Date.now() - 1000);
        expect(await claim(agent(1), second.itemId)).toMatchObject({ ok: true });
        expect((await workQueue.takeBack(CID, OWNER, second.itemId)).error).toBeUndefined();
        expect(await claim(agent(1), third.itemId)).toMatchObject({ ok: true });
    });

    it('gives a connection that asks for two items at the same moment exactly one', async () => {
        const [first, second] = await items(2);
        const outcomes = await Promise.all([claim(agent(1), first.itemId), claim(agent(1), second.itemId)]);
        expect(outcomes.filter((out) => out.ok === true)).toHaveLength(1);
        expect(outcomes.filter((out) => out.error === REFUSAL.ONE_AT_A_TIME)).toHaveLength(1);
        expect(heldRows()).toHaveLength(1);
    });

    it('lets two connections of one person each hold an item', async () => {
        const [first, second] = await items(2);
        expect(await claim(agent(1), first.itemId)).toMatchObject({ ok: true });
        expect(await claim(agent(2), second.itemId)).toMatchObject({ ok: true });
    });
});

describe('how many agents work in a project at once', () => {
    it('is three unless the project says otherwise', async () => {
        expect(await projectLimits.read(CID, P_OPEN)).toEqual({ atOnce: 3, paused: false, directTasks: 10 });
        project().agentLimits = { atOnce: 99, paused: 'yes' };
        expect(await projectLimits.read(CID, P_OPEN)).toEqual({ atOnce: 3, paused: false, directTasks: 10 });
    });

    it('at the limit a fourth agent is told to wait, holds nothing, and gets work when one finishes', async () => {
        const queue = await items(4);
        for (const index of [0, 1, 2]) {
            // eslint-disable-next-line no-await-in-loop
            expect(await claim(agent(index + 1), queue[index].itemId)).toMatchObject({ ok: true });
        }
        expect(await claim(agent(4), queue[3].itemId)).toMatchObject({ isError: true, error: REFUSAL.PROJECT_FULL });
        expect(rowOf(queue[3].itemId).claim).toBeUndefined();
        expect(heldRows()).toHaveLength(3);
        expect(await release(agent(2), queue[1].itemId, true)).toMatchObject({ ok: true });
        expect(await claim(agent(4), queue[3].itemId)).toMatchObject({ ok: true });
        expect(heldRows()).toHaveLength(3);
    });

    it('of four agents asking at the same moment exactly three get an item', async () => {
        const queue = await items(4);
        const outcomes = await Promise.all(queue.map((item, index) => claim(agent(index + 1), item.itemId)));
        expect(outcomes.filter((out) => out.ok === true)).toHaveLength(3);
        expect(outcomes.filter((out) => out.error === REFUSAL.PROJECT_FULL)).toHaveLength(1);
        expect(heldRows()).toHaveLength(3);
        expect(new Set(heldRows().map((row) => row.claim.by)).size).toBe(3);
    });

    it('a place whose claim ran out is free, and two agents reaching for it get it once', async () => {
        project().agentLimits = { atOnce: 1 };
        const queue = await items(3);
        await claim(agent(1), queue[0].itemId);
        rowOf(queue[0].itemId).claim.until = new Date(Date.now() - 1000);
        const outcomes = await Promise.all([claim(agent(2), queue[1].itemId), claim(agent(3), queue[2].itemId)]);
        expect(outcomes.filter((out) => out.ok === true)).toHaveLength(1);
        expect(outcomes.filter((out) => out.error === REFUSAL.PROJECT_FULL)).toHaveLength(1);
        expect(heldRows()).toHaveLength(1);
    });

    it('an in-product agent running in the project fills a place, and frees it when its run ends', async () => {
        const queue = await items(3);
        const run = mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: 'a1', agentName: 'Triage', projectId: P_OPEN, taskId: queue[0].taskId, status: 'running', startedAt: new Date() });
        expect(await claim(agent(1), queue[0].itemId)).toMatchObject({ ok: true });
        expect(await claim(agent(2), queue[1].itemId)).toMatchObject({ ok: true });
        expect(await claim(agent(3), queue[2].itemId)).toMatchObject({ isError: true, error: REFUSAL.PROJECT_FULL });
        rows(SCHEMA_TYPE.AGENT_RUNS).find((row) => String(row._id) === String(run._id)).status = 'done';
        expect(await claim(agent(3), queue[2].itemId)).toMatchObject({ ok: true });
    });

    it('lowering the limit takes no item away, and holds the next agent', async () => {
        const queue = await items(3);
        await claim(agent(1), queue[0].itemId);
        await claim(agent(2), queue[1].itemId);
        project().agentLimits = { atOnce: 1 };
        expect(await claim(agent(2), queue[1].itemId)).toMatchObject({ ok: true });
        expect(await claim(agent(3), queue[2].itemId)).toMatchObject({ isError: true, error: REFUSAL.PROJECT_FULL });
        expect(heldRows()).toHaveLength(2);
    });

    it('the tasks marked as worked on are the items held, one for each agent at work', async () => {
        const queue = await items(3);
        await claim(agent(1), queue[0].itemId);
        await claim(agent(2), queue[1].itemId);
        const held = await workQueue.heldTasks(CID, OWNER);
        expect(held.map((row) => row.taskId).sort()).toEqual([queue[0].taskId, queue[1].taskId].sort());
        expect(held.every((row) => row.projectId === P_OPEN)).toBe(true);
    });
});

describe('changed since you read it', () => {
    it('a connected agent that read a task is refused once a person changed it, nothing is written, and it goes on after reading again', async () => {
        const [{ taskId }] = await items(1);
        expect(await read(agent(1), taskId)).not.toMatchObject({ isError: true });
        expect(await comment(agent(1), taskId, 'First')).toMatchObject({ ok: true });
        changedByAPerson(taskId);
        const before = JSON.stringify([rows(SCHEMA_TYPE.TASKS), rows(SCHEMA_TYPE.COMMENTS)]);
        const refused = await comment(agent(1), taskId, 'Second');
        expect(refused).toMatchObject({ refused: true, reason: taskReads.REFUSAL.CHANGED });
        expect(JSON.stringify([rows(SCHEMA_TYPE.TASKS), rows(SCHEMA_TYPE.COMMENTS)])).toBe(before);
        expect(refusals('changed since you read it')).toHaveLength(1);
        await read(agent(1), taskId);
        expect(await comment(agent(1), taskId, 'Second')).toMatchObject({ ok: true });
        expect(rows(SCHEMA_TYPE.COMMENTS)).toHaveLength(2);
    });

    it('a change by another agent counts the same, and the agent that made it is not held by its own change', async () => {
        const [{ taskId }] = await items(1);
        await read(agent(1), taskId);
        await read(agent(2), taskId);
        expect(await comment(agent(2), taskId, 'From the second agent')).toMatchObject({ ok: true });
        changedByAPerson(taskId);
        await taskReads.saw(CID, agent(2).actor, taskId);
        expect(await comment(agent(1), taskId)).toMatchObject({ refused: true, reason: taskReads.REFUSAL.CHANGED });
        expect(await comment(agent(2), taskId, 'Again')).toMatchObject({ ok: true });
    });

    it('an in-product agent is held the same way from the moment its run read the task', async () => {
        const [{ taskId }] = await items(1);
        const change = { companyId: CID, action: 'task.comment', params: { taskId, body: 'Reviewed' }, actor: inProduct() };
        await runs.executeSkill(CID, { _id: inProduct().runId }, { _id: inProduct().agentId }, { ...taskRow(taskId) }, { actor: inProduct() });
        expect((await actions.perform(change)).auditId).toBeTruthy();
        changedByAPerson(taskId);
        await expect(actions.perform(change)).rejects.toMatchObject({ name: 'RefusedError', message: taskReads.REFUSAL.CHANGED });
        expect(rows(SCHEMA_TYPE.COMMENTS)).toHaveLength(1);
    });

    it('a change a person approved is the person\'s own and is not held, and neither is an agent that never read the task', async () => {
        const [{ taskId }] = await items(1);
        const change = { companyId: CID, action: 'task.comment', params: { taskId, body: 'Reviewed' }, actor: inProduct() };
        expect((await actions.perform(change)).auditId).toBeTruthy();
        await taskReads.saw(CID, inProduct(), taskId, taskRow(taskId).updatedAt);
        changedByAPerson(taskId);
        expect((await actions.perform({ ...change, approved: true })).auditId).toBeTruthy();
    });

    it('of two agents changing one task at the same moment, one is told another agent is changing it', async () => {
        const [{ taskId }] = await items(1);
        await read(agent(1), taskId);
        await read(agent(2), taskId);
        const outcomes = await Promise.all([comment(agent(1), taskId, 'One'), comment(agent(2), taskId, 'Two')]);
        expect(outcomes.filter((out) => out.ok === true)).toHaveLength(1);
        expect(outcomes.filter((out) => out.refused === true && out.reason === taskReads.REFUSAL.BUSY)).toHaveLength(1);
        expect(rows(SCHEMA_TYPE.COMMENTS)).toHaveLength(1);
    });

    it('taking and giving back a queue item is not a change to the task', async () => {
        const [{ taskId, itemId }] = await items(1);
        await read(agent(1), taskId);
        changedByAPerson(taskId);
        expect(await claim(agent(1), itemId)).toMatchObject({ ok: true });
        expect(await release(agent(1), itemId)).toMatchObject({ ok: true });
    });
});

describe('pause all', () => {
    const pause = () => put(OWNER, { paused: true });

    it('takes every item out of the agents\' hands, hands out nothing, and refuses a claim in plain words', async () => {
        const queue = await items(2);
        await claim(agent(1), queue[0].itemId);
        expect(await pause()).toMatchObject({ code: 200, body: { data: { limits: { paused: true } } } });
        expect(heldRows()).toHaveLength(0);
        expect(await workQueue.heldTasks(CID, OWNER)).toEqual([]);
        expect(await listed(agent(1))).toEqual([]);
        const refused = await claim(agent(2), queue[1].itemId);
        expect(refused).toMatchObject({ refused: true, reason: PAUSED });
        expect(refused.reason).not.toMatch(/waits for a person/);
        expect(rowOf(queue[1].itemId).claim).toBeUndefined();
    });

    it('refuses every agent write in the project, connected and in-product, and leaves an approved change and people alone', async () => {
        const [{ taskId }] = await items(1);
        await pause();
        expect(await comment(agent(1), taskId)).toMatchObject({ refused: true, reason: PAUSED });
        const change = { companyId: CID, action: 'task.comment', params: { taskId, body: 'Reviewed' } };
        await expect(actions.perform({ ...change, actor: inProduct() })).rejects.toMatchObject({ name: 'RefusedError', message: PAUSED });
        expect(rows(SCHEMA_TYPE.COMMENTS)).toHaveLength(0);
        expect(await projectPolicy.ask({ ...change, actor: inProduct() })).toMatchObject({ decision: projectPolicy.DECISION.REFUSE, paused: true });
        expect(await projectPolicy.ask({ ...change, actor: inProduct(), approved: true })).toMatchObject({ decision: projectPolicy.DECISION.ACT });
        expect(await projectPolicy.ask({ ...change, actor: { kind: 'human', userId: MEMBER } })).toMatchObject({ decision: projectPolicy.DECISION.ACT });
        expect((await actions.perform({ ...change, actor: inProduct(), approved: true })).auditId).toBeTruthy();
    });

    it('stops the in-product runs of the project, starts no new one there, and leaves other projects alone', async () => {
        const here = mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: 'a1', agentName: 'Triage', projectId: P_OPEN, status: 'running', startedAt: new Date() });
        const elsewhere = mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: 'a1', agentName: 'Triage', projectId: world.P_DEST, status: 'running', startedAt: new Date() });
        await pause();
        const statusOf = (run) => rows(SCHEMA_TYPE.AGENT_RUNS).find((row) => String(row._id) === String(run._id)).status;
        expect(statusOf(here)).toBe('stopped');
        expect(statusOf(elsewhere)).toBe('running');
        expect(await runs.pausedIn(CID, P_OPEN)).toMatch(/paused in this project/);
        expect(await runs.pausedIn(CID, world.P_DEST)).toBe('');
        expect(await runs.canStart({ _id: 'a1', paused: false }, { projectId: P_OPEN, companyId: CID, depth: 99 })).toMatchObject({ ok: false });
    });

    it('resuming hands work out again', async () => {
        const [{ itemId, taskId }] = await items(1);
        await pause();
        expect(await put(ADMIN, { paused: false })).toMatchObject({ code: 200, body: { data: { limits: { paused: false } } } });
        expect((await listed(agent(1))).map((item) => item.itemId)).toContain(itemId);
        expect(await claim(agent(1), itemId)).toMatchObject({ ok: true });
        expect(await comment(agent(1), taskId)).toMatchObject({ ok: true });
    });
});

describe('who may change a project\'s limits for agents', () => {
    const changes = () => rows(SCHEMA_TYPE.AUDIT_LOGS).filter((row) => row.action === 'agent.project_policy_changed');

    it.each([['an owner', OWNER], ['an admin', ADMIN]])('%s changes them, and the change is recorded and announced to the company', async (_who, uid) => {
        const out = await put(uid, { atOnce: 5 });
        expect(out).toMatchObject({ code: 200, body: { status: true, data: { limits: { atOnce: 5, paused: false }, defaults: { atOnce: 3, paused: false }, atOnceRange: { min: 1, max: 20 }, canEdit: true } } });
        expect(project().agentLimits).toMatchObject({ atOnce: 5, paused: false, updatedBy: uid });
        expect(changes()).toHaveLength(1);
        expect(changes()[0]).toMatchObject({ actorId: uid, entityType: 'project', entityId: P_OPEN, meta: { from: { agentsAtOnce: 3, agentsPaused: false }, to: { agentsAtOnce: 5, agentsPaused: false } } });
        expect(socketEmitter.emit).toHaveBeenCalledWith('update', expect.objectContaining({ module: 'project', companyId: CID, updatedFields: { agentLimits: expect.objectContaining({ atOnce: 5 }) } }));
    });

    it('a save tells the company\'s open browsers, which no project event reaches, and names no project', async () => {
        await put(OWNER, { paused: true });
        const told = socketEmitter.emit.mock.calls.filter(([event, change]) => event === 'update' && change.module === 'agent' && change.data.kind === 'limits');
        expect(told).toHaveLength(1);
        expect(told[0][1]).toMatchObject({ type: 'update', companyId: CID, data: { kind: 'limits' } });
        expect(JSON.stringify(told[0][1])).not.toContain(P_OPEN);
    });

    it('a refused save tells nobody', async () => {
        await put(MEMBER, { paused: true });
        await put(OWNER, { atOnce: 99 });
        expect(socketEmitter.emit.mock.calls.filter(([, change]) => change && change.module === 'agent' && change.data.kind === 'limits')).toEqual([]);
    });

    it('a pause keeps who paused and when, and the limit beside it', async () => {
        await put(OWNER, { atOnce: 2 });
        await put(ADMIN, { paused: true });
        expect(project().agentLimits).toMatchObject({ atOnce: 2, paused: true, pausedBy: ADMIN, pausedAt: expect.any(Date) });
        expect(changes()[1].meta).toMatchObject({ from: { agentsPaused: false }, to: { agentsPaused: true } });
    });

    it.each([['a member', MEMBER], ['a guest', GUEST]])('%s is refused, and reads them without being offered the change', async (_who, uid) => {
        expect(await put(uid, { atOnce: 5 })).toMatchObject({ code: 403, body: { status: false } });
        expect(await put(uid, { paused: true })).toMatchObject({ code: 403, body: { status: false } });
        expect(project().agentLimits).toBeUndefined();
        expect(changes()).toHaveLength(0);
        if (uid === MEMBER) expect(await get(uid)).toMatchObject({ code: 200, body: { data: { limits: { atOnce: 3, paused: false }, canEdit: false } } });
    });

    it('an API token is refused, whoever holds it', async () => {
        expect(await put(OWNER, { atOnce: 5 }, { apiToken: { _id: TOKEN, userId: OWNER, name: 'Script' } })).toMatchObject({ code: 403, body: { status: false } });
        expect(project().agentLimits).toBeUndefined();
        expect(await get(OWNER, { apiToken: { _id: TOKEN, userId: OWNER, name: 'Script' } })).toMatchObject({ code: 200, body: { data: { canEdit: false } } });
    });

    it('an agent\'s token is refused, whoever holds it, and the attempt is recorded', async () => {
        const out = await put(OWNER, { paused: false, atOnce: 20 }, { apiToken: { _id: TOKEN, kind: 'agent', userId: OWNER, name: 'CLI' } });
        expect(out).toMatchObject({ code: 403, body: { status: false } });
        expect(project().agentLimits).toBeUndefined();
        expect(rows(SCHEMA_TYPE.AUDIT_LOGS).filter((row) => row.action === 'agent.action_refused' && row.meta.action === 'project.agent_limits.edit')).toHaveLength(1);
    });

    it('refuses a value out of range, an empty change, a bad id and a project the caller cannot open', async () => {
        for (const body of [{ atOnce: 0 }, { atOnce: 21 }, { atOnce: 2.5 }, { atOnce: '3' }, { paused: 'yes' }, {}]) {
            // eslint-disable-next-line no-await-in-loop
            expect(await put(OWNER, body)).toMatchObject({ code: 400 });
        }
        expect(project().agentLimits).toBeUndefined();
        expect(await through(controller.putProjectLimits, { ...request(OWNER, { atOnce: 2 }), params: { projectId: 'nope' } })).toMatchObject({ code: 400 });
        expect(await through(controller.putProjectLimits, { ...request(OWNER, { atOnce: 2 }), params: { projectId: '6f0000000000000000000dff' } })).toMatchObject({ code: 404 });
        expect(await through(controller.getProjectLimits, { ...request(MEMBER), method: 'GET', params: { projectId: world.P_PRIVATE } })).toMatchObject({ code: 404 });
    });
});
