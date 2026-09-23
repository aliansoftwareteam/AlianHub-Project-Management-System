const mockDb = require('./fixtures/fakeMongo').create({ mongooseCasting: true });

// Mongoose treats an update without operators as a $set; fakeMongo only applies operators.
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => {
        const [filter, update, ...rest] = Array.isArray(q.data) ? q.data : [];
        const plain = method === 'findOneAndUpdate' && update && !Object.keys(update).some((k) => k.startsWith('$'));
        return mockDb.crud(companyId, plain ? { ...q, data: [filter, { $set: update }, ...rest] } : q, method);
    },
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
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
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => mockStub());
process.env.STORAGE_TYPE = 'server';

const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const { HandleBothNotification } = require('../Modules/Tasks/helpers/handleNotification');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const templates = require('../Modules/Tasks/helpers/notificationTemplate');
const { CID, OWNER, MEMBER, OPEN_PROJECT, OPEN_TASK, OPEN_TASK_2 } = require('./fixtures/taskWriteGuard');

mongoHelper.getTotalSprintCount = async () => true;

const SPRINT = '6f0000000000000000000e01';
const HTML = '<img src=x onerror=alert(1)>';
const CLIENT_MESSAGE = `<p>${HTML} due</p>`;
const PREV = '2026-09-15T00:00:00.000Z';
const DUE = '2026-10-01T00:00:00.000Z';
const IST_MIDNIGHT = '2026-09-30T18:30:00.000Z';

const settle = async () => { for (let i = 0; i < 40; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const clone = (value) => JSON.parse(JSON.stringify(value));

const routesOf = (modulePath) => {
    const table = {};
    const register = (method) => (routePath, ...handlers) => { table[`${method} ${routePath}`] = handlers[handlers.length - 1]; };
    const app = { get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') };
    require(modulePath).init(app);
    return table;
};
const ROUTES = routesOf('../Modules/Tasks/routes');
const PATCH = 'PATCH /api/v2/tasks';
const BULK = 'POST /api/v2/tasks/bulk';

const call = (route, body) => new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ code: 'no answer' }), 1500);
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (answer) => { clearTimeout(timer); resolve({ code: res.statusCode, body: answer }); return res; };
    res.json = res.send;
    const [method, path] = route.split(' ');
    const req = { method, path, originalUrl: path, headers: { companyid: CID }, aud: CID, uid: OWNER, body };
    ROUTES[route](req, res, () => { clearTimeout(timer); resolve({ code: 'next' }); });
}).then(async (result) => { await settle(); return result; });

const taskDoc = (_id, extra = {}) => ({
    _id,
    TaskName: `Task ${_id.slice(-2)}`,
    TaskKey: `PAR-${_id.slice(-1)}`,
    ProjectID: OPEN_PROJECT,
    CompanyId: CID,
    sprintId: SPRINT,
    sprintArray: { id: SPRINT, name: 'Sprint 1', folderName: '' },
    status: { key: 1, text: 'To Do', type: 'default_active' },
    statusKey: 1,
    statusType: 'default_active',
    TaskType: 'task',
    TaskTypeKey: 1,
    Task_Priority: 'MEDIUM',
    Task_Leader: OWNER,
    isParentTask: true,
    ParentTaskId: '',
    deletedStatusKey: 0,
    AssigneeUserId: [],
    watchers: [],
    attachments: [],
    dueDateDeadLine: [],
    createdBy: OWNER,
    ...extra,
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    HandleBothNotification.mockClear();
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: OPEN_PROJECT, ProjectName: 'Parity', ProjectCode: 'PAR', CompanyId: CID, lastTaskId: 4 });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: OWNER, Employee_Name: 'Olivia Owner' });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.TASKS, taskDoc(OPEN_TASK));
    mockDb.seed(SCHEMA_TYPE.TASKS, taskDoc(OPEN_TASK_2));
});

const hold = (fields, id = OPEN_TASK) => Object.assign(mockDb.store[SCHEMA_TYPE.TASKS].find((task) => task._id === id), fields);
const storedTask = (id = OPEN_TASK) => clone(mockDb.store[SCHEMA_TYPE.TASKS].find((task) => String(task._id) === id));
const historyRows = () => clone(mockDb.store[SCHEMA_TYPE.HISTORY] || []);
const notices = () => HandleBothNotification.mock.calls.map(([args]) => args);
const messages = () => notices().map((sent) => sent.object.message);

