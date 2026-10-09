/* Task 047, AI-1b: the tool calls of each benchmark delegation that passed in a measured run (tests/ai-benchmark/),
   replayed through the MCP server against the in-memory database with no model. A break in a tool, a permission,
   the preview or the undo shows here; how well a model picks the tools is only measured by the run itself. */
process.env.STORAGE_TYPE = 'server';
const mockDb = require('./fixtures/fakeMongo').create();

/* Mongoose reads an update without operators as a $set, which the fake does not. */
const mockAsMongoose = (q, method) => {
    const update = method === 'findOneAndUpdate' && Array.isArray(q.data) ? q.data[1] : null;
    if (!update || Object.keys(update).some((key) => key.startsWith('$'))) return q;
    return { ...q, data: [q.data[0], { $set: update }, ...q.data.slice(2)] };
};
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, mockAsMongoose(q, method), method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
const mockStub = (fixed = {}) => new Proxy({ ...fixed }, {
    get: (target, name) => {
        if (name === 'then' || name === '__esModule') return undefined;
        target[name] = target[name] || jest.fn(() => Promise.resolve({}));
        return target[name];
    },
});
jest.mock('../Modules/Sprints/controller', () => mockStub());
jest.mock('../Modules/Tasks/helpers/handleNotification', () => mockStub());
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => mockStub());
jest.mock('../Modules/Company/eventController', () => mockStub());
jest.mock('../Modules/Company/controller/updateCompany', () => ({ getCompanyDataFun: jest.fn(async () => [{ workingDays: [1, 2, 3, 4, 5] }]) }));
jest.mock('../Modules/notification-count/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());

jest.mock('../Modules/CustomField/aiFields/controller', () => mockStub());
jest.mock('../utils/planHelper', () => mockStub({ getCachedCompanyData: jest.fn(async () => ({ data: {} })) }));
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../common-storage/common-server.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Knowledge/ingest/events', () => ({ publishCommentChanged: jest.fn(), publish: jest.fn() }));
jest.mock('../Modules/Knowledge/memory/publish', () => mockStub());
jest.mock('../Modules/Tasks/helpers/completionStore', () => ({ recordWork: jest.fn(async () => null), forStatusChange: jest.fn(async () => null) }));
jest.mock('../Modules/Agents/triggers', () => ({ fromComment: jest.fn(async () => null), TRIGGER: { MENTION: 'mention', ASSIGN: 'assign' } }));
jest.mock('../Modules/AI/feedback', () => ({ fromDecline: jest.fn(async () => null) }));
jest.mock('../Modules/Agents/engine/graph', () => ({ resumeGraph: jest.fn(async () => ({ resumed: false })) }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));

const fs = require('fs');
const path = require('path');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpManageWorld');
const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const persistence = require('../Modules/AICore/persistence');
const memory = require('../Modules/Agents/memory');
const proposals = require('../Modules/Agents/proposals');
const intentPreview = require('../Modules/Agents/intentPreview');
const undo = require('../Modules/Agents/undo');
const tools = require('../Modules/Mcp/tools');
const server = require('../Modules/Mcp/server');

mongoHelper.getTotalSprintCount = async () => true;

const { CID, OWNER, OTHER, TOKEN, P_OPEN, P_DEST, S_OPEN, S_DEST, TASKS_GRANT, DOCS_GRANT, settle } = world;
const { seed, rows, rpcThrough } = world.create(mockDb);
const rpc = rpcThrough(server);
const store = persistence.useInMemory();

const DIR = path.join(__dirname, 'ai-benchmark');
const JOBS = fs.readdirSync(DIR).filter((file) => /^job-\d+\.json$/.test(file)).sort()
    .map((file) => JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8')));

const CHAT_SCOPE = 'chat:read';
const TEAM_SPACE = '6f0000000000000000000c11';
const SCRATCH = '6f0000000000000000000c21';
const DAY = 24 * 60 * 60 * 1000;
const caller = () => world.ctx(OWNER, { token: { _id: TOKEN, userId: OWNER, scopes: ['read', 'write'], grants: [TASKS_GRANT, DOCS_GRANT, CHAT_SCOPE], active: true } });
const human = { kind: 'human', userId: OWNER };

const day = (offset) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
const at = (ymd) => new Date(`${ymd}T00:00:00.000Z`);
const ymdOf = (value) => (value ? new Date(value).toISOString().slice(0, 10) : null);
const named = (type, key, value) => rows(type).filter((row) => row[key] === value);
const one = (type, key, value) => {
    const found = named(type, key, value);
    if (found.length !== 1) throw new Error(`${found.length} rows of ${type} with ${key} "${value}"`);
    return found[0];
};
const task = (name) => one(SCHEMA_TYPE.TASKS, 'TaskName', name);
const live = (name) => named(SCHEMA_TYPE.TASKS, 'TaskName', name).filter((row) => row.deletedStatusKey !== 1);
const field = (name) => one(SCHEMA_TYPE.CUSTOM_FIELDS, 'fieldTitle', name);
const project = () => rows(SCHEMA_TYPE.PROJECTS).find((row) => String(row._id) === P_OPEN);
const valueOf = (taskName, fieldName) => ((task(taskName).customField || {})[String(field(fieldName)._id)] || {}).fieldValue;

/* The start state of the run sheet (Tasks/active/047-ai-run/ai-1-run-1-sheet.md), in the "QA Sandbox" project. */
const seedBench = (extra = {}) => {
    const fx = seed();
    mockDb.store[SCHEMA_TYPE.API_TOKENS] = [];
    mockDb.seed(SCHEMA_TYPE.API_TOKENS, { _id: TOKEN, userId: OWNER, name: 'Claude Code', active: true, scopes: ['read', 'write'], grants: [TASKS_GRANT, DOCS_GRANT, CHAT_SCOPE], projectIds: [], expiresAt: new Date(Date.now() + DAY) });
    project().ProjectName = 'QA Sandbox';
    project().ProjectRequiredComponent = [{ _id: '6f0000000000000000000e11', keyName: 'ProjectListView', name: 'List', title: 'List', value: 'List', sortIndex: 1, viewStatus: true }];
    rows(SCHEMA_TYPE.SPRINTS).find((row) => String(row._id) === S_OPEN).name = '[AI bench] list';

    mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { fieldTitle: 'Stage', fieldType: 'dropdown', type: 'task', global: false, projectId: [P_OPEN], isDelete: true, fieldOptions: [{ id: 'st1', label: 'Alpha' }, { id: 'st2', label: 'Beta' }] });
    const COST = mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { fieldTitle: 'Cost', fieldType: 'number', type: 'task', global: false, projectId: [P_OPEN], isDelete: true });
    const cost = (value) => ({ customField: { [String(COST._id)]: { fieldValue: String(value) } } });

    const add = (name, over = {}) => {
        const copy = {
            ...fx.bug, TaskKey: name, TaskName: name, ProjectID: P_OPEN, sprintId: S_OPEN, sprintArray: { id: S_OPEN, name: '[AI bench] list' }, AssigneeUserId: [], watchers: [],
            TaskType: 'task', TaskTypeKey: 1, status: { key: 1, text: 'To Do', type: 'default_active' }, statusType: 'default_active', statusKey: 1, Task_Priority: 'MEDIUM', relations: [], DueDate: null, startDate: null, ...over,
        };
        delete copy._id;
        return mockDb.seed(SCHEMA_TYPE.TASKS, copy);
    };
    Array.from({ length: 20 }, (unused, at0) => add(`[AI bench] bulk ${String(at0 + 1).padStart(2, '0')}`, at0 === 0 ? cost(20) : {}));
    add('[AI bench] Other', { AssigneeUserId: [OWNER], DueDate: at(day(1)), ...cost(100) });
    const parent = add('[AI bench] Parent', { subTasks: 1 });
    add('[AI bench] Child', { isParentTask: false, ParentTaskId: parent._id, ancestors: [parent._id], ...cost(50) });
    add('[AI bench] Design', { startDate: at('2026-10-12'), DueDate: at('2026-10-13') });
    add('[AI bench] Build', { startDate: at('2026-10-13'), DueDate: at('2026-10-14') });
    add('Elsewhere, mine', { TaskKey: 'DST-1', ProjectID: P_DEST, sprintId: S_DEST, sprintArray: { id: S_DEST, name: 'Inbox' }, AssigneeUserId: [OWNER] });
    (extra.tasks || []).forEach((name) => add(name, { AssigneeUserId: [OWNER] }));
    (extra.pages || []).forEach((title) => mockDb.seed(SCHEMA_TYPE.PAGES, { title, ProjectID: P_OPEN, visibility: 'project', createdBy: OWNER, updatedBy: OWNER, deletedStatusKey: 0, order: 1 }));

    mockDb.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: TEAM_SPACE, default: false, ProjectName: 'Team chat' });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: SCRATCH, name: 'scratch', projectId: TEAM_SPACE, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.COMMENTS, { projectId: TEAM_SPACE, sprintId: SCRATCH, taskId: 'default', userId: OTHER, type: 'text', message: 'An older message', createdAt: new Date(Date.now() - 2 * DAY) });
    mockDb.seed(SCHEMA_TYPE.COMMENTS, { projectId: TEAM_SPACE, sprintId: SCRATCH, taskId: 'default', userId: OTHER, type: 'text', message: '[AI bench] Please fix the login page', createdAt: new Date(Date.now() - DAY) });
};

