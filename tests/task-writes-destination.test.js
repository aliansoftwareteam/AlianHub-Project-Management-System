const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { prepareTaskRequest, TASK_ACTION_FIELDS, TaskWriteRefusal } = require('../Modules/Tasks/helpers/taskWriteFields');

const C = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000001';
const MEMBER = '6f0000000000000000000003';
const INSIDER = '6f0000000000000000000004';
const OPEN = '6f0000000000000000000a01';
const OTHER = '6f0000000000000000000a02';
const PRIVATE = '6f0000000000000000000a03';
const PERSONAL = '6f0000000000000000000a04';
const CHAT_SPACE = '6f0000000000000000000a09';
const L_OPEN = '6f0000000000000000000b01';
const L_OPEN_2 = '6f0000000000000000000b02';
const L_OPEN_CLOSED = '6f0000000000000000000b03';
const L_OTHER = '6f0000000000000000000b04';
const L_PRIVATE = '6f0000000000000000000b05';
const L_PERSONAL = '6f0000000000000000000b06';
const L_CHAT = '6f0000000000000000000b09';
const FOLDER = '6f0000000000000000000f01';
const T_OPEN = '6f0000000000000000000d01';
const T_PRIVATE = '6f0000000000000000000d02';
const T_CLOSED_LIST = '6f0000000000000000000d03';
const T_OPEN_CHILD = '6f0000000000000000000d04';

const request = (uid, action, body) => ({ uid, aud: C, headers: { companyid: C }, body: { action, ...body } });

/* What the route's preparation hands the handler, or the refusal it answers with. */
const prepare = async (uid, action, body) => {
    try {
        return { payload: (await prepareTaskRequest(request(uid, action, body), TASK_ACTION_FIELDS[action], action)).payload };
    } catch (error) {
        if (error instanceof TaskWriteRefusal) return { refused: error.statusCode, message: error.message };
        throw error;
    }
};

const move = (uid, projectId, listId, extra = {}) => prepare(uid, 'moveTask', {
    companyId: C,
    moveTaskId: T_OPEN,
    projectData: { id: projectId, ProjectCode: 'ZZZ', ProjectName: 'As sent' },
    sprintObj: { id: listId, name: 'As sent', folderId: FOLDER, folderName: 'As sent' },
    oldSprintObj: { id: L_OPEN, name: 'First list' },
    oldProject: { ProjectName: 'As sent', taskStatusData: [], taskTypeCounts: [] },
    isSubTask: false,
    assignee: [MEMBER],
    watcher: [],
    ...extra,
});

