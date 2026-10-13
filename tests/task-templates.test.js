const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
const mockTaskMongo = { create: jest.fn(), updateChecklists: jest.fn() };
jest.mock('../Modules/Tasks/helpers/task_class_Mongo', () => ({ taskMongo: mockTaskMongo }));
const mockHistory = jest.fn(() => Promise.resolve());
jest.mock('../Modules/Tasks/helpers/mongo_helper', () => ({ HandleHistory: (...args) => mockHistory(...args) }));
jest.mock('../Modules/LogTime/controllerV2/helpers', () => ({ updateRemainingTime: jest.fn(() => Promise.resolve()) }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { schema } = require('../utils/mongo-handler/schema');

const C = 'c00000000000000000000001';
const OTHER_COMPANY = 'c00000000000000000000002';
const OWNER = 'a00000000000000000000001';
const MEMBER = 'a00000000000000000000003';
const VIEWER = 'a00000000000000000000004';
const MEMBER_TWO = 'a00000000000000000000005';
const OUTSIDER = 'a00000000000000000000009';
const ALPHA = 'b00000000000000000000001';
const BETA = 'b00000000000000000000002';
const SECRET = 'b00000000000000000000003';
const SOURCE = 'd00000000000000000000001';
const TARGET = 'd00000000000000000000002';
const SECRET_TASK = 'd00000000000000000000003';

const MEMBER_ROLE = 3;
const VIEWER_ROLE = 4;

const routesOf = () => {
    const table = {};
    const register = (method) => (path, ...handlers) => { table[`${method} ${path}`] = handlers; };
    const app = { get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') };
    require('../Modules/TaskTemplates/routes').init(app);
    return table;
};

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    res.send = res.json;
    return res;
};

const call = async (route, uid, { params = {}, query = {}, body = {}, headers = {} } = {}) => {
    const handlers = routesOf()[route];
    if (!handlers) throw new Error(`no route ${route}`);
    const res = response();
    const req = { uid, params, query, body, headers: { companyid: C, ...headers } };
    for (const handler of handlers) {
        let advanced = false;
        await handler(req, res, () => { advanced = true; });
        if (!advanced) break;
    }
    await new Promise((resolve) => setImmediate(resolve));
    return res;
};

const TASK_KEYS = ['task_create', 'sub_task_create', 'task_list', 'task_checklist', 'task_priority', 'task_type', 'task_description',
    'task_due_date', 'task_start_date', 'task_tag', 'task_estimated_hours', 'task_custom_field', 'task_name_edit'];

const seedRules = () => {
    const parent = (key) => mockDb.seed(SCHEMA_TYPE.RULES, { key, isParent: true, roles: [{ key: MEMBER_ROLE, permission: true }, { key: VIEWER_ROLE, permission: true }] });
    const task = parent('task');
    const project = parent('project');
    TASK_KEYS.forEach((key) => mockDb.seed(SCHEMA_TYPE.RULES, {
        key, isParent: false, parentId: String(task._id),
        roles: [{ key: MEMBER_ROLE, permission: true }, { key: VIEWER_ROLE, permission: key === 'task_list' ? false : null }],
    }));
    mockDb.seed(SCHEMA_TYPE.RULES, { key: 'project_details', isParent: false, parentId: String(project._id), roles: [{ key: MEMBER_ROLE, permission: false }] });
    mockDb.seed(SCHEMA_TYPE.RULES, { key: 'private_projects', isParent: false, parentId: String(project._id), roles: [{ key: MEMBER_ROLE, permission: 1 }] });
};

const STATUSES = [{ key: 1, name: 'To Do', value: 'to_do', type: 'default_active', bgColor: '#ccc' }, { key: 3, name: 'Done', value: 'done', type: 'close' }];
const TYPES = [{ key: 1, value: 'task', name: 'Task' }, { key: 2, value: 'bug', name: 'Bug' }];
const SPRINT = { id: 's1', name: 'Sprint one', value: 1 };

const seedProject = (_id, extra = {}) => mockDb.seed(SCHEMA_TYPE.PROJECTS, {
    _id, ProjectName: `Project ${_id.slice(-1)}`, ProjectCode: `P${_id.slice(-1)}`, CompanyId: C, lastTaskId: 7,
    taskStatusData: STATUSES, taskTypeCounts: TYPES, isPrivateSpace: false, AssigneeUserId: [], ...extra,
});

const seedTask = (_id, extra = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, {
    _id, TaskName: 'A task', ProjectID: ALPHA, CompanyId: C, sprintId: 's1', sprintArray: SPRINT, TaskType: 'task', TaskTypeKey: 1,
    status: { text: 'To Do', key: 1, type: 'default_active' }, statusKey: 1, statusType: 'default_active', isParentTask: true,
    Task_Priority: '', rawDescription: '', descriptionBlock: {}, tagsArray: [], checklistArray: [], customField: {}, points: null,
    AssigneeUserId: [], watchers: [], dueDateDeadLine: [], deletedStatusKey: 0, createdAt: new Date('2026-09-01T10:00:00Z'), ...extra,
});

const seedTemplate = (extra = {}) => mockDb.seed(SCHEMA_TYPE.TASK_TEMPLATES, {
    name: 'Release', scope: 'project', ProjectID: ALPHA, defaultForProjects: [], titlePattern: 'Release {date}',
    rawDescription: 'Steps', descriptionBlock: { blocks: [{ type: 'paragraph', data: { text: 'Steps' } }] },
    TaskType: 'bug', TaskTypeKey: 2, Task_Priority: 'HIGH', tagsArray: ['tag1'], totalEstimatedTime: 90, points: 3,
    customField: { cf1: 'x' }, startOffsetDays: 1, dueOffsetDays: 4,
    checklist: [{ key: 'c1', name: 'QA', parentKey: '' }, { key: 'i1', name: 'Smoke test', parentKey: 'c1' }, { key: 'i2', name: 'Sub item', parentKey: 'i1' }],
    subtasks: [{ title: 'Write changelog', dueOffsetDays: 2, assigneeIds: [MEMBER] }],
    createdBy: OWNER, deletedStatusKey: 0, ...extra,
});

const stored = (type, id) => mockDb.store[type].find((row) => String(row._id) === String(id));

beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    mockTaskMongo.create.mockReset();
    mockTaskMongo.create.mockImplementation(async () => ({ status: true, id: 'e00000000000000000000001' }));
    mockTaskMongo.updateChecklists.mockReset();
    mockTaskMongo.updateChecklists.mockResolvedValue({ status: true });
    mockHistory.mockClear();
    [[OWNER, 1], [MEMBER, MEMBER_ROLE], [VIEWER, VIEWER_ROLE], [MEMBER_TWO, MEMBER_ROLE]].forEach(([userId, roleType]) => {
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false });
        mockDb.seed(SCHEMA_TYPE.USERS, { _id: userId, Employee_Name: `User ${userId.slice(-1)}` });
    });
    seedRules();
    seedProject(ALPHA);
    seedProject(BETA);
    seedProject(SECRET, { isPrivateSpace: true, AssigneeUserId: [OWNER, MEMBER] });
    seedTask(SOURCE, {
        TaskName: 'Release notes', TaskType: 'bug', TaskTypeKey: 2, Task_Priority: 'HIGH', rawDescription: 'Steps',
        descriptionBlock: { blocks: [{ type: 'paragraph', data: { text: 'Steps' } }] }, tagsArray: ['tag1'], totalEstimatedTime: 90, points: 3,
        customField: { cf1: 'x' }, startDate: new Date('2026-09-02T00:00:00Z'), DueDate: new Date('2026-09-05T23:59:59Z'),
        checklistArray: [{ id: 'c1', name: 'QA', isChecked: true }, { id: 'i1', name: 'Smoke test', parentId: 'c1', isChecked: true }, { id: 'i2', name: 'Sub item', parentId: 'i1' }],
    });
    seedTask('d00000000000000000000011', { TaskName: 'Write changelog', ParentTaskId: SOURCE, isParentTask: false, DueDate: new Date('2026-09-03T12:00:00Z'), AssigneeUserId: [MEMBER] });
    seedTask('d00000000000000000000012', { TaskName: 'Deleted sub', ParentTaskId: SOURCE, isParentTask: false, deletedStatusKey: 1 });
    seedTask(TARGET, { TaskName: 'Next release', checklistArray: [{ id: 'x', name: 'Existing' }], tagsArray: ['tag9'] });
    seedTask(SECRET_TASK, { ProjectID: SECRET });
});

