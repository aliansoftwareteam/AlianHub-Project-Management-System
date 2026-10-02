process.env.STORAGE_TYPE = 'server';
process.env.EXTERNAL_AGENT_SESSIONS = 'on';
jest.setTimeout(30000);
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
jest.mock('../Modules/Sprints/scrum', () => mockStub());
jest.mock('../Modules/Sprints/burndown', () => mockStub());
jest.mock('../Modules/Sprints/hours', () => mockStub());
jest.mock('../Modules/Pages/controller', () => mockStub());
jest.mock('../Modules/Pages/comments', () => mockStub());
jest.mock('../Modules/Pages/versions', () => mockStub());
jest.mock('../Modules/Importers/controller', () => mockStub());
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
/* A brief is refused in front of its upload while the workspace has no AI set up. */
jest.mock('../Modules/AICore/llmProvider', () => ({ ...jest.requireActual('../Modules/AICore/llmProvider'), isAnyProviderConfigured: () => true }));

const fs = require('fs');
const path = require('path');
const express = require('express');
const { EventEmitter } = require('events');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/accessWorld');
const { OUTSIDE_EVERY_PROJECT } = require('./fixtures/agentRoutesOutsideProjects');
const registry = require('../Modules/Agents/registry');
const registryGroups = require('../Modules/Agents/registryGroups');
const projectPolicy = require('../Modules/Agents/projectPolicy');
const projectLimits = require('../Modules/Agents/projectLimits');
const { agentPerimeter } = require('../Modules/Agents/guard');
const { schema } = require('../utils/mongo-handler/schema');
const { FIELD_PERMISSIONS } = require('../Config/projectAccess');
const { runForAgentOf, agentOf } = require('../Config/agentRequest');
const { commentThreadAccess } = require('../Modules/Comments/helpers/threadAccess');
const { canReadTask } = require('../Modules/Tasks/helpers/taskReadAccess');
const { companyWideMatch, readsCompanyWide } = require('../Modules/Tasks/helpers/taskQueryGuard');

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, L_OPEN, L_PRIVATE, T_OPEN, T_PRIVATE, settle } = world;
const { seed, rows } = world.create(mockDb);

const T_OPEN_2 = '6f0000000000000000000d09';
const P_NOWHERE = '6f0000000000000000000aff';
const T_NOWHERE = '6f0000000000000000000dff';
const PAGE = '6f0000000000000000000e01';
const COMMENT = '6f0000000000000000000e02';
const FOLDER = '6f0000000000000000000c01';
const CONNECTION = '6f0000000000000000000c02';
const REACHED = 'reached its handler';

const routes = {};
const mounted = [];
/* The same routes on an app of the server's own kind, which the perimeter reads a route's guard from. */
const served = express();
const register = (method) => (routePath, ...handlers) => {
    routes[`${method} ${routePath}`] = handlers.flat();
    served[method.toLowerCase()](routePath, ...handlers);
};
const mount = (prefix, ...handlers) => { if (typeof prefix === 'string') mounted.push([prefix, handlers.flat()]); };
const app = { get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: mount };

/* Every route file of the server, so a route added later meets the tables below. */
const routeFilesUnder = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : routeFilesUnder(path.join(dir, entry.name));
    return entry.name === 'routes.js' ? [path.join(dir, entry.name)] : [];
});
const ROUTE_FILES = routeFilesUnder(path.join(__dirname, '..', 'Modules')).sort();
ROUTE_FILES.forEach((file) => require(file).init(app));

const session = (uid) => ({ uid });
const agentToken = (uid, extra = {}) => ({ uid, apiToken: { _id: '6f0000000000000000000101', kind: 'agent', name: 'Claude', userId: uid, scopes: ['read', 'write'], ...extra } });
const personalToken = (uid) => ({ uid, apiToken: { _id: '6f0000000000000000000102', name: 'A script', userId: uid, scopes: ['read', 'write'] } });
const agentRun = (uid) => ({ uid, agentRun: { _id: '6f0000000000000000000103', agentId: '6f0000000000000000000104', agentName: 'Triage' } });

const pathOf = (route, params = {}) => Object.entries(params).reduce((text, [name, value]) => text.replace(`:${name}`, value), route);

/* What is mounted over a path, run as the server runs it: with the path below the mount. */
const mountedOver = (url) => mounted.filter(([prefix]) => url === prefix || url.startsWith(`${prefix}/`)).flatMap(([prefix, handlers]) => handlers.map((handler) => (req, res, next) => {
    Object.assign(req, { url: url.slice(prefix.length) || '/', path: url.slice(prefix.length) || '/' });
    return handler(req, res, () => { Object.assign(req, { url, path: url }); return next(); });
}));

/* Runs what stands in front of every route, then every guard of the route, and stops in front of its handler. */
const through = (route, caller, body = {}, params = {}, query = {}) => new Promise((resolve) => {
    const [method, url] = pathOf(route, params).split(' ');
    const res = new EventEmitter();
    res.statusCode = 200;
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (answer) => { res.emit('finish'); resolve({ code: res.statusCode, body: answer }); return res; };
    res.json = res.send;
    res.end = () => res.send({});
    res.setHeader = () => res;
    const req = { ...caller, app: served, method, originalUrl: url, url, path: url, baseUrl: '', route: { path: route.split(' ')[1] }, query, params, headers: { companyid: CID }, aud: CID, ip: '1.1.1.1', body, get: () => '' };
    const guards = [agentPerimeter, ...mountedOver(url), ...routes[route].slice(0, -1)];
    const step = (at) => (at === guards.length ? (res.emit('finish'), resolve(REACHED)) : Promise.resolve().then(() => guards[at](req, res, () => step(at + 1))).catch((error) => resolve({ code: 500, body: { statusText: String(error && error.message) } })));
    step(0);
}).then(async (result) => { await settle(); return result; });

const opening = { statusKey: 1, statusType: 'default_active', status: { text: 'To Do', key: 1, type: 'default_active' } };
const newTask = (data, projectId = P_OPEN) => ({ data: { TaskName: 'New', ProjectID: projectId, sprintId: L_OPEN, ...data }, projectData: { _id: projectId, CompanyId: CID }, user: {} });
const CREATE = 'POST /api/v2/tasks';
const RELATIONS = 'POST /api/v2/tasks/relations';

/* [route, body, params]: the writes no registry action covers. */
const NO_ACTION = {
    'linking two tasks': [RELATIONS, { action: 'add', taskId: T_OPEN, relatedTaskId: T_OPEN_2, type: 'relates_to' }],
    'unlinking two tasks': [RELATIONS, { action: 'remove', taskId: T_OPEN, relatedTaskId: T_OPEN_2 }],
    'an unknown relation action': [RELATIONS, { action: 'somethingNew', taskId: T_OPEN }],
    'changing the tasks of a list at once': ['PUT /api/v1/task', { firstParameter: P_OPEN, secondParameter: L_OPEN, key: 2 }],
    'importing rows as tasks': ['PATCH /api/v1/importTasks', { tasks: [], projectData: { _id: P_OPEN, CompanyId: CID }, sprint: { id: L_OPEN } }],
    'importing from Jira': ['POST /api/v2/imports/jira', { data: { ProjectID: P_OPEN } }],
    'importing from a CSV file': ['POST /api/v2/imports/csv', { data: { ProjectID: P_OPEN } }],
    'importing from Trello': ['POST /api/v2/imports/trello', { data: { ProjectID: P_OPEN } }],
    'importing from Asana': ['POST /api/v2/imports/asana', { data: { ProjectID: P_OPEN } }],
    'importing from Monday': ['POST /api/v2/imports/monday', { data: { ProjectID: P_OPEN } }],
    'importing from ClickUp': ['POST /api/v2/imports/clickup', { data: { ProjectID: P_OPEN } }],
    'importing a ClickUp space as a project': ['POST /api/v2/imports/clickup/project', {}],
    'adding a list': ['POST /api/v1/sprint', { projectId: P_OPEN, name: 'New list' }],
    'changing a list': ['PATCH /api/v1/sprint/:id', { type: 'editSprintName', projectId: P_OPEN, name: 'Renamed' }, { id: L_OPEN }],
    'adding a folder': ['POST /api/v1/folder', { projectId: P_OPEN, name: 'New folder' }],
    'changing a folder': ['PATCH /api/v1/folder/:id', { type: 'editFolderName', projectId: P_OPEN, name: 'Renamed' }, { id: FOLDER }],
    'making a list a sprint': ['POST /api/v2/sprints/scrum', { sprintId: L_OPEN }],
    'starting a sprint': ['POST /api/v2/sprints/start', { sprintId: L_OPEN }],
    'completing a sprint': ['POST /api/v2/sprints/complete', { sprintId: L_OPEN }],
    'commenting on a doc': ['POST /api/v2/pages/:id/comments', { body: 'A comment' }, { id: PAGE }],
    'assigning a doc comment': ['PUT /api/v2/pages/:id/comments/:commentId/assign', { userId: OWNER }, { id: PAGE, commentId: COMMENT }],
    'reacting to a doc comment': ['PUT /api/v2/pages/:id/comments/:commentId/reaction', { emoji: '+1' }, { id: PAGE, commentId: COMMENT }],
    'resolving a doc comment': ['PUT /api/v2/pages/:id/comments/:commentId/resolve', {}, { id: PAGE, commentId: COMMENT }],
    'editing a doc comment': ['PUT /api/v2/pages/:id/comments/:commentId', { body: 'Edited' }, { id: PAGE, commentId: COMMENT }],
    'approving a drafted doc': ['PUT /api/v2/pages/:id/approve', {}, { id: PAGE }],
    'sharing a doc with someone': ['PUT /api/v2/pages/:id/shares/:userId', { role: 'view' }, { id: PAGE, userId: INSIDER }],
    'ending a share of a doc': ['DELETE /api/v2/pages/:id/shares/:userId', {}, { id: PAGE, userId: INSIDER }],
    'creating a project': ['POST /api/v1/createproject', { ProjectName: 'New', ProjectCode: 'NEW', AssigneeUserId: [], LeadUserId: [] }],
    'having the workspace\'s AI draft an automation': ['POST /api/v2/automations/draft', { sentence: 'When a task is created, assign it' }],
    'creating the tasks of a generated plan': ['POST /api/v1/ai/project/:projectId/tasks/execute', { plan: {} }, { projectId: P_OPEN }],
    'connecting an outside service': ['POST /api/v1/integrations/connections', { type: 'webhook', name: 'Hook', config: {} }],
    'changing a connection to an outside service': ['PUT /api/v1/integrations/connections/:id', { name: 'Hook' }, { id: CONNECTION }],
};

/* New tasks that carry more than a filed task does. */
const BEYOND_FILING = {
    'with someone assigned': newTask({ ...opening, AssigneeUserId: [INSIDER] }),
    'in a closed status': newTask({ statusKey: 3, statusType: 'close', status: { text: 'Done', key: 3, type: 'close' } }),
    'in a closed status sent under the opening type': newTask({ statusKey: 3, statusType: 'default_active', status: { text: 'To Do', key: 3, type: 'default_active' } }),
    'in the opening status sent under a closed type': newTask({ statusKey: 1, statusType: 'close' }),
    'in a status the project does not have': newTask({ statusKey: 99, statusType: 'default_active' }),
    'with a status object alone, naming a closed one': newTask({ status: { text: 'Done', key: 3, type: 'close' } }),
    'with other people watching': newTask({ ...opening, watchers: [OUTSIDER] }),
    'led by someone else': newTask({ ...opening, Task_Leader: [OUTSIDER] }),
    'with a custom field value': newTask({ ...opening, customField: { f1: 'x' } }),
    'with links to other tasks': newTask({ ...opening, relations: [{ taskId: T_OPEN, type: 'blocks' }] }),
    'of a type other than the project\'s first': newTask({ ...opening, TaskType: 'bug', TaskTypeKey: 2 }),
    'already archived': newTask({ ...opening, deletedStatusKey: 2 }),
};

