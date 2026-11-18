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
    refuseImport: (res) => res.status(404).send({ status: false, statusText: 'refused' }),
}));
jest.mock('../Modules/Tasks/helpers/task_class_Mongo', () => ({ taskMongo: { createMultipleTasks: jest.fn() } }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { importTargetAccess } = require('../Modules/Importers/helpers/importAccess');
const { taskMongo } = require('../Modules/Tasks/helpers/task_class_Mongo');
const { levelRows } = require('../Modules/Tasks/helpers/taskTreeRules');
const { adjustedReport, adjustedSentences, MAX_LISTED } = require('../Modules/Importers/helpers/importTree');
const importers = require('../Modules/Importers/controller');

const COMPANY = '6f0000000000000000000ca1';
const PROJECT = '6f0000000000000000000da1';
const SPRINT = '6f0000000000000000000ea1';
const OWNER = '6f00000000000000000000a9';

const call = async (handler, body) => {
    const res = { code: 200 };
    res.status = (code) => { res.code = code; return res; };
    res.send = (payload) => { res.body = payload; return res; };
    res.json = res.send;
    await handler({ uid: OWNER, headers: { companyid: COMPANY }, body }, res);
    return res;
};

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => { delete mockDbs[key]; });
    jest.clearAllMocks();
    mockDbFor(COMPANY).seed(SCHEMA_TYPE.PROJECTS, {
        _id: PROJECT,
        ProjectName: 'Web',
        ProjectCode: 'WEB',
        taskStatusData: [{ name: 'To Do', key: 1, type: 'default_active' }, { name: 'Done', key: 6, type: 'close' }],
    });
    importTargetAccess.mockImplementation(async (_companyId, _uid, { sprintId }) => ({ allowed: true, sprint: { id: String(sprintId), name: 'Sprint' } }));
    /* The create path orders the rows it is handed with levelRows and answers what it re-hung. */
    taskMongo.createMultipleTasks.mockImplementation(async ({ tasks }) => ({ status: true, createdTasks: tasks, adjusted: levelRows(tasks).adjusted }));
});

describe('what the create path re-hung, as the person is told', () => {
    it('counts each reason and names the rows', () => {
        expect(adjustedReport([
            { _id: 'a', TaskName: 'Too deep', reason: 'TOO_DEEP' },
            { _id: 'b', TaskName: 'Orphan', reason: 'PARENT_MISSING' },
            { _id: 'c', TaskName: 'Loop', reason: 'CYCLE' },
            { _id: 'd', TaskName: 'Loop back', reason: 'CYCLE' },
        ])).toEqual({
            tooDeep: 1,
            parentMissing: 1,
            cycle: 2,
            rows: [
                { name: 'Too deep', reason: 'TOO_DEEP' },
                { name: 'Orphan', reason: 'PARENT_MISSING' },
                { name: 'Loop', reason: 'CYCLE' },
                { name: 'Loop back', reason: 'CYCLE' },
            ],
        });
    });

    it('is nothing when every row kept its place', () => {
        expect(adjustedReport([])).toBeNull();
        expect(adjustedReport(undefined)).toBeNull();
        expect(adjustedSentences(null)).toEqual([]);
    });

    it('lists a bounded number of rows and still counts them all', () => {
        const many = Array.from({ length: MAX_LISTED + 5 }, (_, i) => ({ _id: i, TaskName: `Row ${i}`, reason: 'TOO_DEEP' }));
        const report = adjustedReport(many);
        expect(report.tooDeep).toBe(MAX_LISTED + 5);
        expect(report.rows).toHaveLength(MAX_LISTED);
    });

    it('says each reason in a sentence, singular and plural', () => {
        expect(adjustedSentences({ tooDeep: 3, parentMissing: 1, cycle: 2 })).toEqual([
            '3 subtasks were deeper than three levels and were placed under their nearest parent.',
            '1 row named a parent that is not in the file and was imported as a task.',
            '2 rows named parents that loop and were imported as tasks.',
        ]);
        expect(adjustedSentences({ tooDeep: 1, parentMissing: 0, cycle: 0 })).toEqual([
            '1 subtask was deeper than three levels and was placed under its nearest parent.',
        ]);
    });
});

describe('a CSV import reports the rows it could not place where the file said', () => {
    const rows = [
        { 'Task Key': 'T-5', Title: 'Too deep', Parent: 'T-3' },
        { 'Task Key': 'T-3', Title: 'Grandchild', Parent: 'T-2' },
        { 'Task Key': 'T-9', Title: 'Orphan', Parent: 'T-404' },
        { 'Task Key': 'T-1', Title: 'Root' },
        { 'Task Key': 'T-2', Title: 'Child', Parent: 'T-1' },
    ];

    it('hands the create path each row with its parent and answers the report', async () => {
        const res = await call(importers.importFromCsv, { rows, projectId: PROJECT, sprintId: SPRINT });
        expect(res.body.status).toBe(true);
        const sent = taskMongo.createMultipleTasks.mock.calls[0][0].tasks;
        expect(sent.map((task) => [task._id, task.ParentTaskId])).toEqual([['T-5', 'T-3'], ['T-3', 'T-2'], ['T-9', 'T-404'], ['T-1', ''], ['T-2', 'T-1']]);
        expect(res.body.data.adjusted).toEqual({
            tooDeep: 1,
            parentMissing: 1,
            cycle: 0,
            rows: [{ name: 'Too deep', reason: 'TOO_DEEP' }, { name: 'Orphan', reason: 'PARENT_MISSING' }],
        });
        expect(res.body.statusText).toMatch(/1 subtask was deeper than three levels/);
    });
});

describe('the importers with one level of subtasks go through the same create path', () => {
    it('a Jira import answers the rows the create path re-hung', async () => {
        taskMongo.createMultipleTasks.mockImplementation(async ({ tasks }) => ({ status: true, createdTasks: tasks, adjusted: [{ _id: 'x', TaskName: 'Sub-task', reason: 'PARENT_MISSING' }] }));
        const res = await call(importers.importFromJira, { rows: [{ Summary: 'Story', Status: 'To Do' }], projectId: PROJECT, sprintId: SPRINT });
        expect(res.body.status).toBe(true);
        expect(res.body.data.adjusted).toMatchObject({ parentMissing: 1, rows: [{ name: 'Sub-task', reason: 'PARENT_MISSING' }] });
    });
});