const placeholder = (text, run) => {
    const [kind, ...rest] = text.slice(1).split(':');
    const arg = rest.join(':');
    switch (kind) {
    case 'project': return P_OPEN;
    case 'list': return S_OPEN;
    case 'me': return OWNER;
    case 'teammate': return OTHER;
    case 'proposal': return run.proposalId;
    case 'task': return String(task(arg)._id);
    case 'field': return String(field(arg)._id);
    case 'page': return String(one(SCHEMA_TYPE.PAGES, 'title', arg)._id);
    case 'channel': return String(one(SCHEMA_TYPE.SPRINTS, 'name', arg)._id);
    case 'message': return String(one(SCHEMA_TYPE.COMMENTS, 'message', arg)._id);
    case 'date': return day(Number(arg));
    default: throw new Error(`Unknown placeholder ${text}`);
    }
};
const resolve = (value, run) => {
    if (typeof value === 'string' && value.startsWith('$')) return placeholder(value, run);
    if (Array.isArray(value)) return value.map((item) => resolve(item, run));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item, run)]));
    return value;
};

const ANSWERS = {
    read: (out) => {
        expect(out.error).toBeUndefined();
        expect(out.ok).not.toBe(false);
    },
    applied: (out) => expect(out).toMatchObject({ ok: true }),
    pending: (out) => expect(out).toMatchObject({ ok: false, pending: true, approval: 'pending' }),
};
const answered = (call, out) => {
    try {
        expect(out.rpcError).toBeUndefined();
        expect(out.isError).toBeUndefined();
        expect(out.refused).toBeUndefined();
        ANSWERS[call.answer](out);
    } catch (error) {
        error.message = `${call.tool} answered ${JSON.stringify(out).slice(0, 600)}\n${error.message}`;
        throw error;
    }
};