const FILED = {
    'a title alone': newTask({}),
    'the fields the web sends for a plain task': newTask({ ...opening, TaskType: 'task', TaskTypeKey: 1, AssigneeUserId: [], watchers: [], deletedStatusKey: 0, isParentTask: true }),
    'a description, a priority and dates': newTask({ ...opening, rawDescription: 'Text', Task_Priority: 'HIGH', DueDate: '2026-10-10T00:00:00.000Z', startDate: '2026-10-01T00:00:00.000Z' }),
};

/* A sign-off is a signed-in person's: a token of any kind stops in front of it. */
const SIGN_OFF = NO_ACTION['approving a drafted doc'][0];
const OPEN_TO_TOKENS = Object.values(NO_ACTION).filter(([route]) => route !== SIGN_OFF);

const audits = (action) => rows(SCHEMA_TYPE.AUDIT_LOGS).filter((row) => row.action === action);
const agentAudits = () => rows(SCHEMA_TYPE.AUDIT_LOGS).filter((row) => String(row.action).startsWith('agent.'));
const AGENTS_OF = [['an owner', OWNER], ['an admin', ADMIN], ['a member', INSIDER], ['a member outside the private work', OUTSIDER], ['a guest', GUEST]];

beforeEach(() => {
    const { seedTask } = seed();
    seedTask(T_OPEN_2, 'Second open task', P_OPEN, L_OPEN);
    const taskRules = rows(SCHEMA_TYPE.RULES).find((rule) => rule.key === 'task');
    mockDb.seed(SCHEMA_TYPE.RULES, { key: 'task_create', name: 'task_create', isParent: false, parentId: String(taskRules._id), roles: [{ key: 3, permission: true }, { key: 0, permission: true }] });
    mockDb.seed(SCHEMA_TYPE.RULES, { key: 'sub_task_create', name: 'sub_task_create', isParent: false, parentId: String(taskRules._id), roles: [{ key: 3, permission: true }, { key: 0, permission: true }] });
});
afterEach(() => { ['MCP_TOOLS_MANAGE', 'MCP_TOOLS_WORK'].forEach((flag) => { delete process.env[flag]; }); });

describe('a token created for an agent, on the write routes beside the task route', () => {
    it.each(Object.keys(NO_ACTION).flatMap((name) => AGENTS_OF.map(([label, uid]) => [name, label, uid])))('%s is refused for the agent of %s, and recorded', async (name, label, uid) => {
        const [route, body, params] = NO_ACTION[name];

        const answer = await through(route, agentToken(uid), body, params);

        expect(answer.code).toBe(403);
        expect(answer.body.statusText).toMatch(/^(An agent is not allowed to do this|An agent is never allowed to do this|That action is not available to agents)/);
        expect(audits('agent.action_refused')).toHaveLength(1);
        expect(audits('agent.action_refused')[0].meta).toMatchObject({ ran: false, path: pathOf(route, params), onBehalfOf: uid });
        expect(audits('agent.action')).toHaveLength(0);
    });

    it('keeps refusing them whatever a flag or a grant on the token says', async () => {
        process.env.MCP_TOOLS_MANAGE = 'on';
        process.env.MCP_TOOLS_WORK = 'on';
        const granted = agentToken(OWNER, { grants: ['tasks:manage'] });

        for (const [route, body, params] of Object.values(NO_ACTION)) {
            expect([route, (await through(route, granted, body, params)).code]).toEqual([route, 403]);
        }
        for (const body of Object.values(BEYOND_FILING)) {
            expect((await through(CREATE, granted, body)).code).toBe(403);
        }
    });

    it.each([
        ['listing the links of a task', RELATIONS, { action: 'list', taskId: T_OPEN }],
        ['listing the open blockers of a task', RELATIONS, { action: 'openBlockers', taskId: T_OPEN }],
        ['previewing a CSV import', 'POST /api/v2/imports/csv/preview', {}],
    ])('%s, a read, still goes through and leaves no record', async (label, route, body) => {
        expect(await through(route, agentToken(OWNER), body)).toBe(REACHED);
        expect(agentAudits()).toHaveLength(0);
    });
});

describe('the backlog of a project, which is made the first time it is read', () => {
    const BACKLOG = 'POST /api/v2/sprints/backlog';
    const read = (caller) => through(BACKLOG, caller, { projectId: P_OPEN });

    it('is read by an agent once the project has one, and that leaves no record', async () => {
        mockDb.seed(SCHEMA_TYPE.SPRINTS, { name: 'Backlog', projectId: P_OPEN, isBacklog: true, deletedStatusKey: 0 });

        expect(await read(agentToken(OWNER))).toBe(REACHED);
        expect(await read(agentRun(OWNER))).toBe(REACHED);
        expect(agentAudits()).toHaveLength(0);
    });

    it('has the agent\'s part in front of the project\'s own guard; what an agent is answered is in sprint-backlog-read-by-agent', () => {
        expect(routes[BACKLOG][0].refusesAs).toBe('sprint.create');
    });

    it('is made for a person, signed in or through a personal token', async () => {
        for (const caller of [session(OWNER), session(INSIDER), personalToken(INSIDER)]) {
            expect(await read(caller)).toBe(REACHED);
        }
        expect(agentAudits()).toHaveLength(0);
    });
});

describe('a task filed by an agent through the create route', () => {
    it.each(Object.keys(FILED).flatMap((name) => [[name, 'an owner', OWNER], [name, 'a member', INSIDER], [name, 'a guest', GUEST]]))('with %s goes through for the agent of %s, and is recorded', async (name, label, uid) => {
        expect(await through(CREATE, agentToken(uid), FILED[name])).toBe(REACHED);

        expect(audits('agent.action_refused')).toHaveLength(0);
        expect(audits('agent.action')).toHaveLength(1);
        expect(audits('agent.action')[0].meta).toMatchObject({ action: 'task.create', state: 'applied', reason: 'via REST', onBehalfOf: uid });
    });

    it('is recorded as a subtask when it names a parent', async () => {
        expect(await through(CREATE, agentToken(OWNER), newTask({ ...opening, ParentTaskId: T_OPEN, isParentTask: false }))).toBe(REACHED);

        expect(audits('agent.action')[0].meta).toMatchObject({ action: 'subtask.create' });
    });

    it('may be led and watched by the person behind the token', async () => {
        expect(await through(CREATE, agentToken(INSIDER), newTask({ ...opening, Task_Leader: [INSIDER], watchers: [INSIDER] }))).toBe(REACHED);
    });

    it.each(Object.keys(BEYOND_FILING).flatMap((name) => [[name, 'an owner', OWNER], [name, 'an admin', ADMIN], [name, 'a member', INSIDER]]))('%s is refused for the agent of %s, and recorded', async (name, label, uid) => {
        const answer = await through(CREATE, agentToken(uid), BEYOND_FILING[name]);

        expect(answer.code).toBe(403);
        expect(answer.body.statusText).toMatch(/^That action is not available to agents \(task\.add\)/);
        expect(audits('agent.action_refused')).toHaveLength(1);
        expect(audits('agent.action_refused')[0].meta).toMatchObject({ ran: false, path: CREATE, onBehalfOf: uid });
    });

    const withoutAuditId = (answer) => (answer === REACHED ? answer : { code: answer.code, body: { ...answer.body, auditId: undefined } });
    const countedIn = () => rows(SCHEMA_TYPE.AGENT_WORK_MARKS).map((mark) => mark.scope);

    /* [what the project its person cannot open holds agents to, how it is set] */
    const HELD_TO = [
        ['nothing', () => {}],
        ['a pause', () => { projectRow(P_PRIVATE).agentLimits = { paused: true }; }],
        ['proposing every change', () => { projectRow(P_PRIVATE).agentPolicy = { connected: projectPolicy.CONNECTED.PROPOSE_ALL }; }],
    ];

    it.each(HELD_TO)('under a task its person cannot open is answered as one under a task that does not exist, where that task\'s project holds agents to %s', async (label, set) => {
        set();
        const under = (parent) => through(CREATE, agentToken(OUTSIDER), newTask({ ...opening, ParentTaskId: parent, isParentTask: false }));

        const hidden = await under(T_PRIVATE);
        const missing = await under(T_NOWHERE);

        expect(withoutAuditId(hidden)).toEqual(withoutAuditId(missing));
        expect(countedIn().filter((scope) => scope.includes(P_PRIVATE))).toEqual([]);
    });

    it.each(HELD_TO)('into a project its person cannot open is answered as one into a project that does not exist, where that project holds agents to %s', async (label, set) => {
        set();
        const into = (projectId) => through(CREATE, agentToken(OUTSIDER), newTask({ sprintId: L_PRIVATE }, projectId));

        expect(withoutAuditId(await into(P_PRIVATE))).toEqual(withoutAuditId(await into(P_NOWHERE)));
        expect(countedIn().filter((scope) => scope.includes(P_PRIVATE))).toEqual([]);
    });

    it.each([
        ['a member outside it', OUTSIDER],
        ['a guest', GUEST],
    ])('into a project %s cannot open is answered as one into a project that does not exist', async (label, uid) => {
        for (const data of [{}, opening, { ...opening, TaskType: 'task', TaskTypeKey: 1 }]) {
            const hidden = await through(CREATE, agentToken(uid), newTask({ ...data, sprintId: L_PRIVATE }, P_PRIVATE));
            const missing = await through(CREATE, agentToken(uid), newTask({ ...data, sprintId: L_PRIVATE }, P_NOWHERE));
            expect(withoutAuditId(hidden)).toEqual(withoutAuditId(missing));
        }
    });
});

describe('everyone else on those routes', () => {
    it.each([
        ['a signed-in owner', session(OWNER), Object.values(NO_ACTION)],
        ['a signed-in admin', session(ADMIN), Object.values(NO_ACTION)],
        ['a personal token of an owner', personalToken(OWNER), OPEN_TO_TOKENS],
    ])('%s reaches every one of them, and nothing is recorded as an agent\'s', async (label, caller, reached) => {
        for (const [route, body, params] of reached) {
            expect([route, await through(route, caller, body, params)]).toEqual([route, REACHED]);
        }
        for (const body of [...Object.values(BEYOND_FILING), ...Object.values(FILED)]) {
            expect(await through(CREATE, caller, body)).toBe(REACHED);
        }
        expect(agentAudits()).toHaveLength(0);
    });

    it.each([['an owner', OWNER], ['a member', INSIDER]])('a personal token of %s does not sign off a drafted doc', async (label, uid) => {
        const [route, body, params] = NO_ACTION['approving a drafted doc'];
        expect(await through(route, personalToken(uid), body, params)).toMatchObject({ code: 403, body: { status: false } });
        expect(agentAudits()).toHaveLength(0);
    });

    it.each([
        ['a signed-in member', session(INSIDER)],
        ['a signed-in guest', session(GUEST)],
        ['a personal token of a member', personalToken(INSIDER)],
    ])('%s is judged by the rules of the role alone', async (label, caller) => {
        for (const [route, body, params] of Object.values(NO_ACTION)) {
            const answer = await through(route, caller, body, params);
            if (answer !== REACHED) expect(JSON.stringify(answer.body)).not.toMatch(/An agent is n(?:ot|ever) allowed|not available to agents/);
        }
        for (const body of Object.values(BEYOND_FILING)) {
            expect(await through(CREATE, caller, body)).toBe(REACHED);
        }
        expect(await through(RELATIONS, caller, NO_ACTION['linking two tasks'][1])).toBe(REACHED);
        expect(await through('PUT /api/v1/task', caller, NO_ACTION['changing the tasks of a list at once'][1])).toBe(REACHED);
        expect(agentAudits()).toHaveLength(0);
    });
});

