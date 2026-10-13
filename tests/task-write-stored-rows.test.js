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
const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const { updateSprintFun, addSprintFun } = require('../Modules/Sprints/controller');
const { insertCustomFieldPromise } = require('../Modules/CustomField/controller');
const { updateCommentCollection } = require('../Modules/Comments/controller');
const { taskMongo } = require('../Modules/Tasks/helpers/task_class_Mongo');
const { task: preV2Task } = require('../Modules/Tasks/helpers/task_class');
const world = require('./fixtures/accessWorld');

mongoHelper.getTotalSprintCount = async () => true;

const { CID, OWNER, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, L_OPEN, L_SECRET, L_PRIVATE, T_OPEN, T_SECRET, STATUSES, settle } = world;
const { seed, rows, task, setRule } = world.create(mockDb);

const P_OTHER = '6f0000000000000000000a11';
const L_OTHER = '6f0000000000000000000b11';
const L_OPEN_2 = '6f0000000000000000000b12';
const T_MINE = '6f0000000000000000000d21';
const T_MINE_CHILD = '6f0000000000000000000d22';
const T_OTHER = '6f0000000000000000000d23';
const T_DONE = '6f0000000000000000000d24';
const F_PRIVATE = '6f0000000000000000000f01';
const SPACE_DIRECT = '6f0000000000000000000c11';
const SPACE_CHANNELS = '6f0000000000000000000c12';
const L_DIRECT = '6f0000000000000000000b21';
const L_CHANNEL = '6f0000000000000000000b22';
const L_CLOSED_CHANNEL = '6f0000000000000000000b23';
const STRANGER = '6f0000000000000000000099';
const BACKLOG = 11;
const OTHER_DONE = 12;
const OTHER_STATUSES = [{ key: BACKLOG, name: 'Backlog', type: 'default_active' }, { key: OTHER_DONE, name: 'Done', type: 'close' }];
const OTHER_TYPES = [{ key: 5, value: 'bug', name: 'Bug' }];
const MODES = ['off', 'enforce'];
const TASK_KEYS = ['task_create', 'sub_task_create', 'task_convert_to_subtask', 'convert_to_task', 'task_convert_to_list', 'task_merge', 'task_duplicate'];
const REFUSED = [400, 403, 404];
const STARTING_COUNT = 5;

