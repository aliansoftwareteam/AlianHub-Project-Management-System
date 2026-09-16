const mockDb = require('./fixtures/fakeMongo').create();
const mockLogger = { info: jest.fn(), error: jest.fn(), warn: jest.fn() };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => mockLogger);

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { projectsForRequest, requirePermission, requireTaskActionPermission } = require('../Config/permissionGuard');

const CID = '6f00000000000000000000c1';
const MEMBER = '6f0000000000000000000003';
const GLOBAL_PROJECT = '6f0000000000000000000a01';
const OWN_RULES_PROJECT = '6f0000000000000000000a02';
const TASK_IN_OWN_RULES = '6f0000000000000000000b01';
const TASK_IN_GLOBAL = '6f0000000000000000000b02';
const MISSING_TASK = '6f0000000000000000000bff';
const USER = { Employee_Name: 'Max Member', id: MEMBER, companyOwnerId: '6f0000000000000000000001' };

const seedRules = (type, grants, extra = {}) => {
    const task = mockDb.seed(type, { key: 'task', name: 'Task', isParent: true, roles: [], ...extra });
    Object.entries(grants).forEach(([key, permission]) => mockDb.seed(type, {
        key, name: key, isParent: false, parentId: String(task._id), roles: [{ key: 3, permission }], ...extra,
    }));
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: 3, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: GLOBAL_PROJECT, isGlobalPermission: true });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: OWN_RULES_PROJECT, isGlobalPermission: false });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: TASK_IN_OWN_RULES, ProjectID: OWN_RULES_PROJECT });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: TASK_IN_GLOBAL, ProjectID: GLOBAL_PROJECT });
    seedRules(SCHEMA_TYPE.RULES, { task_create: null, task_status: null, task_description: true, task_assignee: true });
    seedRules(SCHEMA_TYPE.PROJECT_RULES, { task_create: true, task_status: true, task_description: null, task_assignee: null }, { projectId: OWN_RULES_PROJECT });
});

const project = (id) => ({ _id: id, CompanyId: CID, ProjectName: 'Parity' });

/* The bodies frontend/src sends to the routes requirePermission and requireTaskActionPermission guard. */
const WEB_APP_SHAPES = [
    ['POST /api/v2/tasks (TaskOperations create)', (taskId, projectId) => ({ data: { ProjectID: projectId, sprintId: 's1', TaskName: 'New' }, user: USER, projectData: project(projectId), indexObj: {} }), 'project'],
    ['PATCH updateDueDate (TaskOperations, Calendar view)', (taskId, projectId) => ({ action: 'updateDueDate', commonDateFormatString: 'DD/MM/YYYY', firebaseObj: { DueDate: 1 }, project: project(projectId), task: { _id: taskId, sprintId: 's1', sprintArray: {} }, obj: {}, userData: USER, isUpdateTask: true }), 'task'],
    ['PATCH updateStartDate (TaskOperations)', (taskId, projectId) => ({ action: 'updateStartDate', commonDateFormatString: 'DD/MM/YYYY', firebaseObj: { startDate: 1 }, project: project(projectId), task: { _id: taskId, sprintId: 's1' }, obj: {}, userData: USER, isUpdateTask: true }), 'task'],
    ['PATCH updateStatus (TaskOperations)', (taskId, projectId) => ({ action: 'updateStatus', newStatus: { status: { text: 'Done' } }, prevStatus: { taskId }, projectData: project(projectId), task: { _id: taskId, sprintId: 's1' }, isUpdateTask: true, userData: USER }), 'task'],
    ['PATCH updateDescription (TaskOperations)', (taskId, projectId) => ({ action: 'updateDescription', companyId: CID, projectData: project(projectId), sprintId: 's1', task: { _id: taskId }, userData: USER, text: { blocks: [], text: '' } }), 'task'],
    ['PATCH updatePriority (TaskOperations)', (taskId, projectId) => ({ action: 'updatePriority', firebaseObj: {}, projectData: project(projectId), taskData: { _id: taskId, sprintId: 's1' }, priorityObj: {}, isUpdateTask: true, userData: USER }), 'task'],
    ['PATCH updateTaskTotalEstimate (TaskOperations)', (taskId, projectId) => ({ action: 'updateTaskTotalEstimate', firebaseObj: {}, projectData: project(projectId), taskData: { _id: taskId }, obj: {}, userData: USER }), 'task'],
    ['PATCH updatePoints (TaskOperations)', (taskId, projectId) => ({ action: 'updatePoints', firebaseObj: {}, projectData: project(projectId), taskData: { _id: taskId }, userData: USER }), 'task'],
    ['PATCH updateAssignee (TaskOperations)', (taskId, projectId) => ({ action: 'updateAssignee', firebaseObj: { AssigneeUserId: MEMBER }, projectData: project(projectId), taskData: { _id: taskId, AssigneeUserId: [] }, employeeName: 'Max', type: 'assigneeAdd', isUpdateTask: true, userData: USER }), 'task'],
    ['PATCH updateAssignee (AgentTeammates)', (taskId, projectId) => ({ action: 'updateAssignee', firebaseObj: { AssigneeUserId: MEMBER }, projectData: { _id: projectId, CompanyId: CID, ProjectName: 'Parity' }, taskData: { _id: taskId, TaskName: 'T', sprintId: 's1', folderObjId: '', AssigneeUserId: [] }, employeeName: 'Max', type: 'assigneeAdd', isUpdateTask: true, userData: USER }), 'task'],
    ['PATCH updateTaskType (TaskOperations)', (taskId, projectId) => ({ action: 'updateTaskType', newStatus: {}, prevStatus: {}, projectData: project(projectId), taskData: { _id: taskId }, isUpdateTask: true, userData: USER }), 'task'],
];

