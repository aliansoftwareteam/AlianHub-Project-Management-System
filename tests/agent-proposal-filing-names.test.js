/* A proposal filed on the web road runs on the approver's rights once approved, so every id its changes name is
   one the person behind the filing agent can open. One it cannot open answers as one that is not there. */
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
jest.mock('../Modules/Comments/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());
jest.mock('../Modules/CustomField/aiFields/controller', () => mockStub());
jest.mock('../Modules/Knowledge/ingest/events', () => mockStub());
jest.mock('../utils/planHelper', () => ({ getCachedCompanyData: jest.fn(async () => ({ data: {} })) }));
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../common-storage/common-server.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Agents/engine/graph', () => ({ resumeGraph: jest.fn(async () => ({ resumed: false })) }));
jest.mock('../Modules/AICore/persistence', () => {
    const deleteThread = jest.fn(async () => {});
    return { deleteThread, saverFor: jest.fn(() => ({ deleteThread })), storeFor: jest.fn(() => { throw new Error('no store in this suite'); }), ready: jest.fn(async () => {}) };
});
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpWorkWorld');
const goalRequests = require('../Modules/Agents/goalRequests');

const { CID, OWNER, INSIDER, OUTSIDER, P_OPEN, P_PRIVATE, L_OPEN, L_SECRET, T_OPEN, T_PRIVATE, TOKEN, FLAGS, settle } = world;
const { seed, rows } = world.create(mockDb);
const routes = world.routeTable(require('../Modules/Agents/routes').init);

const AGENT = '6f0000000000000000000a11';
const FILE = 'POST /api/v2/agents/proposals';
const NOT_FOUND = 'A task, project, list, doc or run this proposal names was not found.';
const F_OPEN = '6f0000000000000000000f01';
const F_PRIVATE = '6f0000000000000000000f02';
const FIELD_OPEN = '6f0000000000000000000c11';
const FIELD_PRIVATE = '6f0000000000000000000c12';
const FIELD_EVERYWHERE = '6f0000000000000000000c13';
const C_OPEN = '6f0000000000000000000c21';
const C_PRIVATE = '6f0000000000000000000c22';
const PAGE_OPEN = '6f0000000000000000000c31';
const PAGE_PRIVATE = '6f0000000000000000000c32';
const PC_OPEN = '6f0000000000000000000c41';
const PC_PRIVATE = '6f0000000000000000000c42';
const G_SHARED = '6f0000000000000000000c51';
const G_HIDDEN = '6f0000000000000000000c52';
const MISSING = '6f0000000000000000000fff';

const waiting = () => rows(SCHEMA_TYPE.AGENT_PROPOSALS);
const send = async (uid, changes, over = {}) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(sent) { this.body = sent; return this; }, send(sent) { this.body = sent; return this; }, on() {} };
    const req = {
        uid, apiToken: { _id: TOKEN, userId: uid, name: 'Planner', agentId: AGENT, scopes: ['read', 'write'] },
        method: 'POST', originalUrl: '/api/v2/agents/proposals', url: '/api/v2/agents/proposals', query: {}, params: {}, headers: { companyid: CID }, aud: CID, ip: '1.1.1.1',
        body: { agentId: AGENT, what: 'Tidy the project', why: 'Asked for in chat', changes, ...over },
    };
    for (const handler of routes[FILE]) {
        let passed = false;
        await handler(req, res, () => { passed = true; });
        if (!passed) break;
    }
    await settle();
    return { code: res.statusCode, body: res.body };
};
const change = (action, params) => [{ action, params, label: action }];
const hidden = async (uid, action, params) => {
    expect(await send(uid, change(action, params))).toMatchObject({ code: 404, body: { status: false, statusText: NOT_FOUND } });
    expect(waiting()).toHaveLength(0);
};
const taken = async (uid, action, params) => {
    const before = waiting().length;
    expect(await send(uid, change(action, params))).toMatchObject({ code: 200, body: { status: true } });
    expect(waiting()).toHaveLength(before + 1);
};