const previewOf = async (row) => {
    const batch = (await intentPreview.forBatches(CID, OWNER, [row])).get(String(row._id));
    if (batch && row.changes.length > 1) return batch;
    return ((await intentPreview.forProposals(CID, OWNER, [row])).get(String(row._id)) || []).find(Boolean) || null;
};

const replay = async (job) => {
    seedBench(job.seed);
    const run = { replies: [], proposalId: null, preview: null, auditIds: [] };
    const step = async (call) => {
        const out = await rpc(caller(), call.tool, resolve(call.arguments, run));
        answered(call, out);
        run.replies.push({ tool: call.tool, out });
        if (call.answer === 'applied' && out.auditId) run.auditIds.push(out.auditId);
        if (call.answer === 'pending') run.proposalId = out.proposalId;
    };
    for (const call of job.calls.filter((c) => !c.after)) await step(call);
    if (job.approve) {
        const row = rows(SCHEMA_TYPE.AGENT_PROPOSALS).find((p) => String(p._id) === String(run.proposalId));
        expect(row).toMatchObject({ status: 'pending', requestedBy: OWNER });
        run.preview = await previewOf(row);
        const approved = await proposals.approve(CID, run.proposalId, { decider: human, isPrivileged: true, ip: '' });
        await settle();
        expect(approved.error).toBeUndefined();
        run.approved = approved;
    }
    for (const call of job.calls.filter((c) => c.after === 'approve')) await step(call);
    return run;
};

