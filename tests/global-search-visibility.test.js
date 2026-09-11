const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(), isPrivileged: (roleType) => roleType === 1 || roleType === 2 }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const { getRoleType } = require('../Config/permissionGuard');
const { globalSearch } = require('../Modules/GlobalSearch/controller');

const C = '6f0000000000000000000c01';
const MINE = '6f0000000000000000000a01';
const THEIRS = '6f0000000000000000000a02';
const ME = '6f0000000000000000000001';
const OTHER = '6f0000000000000000000002';
const TASK_MINE = '6f0000000000000000000b01';
const TASK_THEIRS = '6f0000000000000000000b02';
const PRIVATE_SPRINT = '6f0000000000000000000d01';

const reply = () => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (body) => { res.body = body; return res; };
    return res;
};

const search = async (query = 'budget') => {
    const res = reply();
    await globalSearch({ headers: { companyid: C }, uid: ME, body: { query } }, res);
    return res;
};

const names = (list, field) => list.map((row) => row[field]).sort();

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    getRoleType.mockResolvedValue(3);
    visibleProjectIds.mockResolvedValue([MINE]);

    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: MINE, ProjectName: 'Budget ops', deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: THEIRS, ProjectName: 'Budget board', deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: TASK_MINE, TaskName: 'Budget plan', ProjectID: MINE, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: TASK_THEIRS, TaskName: 'Budget secret', ProjectID: THEIRS, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.COMMENTS, { message: 'Budget note', type: 'text', projectId: MINE, taskId: TASK_MINE });
    mockDb.seed(SCHEMA_TYPE.COMMENTS, { message: 'Budget leak', type: 'text', projectId: THEIRS, taskId: TASK_THEIRS });
    mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Budget wiki', ProjectID: MINE, visibility: 'project', deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Budget board notes', ProjectID: THEIRS, visibility: 'project', deletedStatusKey: 0 });
});

describe('TSK-05 global search is limited to the projects the caller can see', () => {
    it('leaves out the tasks, comments, pages and project of a project the member cannot see', async () => {
        const res = await search();
        expect(res.body.status).toBe(true);
        expect(names(res.body.data.tasks, 'TaskName')).toEqual(['Budget plan']);
        expect(names(res.body.data.projects, 'ProjectName')).toEqual(['Budget ops']);
        expect(names(res.body.data.comments, 'message')).toEqual(['Budget note']);
        expect(names(res.body.data.pages, 'title')).toEqual(['Budget wiki']);
    });

    it('gives the owner every project they can see', async () => {
        getRoleType.mockResolvedValue(1);
        visibleProjectIds.mockResolvedValue([MINE, THEIRS]);
        const res = await search();
        expect(names(res.body.data.tasks, 'TaskName')).toEqual(['Budget plan', 'Budget secret']);
        expect(names(res.body.data.projects, 'ProjectName')).toEqual(['Budget board', 'Budget ops']);
        expect(names(res.body.data.comments, 'message')).toEqual(['Budget leak', 'Budget note']);
    });

    it('judges a task comment by its task, not by the project id on the comment row', async () => {
        mockDb.seed(SCHEMA_TYPE.COMMENTS, { message: 'Budget moved', type: 'text', projectId: MINE, taskId: TASK_THEIRS });
        const res = await search();
        expect(names(res.body.data.comments, 'message')).toEqual(['Budget note']);
    });

    it('applies page visibility inside a visible project and keeps company-wide docs', async () => {
        mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Budget draft', ProjectID: MINE, visibility: 'private', createdBy: OTHER, deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Budget mine', ProjectID: MINE, visibility: 'private', createdBy: ME, deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Budget handbook', visibility: 'project', deletedStatusKey: 0 });
        const res = await search();
        expect(names(res.body.data.pages, 'title')).toEqual(['Budget handbook', 'Budget mine', 'Budget wiki']);
    });

    it('hides tasks and comments of a private sprint the member is not on, but not from an admin', async () => {
        mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: PRIVATE_SPRINT, projectId: MINE, private: true, AssigneeUserId: [OTHER], deletedStatusKey: 0 });
        const hiddenTask = mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Budget payroll', ProjectID: MINE, sprintId: PRIVATE_SPRINT, deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.COMMENTS, { message: 'Budget payroll note', type: 'text', projectId: MINE, sprintId: PRIVATE_SPRINT, taskId: hiddenTask._id });

        const member = await search();
        expect(names(member.body.data.tasks, 'TaskName')).toEqual(['Budget plan']);
        expect(names(member.body.data.comments, 'message')).toEqual(['Budget note']);

        getRoleType.mockResolvedValue(2);
        const admin = await search();
        expect(names(admin.body.data.tasks, 'TaskName')).toEqual(['Budget payroll', 'Budget plan']);
        expect(names(admin.body.data.comments, 'message')).toEqual(['Budget note', 'Budget payroll note']);
    });

    it('lets a member on a private sprint see its tasks', async () => {
        mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: PRIVATE_SPRINT, projectId: MINE, private: true, AssigneeUserId: [ME], deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Budget payroll', ProjectID: MINE, sprintId: PRIVATE_SPRINT, deletedStatusKey: 0 });
        const res = await search();
        expect(names(res.body.data.tasks, 'TaskName')).toEqual(['Budget payroll', 'Budget plan']);
    });

    it('refuses a caller who is not a member of the company', async () => {
        getRoleType.mockResolvedValue(null);
        const res = await search();
        expect(res.statusCode).toBe(403);
        expect(res.body.status).toBe(false);
        expect(mockDb.crud).not.toHaveBeenCalled();
    });
});