beforeEach(() => {
    seed();
    process.env.MCP_TOOLS_MANAGE = 'on';
    mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: AGENT, name: 'Planner', ownerId: OWNER, autonomy: 1, allowedActions: [], paused: false, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.FOLDERS, { _id: F_OPEN, name: 'Open folder', projectId: P_OPEN, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.FOLDERS, { _id: F_PRIVATE, name: 'Folder of the private project', projectId: P_PRIVATE, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id: FIELD_OPEN, fieldTitle: 'Budget', type: 'task', global: false, projectId: [P_OPEN] });
    mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id: FIELD_PRIVATE, fieldTitle: 'Severance', type: 'task', global: false, projectId: [P_PRIVATE] });
    mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id: FIELD_EVERYWHERE, fieldTitle: 'Region', type: 'task', global: true, projectId: [] });
    mockDb.seed(SCHEMA_TYPE.COMMENTS, { _id: C_OPEN, taskId: T_OPEN, message: 'Ready', userId: OUTSIDER, actorType: 'agent' });
    mockDb.seed(SCHEMA_TYPE.COMMENTS, { _id: C_PRIVATE, taskId: T_PRIVATE, message: 'Not yet', userId: INSIDER, actorType: 'agent' });
    mockDb.seed(SCHEMA_TYPE.PAGES, { _id: PAGE_OPEN, title: 'Open notes', ProjectID: P_OPEN, visibility: 'project', createdBy: OWNER, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.PAGES, { _id: PAGE_PRIVATE, title: 'Private notes', ProjectID: P_PRIVATE, visibility: 'project', createdBy: INSIDER, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.PAGE_COMMENTS, { _id: PC_OPEN, pageId: PAGE_OPEN, text: 'A thought' });
    mockDb.seed(SCHEMA_TYPE.PAGE_COMMENTS, { _id: PC_PRIVATE, pageId: PAGE_PRIVATE, text: 'A private thought' });
    jest.spyOn(goalRequests, 'goalFor').mockImplementation(async ({ uid, goalId }) => ((goalId === G_SHARED || (goalId === G_HIDDEN && uid === INSIDER)) ? { _id: goalId, targets: [] } : null));
});
afterEach(async () => { await settle(); jest.restoreAllMocks(); });
afterAll(() => { FLAGS.forEach((flag) => { delete process.env[flag]; }); });

