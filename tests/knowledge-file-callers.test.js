/* File passages for callers that are not the web app. A personal API token reaches Ask through
 * the same REST routes as a browser session, as the person who owns it, so it must get exactly
 * the passages that person gets: projects they can open, sprints shared with them, and the task
 * attachments permission. A token narrowed to some projects (an agent token) reads only those,
 * as the MCP tools already hold it to. The MCP server itself exposes no tool that returns
 * retrieval passages; the last block pins that, so adding one comes with its own review. */
const fs = require('fs');
const path = require('path');

const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(), visibleProjects: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(), evaluatePermission: jest.fn(), isReadable: (value) => value !== null && value !== undefined && value !== 0, isPrivileged: (roleType) => roleType === 1 || roleType === 2 }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../common-storage/readStoredFile', () => ({ readStoredFile: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider', () => ({
    isAnyProviderConfigured: () => false,
    getProvider: () => { throw new Error('No model is called in these tests.'); },
}));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { visibleProjectIds, visibleProjects } = require('../Modules/Agents/scope');
const { getRoleType, evaluatePermission } = require('../Config/permissionGuard');
const { knowledgeChunksSchema, taskSchema, pagesSchema } = require('../utils/mongo-handler/createSchema');
const { readStoredFile } = require('../common-storage/readStoredFile');
const indexer = require('../Modules/Knowledge/ingest/indexer');
const askController = require('../Modules/AI/ask');

const C = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000011';
const MEMBER = '6f0000000000000000000013';
const SPRINTER = '6f0000000000000000000014';
const SHARED = '6f0000000000000000000a01';
const SECRET = '6f0000000000000000000a02';
const OPEN_SPRINT = '6f0000000000000000000d01';
const PRIVATE_SPRINT = '6f0000000000000000000d02';
const ENV_KEYS = ['KNOWLEDGE_INDEXER', 'KNOWLEDGE_RETRIEVAL', 'KNOWLEDGE_FLAG_CACHE_TTL_SECONDS'];
const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

const ROLES = { [OWNER]: 1, [MEMBER]: 3, [SPRINTER]: 3 };
const PROJECTS = { [OWNER]: [SHARED, SECRET], [MEMBER]: [SHARED], [SPRINTER]: [SHARED] };
const NAMES = { [SHARED]: 'Shared', [SECRET]: 'Secret' };

const files = new Map();
let attachmentSeq = 0;

const file = async (text, taskOver = {}) => {
    attachmentSeq += 1;
    const task = mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Item', CompanyId: C, ProjectID: SHARED, sprintId: OPEN_SPRINT, deletedStatusKey: 0, updatedAt: new Date(), attachments: [], ...taskOver });
    const attached = { id: `cal${String(attachmentSeq).padStart(14, '0')}`, filename: 'notes.txt', extension: 'txt', size: text.length, userId: MEMBER, url: `Project/${task.ProjectID}/Sprint/${task._id}/Attachment/${attachmentSeq}-notes.txt` };
    task.attachments = [attached];
    files.set(`${C}:${attached.url}`, Buffer.from(text));
    await indexer.syncTaskFiles(C, String(task._id));
    return indexer.fileSourceId(task._id, attached.id);
};

const session = (uid) => ({ uid });
const personalToken = (uid, scopes = ['read', 'write']) => ({ uid, apiToken: { _id: 'pat1', kind: 'personal', userId: uid, scopes, projectIds: [] } });
const agentToken = (uid, projectIds) => ({ uid, apiToken: { _id: 'pat2', kind: 'agent', userId: uid, scopes: ['read', 'write'], projectIds } });

const call = async (handler, caller, body = {}) => {
    const res = { status: jest.fn(() => res), send: jest.fn(), json: jest.fn() };
    await handler({ method: 'POST', headers: { companyid: C }, body, query: {}, ...caller }, res);
    const sent = res.send.mock.calls[0][0];
    expect(sent.status).toBe(true);
    return sent.data;
};

