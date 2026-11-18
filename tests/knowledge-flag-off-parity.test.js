const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjects: jest.fn(), visibleProjectIds: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider', () => ({ getProvider: jest.fn(), isAnyProviderConfigured: () => false }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async () => 3), isPrivileged: () => false }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Knowledge/retrieval', () => ({ retrieve: jest.fn() }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { visibleProjects } = require('../Modules/Agents/scope');
const { retrieve } = require('../Modules/Knowledge/retrieval');
const { gather } = require('../Modules/AI/ask');

const C = '6f0000000000000000000c01';
const PROJECT = '6f0000000000000000000a01';
const ME = '6f0000000000000000000001';
const OTHER = '6f0000000000000000000002';
const PRIVATE_SPRINT = '6f0000000000000000000d01';

const QUESTION = 'What is the budget?';
const ENV = process.env.KNOWLEDGE_RETRIEVAL;

let ids;

/* What Ask gathers on beta before the knowledge interface existed, for the rows seeded below. */
const today = () => [
    { kind: 'task', id: ids.review, ref: 'OPS-1', title: 'Budget review', project: 'Ops', projectId: PROJECT, detail: 'In progress · High · Check the numbers', updatedAt: new Date('2026-09-02T00:00:00Z') },
    { kind: 'task', id: ids.cuts, ref: 'OPS-2', title: 'Budget cuts', project: 'Ops', projectId: PROJECT, detail: 'open', updatedAt: new Date('2026-09-01T00:00:00Z') },
    { kind: 'page', id: ids.wiki, ref: `page:${ids.wiki.slice(-6)}`, title: 'Budget wiki', project: 'Ops', projectId: PROJECT, detail: '', updatedAt: new Date('2026-09-03T00:00:00Z') },
];

const TODAY_READS = [[C, SCHEMA_TYPE.SPRINTS, 'find'], [C, SCHEMA_TYPE.TEAMS_MANAGEMENT, 'find'], [C, SCHEMA_TYPE.TASKS, 'find'], [C, SCHEMA_TYPE.PAGES, 'find']];
const COMPANY_READ = [SCHEMA_TYPE.GOLBAL, SCHEMA_TYPE.COMPANIES, 'findOne'];
const readsMade = () => mockDb.calls.map((c) => [String(c.companyId), c.type, c.method]);

const seedWorkspace = ({ companyMode } = {}) => {
    const seed = (type, doc) => String(mockDb.seed(type, doc)._id);
    ids = {
        review: seed(SCHEMA_TYPE.TASKS, { TaskName: 'Budget review', TaskKey: 'OPS-1', status: { text: 'In progress' }, Task_Priority: 'High', rawDescription: 'Check the   numbers', ProjectID: PROJECT, deletedStatusKey: 0, updatedAt: new Date('2026-09-02T00:00:00Z') }),
        cuts: seed(SCHEMA_TYPE.TASKS, { TaskName: 'Budget cuts', TaskKey: 'OPS-2', statusType: 'open', ProjectID: PROJECT, deletedStatusKey: 0, updatedAt: new Date('2026-09-01T00:00:00Z') }),
        payroll: seed(SCHEMA_TYPE.TASKS, { TaskName: 'Budget payroll', TaskKey: 'OPS-4', ProjectID: PROJECT, sprintId: PRIVATE_SPRINT, deletedStatusKey: 0, updatedAt: new Date('2026-09-05T00:00:00Z') }),
        lunch: seed(SCHEMA_TYPE.TASKS, { TaskName: 'Lunch order', TaskKey: 'OPS-3', rawDescription: 'the body mentions budget but the title does not', ProjectID: PROJECT, deletedStatusKey: 1, updatedAt: new Date('2026-09-04T00:00:00Z') }),
        wiki: seed(SCHEMA_TYPE.PAGES, { title: 'Budget wiki', rawText: 'numbers', ProjectID: PROJECT, visibility: 'project', createdBy: OTHER, deletedStatusKey: 0, updatedAt: new Date('2026-09-03T00:00:00Z') }),
        bodyOnly: seed(SCHEMA_TYPE.PAGES, { title: 'Quarterly plan', rawText: 'the budget lives in the body', ProjectID: PROJECT, visibility: 'project', createdBy: OTHER, deletedStatusKey: 0, updatedAt: new Date('2026-09-03T00:00:00Z') }),
        hidden: seed(SCHEMA_TYPE.PAGES, { title: 'Budget private', ProjectID: PROJECT, visibility: 'private', createdBy: OTHER, deletedStatusKey: 0, updatedAt: new Date('2026-09-03T00:00:00Z') }),
    };
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: PRIVATE_SPRINT, projectId: PROJECT, private: true, AssigneeUserId: [OTHER], deletedStatusKey: 0 });
    const company = { _id: C, Cst_CompanyName: 'Acme' };
    if (companyMode !== undefined) company.knowledgeRetrieval = { mode: companyMode };
    mockDb.seed(SCHEMA_TYPE.COMPANIES, company);
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    myCache.flushAll();
    jest.clearAllMocks();
    visibleProjects.mockResolvedValue([{ _id: PROJECT, ProjectName: 'Ops' }]);
});

afterAll(() => {
    if (ENV === undefined) delete process.env.KNOWLEDGE_RETRIEVAL;
    else process.env.KNOWLEDGE_RETRIEVAL = ENV;
});

describe('with knowledge retrieval off, Ask gathers exactly what it gathers today', () => {
    it.each([
        ['unset', undefined],
        ['off', 'off'],
        ['an unrecognised value', 'yes please'],
    ])('KNOWLEDGE_RETRIEVAL %s: the same sources from the same two reads, and no company lookup', async (label, value) => {
        if (value === undefined) delete process.env.KNOWLEDGE_RETRIEVAL;
        else process.env.KNOWLEDGE_RETRIEVAL = value;
        seedWorkspace({ companyMode: 'on' });

        const out = await gather(C, ME, { question: QUESTION });

        expect(out.sources).toEqual(today());
        expect(out.scopedProjectIds).toEqual([PROJECT]);
        expect(readsMade()).toEqual(TODAY_READS);
        expect(retrieve).not.toHaveBeenCalled();
    });

    it.each([
        ['tenant, and the company never opted in', 'tenant', undefined],
        ['tenant, and the company turned it off', 'tenant', 'off'],
        ['all, and the company turned it off', 'all', 'off'],
    ])('KNOWLEDGE_RETRIEVAL %s: the same sources, after one read of the company row', async (label, value, companyMode) => {
        process.env.KNOWLEDGE_RETRIEVAL = value;
        seedWorkspace({ companyMode });

        const out = await gather(C, ME, { question: QUESTION });

        expect(out.sources).toEqual(today());
        expect(readsMade()).toEqual([COMPANY_READ, ...TODAY_READS]);
        expect(retrieve).not.toHaveBeenCalled();
    });

    it('still ignores a project the caller cannot open and leaves a question with no terms unfiltered', async () => {
        delete process.env.KNOWLEDGE_RETRIEVAL;
        seedWorkspace();

        const scoped = await gather(C, ME, { question: QUESTION, projectId: '6f0000000000000000000a99' });
        expect(scoped.sources).toEqual(today());

        myCache.flushAll();
        const noTerms = await gather(C, ME, { question: 'the' });
        expect(noTerms.sources.map((s) => s.id)).toEqual([ids.review, ids.cuts, ids.wiki, ids.bodyOnly]);
    });
});