describe('projectsForRequest resolves the project of every body the web app sends to a guarded route', () => {
    test.each(WEB_APP_SHAPES)('%s', async (_, shape) => {
        const found = await projectsForRequest(CID, { body: shape(TASK_IN_OWN_RULES, OWN_RULES_PROJECT) });
        expect(found).toMatchObject({ projectIds: [OWN_RULES_PROJECT], unresolved: false });
    });

    test.each(WEB_APP_SHAPES.filter(([, , source]) => source === 'task'))('%s: the task decides, not the project the body claims', async (_, shape) => {
        const found = await projectsForRequest(CID, { body: shape(TASK_IN_OWN_RULES, GLOBAL_PROJECT) });
        expect(found.projectIds).toEqual([OWN_RULES_PROJECT]);
    });

    test('a body naming tasks in two projects is judged in both', async () => {
        const found = await projectsForRequest(CID, { body: { task: { _id: TASK_IN_GLOBAL }, taskData: { _id: TASK_IN_OWN_RULES } } });
        expect([...found.projectIds].sort()).toEqual([GLOBAL_PROJECT, OWN_RULES_PROJECT]);
    });

    test('the top-level projectId an API client sends still resolves', async () => {
        expect(await projectsForRequest(CID, { body: { projectId: OWN_RULES_PROJECT } })).toMatchObject({ projectIds: [OWN_RULES_PROJECT], unresolved: false });
    });

    test('a body that names no project (create project, settings writes) has none and is not unresolved', async () => {
        expect(await projectsForRequest(CID, { body: { ProjectName: 'New' } })).toMatchObject({ projectIds: [], unresolved: false });
        expect(await projectsForRequest(CID, {})).toMatchObject({ projectIds: [], unresolved: false });
    });

    test('a body whose only task does not exist is marked unresolved', async () => {
        expect(await projectsForRequest(CID, { body: { task: { _id: MISSING_TASK }, projectData: project(OWN_RULES_PROJECT) } })).toMatchObject({ projectIds: [], unresolved: true });
    });
});

const run = async (middleware, req) => {
    const res = { code: 200 };
    res.status = (c) => { res.code = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    let passed = false;
    await middleware(req, res, () => { passed = true; });
    return { passed, code: res.code };
};
const patRequest = (body) => ({ apiToken: { _id: 't' }, uid: MEMBER, headers: { companyid: CID }, body });

describe('the API-token guards judge web-app shaped bodies by their project', () => {
    test('a status change on a task whose project grants it passes, though the company rules say None', async () => {
        const shape = WEB_APP_SHAPES.find(([name]) => name.startsWith('PATCH updateStatus'))[1];
        expect((await run(requireTaskActionPermission(), patRequest(shape(TASK_IN_OWN_RULES, OWN_RULES_PROJECT)))).passed).toBe(true);
        expect((await run(requireTaskActionPermission(), patRequest(shape(TASK_IN_GLOBAL, GLOBAL_PROJECT)))).code).toBe(403);
    });

    test('a task created with projectData alone is judged by that project', async () => {
        const body = { data: { sprintId: 's1' }, projectData: project(OWN_RULES_PROJECT), user: USER };
        expect((await run(requirePermission('task.task_create'), patRequest(body))).passed).toBe(true);
    });

    test('a body naming a task that does not exist is judged on the company rules, with a warning naming the key', async () => {
        const body = { action: 'updateStatus', task: { _id: MISSING_TASK }, projectData: project(OWN_RULES_PROJECT) };
        const result = await run(requireTaskActionPermission(), patRequest(body));
        expect(result.code).toBe(403);
        expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('task.task_status'));
        expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });

    test('known difference: a body naming its task only as task._id passes where the project rules refuse and the company rules allow, as before', async () => {
        const shape = WEB_APP_SHAPES.find(([name]) => name.startsWith('PATCH updateDescription'))[1];
        const result = await run(requireTaskActionPermission(), patRequest(shape(TASK_IN_OWN_RULES, OWN_RULES_PROJECT)));
        expect(result.passed).toBe(true);
        expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('known difference'));
    });

    test('a second task cannot borrow a more permissive project\'s rules', async () => {
        const body = { action: 'updateAssignee', taskData: { _id: TASK_IN_OWN_RULES }, task: { _id: TASK_IN_GLOBAL }, projectData: project(GLOBAL_PROJECT) };
        expect((await run(requireTaskActionPermission(), patRequest(body))).code).toBe(403);
    });

    test('settings keys never look up a project', async () => {
        mockDb.seed(SCHEMA_TYPE.RULES, { _id: 'settings-parent', key: 'settings', name: 'settings', isParent: true, roles: [] });
        mockDb.seed(SCHEMA_TYPE.RULES, { key: 'settings_member_list', name: 'settings_member_list', isParent: false, parentId: 'settings-parent', roles: [{ key: 3, permission: true }] });
        const result = await run(requirePermission('settings.settings_member_list'), patRequest({ projectId: OWN_RULES_PROJECT, taskData: { _id: TASK_IN_OWN_RULES } }));
        expect(result.passed).toBe(true);
        expect(mockDb.calls.some((call) => call.type === SCHEMA_TYPE.TASKS || call.type === SCHEMA_TYPE.PROJECTS)).toBe(false);
    });
});
