const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...a) => mockDb.crud(...a),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjects: jest.fn(), visibleProjectIds: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(),
    isPrivileged: (roleType) => roleType === 1 || roleType === 2,
    evaluatePermission: jest.fn(),
    isWritable: (permission) => permission === true || permission === 1 || permission === 2,
    requireTaskWritePermission: (entry) => Object.assign((req, res, next) => next(), { taskWrites: entry }),
}));
jest.mock('../Modules/Tasks/helpers/task_class_Mongo', () => ({ taskMongo: { create: jest.fn() } }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { visibleProjects } = require('../Modules/Agents/scope');
const { getRoleType, evaluatePermission } = require('../Config/permissionGuard');
const { taskMongo } = require('../Modules/Tasks/helpers/task_class_Mongo');
const { TASK_WRITE_ROUTES } = require('../Config/taskWritePermissions');
const { createTasks, buildTarget, MAX_ITEMS } = require('../Modules/AI/askBuild');

const C = '6f00000000000000000000c1';
const OTHER_C = '6f00000000000000000000c2';
const PROJECT = '6f0000000000000000000a01';
const HIDDEN = '6f0000000000000000000a02';
const LIST = '6f0000000000000000000e01';
const LIST_2 = '6f0000000000000000000e02';
const ME = '6f0000000000000000000001';
const MATE = '6f0000000000000000000002';
const STRANGER = '6f0000000000000000000009';

const STATUSES = [
    { key: 1, name: 'To do', type: 'default_active', value: 'todo' },
    { key: 2, name: 'Done', type: 'close', value: 'done' },
];

const res = () => {
    const r = { statusCode: 200 };
    r.status = (code) => { r.statusCode = code; return r; };
    r.send = (body) => { r.body = body; return r; };
    r.json = r.send;
    return r;
};

const req = (body, over = {}) => ({ headers: { companyid: C }, aud: C, uid: ME, body, params: {}, query: {}, ...over });

const call = async (handler, request) => {
    const out = res();
    await handler(request, out);
    return out;
};

let created = 0;
beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    created = 0;
    getRoleType.mockResolvedValue(3);
    visibleProjects.mockResolvedValue([{ _id: PROJECT, ProjectName: 'Ops' }]);
    evaluatePermission.mockImplementation(async () => true);
    taskMongo.create.mockImplementation(async () => { created += 1; return { status: true, id: `6f0000000000000000000f0${created}` }; });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, {
        _id: PROJECT, ProjectName: 'Ops', ProjectCode: 'OPS', CompanyId: C, lastTaskId: 4, deletedStatusKey: 0, statusType: 'active',
        taskStatusData: STATUSES, taskTypeCounts: [{ key: 1, name: 'Task', value: 'task' }], AssigneeUserId: [ME, MATE, 'tId_team'],
    });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: LIST, projectId: PROJECT, name: 'Backlog', deletedStatusKey: 0, createdAt: new Date('2026-01-01') });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: LIST_2, projectId: PROJECT, name: 'Later', deletedStatusKey: 0, createdAt: new Date('2026-02-01') });
    [ME, MATE, STRANGER].forEach((userId) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, status: 2, roleType: 3 }));
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: ME, Employee_Name: 'Mia Me' });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: MATE, Employee_Name: 'Priya Shah' });
});

const payloads = () => taskMongo.create.mock.calls.map(([payload]) => payload);

