const { EventEmitter } = require('events');

const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
const mockStub = () => new Proxy({}, { get: (target, name) => { target[name] = target[name] || jest.fn(); return target[name]; } });
jest.mock('../Modules/Sprints/controller', () => mockStub());
jest.mock('../Modules/Tasks/helpers/mongo_helper', () => mockStub());
jest.mock('../Modules/Tasks/helpers/handleNotification', () => mockStub());
jest.mock('../Modules/Company/eventController', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => mockStub());
process.env.STORAGE_TYPE = 'server';

const { SCHEMA_TYPE } = require('../Config/schemaType');
const guard = require('../Config/permissionGuard');
const tables = require('../Config/taskWritePermissions');
const WEB_APP_BODIES = require('./fixtures/taskWriteBodies');

const { projectsForRequest, requireTaskActionPermission } = guard;
const { TASK_ACTIONS, PRE_V2_TASK_ACTIONS, RELATION_ACTIONS, TASK_WRITE_ROUTES, JUDGED, requirementsOf } = tables;

const CID = '6f00000000000000000000c1';
const OWNER = '6f0000000000000000000001';
const MEMBER = '6f0000000000000000000003';
const OPEN_PROJECT = '6f0000000000000000000a01';
const LOCKED_PROJECT = '6f0000000000000000000a02';
const PARITY_PROJECT = '6f0000000000000000000a03';
const OPEN_TASK = '6f0000000000000000000b01';
const OPEN_TASK_2 = '6f0000000000000000000b02';
const LOCKED_TASK = '6f0000000000000000000b03';
const LOCKED_TASK_2 = '6f0000000000000000000b04';
const PARITY_TASK = '6f0000000000000000000b05';
const PARITY_TASK_2 = '6f0000000000000000000b06';
const MISSING_TASK = '6f0000000000000000000bff';

const ENV_KEYS = ['PERMISSION_ENFORCEMENT_MODE', 'DISABLE_PERMISSION_ENFORCEMENT', 'PERMISSION_ENFORCEMENT_CACHE_TTL_SECONDS'];

const TASK_KEYS = ['task_create', 'task_status', 'task_priority', 'task_assignee', 'task_due_date', 'task_start_date', 'task_type', 'task_description',
    'task_estimated_hours', 'task_name_edit', 'task_tag', 'task_checklist', 'task_checklist_assign_remove', 'task_attachments', 'task_custom_field',
    'task_comment', 'queue_list', 'task_delete', 'task_archive', 'task_convert_to_subtask', 'sub_task_create', 'convert_to_task',
    'task_convert_to_list', 'task_move', 'task_merge', 'task_duplicate', 'task_list'];

const seedRules = (type, grant, extra = {}) => {
    const parents = {};
    ['project', 'task'].forEach((key) => { parents[key] = mockDb.seed(type, { key, name: key, isParent: true, roles: [], ...extra }); });
    [...TASK_KEYS.map((k) => `task.${k}`), 'project.project_sprint_create'].forEach((path) => {
        const [parent, key] = path.split('.');
        mockDb.seed(type, { key, name: key, isParent: false, parentId: String(parents[parent]._id), roles: [{ key: 3, permission: grant(path) }], ...extra });
    });
};

const decisions = () => mockDb.store.permission_decisions || [];
const audits = () => (mockDb.store.audit_logs || []).filter((row) => row.action === 'permission.refused');
const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const permissionReads = () => mockDb.calls.map((call) => call.type).filter((type) => type !== 'companies');

const response = () => {
    const res = new EventEmitter();
    res.statusCode = 200;
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; res.emit('finish'); return res; };
    return res;
};

const run = async (middleware, req) => {
    const res = response();
    let passed = false;
    await middleware(req, res, () => { passed = true; });
    if (passed) res.emit('finish');
    await settle();
    return { passed, code: res.statusCode, body: res.body };
};

