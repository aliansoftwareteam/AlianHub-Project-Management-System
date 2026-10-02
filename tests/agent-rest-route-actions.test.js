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
const registry = require('../Modules/Agents/registry');
const registryGroups = require('../Modules/Agents/registryGroups');
const { agentPerimeter } = require('../Modules/Agents/guard');

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, L_OPEN, L_PRIVATE, T_OPEN, T_PRIVATE, settle } = world;
const { seed, rows } = world.create(mockDb);

const T_OPEN_2 = '6f0000000000000000000d09';
const P_NOWHERE = '6f0000000000000000000aff';
const PAGE = '6f0000000000000000000e01';
const COMMENT = '6f0000000000000000000e02';
const FOLDER = '6f0000000000000000000c01';
const CONNECTION = '6f0000000000000000000c02';
const REACHED = 'reached its handler';

const routes = {};
const register = (method) => (routePath, ...handlers) => { routes[`${method} ${routePath}`] = handlers; };
const app = { get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') };
[
    'Tasks', 'Sprints', 'Pages', 'Importers', 'createProject', 'CustomField', 'Project', 'projectSetting', 'settings/templates', 'settings/ProjectStatusTemplate',
    'ProjectDuplicate', 'ProjectSnapshots', 'AIProjectGenerator', 'Automations', 'projectRules', 'ImportSettings', 'PublicShares', 'trackerUserPermission',
    'settings/Members', 'settings/Roles', 'settings/securityPermissions', 'Milestone', 'Auth', 'Integrations',
].forEach((name) => require(`../Modules/${name}/routes`).init(app));

const session = (uid) => ({ uid });
const agentToken = (uid, extra = {}) => ({ uid, apiToken: { _id: '6f0000000000000000000101', kind: 'agent', name: 'Claude', userId: uid, scopes: ['read', 'write'], ...extra } });
const personalToken = (uid) => ({ uid, apiToken: { _id: '6f0000000000000000000102', name: 'A script', userId: uid, scopes: ['read', 'write'] } });
const agentRun = (uid) => ({ uid, agentRun: { _id: '6f0000000000000000000103', agentId: '6f0000000000000000000104', agentName: 'Triage' } });

const pathOf = (route, params = {}) => Object.entries(params).reduce((text, [name, value]) => text.replace(`:${name}`, value), route);

/* Runs what stands in front of every route, then every guard of the route, and stops in front of its handler. */
const through = (route, caller, body = {}, params = {}) => new Promise((resolve) => {
    const [method, url] = pathOf(route, params).split(' ');
    const res = new EventEmitter();
    res.statusCode = 200;
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (answer) => { res.emit('finish'); resolve({ code: res.statusCode, body: answer }); return res; };
    res.json = res.send;
    const req = { ...caller, method, originalUrl: url, url, baseUrl: '', route: { path: route.split(' ')[1] }, query: {}, params, headers: { companyid: CID }, aud: CID, ip: '1.1.1.1', body };
    const guards = [agentPerimeter, ...routes[route].slice(0, -1)];
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
        expect(answer.body.statusText).toMatch(/^Agents cannot perform /);
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
    },
    'automation.create': {
        'adding an automation': ['POST /api/v2/automations', rule],
        'changing an automation': ['PUT /api/v2/automations/:id', rule, { id: RULE }, 'automation.update'],
        'switching an automation on or off': ['PATCH /api/v2/automations/:id/enabled', { enabled: true }, { id: RULE }, 'automation.enable'],
        'removing an automation': ['DELETE /api/v2/automations/:id', {}, { id: RULE }, 'project.delete'],
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

/* Changes the web app has no route for. A Slack message is sent by an approved proposal alone, and the connector's
 * own settings take no token of any kind. */
const NO_WEB_ROUTE = ['deploy.staging', 'deploy.production', 'git.merge', 'slack.message.post'];

const rowsOf = (table) => Object.entries(table).flatMap(([action, changes]) => Object.entries(changes).map(([name, [route, body, params, recordedAs]]) => [name, route, body, params, recordedAs || action]));
const HELD_FOR_PEOPLE = [...rowsOf(PROPOSED_ON_THE_WEB), ...rowsOf(NEVER_ON_THE_WEB)];
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
        expect(answer.body.statusText).toMatch(/^Agents cannot perform /);
        expect(audits('agent.action_refused')).toHaveLength(1);
        expect(audits('agent.action_refused')[0].meta).toMatchObject({ ran: false, action: recordedAs, path: pathOf(route, params), onBehalfOf: OWNER });
        expect(audits('agent.action')).toHaveLength(0);
    });

    it('refuses them the same with the proposing tools switched on, and for the agent of an admin or a member', async () => {
        process.env.MCP_TOOLS_MANAGE = 'on';
        process.env.MCP_TOOLS_WORK = 'on';

        for (const [, route, body, params] of HELD_FOR_PEOPLE) {
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
            expect([route, answer === REACHED ? '' : JSON.stringify(answer.body)]).toEqual([route, expect.not.stringMatching(/Agents cannot/)]);
        }
        expect(agentAudits()).toHaveLength(0);
    });

    it.each([
        ['naming a project', { ProjectName: 'Renamed' }],
        ['describing a project', { descriptionBlock: { blocks: [] } }],
        ['giving a project a due date', { DueDate: '2026-11-01T00:00:00.000Z' }],
    ])('%s is still an agent\'s to change as its person may', async (label, updateObject) => {
        expect(await through(UPDATE, agentToken(OWNER), { updateObject }, inProject)).toBe(REACHED);
        expect(agentAudits()).toHaveLength(0);
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
