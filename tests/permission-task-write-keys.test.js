const fs = require('fs');
const path = require('path');

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
jest.mock('../Modules/Company/controller/updateCompany', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => mockStub());
process.env.STORAGE_TYPE = 'server';

const { projectsForRequest, requireTaskActionPermission, requireTaskWritePermission } = require('../Config/permissionGuard');
const { TASK_ACTIONS, PRE_V2_TASK_ACTIONS, RELATION_ACTIONS, TASK_WRITE_ROUTES, JUDGED, requirementsOf } = require('../Config/taskWritePermissions');
const WEB_APP_BODIES = require('./fixtures/taskWriteBodies');
const {
    CID, OWNER, MEMBER, OPEN_PROJECT, LOCKED_PROJECT, PARITY_PROJECT, OPEN_TASK, OPEN_TASK_2, LOCKED_TASK, LOCKED_TASK_2, PARITY_TASK, MISSING_TASK,
    ENV_KEYS, ids, settle, response, run, session, token, setMode, create,
} = require('./fixtures/taskWriteGuard');

const world = create(mockDb);
const { decisions, audits, permissionReads, setRule } = world;

beforeEach(() => world.reset());
afterAll(() => ENV_KEYS.forEach((k) => { delete process.env[k]; }));

const ROOT = path.join(__dirname, '..');

const routesOf = (modulePath) => {
    const table = {};
    const register = (method) => (routePath, ...handlers) => { table[`${method} ${routePath}`] = handlers; };
    const app = { get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), all: register('ALL'), use: register('USE') };
    require(modulePath).init(app);
    return table;
};

const sourceFiles = (dir, out = []) => {
    fs.readdirSync(dir).forEach((name) => {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) {
            if (name !== 'node_modules') sourceFiles(full, out);
        } else if (name.endsWith('.js')) {
            out.push(full);
        }
    });
    return out;
};

