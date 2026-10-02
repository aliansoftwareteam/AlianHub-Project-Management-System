/* Task 047, AI-2: a change a connected agent applied directly is told to the person it acts for, who reads
   one line about it. Who is told, and what that person may read. */
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
jest.mock('../Modules/Agents/triggers', () => ({ fromComment: jest.fn(async () => null) }));
jest.mock('../Modules/Agents/proposals', () => ({ create: jest.fn(async (companyId, proposal) => ({ _id: 'proposal-1', ...proposal })) }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpManageWorld');
const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const socketEmitter = require('../event/socketEventEmitter');
const actions = require('../Modules/Agents/actions');
const registry = require('../Modules/Agents/registry');
const projectPolicy = require('../Modules/Agents/projectPolicy');
const changeNotice = require('../Modules/Agents/changeNotice');
const controller = require('../Modules/Agents/changeNoticeController');
const server = require('../Modules/Mcp/server');

mongoHelper.getTotalSprintCount = async () => true;

const { CID, OWNER, MEMBER, OTHER, TOKEN, P_OPEN, S_SECRET, TASKS_GRANT, PLAIN_SCOPES, settle, ctx, outside } = world;
const { seed, stored, rows, rpcThrough, seedGrant } = world.create(mockDb);
const rpc = rpcThrough(server);

const signals = () => socketEmitter.emit.mock.calls.map(([, event]) => event).filter((event) => event && event.module === 'agent' && event.data && event.data.kind === 'change');
const comment = (caller, taskId) => rpc(caller, 'task.comment', { taskId, body: 'Looked at this' });
const workspaceRun = (uid) => ({ kind: 'agent', userId: uid, agentId: '6f0000000000000000000a91', agentName: 'Triage', runId: '6f0000000000000000000a92', viaAccount: 'workspace', tokenId: null });

let fx;

beforeEach(() => {
    jest.clearAllMocks();
    fx = seed();
    process.env.MCP_TOOLS_WORK = 'on';
    rows(SCHEMA_TYPE.PROJECTS).forEach((project) => { project.agentPolicy = { done: 'yes' }; });
});
afterEach(settle);
afterAll(() => { ['MCP_TOOLS_MANAGE', 'MCP_TOOLS_WORK', 'MCP_TOOLS_V2'].forEach((key) => { delete process.env[key]; }); });

describe('who is told that a connected agent changed something', () => {
    it('the person the agent acts for, with the company and the id of the change and nothing of the change', async () => {
        const out = await comment(ctx(MEMBER), fx.top._id);
        expect(out).toMatchObject({ ok: true, auditId: expect.any(String) });
        expect(signals()).toHaveLength(1);
        expect(signals()[0]).toMatchObject({ type: 'update', module: 'agent', companyId: CID });
        expect(signals()[0].data).toEqual({ kind: 'change', userId: MEMBER, auditId: out.auditId });
    });

    it('an app the person allowed tells the same person', async () => {
        seedGrant(MEMBER, [...PLAIN_SCOPES, TASKS_GRANT]);
        const out = await comment(outside(MEMBER, [...PLAIN_SCOPES, TASKS_GRANT]), fx.top._id);
        expect(out).toMatchObject({ ok: true });
        expect(signals().map((event) => event.data)).toEqual([{ kind: 'change', userId: MEMBER, auditId: out.auditId }]);
    });

    it('nobody for a read', async () => {
        expect(await rpc(ctx(MEMBER), 'task.get', { taskId: fx.top._id })).not.toHaveProperty('rpcError');
        expect(signals()).toEqual([]);
    });

    it('nobody for a change that was refused', async () => {
        expect(await comment(ctx(MEMBER), fx.private._id)).toMatchObject({ refused: true });
        expect(signals()).toEqual([]);
    });

    it('nobody for a change that waits for a person, nor when that person approves it', async () => {
        rows(SCHEMA_TYPE.PROJECTS).forEach((project) => { project.agentPolicy = { connected: projectPolicy.CONNECTED.PROPOSE_ALL }; });
        expect(await comment(ctx(MEMBER), fx.top._id)).toMatchObject({ pending: true });
        const approved = await actions.perform({ companyId: CID, actor: ctx(MEMBER).actor, action: 'task.comment', params: { taskId: String(fx.top._id), body: 'Approved' }, approved: true, approvedBy: OWNER });
        expect(approved.auditId).toBeTruthy();
        expect(signals()).toEqual([]);
    });

    it('nobody for a workspace agent\'s run, which the live strip already shows', async () => {
        const out = await actions.perform({ companyId: CID, actor: workspaceRun(MEMBER), action: 'task.comment', params: { taskId: String(fx.top._id), body: 'From a run' } });
        expect(out.auditId).toBeTruthy();
        expect(signals()).toEqual([]);
    });
});

describe('what the person reads about the change', () => {
    const applied = async (caller, taskId) => (await comment(caller, taskId)).auditId;

    it('the agent, what it did and the task, with whether it can still be undone', async () => {
        const auditId = await applied(ctx(MEMBER), fx.top._id);
        expect(await changeNotice.describe(CID, MEMBER, [auditId])).toEqual({
            canList: false,
            changes: [{ auditId, agentName: 'Claude', action: 'task.comment', label: registry.get('task.comment').label, taskId: String(fx.top._id), name: 'Task OPN-1', undoable: true, parts: [] }],
        });
    });

    it('names the tool behind a personal token as the task\'s history does', async () => {
        mockDb.seed(SCHEMA_TYPE.API_TOKENS, { _id: TOKEN, userId: MEMBER, kind: 'agent', name: 'laptop', agentAccount: { mode: 'personal', provider: 'Claude Code' } });
        const auditId = (await rpc(ctx(MEMBER, { actor: { ...ctx(MEMBER).actor, agentName: 'laptop', provider: 'Claude Code' } }), 'task.comment', { taskId: fx.top._id, body: 'Hi' })).auditId;
        expect((await changeNotice.describe(CID, MEMBER, [auditId])).changes[0].agentName).toBe('Claude Code');
    });

    it('nothing to anyone else, an owner included', async () => {
        const auditId = await applied(ctx(MEMBER), fx.top._id);
        expect((await changeNotice.describe(CID, OTHER, [auditId])).changes).toEqual([]);
        expect((await changeNotice.describe(CID, OWNER, [auditId])).changes).toEqual([]);
    });

    it('nothing once the person can no longer open the task', async () => {
        const auditId = await applied(ctx(MEMBER), fx.top._id);
        stored(fx.top._id).sprintId = S_SECRET;
        expect((await changeNotice.describe(CID, MEMBER, [auditId])).changes).toEqual([]);
    });

    it('nothing for a refusal, a run\'s change, an id that is no change and an id that is not one', async () => {
        const refused = await comment(ctx(MEMBER), fx.private._id);
        const run = await actions.perform({ companyId: CID, actor: workspaceRun(MEMBER), action: 'task.comment', params: { taskId: String(fx.top._id), body: 'From a run' } });
        expect((await changeNotice.describe(CID, MEMBER, [refused.auditId, run.auditId, P_OPEN, 'nope', undefined])).changes).toEqual([]);
    });

    it('a batch is one change that names its parts, so the page counts each once', async () => {
        const out = await rpc(ctx(MEMBER), 'tasks.batch', { operations: [
            { tool: 'task.comment', arguments: { taskId: fx.top._id, body: 'One' } },
            { tool: 'task.comment', arguments: { taskId: fx.top._id, body: 'Two' } },
        ] });
        const parts = out.items.map((item) => item.auditId);
        expect(signals().map((event) => event.data.auditId)).toEqual([...parts, out.auditId]);
        const read = await changeNotice.describe(CID, MEMBER, [...parts, out.auditId]);
        expect(read.changes).toHaveLength(3);
        expect(read.changes[2]).toMatchObject({ auditId: out.auditId, action: 'tasks.batch', undoable: true, parts });
    });

    it('says whether the person may open the list of every agent change', async () => {
        const auditId = await applied(ctx(OWNER), fx.top._id);
        expect(await changeNotice.describe(CID, OWNER, [auditId])).toMatchObject({ canList: true, changes: [{ auditId }] });
    });

    it('reads at most fifty ids in one request', async () => {
        const auditId = await applied(ctx(MEMBER), fx.top._id);
        const many = [...Array.from({ length: changeNotice.MAX_IDS }, (_, i) => (i + 1).toString(16).padStart(24, 'a')), auditId];
        expect((await changeNotice.describe(CID, MEMBER, many)).changes).toEqual([]);
    });
});

describe('the route that answers it', () => {
    const ask = async (req) => {
        const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(sent) { this.body = sent; return this; } };
        await controller.getChanges({ headers: { companyid: CID }, query: {}, ...req }, res);
        return res;
    };

    it('answers the signed-in person about their own agent\'s changes', async () => {
        const auditId = (await comment(ctx(MEMBER), fx.top._id)).auditId;
        const res = await ask({ uid: MEMBER, query: { ids: `${auditId},nope` } });
        expect(res.body).toMatchObject({ status: true, data: { canList: false, changes: [{ auditId, name: 'Task OPN-1' }] } });
    });

    it('answers nobody without a session, and no API token', async () => {
        const auditId = (await comment(ctx(MEMBER), fx.top._id)).auditId;
        expect((await ask({ query: { ids: auditId } })).statusCode).toBe(401);
        expect((await ask({ uid: MEMBER, headers: {}, query: { ids: auditId } })).statusCode).toBe(401);
        expect((await ask({ uid: MEMBER, apiToken: { _id: TOKEN, userId: MEMBER }, query: { ids: auditId } })).statusCode).toBe(403);
    });
});