describe('Create tasks from an answer goes through the normal create path', () => {
    it('is guarded like POST /api/v2/tasks: task.task_create, the same entry the route table names', () => {
        const spec = TASK_WRITE_ROUTES['POST /api/v1/ai/ask/create-tasks'];
        expect(spec).toBeDefined();
        expect(spec.entry).toMatchObject({ tokenEnforced: true, needs: [{ key: 'task.task_create' }] });
    });

    it('creates each ticked item through taskMongo.create with the prepared create payload', async () => {
        const out = await call(createTasks, req({
            projectId: PROJECT,
            items: [{ title: 'Draft the budget' }, { title: 'Book the venue', dueDate: '2026-10-03T23:59:59.000Z', assigneeId: MATE }],
        }));
        expect(out.statusCode).toBe(200);
        expect(out.body.status).toBe(true);
        expect(out.body.data.created.map((c) => c.title)).toEqual(['Draft the budget', 'Book the venue']);
        expect(taskMongo.create).toHaveBeenCalledTimes(2);
        const [first, second] = payloads();
        expect(first.data).toMatchObject({
            TaskName: 'Draft the budget', ProjectID: PROJECT, CompanyId: C, isParentTask: true, ParentTaskId: '',
            statusKey: 1, statusType: 'default_active', Task_Leader: ME, AssigneeUserId: [], sprintId: LIST, TaskKey: '--',
        });
        expect(first.user).toEqual({ id: ME, Employee_Name: 'Mia Me' });
        expect(first.projectData).toMatchObject({ _id: PROJECT, CompanyId: C, ProjectName: 'Ops', ProjectCode: 'OPS' });
        expect(first.indexObj).toEqual({ indexName: 'groupByStatusIndex', searchKey: 'statusKey', searchValue: 1 });
        expect(second.data.AssigneeUserId).toEqual([MATE]);
        expect(second.data.watchers.sort()).toEqual([ME, MATE].sort());
        expect(new Date(second.data.DueDate).toISOString()).toBe('2026-10-03T23:59:59.000Z');
    });

    it('checks the create permission in the chosen project, strictly', async () => {
        evaluatePermission.mockImplementation(async (companyId, uid, key) => (key === 'task.task_create' ? 0 : true));
        const out = await call(createTasks, req({ projectId: PROJECT, items: [{ title: 'Draft the budget' }] }));
        expect(out.statusCode).toBe(403);
        expect(out.body).toMatchObject({ status: false, code: 'not_permitted' });
        expect(taskMongo.create).not.toHaveBeenCalled();
        expect(evaluatePermission).toHaveBeenCalledWith(C, ME, 'task.task_create', expect.objectContaining({ projectId: PROJECT, strict: true }));
    });

    it('refuses a project the asker cannot open as not found', async () => {
        mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: HIDDEN, ProjectName: 'Board', CompanyId: C, deletedStatusKey: 0, taskStatusData: STATUSES });
        const out = await call(createTasks, req({ projectId: HIDDEN, items: [{ title: 'Leak it' }] }));
        expect(out.statusCode).toBe(404);
        expect(out.body.code).toBe('project_not_found');
        expect(taskMongo.create).not.toHaveBeenCalled();
    });

    it('refuses an assignee who is not on the project, and one the asker may not assign', async () => {
        const stranger = await call(createTasks, req({ projectId: PROJECT, items: [{ title: 'Draft the budget', assigneeId: STRANGER }] }));
        expect(stranger.body.data.failed).toEqual([expect.objectContaining({ index: 0, code: 'assignee_not_allowed' })]);

        evaluatePermission.mockImplementation(async (companyId, uid, key) => (key === 'task.task_assignee' ? 0 : true));
        const noRight = await call(createTasks, req({ projectId: PROJECT, items: [{ title: 'Draft the budget', assigneeId: MATE }, { title: 'Mine', assigneeId: ME }] }));
        expect(noRight.body.data.failed.map((f) => f.index)).toEqual([0]);
        expect(noRight.body.data.created.map((c) => c.title)).toEqual(['Mine']);
        expect(taskMongo.create).toHaveBeenCalledTimes(1);
    });

    it('places the tasks in a list of that project only', async () => {
        const out = await call(createTasks, req({ projectId: PROJECT, sprintId: LIST_2, items: [{ title: 'Later work' }] }));
        expect(out.body.status).toBe(true);
        expect(payloads()[0].data.sprintId).toBe(LIST_2);

        const foreign = await call(createTasks, req({ projectId: PROJECT, sprintId: '6f0000000000000000000e99', items: [{ title: 'Nowhere' }] }));
        expect(foreign.statusCode).toBe(400);
        expect(foreign.body.code).toBe('list_not_found');
    });

    it('rejects titles too short and caps how many one request can create', async () => {
        const short = await call(createTasks, req({ projectId: PROJECT, items: [{ title: 'ok' }, { title: '  Real task  ' }] }));
        expect(short.body.data.failed).toEqual([expect.objectContaining({ index: 0, code: 'title_invalid' })]);
        expect(short.body.data.created.map((c) => c.title)).toEqual(['Real task']);

        const many = Array.from({ length: MAX_ITEMS + 1 }, (_, i) => ({ title: `Task number ${i}` }));
        const tooMany = await call(createTasks, req({ projectId: PROJECT, items: many }));
        expect(tooMany.statusCode).toBe(400);
        expect(tooMany.body.code).toBe('too_many_items');
    });

    it('keeps to the header company: a body naming another company is refused and nothing is written', async () => {
        const out = await call(createTasks, req({ projectId: PROJECT, companyId: OTHER_C, items: [{ title: 'Draft the budget' }] }));
        expect(out.statusCode).toBe(403);
        expect(taskMongo.create).not.toHaveBeenCalled();
        expect(mockDb.calls.some((c) => c.companyId === OTHER_C)).toBe(false);
    });

    it('writes and reads only the asking company', async () => {
        await call(createTasks, req({ projectId: PROJECT, items: [{ title: 'Draft the budget' }] }));
        expect(payloads()[0].projectData.CompanyId).toBe(C);
        expect(payloads()[0].data.CompanyId).toBe(C);
        expect(mockDb.calls.filter((c) => c.companyId !== dbCollections.GLOBAL && c.companyId !== SCHEMA_TYPE.GOLBAL).every((c) => c.companyId === C)).toBe(true);
    });

    it('reports a plan limit per item instead of claiming success', async () => {
        taskMongo.create.mockResolvedValueOnce({ status: false, isUpgrade: true });
        const out = await call(createTasks, req({ projectId: PROJECT, items: [{ title: 'Draft the budget' }] }));
        expect(out.body.status).toBe(false);
        expect(out.body.data.failed).toEqual([expect.objectContaining({ index: 0, code: 'plan_limit' })]);
    });
});