/* The move dialog's mapping: the open task is in status 1 and its subtask in status 2, both of type task. */
const mapping = (status, type, statusOfSubtask = status) => ({
    ProjectName: 'As sent',
    taskStatusData: [{ key: 1, name: 'To do', convertStatus: status }, ...(statusOfSubtask ? [{ key: 2, name: 'Done', convertStatus: statusOfSubtask }] : [])],
    taskTypeCounts: [{ value: 'task', convertType: type }],
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((key) => { mockDb.store[key].length = 0; });
    myCache.flushAll();
    [[OWNER, 1, 'Olive'], [MEMBER, 3, 'Mia'], [INSIDER, 3, 'Ian']].forEach(([userId, roleType, Employee_Name]) => {
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false });
        mockDb.seed(SCHEMA_TYPE.USERS, { _id: userId, Employee_Name });
    });
    const taskRules = mockDb.seed(SCHEMA_TYPE.RULES, { key: 'task', name: 'Task', isParent: true, roles: [] });
    mockDb.seed(SCHEMA_TYPE.RULES, { key: 'task_list', name: 'Task List', isParent: false, parentId: String(taskRules._id), roles: [{ key: 3, permission: true }] });
    const project = (_id, ProjectName, extra = {}) => mockDb.seed(SCHEMA_TYPE.PROJECTS, {
        _id, ProjectName, ProjectCode: ProjectName.slice(0, 3).toUpperCase(), isPrivateSpace: false, AssigneeUserId: [], deletedStatusKey: 0, ...extra,
    });
    project(OPEN, 'Open', {
        taskStatusData: [{ key: 1, name: 'To do', type: 'default_active' }, { key: 2, name: 'Done', type: 'close' }],
        taskTypeCounts: [{ key: 1, value: 'task', name: 'Task' }],
    });
    project(OTHER, 'Other', {
        taskStatusData: [{ key: 7, name: 'Backlog', type: 'default_active' }],
        taskTypeCounts: [{ key: 3, value: 'bug', name: 'Bug' }],
    });
    project(PRIVATE, 'Private', {
        isPrivateSpace: true,
        AssigneeUserId: [OWNER, INSIDER],
        taskStatusData: [{ key: 1, name: 'To do', type: 'default_active' }],
        taskTypeCounts: [{ key: 1, value: 'task', name: 'Task' }],
    });
    project(PERSONAL, 'Personal', { isPrivateSpace: true, isPersonal: true, personalOwner: OWNER, AssigneeUserId: [OWNER] });
    mockDb.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: CHAT_SPACE, default: true });
    mockDb.seed(SCHEMA_TYPE.FOLDERS, { _id: FOLDER, name: 'Releases', projectId: OTHER });
    const list = (_id, name, projectId, extra = {}) => mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id, name, projectId, deletedStatusKey: 0, ...extra });
    list(L_OPEN, 'First list', OPEN);
    list(L_OPEN_2, 'Second list', OPEN);
    list(L_OPEN_CLOSED, 'Closed list', OPEN, { private: true, AssigneeUserId: [OWNER] });
    list(L_OTHER, 'Other list', OTHER, { folderId: FOLDER });
    list(L_PRIVATE, 'Private list', PRIVATE);
    list(L_PERSONAL, 'Personal list', PERSONAL);
    list(L_CHAT, 'Direct', CHAT_SPACE);
    const task = (_id, TaskName, ProjectID, sprintId, extra = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, {
        _id, TaskName, ProjectID, sprintId, CompanyId: C, statusKey: 1, TaskType: 'task', isParentTask: true, AssigneeUserId: [MEMBER], watchers: [], deletedStatusKey: 0, ...extra,
    });
    task(T_OPEN, 'Open task', OPEN, L_OPEN);
    task(T_OPEN_CHILD, 'Open subtask', OPEN, L_OPEN, { isParentTask: false, ParentTaskId: T_OPEN, ancestors: [T_OPEN], statusKey: 2 });
    task(T_PRIVATE, 'Private task', PRIVATE, L_PRIVATE, { AssigneeUserId: [INSIDER] });
    task(T_CLOSED_LIST, 'Task on a closed list', OPEN, L_OPEN_CLOSED, { AssigneeUserId: [OWNER] });
});

describe('where a move lands', () => {
    it.each([
        ['a project the caller cannot open', PRIVATE, L_PRIVATE],
        ['another person\'s personal list', PERSONAL, L_PERSONAL],
        ['a list of another project', OPEN, L_OTHER],
        ['a list the caller is not on', OPEN, L_OPEN_CLOSED],
        ['a list that does not exist', OPEN, '6f0000000000000000000bff'],
    ])('is not %s', async (label, projectId, listId) => {
        expect((await move(MEMBER, projectId, listId)).refused).toBe(404);
    });

    it('is a list of the project, written as the stored list and project name it', async () => {
        const { payload } = await move(MEMBER, OPEN, L_OPEN_2);

        expect(payload.sprintObj).toEqual({ id: L_OPEN_2, name: 'Second list' });
        expect(payload.projectData).toMatchObject({ id: OPEN, ProjectCode: 'OPE', ProjectName: 'Open' });
        expect(payload.oldProject.ProjectName).toBe('Open');
    });

    it('carries the folder the stored list sits in', async () => {
        const { payload } = await move(MEMBER, OTHER, L_OTHER, { oldProject: mapping({ key: 7 }, { value: 'bug' }) });

        expect(payload.sprintObj).toEqual({ id: L_OTHER, name: 'Other list', folderId: FOLDER, folderName: 'Releases' });
    });

    it('lets an owner move into a private project', async () => {
        const { payload } = await move(OWNER, PRIVATE, L_PRIVATE, { moveTaskId: T_PRIVATE, assignee: [INSIDER] });

        expect(payload.projectData.id).toBe(PRIVATE);
    });
});

describe('the status and type a move into another project maps to', () => {
    it('are read from the project it moves to', async () => {
        const sent = mapping({ key: 7, name: 'As sent', type: 'close' }, { value: 'bug', key: 999 });

        const { payload } = await move(MEMBER, OTHER, L_OTHER, { oldProject: sent });

        expect(payload.oldProject.taskStatusData[0]).toEqual({ key: 1, convertStatus: { key: 7, name: 'Backlog', type: 'default_active' } });
        expect(payload.oldProject.taskTypeCounts).toEqual([{ value: 'task', convertType: { value: 'bug', key: 3 } }]);
        expect(payload.oldProject).toMatchObject({ id: OPEN, ProjectName: 'Open' });
    });

    it.each([
        ['a status the project does not have', mapping({ key: 99, name: 'Invented', type: 'close' }, { value: 'bug' })],
        ['a task type the project does not have', mapping({ key: 7 }, { value: 'invented', key: 1 })],
        ['no status for a subtask that moves along', mapping({ key: 7 }, { value: 'bug' }, null)],
        ['nothing', { taskStatusData: [], taskTypeCounts: [] }],
    ])('refuse %s', async (label, oldProject) => {
        const out = await move(MEMBER, OTHER, L_OTHER, { oldProject });

        expect(out.refused).toBe(400);
    });
});

