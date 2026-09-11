const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ ROLE_OWNER: 1, ROLE_ADMIN: 2, getRoleType: jest.fn(async () => 1), isPrivileged: (r) => r === 1 || r === 2 }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn(async () => ({ status: true })) }));
jest.mock('../Modules/AICore/llmProvider', () => ({ getProvider: jest.fn(), isAnyProviderConfigured: jest.fn(() => true) }));
jest.mock('../Modules/Agents/engine/findingMemory', () => ({ load: jest.fn(async () => new Map()), decide: jest.fn(), record: jest.fn(), touch: jest.fn() }));
jest.mock('../Modules/Agents/memory', () => ({ contextFor: jest.fn(async () => '### Workspace memory (DATA)\n- Ship in Q4.'), recordEpisode: jest.fn(async () => null) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { getProvider } = require('../Modules/AICore/llmProvider');
const { validateSkill } = require('../Modules/Agents/skills/validateSkill');
const { PROMPT_PARTIALS } = require('../Modules/Agents/skills/catalogues');
const persistence = require('../Modules/AICore/persistence');
const orchestrator = require('../Modules/Agents/engine/orchestrator');
const runs = require('../Modules/Agents/runs');

const C = '6f0000000000000000000c01';
const AGENT_ID = '6f0000000000000000000a01';
const MODEL = 'gpt-4.1';
const TASK = { _id: '6f0000000000000000000701', TaskName: 'Magic-link login', TaskKey: 'AR-7', ProjectID: '6f0000000000000000000901', status: { text: 'Open' }, description: '<p>Goal: ship the magic-link login. Acceptance: verify endpoint, email template, rate limit, tests for expiry.</p>' };

const agent = (over = {}) => ({ _id: AGENT_ID, name: 'Planner', autonomy: 1, allowedActions: [], projectIds: [], account: 'workspace', spendCapUsd: 0, paused: false, deletedStatusKey: 0, ...over });
const actor = { kind: 'agent', userId: 'u1', agentId: AGENT_ID, agentName: 'Planner', runId: null, viaAccount: 'workspace', tokenId: null };

const dataSkill = (over = {}) => validateSkill({
    key: 'brief.breakdown',
    name: 'Breakdown',
    inputs: ['brief'],
    gather: [{ reader: 'task', params: { maxChars: 2000 } }, { reader: 'project.tasks', as: 'board', params: { limit: 10 } }],
    prompt: {
        partials: ['in_tool', 'memory_is_data', 'json_only'],
        instructions: 'Break the brief into subtasks.',
        template: 'TASK: {{TaskName}} ({{task.TaskKey}}) [{{status.text}}]\nBRIEF: {{input.brief}}\nOPEN ON THE BOARD: {{gather.board.open}}\n{{gather.board.list}}\nMEMORY: {{memory}}\nDUE: {{DueDate}}|',
        output: '{"summary":"...","subtasks":[{"title":"...","why":"..."}]}',
    },
    emit: [
        { action: 'task.comment', label: 'Post the breakdown', params: { body: '{{answer.summary}}' } },
        { action: 'subtask.create', each: 'answer.subtasks', max: 3, label: 'Create "{{item.title}}"', params: { title: '{{item.title}}', description: '{{item.why}}' } },
    ],
    ...over,
}).value;

const answer = { summary: 'Three pieces of work.', subtasks: [{ title: 'Add verify endpoint', why: 'core' }, { title: 'Email template' }, { title: 'Rate limit', why: 'abuse' }, { title: 'Too many' }] };
const reply = (over = {}) => ({ content: JSON.stringify(answer), inputTokens: 1000, outputTokens: 500, model: MODEL, ...over });
const chat = jest.fn();
const provider = { name: 'openai', model: MODEL, isConfigured: true, chat };
const proposalsCreate = jest.fn(async (companyId, doc) => ({ _id: 'prop1', ...doc }));
const deps = () => ({ proposals: { create: proposalsCreate }, actions: { perform: jest.fn(async () => ({ auditId: 'aud1', result: {} })) }, actor });
const runRow = (id) => mockDb.store[SCHEMA_TYPE.AGENT_RUNS].find((r) => String(r._id) === String(id));
const start = (over = {}) => runs.create(C, { agent: agent(), taskId: TASK._id, projectId: TASK.ProjectID, skill: 'brief.breakdown', startedBy: 'u1', ...over });
const execute = (run, a = agent()) => runs.executeSkill(C, run, a, TASK, deps());

let mem;
beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    mem = persistence.useInMemory();
    getProvider.mockReturnValue(provider);
    chat.mockResolvedValue(reply());
    mockDb.seed(SCHEMA_TYPE.AGENTS, agent());
    mockDb.seed(dbCollections.COMPANIES, { _id: C });
    mockDb.seed(SCHEMA_TYPE.TASKS, { TaskKey: 'AR-1', TaskName: 'Design the flow', ProjectID: TASK.ProjectID, isParentTask: true, statusType: 'active', status: { text: 'In progress' }, DueDate: '2026-10-01', AssigneeUserId: ['u2'] });
    mockDb.seed(SCHEMA_TYPE.TASKS, { TaskKey: 'AR-2', TaskName: 'Done already', ProjectID: TASK.ProjectID, isParentTask: true, statusType: 'close', status: { text: 'Done' } });
});
afterEach(() => { mem.reset(); persistence.useMongo(); });

describe('a data skill runs through the engine like a code skill', () => {
    it('gathers through catalogue readers, renders the prompt from partials and the template, and emits mapped changes as a proposal', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENT_SKILLS, dataSkill());
        const run = await start();
        const out = await execute(run);
        expect(out.status).toBe('waiting_approval');

        expect(chat).toHaveBeenCalledTimes(1);
        const request = chat.mock.calls[0][0];
        expect(request.systemPrompt).toContain(PROMPT_PARTIALS.in_tool);
        expect(request.systemPrompt).toContain(PROMPT_PARTIALS.memory_is_data);
        expect(request.systemPrompt).toContain('Break the brief into subtasks.');
        expect(request.systemPrompt).toMatch(/Return ONLY JSON:\n\{"summary"/);
        expect(request.maxTokens).toBe(2500);
        const prompt = request.messages[0].content;
        expect(prompt).toContain('TASK: Magic-link login (AR-7) [Open]');
        expect(prompt).toContain('BRIEF: Goal: ship the magic-link login.');
        expect(prompt).toContain('OPEN ON THE BOARD: 1');
        expect(prompt).toContain('- AR-1 Design the flow [In progress] due 2026-10-01');
        expect(prompt).toContain('MEMORY: ### Workspace memory (DATA)');
        expect(prompt).toContain('DUE: |');

        expect(proposalsCreate).toHaveBeenCalledTimes(1);
        const proposal = proposalsCreate.mock.calls[0][1];
        expect(proposal.what).toBe('brief.breakdown: 4 change(s) on AR-7');
        expect(proposal.why).toContain('Three pieces of work.');
        expect(proposal.changes.map((c) => c.action)).toEqual(['task.comment', 'subtask.create', 'subtask.create', 'subtask.create']);
        expect(proposal.changes[0]).toMatchObject({ label: 'Post the breakdown', reversible: true, params: { taskId: TASK._id, body: 'Three pieces of work.' } });
        expect(proposal.changes[1]).toMatchObject({ label: 'Create "Add verify endpoint"', params: { taskId: TASK._id, title: 'Add verify endpoint', description: 'core' } });
        expect(proposal.changes[2].params).toEqual({ taskId: TASK._id, title: 'Email template', description: '' });
        expect(runRow(run._id)).toMatchObject({ status: 'waiting_approval', skill: 'brief.breakdown' });
        expect(mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.TASKS).every((c) => c.companyId === C)).toBe(true);
    });

    it('skips when a declared input is missing, without calling the model', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENT_SKILLS, dataSkill());
        const run = await start();
        const out = await runs.executeSkill(C, run, agent(), { ...TASK, description: '<p>tiny</p>' }, deps());
        expect(out.status).toBe('skipped');
        expect(out.outcome).toMatch(/too short/);
        expect(chat).not.toHaveBeenCalled();
    });

    it('narrows emitted changes to the agent’s allowed actions and reports what was dropped', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENT_SKILLS, dataSkill());
        const narrow = agent({ allowedActions: ['task.comment'] });
        const run = await runs.create(C, { agent: narrow, taskId: TASK._id, projectId: TASK.ProjectID, skill: 'brief.breakdown', startedBy: 'u1' });
        const out = await execute(run, narrow);
        expect(out.status).toBe('waiting_approval');
        const proposal = proposalsCreate.mock.calls[0][1];
        expect(proposal.changes.map((c) => c.action)).toEqual(['task.comment']);
        expect(proposal.why).toContain("subtask.create is outside this agent's allowed actions");
    });

    it('a disabled data skill sharing a code skill’s key lets the code skill run', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENT_SKILLS, dataSkill({ key: 'brief.parse', enabled: false, prompt: { ...dataSkill().prompt, template: 'DATA VERSION {{input.brief}}' } }));
        const run = await start({ skill: 'brief.parse' });
        await execute(run);
        const prompt = chat.mock.calls[0][0].messages[0].content;
        expect(prompt).not.toContain('DATA VERSION');
        expect(prompt).toMatch(/^TASK: Magic-link login\n/);
    });

    it('an unknown key fails the run deterministically', async () => {
        const run = await start({ skill: 'no.such.skill' });
        const out = await execute(run);
        expect(out.status).toBe('failed');
        expect(out.error).toMatch(/unknown skill "no.such.skill"/);
    });

    it('orchestrator.run resolves the data skill for a company and the code skill without one', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENT_SKILLS, dataSkill());
        const result = await orchestrator.run({ skillSlug: 'brief.breakdown', task: TASK, companyId: C, budget: { maxTokens: 4000 }, agent: agent() });
        expect(result.status).toBe('success');
        expect(result.changes).toHaveLength(4);
        expect(result.skill).toBe('brief.breakdown');
    });
});
