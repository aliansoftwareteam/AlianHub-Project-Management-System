const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjects: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider', () => ({ getProvider: jest.fn(), isAnyProviderConfigured: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async () => 3), isPrivileged: (roleType) => roleType === 1 || roleType === 2 }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Knowledge/flag', () => ({ enabledFor: jest.fn() }));
jest.mock('../Modules/Knowledge/askSources', () => ({ askSources: jest.fn() }));

const { visibleProjects } = require('../Modules/Agents/scope');
const { getProvider, isAnyProviderConfigured } = require('../Modules/AICore/llmProvider');
const { getRoleType } = require('../Config/permissionGuard');
const knowledgeFlag = require('../Modules/Knowledge/flag');
const { askSources } = require('../Modules/Knowledge/askSources');
const { ask, sources } = require('../Modules/AI/ask');

const C = '6f0000000000000000000c01';
const PROJECT = '6f0000000000000000000a01';
const ME = '6f0000000000000000000001';

const call = async (handler, { body = {}, companyId = C, uid = ME } = {}) => {
    const res = { send: jest.fn() };
    await handler({ headers: { companyid: companyId }, uid, body }, res);
    expect(res.send).toHaveBeenCalledTimes(1);
    return res.send.mock.calls[0][0];
};

const retrieved = [
    { kind: 'page', id: '6f0000000000000000000b01', ref: 'page:000b01', title: 'Salary plan', project: 'Ops', projectId: PROJECT, detail: 'bands for next year', updatedAt: new Date('2026-09-02T00:00:00Z'), permission: { visibility: 'private', via: 'owner' } },
    { kind: 'task', id: '6f0000000000000000000b02', ref: 'task:000b02', title: 'Budget review', project: 'Ops', projectId: PROJECT, detail: 'check it', updatedAt: new Date('2026-09-01T00:00:00Z'), permission: { visibility: 'project', via: 'project' } },
];

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    getRoleType.mockResolvedValue(3);
    visibleProjects.mockResolvedValue([{ _id: PROJECT, ProjectName: 'Ops' }]);
    knowledgeFlag.enabledFor.mockResolvedValue(false);
    isAnyProviderConfigured.mockReturnValue(true);
});

describe('Ask sends a code beside every sentence the screen displays, and keeps the sentence', () => {
    it('refuses an empty question with its sentence and the question_required code', async () => {
        expect(await call(ask, { body: { question: '   ' } })).toEqual({ status: false, statusText: 'Ask a question first.', code: 'question_required' });
    });

    it('refuses a caller without a company or user with its sentence and the unauthenticated code', async () => {
        const sentence = 'companyId and an authenticated user are required.';
        expect(await call(ask, { body: { question: 'budget' }, uid: '' })).toEqual({ status: false, statusText: sentence, code: 'unauthenticated' });
        expect(await call(sources, { companyId: '' })).toEqual({ status: false, statusText: sentence, code: 'unauthenticated' });
    });

    it('keeps the empty sentence and adds emptyCode when nothing matches', async () => {
        const out = await call(ask, { body: { question: 'budget' } });
        expect(out).toEqual({
            status: true,
            data: {
                configured: true,
                answer: '',
                sources: [],
                mode: 'ask',
                empty: 'Nothing in the projects you can open matches that. Try naming the project or the task.',
                emptyCode: 'no_match',
                scope: { projects: 1, privileged: false },
            },
        });
    });

    it('keeps the source note and kinds and adds noteCode', async () => {
        const out = await call(sources);
        expect(out.status).toBe(true);
        expect(out.data).toEqual({
            configured: true,
            projects: [{ id: PROJECT, name: 'Ops' }],
            kinds: [
                { key: 'task', label: 'Tasks', note: 'title, status, priority, description' },
                { key: 'page', label: 'Docs', note: 'page titles in the same projects' },
            ],
            connected: [],
            note: 'Only projects you can already open. Ask never widens what you can see.',
            noteCode: 'scope',
        });
    });
});

describe('the answer response keeps its shape for the why-this-answer panel', () => {
    it('returns every source with its permission and excerpt, and cites only retrieved passages', async () => {
        knowledgeFlag.enabledFor.mockResolvedValue(true);
        askSources.mockResolvedValue(retrieved);
        getRoleType.mockResolvedValue(2);
        const chat = jest.fn(async () => ({ content: 'Bands are set [page:000b01], see also [task:999999].', totalTokens: 42, model: 'm-1' }));
        getProvider.mockReturnValue({ chat });

        const out = await call(ask, { body: { question: 'salary bands' } });

        expect(out).toEqual({
            status: true,
            statusText: 'OK',
            data: {
                configured: true,
                mode: 'ask',
                answer: 'Bands are set [page:000b01], see also [task:999999].',
                cited: [retrieved[0]],
                sources: retrieved,
                scope: { projects: 1, privileged: true },
                usage: { tokens: 42, model: 'm-1' },
            },
        });
    });

    it('returns sources without a permission field when retrieval is off', async () => {
        isAnyProviderConfigured.mockReturnValue(false);
        mockDb.seed(require('../Config/schemaType').SCHEMA_TYPE.TASKS, { TaskName: 'Budget review', TaskKey: 'OPS-1', statusType: 'open', ProjectID: PROJECT, deletedStatusKey: 0, updatedAt: new Date('2026-09-01T00:00:00Z') });

        const out = await call(ask, { body: { question: 'budget' } });

        expect(out.statusText).toBe('No model configured.');
        expect(out.data.configured).toBe(false);
        expect(out.data.sources).toHaveLength(1);
        expect(out.data.sources[0]).not.toHaveProperty('permission');
        expect(Object.keys(out.data).sort()).toEqual(['answer', 'configured', 'mode', 'scope', 'sources']);
    });
});
