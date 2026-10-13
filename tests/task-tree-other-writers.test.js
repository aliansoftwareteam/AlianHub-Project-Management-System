/* Task 046 M2, slice N2: the writers that make a subtask without the web app's create (the
   automation and agent createSubtask, task templates, the AI project generator, sample tasks) store
   the same chain and placement the create path stores. */
const mongoose = require('mongoose');

const mockDb = require('./fixtures/fakeMongo').create();

const mockInserted = [];
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: async (companyId, query, method) => {
        if (method === 'insertMany') { mockInserted.push({ type: query.type, data: query.data }); return query.data[0]; }
        return mockDb.crud(companyId, query, method);
    },
}));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/taskMongo/internals.js', () => ({ updateTaskKey: jest.fn(async () => undefined) }));
jest.mock('../Modules/Sprints/controller', () => ({ addSprintFun: jest.fn() }));
jest.mock('../Modules/createProject/sampleProject', () => ({ loadUserData: jest.fn(async () => ({})) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const tools = require('../Modules/Automations/engine/tools');
const templateRules = require('../Modules/TaskTemplates/templateRules');
const { buildTaskDocs, demoTasksForFocus } = require('../utils/sampleTasks');
const { driverWrites } = require('./fixtures/realTaskStore');

const C = '6f0000000000000000000c01';
const PROJECT = '6f0000000000000000000a01';
const OWNER = '6f0000000000000000000d01';
const SPRINT = '6f0000000000000000000501';
const OTHER_SPRINT = '6f0000000000000000000502';
const FOLDER = '6f0000000000000000000401';
const ROOT = '6f0000000000000000000b11';
const CHILD = '6f0000000000000000000b12';
const GRANDCHILD = '6f0000000000000000000b13';
const oid = (id) => new mongoose.Types.ObjectId(id);

const project = {
    _id: oid(PROJECT), CompanyId: C, ProjectName: 'Launch', ProjectCode: 'LN', userId: OWNER, lastTaskId: 0,
    taskTypeCounts: [{ name: 'Task', key: 1, value: 'task' }],
    taskStatusData: [{ name: 'To Do', key: 1, type: 'default_active' }, { name: 'Complete', key: 2, type: 'close' }],
};
const ROOT_ELEMENT = { id: oid(SPRINT), name: 'Sprint 7', folderId: oid(FOLDER), folderName: 'Q4' };
const taskRow = (_id, extra = {}) => ({
    _id: oid(_id), TaskName: `Task ${_id.slice(-2)}`, TaskKey: `LN-${_id.slice(-2)}`, TaskType: 'task', TaskTypeKey: 1, ProjectID: oid(PROJECT), CompanyId: oid(C),
    status: { key: 1, text: 'To Do', type: 'default_active' }, statusType: 'default_active', statusKey: 1, isParentTask: true, ParentTaskId: '',
    Task_Leader: OWNER, Task_Priority: 'MEDIUM', deletedStatusKey: 0, sprintId: oid(SPRINT), sprintArray: { ...ROOT_ELEMENT }, folderObjId: oid(FOLDER), subTasks: 0, ...extra,
});

const tasks = () => mockDb.store[SCHEMA_TYPE.TASKS];
const stored = (id) => tasks().find((t) => String(t._id) === String(id));
const underRealSchema = async (doc) => {
    const { writes, error } = await driverWrites('save', doc);
    expect(error).toBeNull();
    return writes[0].args[0];
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    mockInserted.length = 0;
    jest.clearAllMocks();
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { ...project });
    mockDb.seed(SCHEMA_TYPE.TASKS, taskRow(ROOT, { subTasks: 1 }));
    /* A subtask an older writer left in another sprint and outside the folder: its own placement must not be copied. */
    mockDb.seed(SCHEMA_TYPE.TASKS, taskRow(CHILD, { isParentTask: false, ParentTaskId: ROOT, ancestors: [ROOT], sprintId: oid(OTHER_SPRINT), sprintArray: { id: oid(OTHER_SPRINT), name: 'Backlog' }, folderObjId: undefined, subTasks: 1 }));
    mockDb.seed(SCHEMA_TYPE.TASKS, taskRow(GRANDCHILD, { isParentTask: false, ParentTaskId: CHILD, ancestors: [ROOT, CHILD] }));
});

describe('the automation and agent createSubtask', () => {
    test('under a task: stores the chain and the folder of the root', async () => {
        const result = await tools.createSubtask(C, ROOT, { title: 'Check the copy' });

        const row = await underRealSchema(mockDb.calls.find((c) => c.method === 'save').data);
        expect(String(row._id)).toBe(result.subtaskId);
        expect(row.ancestors).toEqual([ROOT]);
        expect(row.isParentTask).toBe(false);
        expect([String(row.ProjectID), String(row.sprintId), String(row.folderObjId)]).toEqual([PROJECT, SPRINT, FOLDER]);
        expect(row.sprintArray).toEqual(ROOT_ELEMENT);
        expect(stored(ROOT).subTasks).toBe(2);
    });

    test('under a subtask: allowed, with a chain of two and the placement of the root', async () => {
        const result = await tools.createSubtask(C, CHILD, { title: 'Check the links' });

        const row = await underRealSchema(mockDb.calls.find((c) => c.method === 'save').data);
        expect(result.changed).toBe(true);
        expect(row.ParentTaskId).toBe(CHILD);
        expect(row.ancestors).toEqual([ROOT, CHILD]);
        expect([String(row.sprintId), String(row.folderObjId), String(row.sprintArray.id)]).toEqual([SPRINT, FOLDER, SPRINT]);
        expect(stored(CHILD).subTasks).toBe(2);
        expect(stored(ROOT).subTasks).toBe(1);
    });

    test('under a level-three subtask: a deterministic error with the reason, and nothing is written', async () => {
        const refused = await tools.createSubtask(C, GRANDCHILD, { title: 'One level too many' }).catch((error) => error);

        expect(refused).toBeInstanceOf(tools.DeterministicError);
        expect(refused.deterministic).toBe(true);
        expect(refused.message).toMatch(/three levels/);
        expect(mockDb.calls.filter((c) => c.method === 'save')).toEqual([]);
        expect(stored(GRANDCHILD).subTasks).toBe(0);
    });
});

describe('a task template subtask', () => {
    const sub = { title: 'Write changelog', dueDate: null, startDate: null, assigneeIds: [] };

    test('carries the chain of the task it is added to', () => {
        const under = (parent) => templateRules.subtaskData({ sub, parent, project, companyId: C, actorId: OWNER, assignees: [] });

        expect(under(stored(ROOT))).toMatchObject({ ParentTaskId: ROOT, isParentTask: false, ancestors: [ROOT] });
        expect(under(stored(CHILD))).toMatchObject({ ParentTaskId: CHILD, isParentTask: false, ancestors: [ROOT, CHILD] });
    });
});

describe('sample tasks', () => {
    const placement = { sprintId: SPRINT, sprintArray: { id: SPRINT, name: 'Sprint 7' } };

    test('a sample subtask stores its parent as its chain, and a sample task an empty one', () => {
        const { docs } = buildTaskDocs(project, [placement], demoTasksForFocus('marketing'), 0, OWNER);
        const kids = docs.filter((d) => d.isParentTask === false);

        expect(kids.length).toBeGreaterThan(0);
        kids.forEach((kid) => {
            const parent = docs.find((d) => String(d._id) === kid.ParentTaskId);
            expect(kid.ancestors).toEqual([...parent.ancestors, kid.ParentTaskId]);
        });
        docs.filter((d) => d.isParentTask).forEach((doc) => expect(doc.ancestors).toEqual([]));
    });
});

describe('the AI project generator', () => {
    test('a generated subtask stores its parent as its chain', async () => {
        const { createTasksForSprint } = require('../Modules/AIProjectGenerator/orchestrator');
        const sprintDoc = { _id: oid(SPRINT), name: 'Sprint 7' };

        await createTasksForSprint({
            companyId: C, projectDoc: project, sprintDoc, creatorUid: OWNER, statusByName: new Map(), taskTypeByKey: new Map(),
            tasks: [{ TaskName: 'Plan the launch', subtasks: [{ TaskName: 'Book the venue' }, { TaskName: 'Send invitations' }] }],
        });

        const docs = mockInserted.filter((c) => c.type === SCHEMA_TYPE.TASKS).flatMap((c) => c.data[0]);
        const parent = docs.find((d) => d.isParentTask);
        const kids = docs.filter((d) => !d.isParentTask);
        expect(kids).toHaveLength(2);
        expect(parent.ancestors).toEqual([]);
        for (const kid of kids) {
            expect(kid.ancestors).toEqual([String(parent._id)]);
            expect((await underRealSchema(kid)).ancestors).toEqual([String(parent._id)]);
        }
    });
});
