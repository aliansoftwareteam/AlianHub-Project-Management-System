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

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/accessWorld');
const { taskMongo } = require('../Modules/Tasks/helpers/task_class_Mongo');
const { task: preV2Tasks } = require('../Modules/Tasks/helpers/task_class');
const { TASK_ACTION_FIELDS } = require('../Modules/Tasks/helpers/taskWriteFields');
const { TASK_ACTIONS } = require('../Config/taskWritePermissions');
const registry = require('../Modules/Agents/registry');
const guard = require('../Modules/Agents/guard');

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, L_OPEN, L_PRIVATE, T_OPEN, T_SECRET, T_PRIVATE, T_PERSONAL, settle } = world;
const { seed, rows, setRule } = world.create(mockDb);

const L_OPEN_NEXT = '6f0000000000000000000b09';
const T_OPEN_2 = '6f0000000000000000000d09';
const PATCH = 'PATCH /api/v2/tasks';
const PRE_V2 = 'PATCH /api/tasks/';

const routes = {};
const register = (method) => (routePath, ...handlers) => { routes[`${method} ${routePath}`] = handlers; };
require('../Modules/Tasks/routes').init({ get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') });

const session = (uid) => ({ uid });
const agentToken = (uid, extra = {}) => ({ uid, apiToken: { _id: '6f0000000000000000000101', kind: 'agent', name: 'Claude', userId: uid, scopes: ['read', 'write'], ...extra } });
const scriptToken = (uid) => ({ uid, apiToken: { _id: '6f0000000000000000000102', name: 'A script', userId: uid, scopes: ['read', 'write'] } });

const send = (route, caller, body) => new Promise((resolve) => {
    const [method, url] = route.split(' ');
    const res = new EventEmitter();
    res.statusCode = 200;
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (answer) => { res.emit('finish'); resolve({ code: res.statusCode, body: answer }); return res; };
    res.json = res.send;
    const req = { ...caller, method, originalUrl: url, url, baseUrl: '', route: { path: url }, query: {}, headers: { companyid: CID }, aud: CID, ip: '1.1.1.1', body };
    const handlers = routes[route];
    const step = (at) => Promise.resolve(handlers[at](req, res, () => step(at + 1)));
    step(0);
}).then(async (result) => { await settle(); return result; });

const status = (key, name, type) => ({ status: { key, text: name, type, value: '' }, statusKey: key, statusType: type });

const BODIES = {
    trash: (taskId) => ({ action: 'updateArchiveDelete', companyId: CID, projectData: {}, task: { _id: taskId }, deletedStatusKey: 1 }),
    archive: (taskId) => ({ action: 'updateArchiveDelete', companyId: CID, projectData: {}, task: { _id: taskId }, deletedStatusKey: 2 }),
    restore: (taskId) => ({ action: 'updateArchiveDelete', companyId: CID, projectData: {}, task: { _id: taskId }, deletedStatusKey: 0 }),
    bulkDelete: (taskId) => ({ action: 'bulkDelete', companyId: CID, taskIds: [taskId] }),
    bulkTrash: (taskId) => ({ action: 'bulkTrash', companyId: CID, taskIds: [taskId] }),
    bulkUpdateStatus: (taskId) => ({ action: 'bulkUpdateStatus', companyId: CID, taskIds: [taskId], newStatus: status(2, 'In Progress', 'active') }),
    mergeTask: (taskId) => ({ action: 'mergeTask', companyId: CID, projectData: {}, taskId, mergeTaskId: T_OPEN_2 }),
    close: (taskId) => ({ action: 'updateStatus', newStatus: status(3, 'Done', 'close'), prevStatus: { taskId }, projectData: {}, task: { _id: taskId }, isUpdateTask: true }),
    closeUnderAnotherName: (taskId) => ({ action: 'updateStatus', newStatus: status(3, 'In Progress', 'active'), prevStatus: { taskId }, projectData: {}, task: { _id: taskId }, isUpdateTask: true }),
    closeByTypeAlone: (taskId) => ({ action: 'updateStatus', newStatus: status(2, 'In Progress', 'close'), prevStatus: { taskId }, projectData: {}, task: { _id: taskId }, isUpdateTask: true }),
    statusOfNoProject: (taskId) => ({ action: 'updateStatus', newStatus: status(99, 'In Progress', 'active'), prevStatus: { taskId }, projectData: {}, task: { _id: taskId }, isUpdateTask: true }),
    moveToAnotherProject: (taskId) => ({ action: 'moveTask', companyId: CID, moveTaskId: taskId, projectData: { id: P_PRIVATE }, sprintObj: { id: L_PRIVATE, name: 'x' }, oldSprintObj: { id: L_OPEN }, oldProject: {}, assignee: [], watcher: [] }),
    updateTaskCustomField: (taskId) => ({ action: 'updateTaskCustomField', companyId: CID, taskId, customFieldId: '6f0000000000000000000f01', updateDetail: { fieldValue: 'x' } }),
    updateWatcher: (taskId) => ({ action: 'updateWatcher', companyId: CID, taskId, userId: OWNER, add: true, employeeName: 'x' }),
    duplicateTask: (taskId) => ({ action: 'duplicateTask', companyId: CID, selectedTaskId: taskId, projectData: { id: P_OPEN }, sprintObj: { id: L_OPEN, name: 'x' }, assignee: [], watcher: [] }),
    noSuchAction: (taskId) => ({ action: 'somethingNew', taskId }),

    start: (taskId) => ({ action: 'updateStatus', newStatus: status(2, 'In Progress', 'active'), prevStatus: { taskId }, projectData: {}, task: { _id: taskId }, isUpdateTask: true }),
    updatePriority: (taskId) => ({ action: 'updatePriority', firebaseObj: { Task_Priority: 'HIGH' }, projectData: {}, taskData: { _id: taskId }, priorityObj: {}, isUpdateTask: true }),
    updateTaskName: (taskId) => ({ action: 'updateTaskName', firebaseObj: { TaskName: 'Renamed' }, projectData: {}, taskData: { _id: taskId }, obj: {} }),
    updateDueDate: (taskId) => ({ action: 'updateDueDate', firebaseObj: { DueDate: '2026-10-10T00:00:00.000Z' }, project: {}, task: { _id: taskId }, obj: {}, isUpdateTask: true }),
    updateStartDateAndDueDate: (taskId) => ({ action: 'updateStartDateAndDueDate', firebaseObj: { DueDate: '2026-10-10T00:00:00.000Z', startDate: '2026-10-01T00:00:00.000Z' }, project: {}, task: { _id: taskId }, notificationObj: {} }),
    updateChecklists: (taskId) => ({ action: 'updateChecklists', companyId: CID, taskId, operation: 'checklistadd', data: [{ name: 'Item' }], historyObj: {}, taskData: {} }),
    updateTags: (taskId) => ({ action: 'updateTags', companyId: CID, taskId, tagId: 'tag-1', operation: 'add' }),
    updateAssignee: (taskId) => ({ action: 'updateAssignee', firebaseObj: { AssigneeUserId: OWNER }, projectData: {}, taskData: { _id: taskId }, employeeName: 'x', type: 'assigneeAdd', isUpdateTask: true }),
    moveWithinTheProject: (taskId) => ({ action: 'moveTask', companyId: CID, moveTaskId: taskId, projectData: { id: P_OPEN }, sprintObj: { id: L_OPEN_NEXT, name: 'x' }, oldSprintObj: { id: L_OPEN }, oldProject: {}, assignee: [], watcher: [] }),
};

const REFUSED = ['trash', 'archive', 'restore', 'bulkDelete', 'bulkTrash', 'bulkUpdateStatus', 'mergeTask', 'close', 'closeUnderAnotherName', 'closeByTypeAlone',
    'statusOfNoProject', 'moveToAnotherProject', 'updateTaskCustomField', 'updateWatcher', 'duplicateTask', 'noSuchAction'];
const ALLOWED = ['start', 'updatePriority', 'updateTaskName', 'updateDueDate', 'updateStartDateAndDueDate', 'updateChecklists', 'updateTags', 'updateAssignee', 'moveWithinTheProject'];

const audits = (action) => rows(SCHEMA_TYPE.AUDIT_LOGS).filter((row) => row.action === action);
const snapshot = () => JSON.stringify(rows(SCHEMA_TYPE.TASKS));
let handlers;

beforeEach(() => {
    const { seedTask, list } = seed();
    list(L_OPEN_NEXT, 'Next list', P_OPEN);
    seedTask(T_OPEN_2, 'Second open task', P_OPEN, L_OPEN);
    handlers = Object.fromEntries([...new Set(Object.values(BODIES).map((body) => body(T_OPEN).action))]
        .filter((action) => typeof taskMongo[action] === 'function')
        .map((action) => [action, jest.spyOn(taskMongo, action).mockResolvedValue({ status: true })]));
});
afterEach(() => { jest.restoreAllMocks(); delete process.env.MCP_TOOLS_MANAGE; });

const reached = () => Object.values(handlers).some((handler) => handler.mock.calls.length > 0);

describe('what a token created for an agent changes through the task route', () => {
    it.each(REFUSED.flatMap((name) => [[name, 'an owner', OWNER], [name, 'an admin', ADMIN], [name, 'a member', INSIDER]]))('%s is refused for the agent of %s', async (name, label, uid) => {
        const before = snapshot();

        const answer = await send(PATCH, agentToken(uid), BODIES[name](T_OPEN));

        expect(answer.code).toBe(403);
        expect(answer.body.statusText).toMatch(/^Agents cannot perform /);
        expect(reached()).toBe(false);
        expect(snapshot()).toBe(before);
        expect(audits('agent.action_refused')).toHaveLength(1);
        expect(audits('agent.action_refused')[0].meta).toMatchObject({ ran: false, path: PATCH, onBehalfOf: uid });
    });

    it.each(ALLOWED.flatMap((name) => [[name, 'an owner', OWNER], [name, 'a member', INSIDER]]))('%s goes through for the agent of %s, and is recorded', async (name, label, uid) => {
        const body = BODIES[name](T_OPEN);

        const answer = await send(PATCH, agentToken(uid), body);

        expect(answer.code).toBe(200);
        expect(handlers[body.action]).toHaveBeenCalledTimes(1);
        expect(audits('agent.action_refused')).toHaveLength(0);
        expect(audits('agent.action')).toHaveLength(1);
        expect(audits('agent.action')[0].meta).toMatchObject({ state: 'applied', reason: 'via REST', onBehalfOf: uid });
    });

    it('names a deletion, an archive and a status as what they are in the record', async () => {
        await send(PATCH, agentToken(OWNER), BODIES.trash(T_OPEN));
        await send(PATCH, agentToken(OWNER), BODIES.archive(T_OPEN));
        await send(PATCH, agentToken(OWNER), BODIES.close(T_OPEN));
        await send(PATCH, agentToken(OWNER), BODIES.bulkDelete(T_OPEN));

        expect(audits('agent.action_refused').map((row) => row.meta.action)).toEqual(['task.delete', 'task.archive', 'task.status.set', 'tasks.bulkDelete']);
    });

    it('keeps the tools behind a flag to the MCP server, whatever the flag says', async () => {
        process.env.MCP_TOOLS_MANAGE = 'on';
        const granted = agentToken(OWNER, { grants: ['tasks:manage'] });

        expect(registry.evaluate('task.archive').allowed).toBe(true);
        for (const name of ['archive', 'restore', 'moveToAnotherProject', 'close']) {
            expect((await send(PATCH, granted, BODIES[name](T_OPEN))).code).toBe(403);
        }
        expect(reached()).toBe(false);
    });

    it.each([
        ['a task in a project its person cannot open', OUTSIDER, T_PRIVATE],
        ['a task on a list its person is not on', OUTSIDER, T_SECRET],
        ['a task on another person\'s personal list', OWNER, T_PERSONAL],
        ['a task a guest cannot open', GUEST, T_PRIVATE],
    ])('answers not found for %s', async (label, uid, taskId) => {
        const answer = await send(PATCH, agentToken(uid), BODIES.updatePriority(taskId));

        expect(answer.code).toBe(404);
        expect(reached()).toBe(false);
    });

    it('still holds the agent to the keys of the role behind it', async () => {
        setRule('task_priority', false);

        const answer = await send(PATCH, agentToken(INSIDER), BODIES.updatePriority(T_OPEN));

        expect(answer.code).toBe(403);
        expect(answer.body.permission).toBe('task.task_priority');
        expect(reached()).toBe(false);
    });

    it('judges the same actions on the older task route', async () => {
        const older = jest.spyOn(preV2Tasks, 'updateStatus').mockResolvedValue({ status: true });

        expect((await send(PRE_V2, agentToken(OWNER), BODIES.close(T_OPEN))).code).toBe(403);
        expect(older).not.toHaveBeenCalled();

        expect((await send(PRE_V2, agentToken(OWNER), BODIES.start(T_OPEN))).code).toBe(200);
        expect(older).toHaveBeenCalledTimes(1);
    });
});

describe('the status an agent sets', () => {
    const P_REVIEWS = '6f0000000000000000000a09';
    const T_REVIEWS = '6f0000000000000000000d0a';
    const inReview = { action: 'updateStatus', newStatus: status(3, 'In Review', 'active'), prevStatus: { taskId: T_OPEN }, projectData: {}, task: { _id: T_REVIEWS }, isUpdateTask: true };

    beforeEach(() => {
        const { seedTask, project, list } = seed();
        project(P_REVIEWS, 'Reviews', { taskStatusData: [{ key: 3, name: 'In Review', type: 'active' }] });
        list(L_OPEN_NEXT, 'Reviews list', P_REVIEWS);
        seedTask(T_REVIEWS, 'Task under review', P_REVIEWS, L_OPEN_NEXT);
    });

    it('is read from the project of the task the route writes', async () => {
        const older = jest.spyOn(preV2Tasks, 'updateStatus').mockResolvedValue({ status: true });

        expect((await send(PATCH, agentToken(OWNER), inReview)).code).toBe(200);
        expect(handlers.updateStatus.mock.calls[0][0].task._id).toBe(T_REVIEWS);

        expect((await send(PRE_V2, agentToken(OWNER), inReview)).code).toBe(403);
        expect(older).not.toHaveBeenCalled();
    });
});

describe('everyone else on the task route', () => {
    it.each([
        ['a signed-in owner', session(OWNER)],
        ['a signed-in admin', session(ADMIN)],
        ['a signed-in member', session(INSIDER)],
        ['a personal token of an owner', scriptToken(OWNER)],
    ])('%s still deletes, archives, closes and changes many tasks at once', async (label, caller) => {
        for (const name of ['trash', 'archive', 'close', 'bulkUpdateStatus', 'updateTaskCustomField']) {
            const body = BODIES[name](T_OPEN);
            const answer = await send(PATCH, caller, body);
            expect([name, answer.code]).toEqual([name, 200]);
            expect(handlers[body.action]).toHaveBeenCalled();
        }
        expect(rows(SCHEMA_TYPE.AUDIT_LOGS).filter((row) => String(row.action).startsWith('agent.'))).toHaveLength(0);
    });
});

describe('the table the rule reads', () => {
    it('names task actions the route dispatches, each to an action every agent holds or to one it is refused', () => {
        Object.keys(guard.TASK_PATCH_ACTIONS).forEach((action) => {
            expect(Object.hasOwn(TASK_ACTION_FIELDS, action)).toBe(true);
            expect(Object.hasOwn(TASK_ACTIONS, action)).toBe(true);
        });
    });

    it('leaves no guard exported that no route mounts', () => {
        const mounted = ['Modules/Tasks/routes.js', 'Modules/Agents/routes.js', 'Modules/Pages/routes.js', 'Modules/Goals/routes.js', 'Modules/Project/routes.js', 'Modules/Comments/routes.js', 'Modules/Reminders/routes.js'].map((file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')).join('\n');

        Object.entries(guard).filter(([, value]) => typeof value === 'function').forEach(([name]) => {
            expect(mounted).toMatch(new RegExp(`\\b${name}\\b`));
        });
    });
});

describe('the paths no agent reaches', () => {
    const through = async (caller, method, url, body = {}) => {
        const res = new EventEmitter();
        res.statusCode = 200;
        res.status = (code) => { res.statusCode = code; return res; };
        res.json = (answer) => { res.body = answer; return res; };
        let passed = false;
        await guard.agentPerimeter({ ...caller, method, originalUrl: url, headers: { companyid: CID }, body }, res, () => { passed = true; });
        return passed ? 'passed' : res.statusCode;
    };

    it('refuses an agent the bulk route, a delete and a sign-in setting, and lets a person through', async () => {
        expect(await through(agentToken(OWNER), 'POST', '/api/v2/tasks/bulk', { action: 'bulkDelete' })).toBe(403);
        expect(await through(agentToken(OWNER), 'DELETE', '/api/v2/task-templates/abc')).toBe(403);
        expect(await through(agentToken(OWNER), 'PUT', '/api/v2/sso/config')).toBe(403);
        expect(await through(agentToken(OWNER), 'PATCH', '/api/v2/tasks', { action: 'updatePriority' })).toBe('passed');
        expect(await through(scriptToken(OWNER), 'POST', '/api/v2/tasks/bulk')).toBe('passed');
        expect(await through(session(OWNER), 'PUT', '/api/v2/sso/config')).toBe('passed');
    });

    it.each([
        ['a project\'s own permission rules', 'PUT', '/api/v1/projectRules/update'],
        ['the company\'s roles and rules put back as they came', 'POST', '/api/v1/importSettings'],
        ['a project\'s settings and rules copied in', 'POST', '/api/v1/importSettingsProjectFunction'],
        ['who holds a tracker seat', 'POST', '/api/v1/manageTrackerUserPermission'],
        ['an invitation to the workspace', 'POST', '/api/v2/sendInvitationEmail'],
        ['a list of people to invite', 'POST', '/api/v1/importUser'],
        ['the company\'s own record', 'PUT', '/api/v1/admin/company'],
    ])('refuses an agent %s, and lets a person and a person\'s own token through', async (_what, method, url) => {
        expect(await through(agentToken(OWNER), method, url)).toBe(403);
        expect(await through(scriptToken(OWNER), method, url)).toBe('passed');
        expect(await through(session(OWNER), method, url)).toBe('passed');
    });

    it.each([
        ['a project\'s permission rules', 'GET', '/api/v1/projectRules/6f0000000000000000000d01'],
        ['the company\'s own record', 'POST', '/api/v1/admin/company'],
        ['the company\'s own record, searched', 'POST', '/api/v1/admin/company/find'],
    ])('lets an agent read %s', async (_what, method, url) => {
        expect(await through(agentToken(OWNER), method, url)).toBe('passed');
    });

    it('refuses an agent the renewal of a token, its own included', async () => {
        const renew = `/api/v2/api-tokens/${agentToken(OWNER).apiToken._id}/renew`;
        expect(await through(agentToken(OWNER), 'POST', renew)).toBe(403);
        expect(await through(session(OWNER), 'POST', renew)).toBe('passed');
    });

    it('stand in front of every module, so no route is registered ahead of them', () => {
        const source = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        const modules = [...source('index.js').matchAll(/require\(\s*[`'"]\.\/(Modules\/[^`'"]+)[`'"]\s*\)\.init\(\s*app/g)].map((match) => match[1]);
        const [firstCall] = source('Modules/Agents/routes.js').match(/app\.(use|get|post|put|patch|delete)\([^)]*\)/);

        expect(modules[0]).toBe('Modules/Agents/init');
        expect(firstCall).toBe('app.use(agentPerimeter)');
    });
});