const routes = {};
const register = (method) => (routePath, ...handlers) => { routes[`${method} ${routePath}`] = handlers; };
const app = { get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') };
require('../Modules/Tasks/routes').init(app);

const send = (route, uid, body) => new Promise((resolve) => {
    const [method, url] = route.split(' ');
    const timer = setTimeout(() => resolve({ code: 'no answer' }), 1500);
    const res = new EventEmitter();
    res.statusCode = 200;
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (answer) => { clearTimeout(timer); res.headersSent = true; res.emit('finish'); resolve({ code: res.statusCode, body: answer }); return res; };
    res.json = res.send;
    const req = { uid, method, originalUrl: url, url, baseUrl: '', route: { path: url }, query: {}, params: {}, headers: { companyid: CID }, aud: CID, ip: '1.1.1.1', body: JSON.parse(JSON.stringify(body)) };
    const handlers = routes[route];
    const step = (at) => Promise.resolve(handlers[at](req, res, () => step(at + 1)));
    step(0);
}).then(async (result) => { await settle(); await settle(); return result; });

const PATCH = 'PATCH /api/v2/tasks';
const BULK = 'POST /api/v2/tasks/bulk';
const PRE_V2 = 'PATCH /api/tasks/';
const CREATE = 'POST /api/v2/tasks';
const IMPORT = 'PATCH /api/v1/importTasks';
const patch = (uid, body) => send(PATCH, uid, body);
const bulk = (uid, body) => send(BULK, uid, body);

const listRow = (id) => rows(SCHEMA_TYPE.SPRINTS).find((row) => String(row._id) === id);
const counts = (...ids) => ids.map((id) => listRow(id).tasks);
const tasksIn = (projectId, listId) => rows(SCHEMA_TYPE.TASKS).filter((row) => String(row.ProjectID) === projectId && String(row.sprintId) === listId);
const copies = () => tasksIn(P_OTHER, L_OTHER).filter((row) => row.TaskName === 'Copy');
const writesTo = (type) => mockDb.calls.filter((call) => call.type === type && call.method === 'updateMany');
const historyOf = (projectId) => rows(SCHEMA_TYPE.HISTORY).filter((row) => String(row.ProjectId) === projectId);
const everything = () => JSON.stringify([SCHEMA_TYPE.TASKS, SCHEMA_TYPE.SPRINTS, SCHEMA_TYPE.PROJECTS, SCHEMA_TYPE.MAIN_CHATS, SCHEMA_TYPE.CUSTOM_FIELDS].map(rows));

const into = (projectId, listId, extra = {}) => ({ companyId: CID, projectData: { id: projectId }, sprintObj: { id: listId, name: 'As sent' }, ...extra });
const copy = (taskId, extra = {}) => ({ action: 'duplicateTask', selectedTaskId: taskId, duplicateData: [], assignee: [], watcher: [], taskName: 'Copy', ...into(P_OTHER, L_OTHER), ...extra });
const manyCopies = (taskIds, extra = {}) => ({ action: 'bulkDuplicate', taskIds, duplicateData: [], assignee: [], watcher: [], taskName: 'Copy', ...into(P_OTHER, L_OTHER), ...extra });
const becomes = (key, to) => ({ taskStatusData: [{ key, name: 'As sent', convertStatus: { key: to, name: 'As sent', type: 'as sent' } }], taskTypeCounts: [] });

const fileRows = () => ({
    tasks: [
        { _id: 'row-1', TaskName: 'A new row', status: 'To Do', custom_Budget: { type: 'text', value: '12' }, custom_Region: { type: 'text', value: 'North' } },
        { _id: 'row-2', TaskName: 'Another new row', status: 'To Do', custom_Budget: { type: 'text', value: '15' } },
    ],
    projectData: { _id: P_OPEN, CompanyId: CID, ProjectCode: 'ZZZ' }, indexObj: {}, statusArray: STATUSES, sprint: { id: L_OPEN, name: 'As sent' }, eventId: 'e1',
});
const FILE_ROUTES = [
    ['sent as an action', (uid) => patch(uid, { action: 'createMultipleTasks', ...fileRows() })],
    ['sent to the import route', (uid) => send(IMPORT, uid, fileRows())],
];

const conversation = (uid, spaceId, listId, extra = {}) => send(CREATE, uid, {
    data: {
        TaskName: 'Chat', TaskKey: '--', TaskType: 'task', TaskTypeKey: 1, ProjectID: spaceId, CompanyId: CID, status: { key: 1, text: 'To Do', type: 'default_active' }, statusKey: 1,
        statusType: 'default_active', isParentTask: true, ParentTaskId: '', Task_Priority: 'MEDIUM', deletedStatusKey: 0, sprintId: listId, sprintArray: { id: listId, name: 'As sent' },
        AssigneeUserId: [uid, INSIDER], watchers: [uid, INSIDER], Task_Leader: uid, mainChat: true, ...extra,
    },
    user: {}, projectData: { _id: spaceId, CompanyId: CID, ProjectCode: 'CHAT' }, indexObj: {},
});
const conversations = () => rows(SCHEMA_TYPE.TASKS).filter((row) => row.mainChat === true);

beforeEach(() => {
    jest.clearAllMocks();
    mockDb.calls.length = 0;
    const { seedTask, project, list } = seed();
    const taskRules = rows(SCHEMA_TYPE.RULES).find((rule) => rule.key === 'task');
    const everyRole = [{ key: 3, permission: true }, { key: 0, permission: true }];
    TASK_KEYS.forEach((key) => mockDb.seed(SCHEMA_TYPE.RULES, { key, name: key, isParent: false, parentId: String(taskRules._id), roles: everyRole }));
    const projectRules = mockDb.seed(SCHEMA_TYPE.RULES, { key: 'project', name: 'Project', isParent: true, roles: [] });
    ['project_sprint_create', 'project_custom_field'].forEach((key) => mockDb.seed(SCHEMA_TYPE.RULES, { key, name: key, isParent: false, parentId: String(projectRules._id), roles: everyRole }));

    project(P_OTHER, 'Other', { taskStatusData: OTHER_STATUSES, taskTypeCounts: OTHER_TYPES });
    list(L_OTHER, 'List of the other project', P_OTHER);
    list(L_OPEN_2, 'Second open list', P_OPEN);
    rows(SCHEMA_TYPE.SPRINTS).forEach((row) => { row.tasks = STARTING_COUNT; });
    mockDb.seed(SCHEMA_TYPE.FOLDERS, { _id: F_PRIVATE, name: 'Folder of the private project', projectId: P_PRIVATE, deletedStatusKey: 0 });

    const inProgress = { statusKey: 2, statusType: 'active', status: { key: 2, text: 'In Progress', type: 'active' } };
    seedTask(T_MINE, 'A task everyone can open', P_OPEN, L_OPEN, { AssigneeUserId: [], sprintArray: { id: L_OPEN, name: 'Open list' }, subTasks: 1, ...inProgress });
    seedTask(T_MINE_CHILD, 'Its subtask', P_OPEN, L_OPEN, { AssigneeUserId: [], sprintArray: { id: L_OPEN, name: 'Open list' }, isParentTask: false, ParentTaskId: T_MINE, ancestors: [T_MINE], ...inProgress });
    seedTask(T_DONE, 'A finished task', P_OPEN, L_OPEN, { AssigneeUserId: [], sprintArray: { id: L_OPEN, name: 'Open list' }, statusKey: 3, statusType: 'close', status: { key: 3, text: 'Done', type: 'close' } });
    seedTask(T_OTHER, 'A task of the other project', P_OTHER, L_OTHER, {
        AssigneeUserId: [], sprintArray: { id: L_OTHER, name: 'List of the other project' }, statusKey: BACKLOG, statusType: 'default_active', status: { key: BACKLOG, text: 'Backlog' }, TaskType: 'bug', TaskTypeKey: 5,
    });
    [T_OPEN, T_SECRET].forEach((id) => { task(id).AssigneeUserId = []; });
    task(T_OPEN).sprintArray = { id: L_OPEN, name: 'Open list' };
    task(T_SECRET).sprintArray = { id: L_SECRET, name: 'Private list' };

    mockDb.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: SPACE_DIRECT, default: true, ProjectName: 'Direct messages', ProjectCode: 'DM', lastTaskId: 0, subTasks: 0 });
    mockDb.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: SPACE_CHANNELS, default: false, ProjectName: 'Channels', ProjectCode: 'CH', lastTaskId: 0, subTasks: 0 });
    list(L_DIRECT, 'Direct', SPACE_DIRECT, { tasks: STARTING_COUNT });
    list(L_CHANNEL, 'General', SPACE_CHANNELS, { tasks: STARTING_COUNT });
    list(L_CLOSED_CHANNEL, 'Leads', SPACE_CHANNELS, { tasks: STARTING_COUNT, private: true, AssigneeUserId: [INSIDER] });

    updateSprintFun.mockImplementation(async ({ body, params }) => mockDb.crud(body.companyId, { type: SCHEMA_TYPE.SPRINTS, data: [{ _id: params.id }, body.updateObject] }, 'updateOne'));
    addSprintFun.mockImplementation(async ({ body }) => ({
        status: true,
        data: mockDb.seed(SCHEMA_TYPE.SPRINTS, { name: body.sprintName, projectId: body.projectId, deletedStatusKey: 0, tasks: 0, ...(body.folder ? { folderId: body.folder.folderId } : {}) }),
    }));
    insertCustomFieldPromise.mockImplementation(async (field) => mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, field));
});
afterEach(() => { delete process.env.PERMISSION_ENFORCEMENT_MODE; });