const undoRun = async (run) => {
    if (run.proposalId) {
        const out = await proposals.undoApproval(CID, run.proposalId, { decider: human, isPrivileged: true, ip: '' });
        await settle();
        expect(out.error).toBeUndefined();
    }
    for (const auditId of [...run.auditIds].reverse()) {
        const row = rows(SCHEMA_TYPE.AUDIT_LOGS).find((entry) => String(entry._id) === String(auditId));
        expect(row).toBeTruthy();
        expect(await undo.undoAuditRow(CID, row, human, '')).toMatchObject({ ok: true });
        await settle();
    }
};

const replyOf = (run, tool, nth = 0) => run.replies.filter((reply) => reply.tool === tool)[nth].out;
const bulk = () => Array.from({ length: 20 }, (unused, at0) => task(`[AI bench] bulk ${String(at0 + 1).padStart(2, '0')}`));
const view = (title) => (project().ProjectRequiredComponent || []).find((entry) => entry.title === title);
const timeOn = (name) => rows(SCHEMA_TYPE.TIMESHEET).filter((row) => String(row.TicketID) === String(task(name)._id) && !row.isDelete);
const pages = (title) => named(SCHEMA_TYPE.PAGES, 'title', title).filter((row) => row.deletedStatusKey !== 1);
const liveFields = (name) => named(SCHEMA_TYPE.CUSTOM_FIELDS, 'fieldTitle', name).filter((row) => row.isDelete !== false);

