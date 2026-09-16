const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjects: jest.fn(), visibleProjectIds: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider', () => ({ getProvider: jest.fn(), isAnyProviderConfigured: () => false }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async () => 3), isPrivileged: () => false }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Knowledge/retrieval', () => ({ retrieve: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { visibleProjects } = require('../Modules/Agents/scope');
const { retrieve } = require('../Modules/Knowledge/retrieval');
const flag = require('../Modules/Knowledge/flag');
const { gather } = require('../Modules/AI/ask');

const C = '6f0000000000000000000c01';
const PROJECT = '6f0000000000000000000a01';
const OUTSIDE = '6f0000000000000000000a02';
const ME = '6f0000000000000000000001';
const ENV = process.env.KNOWLEDGE_RETRIEVAL;

const companyWith = (mode) => mockDb.seed(SCHEMA_TYPE.COMPANIES, mode === undefined ? { _id: C } : { _id: C, knowledgeRetrieval: { mode } });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    delete process.env.KNOWLEDGE_RETRIEVAL;
});

afterAll(() => {
    if (ENV === undefined) delete process.env.KNOWLEDGE_RETRIEVAL;
    else process.env.KNOWLEDGE_RETRIEVAL = ENV;
});

describe('KNOWLEDGE_RETRIEVAL', () => {
    it.each([
        [undefined, 'off'],
        ['off', 'off'],
        [' Tenant ', 'tenant'],
        ['ALL', 'all'],
        ['on', 'off'],
    ])('reads %p as %p', (value, expected) => {
        if (value !== undefined) process.env.KNOWLEDGE_RETRIEVAL = value;
        expect(flag.mode()).toBe(expected);
    });

    it.each([
        ['off', 'on', false],
        ['tenant', undefined, false],
        ['tenant', 'off', false],
        ['tenant', 'on', true],
        ['all', undefined, true],
        ['all', 'on', true],
        ['all', 'off', false],
    ])('%s with the company mode %p is %p', async (env, companyMode, expected) => {
        process.env.KNOWLEDGE_RETRIEVAL = env;
        companyWith(companyMode);
        expect(await flag.enabledFor(C)).toBe(expected);
    });

    describe('reads the company switch however it was stored', () => {
        const stored = (value) => mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: C, knowledgeRetrieval: value });
        const OFF_SHAPES = [
            ['a bare string', 'off'],
            ['a bare string in capitals with spaces', ' OFF '],
            ['a mode in capitals', { mode: 'OFF' }],
            ['a mode with spaces', { mode: ' off ' }],
            ['a boolean mode', { mode: false }],
            ['a bare boolean', false],
            ['an unrecognised mode', { mode: 'paused' }],
        ];
        const ON_SHAPES = [
            ['a bare string', 'on'],
            ['a mode in capitals', { mode: ' ON ' }],
            ['a boolean mode', { mode: true }],
        ];
        const ABSENT_SHAPES = [
            ['an empty object', {}],
            ['an empty mode', { mode: '' }],
            ['null', null],
        ];

        it.each(['tenant', 'all'].flatMap((env) => OFF_SHAPES.map(([label, value]) => [env, label, value])))('%s: an opt-out stored as %s is off', async (env, label, value) => {
            process.env.KNOWLEDGE_RETRIEVAL = env;
            stored(value);
            expect(await flag.enabledFor(C)).toBe(false);
        });

        it.each(['tenant', 'all'].flatMap((env) => ON_SHAPES.map(([label, value]) => [env, label, value])))('%s: an opt-in stored as %s is on', async (env, label, value) => {
            process.env.KNOWLEDGE_RETRIEVAL = env;
            stored(value);
            expect(await flag.enabledFor(C)).toBe(true);
        });

        it.each(ABSENT_SHAPES)('a switch stored as %s is absent: off under tenant, on under all', async (label, value) => {
            stored(value);
            process.env.KNOWLEDGE_RETRIEVAL = 'tenant';
            expect(await flag.enabledFor(C)).toBe(false);
            process.env.KNOWLEDGE_RETRIEVAL = 'all';
            expect(await flag.enabledFor(C)).toBe(true);
        });
    });

    it('never reads the company row while the installation is off', async () => {
        companyWith('on');
        expect(await flag.enabledFor(C)).toBe(false);
        expect(mockDb.calls).toEqual([]);
    });

    it('is off for a malformed company id or a company row that cannot be read', async () => {
        process.env.KNOWLEDGE_RETRIEVAL = 'all';
        expect(await flag.enabledFor('not-an-id')).toBe(false);
        expect(mockDb.calls).toEqual([]);
        const crud = mockDb.crud.getMockImplementation();
        mockDb.crud.mockImplementation(async () => { throw new Error('down'); });
        try {
            expect(await flag.enabledFor(C)).toBe(false);
        } finally {
            mockDb.crud.mockImplementation(crud);
        }
    });
});

