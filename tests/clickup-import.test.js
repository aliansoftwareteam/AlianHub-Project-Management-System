const mockDbs = {};
const mockDbFor = (companyId) => { mockDbs[companyId] = mockDbs[companyId] || require('./fixtures/fakeMongo').create(); return mockDbs[companyId]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/tenant', () => ({ pinSessionTenant: (req) => req.headers.companyid }));
jest.mock('../Modules/Tasks/helpers/taskWriteFields', () => ({ sessionActor: async (req) => ({ id: String(req.uid), Employee_Name: 'Owner' }) }));
jest.mock('../Modules/Importers/helpers/importAccess', () => ({
    importTargetAccess: jest.fn(),
    previewAccess: jest.fn(),
    refuseImport: (res, decision) => res.status(decision.statusCode === 403 ? 403 : 404).send({ status: false, statusText: 'refused' }),
}));
jest.mock('../Modules/Tasks/helpers/task_class_Mongo', () => ({ taskMongo: { createMultipleTasks: jest.fn() } }));
jest.mock('../Modules/AIProjectGenerator/orchestrator', () => ({ executePlan: jest.fn() }));
jest.mock('../Modules/Sprints/controller', () => ({ addSprintFun: jest.fn() }));

const { ObjectId } = require('mongodb');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { SEAT_ACTIVE } = require('../Config/seatStatus');
const { importTargetAccess, previewAccess } = require('../Modules/Importers/helpers/importAccess');
const { taskMongo } = require('../Modules/Tasks/helpers/task_class_Mongo');
const { executePlan } = require('../Modules/AIProjectGenerator/orchestrator');
const { addSprintFun } = require('../Modules/Sprints/controller');
const importers = require('../Modules/Importers/controller');
const readRows = require('./fixtures/importers/clickupRows');

const COMPANY = '6f0000000000000000000c91';
const PROJECT = '6f0000000000000000000d91';
const SPRINT = '6f0000000000000000000e91';
const NEW_PROJECT = '6f0000000000000000000d92';
const NEW_SPRINT = '6f0000000000000000000e92';
const OWNER = '6f00000000000000000000f9';
const MEMBER = '6f00000000000000000000fa';
const OUTSIDER = '6f00000000000000000000fb';

const companyDb = () => mockDbFor(COMPANY);
const globalDb = () => mockDbFor(dbCollections.GLOBAL);
const project = (id = PROJECT) => (companyDb().store[SCHEMA_TYPE.PROJECTS] || []).find((row) => String(row._id) === id);
const created = () => taskMongo.createMultipleTasks.mock.calls[0][0];
const sent = (name) => created().tasks.find((task) => task.TaskName === name);

const seedPerson = (uid, email, companyId = COMPANY, roleType = 3) => {
    globalDb().seed(dbCollections.USERS, { _id: uid, Employee_Email: email, Employee_Name: email, AssignCompany: [companyId] });
    mockDbFor(companyId).seed(SCHEMA_TYPE.COMPANY_USERS, { companyId, userId: uid, userEmail: email, roleType, designation: 0, status: SEAT_ACTIVE, isDelete: false });
};

const seedProject = (id) => companyDb().seed(SCHEMA_TYPE.PROJECTS, {
    _id: id,
    ProjectName: 'Web',
    ProjectCode: 'WEB',
    taskStatusData: [{ name: 'To Do', key: 1, type: 'default_active' }, { name: 'In Progress', key: 3, type: 'active' }, { name: 'Done', key: 6, type: 'close' }],
    tagsArray: [{ uid: 'tag-billing', tagName: 'Billing', tagColor: '#000000', tagBgColor: '#00000035' }],
});

const call = async (handler, body, uid = OWNER) => {
    const res = { code: 200 };
    res.status = (code) => { res.code = code; return res; };
    res.send = (payload) => { res.body = payload; return res; };
    res.json = res.send;
    await handler({ uid, headers: { companyid: COMPANY }, body }, res);
    return res;
};

const importIntoProject = (options = { createMissingStatuses: true }) => call(importers.importFromClickUp, { rows: readRows(), projectId: PROJECT, sprintId: SPRINT, options });

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => { delete mockDbs[key]; });
    jest.clearAllMocks();
    seedProject(PROJECT);
    seedPerson(OWNER, 'owner@company.test', COMPANY, 1);
    seedPerson(MEMBER, 'max@member.test');
    seedPerson(OUTSIDER, 'ghost@nowhere.test', '6f0000000000000000000c99');
    importTargetAccess.mockImplementation(async (_companyId, _uid, { sprintId }) => ({ allowed: true, sprint: { id: String(sprintId), name: 'Sprint' } }));
    previewAccess.mockResolvedValue({ allowed: true });
    taskMongo.createMultipleTasks.mockImplementation(async ({ tasks }) => {
        tasks.forEach((task) => { task.createdTaskId = new ObjectId().toHexString(); });
        return { status: true, createdTasks: tasks };
    });
});