describe('saving a task as a template', () => {
    it('stores the chosen parts with dates relative to the day the task was created', async () => {
        const res = await call('POST /api/v2/task-templates', MEMBER, { body: { taskId: SOURCE, name: '  Release  ', scope: 'project', titlePattern: 'Release {date}' } });
        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe(true);
        const [doc] = mockDb.store[SCHEMA_TYPE.TASK_TEMPLATES];
        expect(doc).toMatchObject({
            name: 'Release', scope: 'project', titlePattern: 'Release {date}', TaskType: 'bug', TaskTypeKey: 2, Task_Priority: 'HIGH',
            rawDescription: 'Steps', tagsArray: ['tag1'], totalEstimatedTime: 90, points: 3, customField: { cf1: 'x' },
            startOffsetDays: 1, dueOffsetDays: 4, createdBy: MEMBER, deletedStatusKey: 0, sourceTaskId: SOURCE,
        });
        expect(String(doc.ProjectID)).toBe(ALPHA);
        expect(doc.checklist).toEqual([{ key: 'c1', name: 'QA', parentKey: '' }, { key: 'i1', name: 'Smoke test', parentKey: 'c1' }, { key: 'i2', name: 'Sub item', parentKey: 'i1' }]);
        expect(doc.subtasks).toEqual([{ title: 'Write changelog', dueOffsetDays: 2, startOffsetDays: null, assigneeIds: [MEMBER] }]);
    });

    it('declares every field it stores, so the strict schema keeps them', async () => {
        await call('POST /api/v2/task-templates', MEMBER, { body: { taskId: SOURCE, name: 'Release', scope: 'project' } });
        const declared = Object.keys(schema.task_templates);
        const [doc] = mockDb.store[SCHEMA_TYPE.TASK_TEMPLATES];
        expect(Object.keys(doc).filter((key) => !['_id', 'createdAt', 'updatedAt'].includes(key) && !declared.includes(key))).toEqual([]);
    });

    it('leaves out the parts that were not chosen', async () => {
        await call('POST /api/v2/task-templates', MEMBER, {
            body: { taskId: SOURCE, name: 'Lean', scope: 'project', include: { checklist: false, subtasks: false, dates: false, priority: false, subtaskAssignees: false } },
        });
        const [doc] = mockDb.store[SCHEMA_TYPE.TASK_TEMPLATES];
        expect(doc.checklist).toEqual([]);
        expect(doc.subtasks).toEqual([]);
        expect(doc.startOffsetDays).toBeNull();
        expect(doc.dueOffsetDays).toBeNull();
        expect(doc.Task_Priority).toBe('');
    });

    it('takes explicit date offsets over the computed ones', async () => {
        await call('POST /api/v2/task-templates', MEMBER, { body: { taskId: SOURCE, name: 'Offsets', scope: 'project', startOffsetDays: null, dueOffsetDays: 7 } });
        const [doc] = mockDb.store[SCHEMA_TYPE.TASK_TEMPLATES];
        expect(doc.startOffsetDays).toBeNull();
        expect(doc.dueOffsetDays).toBe(7);
    });

    it('needs a name', async () => {
        const res = await call('POST /api/v2/task-templates', MEMBER, { body: { taskId: SOURCE, name: '   ', scope: 'project' } });
        expect(res.statusCode).toBe(400);
        expect(mockDb.store[SCHEMA_TYPE.TASK_TEMPLATES] || []).toEqual([]);
    });

    it('keeps a workspace template to owners and admins', async () => {
        const refused = await call('POST /api/v2/task-templates', MEMBER, { body: { taskId: SOURCE, name: 'Everywhere', scope: 'workspace' } });
        expect(refused.statusCode).toBe(403);
        const saved = await call('POST /api/v2/task-templates', OWNER, { body: { taskId: SOURCE, name: 'Everywhere', scope: 'workspace' } });
        expect(saved.statusCode).toBe(200);
        const [doc] = mockDb.store[SCHEMA_TYPE.TASK_TEMPLATES];
        expect(doc.scope).toBe('workspace');
        expect(doc.ProjectID == null).toBe(true);
    });

    it('needs task create in the task\'s project for a project template', async () => {
        const res = await call('POST /api/v2/task-templates', VIEWER, { body: { taskId: SOURCE, name: 'Nope', scope: 'project' } });
        expect(res.statusCode).toBe(403);
    });

    it('answers 404 for a task in a private project the caller is not on', async () => {
        const res = await call('POST /api/v2/task-templates', MEMBER_TWO, { body: { taskId: SECRET_TASK, name: 'Peek', scope: 'project' } });
        expect(res.statusCode).toBe(404);
    });

    it('refuses a body that names another company', async () => {
        const res = await call('POST /api/v2/task-templates', MEMBER, { body: { taskId: SOURCE, name: 'Other', scope: 'project', companyId: OTHER_COMPANY } });
        expect(res.statusCode).toBe(403);
        expect(mockDb.store[SCHEMA_TYPE.TASK_TEMPLATES] || []).toEqual([]);
    });

    it('reads and writes only the header company', async () => {
        await call('POST /api/v2/task-templates', MEMBER, { body: { taskId: SOURCE, name: 'Scoped', scope: 'project' } });
        const tenantCalls = mockDb.calls.filter((c) => [SCHEMA_TYPE.TASK_TEMPLATES, SCHEMA_TYPE.TASKS, SCHEMA_TYPE.PROJECTS].includes(c.type));
        expect(tenantCalls.length).toBeGreaterThan(0);
        expect(tenantCalls.every((c) => c.companyId === C)).toBe(true);
    });
});