describe('a filed proposal names only what the person behind the agent can open', () => {
    it('the project a copy is made from', async () => {
        await hidden(OUTSIDER, 'project.duplicate', { sourceProjectId: P_PRIVATE, name: 'Copy of private' });
        await hidden(OUTSIDER, 'project.duplicate', { sourceProjectId: MISSING, name: 'Copy of nothing' });
        await hidden(OUTSIDER, 'project.duplicate', { name: 'Copy of nothing' });
        await taken(OUTSIDER, 'project.duplicate', { sourceProjectId: P_OPEN, name: 'Copy of open' });
        await taken(INSIDER, 'project.duplicate', { sourceProjectId: P_PRIVATE, name: 'Copy of private' });
    });

    it('the folder a list goes in, and the folder a folder goes in', async () => {
        await hidden(OUTSIDER, 'list.create', { projectId: P_OPEN, name: 'Later', folderId: F_PRIVATE });
        await hidden(OUTSIDER, 'list.move', { projectId: P_OPEN, sprintId: L_OPEN, folderId: MISSING });
        await hidden(OUTSIDER, 'folder.create', { projectId: P_OPEN, name: 'Quarter', parentFolderId: F_PRIVATE });
        await hidden(OUTSIDER, 'list.create', { projectId: P_OPEN, name: 'Later', folderId: 'not-an-id' });
        await taken(OUTSIDER, 'list.create', { projectId: P_OPEN, name: 'Later', folderId: F_OPEN });
        await taken(OUTSIDER, 'list.move', { projectId: P_OPEN, sprintId: L_OPEN, folderId: '' });
        await taken(OUTSIDER, 'folder.create', { projectId: P_OPEN, name: 'Quarter', parentFolderId: F_OPEN });
    });

    it('the lists a new folder takes in', async () => {
        await hidden(OUTSIDER, 'folder.create', { projectId: P_OPEN, name: 'Quarter', moveListIds: [L_OPEN, L_SECRET] });
        await hidden(OUTSIDER, 'folder.create', { projectId: P_OPEN, name: 'Quarter', subfolders: [{ name: 'Week', moveListIds: [L_SECRET] }] });
        await taken(OUTSIDER, 'folder.create', { projectId: P_OPEN, name: 'Quarter', moveListIds: [L_OPEN] });
        await taken(INSIDER, 'folder.create', { projectId: P_OPEN, name: 'Quarter', subfolders: [{ name: 'Week', moveListIds: [L_SECRET] }] });
    });

    it('the custom field a value is set in', async () => {
        await hidden(OUTSIDER, 'task.field.set', { taskId: T_OPEN, fieldId: FIELD_PRIVATE, value: 'x' });
        await hidden(OUTSIDER, 'task.field.set', { taskId: T_OPEN, fieldId: MISSING, value: 'x' });
        await taken(OUTSIDER, 'task.field.set', { taskId: T_OPEN, fieldId: FIELD_OPEN, value: 'x' });
        await taken(OUTSIDER, 'task.field.set', { taskId: T_OPEN, fieldId: FIELD_EVERYWHERE, value: 'x' });
        await taken(INSIDER, 'task.field.set', { taskId: T_PRIVATE, fieldId: FIELD_PRIVATE, value: 'x' });
    });

    it('the comment that is edited or answered', async () => {
        await hidden(OUTSIDER, 'comment.update', { taskId: T_OPEN, commentId: C_PRIVATE, body: 'Reworded' });
        await hidden(OUTSIDER, 'page.comment.reply', { pageId: PAGE_OPEN, commentId: PC_PRIVATE, text: 'Agreed' });
        await hidden(OUTSIDER, 'comment.update', { taskId: T_OPEN, commentId: MISSING, body: 'Reworded' });
        await taken(OUTSIDER, 'comment.update', { taskId: T_OPEN, commentId: C_OPEN, body: 'Reworded' });
        await taken(OUTSIDER, 'page.comment.reply', { pageId: PAGE_OPEN, commentId: PC_OPEN, text: 'Agreed' });
        await taken(INSIDER, 'page.comment.reply', { pageId: PAGE_PRIVATE, commentId: PC_PRIVATE, text: 'Agreed' });
    });

    it('the goal a target belongs to, and the list or task it counts', async () => {
        await hidden(OUTSIDER, 'goal.target.set', { goalId: G_HIDDEN, targetId: 't1', value: 3 });
        await hidden(OUTSIDER, 'goal.target.sources.add', { goalId: G_SHARED, targetId: 't1', kind: 'list', sourceId: L_SECRET });
        await hidden(OUTSIDER, 'goal.target.sources.add', { goalId: G_SHARED, targetId: 't1', kind: 'task', sourceId: T_PRIVATE });
        await taken(OUTSIDER, 'goal.target.set', { goalId: G_SHARED, targetId: 't1', value: 3 });
        await taken(OUTSIDER, 'goal.target.sources.add', { goalId: G_SHARED, targetId: 't1', kind: 'list', sourceId: L_OPEN });
        await taken(INSIDER, 'goal.target.set', { goalId: G_HIDDEN, targetId: 't1', value: 3 });
    });

    it('the people a saved view is kept to', async () => {
        await hidden(INSIDER, 'view.create', { projectId: P_PRIVATE, name: 'Theirs', kind: 'list', look: { assigneeIds: [OUTSIDER] } });
        await hidden(INSIDER, 'view.create', { projectId: P_PRIVATE, name: 'Theirs', kind: 'list', look: { assigneeIds: [MISSING] } });
        await taken(INSIDER, 'view.create', { projectId: P_PRIVATE, name: 'Mine', kind: 'list', look: { assigneeIds: [INSIDER] } });
    });

    it('every change of the proposal, not only the first', async () => {
        const out = await send(OUTSIDER, [...change('list.create', { projectId: P_OPEN, name: 'Later' }), ...change('project.duplicate', { sourceProjectId: P_PRIVATE, name: 'Copy' })]);
        expect(out).toMatchObject({ code: 404, body: { statusText: NOT_FOUND } });
        expect(waiting()).toHaveLength(0);
    });

    it('as before, for an owner', async () => {
        await taken(OWNER, 'project.duplicate', { sourceProjectId: P_PRIVATE, name: 'Copy of private' });
        await taken(OWNER, 'folder.create', { projectId: P_PRIVATE, name: 'Quarter', parentFolderId: F_PRIVATE });
        await taken(OWNER, 'task.field.set', { taskId: T_PRIVATE, fieldId: FIELD_PRIVATE, value: 'x' });
        await taken(OWNER, 'comment.update', { taskId: T_PRIVATE, commentId: C_PRIVATE, body: 'Reworded' });
    });
});
