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

const { EventEmitter } = require('events');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { TASK_ACTIONS } = require('../Config/taskWritePermissions');
const { TASK_ACTION_FIELDS } = require('../Modules/Tasks/helpers/taskWriteFields');
const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const world = require('./fixtures/accessWorld');

mongoHelper.getTotalSprintCount = async () => true;

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, P_PERSONAL, L_OPEN, L_SECRET, L_PRIVATE, L_PERSONAL, T_OPEN, T_SECRET, T_PRIVATE, T_PERSONAL, STATUSES, OPENS, settle } = world;
const { seed, rows, task } = world.create(mockDb);

const T_MINE = '6f0000000000000000000d21';
const T_MINE_CHILD = '6f0000000000000000000d22';
const EVERY_TASK = [T_OPEN, T_SECRET, T_PRIVATE, T_PERSONAL];
const MODES = ['off', 'enforce'];
const PEOPLE = [['an owner', OWNER], ['an admin', ADMIN], ['a member on the private project', INSIDER], ['a member not on it', OUTSIDER], ['a guest', GUEST]];
const TASK_KEYS = ['task_create', 'sub_task_create', 'task_convert_to_subtask', 'convert_to_task', 'task_convert_to_list', 'task_merge', 'task_duplicate', 'task_description', 'task_type',
    'task_estimated_hours', 'task_checklist', 'task_checklist_assign_remove', 'task_attachments', 'queue_list'];

const PLACES = {
    'the open list of the open project': [P_OPEN, L_OPEN, T_OPEN],
    'a private list of the open project': [P_OPEN, L_SECRET, T_SECRET],
    'the private project': [P_PRIVATE, L_PRIVATE, T_PRIVATE],
    'another person\'s own list': [P_PERSONAL, L_PERSONAL, T_PERSONAL],
    'a list of another project': [P_OPEN, L_PRIVATE, T_OPEN],
};
const EVERYWHERE = ['the open list of the open project', 'a private list of the open project', 'the private project'];
const REACH = {
    [OWNER]: EVERYWHERE,
    [ADMIN]: EVERYWHERE,
    [INSIDER]: [...EVERYWHERE, 'another person\'s own list'],
    [OUTSIDER]: ['the open list of the open project'],
    [GUEST]: ['the open list of the open project'],
};

