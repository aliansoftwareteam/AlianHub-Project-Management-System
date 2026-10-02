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

const { EventEmitter } = require('events');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/accessWorld');

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, L_OPEN, L_PRIVATE, T_OPEN, T_PRIVATE, settle } = world;
const { seed, rows } = world.create(mockDb);

const T_OPEN_2 = '6f0000000000000000000d09';
const P_NOWHERE = '6f0000000000000000000aff';
const PAGE = '6f0000000000000000000e01';
const COMMENT = '6f0000000000000000000e02';
const FOLDER = '6f0000000000000000000c01';
const REACHED = 'reached its handler';

const routes = {};
const register = (method) => (routePath, ...handlers) => { routes[`${method} ${routePath}`] = handlers; };
const app = { get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') };
['Tasks', 'Sprints', 'Pages', 'Importers', 'createProject'].forEach((name) => require(`../Modules/${name}/routes`).init(app));

const session = (uid) => ({ uid });
const agentToken = (uid, extra = {}) => ({ uid, apiToken: { _id: '6f0000000000000000000101', kind: 'agent', name: 'Claude', userId: uid, scopes: ['read', 'write'], ...extra } });
const personalToken = (uid) => ({ uid, apiToken: { _id: '6f0000000000000000000102', name: 'A script', userId: uid, scopes: ['read', 'write'] } });

/* Runs every guard of the route and stops in front of its handler. */
const through = (route, caller, body = {}, params = {}) => new Promise((resolve) => {
    const [method, url] = route.split(' ');
    const res = new EventEmitter();
    res.statusCode = 200;
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (answer) => { res.emit('finish'); resolve({ code: res.statusCode, body: answer }); return res; };
    res.json = res.send;
    const req = { ...caller, method, originalUrl: url, url, baseUrl: '', route: { path: url }, query: {}, params, headers: { companyid: CID }, aud: CID, ip: '1.1.1.1', body };
    const guards = routes[route].slice(0, -1);
    const step = (at) => (at === guards.length ? (res.emit('finish'), resolve(REACHED)) : Promise.resolve(guards[at](req, res, () => step(at + 1))));
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
        expect(answer.body.statusText).toMatch(/^Agents cannot perform /);
        expect(audits('agent.action_refused')).toHaveLength(1);
        expect(audits('agent.action_refused')[0].meta).toMatchObject({ ran: false, path: route, onBehalfOf: uid });
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
        ['reading a backlog', 'POST /api/v2/sprints/backlog', { projectId: P_OPEN }],
        ['previewing a CSV import', 'POST /api/v2/imports/csv/preview', {}],
    ])('%s, a read, still goes through and leaves no record', async (label, route, body) => {
        expect(await through(route, agentToken(OWNER), body)).toBe(REACHED);
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
        expect(answer.body.statusText).toMatch(/^Agents cannot perform task\.add/);
        expect(audits('agent.action_refused')).toHaveLength(1);
        expect(audits('agent.action_refused')[0].meta).toMatchObject({ ran: false, path: CREATE, onBehalfOf: uid });
    });

    it.each([
        ['a member outside it', OUTSIDER],
        ['a guest', GUEST],
    ])('into a project %s cannot open is answered as one into a project that does not exist', async (label, uid) => {
        const withoutAuditId = (answer) => (answer === REACHED ? answer : { code: answer.code, body: { ...answer.body, auditId: undefined } });
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
            if (answer !== REACHED) expect(JSON.stringify(answer.body)).not.toMatch(/Agents cannot/);
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