describe('applying a template to a task', () => {
    const apply = (uid, templateId, body) => call('POST /api/v2/task-templates/:id/apply', uid, { params: { id: String(templateId) }, body });

    it('fills the empty fields with dates counted from the apply day', async () => {
        const template = seedTemplate();
        const res = await apply(MEMBER, template._id, { taskId: TARGET, applyDate: '2026-10-01', tzOffsetMinutes: 0 });
        expect(res.statusCode).toBe(200);
        const task = stored(SCHEMA_TYPE.TASKS, TARGET);
        expect(task).toMatchObject({ rawDescription: 'Steps', Task_Priority: 'HIGH', points: 3, totalEstimatedTime: 90, TaskName: 'Next release' });
        expect(task.customField).toEqual({ cf1: 'x' });
        expect(new Date(task.startDate).toISOString()).toBe('2026-10-02T00:00:00.000Z');
        expect(new Date(task.DueDate).toISOString()).toBe('2026-10-05T23:59:59.999Z');
        expect(task.tagsArray).toEqual(['tag9', 'tag1']);
        expect(res.body.data.applied).toEqual(expect.arrayContaining(['description', 'priority', 'points', 'estimate', 'customFields', 'startDate', 'dueDate', 'tags', 'checklist', 'subtasks']));
        expect(mockHistory).toHaveBeenCalledWith('task', C, ALPHA, TARGET, expect.objectContaining({ sprintId: 's1' }), expect.objectContaining({ id: MEMBER }));
    });

    it('leaves out a template value that does not fit its field, and keeps the rest and the task\'s own values', async () => {
        const LINK = 'f00000000000000000000001';
        const SCORE = 'f00000000000000000000002';
        const REVIEWERS = 'f00000000000000000000003';
        [[LINK, 'url'], [SCORE, 'rating'], [REVIEWERS, 'people']].forEach(([_id, fieldType]) => {
            mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id, fieldTitle: fieldType, fieldType, type: 'task', global: true, isDelete: true });
        });
        stored(SCHEMA_TYPE.TASKS, TARGET).customField = { own: { fieldValue: 'kept' } };
        const template = seedTemplate({
            customField: {
                cf1: 'x',
                [LINK]: { _id: LINK, fieldValue: 'javascript:alert(1)' },
                [SCORE]: { _id: SCORE, fieldValue: 4 },
                [REVIEWERS]: { _id: REVIEWERS, fieldValue: [MEMBER, OUTSIDER] },
            },
        });
        const res = await apply(MEMBER, template._id, { taskId: TARGET, applyDate: '2026-10-01', tzOffsetMinutes: 0 });
        expect(res.statusCode).toBe(200);
        expect(stored(SCHEMA_TYPE.TASKS, TARGET).customField).toEqual({
            own: { fieldValue: 'kept' },
            cf1: 'x',
            [SCORE]: { _id: SCORE, fieldValue: 4 },
            [REVIEWERS]: { _id: REVIEWERS, fieldValue: [MEMBER] },
        });
        expect(res.body.data.applied).toContain('customFields');
        expect(res.body.data.droppedFieldValues).toBe(2);
    });

    it('counts the apply day in the caller\'s own time zone', async () => {
        const template = seedTemplate();
        await apply(MEMBER, template._id, { taskId: TARGET, applyDate: '2026-10-01', tzOffsetMinutes: -330 });
        const task = stored(SCHEMA_TYPE.TASKS, TARGET);
        expect(new Date(task.startDate).toISOString()).toBe('2026-10-01T18:30:00.000Z');
    });

    it('creates the subtasks through the task create path, under the task and in its list', async () => {
        const template = seedTemplate();
        await apply(MEMBER, template._id, { taskId: TARGET, applyDate: '2026-10-01', tzOffsetMinutes: 0 });
        expect(mockTaskMongo.create).toHaveBeenCalledTimes(1);
        const [{ data, user, projectData, indexObj }] = mockTaskMongo.create.mock.calls[0];
        expect(data).toMatchObject({
            TaskName: 'Write changelog', ParentTaskId: TARGET, isParentTask: false, ProjectID: ALPHA, CompanyId: C, sprintId: 's1',
            sprintArray: SPRINT, AssigneeUserId: [MEMBER], statusKey: 1, statusType: 'default_active', Task_Leader: MEMBER,
            DueDate: '2026-10-03T23:59:59.999Z', dueDateDeadLine: [{ date: '2026-10-03T23:59:59.999Z' }],
        });
        expect(user).toMatchObject({ id: MEMBER, Employee_Name: 'User 3', companyOwnerId: OWNER });
        expect(projectData).toMatchObject({ _id: ALPHA, CompanyId: C, ProjectCode: 'P1', ProjectName: 'Project 1' });
        expect(indexObj).toMatchObject({ indexName: 'groupByStatusIndex', searchKey: 'statusKey' });
    });

    it('hands the create path the chain of the task the subtasks go under', async () => {
        Object.assign(stored(SCHEMA_TYPE.TASKS, TARGET), { isParentTask: false, ParentTaskId: SOURCE, ancestors: [SOURCE] });
        const template = seedTemplate();
        const res = await apply(MEMBER, template._id, { taskId: TARGET, applyDate: '2026-10-01' });
        expect(res.body.data.subtasksCreated).toBe(1);
        expect(mockTaskMongo.create.mock.calls[0][0].data).toMatchObject({ ParentTaskId: TARGET, ancestors: [SOURCE, TARGET] });
    });

    it('skips the subtasks on a level-three task, which can take none, and says so', async () => {
        const middle = 'd00000000000000000000011';
        Object.assign(stored(SCHEMA_TYPE.TASKS, TARGET), { isParentTask: false, ParentTaskId: middle, ancestors: [SOURCE, middle] });
        const template = seedTemplate();
        const res = await apply(MEMBER, template._id, { taskId: TARGET, applyDate: '2026-10-01' });
        expect(res.statusCode).toBe(200);
        expect(mockTaskMongo.create).not.toHaveBeenCalled();
        expect(res.body.data.skipped).toContain('subtasks');
        expect(res.body.data.applied).not.toContain('subtasks');
        expect(res.body.data.applied).toContain('checklist');
    });

    it('appends the checklist through the checklist path, keeping its nesting', async () => {
        const template = seedTemplate();
        await apply(MEMBER, template._id, { taskId: TARGET, applyDate: '2026-10-01', tzOffsetMinutes: 0 });
        expect(mockTaskMongo.updateChecklists).toHaveBeenCalledTimes(1);
        const [args] = mockTaskMongo.updateChecklists.mock.calls[0];
        expect(args).toMatchObject({ companyId: C, projectId: ALPHA, sprintId: 's1', taskId: TARGET, operation: 'checklistadd', userData: expect.objectContaining({ id: MEMBER }) });
        const [list, item, sub] = args.data;
        expect(list).toMatchObject({ name: 'QA', isChecked: false, AssigneeUserId: [] });
        expect(list.parentId).toBeUndefined();
        expect(item).toMatchObject({ name: 'Smoke test', parentId: list.id });
        expect(sub).toMatchObject({ name: 'Sub item', parentId: item.id });
        expect(new Set([list.id, item.id, sub.id, 'x']).size).toBe(4);
    });

    it('never overwrites a filled field without the caller naming it', async () => {
        stored(SCHEMA_TYPE.TASKS, TARGET).Task_Priority = 'LOW';
        const template = seedTemplate();
        const res = await apply(MEMBER, template._id, { taskId: TARGET, applyDate: '2026-10-01' });
        const task = stored(SCHEMA_TYPE.TASKS, TARGET);
        expect(task.Task_Priority).toBe('LOW');
        expect(task.TaskTypeKey).toBe(1);
        expect(res.body.data.conflicts.map((c) => c.field)).toEqual(expect.arrayContaining(['priority', 'type']));

        const confirmed = await apply(MEMBER, template._id, { taskId: TARGET, applyDate: '2026-10-01', overwrite: ['priority', 'type'] });
        expect(confirmed.statusCode).toBe(200);
        expect(stored(SCHEMA_TYPE.TASKS, TARGET)).toMatchObject({ Task_Priority: 'HIGH', TaskTypeKey: 2, TaskType: 'bug' });
    });

    it('previews the conflicts without writing anything', async () => {
        stored(SCHEMA_TYPE.TASKS, TARGET).Task_Priority = 'LOW';
        const template = seedTemplate();
        const before = JSON.stringify(stored(SCHEMA_TYPE.TASKS, TARGET));
        const res = await apply(MEMBER, template._id, { taskId: TARGET, preview: true });
        expect(res.statusCode).toBe(200);
        expect(res.body.data.conflicts.map((c) => c.field)).toEqual(expect.arrayContaining(['priority', 'type']));
        expect(JSON.stringify(stored(SCHEMA_TYPE.TASKS, TARGET))).toBe(before);
        expect(mockTaskMongo.create).not.toHaveBeenCalled();
        expect(mockTaskMongo.updateChecklists).not.toHaveBeenCalled();
    });

    it('renames the task from the title pattern only when asked', async () => {
        const template = seedTemplate();
        await apply(MEMBER, template._id, { taskId: TARGET, applyDate: '2026-10-01', overwrite: ['title'] });
        expect(stored(SCHEMA_TYPE.TASKS, TARGET).TaskName).toBe('Release 2026-10-01');
    });

    it('drops an assignee who is not an active member able to see the project', async () => {
        const template = seedTemplate({ subtasks: [{ title: 'Review', dueOffsetDays: null, assigneeIds: [MEMBER, OUTSIDER, MEMBER_TWO] }] });
        seedTask('d00000000000000000000021', { ProjectID: SECRET });
        const secretTemplate = seedTemplate({ ProjectID: SECRET, subtasks: [{ title: 'Review', dueOffsetDays: null, assigneeIds: [MEMBER, OUTSIDER, MEMBER_TWO] }] });

        await apply(MEMBER, template._id, { taskId: TARGET });
        expect(mockTaskMongo.create.mock.calls[0][0].data.AssigneeUserId).toEqual([MEMBER, MEMBER_TWO]);

        await apply(MEMBER, secretTemplate._id, { taskId: 'd00000000000000000000021' });
        expect(mockTaskMongo.create.mock.calls[1][0].data.AssigneeUserId).toEqual([MEMBER]);
    });

    it('needs task create in the target project', async () => {
        const template = seedTemplate();
        const res = await apply(VIEWER, template._id, { taskId: TARGET });
        expect(res.statusCode).toBe(403);
        expect(mockTaskMongo.create).not.toHaveBeenCalled();
        expect(stored(SCHEMA_TYPE.TASKS, TARGET).Task_Priority).toBe('');
    });

    it('keeps a project template to its own project, and lets a workspace template go anywhere', async () => {
        seedTask('d00000000000000000000031', { ProjectID: BETA });
        const alphaOnly = seedTemplate();
        const refused = await apply(MEMBER, alphaOnly._id, { taskId: 'd00000000000000000000031' });
        expect(refused.statusCode).toBe(404);
        const everywhere = seedTemplate({ scope: 'workspace', ProjectID: null });
        const applied = await apply(MEMBER, everywhere._id, { taskId: 'd00000000000000000000031' });
        expect(applied.statusCode).toBe(200);
    });

    it('answers 404 for a deleted template', async () => {
        const template = seedTemplate({ deletedStatusKey: 1 });
        const res = await apply(MEMBER, template._id, { taskId: TARGET });
        expect(res.statusCode).toBe(404);
    });
});