describe('a ClickUp export imported into an existing project', () => {
    it('creates every named task and reports the skipped row with its reason', async () => {
        const res = await importIntoProject();
        expect(res.body.status).toBe(true);
        expect(created().tasks).toHaveLength(5);
        expect(res.body.data).toMatchObject({ created: 5, skipped: 1, skippedRows: [{ row: 4, reason: expect.stringMatching(/no name/i) }] });
        expect(created().sprint).toEqual({ id: SPRINT, name: 'Sprint' });
    });

    it('keeps subtasks under their parent', async () => {
        await importIntoProject();
        expect(sent('Write the billing tests').ParentTaskId).toBe('86a1aaa01');
        expect(sent('Check the rounding').ParentTaskId).toBe('86a1aaa02');
        expect(sent('Set up the billing page')._id).toBe('86a1aaa01');
    });

    it('tells the person which rows the create path had to re-hang', async () => {
        taskMongo.createMultipleTasks.mockImplementation(async ({ tasks }) => ({
            status: true,
            createdTasks: tasks,
            adjusted: [
                { _id: 'a', TaskName: 'Too deep', reason: 'TOO_DEEP' },
                { _id: 'b', TaskName: 'Deeper still', reason: 'TOO_DEEP' },
                { _id: 'c', TaskName: 'Follow up with legal', reason: 'PARENT_MISSING' },
            ],
        }));
        const res = await importIntoProject();
        expect(res.body.data.adjusted).toEqual({
            tooDeep: 2,
            parentMissing: 1,
            cycle: 0,
            rows: [
                { name: 'Too deep', reason: 'TOO_DEEP' },
                { name: 'Deeper still', reason: 'TOO_DEEP' },
                { name: 'Follow up with legal', reason: 'PARENT_MISSING' },
            ],
        });
        expect(res.body.statusText).toMatch(/2 subtasks were deeper than three levels and were placed under their nearest parent/);
        expect(res.body.statusText).toMatch(/1 row named a parent that is not in the file/);
    });

    it('says nothing about re-hung rows when the tree fitted', async () => {
        const res = await importIntoProject();
        expect(res.body.data.adjusted).toBeUndefined();
    });

    it('maps statuses onto the project and adds the missing one', async () => {
        await importIntoProject();
        expect(sent('Ship the release notes').status).toBe('Done');
        expect(sent('Write the billing tests').status).toBe('To Do');
        expect(sent('Check the rounding').status).toBe('In Review');
        expect(project().taskStatusData.map((status) => status.name)).toEqual(['To Do', 'In Progress', 'Done', 'In Review']);
        expect(created().statusArray.find((status) => status.name === 'In Review')).toEqual({ name: 'In Review', key: 7, type: 'active' });
    });

    it('reuses the project\'s tags and adds the new ones', async () => {
        await importIntoProject();
        const tags = project().tagsArray;
        expect(tags.map((tag) => tag.tagName)).toEqual(['Billing', 'frontend']);
        const frontend = tags.find((tag) => tag.tagName === 'frontend').uid;
        expect(sent('Set up the billing page').tagsArray).toEqual(['tag-billing', frontend]);
        expect(sent('Check the rounding').tagsArray).toEqual(['tag-billing']);
        expect(sent('Set up the billing page').tagNames).toBeUndefined();
    });

    it('carries estimates in minutes, and each field value under the field it created in the project', async () => {
        await importIntoProject();
        expect(sent('Set up the billing page').totalEstimatedTime).toBe(150);
        expect(sent('Write the billing tests').totalEstimatedTime).toBe(60);
        const points = companyDb().store[SCHEMA_TYPE.CUSTOM_FIELDS].find((field) => field.fieldTitle === 'Story Points');
        expect(points).toMatchObject({ fieldType: 'number', global: false, projectId: [PROJECT] });
        expect(sent('Set up the billing page').customField[String(points._id)]).toEqual({ fieldValue: '5', _id: String(points._id) });
        expect(Object.keys(sent('Set up the billing page')).filter((key) => key.startsWith('custom_'))).toEqual([]);
    });

    it('assigns people by email among the company\'s members and never creates the unknown ones', async () => {
        const usersBefore = globalDb().store[dbCollections.USERS].length;
        const seatsBefore = companyDb().store[SCHEMA_TYPE.COMPANY_USERS].length;
        const res = await importIntoProject();
        expect(sent('Set up the billing page').AssigneeUserId).toEqual([MEMBER]);
        expect(sent('Check the rounding').AssigneeUserId).toEqual([MEMBER]);
        expect(sent('Write the billing tests').AssigneeUserId).toEqual([]);
        expect(globalDb().store[dbCollections.USERS]).toHaveLength(usersBefore);
        expect(companyDb().store[SCHEMA_TYPE.COMPANY_USERS]).toHaveLength(seatsBefore);
        expect(res.body.data.unmatchedAssignees).toEqual(['ghost@nowhere.test', 'Pat Example']);
    });

    it('records the run as a ClickUp import job', async () => {
        await importIntoProject();
        expect(companyDb().store[SCHEMA_TYPE.IMPORT_JOBS]).toEqual([expect.objectContaining({ source: 'clickup', status: 'done', created: 5, userId: OWNER })]);
    });

    it('without leave to add statuses and tags, lands on existing ones only', async () => {
        await importIntoProject({ createMissingStatuses: false });
        expect(importTargetAccess).toHaveBeenCalledWith(COMPANY, OWNER, { projectId: PROJECT, sprintId: SPRINT, addsStatuses: false });
        expect(project().taskStatusData).toHaveLength(3);
        expect(project().tagsArray).toHaveLength(1);
        expect(sent('Check the rounding').status).toBe('To Do');
        expect(sent('Set up the billing page').tagsArray).toEqual(['tag-billing']);
    });
});

