/* Task 047, decision 6: a connected agent's batch that names more than one task waits for a person as one proposal. */
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
const server = require('../Modules/Mcp/server');

mongoHelper.getTotalSprintCount = async () => true;

const { OWNER, TOKEN, P_OPEN, S_OPEN, TASKS_GRANT, settle, ctx } = world;
const { seed, stored, rows, rpcThrough } = world.create(mockDb);
const rpc = rpcThrough(server);
const store = persistence.useInMemory();

const DAY = 24 * 60 * 60 * 1000;
const TWENTY = 20;

const proposalRows = () => rows(SCHEMA_TYPE.AGENT_PROPOSALS);
const statusOf = (task) => stored(task._id).status.text;
const setStatus = (task, status) => ({ tool: 'task.status.set', arguments: { taskId: String(task._id), status } });

let fx;
let twenty;

beforeEach(() => {
    jest.clearAllMocks();
    store.reset();
    fx = seed();
    mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS] = [];
    mockDb.store[SCHEMA_TYPE.API_TOKENS] = [];
    mockDb.seed(SCHEMA_TYPE.API_TOKENS, { _id: TOKEN, userId: OWNER, name: 'Claude', active: true, scopes: ['read', 'write'], grants: [TASKS_GRANT], projectIds: [], expiresAt: new Date(Date.now() + DAY) });
    twenty = Array.from({ length: TWENTY }, (unused, at) => {
        const copy = { ...stored(fx.bug._id), TaskKey: `BLK-${at + 1}`, TaskName: `Bulk ${at + 1}`, ProjectID: P_OPEN, sprintId: S_OPEN };
        delete copy._id;
        return mockDb.seed(SCHEMA_TYPE.TASKS, copy);
    });
});
afterEach(settle);
afterAll(() => { ['MCP_TOOLS_MANAGE', 'MCP_TOOLS_WORK', 'MCP_TOOLS_V2', 'AGENT_TAINT_ROUTING'].forEach((key) => { delete process.env[key]; }); });

describe('a batch that names more than one task, in a project left at its default', () => {
    it('changes nothing and waits as one proposal', async () => {
        const out = await rpc(ctx(OWNER), 'tasks.batch', { reason: 'Back to the start of the week', operations: twenty.map((task) => setStatus(task, 'To Do')) });

        expect(twenty.map(statusOf)).toEqual(Array(TWENTY).fill('In Progress'));
        expect(out).toMatchObject({ ok: false, pending: true, applied: 0 });
        expect(proposalRows()).toHaveLength(1);
        expect(proposalRows()[0].changes).toHaveLength(TWENTY);
    });
});