const USER = { Employee_Name: 'Max Member', id: MEMBER, companyOwnerId: OWNER };
const clientProject = (extra = {}) => ({ _id: OPEN_PROJECT, CompanyId: CID, lastTaskId: 4, ProjectCode: 'PAR', ...extra });

const dueBody = (extra = {}) => ({
    action: 'updateDueDate',
    commonDateFormatString: 'DD/MM/YYYY',
    timeZone: 'UTC',
    firebaseObj: { DueDate: DUE, dueDateDeadLine: [{ date: DUE }] },
    project: clientProject({ ProjectName: HTML }),
    task: { _id: OPEN_TASK, sprintId: SPRINT, TaskName: HTML },
    obj: { key: 'task_due_date', projectId: OPEN_PROJECT, taskId: OPEN_TASK, sprintId: SPRINT, message: CLIENT_MESSAGE },
    userData: USER,
    isUpdateTask: true,
    ...extra,
});

const startBody = (extra = {}) => ({
    action: 'updateStartDate',
    commonDateFormatString: 'DD/MM/YYYY',
    timeZone: 'UTC',
    firebaseObj: { startDate: DUE },
    project: clientProject({ ProjectName: HTML }),
    task: { _id: OPEN_TASK, sprintId: SPRINT, TaskName: HTML },
    obj: { key: 'task_due_date', projectId: OPEN_PROJECT, taskId: OPEN_TASK, sprintId: SPRINT, message: CLIENT_MESSAGE },
    userData: USER,
    isUpdateTask: true,
    ...extra,
});

const onlyServerText = () => {
    expect(notices()).toHaveLength(1);
    const [sent] = notices();
    expect(sent.object.key).toBe('task_due_date');
    expect(sent.object.message).not.toContain(CLIENT_MESSAGE);
    expect(sent.object.message).not.toContain('<img');
    expect(sent.object.message).not.toContain('&lt;img');
    return sent.object.message;
};

describe('due and start date notifications are built on the server from stored fields', () => {
    test('a due date set on a task that has none says it was added', async () => {
        const result = await call(PATCH, dueBody());
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        expect(storedTask().DueDate).toBe(DUE);
        expect(onlyServerText()).toBe(templates.taskDueDateAdd({ ProjectName: 'Parity', TaskName: 'Task 01', lastDate: '01/10/2026' }));
    });

    test('a due date replacing a stored one names the stored date', async () => {
        hold({ DueDate: new Date(PREV), dueDateDeadLine: [{ date: new Date(PREV) }] });
        const result = await call(PATCH, dueBody({ firebaseObj: { DueDate: DUE, dueDateDeadLine: [{ date: PREV }, { date: DUE }] } }));
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        expect(onlyServerText()).toBe(templates.taskDueDateChange({ ProjectName: 'Parity', TaskName: 'Task 01', previousDate: '15/09/2026', changedDate: '01/10/2026' }));
    });

    test('a history-only due date update is described from the stored task', async () => {
        hold({ DueDate: new Date(DUE), dueDateDeadLine: [{ date: new Date(PREV) }, { date: new Date(DUE) }] });
        const result = await call(PATCH, dueBody({ isUpdateTask: false }));
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        expect(onlyServerText()).toBe(templates.taskDueDateChange({ ProjectName: 'Parity', TaskName: 'Task 01', previousDate: '15/09/2026', changedDate: '01/10/2026' }));
        expect(historyRows().map((row) => row.Key)).toEqual(['Project_DueDate']);
    });

    test('the date is shown in the format and time zone the caller uses', async () => {
        const result = await call(PATCH, dueBody({ timeZone: 'Asia/Kolkata', commonDateFormatString: 'YYYY-MM-DD', firebaseObj: { DueDate: IST_MIDNIGHT, dueDateDeadLine: [{ date: IST_MIDNIGHT }] } }));
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        expect(onlyServerText()).toContain('>2026-10-01</span>');
    });

    test.each([
        ['a format with quoted text', "'<b>'DD"],
        ['a format that is not text', 42],
        ['an unknown time zone', 'DD/MM/YYYY', 'Mars/Olympus'],
    ])('%s falls back to the default', async (_, commonDateFormatString, timeZone = 'UTC') => {
        const result = await call(PATCH, dueBody({ commonDateFormatString, timeZone }));
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        expect(onlyServerText()).toContain('>01/10/2026</span>');
    });

    test('a start date set on a task that has none says it was added', async () => {
        const result = await call(PATCH, startBody());
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        expect(storedTask().startDate).toBe(DUE);
        expect(onlyServerText()).toBe(templates.taskStartDateAdd({ ProjectName: 'Parity', TaskName: 'Task 01', formetedStartDate: '01/10/2026' }));
    });

    test('a start date replacing a stored one names the stored date', async () => {
        hold({ startDate: new Date(PREV) });
        const result = await call(PATCH, startBody());
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        expect(onlyServerText()).toBe(templates.taskStartDateChange({ ProjectName: 'Parity', TaskName: 'Task 01', formetedStartDate: '15/09/2026', newDate: '01/10/2026' }));
    });

    test('a history-only start date update is described from the stored task', async () => {
        hold({ startDate: new Date(DUE) });
        const result = await call(PATCH, startBody({ isUpdateTask: false }));
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        expect(onlyServerText()).toBe(templates.taskStartDateAdd({ ProjectName: 'Parity', TaskName: 'Task 01', formetedStartDate: '01/10/2026' }));
    });

    test('a caller that asks for no notification still gets none', async () => {
        const result = await call(PATCH, dueBody({ obj: {} }));
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        expect(notices()).toEqual([]);
        expect(historyRows()).toHaveLength(1);
    });

    test('a body that names neither the task nor the project still notifies with the stored names', async () => {
        const body = dueBody({ project: clientProject(), task: { _id: OPEN_TASK, sprintId: SPRINT } });
        const result = await call(PATCH, body);
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        expect(onlyServerText()).toBe(templates.taskDueDateAdd({ ProjectName: 'Parity', TaskName: 'Task 01', lastDate: '01/10/2026' }));
    });
});