describe('the task a hidden one is not told apart from', () => {
    it('is the same for an agent linking to a task its person cannot open', async () => {
        const hidden = await through(RELATIONS, agentToken(OUTSIDER), { action: 'list', taskId: T_PRIVATE });
        const open = await through(RELATIONS, agentToken(OUTSIDER), { action: 'list', taskId: T_OPEN });

        expect(hidden).toBe(open);
    });
});

const FIELD = '6f0000000000000000000f01';
const RULE = '6f0000000000000000000f02';
const TEMPLATE = '6f0000000000000000000f03';
const SHARE = '6f0000000000000000000f04';
const UPDATE = 'PUT /api/v1/project/:id';
const inProject = { id: P_OPEN };
const projectUpdate = (updateObject, key) => [UPDATE, { updateObject, ...(key ? { key } : {}) }, inProject];
const fieldUpdate = (updateObject) => ['PUT /api/v1/customField', { type: 'updateOne', key: '$set', id: FIELD, updateObject }];
const rule = { name: 'Rule', projectId: P_OPEN, trigger: { type: 'task.created' }, steps: [] };
const closing = { action: 'updateStatus', newStatus: { statusKey: 3, statusType: 'close', status: { text: 'Done', key: 3, type: 'close' } }, prevStatus: { taskId: T_OPEN }, projectData: {}, task: { _id: T_OPEN }, isUpdateTask: true };

/* [route, body, params, the name the refusal is recorded under when it is not the action the row sits under]:
 * the web app's own routes for each change an agent may only propose through its MCP tools. */
const PROPOSED_ON_THE_WEB = {
    'fields.create': {
        'adding a field': ['POST /api/v1/customField', { type: 'save', updateObject: { fieldTitle: 'Risk', fieldType: 'text', type: 'task', global: false, projectId: [P_OPEN] } }],
        'changing a field': fieldUpdate({ fieldTitle: 'Renamed' }),
        'removing a field': fieldUpdate({ isDelete: true }),
    },
    'folder.create': {
        'adding a folder': ['POST /api/v1/folder', { projectId: P_OPEN, name: 'Design' }],
    },
    'list.sprint.set': {
        'making a list a sprint': ['POST /api/v2/sprints/scrum', { projectId: P_OPEN, sprintId: L_OPEN }, {}, 'sprint.scrum'],
    },
    'view.create': {
        'adding a saved view': ['POST /api/v1/project/:id/views', { sourceViewId: 'view-1', title: 'Mine', settings: {} }, inProject],
        'changing a saved view': ['PUT /api/v1/project/:id/view-settings', { viewId: 'view-1', settings: {} }, inProject],
        'replacing the views of a project': projectUpdate({ ProjectRequiredComponent: [] }),
        'changing one view of a project': projectUpdate({ 'ProjectRequiredComponent.0.name': 'Renamed' }),
        'removing a view of a project': projectUpdate({ ProjectRequiredComponent: { _id: 'view-1' } }, '$pull'),
        'choosing the view a project opens in': projectUpdate({ ProjectRequiredDefaultComponent: 'view-1' }),
        'changing the columns of the list': projectUpdate({ viewColumn: [] }),
    },
    'project.setup': {
        'replacing the statuses of a project': projectUpdate({ taskStatusData: [] }),
        'changing one status of a project': projectUpdate({ 'taskStatusData.0.name': 'Renamed' }),
        'choosing another status template': projectUpdate({ TemplateTaskStatusId: TEMPLATE }),
        'changing the states a project can be in': projectUpdate({ projectStatusData: [], projectStatusTemplateId: TEMPLATE }),
        'moving the tasks of a removed status': ['POST /api/v1/projectSetting/taskStatus', { projectId: P_OPEN, taskStatusKey: [2], oldTaskStatus: [] }],
        'limiting a status': ['POST /api/v1/projectSetting/taskStatus/wipLimit', { projectId: P_OPEN, statusKey: 2, wipLimit: 3 }],
        'changing the company list of task statuses': ['PUT /api/v1/setting/taskStatus', { name: 'Blocked' }],
        'changing the company list of project states': ['PUT /api/v1/setting/projectStatus', { name: 'On hold' }],
        'adding a status template': ['POST /api/v1/templates/taskStatus', { TemplateName: 'Ours' }],
        'changing a status template': ['PUT /api/v1/templates/taskStatus', { id: TEMPLATE }],
        'adding a project state template': ['POST /api/v1/project-status-template', { TemplateName: 'Ours' }],
        'changing a project state template': ['PUT /api/v1/project-status-template', { id: TEMPLATE }],
    },
    'project.create': {
        'creating a project': NO_ACTION['creating a project'],
        'copying a project': ['POST /api/v2/projects/:id/duplicate', { name: 'Copy' }, inProject],
        'creating a project from a saved one': ['POST /api/v2/projects/templates/:id/use', { name: 'From a saved one' }, { id: TEMPLATE }],
        'creating a project from a generated plan': ['POST /api/v1/ai/project/execute', { plan: {} }],
        'importing a ClickUp space as a project': [...NO_ACTION['importing a ClickUp space as a project'], {}, 'tasks.import'],
        'opening a personal list': ['POST /api/v1/project/personal', {}],
    },
    'project.duplicate': {
        'copying a project with its tasks': ['POST /api/v2/projects/:id/duplicate', { name: 'Copy', withTasks: true }, inProject, 'project.create'],
    },
    'dashboard.card.add': {
        'adding a card to the home dashboard': ['POST /api/v1/dashboard', { op: 'add', card: { key: 'DueSoonCard' } }, {}, 'dashboard.manage'],
        'adding a card to a dashboard': ['PUT /api/v1/dashboards/:id/cards', { cards: [{ key: 'DueSoonCard' }] }, { id: TEMPLATE }, 'dashboard.manage'],
    },
    'automation.create': {
        'adding an automation': ['POST /api/v2/automations', rule],
        'changing an automation': ['PUT /api/v2/automations/:id', rule, { id: RULE }, 'automation.update'],
        'switching an automation on or off': ['PATCH /api/v2/automations/:id/enabled', { enabled: true }, { id: RULE }, 'automation.enable'],
        'removing an automation': ['DELETE /api/v2/automations/:id', {}, { id: RULE }, 'automation.delete'],
        'adding an automation the earlier way': ['POST /api/v1/automations', rule],
        'changing an automation the earlier way': ['PUT /api/v1/automations/:id', rule, { id: RULE }, 'automation.update'],
        'running an automation over the tasks it matches': ['POST /api/v1/automations/:id/apply', {}, { id: RULE }, 'automation.apply'],
    },
};

/* The same for each change on the never-list. */
const NEVER_ON_THE_WEB = {
    'project.delete': {
        'moving a project to the trash': projectUpdate({ deletedStatusKey: 1 }),
        'changing every task of a project': ['PUT /api/v1/project/allTask/:id', { deletedStatusKey: 1 }, inProject],
    },
    'task.delete': {
        'changing many tasks at once': ['POST /api/v2/tasks/bulk', { action: 'bulkDelete', taskIds: [T_OPEN] }],
    },
    'billing.*': {
        'refunding a milestone': ['POST /api/v1/refundamount', {}],
        'changing how a project is billed': [...projectUpdate({ ProjectType: 'Hourly' }), 'billing.project'],
        'changing the currency of a project': [...projectUpdate({ ProjectCurrency: { code: 'EUR' } }), 'billing.project'],
        'changing the billing period of a project': [...projectUpdate({ BillingPeriod: 'Monthly' }), 'billing.project'],
    },
    'member.remove': {
        'changing a member': ['PUT /api/v1/members', {}],
        'inviting people': ['POST /api/v2/sendInvitationEmail', {}, {}, 'member.invite'],
        'importing people': ['POST /api/v1/importUser', {}, {}, 'member.invite'],
        'replacing the people on a project': projectUpdate({ AssigneeUserId: [OWNER, INSIDER] }),
        'adding someone to a project': projectUpdate({ AssigneeUserId: INSIDER }, '$addToSet'),
        'taking someone off a project': projectUpdate({ AssigneeUserId: INSIDER }, '$pull'),
        'changing who leads a project': projectUpdate({ LeadUserId: [INSIDER] }),
    },
    'permissions.edit': {
        'changing the company permission rules': ['PUT /api/v1/securityPermissions', {}],
        'changing a role': ['PUT /api/v1/setting/roles/update', {}],
        'changing the permission rules of a project': ['PUT /api/v1/projectRules/update', { projectId: P_OPEN }],
        'giving a project its own permission rules': ['POST /api/v1/importSettingsProjectFunction', { type: 'project', projectId: P_OPEN }],
        'importing the company settings again': ['POST /api/v1/importSettings', {}],
        'changing who uses the time tracker': ['POST /api/v1/manageTrackerUserPermission', {}, {}, 'member.seat'],
        'making a project private or open': projectUpdate({ isPrivateSpace: false }),
        'choosing which permission rules a project follows': projectUpdate({ isGlobalPermission: false }),
        'sharing by a public link': ['POST /api/v2/public-shares', { entityType: 'project', entityId: P_OPEN }, {}, 'share.public'],
        'changing a public link': ['PUT /api/v2/public-shares/:id', { password: '' }, { id: SHARE }, 'share.public'],
    },
    'status.set("Done")': {
        'closing a task': ['PATCH /api/v2/tasks', closing, {}, 'task.status.set'],
    },
};

/* The same for what no registry action covers: how a project or the workspace is set up for everyone, and what the
 * workspace's AI writes when asked. Each sits under the name its refusal is recorded by. */