describe.each(MODES)('with permission enforcement %s', (mode) => {
    beforeEach(() => { process.env.PERMISSION_ENFORCEMENT_MODE = mode; });

    describe('a file whose columns are not fields of the project yet', () => {
        const withoutTheFieldRight = () => ['task_custom_field', 'project_custom_field'].forEach((key) => setRule(key, false));

        describe.each(FILE_ROUTES)('%s', (how, sendFile) => {
            it.each([['a member', OUTSIDER], ['a guest', GUEST]])('makes the tasks and names the columns left out, for %s who may not set up fields', async (who, uid) => {
                withoutTheFieldRight();
                const before = tasksIn(P_OPEN, L_OPEN).length;

                const answer = await sendFile(uid);

                expect(answer.body.status).toBe(true);
                expect(answer.body.data.skippedFields).toEqual(['Budget', 'Region']);
                expect(rows(SCHEMA_TYPE.CUSTOM_FIELDS)).toHaveLength(0);
                expect(insertCustomFieldPromise).not.toHaveBeenCalled();
                expect(tasksIn(P_OPEN, L_OPEN)).toHaveLength(before + 2);
                expect(tasksIn(P_OPEN, L_OPEN).filter((row) => Object.keys(row).some((key) => key.startsWith('custom_')))).toEqual([]);
            });

            it.each([['a member who may set up fields', OUTSIDER], ['an owner', OWNER]])('makes the fields as well for %s', async (who, uid) => {
                if (uid === OWNER) withoutTheFieldRight();
                const before = tasksIn(P_OPEN, L_OPEN).length;

                const answer = await sendFile(uid);

                expect(answer.body.status).toBe(true);
                expect(answer.body.data.skippedFields).toBeUndefined();
                expect(rows(SCHEMA_TYPE.CUSTOM_FIELDS).map((field) => field.fieldTitle).sort()).toEqual(['Budget', 'Region']);
                expect(tasksIn(P_OPEN, L_OPEN)).toHaveLength(before + 2);
            });
        });
    });

    describe('a copy into another project', () => {
        it('lands in the status of the same name there, and in the opening status when there is none', async () => {
            const answers = [await patch(OWNER, copy(T_MINE)), await patch(OWNER, copy(T_DONE, { oldProject: { id: P_OPEN } }))];

            expect(answers.map((answer) => [answer.code, answer.body.status])).toEqual([[200, true], [200, true]]);
            expect(copies().map((row) => [row.statusKey, row.TaskType, row.TaskTypeKey])).toEqual([[BACKLOG, 'bug', 5], [OTHER_DONE, 'bug', 5]]);
        });

        it('takes the status the request chooses when it is one of that project, and no other', async () => {
            await patch(OWNER, copy(T_MINE, { oldProject: { id: P_OPEN, ...becomes(2, OTHER_DONE) } }));
            await patch(OWNER, copy(T_MINE, { oldProject: { id: P_OPEN, ...becomes(2, 99) } }));

            expect(copies().map((row) => [row.statusKey, row.statusType, row.status.text])).toEqual([[OTHER_DONE, 'close', 'Done'], [BACKLOG, 'default_active', 'Backlog']]);
        });

        it('reads the project and the list the task leaves from the stored task', async () => {
            await patch(OWNER, copy(T_MINE, { oldProject: { id: P_OTHER, ProjectName: '<b>Named</b>' }, oldSprintObj: { name: '<i>Named</i>', folderId: 'x', folderName: '<i>Named</i>' } }));

            expect(copies().map((row) => [String(row.ProjectID), row.statusKey])).toEqual([[P_OTHER, BACKLOG]]);
            const line = rows(SCHEMA_TYPE.HISTORY).find((row) => row.Key === 'Task_Duplicated');
            expect(line.Message).toContain('Open list');
            expect(line.Message).not.toContain('Named');
        });

        it('is made with its subtasks, each in a status of that project', async () => {
            const answer = await patch(OWNER, copy(T_MINE, { isSubTask: true }));

            expect(answer.body.status).toBe(true);
            expect(tasksIn(P_OTHER, L_OTHER).filter((row) => row.TaskName !== 'A task of the other project').map((row) => row.statusKey)).toEqual([BACKLOG, BACKLOG]);
        });

        it('is made for each of many tasks, whatever project each is in', async () => {
            const answer = await bulk(OWNER, manyCopies([T_MINE, T_DONE, T_OTHER]));

            expect(answer.code).toBe(200);
            expect(answer.body.data.updated).toEqual([T_MINE, T_DONE, T_OTHER]);
            expect(copies().map((row) => row.statusKey)).toEqual([BACKLOG, OTHER_DONE, BACKLOG]);
        });
    });

    describe('an action whose handler fails', () => {
        const FAILURES = [
            ['throws', () => { throw new Error('It broke.'); }],
            ['rejects', () => Promise.reject(new Error('It broke.'))],
            ['rejects without an error', () => Promise.reject('It broke.')],
        ];
        const ACTIONS = [
            [PATCH, () => taskMongo, 'updateWatcher', { action: 'updateWatcher', companyId: CID, projectId: P_OPEN, sprintId: L_OPEN, taskId: T_MINE, userId: OWNER, add: true, employeeName: 'Olive Owner' }],
            [BULK, () => taskMongo, 'bulkArchive', { action: 'bulkArchive', companyId: CID, taskIds: [T_MINE] }],
            [PRE_V2, () => preV2Task, 'updateTaskName', { action: 'updateTaskName', firebaseObj: { TaskName: 'Renamed' }, projectData: {}, taskData: { _id: T_MINE }, obj: {} }],
            [CREATE, () => taskMongo, 'create', { data: { TaskName: 'A new row', TaskKey: '-', TaskType: 'task', TaskTypeKey: 1, ProjectID: P_OPEN, CompanyId: CID, sprintId: L_OPEN, isParentTask: true }, user: {}, projectData: { _id: P_OPEN, CompanyId: CID }, indexObj: {} }],
            [IMPORT, () => taskMongo, 'createMultipleTasks', fileRows()],
        ];

        describe.each(ACTIONS)('%s', (route, target, action, body) => {
            it.each(FAILURES)(`answers that it failed when ${action} %s`, async (how, fail) => {
                const spy = jest.spyOn(target(), action).mockImplementationOnce(fail);

                const answer = await send(route, OWNER, body);
                spy.mockRestore();

                expect(answer.code).not.toBe('no answer');
                expect(answer.body.status).toBe(false);
                expect(answer.body.statusText).toBe('It broke.');
            });
        });
    });

    describe('a conversation', () => {
        it('is started by one of the people in it, in a list of the chat space it names', async () => {
            const answer = await conversation(OUTSIDER, SPACE_DIRECT, L_DIRECT);

            expect(answer.body.status).toBe(true);
            expect(conversations().map((row) => [String(row.ProjectID), String(row.sprintId)])).toEqual([[SPACE_DIRECT, L_DIRECT]]);
        });

        it.each([
            ['a list of a project', SPACE_DIRECT, L_OPEN],
            ['a list of another chat space', SPACE_DIRECT, L_CHANNEL],
            ['a private channel the person is not in', SPACE_CHANNELS, L_CLOSED_CHANNEL],
            ['a list that does not exist', SPACE_DIRECT, STRANGER],
        ])('is not put in %s', async (where, spaceId, listId) => {
            const before = everything();

            const answer = await conversation(OUTSIDER, spaceId, listId);

            expect(REFUSED).toContain(answer.code);
            expect(everything()).toBe(before);
        });

        it('opens in a private channel for a person who is in it', async () => {
            const answer = await conversation(INSIDER, SPACE_CHANNELS, L_CLOSED_CHANNEL, { AssigneeUserId: [INSIDER, OUTSIDER], watchers: [] });

            expect(answer.body.status).toBe(true);
            expect(conversations()).toHaveLength(1);
        });

        it.each([
            ['between other people', { AssigneeUserId: [INSIDER, GUEST], watchers: [] }],
            ['with someone who is not in the workspace', { AssigneeUserId: [OUTSIDER, STRANGER], watchers: [] }],
            ['under a parent', { ParentTaskId: T_MINE, isParentTask: false }],
            ['under the chat space itself', { ParentTaskId: SPACE_DIRECT, isParentTask: false }],
        ])('is not started %s', async (what, extra) => {
            const before = everything();

            const answer = await conversation(OUTSIDER, SPACE_DIRECT, L_DIRECT, extra);

            expect(REFUSED).toContain(answer.code);
            expect(everything()).toBe(before);
        });
    });

    describe('a subtask made a task of another project', () => {
        const toTask = (oldProject) => patch(OWNER, { action: 'convertToTask', taskId: T_MINE_CHILD, parentTaskId: T_MINE, oldSprintObj: { id: L_OPEN }, oldProject, ...into(P_OTHER, L_OTHER) });
        const landed = () => { const row = task(T_MINE_CHILD); return [String(row.ProjectID), String(row.sprintId), row.statusKey, row.TaskType, row.deletedStatusKey]; };

        it.each([
            ['names the project it lands in as the one it leaves', { id: P_OTHER }],
            ['names the project it leaves and nothing else', { id: P_OPEN }],
            ['names no project', undefined],
            ['chooses a status that project does not have', { id: P_OPEN, ...becomes(2, 99) }],
        ])('takes that project and a status of it when the request %s', async (what, oldProject) => {
            const answer = await toTask(oldProject);

            expect([answer.code, answer.body.status]).toEqual([200, true]);
            expect(landed()).toEqual([P_OTHER, L_OTHER, BACKLOG, 'bug', 0]);
        });

        it('takes the status the request chooses among that project\'s', async () => {
            await toTask({ id: P_OPEN, ...becomes(2, OTHER_DONE) });

            expect(landed()).toEqual([P_OTHER, L_OTHER, OTHER_DONE, 'bug', 0]);
        });
    });

    describe('a moved task', () => {
        it('leaves the list it is stored in, whatever list the request names', async () => {
            const answer = await patch(OUTSIDER, {
                action: 'moveTask', moveTaskId: T_MINE, assignee: [], watcher: [], ...into(P_OPEN, L_OPEN_2), oldSprintObj: { id: L_PRIVATE, name: 'Named', folderId: F_PRIVATE, folderName: 'Named' }, oldProject: { id: P_OPEN },
            });

            expect(answer.body.status).toBe(true);
            expect(counts(L_OPEN, L_OPEN_2, L_PRIVATE)).toEqual([STARTING_COUNT - 2, STARTING_COUNT + 2, STARTING_COUNT]);
            expect(rows(SCHEMA_TYPE.HISTORY).find((row) => row.Key === 'Task_Moved').Message).toContain('Open list');
        });
    });

    describe('a task made a list', () => {
        const toList = (uid, extra = {}) => patch(uid, { action: 'convertToList', companyId: CID, projectData: { id: P_OPEN, ProjectName: 'Open' }, taskId: T_MINE, folderData: null, sprintObj: { id: L_OPEN, folderId: null }, isSubTask: true, ...extra });
        const newLists = () => rows(SCHEMA_TYPE.SPRINTS).filter((row) => row.name === 'A task everyone can open');

        it('takes its subtasks out of the list they are stored in, whatever list the request names', async () => {
            const answer = await toList(OUTSIDER, { sprintObj: { id: L_PRIVATE, folderId: F_PRIVATE } });

            expect(answer.body.status).toBe(true);
            expect(newLists().map((row) => String(row.projectId))).toEqual([P_OPEN]);
            expect(counts(L_OPEN, L_PRIVATE)).toEqual([STARTING_COUNT - 2, STARTING_COUNT]);
            expect(String(task(T_MINE_CHILD).sprintId)).toBe(String(newLists()[0]._id));
        });

        it.each([
            ['in a folder of another project', { folderData: { folderId: F_PRIVATE, name: 'Named' } }],
            ['in a folder that does not exist', { folderData: { folderId: STRANGER, name: 'Named' } }],
            ['in another project', { projectData: { id: P_OTHER, ProjectName: 'Other' } }],
        ])('is not made a list %s', async (where, extra) => {
            const before = everything();

            const answer = await toList(OWNER, extra);

            expect(answer.code).toBe(400);
            expect(everything()).toBe(before);
        });

        it('stays a task when the list cannot be made', async () => {
            addSprintFun.mockImplementation(async () => ({ status: false, statusText: 'Upgrade your plan', isUpgrade: true }));
            const before = everything();

            const answer = await toList(OWNER);

            expect(answer.body).toMatchObject({ status: false, isUpgrade: true });
            expect(everything()).toBe(before);
        });
    });

    describe('a task made a subtask', () => {
        const under = (parentId, extra = {}) => patch(OWNER, {
            action: 'convertToSubTask', companyId: CID, projectData: { id: P_PRIVATE, ProjectName: 'Named' }, sprintId: L_PRIVATE, selectedTaskId: T_OPEN, taskId: parentId, oldProject: { id: P_PRIVATE, ProjectName: 'Named' }, isSubTask: false, ...extra,
        });

        it('is recorded in the project its parent is stored in, whatever project the request names', async () => {
            const answer = await under(T_DONE);

            expect(answer.body.status).toBe(true);
            expect(task(T_OPEN).ParentTaskId).toBe(T_DONE);
            expect(historyOf(P_PRIVATE)).toEqual([]);
            expect(historyOf(P_OPEN).map((row) => row.Key)).toContain('Task_Convert_To_SubTask');
        });

        it('takes a status of its parent\'s project when that is another project', async () => {
            const answer = await under(T_OTHER, { oldProject: { id: P_OPEN } });

            expect([answer.code, answer.body.status]).toEqual([200, true]);
            const row = task(T_OPEN);
            expect([row.ParentTaskId, String(row.ProjectID), String(row.sprintId), row.statusKey, row.TaskType, row.deletedStatusKey]).toEqual([T_OTHER, P_OTHER, L_OTHER, BACKLOG, 'bug', 0]);
            expect(historyOf(P_PRIVATE)).toEqual([]);
            expect(rows(SCHEMA_TYPE.HISTORY).find((line) => line.Key === 'Task_Convert_To_SubTask').Message).not.toContain('Named');
        });
    });

    describe('a task merged into another', () => {
        const merge = (taskId, extra = {}) => patch(OWNER, {
            action: 'mergeTask', companyId: CID, projectData: { id: P_PRIVATE, ProjectName: 'Named' }, taskId, mergeTaskId: T_DONE, oldProject: { id: P_PRIVATE, ProjectName: 'Named' }, isSubTask: false, ...extra,
        });
        const projectsWritten = (type) => [...new Set(writesTo(type).map((call) => String(call.data[1].ProjectId)))];

        it('takes its history, time and comments to the project the kept task is stored in', async () => {
            const answer = await merge(T_OPEN);

            expect(answer.body.status).toBe(true);
            expect([SCHEMA_TYPE.HISTORY, SCHEMA_TYPE.TIMESHEET, SCHEMA_TYPE.ESTIMATES_TIME].map(projectsWritten)).toEqual([[P_OPEN], [P_OPEN], [P_OPEN]]);
            expect(updateCommentCollection.mock.calls.map((call) => String(call[3].id))).toEqual([P_OPEN]);
            expect(historyOf(P_PRIVATE)).toEqual([]);
        });

        it('leaves the list it is stored in, in the project it is stored in', async () => {
            await merge(T_SECRET);

            expect(counts(L_SECRET, L_OPEN, L_PRIVATE)).toEqual([STARTING_COUNT - 1, STARTING_COUNT, STARTING_COUNT]);
            expect([...new Set(updateSprintFun.mock.calls.map(([{ body }]) => String(body.projectId)))]).toEqual([P_OPEN]);
        });

        it('takes its subtasks along, each in a status of the kept task\'s project', async () => {
            task(T_DONE).ProjectID = P_OTHER;
            task(T_DONE).sprintId = L_OTHER;
            task(T_DONE).sprintArray = { id: L_OTHER, name: 'List of the other project' };
            Object.assign(task(T_DONE), { statusKey: OTHER_DONE, TaskType: 'bug', TaskTypeKey: 5 });

            const answer = await merge(T_MINE, { oldProject: { id: P_OPEN } });

            expect(answer.body.status).toBe(true);
            const row = task(T_MINE_CHILD);
            expect([row.ParentTaskId, String(row.ProjectID), String(row.sprintId), row.statusKey, row.TaskType]).toEqual([T_DONE, P_OTHER, L_OTHER, BACKLOG, 'bug']);
        });
    });
});