const routes = {};
const register = (method) => (routePath, ...handlers) => { routes[`${method} ${routePath}`] = handlers; };
const app = { get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') };
require('../Modules/Tasks/routes').init(app);
require('../Modules/RecurringTasks/routes').init(app);

const send = (route, caller, body) => new Promise((resolve) => {
    const [method, url] = route.split(' ');
    const timer = setTimeout(() => resolve({ code: 'no answer' }), 2000);
    const res = new EventEmitter();
    res.statusCode = 200;
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (answer) => { clearTimeout(timer); res.emit('finish'); resolve({ code: res.statusCode, body: answer }); return res; };
    res.json = res.send;
    const req = { ...caller, method, originalUrl: url, url, baseUrl: '', route: { path: url }, query: {}, params: {}, headers: { companyid: CID }, aud: CID, ip: '1.1.1.1', body: JSON.parse(JSON.stringify(body)) };
    const handlers = routes[route];
    const step = (at) => Promise.resolve(handlers[at](req, res, () => step(at + 1)));
    step(0);
}).then(async (result) => { await settle(); return result; });

const session = (uid) => ({ uid });
const personalToken = (uid) => ({ uid, apiToken: { _id: '6f0000000000000000000102', name: 'A script', userId: uid, scopes: ['read', 'write'] } });
const patch = (uid, body) => send('PATCH /api/v2/tasks', session(uid), body);
const bulk = (uid, body) => send('POST /api/v2/tasks/bulk', session(uid), body);

const newRow = (projectId, listId, extra = {}) => ({
    TaskName: 'A new row', TaskKey: '-', TaskType: 'task', TaskTypeKey: 1, ProjectID: projectId, CompanyId: CID, status: { key: 1, text: 'To Do', type: 'default_active' },
    statusKey: 1, statusType: 'default_active', isParentTask: true, ParentTaskId: '', Task_Priority: 'MEDIUM', deletedStatusKey: 0, sprintId: listId, sprintArray: { id: listId, name: 'As sent' },
    AssigneeUserId: [], watchers: [], ...extra,
});
const createBody = (projectId, listId, extra) => ({ data: newRow(projectId, listId, extra), user: {}, projectData: { _id: projectId, CompanyId: CID, ProjectCode: 'ZZZ' }, indexObj: {} });
const manyBody = (projectId, listId) => ({
    tasks: [{ _id: 'row-1', TaskName: 'A new row', status: 'To Do' }, { _id: 'row-2', TaskName: 'Another new row', status: 'To Do' }],
    projectData: { _id: projectId, CompanyId: CID, ProjectCode: 'ZZZ' }, indexObj: {}, statusArray: STATUSES, sprint: { id: listId, name: 'As sent' }, eventId: 'e1',
});
/* The move and copy dialogs send, with the place, what each status and task type becomes there. */
const MAPPING = {
    taskStatusData: [{ key: 1, name: 'To Do', convertStatus: { key: 1, name: 'To Do', type: 'default_active' } }],
    taskTypeCounts: [{ value: 'task', convertType: { value: 'task', key: 1 } }],
};
const into = (projectId, listId) => ({ companyId: CID, projectData: { id: projectId }, sprintObj: { id: listId, name: 'As sent' }, oldSprintObj: { id: L_OPEN }, oldProject: { id: P_OPEN, ...MAPPING } });

/* Each sends one request that would put a row in the place named. */
const NEW_ROWS = {
    'a new task': (uid, [projectId, listId]) => send('POST /api/v2/tasks', session(uid), createBody(projectId, listId)),
    'a new task sent as an action': (uid, [projectId, listId]) => patch(uid, { action: 'create', ...createBody(projectId, listId) }),
    'many new tasks at once': (uid, [projectId, listId]) => patch(uid, { action: 'createMultipleTasks', ...manyBody(projectId, listId) }),
    'the tasks of a file': (uid, [projectId, listId]) => send('PATCH /api/v1/importTasks', session(uid), manyBody(projectId, listId)),
    'tasks suggested for a task': (uid, [projectId, listId, taskId]) => patch(uid, {
        action: 'createSubTaskWithAi', companyId: CID, userId: uid, subTitles: [{ title: 'A new row' }], sprintObj: { id: listId, name: 'As sent' }, projectData: {}, parentTask: { id: taskId, ProjectID: projectId }, type: 'task',
    }),
};
const MOVED_ROWS = {
    'a moved task': (uid, place) => patch(uid, { action: 'moveTask', moveTaskId: T_MINE, assignee: [], watcher: [], ...into(...place) }),
    'a copy of a task': (uid, place) => patch(uid, { action: 'duplicateTask', selectedTaskId: T_MINE, duplicateData: [], assignee: [], watcher: [], taskName: 'Copy', ...into(...place) }),
    'a subtask made a task': (uid, place) => patch(uid, { action: 'convertToTask', taskId: T_MINE_CHILD, parentTaskId: T_MINE, ...into(...place) }),
    'many moved tasks': (uid, place) => bulk(uid, { action: 'bulkMove', taskIds: [T_MINE], ...into(...place) }),
    'many copies': (uid, place) => bulk(uid, { action: 'bulkDuplicate', taskIds: [T_MINE], duplicateData: [], assignee: [], watcher: [], taskName: 'Copy', ...into(...place) }),
    'many subtasks made tasks': (uid, place) => bulk(uid, { action: 'bulkConvertToTask', taskIds: [T_MINE_CHILD], ...into(...place) }),
};

const status = { status: { key: 2, text: 'In Progress', type: 'active', value: '' }, statusKey: 2, statusType: 'active' };
const DAY = '2026-09-03T00:00:00.000Z';
/* Each names every task of the workspace; the bulk route keeps to the ones the caller can read. */
const MANY_TASKS = {
    bulkUpdateStatus: { newStatus: status },
    bulkUpdatePriority: { firebaseObj: { Task_Priority: 'HIGH' }, priorityObj: {} },
    bulkUpdateDueDate: { DueDate: DAY },
    bulkUpdateStartDate: { startDate: DAY },
    bulkUpdateDates: { taskIds: undefined, dates: EVERY_TASK.map((taskId) => ({ taskId, startDate: DAY, DueDate: DAY })) },
    bulkUpdateAssignee: { employeeName: 'Olive Owner', employeeId: [OWNER], type: 'assigneeAdd' },
    bulkUpdateTags: { tagId: 'tag-1', operation: 'add' },
    bulkArchive: {},
    bulkRestore: {},
    bulkDelete: {},
    bulkTrash: {},
    bulkMove: into(P_OPEN, L_OPEN),
    bulkConvertToSubTask: { parentTaskId: T_MINE },
    bulkConvertToTask: into(P_OPEN, L_OPEN),
    bulkAddToList: { sprintId: L_OPEN },
    bulkDuplicate: { duplicateData: [], assignee: [], watcher: [], taskName: 'Copy', ...into(P_OPEN, L_OPEN) },
};

const written = () => JSON.stringify([rows(SCHEMA_TYPE.TASKS), rows(SCHEMA_TYPE.SPRINTS), rows(SCHEMA_TYPE.PROJECTS), rows(SCHEMA_TYPE.CUSTOM_FIELDS) || []]);
const rowsIn = (projectId, listId) => rows(SCHEMA_TYPE.TASKS).filter((row) => String(row.ProjectID) === projectId && String(row.sprintId) === listId).length;
const stored = (taskId) => JSON.stringify(task(taskId));
const cannotOpen = (uid) => EVERY_TASK.filter((taskId) => !OPENS[uid].includes(taskId));
const REFUSED = [400, 403, 404];

/* A body naming, at every path the action's guard reads, a task and a project the caller cannot open. */
const setAt = (target, [key, ...rest], value) => {
    if (key === '*') return [rest.length ? setAt({}, rest, value) : value];
    target[key] = rest.length ? setAt(target[key] && typeof target[key] === 'object' ? target[key] : {}, rest, value) : value;
    return target;
};
const closedBody = (action, body = {}) => {
    const needs = typeof TASK_ACTIONS[action].needs === 'function' ? TASK_ACTIONS[action].needs(body) : TASK_ACTIONS[action].needs;
    const lookups = [TASK_ACTIONS[action], ...needs.map((need) => need.lookup).filter(Boolean)];
    lookups.forEach((lookup) => {
        (lookup.tasks || []).forEach((path) => setAt(body, path, T_PRIVATE));
        (lookup.projects || []).forEach((path) => setAt(body, path, P_PRIVATE));
    });
    return {
        action, companyId: CID, sprintId: L_PRIVATE, sprintObj: { id: L_PRIVATE, name: 'As sent' }, sprint: { id: L_PRIVATE, name: 'As sent' }, statusArray: STATUSES,
        tasks: [{ _id: 'row-1', TaskName: 'A new row', status: 'To Do' }], subTitles: [{ title: 'A new row' }], indexObj: {}, ...body,
    };
};

beforeEach(() => {
    jest.clearAllMocks();
    const { seedTask } = seed();
    const taskRules = rows(SCHEMA_TYPE.RULES).find((rule) => rule.key === 'task');
    const everyRole = [{ key: 3, permission: true }, { key: 0, permission: true }];
    TASK_KEYS.forEach((key) => mockDb.seed(SCHEMA_TYPE.RULES, { key, name: key, isParent: false, parentId: String(taskRules._id), roles: everyRole }));
    const projectRules = mockDb.seed(SCHEMA_TYPE.RULES, { key: 'project', name: 'Project', isParent: true, roles: [] });
    mockDb.seed(SCHEMA_TYPE.RULES, { key: 'project_sprint_create', name: 'project_sprint_create', isParent: false, parentId: String(projectRules._id), roles: everyRole });
    rows(SCHEMA_TYPE.PROJECTS).forEach((row) => { row.tagsArray = [{ uid: 'tag-1', tagName: 'Urgent' }]; });
    seedTask(T_MINE, 'A task everyone can open', P_OPEN, L_OPEN, { AssigneeUserId: [] });
    seedTask(T_MINE_CHILD, 'Its subtask', P_OPEN, L_OPEN, { AssigneeUserId: [], isParentTask: false, ParentTaskId: T_MINE, ancestors: [T_MINE] });
});
afterEach(() => { delete process.env.PERMISSION_ENFORCEMENT_MODE; });

describe('every action the task routes dispatch from a body', () => {
    /* These read the task and the list from the database and judge both themselves. */
    const JUDGED_BY_HANDLER = ['addToList', 'removeFromList', 'bulkAddToList'];

    it.each(Object.keys(TASK_ACTION_FIELDS))('%s names a task the caller must read or a place they must open', (action) => {
        const { task: written, listed, destination } = TASK_ACTION_FIELDS[action];

        expect(Boolean(written || listed || destination) || JUDGED_BY_HANDLER.includes(action)).toBe(true);
    });

    it.each(Object.keys(TASK_ACTIONS).filter((action) => !Object.hasOwn(TASK_ACTION_FIELDS, action)))('%s is a helper, not an action a body can send', async (action) => {
        expect((await patch(OWNER, closedBody(action))).code).toBe(400);
        expect((await bulk(OWNER, closedBody(action))).body.status).toBe(false);
    });
});

describe.each(MODES)('with permission enforcement %s', (mode) => {
    beforeEach(() => { process.env.PERMISSION_ENFORCEMENT_MODE = mode; });

    describe.each(PEOPLE)('%s', (who, uid) => {
        describe.each(Object.keys(NEW_ROWS))('sending %s', (what) => {
            it.each(Object.keys(PLACES))('lands it in %s only when they can open that place', async (where) => {
                const place = PLACES[where];
                const before = written();
                const count = rowsIn(place[0], place[1]);

                const answer = await NEW_ROWS[what](uid, place);

                if (REACH[uid].includes(where)) {
                    expect(rowsIn(place[0], place[1])).toBeGreaterThan(count);
                    return;
                }
                expect(REFUSED).toContain(answer.code);
                expect(written()).toBe(before);
            });
        });

        it.each(Object.keys(MOVED_ROWS))('sending %s puts nothing in a place they cannot open', async (what) => {
            for (const where of Object.keys(PLACES).filter((name) => !REACH[uid].includes(name))) {
                const before = written();

                const answer = await MOVED_ROWS[what](uid, PLACES[where]);

                expect([where, REFUSED.includes(answer.code)]).toEqual([where, true]);
                expect(written()).toBe(before);
            }
        });

        it('puts a new subtask only under a task they can read', async () => {
            for (const parent of EVERY_TASK) {
                const before = written();
                const [projectId, listId] = Object.values(PLACES).find((place) => place[2] === parent);

                const answer = await send('POST /api/v2/tasks', session(uid), createBody(projectId === P_OPEN ? P_OPEN : projectId, projectId === P_OPEN ? L_OPEN : listId, { isParentTask: false, ParentTaskId: parent }));

                if (OPENS[uid].includes(parent)) {
                    expect(rows(SCHEMA_TYPE.TASKS).filter((row) => row.ParentTaskId === parent).length).toBe(1);
                } else {
                    expect(answer.code).toBe(404);
                    expect(written()).toBe(before);
                }
            }
        });

        it.each(Object.keys(MANY_TASKS))('%s leaves every task they cannot read as it was', async (action) => {
            const closed = cannotOpen(uid);
            const before = closed.map(stored);
            const elsewhere = [[P_OPEN, L_SECRET], [P_PRIVATE, L_PRIVATE], [P_PERSONAL, L_PERSONAL]].filter(([, listId]) => !REACH[uid].some((name) => PLACES[name][1] === listId));
            const counts = elsewhere.map((place) => rowsIn(...place));

            await bulk(uid, { action, companyId: CID, taskIds: EVERY_TASK, ...MANY_TASKS[action] });

            expect(closed.map(stored)).toEqual(before);
            expect(elsewhere.map((place) => rowsIn(...place))).toEqual(counts);
        });
    });

    describe.each([['a member not on the private project', OUTSIDER], ['a guest', GUEST]])('%s', (who, uid) => {
        it.each(Object.keys(TASK_ACTIONS))('writes nothing with %s when every task, project and list it names is closed to them', async (action) => {
            const before = written();

            await patch(uid, closedBody(action));
            await bulk(uid, closedBody(action));

            expect(written()).toBe(before);
        });
    });

    describe('running every repeating task that is due in the workspace', () => {
        const RUN_DUE = 'POST /api/v1/recurring-tasks/run-due';
        const runs = (answer) => answer.code === 200 && answer.body.status === true;

        it.each(PEOPLE)('is for an owner or an admin: %s', async (who, uid) => {
            const privileged = [OWNER, ADMIN].includes(uid);

            expect(runs(await send(RUN_DUE, session(uid), {}))).toBe(privileged);
            expect(runs(await send(RUN_DUE, personalToken(uid), {}))).toBe(privileged);
        });
    });
});