const START = '2026-09-25T00:00:00.000Z';
const PREV_START = '2026-09-10T00:00:00.000Z';

const moveBody = (extra = {}) => ({
    action: 'updateStartDateAndDueDate',
    commonDateFormatString: 'DD/MM/YYYY',
    timeZone: 'UTC',
    userData: USER,
    notificationObj: { key: 'task_due_date', projectId: OPEN_PROJECT, taskId: OPEN_TASK, sprintId: SPRINT, message: CLIENT_MESSAGE },
    firebaseObj: { DueDate: DUE, dueDateDeadLine: [{ date: DUE }], startDate: START },
    task: { _id: OPEN_TASK, sprintId: SPRINT, sprintArray: { id: SPRINT }, TaskName: HTML },
    project: clientProject({ ProjectName: HTML }),
    ...extra,
});

describe('a task moved on the calendar is described on the server from stored fields', () => {
    test('both dates set on a task that has neither are named, and the client message is ignored', async () => {
        const result = await call(PATCH, moveBody());
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        expect(storedTask()).toMatchObject({ DueDate: DUE, startDate: START, dueDateDeadLine: [{ date: DUE }] });
        expect(onlyServerText()).toBe(templates.taskStartAndDueDateChange({ ProjectName: 'Parity', TaskName: 'Task 01', startDate: '25/09/2026', dueDate: '01/10/2026' }));
        expect(historyRows().map((row) => row.Key)).toEqual(['Project_StartDate_DueDate']);
    });

    test('both dates moved name the stored dates they replace', async () => {
        hold({ startDate: new Date(PREV_START), DueDate: new Date(PREV), dueDateDeadLine: [{ date: new Date(PREV) }] });
        const result = await call(PATCH, moveBody({ firebaseObj: { DueDate: DUE, dueDateDeadLine: [{ date: PREV }, { date: DUE }], startDate: START } }));
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        const message = onlyServerText();
        expect(message).toBe(templates.taskStartAndDueDateChange({ ProjectName: 'Parity', TaskName: 'Task 01', previousStartDate: '10/09/2026', startDate: '25/09/2026', previousDueDate: '15/09/2026', dueDate: '01/10/2026' }));
        expect(message).toMatch(/Start Date of <strong>Task 01<\/strong> is changed from .*10\/09\/2026.* to .*25\/09\/2026.* and Due Date is changed from .*15\/09\/2026.* to .*01\/10\/2026/);
    });

    test('a move that only changes the due date names the due date alone', async () => {
        hold({ startDate: new Date(START), DueDate: new Date(PREV), dueDateDeadLine: [{ date: new Date(PREV) }] });
        const result = await call(PATCH, moveBody({ firebaseObj: { DueDate: DUE, dueDateDeadLine: [{ date: PREV }, { date: DUE }], startDate: START } }));
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        const message = onlyServerText();
        expect(message).toBe(templates.taskDueDateChange({ ProjectName: 'Parity', TaskName: 'Task 01', previousDate: '15/09/2026', changedDate: '01/10/2026' }));
        expect(message).not.toContain('Start Date');
    });

    test('a move that only changes the start date names the start date alone', async () => {
        hold({ startDate: new Date(PREV_START), DueDate: new Date(DUE), dueDateDeadLine: [{ date: new Date(DUE) }] });
        const result = await call(PATCH, moveBody({ firebaseObj: { DueDate: DUE, dueDateDeadLine: [{ date: DUE }, { date: DUE }], startDate: START } }));
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        const message = onlyServerText();
        expect(message).toBe(templates.taskStartDateChange({ ProjectName: 'Parity', TaskName: 'Task 01', formetedStartDate: '10/09/2026', newDate: '25/09/2026' }));
        expect(message).not.toContain('Due Date');
    });

    test('a body without the task or project name still writes the row and names the stored task', async () => {
        const result = await call(PATCH, moveBody({ project: clientProject(), task: { _id: OPEN_TASK, sprintId: SPRINT, sprintArray: { id: SPRINT } } }));
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        expect(historyRows().map((row) => row.Key)).toEqual(['Project_StartDate_DueDate']);
        expect(onlyServerText()).toBe(templates.taskStartAndDueDateChange({ ProjectName: 'Parity', TaskName: 'Task 01', startDate: '25/09/2026', dueDate: '01/10/2026' }));
    });

    test('the dates are shown in the format and time zone the caller uses', async () => {
        const result = await call(PATCH, moveBody({ timeZone: 'Asia/Kolkata', commonDateFormatString: 'YYYY-MM-DD', firebaseObj: { DueDate: IST_MIDNIGHT, dueDateDeadLine: [{ date: IST_MIDNIGHT }], startDate: '2026-09-24T18:30:00.000Z' } }));
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        const message = onlyServerText();
        expect(message).toContain('>2026-09-25</span>');
        expect(message).toContain('>2026-10-01</span>');
    });

    test('a move that changes neither date sends no notification', async () => {
        hold({ startDate: new Date(START), DueDate: new Date(DUE), dueDateDeadLine: [{ date: new Date(DUE) }] });
        const result = await call(PATCH, moveBody({ firebaseObj: { DueDate: DUE, dueDateDeadLine: [{ date: DUE }, { date: DUE }], startDate: START } }));
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        expect(notices()).toEqual([]);
        expect(historyRows()).toHaveLength(1);
    });

    test('a caller that asks for no notification still gets none', async () => {
        const result = await call(PATCH, moveBody({ notificationObj: {} }));
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        expect(notices()).toEqual([]);
        expect(historyRows()).toHaveLength(1);
    });
});

