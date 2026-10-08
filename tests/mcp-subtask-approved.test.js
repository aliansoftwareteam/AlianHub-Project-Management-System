/* Task 047, AI-run: a subtask a connected agent asks for under a task it made, in a list it made at the project
   root, is made when a person approves it and when it runs at once alike; an approval that made nothing says so. */
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
jest.mock('../Modules/Tasks/helpers/handleNotification', () => mockStub());
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => mockStub());
jest.mock('../Modules/Company/eventController', () => mockStub());
jest.mock('../Modules/Company/controller/updateCompany', () => mockStub());
jest.mock('../Modules/notification-count/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());
jest.mock('../Modules/CustomField/controller', () => mockStub());
jest.mock('../utils/planHelper', () => ({ getCachedCompanyData: jest.fn(async () => ({ data: {} })) }));
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../common-storage/common-server.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Knowledge/ingest/events', () => ({ publishCommentChanged: jest.fn(), publish: jest.fn() }));
jest.mock('../Modules/Knowledge/memory/publish', () => mockStub());
jest.mock('../Modules/Agents/triggers', () => ({ fromComment: jest.fn(async () => null), TRIGGER: { MENTION: 'mention', ASSIGN: 'assign' } }));
jest.mock('../Modules/AI/feedback', () => ({ fromDecline: jest.fn(async () => null) }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));
jest.mock('../Modules/service.js', () => mockStub());
jest.mock('../Modules/Workflows/queue', () => ({ dispatch: jest.fn(async () => true) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpManageWorld');
const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const persistence = require('../Modules/AICore/persistence');
const projectPolicy = require('../Modules/Agents/projectPolicy');
const server = require('../Modules/Mcp/server');
const { listPlacement } = require('../utils/mongo-handler/listPlacement');

mongoHelper.getTotalSprintCount = async () => true;
jest.setTimeout(30000);

const { CID, OWNER, TOKEN, P_OPEN, TASKS_GRANT, settle, ctx, outside } = world;
const { seed, rows, stored, rpcThrough } = world.create(mockDb);
const rpc = rpcThrough(server);
const store = persistence.useInMemory();

const DAY = 24 * 60 * 60 * 1000;
const APPROVE = 'POST /api/v2/agents/proposals/:id/approve';
const SESSION = { uid: OWNER };

const routes = {};
const register = (method) => (routePath, ...handlers) => { routes[`${method} ${routePath}`] = handlers.flat(); };
require('../Modules/Agents/routes').init({ get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: () => {} });

const send = async (route, caller, params, body = {}) => {
    const [method, path] = route.split(' ');
    const url = Object.entries(params).reduce((text, [name, value]) => text.replace(`:${name}`, value), path);
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(sent) { this.body = sent; return this; }, send(sent) { this.body = sent; return this; }, on() {} };
    const req = { ...caller, method, originalUrl: url, url, query: {}, params, headers: { companyid: CID }, aud: CID, ip: '1.1.1.1', body };
    for (const handler of routes[route]) {
        let passed = false;
        // eslint-disable-next-line no-await-in-loop
        await handler(req, res, () => { passed = true; });
        if (!passed) break;
    }
    await settle();
    return { code: res.statusCode, body: res.body };
};

const project = () => rows(SCHEMA_TYPE.PROJECTS).find((row) => String(row._id) === P_OPEN);
const proposal = (id) => rows(SCHEMA_TYPE.AGENT_PROPOSALS).find((row) => String(row._id) === String(id));
const childrenOf = (parentId) => rows(SCHEMA_TYPE.TASKS).filter((row) => String(row.ParentTaskId) === String(parentId));

/* The fake keeps a row as it was handed; Mongo runs the task schema's setter, which stores the list's ids as ObjectIds. */
const asMongoStores = (taskId) => {
    const row = stored(taskId);
    row.sprintArray = listPlacement(row.sprintArray);
    return row;
};

/* What the bench did: a list at the project root and a task in it, both over MCP, at once. */
const benchParent = async (folderId) => {
    const list = await rpc(ctx(OWNER), 'list.create', { projectId: P_OPEN, name: '[AI bench] list', ...(folderId ? { folderId } : {}) });
    expect(list).toMatchObject({ ok: true });
    const parent = await rpc(ctx(OWNER), 'task.create', { projectId: P_OPEN, sprintId: list.result.sprintId, title: '[AI bench] Parent' });
    expect(parent).toMatchObject({ ok: true });
    return { sprintId: list.result.sprintId, parent: asMongoStores(parent.result.taskId) };
};

const holdEveryChange = () => { project().agentPolicy = { done: projectPolicy.DONE.YES, connected: projectPolicy.CONNECTED.PROPOSE_ALL }; };

beforeEach(() => {
    jest.clearAllMocks();
    store.reset();
    seed();
    process.env.MCP_TOOLS_WORK = 'on';
    mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS] = [];
    mockDb.store[SCHEMA_TYPE.API_TOKENS] = [];
    mockDb.seed(SCHEMA_TYPE.API_TOKENS, { _id: TOKEN, userId: OWNER, name: 'Claude', active: true, scopes: ['read', 'write'], grants: [TASKS_GRANT], projectIds: [], expiresAt: new Date(Date.now() + DAY) });
    project().agentPolicy = { done: projectPolicy.DONE.YES };
});
afterEach(settle);
afterAll(() => { ['MCP_TOOLS_WORK'].forEach((key) => { delete process.env[key]; }); });

describe('a subtask under a task in a list made over MCP', () => {
    it('is made when a person approves it, in its parent\'s list, and the approval says it is done', async () => {
        const { sprintId, parent } = await benchParent();
        holdEveryChange();
        const filed = await rpc(ctx(OWNER), 'subtask.create', { taskId: String(parent._id), title: '[AI bench] Child' });
        expect(filed).toMatchObject({ pending: true });

        const answer = await send(APPROVE, SESSION, { id: filed.proposalId });
        expect(answer).toMatchObject({ code: 200, body: { status: true, statusText: 'Done.' } });
        expect(proposal(filed.proposalId).notMade).toBeUndefined();
        const made = childrenOf(parent._id);
        expect(made.map((row) => row.TaskName)).toEqual(['[AI bench] Child']);
        expect([String(made[0].sprintId), String(made[0].sprintArray.id), made[0].sprintArray.name]).toEqual([sprintId, sprintId, '[AI bench] list']);
    });

    it('is made at once where the project does not hold it', async () => {
        const { sprintId, parent } = await benchParent();
        const out = await rpc(ctx(OWNER), 'subtask.create', { taskId: String(parent._id), title: '[AI bench] Child' });
        expect(out).toMatchObject({ ok: true, result: { title: '[AI bench] Child' } });
        expect(String(stored(out.result.subtaskId).sprintId)).toBe(sprintId);
    });

    it('from an outside client is one task under the project\'s default rule, so it is made at once even where outside calls are routed', async () => {
        const { parent } = await benchParent();
        delete project().agentPolicy;
        Object.assign(process.env, { MCP_TOOLS_V2: 'on', AGENT_TAINT_ROUTING: 'on', MCP_OAUTH: 'on', MCP_OAUTH_ISSUER: world.ISSUER });
        try {
            const out = await rpc(outside(OWNER, ['tasks:read', 'tasks:write', 'tasks:manage']), 'subtask.create', { taskId: String(parent._id), title: '[AI bench] Child' });
            expect(out).toMatchObject({ ok: true });
            expect(rows(SCHEMA_TYPE.AGENT_PROPOSALS)).toEqual([]);
        } finally {
            ['MCP_TOOLS_V2', 'AGENT_TAINT_ROUTING', 'MCP_OAUTH', 'MCP_OAUTH_ISSUER'].forEach((key) => { delete process.env[key]; });
        }
    });

    it('in a list in a folder is made in that folder', async () => {
        const folder = mockDb.seed(SCHEMA_TYPE.FOLDERS, { name: 'Bench folder', projectId: P_OPEN, deletedStatusKey: 0 });
        const { parent } = await benchParent(String(folder._id));
        const out = await rpc(ctx(OWNER), 'subtask.create', { taskId: String(parent._id), title: 'In the folder' });
        expect(out).toMatchObject({ ok: true });
        const made = stored(out.result.subtaskId);
        expect([String(made.sprintArray.folderId), String(made.folderObjId)]).toEqual([String(folder._id), String(folder._id)]);
    });
});

describe('an approval that made nothing', () => {
    it('says what was not made and why, not that it is done', async () => {
        const { parent } = await benchParent();
        holdEveryChange();
        const filed = await rpc(ctx(OWNER), 'subtask.create', { taskId: String(parent._id), title: '[AI bench] Child' });
        project().taskStatusData = [];

        const answer = await send(APPROVE, SESSION, { id: filed.proposalId });
        expect(answer.code).toBe(200);
        expect(answer.body.statusText).not.toBe('Done.');
        expect(answer.body.statusText).toMatch(/^Approved, but nothing was made\. subtask\.create via MCP: That project has no statuses yet\./);
        expect(proposal(filed.proposalId)).toMatchObject({ status: 'approved', notMade: [{ name: 'subtask.create via MCP', error: expect.stringMatching(/no statuses yet/) }] });
        expect(childrenOf(parent._id)).toEqual([]);
    });
});