describe('the preview reads what the asker may do in a project', () => {
    it('answers the lists, the people and whether the asker may create and assign', async () => {
        const out = await call(buildTarget, req({}, { params: { projectId: PROJECT } }));
        expect(out.body.status).toBe(true);
        expect(out.body.data).toMatchObject({ projectId: PROJECT, name: 'Ops', canCreate: true, canAssign: true });
        expect(out.body.data.lists).toEqual([{ id: LIST, name: 'Backlog' }, { id: LIST_2, name: 'Later' }]);
        expect(out.body.data.members).toEqual(expect.arrayContaining([{ id: ME, name: 'Mia Me' }, { id: MATE, name: 'Priya Shah' }]));
        expect(out.body.data.members.some((m) => m.id.startsWith('tId_'))).toBe(false);
    });

    it('offers only the asker as assignee without the assign right', async () => {
        evaluatePermission.mockImplementation(async (companyId, uid, key) => key !== 'task.task_assignee');
        const out = await call(buildTarget, req({}, { params: { projectId: PROJECT } }));
        expect(out.body.data.canAssign).toBe(false);
        expect(out.body.data.members).toEqual([{ id: ME, name: 'Mia Me' }]);
    });

    it('says nothing about a project the asker cannot open', async () => {
        const out = await call(buildTarget, req({}, { params: { projectId: HIDDEN } }));
        expect(out.statusCode).toBe(404);
        expect(out.body.data).toBeUndefined();
    });
});
