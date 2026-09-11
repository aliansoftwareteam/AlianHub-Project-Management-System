const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjects: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider', () => ({ getProvider: jest.fn(), isAnyProviderConfigured: () => false }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async () => 3), isPrivileged: () => false }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { visibleProjects } = require('../Modules/Agents/scope');
const { gather } = require('../Modules/AI/ask');

const C = '6f0000000000000000000c01';
const PROJECT = '6f0000000000000000000a01';
const ME = '6f0000000000000000000001';
const OTHER = '6f0000000000000000000002';

const page = (over) => mockDb.seed(SCHEMA_TYPE.PAGES, { ProjectID: PROJECT, deletedStatusKey: 0, visibility: 'project', updatedAt: new Date(), ...over });
const titles = (out) => out.sources.filter((s) => s.kind === 'page').map((s) => s.title).sort();

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
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
