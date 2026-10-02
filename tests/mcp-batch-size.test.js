/* Task 047, slice AI-1, job 7: one batch call takes fifty changes, and each of them is held to what a change of any batch is held to. */
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
jest.mock('../Modules/Knowledge/memory/publish', () => mockStub());
jest.mock('../Modules/Agents/triggers', () => ({ fromComment: jest.fn(async () => null), TRIGGER: { MENTION: 'mention', ASSIGN: 'assign' } }));
jest.mock('../Modules/AI/feedback', () => ({ fromDecline: jest.fn(async () => null) }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpManageWorld');
const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const persistence = require('../Modules/AICore/persistence');
const proposals = require('../Modules/Agents/proposals');
const projectPolicy = require('../Modules/Agents/projectPolicy');
const projectLimits = require('../Modules/Agents/projectLimits');
const taskReads = require('../Modules/Agents/taskReads');
const queue = require('../Modules/Inbox/helpers/approvalQueue');
const { BATCH_MAX } = require('../Modules/Mcp/manageTools');
const server = require('../Modules/Mcp/server');
const { agentWorkMarksSchema } = require('../utils/mongo-handler/createSchema');

mongoHelper.getTotalSprintCount = async () => true;

const { CID, OWNER, MEMBER, TOKEN, P_OPEN, S_OPEN, TASKS_GRANT, settle, ctx } = world;
const { rules, seed, stored, rows, audits, rpcThrough } = world.create(mockDb);
const rpc = rpcThrough(server);
const store = persistence.useInMemory();

const DAY = 24 * 60 * 60 * 1000;
const TASKS = BATCH_MAX / 2;

const proposalRows = () => rows(SCHEMA_TYPE.AGENT_PROPOSALS);
const project = () => rows(SCHEMA_TYPE.PROJECTS).find((row) => String(row._id) === P_OPEN);
const person = (uid) => ({ kind: 'human', userId: uid });
const nameOf = (task) => stored(task._id).TaskName;
const statusOf = (task) => stored(task._id).status.text;
const setStatus = (task, status) => ({ tool: 'task.status.set', arguments: { taskId: String(task._id), status } });
const rename = (task, title) => ({ tool: 'task.update', arguments: { taskId: String(task._id), title } });
const batch = (as, operations) => rpc(as, 'tasks.batch', { reason: 'Tidy the week', operations });
const approve = (id, uid = MEMBER) => proposals.approve(CID, id, { decider: person(uid), isPrivileged: false, ip: '' });
const copyOf = (task, over) => {
    const copy = { ...stored(task._id), ...over };
    delete copy._id;
    return mockDb.seed(SCHEMA_TYPE.TASKS, copy);
};

let fx;
let tasks;
/* Two changes for each task: the most one call takes. */
const fifty = () => [...tasks.map((task) => setStatus(task, 'To Do')), ...tasks.map((task, at) => rename(task, `Renamed ${at + 1}`))];
const untouched = () => expect(tasks.map((task) => [statusOf(task), nameOf(task)])).toEqual(tasks.map((task, at) => ['In Progress', `Bulk ${at + 1}`]));

beforeAll(() => { mockDb.uniqueFromSchema(SCHEMA_TYPE.AGENT_WORK_MARKS, agentWorkMarksSchema); });

beforeEach(() => {
    jest.clearAllMocks();
    store.reset();
    fx = seed();
    mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS] = [];
    mockDb.store[SCHEMA_TYPE.AGENT_STANDING_APPROVALS] = [];
    mockDb.store[SCHEMA_TYPE.API_TOKENS] = [];
    mockDb.seed(SCHEMA_TYPE.API_TOKENS, { _id: TOKEN, userId: OWNER, name: 'Claude', active: true, scopes: ['read', 'write'], grants: [TASKS_GRANT], projectIds: [], expiresAt: new Date(Date.now() + DAY) });
    tasks = Array.from({ length: TASKS }, (unused, at) => copyOf(fx.bug, { TaskKey: `BLK-${at + 1}`, TaskName: `Bulk ${at + 1}`, ProjectID: P_OPEN, sprintId: S_OPEN, updatedAt: new Date('2026-10-01T00:00:00Z') }));
});
afterEach(settle);
afterAll(() => { ['MCP_TOOLS_MANAGE', 'MCP_TOOLS_WORK', 'MCP_TOOLS_V2', 'AGENT_TAINT_ROUTING'].forEach((key) => { delete process.env[key]; }); });

describe('how many changes one batch call takes', () => {
    it('takes fifty, which wait as one proposal and change nothing', async () => {
        expect(BATCH_MAX).toBe(50);
        expect(fifty()).toHaveLength(BATCH_MAX);
        const out = await batch(ctx(OWNER), fifty());

        expect(out).toMatchObject({ ok: false, pending: true, applied: 0, notApplied: BATCH_MAX, waiting: BATCH_MAX });
        expect(out.items.every((item) => item.pending === true)).toBe(true);
        untouched();
        expect(proposalRows()).toHaveLength(1);
        expect(proposalRows()[0].changes).toHaveLength(BATCH_MAX);
        expect(String(proposalRows()[0]._id)).toBe(out.proposalId);
    });

    it('refuses fifty-one in plain words, before anything is read, and files nothing', async () => {
        const out = await batch(ctx(OWNER), [...fifty(), rename(fx.top, 'One too many')]);

        expect(out.rpcError).toMatchObject({ code: -32602 });
        expect(out.rpcError.message).toBe(`tasks.batch: a batch takes at most 50 changes, and this one has 51. Nothing was filed and nothing has changed. Send the first 50 as one batch and the rest as another, and tell the person each one waits for its own approval.`);
        untouched();
        expect(proposalRows()).toHaveLength(0);
        expect(rows(SCHEMA_TYPE.AUDIT_LOGS)).toHaveLength(0);
    });

    it('says so in the tool the agent lists, and asks for one batch for one request', async () => {
        const listed = (await server.handleRpc(ctx(OWNER), { jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools.find((tool) => tool.name === 'tasks.batch');
        expect(listed.description).toMatch(/^Runs up to 50 change tools in one call/);
        expect(listed.description).toMatch(/put every change in one batch, so the person approves once/);
        expect(listed.inputSchema.properties.operations.maxItems).toBe(BATCH_MAX);
    });
});

describe('the card of a batch of fifty', () => {
    it('counts every task and every change, names the first few, and holds the rest for "show all"', async () => {
        const out = await batch(ctx(OWNER), fifty());
        const row = (await queue.readQueue(CID, MEMBER)).find((queued) => queued.proposalId === out.proposalId);

        expect(row.batch).toMatchObject({ kind: 'batch', tasks: TASKS, changes: BATCH_MAX });
        expect(row.batch.lines.slice(0, 2)).toEqual([
            { kind: 'batchChange', what: 'status', count: TASKS, value: 'To Do', mixed: false },
            { kind: 'batchChange', what: 'title', count: TASKS, value: '', mixed: true },
        ]);
        const named = row.batch.lines[2];
        expect(named).toMatchObject({ kind: 'batchTasks', others: TASKS - 5 });
        expect([...named.tasks, ...named.rest].map((task) => task.name)).toEqual(tasks.map((task, at) => `Bulk ${at + 1}`));
        expect(named.rest[0]).toEqual({ taskId: String(tasks[5]._id), name: 'Bulk 6', projectId: P_OPEN, sprintId: S_OPEN, folderId: '' });
        expect(row.batch.lines.filter((line) => line.kind === 'batchItem').map((line) => [line.task, line.value]))
            .toEqual(tasks.map((task, at) => [`Bulk ${at + 1}`, `Renamed ${at + 1}`]));
    });

    it('holds for "show all" only the tasks the viewer can read', async () => {
        const out = await batch(ctx(OWNER), [...tasks.slice(0, 7).map((task) => setStatus(task, 'To Do')), setStatus(fx.secret, 'To Do')]);
        const named = (await queue.readQueue(CID, OWNER)).find((queued) => queued.proposalId === out.proposalId).batch.lines.find((line) => line.kind === 'batchTasks');
        expect(named.rest.map((task) => task.name)).toEqual(['Bulk 6', 'Bulk 7', 'Task OPN-9']);

        const few = await batch(ctx(OWNER), tasks.slice(0, 5).map((task) => rename(task, 'Short')));
        const short = (await queue.readQueue(CID, MEMBER)).find((queued) => queued.proposalId === few.proposalId).batch.lines.find((line) => line.kind === 'batchTasks');
        expect(short).toEqual({ kind: 'batchTasks', tasks: expect.any(Array), others: 0 });
    });
});

describe('each of the fifty is held as a change of any batch is', () => {
    it('to what the person may open and may change: those are left out, each with its refusal, and the rest wait', async () => {
        rules.setRule(null, 'task_name_edit', false);
        const operations = [...tasks.map((task) => setStatus(task, 'To Do')), ...tasks.slice(0, TASKS - 1).map((task) => rename(task, 'Not allowed')), setStatus(fx.private, 'To Do')];
        expect(operations).toHaveLength(BATCH_MAX);
        const out = await batch(ctx(MEMBER), operations);

        expect(out).toMatchObject({ pending: true, waiting: TASKS, applied: 0, notApplied: BATCH_MAX });
        expect(out.items.slice(0, TASKS).every((item) => item.pending === true)).toBe(true);
        out.items.slice(TASKS, BATCH_MAX - 1).forEach((item) => expect(item).toMatchObject({ refused: true, reason: expect.stringMatching(/^permission_denied: task\.task_name_edit/) }));
        expect(out.items[BATCH_MAX - 1]).toMatchObject({ refused: true, reason: expect.stringMatching(/^not_visible/) });
        expect(proposalRows()[0].changes.map((change) => change.action)).toEqual(Array(TASKS).fill('task.status.change'));
        untouched();
    });

    it('to the project\'s rule for a close: every close it leaves to people is refused, and the other changes wait', async () => {
        project().agentPolicy = { done: projectPolicy.DONE.NEVER };
        const out = await batch(ctx(OWNER), [...tasks.map((task) => setStatus(task, 'Done')), ...tasks.map((task, at) => rename(task, `Renamed ${at + 1}`))]);

        expect(out).toMatchObject({ pending: true, waiting: TASKS, applied: 0 });
        out.items.slice(0, TASKS).forEach((item) => expect(item).toMatchObject({ refused: true, reason: projectPolicy.REASON.NEVER }));
        expect(proposalRows()[0].changes.map((change) => change.action)).toEqual(Array(TASKS).fill('task.edit'));
        untouched();
    });

    it('to a pause: every change is refused, and nothing is filed', async () => {
        project().agentLimits = { paused: true };
        const out = await batch(ctx(OWNER), fifty());

        expect(out).toMatchObject({ ok: false, applied: 0, waiting: 0 });
        expect(out.pending).toBeUndefined();
        expect(out.items).toHaveLength(BATCH_MAX);
        out.items.forEach((item) => expect(item).toMatchObject({ refused: true, reason: projectLimits.REASON.PAUSED }));
        expect(proposalRows()).toHaveLength(0);
        untouched();
    });

    it('to "changed since you read it": fifty changes to one task read before a person changed it are each refused', async () => {
        const [task] = tasks;
        await rpc(ctx(OWNER), 'task.get', { taskId: String(task._id) });
        stored(task._id).updatedAt = new Date(new Date(stored(task._id).updatedAt).getTime() + 1000);
        const out = await batch(ctx(OWNER), Array.from({ length: BATCH_MAX }, (unused, at) => rename(task, `Late ${at + 1}`)));

        expect(out).toMatchObject({ ok: false, applied: 0, notApplied: BATCH_MAX, auditId: null });
        out.items.forEach((item) => expect(item).toMatchObject({ refused: true, reason: taskReads.REFUSAL.CHANGED }));
        expect(nameOf(task)).toBe('Bulk 1');
        expect(proposalRows()).toHaveLength(0);
    });
});

describe('approving a batch of fifty', () => {
    it('applies every change, each audited on its own, and one undo takes all of them back', async () => {
        const out = await batch(ctx(OWNER), fifty());
        const approved = await approve(out.proposalId);
        await settle();

        expect(approved.error).toBeUndefined();
        expect(approved.applied.map((change) => change.ok)).toEqual(Array(BATCH_MAX).fill(true));
        expect(tasks.map((task) => [statusOf(task), nameOf(task)])).toEqual(tasks.map((task, at) => ['To Do', `Renamed ${at + 1}`]));
        expect(audits('task.status.change', 'applied')).toHaveLength(TASKS);
        expect(audits('task.edit', 'applied')).toHaveLength(TASKS);
        expect(proposalRows()[0]).toMatchObject({ status: 'approved', decidedBy: MEMBER });
        expect(proposalRows()[0].auditIds).toHaveLength(BATCH_MAX);

        const undone = await proposals.undoApproval(CID, out.proposalId, { decider: person(MEMBER), isPrivileged: false, ip: '' });
        await settle();
        expect(undone.error).toBeUndefined();
        expect(undone.results.map((result) => result.ok)).toEqual(Array(BATCH_MAX).fill(true));
        untouched();
        expect(proposalRows()[0].status).toBe('undone');
    });

    it('asks the project again for each change: a close it has since left to people is not made, and the rest are', async () => {
        const out = await batch(ctx(OWNER), [...tasks.map((task) => setStatus(task, 'Done')), ...tasks.map((task, at) => rename(task, `Renamed ${at + 1}`))]);
        expect(out).toMatchObject({ pending: true, waiting: BATCH_MAX });
        project().agentPolicy = { done: projectPolicy.DONE.NEVER };
        const approved = await approve(out.proposalId);
        await settle();

        expect(approved.applied.map((change) => change.ok)).toEqual([...Array(TASKS).fill(false), ...Array(TASKS).fill(true)]);
        approved.applied.slice(0, TASKS).forEach((change) => expect(change.error).toBe(projectPolicy.REASON.NEVER));
        expect(tasks.map((task) => [statusOf(task), nameOf(task)])).toEqual(tasks.map((task, at) => ['In Progress', `Renamed ${at + 1}`]));
    });

    it('is refused whole where the approver cannot open one of its tasks', async () => {
        const out = await batch(ctx(OWNER), [...tasks.map((task) => setStatus(task, 'To Do')), ...tasks.slice(0, TASKS - 1).map((task, at) => rename(task, `Renamed ${at + 1}`)), rename(fx.secret, 'Hidden')]);
        expect(out).toMatchObject({ pending: true, waiting: BATCH_MAX });

        expect(await approve(out.proposalId, MEMBER)).toMatchObject({ status: 403, error: expect.stringMatching(/approver cannot open/) });
        expect(proposalRows()[0].status).toBe('pending');
        untouched();
    });
});