const session = (uid, body, route = '/api/v2/tasks', method = 'PATCH') => ({
    uid, method, baseUrl: '', route: { path: route }, originalUrl: route, url: route, query: {}, headers: { companyid: CID }, body,
});
const token = (uid, body, route, method) => ({ ...session(uid, body, route, method), apiToken: { _id: 't' } });

const ids = (project) => ({
    [OPEN_PROJECT]: { taskId: OPEN_TASK, otherTaskId: OPEN_TASK_2, projectId: OPEN_PROJECT },
    [LOCKED_PROJECT]: { taskId: LOCKED_TASK, otherTaskId: LOCKED_TASK_2, projectId: LOCKED_PROJECT },
    [PARITY_PROJECT]: { taskId: PARITY_TASK, otherTaskId: PARITY_TASK_2, projectId: PARITY_PROJECT },
}[project]);

const setMode = (mode) => { process.env.PERMISSION_ENFORCEMENT_MODE = mode; };

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    ENV_KEYS.forEach((k) => { delete process.env[k]; });
    mockDb.store.companies = [{ _id: CID }];
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: 3, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: OPEN_PROJECT, isGlobalPermission: true });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: LOCKED_PROJECT, isGlobalPermission: false });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PARITY_PROJECT, isGlobalPermission: false });
    [[OPEN_TASK, OPEN_PROJECT], [OPEN_TASK_2, OPEN_PROJECT], [LOCKED_TASK, LOCKED_PROJECT], [LOCKED_TASK_2, LOCKED_PROJECT], [PARITY_TASK, PARITY_PROJECT], [PARITY_TASK_2, PARITY_PROJECT]]
        .forEach(([_id, ProjectID]) => mockDb.seed(SCHEMA_TYPE.TASKS, { _id, ProjectID }));
    seedRules(SCHEMA_TYPE.RULES, () => true);
    // The member may see tasks in the locked project and do nothing else there.
    seedRules(SCHEMA_TYPE.PROJECT_RULES, (path) => (path === 'task.task_list' ? false : null), { projectId: LOCKED_PROJECT });
    seedRules(SCHEMA_TYPE.PROJECT_RULES, () => true, { projectId: PARITY_PROJECT });
});

afterAll(() => ENV_KEYS.forEach((k) => { delete process.env[k]; }));

