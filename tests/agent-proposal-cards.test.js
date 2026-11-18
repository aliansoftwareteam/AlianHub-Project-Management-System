/* Task 047: what the AI Inbox page is sent with each proposal, and how many proposals a wide batch becomes. */
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
const registry = require('../Modules/Agents/registry');
const proposals = require('../Modules/Agents/proposals');
const queue = require('../Modules/Inbox/helpers/approvalQueue');
const { BATCH_MAX } = require('../Modules/Mcp/manageTools');
const server = require('../Modules/Mcp/server');
const ctrl = require('../Modules/Agents/controller');

mongoHelper.getTotalSprintCount = async () => true;

const { CID, OWNER, MEMBER, OTHER, TOKEN, P_OPEN, S_OPEN, TASKS_GRANT, settle, ctx } = world;
const { seed, stored, rows, rpcThrough } = world.create(mockDb);
const rpc = rpcThrough(server);
const store = persistence.useInMemory();

const DAY = 24 * 60 * 60 * 1000;
const TWENTY = 20;
const AGENT = '6f0000000000000000000a01';

const proposalRows = () => rows(SCHEMA_TYPE.AGENT_PROPOSALS);
const setStatus = (task, status) => ({ tool: 'task.status.set', arguments: { taskId: String(task._id), status } });
const setPriority = (task, priority) => ({ tool: 'task.update', arguments: { taskId: String(task._id), priority } });
const assign = (task, userId) => ({ tool: 'task.assign', arguments: { taskId: String(task._id), mode: 'set', userIds: [userId] } });
const batch = (as, operations, reason = 'Tidy the week') => rpc(as, 'tasks.batch', { reason, operations });
const copyOf = (task, over) => {
    const copy = { ...stored(task._id), ...over };
    delete copy._id;
    return mockDb.seed(SCHEMA_TYPE.TASKS, copy);
};

const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; r.json = r.send; return r; };
const listFor = async (uid, query = { status: 'pending' }) => {
    const answer = res();
    await ctrl.listProposals({ headers: { companyid: CID }, params: {}, query, body: {}, uid, ip: '' }, answer);
    return answer.body;
};
const listed = async (uid, id) => (await listFor(uid)).data.find((row) => String(row._id) === String(id));
const queued = async (uid, id) => (await queue.readQueue(CID, uid)).find((row) => row.proposalId === String(id));

let fx;
let twenty;

beforeEach(() => {
    jest.clearAllMocks();
    store.reset();
    fx = seed();
    mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS] = [];
    mockDb.store[SCHEMA_TYPE.AGENT_STANDING_APPROVALS] = [];
    mockDb.store[SCHEMA_TYPE.API_TOKENS] = [];
    mockDb.store[SCHEMA_TYPE.AGENTS] = [];
    mockDb.seed(SCHEMA_TYPE.API_TOKENS, { _id: TOKEN, userId: OWNER, name: 'Claude', active: true, scopes: ['read', 'write'], grants: [TASKS_GRANT], projectIds: [], expiresAt: new Date(Date.now() + DAY) });
    mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: AGENT, name: 'Reviewer', ownerId: OWNER, autonomy: 1, spendCapUsd: 1, paused: false, deletedStatusKey: 0, projectIds: [] });
    twenty = Array.from({ length: TWENTY }, (unused, at) => copyOf(fx.bug, { TaskKey: `BLK-${at + 1}`, TaskName: `Bulk ${at + 1}`, ProjectID: P_OPEN, sprintId: S_OPEN }));
});
afterEach(settle);
afterAll(() => { ['MCP_TOOLS_MANAGE', 'MCP_TOOLS_WORK', 'MCP_TOOLS_V2', 'AGENT_TAINT_ROUTING'].forEach((key) => { delete process.env[key]; }); });

describe('a waiting batch in the list of proposals the AI Inbox page reads', () => {
    it('comes with the same one card the approval queue shows', async () => {
        const out = await batch(ctx(OWNER), twenty.map((task) => setStatus(task, 'To Do')));
        expect(out).toMatchObject({ pending: true, waiting: TWENTY });

        const row = await listed(MEMBER, out.proposalId);
        expect(row.changes).toHaveLength(TWENTY);
        expect(row.batch).toEqual((await queued(MEMBER, out.proposalId)).batch);
        expect(row.batch).toMatchObject({ kind: 'batch', tasks: TWENTY, changes: TWENTY });
        expect(row.batch.lines[0]).toEqual({ kind: 'batchChange', what: 'status', count: TWENTY, value: 'To Do', mixed: false });
        expect(row.batch.lines[1].tasks.map((task) => task.name)).toEqual(['Bulk 1', 'Bulk 2', 'Bulk 3', 'Bulk 4', 'Bulk 5']);
    });

    it('names a task only for a viewer who can read it', async () => {
        const out = await batch(ctx(OWNER), [setStatus(twenty[0], 'To Do'), setStatus(fx.secret, 'To Do')]);
        expect(out).toMatchObject({ pending: true, waiting: 2 });

        expect(await listed(MEMBER, out.proposalId)).toBeUndefined();
        const named = (await listed(OTHER, out.proposalId)).batch.lines.find((line) => line.kind === 'batchTasks');
        expect(named.tasks.map((task) => task.name)).toEqual(['Bulk 1', 'Task OPN-9']);
    });

    it('leaves a proposal that is one change, or a workspace agent\'s own, without a card', async () => {
        const one = await rpc(ctx(OWNER), 'task.status.set', { taskId: String(twenty[0]._id), status: 'Done' });
        const own = await proposals.create(CID, {
            agent: { _id: AGENT, name: 'Reviewer' }, projectId: P_OPEN, taskId: String(twenty[1]._id), what: 'Tidy two tasks', why: 'They drifted',
            changes: [1, 2].map((at) => ({ action: 'task.comment', params: { taskId: String(twenty[at]._id), body: 'x' }, label: `Comment on Bulk ${at + 1}` })),
        });
        const data = (await listFor(OWNER)).data;
        expect(data.map((row) => String(row._id)).sort()).toEqual([one.proposalId, String(own._id)].sort());
        expect(data.filter((row) => row.batch)).toEqual([]);
    });
});