const SET_UP_BY_PEOPLE = {
    'task_types.edit': {
        'replacing the task types of a project': projectUpdate({ taskTypeCounts: [] }),
        'changing one task type of a project': projectUpdate({ 'taskTypeCounts.0.name': 'Renamed' }),
        'choosing another task type template': projectUpdate({ TaskTypeTemplateId: TEMPLATE }),
        'moving the tasks of a removed task type': ['POST /api/v1/projectSetting/taskType', { projectId: P_OPEN, taskTypeKey: [2], oldTaskType: [] }],
        'changing the company list of task types': ['PUT /api/v1/setting/taskType', { name: 'Spike' }],
        'adding a task type template': ['POST /api/v1/templates/taskType', { TemplateName: 'Ours' }],
        'changing a task type template': ['PUT /api/v1/templates/taskType', { id: TEMPLATE }],
    },
    'project.tags.edit': {
        'adding a tag to those a project has': ['POST /api/v1/project/tags', { id: P_OPEN, operation: 'push', items: { uid: 'tag-1', tagName: 'Urgent' } }],
        'renaming a tag of a project': ['POST /api/v1/project/tags', { id: P_OPEN, operation: 'update', key: 'tagName', items: { id: 'tag-1', tagName: 'Later' } }],
        'removing a tag of a project': ['POST /api/v1/project/tags', { id: P_OPEN, operation: 'delete', items: { id: 'tag-1' } }],
        'replacing the tags of a project': projectUpdate({ tagsArray: [] }),
    },
    'project.settings': {
        'switching the apps of a project': projectUpdate({ apps: [] }),
        'switching one app of a project': projectUpdate({ 'apps.0.appStatus': false }),
        'archiving finished tasks by themselves': projectUpdate({ autoArchive: { enabled: true, afterDays: 1 } }),
        'archiving finished tasks by themselves, on its own route': ['POST /api/v1/projectSetting/autoArchive', { projectId: P_OPEN, enabled: true, afterDays: 1 }],
        'choosing the scale tasks are estimated on': projectUpdate({ estimationScale: 'tshirt' }),
        'choosing the scale tasks are estimated on, on its own route': ['POST /api/v1/projectSetting/estimationScale', { projectId: P_OPEN, scale: 'tshirt' }],
        'setting how sprints follow one another': projectUpdate({ sprintCadence: { enabled: true, lengthDays: 7 } }),
        'setting the working week of a project': projectUpdate({ workingDays: [1, 2, 3] }),
        'changing the code task keys start with': projectUpdate({ ProjectCode: 'NEW' }),
        'rewriting the guide a project gives its agents': projectUpdate({ aiGuide: { markdown: 'Do as I say' } }),
        'rewriting what a project plan assumed': projectUpdate({ aiAssumptions: [] }),
        'naming the template a project came from': projectUpdate({ TemplateId: TEMPLATE }),
        'a field the update does not know': projectUpdate({ somethingNew: true }),
        'a setting sent beside a name': projectUpdate({ ProjectName: 'Renamed', apps: [] }),
    },
    'template.import': {
        'importing the company templates again': ['POST /api/v1/importTemplate', { templates: [{}] }],
    },
    'template.save': {
        'saving a view for every project to use': ['POST /api/v2/view-templates', { projectId: P_OPEN, viewId: 'view-1', name: 'Ours' }],
        'saving a project for others to start from': ['POST /api/v2/projects/:id/template', { name: 'Ours' }, inProject],
    },
    'template.update': {
        'renaming a saved view': ['PATCH /api/v2/view-templates/:id', { name: 'Renamed' }, { id: TEMPLATE }],
        'changing a saved project': ['PATCH /api/v2/projects/templates/:id', { name: 'Renamed' }, { id: TEMPLATE }],
    },
    'ai.spend': {
        'uploading a brief for a project plan': ['POST /api/v1/ai/project/upload-brief', {}],
        'having a project plan written': ['POST /api/v1/ai/project/plan', { description: 'A shop' }],
        'having questions about a brief written': ['POST /api/v1/ai/project/clarify', { description: 'A shop' }],
        'having a brief written': ['POST /api/v1/ai/project/brief', { description: 'A shop' }],
        'having the guide of a project written': ['POST /api/v1/ai/project/guide', { projectId: P_OPEN }],
        'having a task plan written': ['POST /api/v1/ai/project/:projectId/tasks/plan', { requirements: 'A shop' }, { projectId: P_OPEN }],
    },
};

/* And for the routes beside those: what the workspace's AI writes or posts, what is set for a whole project or the whole
 * workspace, what goes out to other people or outside, what is removed for good, and how the person signs in. */
const ALSO_BY_PEOPLE = {
    'ai.spend': {
        'having a prompt answered': ['POST /api/v1/generatePrompt', {}],
        'carrying on a chat with the AI': ['POST /api/v1/generatePromptChat', {}],
        'having a description written': ['POST /api/v1/ai/description', { title: 'A task' }],
        'having a task summarised': ['POST /api/v1/ai/task-summary', { taskId: T_OPEN }],
        'having a task filed under a label': ['POST /api/v1/ai/task-category', { taskId: T_OPEN }],
        'having next steps suggested': ['POST /api/v1/ai/task-next-steps', { taskId: T_OPEN }],
        'having a selection rewritten': ['POST /api/v1/ai/selection/improve', { text: 'Some text' }],
        'having a selection split into tasks': ['POST /api/v1/ai/selection/tasks', { text: 'Some text' }],
        'asking the AI a question': ['POST /api/v1/ai/ask', { question: 'What is late?' }],
        'asking the AI a question, answered as it is written': ['POST /api/v1/ai/ask/stream', { question: 'What is late?' }],
        'asking for a dashboard card': ['POST /api/v1/ai/ask/card/:dashboardId/:cardUid', {}, { dashboardId: TEMPLATE, cardUid: 'card-1' }],
        'having pasted text turned into what the AI remembers': ['POST /api/v1/ai/memory/import/preview', { text: 'Some text' }],
        'having a recording written out': ['POST /api/v1/ai/transcribe', {}],
        'having meeting notes written': ['POST /api/v1/ai/meeting-notes', { transcript: 'Some text' }],
        'having a conversation summarised': ['POST /api/v1/ai/chat-summary', { projectId: P_OPEN, taskId: T_OPEN }],
        'having tasks proposed from notes': ['POST /api/v1/ai/notes-to-tasks/propose', {}],
        'having a task researched': ['POST /api/v1/ai/task-research', { taskId: T_OPEN }],
        'asking the AI about a conversation': ['POST /api/v1/ai/chat-ask', { projectId: P_OPEN, taskId: T_OPEN }],
        'having a field filled for a few tasks': ['POST /api/v2/custom-fields/:fieldId/ai/preview', {}, { fieldId: FIELD }],
        'having a field filled for many tasks': ['POST /api/v2/custom-fields/:fieldId/ai/jobs', {}, { fieldId: FIELD }],
        'having a task estimated': ['POST /api/v1/estimatedTime/ai/:tid', {}, { tid: T_OPEN }],
        'having an estimate proposed': ['POST /api/v1/estimatedTime/ai/:tid/propose', {}, { tid: T_OPEN }],
        'having assignment rules drafted': ['POST /api/v2/assignment-rules/project/:projectId/draft', {}, { projectId: P_OPEN }],
        'having a project template drafted': ['POST /api/v1/project/template/custom/ai-generate', {}],
        'having a portfolio summarised': ['POST /api/v1/portfolio/summary', {}],
        'saving the notes of a call': ['POST /api/v2/calls/notes', {}],
    },
    'aifield.apply': {
        'writing what the AI suggested for a field onto tasks': ['POST /api/v2/custom-fields/:fieldId/ai/apply', { proposalIds: [] }, { fieldId: FIELD }],
    },
    'ai.answer.post': {
        'posting an answer of the AI in a conversation': ['POST /api/v1/ai/ask/post', {}],
        'posting what the AI said about a conversation': ['POST /api/v1/ai/chat-ask/post', {}],
    },
    'ai.memory.edit': {
        'changing what the AI remembers of the person': ['PUT /api/v1/ai/memory', { nickname: 'Olive' }],
        'adding to what the AI remembers of the person': ['POST /api/v1/ai/memory/import/confirm', { items: [] }],
    },
    'tasks.import': {
        'creating the tasks an answer of the AI lists': ['POST /api/v1/ai/ask/create-tasks', { projectId: P_OPEN, tasks: [] }],
        'creating the tasks proposed from notes': ['POST /api/v1/ai/notes-to-tasks', {}],
    },
    'task.delete': {
        'taking back the tasks made from notes': ['POST /api/v1/ai/notes-to-tasks/undo', {}],
    },
    'project.settings': {
        'setting who new tasks of a project go to': ['PUT /api/v2/assignment-rules/project/:projectId', { rules: [] }, { projectId: P_OPEN }],
        'choosing the template new tasks of a project start from': ['PUT /api/v2/task-templates/default', { projectId: P_OPEN }],
    },
    'template.save': {
        'saving a project template for the company': ['POST /api/v1/project/template/custom', { TemplateName: 'Ours' }],
        'saving a task as a template': ['POST /api/v2/task-templates', { taskId: T_OPEN, name: 'Ours' }],
    },
    'template.update': {
        'renaming a task template': ['PATCH /api/v2/task-templates/:id', { name: 'Renamed' }, { id: TEMPLATE }],
    },
    'template.apply': {
        'writing a template onto a task': ['POST /api/v2/task-templates/:id/apply', { taskId: T_OPEN }, { id: TEMPLATE }],
    },
    'portfolio.edit': {
        'adding a portfolio': ['POST /api/v1/portfolio', { name: 'Ours', projectIds: [P_OPEN] }],
        'changing a portfolio': ['PUT /api/v1/portfolio/:id', { name: 'Renamed' }, { id: TEMPLATE }],
    },
    'billing.entries': {
        'marking logged time as billable': ['PUT /api/v1/timesheet/entries/billable', { ids: [], billable: true }],
    },
    'billing.rates': {
        'setting a billing rate': ['POST /api/v1/timesheet/rates', { scope: 'default', rate: 10 }],
    },
    'workload.move': {
        'moving planned work to another day or person': ['POST /api/v1/timesheet/workload-move', { taskId: T_OPEN }],
    },
    'email.send': {
        'mailing the people who have not logged time': ['POST /api/v1/timesheet/send-reminders', {}],
        'mailing the support address': ['POST /api/v2/support-mail', { message: 'Help' }],
    },
    'notification.send': {
        'pushing a message to people': ['POST /api/v1/send-fcm', { userIds: [INSIDER], message: 'Hello' }],
        'sending people a notification': ['POST /api/v2/prepare-notification-data', { userIds: [INSIDER], message: 'Hello' }],
    },
    'unread.reset': {
        'clearing the unread counts of everyone': ['POST /api/v1/unsetCommentCounts', { projectId: P_OPEN }],
    },
    'workspace.settings': {
        'changing the company list of designations': ['PUT /api/v1/setting/designation/update', {}],
        'changing the company list of skills': ['PUT /api/v1/setting/skills', {}],
        'changing the date format of the company': ['PUT /api/v1/commonDateFormate', {}],
        'changing which files the company takes': ['PUT /api/v1/fileExtensions', {}],
        'changing a currency of the company': ['PUT /api/v1/currency/:cid/:id', {}, { cid: CID, id: TEMPLATE }],
        'changing the company list of priorities': ['PUT /api/v1/taskPriority', {}],
        'changing the details of the company': ['PUT /api/v1/company', { Cst_CompanyName: 'Renamed' }],
        'changing the details of the company, the other way': ['PUT /api/v1/admin/company', { Cst_CompanyName: 'Renamed' }],
        'changing how long screenshots are kept': ['PUT /api/v1/screenshot-retention', { enabled: true, maxAgeMonths: 1 }],
        'changing who is reminded to log time': ['PUT /api/v1/timesheet/reminder-settings', { enabled: true }],
    },
    'workspace.create': {
        'creating another company': ['POST /api/v2/company/create', {}],
    },
    'webhook.manage': {
        'adding a webhook': ['POST /api/v2/webhooks', { url: 'https://example.com/hook', events: [] }],
        'changing a webhook': ['PUT /api/v2/webhooks/:id', { active: true }, { id: TEMPLATE }],
    },
    'report.schedule': {
        'mailing a report on a schedule': ['POST /api/v1/reports/schedules', { reportId: TEMPLATE, recipients: ['someone@example.com'] }],
        'changing who a scheduled report goes to': ['PUT /api/v1/reports/schedules/:id', { recipients: ['someone@example.com'] }, { id: TEMPLATE }],
        'mailing a scheduled report now': ['POST /api/v1/reports/schedules/:id/run-now', {}, { id: TEMPLATE }],
        'mailing every scheduled report that is due': ['POST /api/v1/reports/schedules/run-due', {}],
    },
    'share.public': {
        'publishing a form': ['POST /api/v2/forms/:id/publish', { published: true }, { id: TEMPLATE }],
    },
    'form.manage': {
        'adding a form': ['POST /api/v2/forms', { projectId: P_OPEN, title: 'Requests' }],
        'changing a form': ['PUT /api/v2/forms/:id', { title: 'Renamed' }, { id: TEMPLATE }],
    },
    'email_in.manage': {
        'adding an address that files mail as tasks': ['POST /api/v1/email-in/inboxes', { projectId: P_OPEN, name: 'Requests' }],
        'changing an address that files mail as tasks': ['PUT /api/v1/email-in/inboxes/:id', { enabled: true }, { id: TEMPLATE }],
    },
    'calendar.feed': {
        'adding a calendar feed': ['POST /api/v1/calendar/feeds', { scope: 'mine' }],
        'replacing the link of a calendar feed': ['POST /api/v1/calendar/feeds/:id/regenerate', {}, { id: TEMPLATE }],
    },
    'export.workspace': {
        'exporting every project of the company': ['POST /api/v2/exports/workspace', {}],
    },
    'agent.session.endpoint': {
        'saving where an outside agent is reached': ['PUT /api/v2/agent-sessions/endpoints', { url: 'https://example.com/agent' }],
    },
    'agent.session.delegate': {
        'handing a task to an outside agent': ['POST /api/v2/agent-sessions', { taskId: T_OPEN }],
    },
    'recurring.manage': {
        'adding a repeat': ['POST /api/v1/recurring-tasks', { projectId: P_OPEN, name: 'Weekly' }],
        'making a task repeat': ['PUT /api/v1/recurring-tasks/task/:taskId', { every: 'week' }, { taskId: T_OPEN }],
        'changing a repeat': ['PATCH /api/v1/recurring-tasks/:id', { enabled: false }, { id: TEMPLATE }],
        'running a repeat now': ['POST /api/v1/recurring-tasks/:id/run-now', {}, { id: TEMPLATE }],
        'running every repeat that is due': ['POST /api/v1/recurring-tasks/run-due', {}],
    },
    'account.security': {
        'starting two-step sign-in': ['POST /api/v2/auth/2fa/setup', {}],
        'switching two-step sign-in on': ['POST /api/v2/auth/2fa/verify', { code: '000000' }],
        'switching two-step sign-in off': ['POST /api/v2/auth/2fa/disable', { code: '000000' }],
        'changing the password': ['PATCH /api/v2/auth/:id/change-password', { oldPassword: 'a', newPassword: 'b' }, { id: OWNER }],
    },
    'pto.request': {
        'filing time off': ['POST /api/v1/pto', { startDate: '2026-11-02', endDate: '2026-11-03' }],
    },
    'timelog.delete': {
        'removing logged time for good': ['POST /api/v2/deleteManualLogtime', { projectId: P_OPEN, taskId: T_OPEN }],
    },
    'file.delete': {
        'removing a stored file': ['POST /api/v1/wasabi/deleteFile', { companyId: CID, path: 'Project/x' }],
    },
    'dashboard.manage': {
        'changing the dashboard of the person': ['POST /api/v1/dashboard', { cards: [] }],
        'adding a dashboard': ['POST /api/v1/dashboards', { name: 'Ours', visibility: 'workspace' }],
        'changing a dashboard': ['PUT /api/v1/dashboards/:id', { name: 'Renamed', visibility: 'workspace' }, { id: TEMPLATE }],
        'changing the cards of a dashboard': ['PUT /api/v1/dashboards/:id/cards', { cards: [] }, { id: TEMPLATE }],
        'copying a dashboard': ['POST /api/v1/dashboards/:id/duplicate', {}, { id: TEMPLATE }],
    },
    'reminder.manage': {
        'raising a reminder for another member': ['POST /api/v1/general-reminders', { title: 'Call the client', remindAt: '2026-11-02T09:00:00.000Z', assignedTo: INSIDER }],
        'changing a reminder': ['PATCH /api/v1/general-reminders/:id', { title: 'Renamed' }, { id: TEMPLATE }],
        'sending a reminder now': ['POST /api/v1/general-reminders/:id/run-now', {}, { id: TEMPLATE }],
        'sending every reminder that is due': ['POST /api/v1/general-reminders/run-due', {}],
        'setting a reminder that names no task': ['POST /api/v1/reminders', { reminderText: 'Lunch', reminderAt: '2026-11-02T09:00:00.000Z' }],
        'changing a task reminder': ['PATCH /api/v1/reminders/:id', { reminderText: 'Renamed' }, { id: TEMPLATE }],
        'sending a task reminder now': ['POST /api/v1/reminders/:id/run-now', {}, { id: TEMPLATE }],
        'sending every task reminder that is due': ['POST /api/v1/reminders/run-due', {}],
    },
    'timesheet.submit': {
        'submitting the timesheet of the person': ['POST /api/v2/timesheet-approval/submit', { weekStart: '2026-09-28' }],
    },
};