/* Each job's end condition as the benchmark file words it, read from what the replay wrote. */
const END = {
    1: () => {
        expect(live('[AI bench] Write release note')).toHaveLength(1);
        const [made] = live('[AI bench] Write release note');
        expect(made).toMatchObject({ Task_Priority: 'HIGH', AssigneeUserId: [OWNER] });
        expect([String(made.ProjectID), String(made.sprintId)]).toEqual([P_OPEN, S_OPEN]);
        expect(ymdOf(made.DueDate)).toBe(day(1));
    },
    2: () => {
        expect(live('[AI bench] Call supplier')).toHaveLength(1);
        const [made] = live('[AI bench] Call supplier');
        expect([String(made.ProjectID), String(made.sprintId)]).toEqual([P_OPEN, S_OPEN]);
    },
    3: (run) => {
        expect(replyOf(run, 'chat.messages.list').messages.map((message) => message.text)).toEqual(['[AI bench] Please fix the login page']);
        expect(live('[AI bench] Please fix the login page')).toHaveLength(1);
        const [made] = live('[AI bench] Please fix the login page');
        expect(String(made.sprintId)).toBe(S_OPEN);
        expect(JSON.stringify([made.rawDescription, made.descriptionBlock])).toMatch(/Please fix the login page/);
    },
    7: () => bulk().forEach((row) => expect(row).toMatchObject({ Task_Priority: 'HIGH', AssigneeUserId: [OTHER] })),
    8: (run) => {
        expect(view('By Stage')).toMatchObject({ keyName: 'ProjectListView', createdBy: OWNER });
        expect(JSON.stringify(view('By Stage').settings)).toContain(String(field('Stage')._id));
        expect(replyOf(run, 'screen.link', 1).url).toMatch(/^https:\/\/hub\.bench\.test\//);
    },
    9: () => expect(view('[AI bench] Mine this week')).toMatchObject({ keyName: 'ProjectListView', createdBy: OWNER, settings: expect.objectContaining({ me: true }) }),
    10: (run) => {
        const found = replyOf(run, 'tasks.search').tasks;
        expect(found.map((row) => row.title)).toEqual(expect.arrayContaining(['[AI bench] Other', 'Elsewhere, mine']));
        found.forEach((row) => expect(row.assigneeIds).toContain(OWNER));
        expect(new Set(found.map((row) => row.projectId)).size).toBeGreaterThan(1);
        expect(replyOf(run, 'screen.link').url).toMatch(/^https:\/\/hub\.bench\.test\//);
    },
    11: () => expect(task('[AI bench] Design').status).toMatchObject({ text: 'In Progress', type: 'active' }),
    12: (run) => {
        expect(valueOf('[AI bench] Write release note', 'Note')).toBe('ok');
        expect(valueOf('[AI bench] Write release note', 'Cost')).toBe('120');
        expect(valueOf('[AI bench] Write release note', 'Stage')).toEqual(['st2']);
        expect(ymdOf(valueOf('[AI bench] Write release note', 'Review date'))).toBe(day(1));
        expect(JSON.stringify(valueOf('[AI bench] Write release note', 'Reviewer'))).toContain(OWNER);
        expect(named(SCHEMA_TYPE.CUSTOM_FIELDS, 'fieldTitle', 'Cost')).toHaveLength(1);
        expect(named(SCHEMA_TYPE.CUSTOM_FIELDS, 'fieldTitle', 'Stage')).toHaveLength(1);
        expect(replyOf(run, 'proposal.get')).toMatchObject({ state: 'applied', changesApplied: 1 });
    },
    13: (run) => {
        expect(field('[AI bench] Cost total')).toMatchObject({ fieldType: 'rollup' });
        expect(view('[AI bench] Cost by status')).toBeTruthy();
        const total = replyOf(run, 'task.fields.list').fields.find((row) => row.title === '[AI bench] Cost total');
        expect(Number(total.value)).toBe(50);
    },
    15: (run) => {
        expect(pages('[AI bench] Launch notes')).toHaveLength(1);
        const [made] = pages('[AI bench] Launch notes');
        expect(made).toMatchObject({ agentStatus: 'draft', createdByAgent: true, content: { html: '<p>First draft</p>' } });
        expect(String(made.ProjectID)).toBe(P_OPEN);
        expect(replyOf(run, 'project.get')).toMatchObject({ projectId: P_OPEN, private: false });
    },
    17: (run) => {
        expect(timeOn('[AI bench] Write release note')).toHaveLength(2);
        expect(replyOf(run, 'timelog.create').result).toMatchObject({ minutes: 90 });
    },
    19: (run) => {
        const design = task('[AI bench] Design');
        const build = task('[AI bench] Build');
        expect(build.relations.map((link) => [String(link.taskId), link.type])).toEqual([[String(design._id), 'blocked_by']]);
        expect([ymdOf(design.startDate), ymdOf(design.DueDate)]).toEqual(['2026-10-14', '2026-10-15']);
        expect([ymdOf(build.startDate), ymdOf(build.DueDate)]).toEqual(['2026-10-15', '2026-10-16']);
        expect(new Date(build.startDate).getTime()).toBeGreaterThanOrEqual(new Date(design.DueDate).getTime());
        expect(replyOf(run, 'task.update').result.waitingTasks.moved.map((row) => row.title)).toEqual(['[AI bench] Build']);
    },
    23: (run) => {
        expect(replyOf(run, 'members.list').members.map((row) => row.name)).toEqual(expect.arrayContaining(['Olivia Owner', 'Priya Other']));
        expect(replyOf(run, 'screen.link').url).toMatch(/workload/i);
    },
    24: (run) => {
        expect(replyOf(run, 'tasks.search').tasks.map((row) => row.title)).toEqual(['[AI bench] Call supplier']);
        expect(replyOf(run, 'pages.search').pages.map((row) => row.title)).toEqual(['[AI bench] Launch notes']);
        expect(replyOf(run, 'screen.link', 0).url).toContain(String(task('[AI bench] Call supplier')._id));
        expect(replyOf(run, 'screen.link', 1).url).toContain(String(one(SCHEMA_TYPE.PAGES, 'title', '[AI bench] Launch notes')._id));
    },
};

/* What the person's Undo leaves: the state before the sentence. */
const UNDONE = {
    1: () => expect(live('[AI bench] Write release note')).toHaveLength(0),
    2: () => expect(live('[AI bench] Call supplier')).toHaveLength(0),
    3: () => expect(live('[AI bench] Please fix the login page')).toHaveLength(0),
    7: () => bulk().forEach((row) => expect(row).toMatchObject({ Task_Priority: 'MEDIUM', AssigneeUserId: [] })),
    8: () => expect(view('By Stage')).toBeUndefined(),
    9: () => expect(view('[AI bench] Mine this week')).toBeUndefined(),
    11: () => expect(task('[AI bench] Design').status).toMatchObject({ text: 'To Do' }),
    12: () => {
        ['Cost', 'Stage'].forEach((name) => expect(valueOf('[AI bench] Write release note', name)).toBeUndefined());
        ['Note', 'Review date', 'Reviewer'].forEach((name) => expect(liveFields(name)).toHaveLength(0));
    },
    13: () => {
        expect(liveFields('[AI bench] Cost total')).toHaveLength(0);
        expect(view('[AI bench] Cost by status')).toBeUndefined();
    },
    15: () => expect(pages('[AI bench] Launch notes')).toHaveLength(0),
    17: () => expect(timeOn('[AI bench] Write release note')).toHaveLength(0),
    19: () => {
        const design = task('[AI bench] Design');
        const build = task('[AI bench] Build');
        expect([ymdOf(design.startDate), ymdOf(design.DueDate)]).toEqual(['2026-10-12', '2026-10-13']);
        expect([ymdOf(build.startDate), ymdOf(build.DueDate)]).toEqual(['2026-10-13', '2026-10-14']);
        expect(build.relations).toEqual([]);
    },
};

const runJob = async (job) => {
    const run = await replay(job);
    if (job.preview) {
        const { lines = [], ...card } = job.preview;
        expect(run.preview).toMatchObject(card);
        expect(run.preview.lines).toEqual(expect.arrayContaining(lines.map((line) => expect.objectContaining(line))));
    }
    if (job.undo) run.replies.filter((reply) => reply.out.ok === true).forEach((reply) => expect(reply.out).toMatchObject({ undoable: true, auditId: expect.any(String) }));
    END[job.job](run);
    if (job.undo) {
        await undoRun(run);
        UNDONE[job.job](run);
    }
};

const savedWebUrl = process.env.WEBURL;
beforeEach(() => {
    jest.clearAllMocks();
    store.reset();
    process.env.WEBURL = 'https://hub.bench.test';
    jest.spyOn(memory, 'rememberApprovedChanges').mockResolvedValue([]);
});
afterEach(async () => { await settle(); jest.restoreAllMocks(); });
afterAll(() => {
    ['MCP_TOOLS_MANAGE', 'MCP_TOOLS_WORK', 'MCP_TOOLS_V2', 'AGENT_TAINT_ROUTING'].forEach((key) => { delete process.env[key]; });
    if (savedWebUrl === undefined) delete process.env.WEBURL; else process.env.WEBURL = savedWebUrl;
});

describe('the kept delegations', () => {
    it('are the ones the measured run passed, each with its end condition, and its undo where it has one', () => {
        expect(JOBS.map((job) => job.job)).toEqual([1, 2, 3, 7, 8, 9, 10, 11, 12, 13, 15, 17, 19, 23, 24]);
        JOBS.forEach((job) => {
            expect(job.passed).toMatch(/: pass/);
            expect(END[job.job]).toEqual(expect.any(Function));
            if (job.undo) expect(UNDONE[job.job]).toEqual(expect.any(Function));
            expect(job.calls.filter((call) => call.answer === 'pending')).toHaveLength(job.approve ? 1 : 0);
        });
    });
});

describe.each(JOBS.map((job) => [job.job, job.title, job]))('job %i, %s', (number, title, job) => {
    it(job.approve ? 'files one proposal whose card and approval reach the end condition' : 'reaches the end condition with no approval', async () => {
        await runJob(job);
    });
});

describe('a seeded break', () => {
    it('in a tool fails the delegation that uses it', async () => {
        const broken = tools.registered().filter((entry) => entry.name === 'task.status.set').map((tool) => [tool, tool.params]);
        broken.forEach(([tool, real]) => { tool.params = (args) => real({ ...args, status: 'To Do' }); });
        try {
            await expect(runJob(JOBS.find((job) => job.job === 11))).rejects.toThrow();
        } finally {
            broken.forEach(([tool, real]) => { tool.params = real; });
        }
    });
});