describe('the company switch in the schema', () => {
    it('survives the company cache: a company row carrying it can still be cloned into node-cache', () => {
        const mongoose = require('mongoose');
        const NodeCache = require('node-cache');
        const { companies } = require('../utils/mongo-handler/createSchema');
        const Company = new mongoose.Mongoose().model('companies', companies, 'companies');
        const row = Company.hydrate({ _id: C, Cst_CompanyName: 'Acme', knowledgeRetrieval: { mode: 'on' } });

        const cache = new NodeCache();
        expect(() => cache.set(`companyData_${C}`, row)).not.toThrow();
        expect(row.knowledgeRetrieval).toEqual({ mode: 'on' });
    });
});

describe('Ask with retrieval on for the company', () => {
    beforeEach(() => {
        process.env.KNOWLEDGE_RETRIEVAL = 'tenant';
        companyWith('on');
        visibleProjects.mockResolvedValue([{ _id: PROJECT, ProjectName: 'Ops' }]);
        retrieve.mockResolvedValue({
            backend: 'lexical',
            scope: {},
            passages: [
                { id: 'page:6f0000000000000000000b01', sourceType: 'page', sourceId: '6f0000000000000000000b01', projectId: '', title: 'Travel policy', excerpt: 'the travel budget', score: 2, authorKind: 'user', updatedAt: new Date('2026-09-01T00:00:00Z'), permission: { visibility: 'company', via: 'company' } },
                { id: 'task:6f0000000000000000000b02', sourceType: 'task', sourceId: '6f0000000000000000000b02', projectId: PROJECT, title: 'Budget review', excerpt: 'check it', score: 1, authorKind: 'user', updatedAt: new Date('2026-09-02T00:00:00Z'), permission: { visibility: 'project', via: 'project' } },
            ],
        });
    });

    it('gathers through retrieve() as the asking user and reads no task or page itself', async () => {
        const out = await gather(C, ME, { question: 'What is the budget?' });

        expect(retrieve).toHaveBeenCalledWith({ companyId: C, caller: { kind: 'user', userId: ME }, query: 'What is the budget?', scope: {}, limit: 18 });
        expect(mockDb.calls.map((c) => c.type)).toEqual([SCHEMA_TYPE.COMPANIES]);
        expect(out.sources).toEqual([
            { kind: 'page', id: '6f0000000000000000000b01', ref: 'page:000b01', title: 'Travel policy', project: '', projectId: '', detail: 'the travel budget', updatedAt: new Date('2026-09-01T00:00:00Z'), permission: { visibility: 'company', via: 'company' } },
            { kind: 'task', id: '6f0000000000000000000b02', ref: 'task:000b02', title: 'Budget review', project: 'Ops', projectId: PROJECT, detail: 'check it', updatedAt: new Date('2026-09-02T00:00:00Z'), permission: { visibility: 'project', via: 'project' } },
        ]);
    });

    it('scopes to a project only when the caller can open it, as Ask always has', async () => {
        await gather(C, ME, { question: 'budget', projectId: PROJECT });
        expect(retrieve.mock.calls[0][0].scope).toEqual({ projectId: PROJECT });

        await gather(C, ME, { question: 'budget', projectId: OUTSIDE });
        expect(retrieve.mock.calls[1][0].scope).toEqual({});
    });

    it('still searches company-wide pages and transcripts for someone with no project', async () => {
        visibleProjects.mockResolvedValue([]);
        const out = await gather(C, ME, { question: 'budget', limit: 24 });
        expect(retrieve.mock.calls[0][0].limit).toBe(30);
        expect(out.sources).toHaveLength(2);
    });
});