/* Changes the web app has no route for. A Slack message is sent by an approved proposal alone, and the connector's
 * own settings take no token of any kind. */
const NO_WEB_ROUTE = ['deploy.staging', 'deploy.production', 'git.merge', 'slack.message.post'];

const rowsOf = (table) => Object.entries(table).flatMap(([action, changes]) => Object.entries(changes).map(([name, [route, body, params, recordedAs]]) => [name, route, body, params, recordedAs || action]));
const HELD_FOR_PEOPLE = [...rowsOf(PROPOSED_ON_THE_WEB), ...rowsOf(NEVER_ON_THE_WEB), ...rowsOf(SET_UP_BY_PEOPLE)];
const ALSO_HELD = rowsOf(ALSO_BY_PEOPLE);

/* What the project update takes from an agent: what the project is called and says, when it is due, where the work
 * came from, what is attached to it, and the person's own marks on it. */
const AGENTS_MAY_CHANGE = {
    ProjectName: 'Renamed', Description: 'Text', description: 'Text', descriptionBlock: { blocks: [] }, projectIcon: { type: 'color', data: 'blue' },
    DueDate: '2026-11-01T00:00:00.000Z', dueDateDeadLine: [], StartDate: '2026-10-01T00:00:00.000Z', EndDate: '2026-11-01T00:00:00.000Z',
    source: 'other', proposalId: '', skills: [], attachments: [], customField: {}, checklistArray: [],
    favouriteTasks: { userId: OWNER }, [`watchers.${OWNER}`]: true,
};
const fieldOf = (path) => path.split('.')[0];
const PROJECT_FIELDS = [...new Set([...Object.keys(schema.projects), ...Object.keys(FIELD_PERMISSIONS)])];
const proposeOnly = () => [...registry.ACTIONS, ...registryGroups.flatMap((group) => group.entries.map((entry) => entry.action))].filter((action) => action.proposeOnly).map((action) => action.key);
const withoutRoute = (table) => (key) => !Object.keys(table[key] || {}).length && !NO_WEB_ROUTE.includes(key);

describe('what an agent proposes, or never does, on the web app\'s own routes', () => {
    it('has a route here for every action an agent may only propose', () => {
        expect(proposeOnly()).toEqual(expect.arrayContaining(Object.keys(PROPOSED_ON_THE_WEB)));
        expect(proposeOnly().filter(withoutRoute(PROPOSED_ON_THE_WEB))).toEqual([]);
    });

    it('has a route here for every change on the never-list', () => {
        expect(registry.NEVER.filter(withoutRoute(NEVER_ON_THE_WEB))).toEqual([]);
    });

    it.each(HELD_FOR_PEOPLE.flatMap(([name, ...row]) => [['a token created for an agent', name, agentToken, ...row], ['an agent run', name, agentRun, ...row]]))('%s is refused %s, and recorded', async (label, name, as, route, body, params, recordedAs) => {
        const answer = await through(route, as(OWNER), body, params);

        expect(answer.code).toBe(403);
        expect(answer.body.statusText).toMatch(/^(An agent is not allowed to do this|An agent is never allowed to do this|That action is not available to agents|You cannot set a task to)/);
        expect(audits('agent.action_refused')).toHaveLength(1);
        expect(audits('agent.action_refused')[0].meta).toMatchObject({ ran: false, action: recordedAs, path: pathOf(route, params), onBehalfOf: OWNER });
        expect(audits('agent.action')).toHaveLength(0);
    });

    it.each(ALSO_HELD.flatMap(([name, ...row]) => [['a token created for an agent', name, agentToken, ...row], ['an agent run', name, agentRun, ...row]]))('%s is refused %s, and recorded', async (label, name, as, route, body, params, recordedAs) => {
        const answer = await through(route, as(OWNER), body, params);

        expect(answer.code).toBe(403);
        expect(answer.body.statusText).toMatch(/^(An agent is not allowed to do this|An agent is never allowed to do this|That action is not available to agents)/);
        expect(audits('agent.action_refused')).toHaveLength(1);
        expect(audits('agent.action_refused')[0].meta).toMatchObject({ ran: false, action: recordedAs, path: pathOf(route, params), onBehalfOf: OWNER });
        expect(audits('agent.action')).toHaveLength(0);
    });

    it.each([
        ['a signed-in owner', session(OWNER)],
        ['a signed-in member', session(INSIDER)],
        ['a signed-in guest', session(GUEST)],
        ['a personal token of an owner', personalToken(OWNER)],
        ['a personal token of a member', personalToken(INSIDER)],
    ])('%s is not stopped as an agent on any of those either', async (label, caller) => {
        for (const [, route, body, params] of ALSO_HELD) {
            const answer = await through(route, caller, body, params);
            expect([route, answer === REACHED ? '' : JSON.stringify(answer.body)]).toEqual([route, expect.not.stringMatching(/An agent is n(?:ot|ever) allowed|not available to agents/)]);
        }
        expect(agentAudits()).toHaveLength(0);
    });

    it('refuses them the same with the proposing tools switched on, and for the agent of an admin or a member', async () => {
        process.env.MCP_TOOLS_MANAGE = 'on';
        process.env.MCP_TOOLS_WORK = 'on';

        for (const [, route, body, params] of [...HELD_FOR_PEOPLE, ...ALSO_HELD]) {
            for (const uid of [OWNER, ADMIN, INSIDER]) {
                expect([route, (await through(route, agentToken(uid, { grants: ['tasks:manage'] }), body, params)).code]).toEqual([route, 403]);
            }
        }
    });

    it('has no route that deploys, merges or posts to Slack, and closes a path of such a name to an agent', async () => {
        expect(Object.keys(routes).filter((route) => /deploy|git\/merge|slack\/(message|post)/i.test(route))).toEqual([]);

        for (const url of ['/api/v2/deploy/staging', '/api/v2/deploy/production', '/api/v2/git/merge']) {
            const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json() { return this; } };
            let passed = false;
            await agentPerimeter({ ...agentToken(OWNER), method: 'POST', originalUrl: url, headers: { companyid: CID }, body: {} }, res, () => { passed = true; });

            expect([url, passed, res.statusCode]).toEqual([url, false, 403]);
        }
    });

    it.each([
        ['a signed-in owner', session(OWNER)],
        ['a signed-in admin', session(ADMIN)],
    ])('%s reaches every one of them, and nothing is recorded as an agent\'s', async (label, caller) => {
        const stopped = [];
        for (const [name, route, body, params] of HELD_FOR_PEOPLE) {
            const answer = await through(route, caller, body, params);
            if (answer !== REACHED) stopped.push([name, answer.code, JSON.stringify(answer.body).slice(0, 120)]);
        }
        expect(stopped).toEqual([]);
        expect(agentAudits()).toHaveLength(0);
    });

    it.each([
        ['a signed-in member', session(INSIDER)],
        ['a signed-in guest', session(GUEST)],
        ['a personal token of an owner', personalToken(OWNER)],
        ['a personal token of a member', personalToken(INSIDER)],
    ])('%s is not stopped as an agent on any of them', async (label, caller) => {
        for (const [, route, body, params] of HELD_FOR_PEOPLE) {
            const answer = await through(route, caller, body, params);
            expect([route, answer === REACHED ? '' : JSON.stringify(answer.body)]).toEqual([route, expect.not.stringMatching(/An agent is n(?:ot|ever) allowed|not available to agents/)]);
        }
        expect(agentAudits()).toHaveLength(0);
    });

    it.each(Object.entries(AGENTS_MAY_CHANGE))('%s of a project is still an agent\'s to change as its person may, and the change is recorded', async (path, value) => {
        expect(await through(UPDATE, agentToken(OWNER), { updateObject: { [path]: value } }, inProject)).toBe(REACHED);
        expect(agentAudits().map((row) => [row.action, row.meta.action])).toEqual([['agent.action', 'project.update']]);
    });

    it.each([
        ['adding an item', { operation: 'push', checklistItem: { id: 'item-1', name: 'Sign the contract', isChecked: false } }],
        ['renaming an item', { operation: 'update', key: 'name', checklistItem: { id: 'item-1', name: 'Sign it' } }],
        ['ticking an item', { operation: 'update', key: 'isChecked', checklistItem: [{ id: 'item-1', name: 'Sign it', isChecked: true }] }],
    ])('%s of the checklist of a project, on its own route, is still an agent\'s as its person may, and the change is recorded', async (label, body) => {
        expect(await through('POST /api/v1/project/checklist', agentToken(OWNER), { id: P_OPEN, ...body })).toBe(REACHED);
        expect(agentAudits().map((row) => [row.action, row.meta.action])).toEqual([['agent.action', 'project.update']]);
    });

    it('takes no other field of a project from an agent', async () => {
        const held = [];
        for (const field of PROJECT_FIELDS) {
            const answer = await through(UPDATE, agentToken(OWNER), { updateObject: { [field]: 1 } }, inProject);
            if (answer !== REACHED && /^(An agent is not allowed to do this|An agent is never allowed to do this|That action is not available to agents)| cannot be changed\.$/.test(answer.body.statusText)) held.push(field);
        }

        expect(PROJECT_FIELDS.filter((field) => !held.includes(field)).sort()).toEqual(Object.keys(AGENTS_MAY_CHANGE).map(fieldOf).sort());
    });

    it.each([
        ['what a sentence would make', 'POST /api/v2/automations/compile', { sentence: 'When a task is created, assign it' }, {}],
        ['what a rule would have done', 'POST /api/v2/automations/backtest', { rule }, {}],
        ['a dry run of a rule', 'POST /api/v2/automations/:id/dry-run', {}, { id: RULE }],
        ['the tasks a rule would match', 'POST /api/v1/automations/preview', rule, {}],
        ['the automations of a company', 'GET /api/v2/automations', {}, {}],
    ])('%s, which saves nothing, still goes through for an agent', async (label, route, body, params) => {
        expect(await through(route, agentToken(OWNER), body, params)).toBe(REACHED);
        expect(agentAudits()).toHaveLength(0);
    });
});