describe('a ClickUp import needs the same access as the other importers', () => {
    it('asks for project details access when it will add statuses', async () => {
        await importIntoProject();
        expect(importTargetAccess).toHaveBeenCalledWith(COMPANY, OWNER, { projectId: PROJECT, sprintId: SPRINT, addsStatuses: true });
    });

    it.each([[403], [404]])('writes nothing when access is refused (%s)', async (statusCode) => {
        importTargetAccess.mockResolvedValue({ allowed: false, statusCode });
        const res = await importIntoProject();
        expect(res.code).toBe(statusCode);
        expect(taskMongo.createMultipleTasks).not.toHaveBeenCalled();
        expect(project().taskStatusData).toHaveLength(3);
        expect(companyDb().store[SCHEMA_TYPE.IMPORT_JOBS]).toBeUndefined();
    });

    it('refuses a file that is not a ClickUp export', async () => {
        const res = await call(importers.importFromClickUp, { rows: [{ Title: 'x' }], projectId: PROJECT, sprintId: SPRINT });
        expect(res.body.status).toBe(false);
        expect(importTargetAccess).not.toHaveBeenCalled();
    });

    it('guards the routes like the other importers, and a new project needs project creation', () => {
        const table = {};
        require('../Modules/Importers/routes').init({ post: (route, ...handlers) => { table[route] = handlers; }, get: () => {} });
        const writes = (route) => table[route].some((handler) => handler.taskWrites);
        expect(writes('/api/v2/imports/clickup')).toBe(true);
        expect(writes('/api/v2/imports/clickup/project')).toBe(true);
        expect(table['/api/v2/imports/clickup/project'].some((handler) => handler.permission === 'project.project_create')).toBe(true);
        expect(writes('/api/v2/imports/jira')).toBe(true);
    });
});