const asked = async (caller, question, body = {}) => (await call(askController.ask, caller, { question, ...body })).sources;
const fileIds = (sources) => sources.filter((s) => s.kind === 'file').map((s) => s.id);
const kindsAndIds = (sources) => sources.map((s) => `${s.kind}:${s.id}`).sort();

beforeAll(() => {
    process.env.KNOWLEDGE_INDEXER = 'tenant';
    process.env.KNOWLEDGE_RETRIEVAL = 'tenant';
    process.env.KNOWLEDGE_FLAG_CACHE_TTL_SECONDS = '0';
});

afterAll(() => {
    ENV_KEYS.forEach((key) => {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
    });
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    files.clear();
    jest.clearAllMocks();
    myCache.flushAll();
    mockDb.uniqueFromSchema(SCHEMA_TYPE.KNOWLEDGE_CHUNKS, knowledgeChunksSchema);
    mockDb.textFromSchema(SCHEMA_TYPE.KNOWLEDGE_CHUNKS, knowledgeChunksSchema);
    mockDb.textFromSchema(SCHEMA_TYPE.TASKS, taskSchema);
    mockDb.textFromSchema(SCHEMA_TYPE.PAGES, pagesSchema);
    getRoleType.mockImplementation(async (companyId, uid) => ROLES[uid]);
    evaluatePermission.mockImplementation(async () => true);
    visibleProjectIds.mockImplementation(async (companyId, uid) => PROJECTS[uid] || []);
    visibleProjects.mockImplementation(async (companyId, uid) => (PROJECTS[uid] || []).map((id) => ({ _id: id, ProjectName: NAMES[id] })));
    readStoredFile.mockImplementation(async ({ companyId, key }) => {
        const buffer = files.get(`${companyId}:${key}`);
        if (!buffer) throw Object.assign(new Error('not found'), { code: 'not_found' });
        return { buffer, size: buffer.length };
    });
    mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: C, knowledgeIndexer: { mode: 'on' }, knowledgeRetrieval: { mode: 'on' } });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: SHARED, ProjectName: 'Shared', deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: SECRET, ProjectName: 'Secret', deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: OPEN_SPRINT, projectId: SHARED, private: false, AssigneeUserId: [] });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: PRIVATE_SPRINT, projectId: SHARED, private: true, AssigneeUserId: [SPRINTER] });
    [OWNER, MEMBER, SPRINTER].forEach((userId) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, status: 2, isDelete: false }));
    ['file', 'guide'].forEach((sourceType) => mockDb.seed(SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE, { companyId: C, sourceType, status: 'complete', lastSeenOnAt: new Date(), originFilledAt: new Date() }));
});

describe('a personal API token reads file passages as its owner does in the web app', () => {
    it('gets the same passages as the session, from the projects the owner can open only', async () => {
        const shared = await file('The winch manual for the north quay.');
        await file('The winch invoice for the secret yard.', { ProjectID: SECRET });

        const inBrowser = await asked(session(MEMBER), 'winch');
        expect(fileIds(inBrowser)).toEqual([shared]);
        expect(kindsAndIds(await asked(personalToken(MEMBER), 'winch'))).toEqual(kindsAndIds(inBrowser));
    });

    it('does not get a file on a task in a private sprint the owner is not on', async () => {
        const open = await file('The crane rota, open sprint.');
        const hidden = await file('The crane rota, private sprint.', { sprintId: PRIVATE_SPRINT });

        expect(fileIds(await asked(personalToken(MEMBER), 'crane'))).toEqual([open]);
        expect(fileIds(await asked(personalToken(SPRINTER), 'crane')).sort()).toEqual([open, hidden].sort());
    });

    it('does not get a file where the owner\'s role cannot see task attachments', async () => {
        await file('The pontoon quote.');
        evaluatePermission.mockImplementation(async (companyId, uid, key) => (key === 'task.task_attachments' ? null : true));

        expect(fileIds(await asked(session(MEMBER), 'pontoon'))).toEqual([]);
        expect(fileIds(await asked(personalToken(MEMBER), 'pontoon'))).toEqual([]);
    });

    it('reads for the token\'s owner, whatever user the body names', async () => {
        await file('The dredging survey.', { ProjectID: SECRET });

        const sources = await asked(personalToken(MEMBER), 'dredging', { userData: { id: OWNER }, uid: OWNER });
        expect(fileIds(sources)).toEqual([]);
    });
});