describe('where a copy or a conversion lands', () => {
    const into = (projectId, listId) => ({ companyId: C, projectData: { id: projectId }, sprintObj: { id: listId, name: 'As sent' } });

    it.each([
        ['duplicateTask', { selectedTaskId: T_OPEN }],
        ['convertToTask', { taskId: T_OPEN_CHILD, parentTaskId: T_OPEN }],
        ['bulkMove', { taskIds: [T_OPEN] }],
        ['bulkConvertToTask', { taskIds: [T_OPEN_CHILD] }],
        ['bulkDuplicate', { taskIds: [T_OPEN] }],
    ])('%s is refused a project the caller cannot open and a list of another project', async (action, body) => {
        expect((await prepare(MEMBER, action, { ...body, ...into(PRIVATE, L_PRIVATE) })).refused).toBe(404);
        expect((await prepare(MEMBER, action, { ...body, ...into(OPEN, L_OTHER) })).refused).toBe(404);
        expect((await prepare(MEMBER, action, { ...body, ...into(OPEN, L_OPEN_2) })).payload.sprintObj).toEqual({ id: L_OPEN_2, name: 'Second list' });
    });

    it('convertToList is refused a project the caller cannot open', async () => {
        expect((await prepare(MEMBER, 'convertToList', { companyId: C, taskId: T_OPEN, projectData: { id: PRIVATE } })).refused).toBe(404);
    });
});

describe('where a new task lands', () => {
    const create = (uid, data) => prepareTaskRequest(
        { uid, aud: C, headers: { companyid: C }, body: { data: { TaskName: 'New', CompanyId: C, AssigneeUserId: [], ...data }, user: {}, projectData: { _id: data.ProjectID, CompanyId: C, ProjectCode: 'ZZZ' }, indexObj: {} } },
        TASK_ACTION_FIELDS.create,
        'create',
    ).then(({ payload }) => ({ payload }), (error) => {
        if (error instanceof TaskWriteRefusal) return { refused: error.statusCode };
        throw error;
    });

    it.each([
        ['a project the caller cannot open', { ProjectID: PRIVATE, sprintId: L_PRIVATE }],
        ['another person\'s personal list', { ProjectID: PERSONAL, sprintId: L_PERSONAL }],
        ['a list of another project', { ProjectID: OPEN, sprintId: L_OTHER }],
        ['a list the caller is not on', { ProjectID: OPEN, sprintId: L_OPEN_CLOSED }],
        ['a project named as a conversation', { ProjectID: PRIVATE, sprintId: L_PRIVATE, mainChat: true }],
    ])('is not %s', async (label, data) => {
        expect((await create(MEMBER, data)).refused).toBe(404);
    });

    it('is a list of a project the caller can open, under the project\'s own code', async () => {
        const { payload } = await create(MEMBER, { ProjectID: OPEN, sprintId: L_OPEN });

        expect(payload.data).toMatchObject({ ProjectID: OPEN, sprintId: L_OPEN });
        expect(payload.projectData).toMatchObject({ _id: OPEN, ProjectCode: 'OPE', ProjectName: 'Open' });
    });

    it('is a chat space for a conversation, in a list of that space', async () => {
        const { payload } = await create(MEMBER, { ProjectID: CHAT_SPACE, sprintId: L_CHAT, mainChat: true, AssigneeUserId: [MEMBER, INSIDER] });

        expect(payload.data).toMatchObject({ ProjectID: CHAT_SPACE, sprintId: L_CHAT });
        expect((await create(MEMBER, { ProjectID: CHAT_SPACE, sprintId: L_OPEN, mainChat: true, AssigneeUserId: [MEMBER, INSIDER] })).refused).toBe(404);
    });

    it('is not a project for a conversation, which is started in a chat space', async () => {
        expect((await create(MEMBER, { ProjectID: OPEN, sprintId: L_OPEN, mainChat: true, AssigneeUserId: [MEMBER, INSIDER] })).refused).toBe(400);
        expect((await create(OWNER, { ProjectID: PRIVATE, sprintId: L_PRIVATE, mainChat: true, AssigneeUserId: [OWNER] })).refused).toBe(400);
    });

    it.each(['true', 1, 'yes'])('is not a project for a row marked a conversation by %p either, which is stored as one', async (mark) => {
        expect((await create(MEMBER, { ProjectID: OPEN, sprintId: L_OPEN, mainChat: mark })).refused).toBe(400);
    });

    it('is a project for a task that says it is no conversation', async () => {
        expect((await create(MEMBER, { ProjectID: OPEN, sprintId: L_OPEN, mainChat: false })).payload.data.ProjectID).toBe(OPEN);
    });
});