describe('listing and managing templates', () => {
    it('lists the workspace templates and the project\'s own, marking the project default', async () => {
        const mine = seedTemplate({ name: 'Alpha one', defaultForProjects: [ALPHA] });
        seedTemplate({ name: 'Beta one', ProjectID: BETA });
        seedTemplate({ name: 'Everywhere', scope: 'workspace', ProjectID: null });
        seedTemplate({ name: 'Gone', deletedStatusKey: 1 });
        const res = await call('GET /api/v2/task-templates', MEMBER, { query: { projectId: ALPHA } });
        expect(res.statusCode).toBe(200);
        expect(res.body.data.map((t) => t.name).sort()).toEqual(['Alpha one', 'Everywhere']);
        expect(res.body.data.find((t) => String(t._id) === String(mine._id)).isDefault).toBe(true);
    });

    it('hides the templates of projects the caller cannot see from the settings list', async () => {
        seedTemplate({ name: 'Alpha one' });
        seedTemplate({ name: 'Secret one', ProjectID: SECRET });
        const member = await call('GET /api/v2/task-templates', MEMBER_TWO);
        expect(member.body.data.map((t) => t.name)).toEqual(['Alpha one']);
        const owner = await call('GET /api/v2/task-templates', OWNER);
        expect(owner.body.data.map((t) => t.name).sort()).toEqual(['Alpha one', 'Secret one']);
    });

    it('renames and deletes a project template for someone who may create tasks there', async () => {
        const template = seedTemplate();
        const renamed = await call('PATCH /api/v2/task-templates/:id', MEMBER, { params: { id: String(template._id) }, body: { name: 'Renamed' } });
        expect(renamed.statusCode).toBe(200);
        expect(stored(SCHEMA_TYPE.TASK_TEMPLATES, template._id).name).toBe('Renamed');
        const refused = await call('DELETE /api/v2/task-templates/:id', VIEWER, { params: { id: String(template._id) } });
        expect(refused.statusCode).toBe(403);
        const deleted = await call('DELETE /api/v2/task-templates/:id', MEMBER, { params: { id: String(template._id) } });
        expect(deleted.statusCode).toBe(200);
        expect(stored(SCHEMA_TYPE.TASK_TEMPLATES, template._id).deletedStatusKey).toBe(1);
    });

    it('keeps renaming a workspace template to owners and admins', async () => {
        const template = seedTemplate({ scope: 'workspace', ProjectID: null });
        const refused = await call('PATCH /api/v2/task-templates/:id', MEMBER, { params: { id: String(template._id) }, body: { name: 'Mine now' } });
        expect(refused.statusCode).toBe(403);
    });
});