describe('a token narrowed to some projects', () => {
    it('reads file passages from those projects only, although its owner can open more', async () => {
        const shared = await file('The buoy budget for the quay.');
        const secret = await file('The buoy budget for the yard.', { ProjectID: SECRET });

        expect(fileIds(await asked(session(OWNER), 'buoy')).sort()).toEqual([shared, secret].sort());
        expect(fileIds(await asked(agentToken(OWNER, [SHARED]), 'buoy'))).toEqual([shared]);
    });

    it('cannot reach a project outside the narrowing by naming it', async () => {
        await file('The mooring chart for the yard.', { ProjectID: SECRET });

        expect(fileIds(await asked(agentToken(OWNER, [SHARED]), 'mooring', { projectId: SECRET }))).toEqual([]);
    });

    it('lists only those projects as what Ask may search', async () => {
        const all = await call(askController.sources, session(OWNER));
        const narrowed = await call(askController.sources, agentToken(OWNER, [SHARED]));

        expect(all.projects.map((p) => p.id).sort()).toEqual([SHARED, SECRET].sort());
        expect(narrowed.projects.map((p) => p.id)).toEqual([SHARED]);
    });

    it('reads nothing outside the narrowing while retrieval is off for the company either', async () => {
        mockDb.store[SCHEMA_TYPE.COMPANIES][0].knowledgeRetrieval = { mode: 'off' };
        mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Anchor survey quay', ProjectID: SHARED, sprintId: OPEN_SPRINT, deletedStatusKey: 0, updatedAt: new Date() });
        mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Anchor survey yard', ProjectID: SECRET, deletedStatusKey: 0, updatedAt: new Date() });

        const titles = (await asked(agentToken(OWNER, [SHARED]), 'anchor survey')).map((s) => s.title);
        expect(titles).toEqual(['Anchor survey quay']);
    });

    it('does not read company-wide pages, which sit in no project, as the MCP tools do not', async () => {
        mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Harbour handbook', rawText: 'Slipway rules for everyone.', visibility: 'company', deletedStatusKey: 0, updatedAt: new Date() });

        expect((await asked(session(OWNER), 'slipway')).map((s) => s.title)).toEqual(['Harbour handbook']);
        expect(await asked(agentToken(OWNER, [SHARED]), 'slipway')).toEqual([]);
    });

    it('is not narrowed when its list is empty: an unnarrowed agent token reads as its owner', async () => {
        const shared = await file('The fender order for the quay.');
        const secret = await file('The fender order for the yard.', { ProjectID: SECRET });

        expect(fileIds(await asked(agentToken(OWNER, []), 'fender')).sort()).toEqual([shared, secret].sort());
    });
});

describe('the MCP server', () => {
    const MCP_DIR = path.join(__dirname, '..', 'Modules', 'Mcp');

    it('has no tool that returns retrieval passages, so no file passage reaches an MCP client', () => {
        const reaches = fs.readdirSync(MCP_DIR).filter((name) => name.endsWith('.js')).filter((name) => {
            const source = fs.readFileSync(path.join(MCP_DIR, name), 'utf8');
            return /Knowledge\/(retrieval|askSources|visibleSet|adapters)|AI\/ask|KNOWLEDGE_CHUNKS|knowledge_chunks/.test(source);
        });
        expect(reaches).toEqual([]);
    });
});