const SPACE = '6f0000000000000000000ca1';
const DM_SPACE = '6f0000000000000000000ca2';
const CHANNEL = '6f0000000000000000000cb1';
const DM = '6f0000000000000000000cd1';
const DM_MESSAGE = '6f0000000000000000000ce1';
const CHANNEL_MESSAGE = '6f0000000000000000000ce2';
const LIST_MESSAGE = '6f0000000000000000000ce3';
const TASK_MESSAGE = '6f0000000000000000000ce4';
const PAGE_OF_MESSAGES = 'GET /api/v1/comments/get-paginated-messages';
const FOUND_MESSAGES = 'GET /api/v1/comments/get-searched-messages';
const COMMENTS = 'POST /api/v1/comments';
const REACTIONS = 'POST /api/v2/reactions';
const inDm = { projectId: DM_SPACE, taskId: DM };
const inChannel = { projectId: SPACE, sprintId: CHANNEL, taskId: 'default' };
const inListChannel = { projectId: P_OPEN, sprintId: L_OPEN, taskId: 'default' };
const onTask = { projectId: P_OPEN, sprintId: L_OPEN, taskId: T_OPEN };

/* [route, body, query]: what reaches a direct message. */
const DIRECT_MESSAGES = {
    'reading a direct message': [PAGE_OF_MESSAGES, {}, { ...inDm, isDefault: 'true', mainChat: 'true' }],
    'reading a direct message as a plain thread': [PAGE_OF_MESSAGES, {}, inDm],
    'reading the direct message space': [PAGE_OF_MESSAGES, {}, { projectId: DM_SPACE, mainChat: 'true' }],
    'searching a direct message': [FOUND_MESSAGES, {}, { ...inDm, searchText: 'hello' }],
    'writing a direct message': [COMMENTS, { data: { ...inDm, message: 'Hello' } }],
    'writing a direct message, its ids sent to be converted': [COMMENTS, { data: { objId: inDm, message: 'Hello' } }],
    'replying inside a direct message, another thread named': [COMMENTS, { data: { ...onTask, parentId: DM_MESSAGE, message: 'Hello' } }],
    'editing a direct message': ['PUT /api/v1/comments', { id: DM_MESSAGE, data: { message: 'Edited' } }],
    'reading the replies to a direct message': ['GET /api/v1/comments/replies', {}, { parentId: DM_MESSAGE }],
    'reading what a direct message asks of people': ['GET /api/v1/comments/action-items', {}, inDm],
    'assigning a direct message': ['POST /api/v1/comments/assign', { id: DM_MESSAGE, assigneeId: INSIDER }],
    'resolving a direct message': ['POST /api/v1/comments/resolve', { id: DM_MESSAGE }],
    'reacting to a direct message': [REACTIONS, { targetType: 'comment', targetId: DM_MESSAGE, emoji: '+1' }],
    'reacting to the conversation itself': [REACTIONS, { targetType: 'task', targetId: DM, emoji: '+1' }],
    'listing the direct messages of the person': ['POST /api/v1/main-chats/find', { findQuery: [{}] }],
};

/* The same for a channel. */
const CHANNEL_MESSAGES = {
    'reading a channel': [PAGE_OF_MESSAGES, {}, { projectId: SPACE, sprintId: CHANNEL, mainChat: 'true' }],
    'reading the channel of a list': [PAGE_OF_MESSAGES, {}, { ...inListChannel, mainChat: 'true' }],
    'reading the channels of every list of a project, a task named': [PAGE_OF_MESSAGES, {}, { projectId: P_OPEN, taskId: T_OPEN, mainChat: 'true' }],
    'searching a channel': [FOUND_MESSAGES, {}, { projectId: SPACE, sprintId: CHANNEL, searchText: 'hello' }],
    'writing in a channel': [COMMENTS, { data: { ...inChannel, message: 'Hello' } }],
    'writing in the channel of a list': [COMMENTS, { data: { ...inListChannel, message: 'Hello' } }],
    'replying in a channel, another thread named': [COMMENTS, { data: { ...onTask, parentId: CHANNEL_MESSAGE, message: 'Hello' } }],
    'editing a channel message': ['PUT /api/v1/comments', { id: CHANNEL_MESSAGE, data: { message: 'Edited' } }],
    'editing a message in the channel of a list': ['PUT /api/v1/comments', { id: LIST_MESSAGE, data: { message: 'Edited' } }],
    'reading the replies to a channel message': ['GET /api/v1/comments/replies', {}, { parentId: CHANNEL_MESSAGE }],
    'reacting to a channel message': [REACTIONS, { targetType: 'comment', targetId: CHANNEL_MESSAGE, emoji: '+1' }],
    'listing the chat spaces': ['GET /api/v1/main-chats', {}],
};

/* The comments of a task and of a project, which are not chat. */
const TASK_THREADS = {
    'reading the comments of a task': [PAGE_OF_MESSAGES, {}, onTask],
    'reading the comments of a project': [PAGE_OF_MESSAGES, {}, { projectId: P_OPEN }],
    'searching the comments of a task': [FOUND_MESSAGES, {}, { ...onTask, searchText: 'hello' }],
    'commenting on a task': [COMMENTS, { data: { ...onTask, message: 'Hello' } }],
    'commenting on a project': [COMMENTS, { data: { projectId: P_OPEN, project: true, message: 'Hello' } }],
    'replying to a comment on a task': [COMMENTS, { data: { parentId: TASK_MESSAGE, message: 'Hello' } }],
    'editing a comment on a task': ['PUT /api/v1/comments', { id: TASK_MESSAGE, data: { message: 'Edited' } }],
    'reading the replies to a comment on a task': ['GET /api/v1/comments/replies', {}, { parentId: TASK_MESSAGE }],
    'reading what the comments of a task ask of people': ['GET /api/v1/comments/action-items', {}, onTask],
    'assigning a comment on a task': ['POST /api/v1/comments/assign', { id: TASK_MESSAGE, assigneeId: INSIDER }],
    'resolving a comment on a task': ['POST /api/v1/comments/resolve', { id: TASK_MESSAGE }],
    'reading the comments assigned to the person': ['GET /api/v1/comments/assigned-to-me', {}],
    'reacting to a comment on a task': [REACTIONS, { targetType: 'comment', targetId: TASK_MESSAGE, emoji: '+1' }],
    'reacting to a task': [REACTIONS, { targetType: 'task', targetId: T_OPEN, emoji: '+1' }],
};

const POSTS_IN_A_CHANNEL = ['writing in a channel', 'writing in the channel of a list', 'replying in a channel, another thread named'];
const CHAT = 'chat:read';
const withChat = (uid) => agentToken(uid, { grants: [CHAT] });
const on = (table) => Object.entries(table).map(([name, [route, body, query]]) => [name, route, body, query]);
const chatRoute = (route, caller, body, query) => through(route, caller, body, {}, query);
const seedChat = () => {
    mockDb.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: SPACE, ProjectName: 'Team', default: false });
    mockDb.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: DM_SPACE, ProjectName: 'Direct messages', default: true });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: CHANNEL, name: 'general', projectId: SPACE, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: DM, TaskName: 'Olive and Ian', ProjectID: DM_SPACE, mainChat: true, AssigneeUserId: [OWNER, INSIDER], deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.COMMENTS, { _id: DM_MESSAGE, ...inDm, userId: INSIDER, message: 'Hello' });
    mockDb.seed(SCHEMA_TYPE.COMMENTS, { _id: CHANNEL_MESSAGE, ...inChannel, userId: INSIDER, message: 'Hello' });
    mockDb.seed(SCHEMA_TYPE.COMMENTS, { _id: LIST_MESSAGE, ...inListChannel, userId: INSIDER, message: 'Hello' });
    mockDb.seed(SCHEMA_TYPE.COMMENTS, { _id: TASK_MESSAGE, ...onTask, userId: INSIDER, message: 'Hello' });
};

