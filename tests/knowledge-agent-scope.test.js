/* An agent retrieving during a run sees what its starter can see, limited to the agent's own
 * projects (owner, 2026-09-18), for every source keyed by project. Until the owner decides what an
 * agent with no projects may read, it reads no project-scoped content. With KNOWLEDGE_AGENT_MEMORY
 * off an agent caller retrieves as it did before this rule. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(), visibleProjects: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(), evaluatePermission: jest.fn(), isReadable: (value) => value !== null && value !== undefined && value !== 0, isPrivileged: (roleType) => roleType === 1 || roleType === 2 }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../common-storage/readStoredFile', () => ({ readStoredFile: jest.fn() }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const { getRoleType, evaluatePermission } = require('../Config/permissionGuard');
const { knowledgeChunksSchema, taskSchema, pagesSchema, commentSchema } = require('../utils/mongo-handler/createSchema');
const { readStoredFile } = require('../common-storage/readStoredFile');
const { retrieve } = require('../Modules/Knowledge/retrieval');
const { RetrievalRefused } = require('../Modules/Knowledge/visibleSet');
const agentScope = require('../Modules/Knowledge/agentScope');
const indexer = require('../Modules/Knowledge/ingest/indexer');

const C = '6f0000000000000000000c01';
const STARTER = '6f0000000000000000000011';
const SHARED = '6f0000000000000000000a01';
const SECRET = '6f0000000000000000000a02';
const SCOPED = '6f00000000000000000000e1';
const UNSCOPED = '6f00000000000000000000e2';
const ENV = { indexer: process.env.KNOWLEDGE_INDEXER, memory: process.env.KNOWLEDGE_AGENT_MEMORY };
const CHUNKS = SCHEMA_TYPE.KNOWLEDGE_CHUNKS;
const at = (day) => new Date(`2026-09-${String(day).padStart(2, '0')}T00:00:00Z`);
const rowOf = (type, id) => mockDb.store[type].find((row) => String(row._id) === String(id));

const files = new Map();
let attachmentSeq = 0;

const SEED = {
    task: async (projectId, word) => String(mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: `Task ${word}`, rawDescription: word, CompanyId: C, ProjectID: projectId, deletedStatusKey: 0, updatedAt: at(1) })._id),
    page: async (projectId, word) => String(mockDb.seed(SCHEMA_TYPE.PAGES, { title: `Page ${word}`, rawText: word, visibility: 'project', createdBy: STARTER, ProjectID: projectId, deletedStatusKey: 0, updatedAt: at(1) })._id),
    comment: async (projectId, word) => String(mockDb.seed(SCHEMA_TYPE.COMMENTS, { message: `Comment ${word}`, type: 'text', userId: STARTER, projectId, updatedAt: at(1) })._id),
    guide: async (projectId, word) => {
        Object.assign(rowOf(SCHEMA_TYPE.PROJECTS, projectId), { aiGuide: { markdown: `# Guide\n\nThe guide says ${word}.` } });
        await indexer.syncGuide(C, projectId);
        return projectId;
    },
    file: async (projectId, word) => {
        attachmentSeq += 1;
        const task = mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Carrier', CompanyId: C, ProjectID: projectId, deletedStatusKey: 0, updatedAt: at(1), attachments: [] });
        const text = `The file says ${word}.`;
        const attached = { id: `sco${String(attachmentSeq).padStart(14, '0')}`, filename: 'notes.txt', extension: 'txt', size: text.length, userId: STARTER, url: `Project/${projectId}/Sprint/${task._id}/Attachment/${attachmentSeq}-notes.txt` };
        task.attachments = [attached];
        files.set(`${C}:${attached.url}`, Buffer.from(text));
        await indexer.syncTaskFiles(C, String(task._id));
        return indexer.fileSourceId(task._id, attached.id);
    },
    transcript: async (projectId, word) => String(mockDb.seed(SCHEMA_TYPE.CALLS, { title: 'Call', transcript: `The call says ${word}.`, participants: [STARTER], projectId, deletedStatusKey: 0, updatedAt: at(1) })._id),
};

let runSeq = 0;
const runFor = (agentId, over = {}) => {
    runSeq += 1;
    return String(mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { _id: `6f0000000000000000077${String(runSeq).padStart(3, '0')}`, agentId, startedBy: STARTER, status: 'running', ...over })._id);
};

const asAgent = (agentId, word, sourceType, runId = runFor(agentId)) => retrieve({ companyId: C, caller: { kind: 'agent', userId: STARTER, agentId, runId }, query: word, scope: { sourceTypes: [sourceType] } })
    .then((result) => result.passages.map((p) => p.sourceId));

const setEnv = (key, value) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; };

afterAll(() => {
    setEnv('KNOWLEDGE_INDEXER', ENV.indexer);
    setEnv('KNOWLEDGE_AGENT_MEMORY', ENV.memory);
});

beforeEach(() => {
    process.env.KNOWLEDGE_INDEXER = 'tenant';
    process.env.KNOWLEDGE_AGENT_MEMORY = 'on';
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    files.clear();
    jest.clearAllMocks();
    myCache.flushAll();
    mockDb.uniqueFromSchema(CHUNKS, knowledgeChunksSchema);
    mockDb.textFromSchema(CHUNKS, knowledgeChunksSchema);
    mockDb.textFromSchema(SCHEMA_TYPE.TASKS, taskSchema);
    mockDb.textFromSchema(SCHEMA_TYPE.PAGES, pagesSchema);
    mockDb.textFromSchema(SCHEMA_TYPE.COMMENTS, commentSchema);
    getRoleType.mockImplementation(async () => 3);
    evaluatePermission.mockImplementation(async () => true);
    visibleProjectIds.mockImplementation(async () => [SHARED, SECRET]);
    readStoredFile.mockImplementation(async ({ companyId, key }) => {
        const buffer = files.get(`${companyId}:${key}`);
        if (!buffer) throw Object.assign(new Error('not found'), { code: 'not_found' });
        return { buffer, size: buffer.length };
    });
    mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: C, knowledgeIndexer: { mode: 'on' } });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: SHARED, ProjectName: 'Shared', deletedStatusKey: 0, updatedAt: at(1) });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: SECRET, ProjectName: 'Secret', deletedStatusKey: 0, updatedAt: at(1) });
    mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: SCOPED, name: 'Scoped', projectIds: [SECRET], deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: UNSCOPED, name: 'Unscoped', projectIds: [], deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: STARTER, status: 2, isDelete: false });
    ['guide', 'file'].forEach((sourceType) => mockDb.seed(SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE, { companyId: C, sourceType, status: 'complete', lastSeenOnAt: new Date(), originFilledAt: new Date() }));
});

describe.each(Object.keys(SEED))('an agent-scoped run reading %s', (sourceType) => {
    it("sees only the agent's projects, though its starter sees both", async () => {
        const inScope = await SEED[sourceType](SECRET, 'bollard');
        const outOfScope = await SEED[sourceType](SHARED, 'bollard');

        const ids = await asAgent(SCOPED, 'bollard', sourceType);
        expect(ids).toContain(inScope);
        expect(ids).not.toContain(outOfScope);
    });

    it('sees nothing keyed by a project for an agent with no projects', async () => {
        await SEED[sourceType](SECRET, 'bollard');
        await SEED[sourceType](SHARED, 'bollard');
        expect(await asAgent(UNSCOPED, 'bollard', sourceType)).toEqual([]);
    });

    it('retrieves as before with the memory switch off', async () => {
        process.env.KNOWLEDGE_AGENT_MEMORY = 'off';
        const inScope = await SEED[sourceType](SECRET, 'bollard');
        const outOfScope = await SEED[sourceType](SHARED, 'bollard');
        expect((await asAgent(SCOPED, 'bollard', sourceType)).sort()).toEqual([inScope, outOfScope].sort());
    });
});

describe('content outside any project (owner decision pending)', () => {
    const companyPage = (over = {}) => String(mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Page bollard', rawText: 'bollard', visibility: 'project', createdBy: STARTER, ProjectID: null, deletedStatusKey: 0, updatedAt: at(1), ...over })._id);
    const looseCall = () => String(mockDb.seed(SCHEMA_TYPE.CALLS, { title: 'Call', transcript: 'The call says bollard.', participants: [STARTER], projectId: null, deletedStatusKey: 0, updatedAt: at(1) })._id);

    it.each([SCOPED, UNSCOPED])('keeps company-level pages, private or not, from agent %s', async (agentId) => {
        companyPage();
        companyPage({ visibility: 'private' });
        expect(await asAgent(agentId, 'bollard', 'page')).toEqual([]);
    });

    it.each([SCOPED, UNSCOPED])('keeps calls with no project from agent %s', async (agentId) => {
        looseCall();
        expect(await asAgent(agentId, 'bollard', 'transcript')).toEqual([]);
    });

    it('reads it through one named rule, closed until the owner decides', () => {
        expect(agentScope.agentsReachContentWithoutProject()).toBe(false);
    });

    it('still reaches a person asking', async () => {
        const page = companyPage();
        const call = looseCall();
        const asked = (sourceType) => retrieve({ companyId: C, caller: { kind: 'user', userId: STARTER }, query: 'bollard', scope: { sourceTypes: [sourceType] } }).then((r) => r.passages.map((p) => p.sourceId));
        expect(await asked('page')).toEqual([page]);
        expect(await asked('transcript')).toEqual([call]);
    });
});

describe('the run a retrieval names', () => {
    it('is refused when it is missing, not running, or another agent\'s or another starter\'s', async () => {
        const OTHER = '6f0000000000000000000019';
        const cases = [
            '6f0000000000000000066666',
            runFor(SCOPED, { status: 'done' }),
            runFor(UNSCOPED),
            runFor(SCOPED, { startedBy: OTHER }),
        ];
        for (const runId of cases) {
            await expect(asAgent(SCOPED, 'bollard', 'task', runId)).rejects.toBeInstanceOf(RetrievalRefused);
        }
    });

    it('is refused when the caller names none', async () => {
        await expect(retrieve({ companyId: C, caller: { kind: 'agent', userId: STARTER, agentId: SCOPED }, query: 'bollard', scope: { sourceTypes: ['task'] } })).rejects.toBeInstanceOf(RetrievalRefused);
    });

    it('started by an event, with no starter, still retrieves project content as the caller', async () => {
        const inScope = await SEED.task(SECRET, 'bollard');
        expect(await asAgent(SCOPED, 'bollard', 'task', runFor(SCOPED, { startedBy: null }))).toEqual([inScope]);
    });
});

describe('the narrowed set', () => {
    const set = (over = {}) => ({ companyId: C, caller: { kind: 'agent', userId: STARTER, agentId: SCOPED, runId: runFor(SCOPED) }, projectIds: [SHARED, SECRET], fileProjectIds: [SHARED, SECRET], hiddenSprintIds: [], sourceTypes: ['file'], ...over });

    it('narrows every per-project list', async () => {
        const narrowed = await agentScope.narrowToAgent(set());
        expect(narrowed.projectIds).toEqual([SECRET]);
        expect(narrowed.fileProjectIds).toEqual([SECRET]);
    });

    it('reads an agent with no projects through one named rule, closed until the owner decides', async () => {
        expect(agentScope.projectsForAgentWithoutProjects([SHARED, SECRET])).toEqual([]);
        const narrowed = await agentScope.narrowToAgent(set({ caller: { kind: 'agent', userId: STARTER, agentId: UNSCOPED, runId: runFor(UNSCOPED) } }));
        expect(narrowed).toMatchObject({ projectIds: [], fileProjectIds: [] });
    });

    it('refuses an agent caller naming no agent or a deleted one only with the switch on', async () => {
        await expect(agentScope.narrowToAgent(set({ caller: { kind: 'agent', userId: STARTER } }))).rejects.toBeInstanceOf(RetrievalRefused);
        process.env.KNOWLEDGE_AGENT_MEMORY = 'off';
        const unchanged = set({ caller: { kind: 'agent', userId: STARTER, agentId: 'a1' } });
        expect(await agentScope.narrowToAgent(unchanged)).toBe(unchanged);
    });
});