describe('a ClickUp list imported as a new project', () => {
    beforeEach(() => {
        executePlan.mockImplementation(async ({ plan }) => {
            companyDb().seed(SCHEMA_TYPE.PROJECTS, { _id: NEW_PROJECT, ProjectName: plan.project.ProjectName, ProjectCode: 'SB', taskStatusData: [{ name: 'To Do', key: 1, type: 'default_active' }, { name: 'In Progress', key: 3, type: 'active' }, { name: 'Done', key: 6, type: 'close' }] });
            return { ok: true, projectId: NEW_PROJECT };
        });
        addSprintFun.mockResolvedValue({ status: true, data: { _id: NEW_SPRINT } });
    });

    it('creates a project named after the list, led by the importer, with the list as its sprint', async () => {
        const rows = readRows().filter((row) => row['List Name'] === 'Sprint Backlog');
        const res = await call(importers.importClickUpAsProject, { rows, listName: 'Sprint Backlog' });
        expect(res.body.status).toBe(true);
        expect(res.body.data).toMatchObject({ projectId: NEW_PROJECT, created: 3, skipped: 0 });
        const { plan, companyId, uid } = executePlan.mock.calls[0][0];
        expect({ companyId, uid, name: plan.project.ProjectName, leads: plan.project.LeadUserId, sprints: plan.sprints }).toEqual({ companyId: COMPANY, uid: OWNER, name: 'Sprint Backlog', leads: [OWNER], sprints: [] });
        expect(addSprintFun.mock.calls[0][0].body).toMatchObject({ companyId: COMPANY, projectId: NEW_PROJECT, sprintName: 'Sprint Backlog' });
        expect(created().sprint).toEqual({ id: new ObjectId(NEW_SPRINT), name: 'Sprint Backlog' });
        expect(project(NEW_PROJECT).taskStatusData.map((status) => status.name)).toEqual(['To Do', 'In Progress', 'Done', 'In Review']);
    });

    it('creates nothing for a file that is not a ClickUp export', async () => {
        const res = await call(importers.importClickUpAsProject, { rows: [{ Title: 'x' }], listName: 'x' });
        expect(res.body.status).toBe(false);
        expect(executePlan).not.toHaveBeenCalled();
    });
});

describe('the ClickUp preview', () => {
    it('counts each list and names the people it cannot match, writing nothing', async () => {
        const res = await call(importers.previewClickUp, { rows: readRows(), projectId: PROJECT });
        expect(res.body.status).toBe(true);
        expect(res.body.data.lists.map((list) => [list.name, list.tasks, list.subtasks])).toEqual([['Sprint Backlog', 1, 2], ['Launch', 2, 0]]);
        expect(res.body.data.newStatuses).toEqual([{ name: 'In Review', type: 'active' }]);
        expect(res.body.data.newTags).toEqual(['frontend']);
        expect(res.body.data.matchedAssignees).toEqual(['max@member.test']);
        expect(res.body.data.unmatchedAssignees).toEqual(['ghost@nowhere.test', 'Pat Example']);
        expect(taskMongo.createMultipleTasks).not.toHaveBeenCalled();
        expect(project().taskStatusData).toHaveLength(3);
    });

    it('refuses a project the caller cannot read', async () => {
        previewAccess.mockResolvedValue({ allowed: false, statusCode: 404 });
        const res = await call(importers.previewClickUp, { rows: readRows(), projectId: PROJECT });
        expect(res.code).toBe(404);
    });
});