describe('chat on the web app\'s own routes', () => {
    beforeEach(seedChat);
    afterEach(() => { delete process.env.MCP_TOOLS_DATA; });

    it.each(on(DIRECT_MESSAGES))('%s is refused for an agent, whatever its token was given, and recorded', async (name, route, body, query) => {
        process.env.MCP_TOOLS_DATA = 'on';

        for (const caller of [agentToken(OWNER), agentToken(INSIDER), withChat(OWNER), withChat(INSIDER), agentRun(OWNER)]) {
            const answer = await chatRoute(route, caller, body, query);
            expect([answer.code, answer.body && answer.body.statusText]).toEqual([403, 'An agent is not allowed to do this (chat.direct). The person has to do it in AlianHub.']);
        }
        expect(audits('agent.action_refused').map((row) => row.meta.action)).toEqual(Array(5).fill('chat.direct'));
        expect(audits('agent.action')).toHaveLength(0);
    });

    it.each(on(CHANNEL_MESSAGES))('%s is refused for an agent whose token was not given chat, and recorded', async (name, route, body, query) => {
        process.env.MCP_TOOLS_DATA = 'on';

        for (const caller of [agentToken(OWNER), agentToken(INSIDER), agentToken(OWNER, { grants: ['tasks:manage'] }), agentRun(OWNER)]) {
            const answer = await chatRoute(route, caller, body, query);
            expect([answer.code, answer.body && answer.body.statusText]).toEqual([403, 'An agent is not allowed to do this (chat.channel). The person has to do it in AlianHub.']);
        }
        expect(audits('agent.action_refused').map((row) => row.meta.action)).toEqual(Array(4).fill('chat.channel'));
    });

    it.each(on(CHANNEL_MESSAGES).filter(([name]) => !POSTS_IN_A_CHANNEL.includes(name)))('%s goes on to the rule of the person for an agent whose token was given chat', async (name, route, body, query) => {
        process.env.MCP_TOOLS_DATA = 'on';

        expect(await chatRoute(route, withChat(OWNER), body, query)).toBe(REACHED);
        expect(await chatRoute(route, withChat(INSIDER), body, query)).toBe(REACHED);
        expect(audits('agent.action_refused')).toHaveLength(0);
    });

    it.each(on(CHANNEL_MESSAGES).filter(([name]) => POSTS_IN_A_CHANNEL.includes(name)))('%s waits for a person, as every change of a connected agent that cannot be undone does', async (name, route, body, query) => {
        process.env.MCP_TOOLS_DATA = 'on';

        for (const caller of [withChat(OWNER), withChat(INSIDER)]) {
            const answer = await chatRoute(route, caller, body, query);
            expect([answer.code, answer.body && answer.body.statusText]).toEqual([403, expect.stringContaining(projectPolicy.REASON.NOT_UNDOABLE)]);
        }
        expect(audits('agent.action_refused').map((row) => row.meta.action)).toEqual(['chat.post', 'chat.post']);
        expect(audits('agent.action')).toHaveLength(0);
    });

    it.each(on(CHANNEL_MESSAGES))('%s is refused for that token too while the read tools are off', async (name, route, body, query) => {
        expect((await chatRoute(route, withChat(OWNER), body, query)).code).toBe(403);
    });

    it('a direct message is not an agent\'s to start through the task route either', async () => {
        const body = { data: { TaskName: 'Olive and Mia', ProjectID: DM_SPACE, mainChat: true, AssigneeUserId: [OWNER, OUTSIDER] }, projectData: { _id: DM_SPACE, CompanyId: CID }, user: {} };

        for (const caller of [agentToken(OWNER), withChat(OWNER), agentToken(INSIDER)]) {
            expect((await chatRoute(CREATE, caller, body)).code).toBe(403);
        }
    });

    it.each(on(TASK_THREADS))('%s stays an agent\'s as its person may', async (name, route, body, query) => {
        expect(await chatRoute(route, agentToken(OWNER), body, query)).toBe(REACHED);
        expect(await chatRoute(route, agentToken(INSIDER), body, query)).toBe(REACHED);
        expect(audits('agent.action_refused')).toHaveLength(0);
    });

    it.each([
        ['a signed-in owner', session(OWNER)],
        ['a signed-in member', session(INSIDER)],
        ['a signed-in guest', session(GUEST)],
        ['a personal token of an owner', personalToken(OWNER)],
        ['a personal token of a member', personalToken(INSIDER)],
    ])('%s reaches every one of them, and nothing is recorded as an agent\'s', async (label, caller) => {
        for (const [, route, body, query] of [...on(DIRECT_MESSAGES), ...on(CHANNEL_MESSAGES), ...on(TASK_THREADS)]) {
            expect([route, await chatRoute(route, caller, body, query)]).toEqual([route, REACHED]);
        }
        expect(agentAudits()).toHaveLength(0);
    });
});

describe('the chat rule where a thread is judged, for what an agent\'s request reaches by another road', () => {
    beforeEach(seedChat);
    afterEach(() => { delete process.env.MCP_TOOLS_DATA; });

    const dm = () => rows(SCHEMA_TYPE.TASKS).find((row) => String(row._id) === DM);
    const allowed = async (uid, thread) => (await commentThreadAccess(CID, uid, thread)).allowed;
    const asAgentOf = (uid, chat, fn) => runForAgentOf(uid, { chat }, fn);

    it('leaves a person every thread they have', async () => {
        expect(await allowed(OWNER, inDm)).toBe(true);
        expect(await allowed(OWNER, inChannel)).toBe(true);
        expect(await allowed(OWNER, onTask)).toBe(true);
        expect(await canReadTask(CID, OWNER, dm())).toBe(true);
    });

    it.each([['without chat', false], ['with chat', true]])('keeps an agent\'s request %s from a direct message', async (label, chat) => {
        expect(await asAgentOf(OWNER, chat, () => allowed(OWNER, inDm))).toBe(false);
        expect(await asAgentOf(OWNER, chat, () => canReadTask(CID, OWNER, dm()))).toBe(false);
        expect(asAgentOf(OWNER, chat, () => readsCompanyWide(dm(), OWNER, []))).toBe(false);
        expect(asAgentOf(OWNER, chat, () => companyWideMatch(OWNER, []))).toEqual({ $nor: [{ mainChat: true }] });
        expect(companyWideMatch(OWNER, [])).toEqual({ $nor: [{ mainChat: true, AssigneeUserId: { $ne: OWNER } }] });
    });

    it('keeps an agent\'s request from a channel unless its token was given chat', async () => {
        expect(await asAgentOf(OWNER, false, () => allowed(OWNER, inChannel))).toBe(false);
        expect(await asAgentOf(OWNER, false, () => allowed(OWNER, inListChannel))).toBe(false);
        expect(await asAgentOf(OWNER, true, () => allowed(OWNER, inChannel))).toBe(true);
        expect(await asAgentOf(OWNER, true, () => allowed(OWNER, inListChannel))).toBe(true);
    });

    it('leaves the agent a task\'s own thread, and leaves anyone else in that request their own rule', async () => {
        expect(await asAgentOf(OWNER, false, () => allowed(OWNER, onTask))).toBe(true);
        expect(await asAgentOf(OWNER, false, () => allowed(INSIDER, inDm))).toBe(true);
        expect(await asAgentOf(OWNER, false, () => allowed(INSIDER, inChannel))).toBe(true);
    });

    it.each([
        ['a token created for an agent', agentToken(OWNER), 'off', { uid: OWNER, chat: false }],
        ['a token given chat', withChat(OWNER), 'on', { uid: OWNER, chat: true }],
        ['a token given chat while the read tools are off', withChat(OWNER), 'off', { uid: OWNER, chat: false }],
        ['an agent run', agentRun(OWNER), 'on', { uid: OWNER, chat: false }],
        ['a personal token', personalToken(OWNER), 'on', null],
        ['a signed-in person', session(OWNER), 'on', null],
    ])('runs the request of %s inside its mark', async (label, caller, flag, mark) => {
        process.env.MCP_TOOLS_DATA = flag;
        let seen;
        const res = { statusCode: 200, status() { return this; }, json() { return this; } };

        await agentPerimeter({ ...caller, method: 'GET', originalUrl: '/api/v1/task/find', headers: { companyid: CID }, body: {} }, res, () => { seen = agentOf(OWNER); });

        expect(seen).toEqual(mark);
        expect(agentOf(OWNER)).toBeNull();
    });
});

const EPIC = '6f0000000000000000000e21';
const TIMER = '6f0000000000000000000e22';
const VOTES = '6f0000000000000000000e23';
const onBoard = { projectId: P_OPEN, sprintId: L_OPEN };
const dropped = { taskId: T_OPEN, projectId: P_OPEN, sprintId: L_OPEN, isFirst: true, isFirstWithRecord: false, relevantIndex: 1, indexName: 'groupByStatusIndex', relevantKey: 1, searchKey: 'statusKey', taskKey: 'OPN-1', updateData: {} };

/* [route, body, params, the action the project's rule for agents is asked of]: every write the web app's routes leave
 * to an agent as its person may. */
const ASKED_THE_PROJECT = {
    'filing a task': [CREATE, newTask({}), {}, 'task.create'],
    'drafting a doc': ['POST /api/v2/pages', { title: 'Notes', projectId: P_OPEN }, {}, 'page.draft'],
    'commenting on a task': [COMMENTS, { data: { ...onTask, message: 'Hello' } }, {}, 'task.comment'],
    'commenting on a project': [COMMENTS, { data: { projectId: P_OPEN, project: true, message: 'Hello' } }, {}, 'project.comment'],
    'editing a comment on a task': ['PUT /api/v1/comments', { id: TASK_MESSAGE, data: { message: 'Edited' } }, {}, 'comment.update'],
    'assigning a comment on a task': ['POST /api/v1/comments/assign', { id: TASK_MESSAGE, assigneeId: INSIDER }, {}, 'comment.assign'],
    'resolving a comment on a task': ['POST /api/v1/comments/resolve', { id: TASK_MESSAGE }, {}, 'comment.resolve'],
    'reacting to a comment on a task': [REACTIONS, { targetType: 'comment', targetId: TASK_MESSAGE, emoji: '+1' }, {}, 'reaction.set'],
    'reacting to a task': [REACTIONS, { targetType: 'task', targetId: T_OPEN, emoji: '+1' }, {}, 'reaction.set'],
    'logging time on a task': ['POST /api/v2/manualLogtime', { ticketId: T_OPEN, projectId: P_OPEN, isEdit: false }, {}, 'timelog.create'],
    'changing the time logged on a task': ['POST /api/v2/manualLogtime', { ticketId: T_OPEN, projectId: P_OPEN, isEdit: true, timeSheetId: TIMER }, {}, 'timelog.edit'],
    'starting a timer': ['POST /api/v2/timeTracker/start', { taskId: T_OPEN, projectId: P_OPEN }, {}, 'timelog.start'],
    'starting a timer, the later way': ['POST /api/v3/timeTracker/start', { taskId: T_OPEN, projectId: P_OPEN }, {}, 'timelog.start'],
    'stopping a timer': ['POST /api/v2/timetracker/end', { timeSheetId: TIMER }, {}, 'timelog.stop'],
    'taking idle time off a running timer': ['POST /api/v2/timetracker/trim', { timeSheetId: TIMER, minutes: 5 }, {}, 'timelog.edit'],
    'planning time on a task': ['PUT /api/v1/estimatedTime', { userId: OWNER, taskId: T_OPEN, projectId: P_OPEN, date: '2026-10-05', minutes: 60 }, {}, 'time.plan'],
    'adding an epic': ['POST /api/v2/epics', { projectId: P_OPEN, name: 'Launch' }, {}, 'epic.create'],
    'changing an epic': ['PUT /api/v2/epics/:id', { name: 'Renamed' }, { id: EPIC }, 'epic.update'],
    'putting a task in an epic': ['POST /api/v2/epics/assign', { taskId: T_OPEN, epicId: EPIC }, {}, 'epic.assign'],
    'renaming a project': [UPDATE, { updateObject: { ProjectName: 'Renamed' } }, inProject, 'project.update'],
    'adding an item to the checklist of a project': ['POST /api/v1/project/checklist', { id: P_OPEN, operation: 'push', checklistItem: { id: 'item-1', name: 'Sign the contract', isChecked: false } }, {}, 'project.update'],
    'drawing on the whiteboard of a list': ['PATCH /api/v2/whiteboards/:projectId/:sprintId', { revision: 0, upsert: [] }, onBoard, 'whiteboard.update'],
    'putting back an earlier whiteboard': ['POST /api/v2/whiteboards/:projectId/:sprintId/restore', { revision: 1 }, onBoard, 'whiteboard.update'],
    'voting on a task': ['POST /api/v2/custom-fields/:fieldId/vote', { taskId: T_OPEN, vote: true }, { fieldId: VOTES }, 'task.field.set'],
    'moving a task up or down its column': ['POST /api/v1/taskIndex', dropped, {}, 'task.reorder'],
    'giving a task its place in a column the first time the column is shown': ['POST /api/v1/updateTaskIndexOnload', { taskUpdate: { data: T_OPEN, item: { indexName: 'groupByStatusIndex', searchKey: 'statusKey', searchValue: 1 } } }, {}, 'task.reorder'],
    'counting the tasks of an epic again': ['POST /api/v2/epics/:id/recount', {}, { id: EPIC }, 'epic.update'],
    'working out the computed fields of a task': ['POST /api/v2/custom-fields/compute', { taskIds: [T_OPEN] }, {}, 'task.fields.compute'],
    'starring a list': ['PUT /api/v1/project/sprint/:id', { key: '$addToSet', updateObject: { favouriteTasks: { userId: OWNER } } }, { id: L_OPEN }, 'sprint.favourite'],
};