const ROUTE_CALL = /\b(app|router|[A-Za-z_$][\w$]*Router)\.(post|put|patch|delete|all|use)\(\s*(['"`])(\/[^'"`]*)\3/g;

/* Every write verb or app.use mount, in any router, whose path names tasks. */
const taskRoutesIn = (source) => [...source.matchAll(ROUTE_CALL)]
    .filter((match) => /task/i.test(match[4]))
    .map((match) => `${match[2].toUpperCase()} ${match[4]}`);

const scannedRoutes = () => {
    const found = new Map();
    sourceFiles(path.join(ROOT, 'Modules')).forEach((file) => {
        taskRoutesIn(fs.readFileSync(file, 'utf8')).forEach((route) => found.set(route, path.relative(ROOT, file)));
    });
    return found;
};

const methodsOf = (instance) => Object.getOwnPropertyNames(Object.getPrototypeOf(instance))
    .filter((name) => name !== 'constructor' && typeof instance[name] === 'function');

/* What a route or dispatchable method is missing, so a new one cannot ship without a key. */
const unmappedTaskWrites = ({ routes, routeTable, dispatch }) => [
    ...routes.filter((route) => !Object.hasOwn(routeTable, route)).map((route) => `route ${route}`),
    ...dispatch.flatMap(({ label, methods, actions }) => methods.filter((method) => !Object.hasOwn(actions, method)).map((method) => `${label} ${method}`)),
];

const needLabel = (need) => (need.anyOf ? need.anyOf.map((option) => option.key).join('|') : need.key);

describe('every task write route and action has a permission mapping', () => {
    const scanned = scannedRoutes();
    const { taskMongo } = require('../Modules/Tasks/helpers/task_class_Mongo');
    const { task: legacyTask } = require('../Modules/Tasks/helpers/task_class');
    const dispatch = [
        { label: 'PATCH /api/v2/tasks and POST /api/v2/tasks/bulk dispatch', methods: methodsOf(taskMongo), actions: TASK_ACTIONS },
        { label: 'PATCH /api/tasks/ dispatch', methods: methodsOf(legacyTask), actions: PRE_V2_TASK_ACTIONS },
    ];

    test('the scan finds the task routes of every router and the dispatchable methods (it is not vacuous)', () => {
        expect([...scanned.keys()]).toEqual(expect.arrayContaining([
            'PATCH /api/v2/tasks', 'POST /api/v2/tasks/bulk', 'PUT /api/v1/project/allTask/:id', 'POST /api/v1/taskIndex', 'POST /api/v1/recurring-tasks',
        ]));
        expect(new Set(scanned.values()).size).toBeGreaterThan(8);
        expect(methodsOf(taskMongo).length).toBeGreaterThan(50);
        expect(methodsOf(legacyTask)).toEqual(expect.arrayContaining(['updateStatus', 'updatePriority', 'updateTaskName']));
    });

    test('nothing in Modules is unmapped', () => {
        expect(unmappedTaskWrites({ routes: [...scanned.keys()], routeTable: TASK_WRITE_ROUTES, dispatch })).toEqual([]);
    });

    test('every table row names a route that still exists', () => {
        expect(Object.keys(TASK_WRITE_ROUTES).filter((route) => !scanned.has(route))).toEqual([]);
    });

    test('the scan reports a route, an app.use mount or a method added without a mapping', () => {
        const source = [
            "app.post('/api/v2/tasks/new-thing', handler);",
            "app.use('/api/v2/task-extras', extrasRouter);",
            "router.patch(`/api/v1/task/other`, handler);",
            "app.post('/api/v1/projects', handler);",
        ].join('\n');
        const reported = unmappedTaskWrites({
            routes: taskRoutesIn(source),
            routeTable: TASK_WRITE_ROUTES,
            dispatch: [{ label: 'dispatch', methods: [...methodsOf(taskMongo), 'updateSomethingNew'], actions: TASK_ACTIONS }],
        });
        expect(reported).toEqual([
            'route POST /api/v2/tasks/new-thing',
            'route USE /api/v2/task-extras',
            'route PATCH /api/v1/task/other',
            'dispatch updateSomethingNew',
        ]);
    });

    test.each(Object.entries(TASK_WRITE_ROUTES).filter(([, spec]) => [JUDGED.ACTIONS, JUDGED.ROUTE].includes(spec.judged)))('%s puts its guard in front of the handler', (route, spec) => {
        const [first] = routesOf(path.join(ROOT, scanned.get(route)).replace(/\.js$/, ''))[route];
        expect(first.taskWrites).toBe(spec.judged === JUDGED.ACTIONS ? spec.actions : spec.entry);
    });

    test('every relation action names a task method, and the route dispatches through the table', async () => {
        const handler = routesOf('../Modules/Tasks/routes')['POST /api/v2/tasks/relations'].slice(-1)[0];
        for (const [action, { method }] of Object.entries(RELATION_ACTIONS)) {
            expect(typeof taskMongo[method]).toBe('function');
            const spy = jest.spyOn(taskMongo, method).mockResolvedValue({ status: true, reached: method });
            const res = response();
            await handler({ headers: { companyid: CID }, aud: CID, uid: OWNER, body: { action, taskId: OPEN_TASK, relatedTaskId: OPEN_TASK_2, type: 'blocks' } }, Object.assign(res, { send: (body) => { res.body = body; } }));
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
            needs.flatMap((need) => need.anyOf || [need]).forEach((need) => expect(need.key).toMatch(/^(task|project|chat)\.[a-z_]+$/));
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
        expect(TASK_WRITE_ROUTES['POST /api/v2/tasks'].entry).toMatchObject({ tokenEnforced: true, needs: [{ key: 'task.task_create' }] });
    });
});

const entryFor = ({ route, action }) => {
    const spec = TASK_WRITE_ROUTES[route];
    return spec.judged === JUDGED.ACTIONS ? spec.actions[action] : spec.entry;
};
const guardFor = ({ route }) => {
    const spec = TASK_WRITE_ROUTES[route];
    return spec.judged === JUDGED.ACTIONS ? requireTaskActionPermission(spec.actions) : requireTaskWritePermission(spec.entry);
};
const lookupOf = (taskEntry) => (taskEntry.tokenEnforced ? undefined : { tasks: taskEntry.tasks || [], projects: taskEntry.projects || [] });
const label = ({ route, action, source }) => `${route}${action ? ` ${action}` : ''} (${source})`;
const bodyIds = (project, destinationProjectId = PARITY_PROJECT) => ({ ...ids[project], destinationProjectId });

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
        ['POST /api/v1/taskIndex', 'POST /api/v1/updateTaskIndexOnload'].forEach((route) => expect(covered).toContain(route));
    });

    test.each(rows)('%s', async (_, row) => {
        const taskEntry = entryFor(row);
        expect(taskEntry).toBeTruthy();
        const body = row.body(bodyIds(LOCKED_PROJECT));
        const needs = requirementsOf(taskEntry, body);
        expect(needs.filter((need) => !need.lookup).map(needLabel)).toEqual(row.keys);
        expect(needs.filter((need) => need.lookup).map(needLabel)).toEqual(row.destination || []);
        expect(await projectsForRequest(CID, { body }, lookupOf(taskEntry))).toMatchObject({ projectIds: [LOCKED_PROJECT], unresolved: false });
        for (const need of needs.filter((n) => n.lookup)) {
            expect(await projectsForRequest(CID, { body }, need.lookup)).toMatchObject({ projectIds: [PARITY_PROJECT], unresolved: false });
        }
    });

    test.each(rows)('%s: an owner\'s API token passes every check in enforce', async (_, row) => {
        setMode('enforce');
        const [method, route] = row.route.split(' ');
        const result = await run(guardFor(row), token(OWNER, row.body(bodyIds(OPEN_PROJECT, OPEN_PROJECT)), route, method));
        expect(result).toMatchObject({ passed: true, code: 200 });
        expect(decisions()).toEqual([]);
    });

    const namesLockedTask = (row) => [LOCKED_TASK, LOCKED_TASK_2].some((id) => JSON.stringify(row.body({ ...bodyIds(LOCKED_PROJECT), projectId: OPEN_PROJECT })).includes(id));

    test.each(rows.filter(([, row]) => namesLockedTask(row)))('%s: the tasks decide, not a project the body names', async (_, row) => {
        const body = row.body({ ...bodyIds(LOCKED_PROJECT), projectId: OPEN_PROJECT });
        const found = await projectsForRequest(CID, { body }, lookupOf(entryFor(row)));
        expect(found.projectIds).toContain(LOCKED_PROJECT);
    });

    test('a bulk body naming tasks in two projects is judged in both', async () => {
        const found = await projectsForRequest(CID, { body: { taskIds: [OPEN_TASK, LOCKED_TASK.toUpperCase()] } }, lookupOf(TASK_ACTIONS.bulkDelete));
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

describe('API tokens on the actions mapped before this change keep their judgement', () => {
    describe.each(MODES)('with the workspace in %s', (mode) => {
        beforeEach(() => setMode(mode));

        test.each(OLD_ACTION_CASES)('%s', async (_, body, allowed) => {
            const result = await run(requireTaskActionPermission(), token(MEMBER, body));
            expect(result.passed).toBe(allowed);
            if (!allowed) expect(result).toMatchObject({ code: 403, body: { status: false, error: 'Forbidden', permission: TASK_ACTIONS[body.action].needs[0].key } });
            expect(decisions()).toEqual([]);
        });

        test('the kill switch still skips the key check', async () => {
            process.env.DISABLE_PERMISSION_ENFORCEMENT = 'true';
            const result = await run(requireTaskActionPermission(), token(MEMBER, { action: 'updatePriority', taskData: { _id: LOCKED_TASK } }));
            expect(result.passed).toBe(true);
            expect(decisions()).toEqual([]);
        });
    });
});

/* A newly mapped action in the locked project: the member's key there is None. */
const NEW_ACTION = { action: 'moveTask', moveTaskId: LOCKED_TASK, projectData: { id: LOCKED_PROJECT } };

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
        expect((await run(requireTaskActionPermission(), as(MEMBER, { ...NEW_ACTION, moveTaskId: PARITY_TASK, projectData: { id: PARITY_PROJECT } }))).passed).toBe(true);
        expect((await run(requireTaskActionPermission(), as(OWNER, NEW_ACTION))).passed).toBe(true);
        expect(decisions()).toEqual([]);
    });

    test('enforce names the key that refused when an action needs two', async () => {
        setMode('enforce');
        setRule(LOCKED_PROJECT, 'task_convert_to_subtask', true);
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
        setRule(null, 'task_merge', null);
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
        setRule(null, 'sub_task_create', null);
        const body = { action: 'createSubTaskWithAi', type: 'subTask', parentTask: { id: MISSING_TASK, ProjectID: PARITY_PROJECT } };
        const result = await run(requireTaskActionPermission(), as(MEMBER, body));
        expect(result).toMatchObject({ code: 403, body: { permission: 'task.sub_task_create' } });
        expect(decisions()[0]).toMatchObject({ scope: 'global', reason: 'tasks_not_found' });
    });

    test('a direct-message preview is judged on the chat key the Chat page checks, read from the company rules', async () => {
        setMode('enforce');
        const preview = { action: 'updateLastMessageTime', companyId: CID, taskId: LOCKED_TASK, msgObj: {} };
        expect((await run(requireTaskActionPermission(), as(MEMBER, preview))).passed).toBe(true);
        setRule(null, 'one_to_one_chat', false);
        const readOnly = await run(requireTaskActionPermission(), as(MEMBER, preview));
        expect(readOnly).toMatchObject({ code: 403, body: { permission: 'chat.one_to_one_chat' } });
        expect(decisions()[0]).toMatchObject({ permission: 'chat.one_to_one_chat', scope: 'global' });
    });
});