const routesOf = (modulePath) => {
    const table = {};
    const register = (method) => (path, ...handlers) => { table[`${method} ${path}`] = handlers; };
    const app = { get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') };
    require(modulePath).init(app);
    return table;
};

const methodsOf = (instance) => Object.getOwnPropertyNames(Object.getPrototypeOf(instance))
    .filter((name) => name !== 'constructor' && typeof instance[name] === 'function');

/* What a route or dispatchable method is missing, so a new one cannot ship without a key. */
const unmappedTaskWrites = ({ routes, routeTable, dispatch }) => [
    ...Object.keys(routes).filter((route) => !route.startsWith('GET ') && !route.startsWith('USE ') && !Object.hasOwn(routeTable, route)).map((route) => `route ${route}`),
    ...dispatch.flatMap(({ label, methods, actions }) => methods.filter((method) => !Object.hasOwn(actions, method)).map((method) => `${label} ${method}`)),
];

describe('every task write route and action has a permission mapping', () => {
    const taskRoutes = routesOf('../Modules/Tasks/routes');
    const projectRoutes = routesOf('../Modules/Project/routes');
    const { taskMongo } = require('../Modules/Tasks/helpers/task_class_Mongo');
    const { task: legacyTask } = require('../Modules/Tasks/helpers/task_class');
    const dispatch = [
        { label: 'PATCH /api/v2/tasks and POST /api/v2/tasks/bulk dispatch', methods: methodsOf(taskMongo), actions: TASK_ACTIONS },
        { label: 'PATCH /api/tasks/ dispatch', methods: methodsOf(legacyTask), actions: PRE_V2_TASK_ACTIONS },
    ];

    test('the scan finds the routes and the methods (it is not vacuous)', () => {
        expect(Object.keys(taskRoutes).filter((route) => !route.startsWith('GET ')).length).toBeGreaterThanOrEqual(12);
        expect(methodsOf(taskMongo).length).toBeGreaterThan(60);
        expect(methodsOf(legacyTask)).toEqual(expect.arrayContaining(['updateStatus', 'updatePriority', 'updateTaskName']));
    });

    test('nothing in Modules/Tasks is unmapped', () => {
        expect(unmappedTaskWrites({ routes: taskRoutes, routeTable: TASK_WRITE_ROUTES, dispatch })).toEqual([]);
    });

    test('the project route that rewrites a project\'s tasks is in the table', () => {
        expect(projectRoutes['PUT /api/v1/project/allTask/:id']).toBeDefined();
        expect(TASK_WRITE_ROUTES['PUT /api/v1/project/allTask/:id']).toMatchObject({ judged: JUDGED.HANDLER });
    });

    test('the scan reports a route or a method added without a mapping', () => {
        const reported = unmappedTaskWrites({
            routes: { ...taskRoutes, 'POST /api/v2/tasks/new-thing': [] },
            routeTable: TASK_WRITE_ROUTES,
            dispatch: [{ label: 'dispatch', methods: [...methodsOf(taskMongo), 'updateSomethingNew'], actions: TASK_ACTIONS }],
        });
        expect(reported).toEqual(['route POST /api/v2/tasks/new-thing', 'dispatch updateSomethingNew']);
    });

    test.each(Object.entries(TASK_WRITE_ROUTES).filter(([, spec]) => [JUDGED.ACTIONS, JUDGED.ROUTE].includes(spec.judged)))('%s puts its guard in front of the handler', (route, spec) => {
        const [first] = (route.includes('/project/') ? projectRoutes : taskRoutes)[route];
        if (spec.tokenEnforced) {
            expect(first.permission).toBe(spec.entry.needs[0].key);
        } else {
            expect(first.taskWrites).toBe(spec.judged === JUDGED.ACTIONS ? spec.actions : spec.entry);
        }
    });

    test('every relation action names a task method, and the route dispatches through the table', async () => {
        const handler = taskRoutes['POST /api/v2/tasks/relations'].slice(-1)[0];
        for (const [action, { method }] of Object.entries(RELATION_ACTIONS)) {
            expect(typeof taskMongo[method]).toBe('function');
            const spy = jest.spyOn(taskMongo, method).mockResolvedValue({ status: true, reached: method });
            const res = response();
            await handler({ headers: { companyid: CID }, body: { action } }, Object.assign(res, { send: (body) => { res.body = body; } }));
            await settle();
            expect(res.body).toEqual({ status: true, reached: method });
            spy.mockRestore();
        }
        const res = response();
        await handler({ headers: { companyid: CID }, body: { action: 'constructor' } }, Object.assign(res, { send: (body) => { res.body = body; } }));
        expect(res.body).toMatchObject({ status: false, statusText: 'Invalid relation action' });
    });

    test('every entry names at least one catalogue key', () => {
        const everyEntry = [...Object.values(TASK_ACTIONS), ...Object.values(PRE_V2_TASK_ACTIONS), ...Object.values(RELATION_ACTIONS),
            ...Object.values(TASK_WRITE_ROUTES).filter((spec) => spec.entry).map((spec) => spec.entry)];
        const bodies = [{}, { deletedStatusKey: 1 }, { deletedStatusKey: 2 }, { deletedStatusKey: 7 }, { type: 'subTask' }, { operation: 'checklistassignee' }];
        everyEntry.forEach((taskEntry) => bodies.forEach((body) => {
            const needs = requirementsOf(taskEntry, body);
            expect(needs.length).toBeGreaterThan(0);
            needs.forEach((need) => expect(need.key).toMatch(/^(task|project)\.[a-z_]+$/));
        }));
    });

    test('the actions API tokens were already refused on are exactly the nine mapped before this change', () => {
        const tokenEnforced = Object.entries(TASK_ACTIONS).filter(([, e]) => e.tokenEnforced).map(([action, e]) => [action, e.needs[0].key]);
        expect(Object.fromEntries(tokenEnforced)).toEqual({
            updateStatus: 'task.task_status',
            updatePriority: 'task.task_priority',
            updateAssignee: 'task.task_assignee',
            updateDueDate: 'task.task_due_date',
            updateStartDate: 'task.task_due_date',
            updateTaskType: 'task.task_type',
            updateDescription: 'task.task_description',
            updateTaskTotalEstimate: 'task.task_estimated_hours',
            updatePoints: 'task.task_estimated_hours',
        });
    });
});

const entryFor = ({ route, action }) => {
    const spec = TASK_WRITE_ROUTES[route];
    return spec.judged === JUDGED.ACTIONS ? spec.actions[action] : spec.entry;
};
const lookupOf = (taskEntry) => (taskEntry.tokenEnforced ? undefined : { tasks: taskEntry.tasks || [], projects: taskEntry.projects || [] });
const label = ({ route, action, source }) => `${route}${action ? ` ${action}` : ''} (${source})`;

describe('every body the web app sends resolves to a project and a key', () => {
    const rows = WEB_APP_BODIES.map((row) => [label(row), row]);

    test('the fixture covers every action with a web-app caller', () => {
        const covered = new Set(WEB_APP_BODIES.map((row) => `${row.route} ${row.action || ''}`.trim()));
        ['updateTaskName', 'updateDates', 'updateStartDateAndDueDate', 'updateTaskLeader', 'updateWatcher', 'updateTags', 'updateChecklists', 'AddAiChecklist',
            'updateAttachments', 'updateTaskCustomField', 'updateMarkAsFavourite', 'updateLastMessageTime', 'updateQueueList', 'updateArchiveDelete',
            'convertToSubTask', 'convertToTask', 'convertToList', 'moveTask', 'mergeTask', 'duplicateTask', 'createSubTaskWithAi']
            .forEach((action) => expect(covered).toContain(`PATCH /api/v2/tasks ${action}`));
        ['bulkUpdateStatus', 'bulkUpdatePriority', 'bulkUpdateAssignee', 'bulkUpdateDueDate', 'bulkUpdateTags', 'bulkArchive', 'bulkDelete', 'bulkTrash',
            'bulkMove', 'bulkConvertToSubTask', 'bulkConvertToTask'].forEach((action) => expect(covered).toContain(`POST /api/v2/tasks/bulk ${action}`));
        ['add', 'remove', 'list'].forEach((action) => expect(covered).toContain(`POST /api/v2/tasks/relations ${action}`));
    });

    test.each(rows)('%s', async (_, row) => {
        const taskEntry = entryFor(row);
        expect(taskEntry).toBeTruthy();
        const body = row.body(ids(LOCKED_PROJECT));
        expect(requirementsOf(taskEntry, body).map((need) => need.key)).toEqual(row.keys);
        expect(await projectsForRequest(CID, { body }, lookupOf(taskEntry))).toMatchObject({ projectIds: [LOCKED_PROJECT], unresolved: false });
    });

    const namesLockedTask = (row) => [LOCKED_TASK, LOCKED_TASK_2].some((id) => JSON.stringify(row.body({ ...ids(LOCKED_PROJECT), projectId: OPEN_PROJECT })).includes(id));

    test.each(rows.filter(([, row]) => namesLockedTask(row)))('%s: the tasks decide, not a project the body names', async (_, row) => {
        const body = row.body({ ...ids(LOCKED_PROJECT), projectId: OPEN_PROJECT });
        const found = await projectsForRequest(CID, { body }, lookupOf(entryFor(row)));
        expect(found.projectIds).toContain(LOCKED_PROJECT);
    });

    test('a bulk body naming tasks in two projects is judged in both', async () => {
        const found = await projectsForRequest(CID, { body: { taskIds: [OPEN_TASK, LOCKED_TASK.toUpperCase(), 'not-an-id'] } }, lookupOf(TASK_ACTIONS.bulkDelete));
        expect([...found.projectIds].sort()).toEqual([OPEN_PROJECT, LOCKED_PROJECT]);
    });

    test('AI subtasks are judged in the project the tasks are created in as well as the parent\'s', async () => {
        const body = { action: 'createSubTaskWithAi', parentTask: { id: OPEN_TASK, ProjectID: LOCKED_PROJECT }, type: 'subTask' };
        const found = await projectsForRequest(CID, { body }, lookupOf(TASK_ACTIONS.createSubTaskWithAi));
        expect([...found.projectIds].sort()).toEqual([OPEN_PROJECT, LOCKED_PROJECT]);
    });

    test('a body whose named tasks do not exist is unresolved', async () => {
        expect(await projectsForRequest(CID, { body: { taskIds: [MISSING_TASK] } }, lookupOf(TASK_ACTIONS.bulkMove))).toMatchObject({ projectIds: [], unresolved: true });
    });
});

const MODES = ['off', 'report', 'enforce'];
const OLD_ACTION_CASES = [
    ['a refusal in a project whose own rules say None', { action: 'updatePriority', taskData: { _id: LOCKED_TASK } }, false],
    ['an allowed change in an open project', { action: 'updateStatus', task: { _id: OPEN_TASK } }, true],
    ['the known difference: a project id borrowed from the company rules', { action: 'updateDescription', task: { _id: LOCKED_TASK } }, true],
    ['a claimed project id does not rescue the task\'s own project', { action: 'updatePriority', projectId: OPEN_PROJECT, taskData: { _id: LOCKED_TASK } }, false],
];

describe('API tokens on the actions mapped before this change behave as on beta', () => {
    describe.each(MODES)('with the workspace in %s', (mode) => {
        beforeEach(() => setMode(mode));

        test.each(OLD_ACTION_CASES)('%s', async (_, body, allowed) => {
            const result = await run(requireTaskActionPermission(), token(MEMBER, body));
            expect(result.passed).toBe(allowed);
            if (!allowed) expect(result).toMatchObject({ code: 403, body: { status: false, error: 'Forbidden', permission: TASK_ACTIONS[body.action].needs[0].key } });
            expect(decisions()).toEqual([]);
        });

        test('the kill switch still skips the check', async () => {
            process.env.DISABLE_PERMISSION_ENFORCEMENT = 'true';
            const result = await run(requireTaskActionPermission(), token(MEMBER, { action: 'updatePriority', taskData: { _id: LOCKED_TASK } }));
            expect(result.passed).toBe(true);
            expect(decisions()).toEqual([]);
        });
    });
});

/* A newly mapped action in the locked project: the member's key there is None. */
const NEW_ACTION = { action: 'moveTask', moveTaskId: LOCKED_TASK, projectData: { id: OPEN_PROJECT } };

describe.each([
    ['API tokens', token],
    ['browser sessions', session],
])('%s on the newly mapped actions follow the enforcement mode', (_, as) => {
    test('off allows as today and reads no permission data', async () => {
        const result = await run(requireTaskActionPermission(), as(MEMBER, NEW_ACTION));
        expect(result.passed).toBe(true);
        expect(permissionReads()).toEqual([]);
        expect(decisions()).toEqual([]);
    });

    test('report allows and records the would-be denial', async () => {
        setMode('report');
        const result = await run(requireTaskActionPermission(), as(MEMBER, NEW_ACTION));
        expect(result.passed).toBe(true);
        expect(decisions()).toHaveLength(1);
        expect(decisions()[0]).toMatchObject({ mode: 'report', method: 'PATCH', route: '/api/v2/tasks', permission: 'task.task_move', scope: LOCKED_PROJECT, reason: 'denied', role: 3 });
        expect(audits()).toEqual([]);
    });

    test('enforce refuses with the key, records it and audits it', async () => {
        setMode('enforce');
        const result = await run(requireTaskActionPermission(), as(MEMBER, NEW_ACTION));
        expect(result).toMatchObject({ passed: false, code: 403, body: { status: false, error: 'Forbidden', permission: 'task.task_move' } });
        expect(decisions()[0]).toMatchObject({ mode: 'enforce', permission: 'task.task_move', scope: LOCKED_PROJECT });
        expect(audits()).toHaveLength(1);
    });

    test('enforce lets through a member whose project grants the key, and an owner', async () => {
        setMode('enforce');
        expect((await run(requireTaskActionPermission(), as(MEMBER, { ...NEW_ACTION, moveTaskId: PARITY_TASK }))).passed).toBe(true);
        expect((await run(requireTaskActionPermission(), as(OWNER, NEW_ACTION))).passed).toBe(true);
        expect(decisions()).toEqual([]);
    });

    test('enforce names the key that refused when an action needs two', async () => {
        setMode('enforce');
        mockDb.store[SCHEMA_TYPE.PROJECT_RULES].filter((rule) => rule.projectId === LOCKED_PROJECT && rule.key === 'task_convert_to_subtask').forEach((rule) => { rule.roles = [{ key: 3, permission: true }]; });
        const result = await run(requireTaskActionPermission(), as(MEMBER, { action: 'convertToSubTask', selectedTaskId: LOCKED_TASK, taskId: LOCKED_TASK_2 }));
        expect(result).toMatchObject({ code: 403, body: { permission: 'task.sub_task_create' } });
        expect(decisions()[0]).toMatchObject({ permission: 'task.sub_task_create' });
    });

    test('enforce judges every project a bulk body reaches', async () => {
        setMode('enforce');
        const route = '/api/v2/tasks/bulk';
        expect((await run(requireTaskActionPermission(), as(MEMBER, { action: 'bulkDelete', taskIds: [OPEN_TASK, OPEN_TASK_2] }, route, 'POST'))).passed).toBe(true);
        const mixed = await run(requireTaskActionPermission(), as(MEMBER, { action: 'bulkDelete', taskIds: [OPEN_TASK, LOCKED_TASK] }, route, 'POST'));
        expect(mixed).toMatchObject({ code: 403, body: { permission: 'task.task_delete' } });
        expect(decisions()[0]).toMatchObject({ route, scope: LOCKED_PROJECT });
    });

    test('enforce does not let a claimed project id rescue a newly mapped action', async () => {
        setMode('enforce');
        const result = await run(requireTaskActionPermission(), as(MEMBER, { action: 'updateWatcher', taskId: LOCKED_TASK_2, projectId: OPEN_PROJECT }));
        expect(result.passed).toBe(true);
        const refused = await run(requireTaskActionPermission(), as(MEMBER, { action: 'updateTags', taskId: LOCKED_TASK, projectId: OPEN_PROJECT }));
        expect(refused).toMatchObject({ code: 403, body: { permission: 'task.task_tag' } });
    });

    test('enforce judges a body whose tasks do not exist on the company rules and says so', async () => {
        setMode('enforce');
        mockDb.store[SCHEMA_TYPE.RULES].filter((rule) => rule.key === 'task_merge').forEach((rule) => { rule.roles = [{ key: 3, permission: null }]; });
        const result = await run(requireTaskActionPermission(), as(MEMBER, { action: 'mergeTask', taskId: MISSING_TASK, mergeTaskId: MISSING_TASK }));
        expect(result.code).toBe(403);
        expect(decisions()[0]).toMatchObject({ scope: 'global', reason: 'tasks_not_found' });
    });

    test('the kill switch turns enforce into report', async () => {
        setMode('enforce');
        process.env.DISABLE_PERMISSION_ENFORCEMENT = 'true';
        const result = await run(requireTaskActionPermission(), as(MEMBER, NEW_ACTION));
        expect(result.passed).toBe(true);
        expect(decisions()[0]).toMatchObject({ mode: 'report', permission: 'task.task_move' });
    });

    test('enforce still reads the company rules when a named parent is missing but a project is named', async () => {
        setMode('enforce');
        mockDb.store[SCHEMA_TYPE.RULES].filter((rule) => rule.key === 'sub_task_create').forEach((rule) => { rule.roles = [{ key: 3, permission: null }]; });
        const body = { action: 'createSubTaskWithAi', type: 'subTask', parentTask: { id: MISSING_TASK, ProjectID: PARITY_PROJECT } };
        const result = await run(requireTaskActionPermission(), as(MEMBER, body));
        expect(result).toMatchObject({ code: 403, body: { permission: 'task.sub_task_create' } });
        expect(decisions()[0]).toMatchObject({ scope: 'global', reason: 'tasks_not_found' });
    });
});

describe('the other task write routes use the same judgement', () => {
    const taskRoutes = routesOf('../Modules/Tasks/routes');
    const guardOf = (route) => taskRoutes[route][0];

    test.each([
        ['POST /api/v2/tasks/relations', { action: 'add', taskId: LOCKED_TASK, relatedTaskId: OPEN_TASK, type: 'blocks' }, 'task.task_list', true],
        ['PATCH /api/tasks/', { action: 'updatePriority', priorityObj: { taskId: LOCKED_TASK } }, 'task.task_priority', false],
        ['PATCH /api/v1/importTasks', { tasks: [], projectData: { _id: LOCKED_PROJECT } }, 'task.task_create', false],
        ['POST /api/tasks', { data: { ProjectID: LOCKED_PROJECT } }, 'task.task_create', false],
    ])('%s', async (route, body, key, readable) => {
        const [method, path] = route.split(' ');
        setMode('off');
        expect((await run(guardOf(route), token(MEMBER, body, path, method))).passed).toBe(true);
        setMode('enforce');
        const result = await run(guardOf(route), token(MEMBER, body, path, method));
        if (readable) {
            expect(result.passed).toBe(true);
        } else {
            expect(result).toMatchObject({ code: 403, body: { permission: key } });
        }
    });

    test('the token-enforced keys stay on PATCH /api/v2/tasks and the bulk route, and do not reach the pre-v2 route', async () => {
        const body = { action: 'updateDescription', task: { _id: PARITY_TASK }, taskData: { _id: LOCKED_TASK } };
        expect((await run(guardOf('PATCH /api/tasks/'), token(MEMBER, body, '/api/tasks/', 'PATCH'))).passed).toBe(true);
        expect((await run(guardOf('POST /api/v2/tasks/bulk'), token(MEMBER, body, '/api/v2/tasks/bulk', 'POST'))).code).toBe(403);
    });

    test('a relation needs the task to be visible in both projects', async () => {
        setMode('enforce');
        mockDb.store[SCHEMA_TYPE.PROJECT_RULES].filter((rule) => rule.projectId === LOCKED_PROJECT && rule.key === 'task_list').forEach((rule) => { rule.roles = [{ key: 3, permission: null }]; });
        const result = await run(guardOf('POST /api/v2/tasks/relations'), session(MEMBER, { action: 'add', taskId: OPEN_TASK, relatedTaskId: LOCKED_TASK }, '/api/v2/tasks/relations', 'POST'));
        expect(result).toMatchObject({ code: 403, body: { permission: 'task.task_list' } });
    });
});