describe('the people a task write names', () => {
    const assign = (uid, taskId, id, type = 'assigneeAdd') => prepare(uid, 'updateAssignee', {
        firebaseObj: { AssigneeUserId: id }, projectData: {}, taskData: { _id: taskId }, employeeName: 'x', type, isUpdateTask: true,
    });

    it('can open the task\'s project', async () => {
        expect(await assign(INSIDER, T_PRIVATE, MEMBER)).toMatchObject({ refused: 400, message: expect.stringMatching(/cannot open this project/) });
        expect((await assign(INSIDER, T_PRIVATE, OWNER)).payload).toBeDefined();
        expect((await assign(MEMBER, T_OPEN, INSIDER)).payload).toBeDefined();
    });

    it('can open it as a watcher too', async () => {
        const watch = (userId) => prepare(INSIDER, 'updateWatcher', { companyId: C, taskId: T_PRIVATE, userId, add: true, employeeName: 'x' });

        expect((await watch(MEMBER)).refused).toBe(400);
        expect((await watch(OWNER)).payload).toBeDefined();
    });

    it('can open every project a bulk assignment reaches', async () => {
        const assignMany = (employeeId) => prepare(OWNER, 'bulkUpdateAssignee', { companyId: C, taskIds: [T_OPEN, T_PRIVATE], employeeName: 'x', employeeId, type: 'assigneeAdd' });

        expect((await assignMany([MEMBER])).refused).toBe(400);
        expect((await assignMany([INSIDER])).payload.taskIds).toEqual([T_OPEN, T_PRIVATE]);
    });

    it('stay on a task that moves only where they can open the project it moves to', async () => {
        const oldProject = mapping({ key: 1 }, { value: 'task' });

        const { payload } = await move(OWNER, PRIVATE, L_PRIVATE, { assignee: [MEMBER, INSIDER], oldProject });

        expect(payload.assignee).toEqual([INSIDER]);
        expect((await move(OWNER, PRIVATE, L_PRIVATE, { watcher: [MEMBER], oldProject })).refused).toBe(400);
    });
});

describe('the tasks a write reaches', () => {
    it('a bulk action keeps to the tasks the caller can read', async () => {
        const all = [T_OPEN, T_PRIVATE, T_CLOSED_LIST];
        const bulk = (uid) => prepare(uid, 'bulkUpdateStatus', { companyId: C, taskIds: all, newStatus: { status: { text: 'Done' }, statusKey: 2, statusType: 'close' } });

        expect((await bulk(MEMBER)).payload.taskIds).toEqual([T_OPEN]);
        expect((await bulk(OWNER)).payload.taskIds).toEqual(all);
    });

    it('a bulk date change keeps to the same tasks', async () => {
        const dates = [T_OPEN, T_PRIVATE].map((taskId) => ({ taskId, DueDate: '2026-10-10' }));

        expect((await prepare(MEMBER, 'bulkUpdateDates', { companyId: C, dates })).payload.dates).toEqual([dates[0]]);
    });

    it.each([
        ['a parent for many tasks', 'bulkConvertToSubTask', { taskIds: [T_OPEN], parentTaskId: T_PRIVATE }],
        ['a parent for one task', 'convertToSubTask', { selectedTaskId: T_OPEN, taskId: T_PRIVATE, projectData: {} }],
        ['a task to merge with', 'mergeTask', { taskId: T_OPEN, mergeTaskId: T_PRIVATE, projectData: {} }],
        ['a task to relate to', 'addTaskRelation', { taskId: T_OPEN, relatedTaskId: T_PRIVATE, type: 'blocks' }],
    ])('%s is one the caller can read', async (label, action, body) => {
        expect((await prepare(MEMBER, action, { companyId: C, ...body })).refused).toBe(404);
    });

    it('a task on a list the caller is not on answers as if it did not exist', async () => {
        const rename = (uid) => prepare(uid, 'updateTaskName', { firebaseObj: { TaskName: 'Renamed' }, projectData: {}, taskData: { _id: T_CLOSED_LIST }, obj: {} });

        expect((await rename(MEMBER)).refused).toBe(404);
        expect((await rename(OWNER)).payload).toBeDefined();
    });
});