describe('the other task write routes use the same judgement', () => {
    const taskRoutes = routesOf('../Modules/Tasks/routes');
    const guardOf = (route) => taskRoutes[route][0];

    test.each([
        ['POST /api/v2/tasks/relations', { action: 'add', taskId: LOCKED_TASK, relatedTaskId: OPEN_TASK, type: 'blocks' }, 'task.task_list', true],
        ['PATCH /api/tasks/', { action: 'updatePriority', priorityObj: { taskId: LOCKED_TASK } }, 'task.task_priority', false],
        ['PATCH /api/v1/importTasks', { tasks: [], projectData: { _id: LOCKED_PROJECT } }, 'task.task_create', false],
    ])('%s', async (route, body, key, readable) => {
        const [method, routePath] = route.split(' ');
        setMode('off');
        expect((await run(guardOf(route), token(MEMBER, body, routePath, method))).passed).toBe(true);
        setMode('enforce');
        const result = await run(guardOf(route), token(MEMBER, body, routePath, method));
        if (readable) {
            expect(result.passed).toBe(true);
        } else {
            expect(result).toMatchObject({ code: 403, body: { permission: key } });
        }
    });

    test('the task index routes need the task to be visible', async () => {
        const indexRoutes = routesOf('../Modules/taskIndex/routes');
        setMode('enforce');
        const reorder = { taskId: LOCKED_TASK, projectId: LOCKED_PROJECT, companyId: CID, sprintId: 's1' };
        expect((await run(indexRoutes['POST /api/v1/taskIndex'][0], session(MEMBER, reorder, '/api/v1/taskIndex', 'POST'))).passed).toBe(true);
        setRule(LOCKED_PROJECT, 'task_list', null);
        const refused = await run(indexRoutes['POST /api/v1/updateTaskIndexOnload'][0], session(MEMBER, { taskUpdate: { data: LOCKED_TASK }, companyId: CID }, '/api/v1/updateTaskIndexOnload', 'POST'));
        expect(refused).toMatchObject({ code: 403, body: { permission: 'task.task_list' } });
    });

    test('the token-enforced keys stay on PATCH /api/v2/tasks and the bulk route, and do not reach the pre-v2 route', async () => {
        const body = { action: 'updateDescription', task: { _id: PARITY_TASK }, taskData: { _id: LOCKED_TASK } };
        expect((await run(guardOf('PATCH /api/tasks/'), token(MEMBER, body, '/api/tasks/', 'PATCH'))).passed).toBe(true);
        expect((await run(guardOf('POST /api/v2/tasks/bulk'), token(MEMBER, body, '/api/v2/tasks/bulk', 'POST'))).code).toBe(403);
    });

    test('POST /api/v2/tasks keeps judging API tokens on task.task_create in every mode', async () => {
        const body = { data: { ProjectID: LOCKED_PROJECT }, projectData: { _id: LOCKED_PROJECT, CompanyId: CID } };
        for (const mode of MODES) {
            setMode(mode);
            expect(await run(guardOf('POST /api/v2/tasks'), token(MEMBER, body, '/api/v2/tasks', 'POST'))).toMatchObject({ code: 403, body: { permission: 'task.task_create' } });
        }
        expect(decisions()).toEqual([]);
    });

    test('a relation needs the task to be visible in both projects', async () => {
        setMode('enforce');
        setRule(LOCKED_PROJECT, 'task_list', null);
        const result = await run(guardOf('POST /api/v2/tasks/relations'), session(MEMBER, { action: 'add', taskId: OPEN_TASK, relatedTaskId: LOCKED_TASK }, '/api/v2/tasks/relations', 'POST'));
        expect(result).toMatchObject({ code: 403, body: { permission: 'task.task_list' } });
    });
});
