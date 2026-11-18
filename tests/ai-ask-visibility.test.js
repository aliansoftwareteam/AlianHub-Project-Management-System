const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjects: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider', () => ({ getProvider: jest.fn(), isAnyProviderConfigured: () => false }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(), isPrivileged: (roleType) => roleType === 1 || roleType === 2 }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { visibleProjects } = require('../Modules/Agents/scope');
const { getRoleType } = require('../Config/permissionGuard');
const { gather } = require('../Modules/AI/ask');

const C = '6f0000000000000000000c01';
const PROJECT = '6f0000000000000000000a01';
const ME = '6f0000000000000000000001';
const OTHER = '6f0000000000000000000002';
const PRIVATE_SPRINT = '6f0000000000000000000d01';

const page = (over) => mockDb.seed(SCHEMA_TYPE.PAGES, { ProjectID: PROJECT, deletedStatusKey: 0, visibility: 'project', updatedAt: new Date(), ...over });
const titles = (out) => out.sources.filter((s) => s.kind === 'page').map((s) => s.title).sort();
const task = (over) => mockDb.seed(SCHEMA_TYPE.TASKS, { ProjectID: PROJECT, deletedStatusKey: 0, updatedAt: new Date(), ...over });
const taskTitles = (out) => out.sources.filter((s) => s.kind === 'task').map((s) => s.title).sort();

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    getRoleType.mockResolvedValue(3);
    visibleProjects.mockResolvedValue([{ _id: PROJECT, ProjectName: 'Ops' }]);
});

describe('defect 4 — Ask retrieval applies page visibility', () => {
    it('leaves another member\'s private page out of the sources, even in a project the asker can open', async () => {
        page({ title: 'Salary review notes', visibility: 'private', createdBy: OTHER });
        page({ title: 'Salary bands (public)', createdBy: OTHER });
        page({ title: 'Salary plan draft', visibility: 'private', createdBy: ME });

        const out = await gather(C, ME, { question: 'salary' });
        expect(titles(out)).toEqual(['Salary bands (public)', 'Salary plan draft']);
    });

    it('still narrows by the question\'s terms alongside the visibility rule', async () => {
        page({ title: 'Release checklist', createdBy: OTHER });
        page({ title: 'Lunch menu', createdBy: OTHER });
        page({ title: 'Release secrets', visibility: 'private', createdBy: OTHER });

        const out = await gather(C, ME, { question: 'release' });
        expect(titles(out)).toEqual(['Release checklist']);
    });

    it('applies the rule when the question has no usable search terms', async () => {
        page({ title: 'Private only', visibility: 'private', createdBy: OTHER });
        const out = await gather(C, ME, { question: 'the' });
        expect(titles(out)).toEqual([]);
    });
});

describe('Ask retrieval applies private-sprint visibility', () => {
    const privateSprintOn = (assignees) => {
        mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: PRIVATE_SPRINT, projectId: PROJECT, private: true, AssigneeUserId: assignees, deletedStatusKey: 0 });
        task({ TaskName: 'Payroll plan' });
        task({ TaskName: 'Payroll run', sprintId: PRIVATE_SPRINT });
    };

    it('leaves a private-sprint task out of the sources for a member who is not on the sprint', async () => {
        privateSprintOn([OTHER]);
        const out = await gather(C, ME, { question: 'payroll' });
        expect(taskTitles(out)).toEqual(['Payroll plan']);
    });

    it('keeps the task for a member assigned to the sprint', async () => {
        privateSprintOn([ME]);
        const out = await gather(C, ME, { question: 'payroll' });
        expect(taskTitles(out)).toEqual(['Payroll plan', 'Payroll run']);
    });

    it('keeps the task for an admin who is not on the sprint', async () => {
        getRoleType.mockResolvedValue(2);
        privateSprintOn([OTHER]);
        const out = await gather(C, ME, { question: 'payroll' });
        expect(taskTitles(out)).toEqual(['Payroll plan', 'Payroll run']);
    });
});