describe('a change filed with no words of its own', () => {
    const stockOf = (row) => row.changes.map((change) => Boolean(change.stockLabel));

    it('is marked in the queue and in the list, so the web app words it', async () => {
        const out = await rpc(ctx(OWNER), 'task.status.set', { taskId: String(twenty[0]._id), status: 'Done' });
        expect(proposalRows()[0].changes[0].label).toBe('task.status.set via MCP');

        expect(stockOf(await queued(OWNER, out.proposalId))).toEqual([true]);
        expect(stockOf(await listed(OWNER, out.proposalId))).toEqual([true]);
    });

    it('is marked when its label is the action\'s key or the registry\'s label, and not when it says more', async () => {
        const taskId = String(twenty[0]._id);
        const filed = await proposals.create(CID, {
            agent: { _id: AGENT, name: 'Reviewer' }, projectId: P_OPEN, taskId, what: 'Review Bulk 1', why: 'Asked to',
            changes: [
                { action: 'task.comment', params: { taskId, body: 'x' }, label: 'Comment on BLK-1: "x"' },
                { action: 'task.comment', params: { taskId, body: 'y' }, label: registry.get('task.comment').label },
                { action: 'task.comment', params: { taskId, body: 'z' } },
            ],
        });
        expect(stockOf(await queued(OWNER, filed._id))).toEqual([false, true, true]);
        expect(stockOf(await listed(OWNER, filed._id))).toEqual([false, true, true]);
        expect((await listed(OWNER, filed._id)).changes.map((change) => change.label)).toEqual(['Comment on BLK-1: "x"', 'Comment on a task', 'task.comment']);
    });
});

describe('benchmark job 7: twenty tasks, two fields each', () => {
    const job = () => [...twenty.map((task) => setPriority(task, 'HIGH')), ...twenty.map((task) => assign(task, MEMBER))];

    it('is forty operations, which one batch call takes: one proposal, on one card', async () => {
        expect(job()).toHaveLength(2 * TWENTY);
        expect(2 * TWENTY).toBeLessThanOrEqual(BATCH_MAX);
        const out = await batch(ctx(OWNER), job());
        expect(out).toMatchObject({ pending: true, waiting: 2 * TWENTY, applied: 0 });
        expect(proposalRows()).toHaveLength(1);

        const [row] = await queue.readQueue(CID, OWNER);
        expect(row.batch).toMatchObject({ kind: 'batch', tasks: TWENTY, changes: 2 * TWENTY });
        expect(row.batch.lines.slice(0, 2)).toEqual([
            { kind: 'batchChange', what: 'priority', count: TWENTY, value: 'HIGH', mixed: false },
            { kind: 'batchChange', what: 'assignees', count: TWENTY, value: '', mixed: false },
        ]);
        const named = row.batch.lines.find((line) => line.kind === 'batchTasks');
        expect([...named.tasks, ...named.rest].map((task) => task.name)).toEqual(twenty.map((task, at) => `Bulk ${at + 1}`));
        expect(row.batch.lines.filter((line) => line.kind === 'batchItem')).toEqual(twenty.map((task, at) => ({ kind: 'batchItem', task: `Bulk ${at + 1}`, what: 'assignees', mode: 'set', names: ['Mia Member'], others: 0 })));
    });

    it('is one approval, which sets both on all twenty', async () => {
        const out = await batch(ctx(OWNER), job());
        const approved = await proposals.approve(CID, out.proposalId, { decider: { kind: 'human', userId: MEMBER }, isPrivileged: false, ip: '' });
        await settle();
        expect(approved.error).toBeUndefined();
        expect(approved.applied.map((change) => change.ok)).toEqual(Array(2 * TWENTY).fill(true));
        expect(twenty.map((task) => [stored(task._id).Task_Priority, stored(task._id).AssigneeUserId])).toEqual(Array(TWENTY).fill(['HIGH', [MEMBER]]));
        expect(proposalRows()).toHaveLength(1);
    });
});
