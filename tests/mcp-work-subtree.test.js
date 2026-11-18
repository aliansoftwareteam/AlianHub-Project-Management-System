/* Task 046, MCP parity part 3: a subtask is created under a subtask, to three levels and no deeper, and a link
   is attached to a subtask as to any task, with a token that manages tasks and with one that does not. */
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
jest.mock('../Modules/Comments/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());
jest.mock('../Modules/CustomField/controller', () => mockStub());
jest.mock('../utils/planHelper', () => mockStub());
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../common-storage/common-server.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/completionStore', () => ({ recordWork: jest.fn(async () => null), forStatusChange: jest.fn(async () => null) }));
jest.mock('../Modules/Agents/proposals', () => ({ create: jest.fn(async (companyId, proposal) => ({ _id: 'proposal-1', ...proposal })) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpManageWorld');
const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const server = require('../Modules/Mcp/server');

mongoHelper.getTotalSprintCount = async () => true;

const { OWNER, MEMBER, P_OPEN, S_OPEN, settle, ctx, olderToken } = world;
const { seed, stored, rpcThrough } = world.create(mockDb);
const rpc = rpcThrough(server);

const TOKENS = [['a token that manages tasks', ctx], ['a token without the grant', olderToken]];
const idsOf = (list) => (list || []).map(String);

let fx;

beforeEach(() => { fx = seed(); });
afterEach(settle);
afterAll(() => { ['MCP_TOOLS_MANAGE', 'MCP_TOOLS_V2'].forEach((key) => { delete process.env[key]; }); });

describe('subtask.create under a subtask', () => {
    it.each(TOKENS)('with %s, lands on the third level with the chain and the placement of its parent', async (label, as) => {
        const out = await rpc(as(MEMBER), 'subtask.create', { taskId: fx.child._id, title: 'Third level' });
        expect(out).toMatchObject({ ok: true, result: { title: 'Third level' } });
        const made = stored(out.result.subtaskId);
        expect(made).toMatchObject({ TaskName: 'Third level', ParentTaskId: String(fx.child._id), isParentTask: false });
        expect(idsOf(made.ancestors)).toEqual([String(fx.top._id), String(fx.child._id)]);
        expect([String(made.ProjectID), String(made.sprintId)]).toEqual([P_OPEN, S_OPEN]);
        expect(stored(fx.child._id).subTasks).toBe(2);
    });

    it.each(TOKENS)('with %s, is refused under a subtask that is already on the third level, and creates nothing', async (label, as) => {
        const before = mockDb.store[SCHEMA_TYPE.TASKS].length;
        const out = await rpc(as(OWNER), 'subtask.create', { taskId: fx.grandchild._id, title: 'Too deep' });
        expect(out).toMatchObject({ isError: true, error: expect.stringMatching(/three levels deep/) });
        expect(mockDb.store[SCHEMA_TYPE.TASKS].length).toBe(before);
    });

    it('is refused under a subtask of a list the person cannot open', async () => {
        const hidden = mockDb.seed(SCHEMA_TYPE.TASKS, { ...fx.secret, _id: '6f0000000000000000000b77', TaskKey: 'OPN-10', isParentTask: false, ParentTaskId: fx.secret._id, ancestors: [fx.secret._id] });
        for (const [, as] of TOKENS) {
            expect(await rpc(as(MEMBER), 'subtask.create', { taskId: hidden._id, title: 'x' })).toMatchObject({ refused: true, reason: expect.stringMatching(/^not_visible/) });
        }
    });
});

describe('task.link on a subtask', () => {
    it.each(TOKENS)('with %s, attaches the link to a subtask on the second and on the third level', async (label, as) => {
        for (const task of [fx.child, fx.grandchild]) {
            const out = await rpc(as(MEMBER), 'task.link', { taskId: task._id, url: 'https://example.com/acme/app/pull/1332', label: 'PR 1332' });
            expect(out).toMatchObject({ ok: true, undoable: true, result: { kind: 'pr' } });
            expect(stored(task._id).links).toEqual([expect.objectContaining({ url: 'https://example.com/acme/app/pull/1332', label: 'PR 1332', kind: 'pr', actorType: 'agent' })]);
        }
        expect(stored(fx.top._id).links).toBeUndefined();
    });

    it('reads back through task.links.list on the subtask', async () => {
        await rpc(ctx(MEMBER), 'task.link', { taskId: fx.grandchild._id, url: 'https://example.com/docs/plan', kind: 'doc' });
        const out = await rpc(ctx(MEMBER), 'task.links.list', { taskId: fx.grandchild._id });
        expect(out.links).toEqual([expect.objectContaining({ url: 'https://example.com/docs/plan', kind: 'doc' })]);
    });
});
