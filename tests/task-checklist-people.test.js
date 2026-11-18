const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { NOT_A_MEMBER } = require('../Config/companyMembers');
const { CANNOT_OPEN_PROJECT } = require('../Config/projectPeople');
const { prepareTaskRequest, TASK_ACTION_FIELDS, TaskWriteRefusal } = require('../Modules/Tasks/helpers/taskWriteFields');

const C = '6f0000000000000000000c01';
const CALLER = '6f0000000000000000000001';
const ON_PROJECT = '6f0000000000000000000002';
const NOT_ON_PROJECT = '6f0000000000000000000003';
const LEFT = '6f0000000000000000000004';
const NOBODY = '6f0000000000000000000009';
const PROJECT = '6f0000000000000000000a01';
const LIST = '6f0000000000000000000b01';
const TASK = '6f0000000000000000000d01';

const prepare = async (action, body) => {
    try {
        await prepareTaskRequest({ uid: CALLER, aud: C, headers: { companyid: C }, body: { action, ...body } }, TASK_ACTION_FIELDS[action], action);
        return { refused: null };
    } catch (error) {
        if (error instanceof TaskWriteRefusal) return { refused: error.statusCode, message: error.message };
        throw error;
    }
};

const row = (id, people) => ({ id, name: 'Step', isChecked: false, AssigneeUserId: people });
const onTask = (operation, extra) => prepare('updateChecklists', { companyId: C, projectId: PROJECT, sprintId: LIST, taskId: TASK, operation, ...extra });

const WRITES = (named) => [
    ['a row is given to them', () => onTask('checklistassignee', { historyObj: { type: 'add', updateCheckListId: 'row-1', assigneeId: named } })],
    ['a new row names them', () => onTask('taskchecklistcreate', { data: row('row-2', [named]) })],
    ['new rows name them', () => onTask('checklistadd', { data: [row('row-2', []), row('row-3', [named])] })],
    ['the whole checklist is written with them on a row', () => onTask('checklistchecked', { data: [row('row-1', [LEFT, named])] })],
    ['a drafted checklist names them', () => prepare('AddAiChecklist', { companyId: C, projectId: PROJECT, sprintId: LIST, taskId: TASK, checklistArray: [row('row-4', [named])] })],
];

beforeEach(() => {
    Object.keys(mockDb.store).forEach((key) => { mockDb.store[key].length = 0; });
    myCache.flushAll();
    [[CALLER, false], [ON_PROJECT, false], [NOT_ON_PROJECT, false], [LEFT, true]].forEach(([userId, isDelete]) => {
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType: 3, status: 2, isDelete });
        mockDb.seed(SCHEMA_TYPE.USERS, { _id: userId, Employee_Name: `Person ${userId.slice(-1)}` });
    });
    const taskRules = mockDb.seed(SCHEMA_TYPE.RULES, { key: 'task', name: 'Task', isParent: true, roles: [] });
    mockDb.seed(SCHEMA_TYPE.RULES, { key: 'task_list', name: 'Task List', isParent: false, parentId: String(taskRules._id), roles: [{ key: 3, permission: true }] });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT, ProjectName: 'Board', isPrivateSpace: true, AssigneeUserId: [CALLER, ON_PROJECT, LEFT] });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: LIST, projectId: PROJECT, name: 'List', private: false, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: TASK, ProjectID: PROJECT, sprintId: LIST, TaskName: 'Lease', AssigneeUserId: [], checklistArray: [row('row-1', [LEFT])] });
});

describe('the people on a task\'s checklist', () => {
    it.each(WRITES(ON_PROJECT))('can be a member who opens the project, when %s', async (_label, write) => {
        expect(await write()).toEqual({ refused: null });
    });

    it.each(WRITES(NOBODY))('cannot be someone of no workspace, when %s', async (_label, write) => {
        expect(await write()).toEqual({ refused: 400, message: NOT_A_MEMBER });
    });

    it.each(WRITES(NOT_ON_PROJECT))('cannot be a member who cannot open the project, when %s', async (_label, write) => {
        expect(await write()).toEqual({ refused: 400, message: CANNOT_OPEN_PROJECT });
    });

    it('keeps someone a row already names, so the row can be ticked and they can be taken off', async () => {
        expect(await onTask('checklistchecked', { data: [{ ...row('row-1', [LEFT]), isChecked: true }] })).toEqual({ refused: null });
        expect(await onTask('assigneeremove', { historyObj: { type: 'remove', updateCheckListId: 'row-1', assigneeId: LEFT } })).toEqual({ refused: null });
    });

    it('is checked on a new task\'s checklist too', async () => {
        const data = { TaskName: 'New', ProjectID: PROJECT, sprintId: LIST, AssigneeUserId: [], watchers: [], Task_Leader: CALLER, checklistArray: [row('row-1', [NOT_ON_PROJECT])] };
        expect(TASK_ACTION_FIELDS.create.people({ data })).toEqual([CALLER, NOT_ON_PROJECT]);
    });
});