describe('what a status and a task type become in the project a task goes to', () => {
    const { conversionRules } = require('../Modules/Tasks/helpers/taskWritePlacement');
    const open = { _id: P_OPEN, ProjectName: 'Open', taskStatusData: STATUSES, taskTypeCounts: [{ key: 1, value: 'task', name: 'Task' }] };
    const other = { _id: P_OTHER, ProjectName: 'Other', taskStatusData: OTHER_STATUSES, taskTypeCounts: OTHER_TYPES };
    const bare = { _id: P_PRIVATE, ProjectName: 'Bare', taskStatusData: [], taskTypeCounts: [] };

    it('covers every status and type of the project it leaves and of the rows that leave it', () => {
        const rules = conversionRules(open, other, null, [{ statusKey: 9, TaskType: 'story' }]);

        expect(rules).toMatchObject({ id: P_OPEN, ProjectName: 'Open' });
        expect(rules.taskStatusData.map((row) => [row.key, row.convertStatus.key])).toEqual([[1, BACKLOG], [2, BACKLOG], [3, OTHER_DONE], [9, BACKLOG]]);
        expect(rules.taskTypeCounts).toEqual([{ value: 'task', convertType: { value: 'bug', key: 5 } }, { value: 'story', convertType: { value: 'bug', key: 5 } }]);
    });

    it('keeps every status as it is inside one project', () => {
        expect(conversionRules(open, open, becomes(2, 3), []).taskStatusData.map((row) => [row.key, row.convertStatus.key])).toEqual([[1, 1], [2, 2], [3, 3]]);
        expect(conversionRules(bare, bare, null, [])).toEqual({ id: P_PRIVATE, ProjectName: 'Bare', taskStatusData: [], taskTypeCounts: [] });
    });

    it('has nothing to give in another project that has no status or no task type', () => {
        expect(conversionRules(open, bare, null, [])).toBeNull();
        expect(conversionRules(open, { ...other, taskTypeCounts: [] }, null, [])).toBeNull();
    });
});
