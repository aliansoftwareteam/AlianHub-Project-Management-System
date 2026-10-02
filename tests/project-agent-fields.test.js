/* A project's settings for agents are saved by their own routes; the project update routes leave them alone,
   and an agent does not move a project to the trash, the archive, a closed state or back through them. */
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
jest.mock('../Modules/Knowledge/ingest/events', () => mockStub());
jest.mock('../Modules/Project/helpers/projectQuota', () => ({ TRASHED: 1, quotaStatus: () => null, syncProjectQuota: async () => null, privacyChange: () => null, syncProjectType: async () => null }));
jest.mock('../Modules/Project/helpers/projectHistory', () => ({ recordProjectChanges: jest.fn(async () => null) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpManageWorld');

const { CID, OWNER, ADMIN, MEMBER, OUTSIDER, TOKEN, P_OPEN, S_OPEN, settle } = world;
const { seed, rows } = world.create(mockDb);
const GUEST = OUTSIDER;

const routes = {};
const register = (method) => (routePath, ...handlers) => { routes[`${method} ${routePath}`] = handlers; };
const app = { get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') };
['Project', 'Trash'].forEach((name) => require(`../Modules/${name}/routes`).init(app));

const UPDATE = 'PUT /api/v1/project/:id';
const ALL_TASKS = 'PUT /api/v1/project/allTask/:id';
const RESTORE = 'PUT /api/v2/trash/:kind/:id/restore';

const session = (uid) => ({ uid });
const agentToken = (uid) => ({ uid, apiToken: { _id: TOKEN, kind: 'agent', name: 'Claude', userId: uid, scopes: ['read', 'write'] } });
const personalToken = (uid) => ({ uid, apiToken: { _id: TOKEN, name: 'A script', userId: uid, scopes: ['read', 'write'] } });

const send = async (route, caller, body, params = { id: P_OPEN }) => {
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
const refusals = (action) => rows(SCHEMA_TYPE.AUDIT_LOGS).filter((row) => row.action === 'agent.action_refused' && row.meta && row.meta.action === action);
const grant = (key, roles) => {
    const parent = rows(SCHEMA_TYPE.RULES).find((rule) => rule.isParent && rule.key === 'project');
    mockDb.seed(SCHEMA_TYPE.RULES, { key, name: key, isParent: false, parentId: String(parent._id), roles: roles.map((role) => ({ key: role, permission: true })) });
};

const STORED = {
    agentPolicy: { done: 'never', connected: 'propose_all' },
    agentManager: { on: false },
    agentLimits: { atOnce: 1, paused: true },
    agentManagerLookedOn: '2026-10-01',
};
const SENT = {
    agentPolicy: { done: 'yes', connected: 'single_task' },
    agentManager: { on: true },
    agentLimits: { atOnce: 9, paused: false },
    agentManagerLookedOn: '2099-01-01',
};
const DOTTED = { agentPolicy: ['agentPolicy.done', 'yes'], agentManager: ['agentManager.on', true], agentLimits: ['agentLimits.paused', false] };

const CALLERS = [
    ['an owner', session(OWNER)],
    ['an admin', session(ADMIN)],
    ['a member', session(MEMBER)],
    ['a guest', session(GUEST)],
    ['an agent\'s token', agentToken(OWNER)],
    ['an owner\'s API token', personalToken(OWNER)],
];

beforeEach(() => {
    jest.clearAllMocks();
    seed();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: GUEST, roleType: 0, status: 2, isDelete: false });
    ['project_delete', 'project_close', 'project_status_change', 'project_name_edit'].forEach((key) => grant(key, [3]));
    Object.assign(project(), JSON.parse(JSON.stringify(STORED)), { status: 'active', statusType: 'active', projectStatusData: [{ value: 'active', type: 'active', default: true }, { value: 'closed', type: 'close' }] });
});
afterEach(settle);
afterAll(() => { ['MCP_TOOLS_MANAGE', 'MCP_TOOLS_WORK', 'MCP_TOOLS_V2'].forEach((key) => { delete process.env[key]; }); });

describe('the project update leaves the settings for agents alone', () => {
    const FIELDS = Object.keys(STORED);
    const CASES = CALLERS.flatMap(([who, caller]) => FIELDS.map((field) => [who, field, caller]));

    it.each(CASES)('%s does not set %s', async (_who, field, caller) => {
        const out = await send(UPDATE, caller, { key: '$set', updateObject: { [field]: SENT[field] } });
        expect(out.code).toBeGreaterThanOrEqual(400);
        expect(project()[field]).toEqual(STORED[field]);
    });

    it.each(CASES.filter(([, field]) => DOTTED[field]))('%s does not set a part of %s', async (_who, field, caller) => {
        const [path, value] = DOTTED[field];
        const out = await send(UPDATE, caller, { updateObject: { [path]: value } });
        expect(out.code).toBeGreaterThanOrEqual(400);
        expect(project()[field]).toEqual(STORED[field]);
    });

    it.each(CASES)('%s does not clear %s', async (_who, field, caller) => {
        const out = await send(UPDATE, caller, { key: '$unset', updateObject: { [field]: '' } });
        expect(out.code).toBeGreaterThanOrEqual(400);
        expect(project()[field]).toEqual(STORED[field]);
    });

    it.each(FIELDS)('%s beside a field the caller may write refuses the whole update', async (field) => {
        const out = await send(UPDATE, session(OWNER), { updateObject: { ProjectName: 'Renamed', [field]: SENT[field] } });
        expect(out).toMatchObject({ code: 400, body: { status: false, statusText: `${field} cannot be changed.` } });
        expect(project()).toMatchObject({ ProjectName: 'Open', ...STORED });
    });

    it.each([['an owner', session(OWNER)], ['a member', session(MEMBER)], ['an agent\'s token', agentToken(OWNER)], ['an owner\'s API token', personalToken(OWNER)]])('%s still renames the project', async (_who, caller) => {
        expect((await send(UPDATE, caller, { updateObject: { ProjectName: 'Renamed' } })).code).toBe(200);
        expect(project()).toMatchObject({ ProjectName: 'Renamed', ...STORED });
    });
});

describe('who moves a project to the trash, the archive, a closed state or back', () => {
    const MOVES = [
        ['to the trash', { deletedStatusKey: 1 }, 'project.delete'],
        ['to the archive', { deletedStatusKey: 2 }, 'project.delete'],
        ['back from the trash', { deletedStatusKey: 0 }, 'project.delete'],
        ['to a closed state', { status: 'closed', statusType: 'close' }, 'project.status.set'],
        ['to a closed state by its status alone', { status: 'closed' }, 'project.status.set'],
        ['to a closed state by its type alone', { statusType: 'close' }, 'project.status.set'],
        ['back to an open state', { status: 'active', statusType: 'active' }, 'project.status.set'],
    ];
    const before = () => ({ deletedStatusKey: project().deletedStatusKey, status: project().status, statusType: project().statusType });

    it.each(MOVES)('an agent\'s token does not move it %s, and the attempt is recorded', async (_move, updateObject, action) => {
        const was = before();
        const out = await send(UPDATE, agentToken(OWNER), { updateObject });
        expect(out).toMatchObject({ code: 403, body: { status: false, auditId: expect.anything() } });
        expect(before()).toEqual(was);
        expect(refusals(action)).toHaveLength(1);
    });

    it('an agent\'s token does not move it with an operator of its own', async () => {
        expect((await send(UPDATE, agentToken(OWNER), { key: '$unset', updateObject: { deletedStatusKey: '' } })).code).toBe(403);
        expect(project().deletedStatusKey).toBe(0);
    });

    it.each(MOVES.flatMap(([move, updateObject]) => [
        ['an owner', move, session(OWNER), updateObject],
        ['a member who holds the right', move, session(MEMBER), updateObject],
        ['an owner\'s API token', move, personalToken(OWNER), updateObject],
    ]))('%s moves it %s as before', async (_who, _move, caller, updateObject) => {
        expect((await send(UPDATE, caller, { updateObject })).code).toBe(200);
        expect(project()).toMatchObject(updateObject);
        expect(rows(SCHEMA_TYPE.AUDIT_LOGS).filter((row) => row.action === 'agent.action_refused')).toHaveLength(0);
    });

    const TRASH_TASKS = { findObject: { deletedStatusKey: { $in: [0, null] } }, updateObject: { $set: { deletedStatusKey: 1 } } };
    const tasksOf = () => rows(SCHEMA_TYPE.TASKS).filter((task) => String(task.ProjectID) === P_OPEN).map((task) => task.deletedStatusKey);

    it('an agent\'s token does not move the tasks of a project with it, and the attempt is recorded', async () => {
        const out = await send(ALL_TASKS, agentToken(OWNER), TRASH_TASKS);
        expect(out).toMatchObject({ code: 403, body: { status: false } });
        expect(tasksOf().every((key) => key === 0)).toBe(true);
        expect(refusals('project.delete')).toHaveLength(1);
    });

    it.each([['an owner', session(OWNER)], ['an owner\'s API token', personalToken(OWNER)]])('%s moves the tasks of a project with it as before', async (_who, caller) => {
        expect((await send(ALL_TASKS, caller, TRASH_TASKS)).code).toBe(200);
        expect(tasksOf().every((key) => key === 1)).toBe(true);
    });

    const KINDS = { projects: () => P_OPEN, tasks: () => String(rows(SCHEMA_TYPE.TASKS).find((task) => String(task.ProjectID) === P_OPEN)._id), lists: () => S_OPEN, docs: () => '6f0000000000000000000e91' };

    it.each(Object.keys(KINDS))('an agent\'s token does not bring %s back from the trash, and the attempt is recorded', async (kind) => {
        project().deletedStatusKey = 1;
        const out = await send(RESTORE, agentToken(OWNER), {}, { kind, id: KINDS[kind]() });
        expect(out).toMatchObject({ code: 403, body: { status: false, auditId: expect.anything() } });
        expect(project().deletedStatusKey).toBe(1);
        expect(refusals('trash.restore')).toHaveLength(1);
    });

    it.each([['an owner', session(OWNER)], ['an owner\'s API token', personalToken(OWNER)]])('%s brings a project back from the trash as before', async (_who, caller) => {
        project().deletedStatusKey = 1;
        expect(await send(RESTORE, caller, {}, { kind: 'projects', id: P_OPEN })).toMatchObject({ code: 200, body: { status: true } });
        expect(project().deletedStatusKey).toBe(0);
    });
});