const asked = Object.entries(ASKED_THE_PROJECT).map(([name, [route, body, params, action]]) => [name, route, body, params, action]);
const projectRow = (id) => rows(SCHEMA_TYPE.PROJECTS).find((row) => String(row._id) === String(id));
const seedWork = () => {
    seedChat();
    mockDb.seed(SCHEMA_TYPE.EPICS, { _id: EPIC, name: 'Launch', ProjectID: P_OPEN, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.TIMESHEET, { _id: TIMER, TicketID: T_OPEN, ProjectId: P_OPEN, Loggeduser: OWNER, startTimeTracker: 1 });
};

describe('what a route leaves to an agent as its person may, in a project with a rule for agents', () => {
    beforeEach(seedWork);

    it.each(asked)('%s goes through for an agent, and is recorded under the name of the change', async (name, route, body, params, action) => {
        expect(await through(route, agentToken(OWNER), body, params)).toBe(REACHED);

        expect(audits('agent.action_refused')).toHaveLength(0);
        expect(audits('agent.action')).toHaveLength(1);
        expect(audits('agent.action')[0].meta).toMatchObject({ action, state: 'applied', reason: 'via REST', onBehalfOf: OWNER });
    });

    it.each(asked)('%s is refused for every agent while agents are paused in the project, and recorded', async (name, route, body, params, action) => {
        projectRow(P_OPEN).agentLimits = { paused: true };

        for (const caller of [agentToken(OWNER), agentRun(OWNER)]) {
            const answer = await through(route, caller, body, params);
            expect([answer.code, answer.body && answer.body.statusText]).toEqual([403, projectLimits.REASON.PAUSED]);
        }
        expect(audits('agent.action_refused').map((row) => row.meta.action)).toEqual([action, action]);
        expect(audits('agent.action')).toHaveLength(0);
    });

    it.each(asked)('%s waits for a person where the project has connected agents propose every change', async (name, route, body, params, action) => {
        projectRow(P_OPEN).agentPolicy = { connected: projectPolicy.CONNECTED.PROPOSE_ALL };

        const answer = await through(route, agentToken(OWNER), body, params);

        expect([answer.code, answer.body && answer.body.statusText]).toEqual([403, expect.stringContaining(projectPolicy.REASON.PROPOSE_ALL)]);
        expect(audits('agent.action_refused').map((row) => row.meta.action)).toEqual([action]);
        expect(await through(route, agentRun(OWNER), body, params)).toBe(REACHED);
    });

    it('counts the tasks a connected agent changes through them, and holds a change to one task more', async () => {
        projectRow(P_OPEN).agentLimits = { directTasks: 1 };
        const comment = (taskId) => through(COMMENTS, agentToken(OWNER), { data: { ...onTask, taskId, message: 'Hello' } });

        expect(await comment(T_OPEN)).toBe(REACHED);
        expect(await comment(T_OPEN_2)).toMatchObject({ code: 403, body: { statusText: expect.stringContaining('already changed 1 task') } });
        expect(await comment(T_OPEN)).toBe(REACHED);
        expect(await through(REACTIONS, agentToken(OWNER), { targetType: 'task', targetId: T_OPEN_2, emoji: '+1' })).toMatchObject({ code: 403 });
    });

    it.each([
        ['a signed-in owner', session(OWNER)],
        ['a personal token of an owner', personalToken(OWNER)],
    ])('%s reaches every one of them whatever the project holds agents to, and nothing is recorded as an agent\'s', async (label, caller) => {
        projectRow(P_OPEN).agentLimits = { paused: true, directTasks: 1 };
        projectRow(P_OPEN).agentPolicy = { connected: projectPolicy.CONNECTED.PROPOSE_ALL };

        for (const [, route, body, params] of asked) {
            expect([route, await through(route, caller, body, params)]).toEqual([route, REACHED]);
        }
        expect(agentAudits()).toHaveLength(0);
    });
});

describe('every write route of the server, for a token created for an agent', () => {
    const WRITES = Object.keys(routes).filter((route) => !route.startsWith('GET ')).sort();
    const namedIn = (route) => [...route.matchAll(/:([A-Za-z_]+)/g)].map((match) => match[1]);
    const paramsOf = (route) => Object.fromEntries(namedIn(route).map((name) => [name, { projectId: P_OPEN, pid: P_OPEN, taskId: T_OPEN, tid: T_OPEN, sprintId: L_OPEN }[name] || TEMPLATE]));
    const askedRoutes = [...new Set(asked.map(([, route]) => route))];
    const outside = Object.values(OUTSIDE_EVERY_PROJECT).flat();
    const heldForPeople = (answer) => answer !== REACHED && answer.code === 403 && /^(An agent is not allowed to do this|An agent is never allowed to do this|That action is not available to agents)/.test(String(answer.body && answer.body.statusText));

    it('is held for people, asks the project\'s rule, or is listed with why it changes nothing in a project', async () => {
        const unlisted = [];
        const listedThoughHeld = [];
        for (const route of WRITES) {
            seed();
            const held = heldForPeople(await through(route, agentToken(OWNER), {}, paramsOf(route)));
            if (!held && !askedRoutes.includes(route) && !outside.includes(route)) unlisted.push(route);
            if (held && outside.includes(route)) listedThoughHeld.push(route);
        }

        expect(WRITES.length).toBeGreaterThan(500);
        if (process.env.UNLISTED_OUT) fs.writeFileSync(process.env.UNLISTED_OUT, unlisted.join('\n'));
        expect(unlisted).toEqual([]);
        expect(listedThoughHeld).toEqual([]);
    });

    it('lists no route twice, and none the server does not have', () => {
        expect([...askedRoutes, ...outside].filter((route) => !routes[route])).toEqual([]);
        expect(outside.filter((route, at) => outside.indexOf(route) !== at || askedRoutes.includes(route))).toEqual([]);
    });
});

describe('what stands in front of a route, in its order', () => {
    const refusalAt = (route) => routes[route].slice(0, -1).findIndex((guard) => guard.refusesAs);

    it('has the refusal of an agent first wherever a route refuses agents', () => {
        expect(Object.keys(routes).filter((route) => refusalAt(route) > 0)).toEqual([]);
        expect(Object.keys(routes).filter((route) => refusalAt(route) === 0).length).toBeGreaterThan(200);
    });

    it.each([
        ['importing rows as tasks', 'task_create'],
        ['creating the tasks an answer of the AI lists', 'task_create'],
    ])('%s is refused as an agent\'s, and recorded, for an agent whose person does not hold the right either', async (name, right) => {
        const [route, body, params] = NO_ACTION[name] || ALSO_BY_PEOPLE['tasks.import'][name];
        rows(SCHEMA_TYPE.RULES).filter((rule) => rule.key === right).forEach((rule) => { rule.roles = []; });

        const answer = await through(route, agentToken(INSIDER), body, params);

        expect([answer.code, answer.body.statusText]).toEqual([403, 'That action is not available to agents (tasks.import).']);
        expect(audits('agent.action_refused').map((row) => row.meta.action)).toEqual(['tasks.import']);
    });
});

describe('a removal, which no agent makes on any route', () => {
    const REMOVALS = Object.keys(routes).filter((route) => route.startsWith('DELETE ')).sort();
    const namedByTheRoute = (route) => (routes[route].find((guard) => guard.refusesAs) || {}).refusesAs;
    const ids = (route) => Object.fromEntries([...route.matchAll(/:([A-Za-z_]+)/g)].map((match) => [match[1], TEMPLATE]));

    it('is refused on every route that removes something', async () => {
        expect(REMOVALS.length).toBeGreaterThan(50);
        for (const route of REMOVALS) {
            for (const caller of [agentToken(OWNER), agentRun(OWNER)]) {
                expect([route, (await through(route, caller, {}, ids(route))).code]).toEqual([route, 403]);
            }
        }
    });

    it.each(REMOVALS.filter(namedByTheRoute))('%s is recorded under the name its own route gives it', async (route) => {
        const answer = await through(route, agentToken(OWNER), {}, ids(route));

        expect(answer.body.statusText).toBe(`An agent is not allowed to do this (${namedByTheRoute(route)}). The person has to do it in AlianHub.`);
        expect(audits('agent.action_refused').map((row) => row.meta.action)).toEqual([namedByTheRoute(route)]);
    });

    it.each([
        ['DELETE /api/v2/epics/:id', 'project.delete'],
        ['DELETE /api/v1/recurring-tasks/:id', 'task.delete'],
    ])('%s, whose route names none, is recorded as %s', async (route, action) => {
        await through(route, agentToken(OWNER), {}, ids(route));

        expect(REMOVALS.filter(namedByTheRoute).length).toBeGreaterThan(8);
        expect(audits('agent.action_refused').map((row) => row.meta.action)).toEqual([action]);
    });

    it('is refused below a router mounted on the app too', async () => {
        const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json() { return this; } };
        let passed = false;

        await agentPerimeter({ ...agentToken(OWNER), app: served, method: 'DELETE', originalUrl: `/scim/v2/Users/${TEMPLATE}`, headers: { companyid: CID }, body: {} }, res, () => { passed = true; });

        expect([passed, res.statusCode]).toEqual([false, 403]);
    });
});