describe('a body without the task name still writes the history row', () => {
    test('an attachment added with a bare taskData', async () => {
        const result = await call(PATCH, { action: 'updateAttachments', companyId: CID, sprintId: SPRINT, taskId: OPEN_TASK, taskData: { _id: OPEN_TASK, sprintId: SPRINT }, operation: 'add', data: { id: 'a1', filename: 'plan.pdf' }, userData: USER, projectData: { id: OPEN_PROJECT } });
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        expect(historyRows().map((row) => row.Message)).toEqual(['<b>Olivia Owner</b> has attached <b>plan.pdf</b> on <b>Task 01</b>.']);
        expect(messages()).toEqual([templates.taskAttachmentAdd({ ProjectName: 'Parity', TaskName: 'Task 01', url: 'plan.pdf' })]);
    });

    test('a total estimate with a bare taskData', async () => {
        const result = await call(PATCH, { action: 'updateTaskTotalEstimate', firebaseObj: { totalEstimatedTime: 90 }, projectData: clientProject(), taskData: { _id: OPEN_TASK, sprintId: SPRINT }, obj: {}, userData: USER });
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        expect(historyRows().map((row) => row.Key)).toEqual(['task_total_estimate']);
        expect(messages()[0]).toContain('<strong>Task 01</strong>');
    });

    test('a rename that does not send the previous name', async () => {
        const result = await call(PATCH, { action: 'updateTaskName', firebaseObj: { TaskName: 'Renamed' }, projectData: clientProject(), taskData: { _id: OPEN_TASK, sprintId: SPRINT }, obj: {}, userData: USER });
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        expect(historyRows().map((row) => row.Message)).toEqual(['<b>Olivia Owner</b> has changed <b> Task name</b> from <b>Task 01</b> to <b>Renamed</b>.']);
        expect(messages()).toEqual([templates.taskNameEdit({ ProjectName: 'Parity', previousTaskName: 'Task 01', TaskName: 'Renamed' })]);
    });

    test('a priority change whose project slice has no name', async () => {
        const result = await call(PATCH, { action: 'updatePriority', firebaseObj: { Task_Priority: 'HIGH' }, projectData: clientProject(), taskData: { _id: OPEN_TASK, sprintId: SPRINT }, priorityObj: { priorityName: 'Medium', newPriorityName: 'High' }, isUpdateTask: true, userData: USER });
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        expect(historyRows().map((row) => row.Key)).toEqual(['task_priority']);
        expect(messages()[0]).toContain('In <strong>Parity</strong> project');
    });

    test.each([
        'createTask', 'taskNameEdit', 'taskTotalEstimate', 'taskStatusChange', 'taskPriorityChange', 'taskTypeChage',
        'taskAssigneeAdd', 'taskAssigneeRemove', 'taskAssigneeReplace', 'taskAttachmentAdd', 'taskAttachmentRemove',
        'taskDueDateAdd', 'taskDueDateChange', 'taskStartDateAdd', 'taskStartDateChange', 'taskStartAndDueDateChange',
    ])('%s renders an empty body instead of throwing', (name) => {
        expect(() => templates[name]({})).not.toThrow();
        expect(templates[name]({})).not.toContain('undefined');
    });
});

