/* Every read a connected agent addresses by a task or a project answers the same for one its person cannot open as
   for one that is not there, and leaves the same record. A task or project the person can open is still judged by
   the rules of its own project. */
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
jest.mock('../Modules/Comments/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());
jest.mock('../Modules/CustomField/controller', () => mockStub());
jest.mock('../utils/planHelper', () => mockStub());
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../common-storage/common-server.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { evaluatePermission, isReadable, isWritable } = require('../Config/permissionGuard');
const world = require('./fixtures/mcpWorkWorld');
const registry = require('../Modules/Agents/registry');
const tools = require('../Modules/Mcp/tools');
const server = require('../Modules/Mcp/server');

const { CID, OWNER, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, T_OPEN, T_PRIVATE, TOKEN, MISSING, FLAGS, settle } = world;
const { seed, rows, stored, rpcThrough } = world.create(mockDb);
const rpc = rpcThrough(server);

const TOOL_FLAGS = ['MCP_TOOLS_DATA', 'MCP_TOOLS_MANAGE', 'MCP_TOOLS_WORK'];
const BASE = 'https://hub.example.test';
const KINDS = { task: 'taskId', project: 'projectId' };
const OPEN = { task: T_OPEN, project: P_OPEN };
const CLOSED = { task: T_PRIVATE, project: P_PRIVATE };
/* What a tool needs beside the id it is addressed by. */
const ALSO = { 'screen.link': { task: { screen: 'task' }, project: { screen: 'project' } } };

TOOL_FLAGS.forEach((flag) => { process.env[flag] = 'on'; });
/* Every read that takes a task id or a project id and is judged before it runs, as the tool list holds them now. */
const ADDRESSED = tools.registered()
    .filter((tool) => tool.run && tool.action && tool.visibility === 'filtered' && !tool.authorizesPerProject && tool.input && tool.input.properties)
    .flatMap((tool) => Object.keys(KINDS).filter((kind) => tool.input.properties[KINDS[kind]]).map((kind) => [tool.name, kind]));
const toolOf = (name) => tools.registered().find((tool) => tool.name === name);
const actionOf = (name) => toolOf(name).action;
const judgedBy = (name) => registry.permissionsFor(actionOf(name)).map((entry) => entry.key);
const argsFor = (name, kind, id) => ({ ...((ALSO[name] || {})[kind] || {}), [KINDS[kind]]: id });
/* Whether a member of the private project holds what the tool is judged by there: by the project's own rules when
 * the tool is judged by the thing it is addressed by, by the workspace's when it is not. */
const heldInThePrivateProject = async (name, kind) => {
    const tool = toolOf(name);
    const args = argsFor(name, kind, CLOSED[kind]);
    const judged = tool.readParams ? tool.readParams(args) : { taskId: args.taskId };
    const byProject = judged.taskId !== undefined || judged.projectId !== undefined;
    for (const { key, write } of registry.permissionsFor(tool.action)) {
        const value = await evaluatePermission(CID, INSIDER, key, byProject ? { projectId: P_PRIVATE } : {});
        if (!(write ? isWritable(value) : isReadable(value))) return false;
    }
    return true;
};

const caller = (uid) => world.ctx(uid, { token: { _id: TOKEN, userId: uid, scopes: ['read', 'write'], grants: ['tasks:manage', 'docs:manage'], active: true } });
const ask = (uid, name, kind, id) => rpc(caller(uid), name, argsFor(name, kind, id));
const answerOf = ({ auditId, ...rest }) => rest;
const refusals = () => rows(SCHEMA_TYPE.AUDIT_LOGS).filter((row) => row.meta && row.meta.ran === false);
const shapeOf = (row) => ({ action: row.action, entityType: row.entityType, actorId: row.actorId, tool: row.meta.action, reason: row.meta.reason, paramKeys: Object.keys(row.meta.params || {}).sort() });

/* Ask about `id`, and answer what the caller is told with the record the call left. */
const told = async (uid, name, kind, id) => {
    const before = refusals().length;
    const answer = await ask(uid, name, kind, id);
    return { answer: answerOf(answer), record: refusals().slice(before).map(shapeOf) };
};

const everyKey = () => [...new Set(ADDRESSED.flatMap(([name]) => judgedBy(name)))];
const seedRule = (type, path, permission, extra = {}) => {
    const [section, key] = path.split('.');
    const parent = rows(type).find((rule) => rule.isParent && rule.key === section && String(rule.projectId || '') === String(extra.projectId || ''))
        || mockDb.seed(type, { key: section, name: section, isParent: true, roles: [], ...extra });
    const held = rows(type).find((rule) => !rule.isParent && rule.key === key && String(rule.parentId) === String(parent._id));
    if (held) held.roles = [{ key: 3, permission }, { key: 0, permission }];
    else mockDb.seed(type, { key, name: key, isParent: false, parentId: String(parent._id), roles: [{ key: 3, permission }, { key: 0, permission }], ...extra });
};

/* The private project keeps rules of its own, and they give members and guests none of the keys these reads need. */
const lockThePrivateProject = () => {
    stored(SCHEMA_TYPE.PROJECTS, P_PRIVATE).isGlobalPermission = false;
    everyKey().forEach((path) => seedRule(SCHEMA_TYPE.PROJECT_RULES, path, path === 'task.task_list' ? false : null, { projectId: P_PRIVATE }));
};

beforeEach(() => {
    seed();
    TOOL_FLAGS.forEach((flag) => { process.env[flag] = 'on'; });
    process.env.WEBURL = BASE;
    everyKey().forEach((path) => seedRule(SCHEMA_TYPE.RULES, path, true));
});
afterEach(settle);
afterAll(() => { [...FLAGS, 'WEBURL'].forEach((flag) => { delete process.env[flag]; }); });

describe('the reads addressed by a task or a project', () => {
    it('are found by the table (the scan works)', () => {
        const names = ADDRESSED.map(([name, kind]) => `${name} by ${kind}`);
        expect(names).toEqual(expect.arrayContaining([
            'task.get by task', 'comments.list by task', 'subtasks.list by task', 'task.history by task', 'task.links.list by task', 'task.relations.list by task', 'task.lists.list by task',
            'project.get by project', 'sprints.list by project', 'statuses.list by project', 'lists.list by project', 'tags.list by project', 'fields.list by project',
            'screen.link by task', 'screen.link by project',
        ]));
        expect(ADDRESSED.length).toBeGreaterThan(18);
    });

    it('include one whose key a project can withhold from a person who opens its tasks', async () => {
        lockThePrivateProject();
        expect(await heldInThePrivateProject('task.history', 'task')).toBe(false);
        expect(await ask(INSIDER, 'task.history', 'task', T_PRIVATE)).toMatchObject({ refused: true, reason: expect.stringMatching(/^permission_denied: task\.task_activity_log/) });
        expect(await ask(INSIDER, 'task.history', 'task', T_OPEN)).not.toHaveProperty('refused');
    });

    describe.each(ADDRESSED)('%s, by %s', (name, kind) => {
        it.each([['a member outside it', OUTSIDER], ['a guest', GUEST]])('answers %s the same for one they cannot open as for one that is not there, and leaves the same record', async (_who, uid) => {
            lockThePrivateProject();
            const missing = await told(uid, name, kind, MISSING);
            const closed = await told(uid, name, kind, CLOSED[kind]);
            expect(closed).toEqual(missing);
            expect(JSON.stringify(closed.answer)).not.toMatch(/Private/);
        });

        it('answers the same for both when the workspace itself withholds the key, and leaves the same record', async () => {
            lockThePrivateProject();
            judgedBy(name).forEach((path) => seedRule(SCHEMA_TYPE.RULES, path, null));
            const missing = await told(OUTSIDER, name, kind, MISSING);
            const closed = await told(OUTSIDER, name, kind, CLOSED[kind]);
            expect(missing.answer).toMatchObject({ refused: true, reason: expect.stringMatching(/^permission_denied/) });
            expect(missing.record).toHaveLength(1);
            expect(closed).toEqual(missing);
        });

        it('judges one the person can open by the rules of its own project: permission denied where they withhold the key', async () => {
            lockThePrivateProject();
            const held = await heldInThePrivateProject(name, kind);
            const answer = await ask(INSIDER, name, kind, CLOSED[kind]);
            if (held) {
                expect(answer).not.toHaveProperty('refused');
                expect(refusals()).toHaveLength(0);
            } else {
                expect(answer).toMatchObject({ refused: true, reason: expect.stringMatching(/^permission_denied/) });
                expect(refusals().map(shapeOf)).toEqual([expect.objectContaining({ tool: actionOf(name), reason: expect.stringMatching(/^permission_denied/) })]);
            }
        });

        it('answers for one the person can open where the rules allow it', async () => {
            const open = await ask(OUTSIDER, name, kind, OPEN[kind]);
            expect(open).not.toHaveProperty('refused');
            expect(open).not.toHaveProperty('rpcError');
            expect(open).not.toHaveProperty('isError');
            expect((await ask(OWNER, name, kind, CLOSED[kind]))).not.toHaveProperty('refused');
            expect(refusals()).toHaveLength(0);
        });
    });
});