describe('the default template of a project', () => {
    const setDefault = (uid, body) => call('PUT /api/v2/task-templates/default', uid, { body });

    it('needs project settings permission', async () => {
        const template = seedTemplate();
        const res = await setDefault(MEMBER, { projectId: ALPHA, templateId: String(template._id) });
        expect(res.statusCode).toBe(403);
        expect(stored(SCHEMA_TYPE.TASK_TEMPLATES, template._id).defaultForProjects).toEqual([]);
    });

    it('keeps one default per project and can be cleared', async () => {
        const first = seedTemplate({ name: 'First' });
        const second = seedTemplate({ name: 'Second', scope: 'workspace', ProjectID: null, defaultForProjects: [BETA] });
        expect((await setDefault(OWNER, { projectId: ALPHA, templateId: String(first._id) })).statusCode).toBe(200);
        expect(stored(SCHEMA_TYPE.TASK_TEMPLATES, first._id).defaultForProjects).toEqual([ALPHA]);
        await setDefault(OWNER, { projectId: ALPHA, templateId: String(second._id) });
        expect(stored(SCHEMA_TYPE.TASK_TEMPLATES, first._id).defaultForProjects).toEqual([]);
        expect(stored(SCHEMA_TYPE.TASK_TEMPLATES, second._id).defaultForProjects).toEqual([BETA, ALPHA]);
        await setDefault(OWNER, { projectId: ALPHA, templateId: null });
        expect(stored(SCHEMA_TYPE.TASK_TEMPLATES, second._id).defaultForProjects).toEqual([BETA]);
    });

    it('refuses a template from another project', async () => {
        const betaOnly = seedTemplate({ ProjectID: BETA });
        const res = await setDefault(OWNER, { projectId: ALPHA, templateId: String(betaOnly._id) });
        expect(res.statusCode).toBe(404);
    });
});