describe('display names come from stored rows, and what the request must supply is escaped', () => {
    test('a project name sent with markup is replaced by the stored name', async () => {
        const result = await call(PATCH, { action: 'updatePriority', firebaseObj: { Task_Priority: 'HIGH' }, projectData: clientProject({ ProjectName: HTML }), taskData: { _id: OPEN_TASK, sprintId: SPRINT }, priorityObj: { priorityName: 'Medium', newPriorityName: 'High' }, isUpdateTask: true, userData: USER });
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        expect(messages()).toHaveLength(1);
        expect(messages()[0]).toContain('In <strong>Parity</strong> project');
        expect(messages()[0]).not.toMatch(/img src=x|onerror/);
    });

    test('a file name sent with markup is escaped in the notification', async () => {
        const result = await call(PATCH, { action: 'updateAttachments', companyId: CID, sprintId: SPRINT, taskId: OPEN_TASK, taskData: { _id: OPEN_TASK, sprintId: SPRINT, TaskName: 'Task 01' }, operation: 'add', data: { id: 'a1', filename: HTML }, userData: USER, projectData: { id: OPEN_PROJECT } });
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        expect(messages()).toHaveLength(1);
        expect(messages()[0]).not.toContain('<img');
        expect(messages()[0]).toContain('&lt;img');
    });

    test('a removed attachment is named from the stored task', async () => {
        hold({ attachments: [{ id: 'a1', filename: 'plan.pdf' }] });
        const result = await call(PATCH, { action: 'updateAttachments', companyId: CID, sprintId: SPRINT, taskId: OPEN_TASK, taskData: { _id: OPEN_TASK, sprintId: SPRINT }, operation: 'remove', data: { id: 'a1', filename: HTML }, userData: USER, projectData: { id: OPEN_PROJECT } });
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        expect(storedTask().attachments).toEqual([]);
        expect(historyRows().map((row) => row.Message)).toEqual(['<b>plan.pdf</b> removed from <b>Task 01</b>&apos;s attchments.']);
        expect(messages()).toEqual([templates.taskAttachmentRemove({ ProjectName: 'Parity', TaskName: 'Task 01', removeFileName: 'plan.pdf' })]);
    });

    test('a bulk status change escapes the status name it is sent', async () => {
        const result = await call(BULK, { action: 'bulkUpdateStatus', taskIds: [OPEN_TASK], userData: USER, newStatus: { status: { key: 2, text: HTML, type: 'active' }, statusKey: 2, statusType: 'active' } });
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        expect(messages()).toHaveLength(1);
        expect(messages()[0]).not.toContain('<img');
        expect(messages()[0]).not.toContain('undefined');
    });

    test('a bulk priority change escapes the priority names it is sent', async () => {
        const result = await call(BULK, { action: 'bulkUpdatePriority', taskIds: [OPEN_TASK], userData: USER, firebaseObj: { Task_Priority: 'HIGH' }, priorityObj: { priorityName: 'Medium', newPriorityName: HTML } });
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        expect(messages()).toHaveLength(1);
        expect(messages()[0]).not.toContain('<img src=x');
        expect(messages()[0]).not.toContain('undefined');
    });
});
