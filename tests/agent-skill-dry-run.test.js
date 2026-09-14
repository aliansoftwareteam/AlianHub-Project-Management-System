const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ ROLE_OWNER: 1, ROLE_ADMIN: 2, getRoleType: jest.fn(async () => 1), isPrivileged: (r) => r === 1 || r === 2 }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Agents/actor', () => ({ resolveActor: jest.fn(async (req) => ({ kind: req.agent ? 'agent' : 'human', userId: req.uid || null })), isAgent: (a) => a && a.kind === 'agent' }));
jest.mock('../Modules/AICore/llmProvider', () => ({ getProvider: jest.fn(), isAnyProviderConfigured: jest.fn(() => true) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(async () => ['6f0000000000000000000901']), visibleProjects: jest.fn(async () => []) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { getRoleType } = require('../Config/permissionGuard');
const { getProvider } = require('../Modules/AICore/llmProvider');
const scope = require('../Modules/Agents/scope');
const { validateSkill } = require('../Modules/Agents/skills/validateSkill');
const skillsCtrl = require('../Modules/Agents/skillsController');

const C = '6f0000000000000000000c01';
const AGENT_ID = '6f0000000000000000000a01';
const TASK_ID = '6f0000000000000000000701';
const PROJECT_ID = '6f0000000000000000000901';
const BRIEF = 'Goal: ship the magic-link login. Acceptance: verify endpoint, email template, rate limit, tests for expiry.';

const task = (over = {}) => ({ _id: TASK_ID, TaskName: 'Magic-link login', TaskKey: 'AR-7', ProjectID: PROJECT_ID, description: `<p>${BRIEF}</p>`, deletedStatusKey: 0, ...over });

const dataSkill = (over = {}) => validateSkill({
    key: 'task.summary',
    name: 'Summariser',
    inputs: ['brief'],
    gather: [{ reader: 'task' }],
    prompt: { partials: ['in_tool'], instructions: 'Summarise the brief.', template: 'Brief: {{input.brief}}', output: '{"summary":"..."}' },
    emit: [{ action: 'task.comment', params: { body: '{{answer.summary}}' } }, { action: 'task.assign', params: { assigneeIds: '{{answer.owner}}' } }],
    ...over,
}).value;

const req = (body, over = {}) => ({ headers: { companyid: C }, params: { key: 'task.summary' }, query: {}, body, uid: 'owner1', ...over });
const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; return r; };
const call = async (fn, request) => { const r = res(); await fn(request, r); return r; };

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    getRoleType.mockResolvedValue(1);
    scope.visibleProjectIds.mockResolvedValue([PROJECT_ID]);
});

describe('POST /api/v2/agents/skills/:key/dry-run', () => {
    it('shows what the skill would read and the prompt it would send, without calling a model or writing', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENT_SKILLS, dataSkill());
        mockDb.seed(SCHEMA_TYPE.TASKS, task());

        const r = await call(skillsCtrl.dryRunSkill, req({ taskId: TASK_ID }));

        expect(r.body.status).toBe(true);
        expect(r.body.data.ran).toBe(true);
        expect(r.body.data.skipped).toBe(null);
        expect(r.body.data.skill).toMatchObject({ key: 'task.summary', name: 'Summariser', source: 'data', inputs: ['brief'], reads: ['task'] });
        expect(r.body.data.task).toMatchObject({ id: TASK_ID, key: 'AR-7' });
        expect(r.body.data.gathered.input.brief).toContain('magic-link login');
        expect(r.body.data.gathered.gather.task).toMatchObject({ key: 'AR-7', title: 'Magic-link login' });
        expect(r.body.data.prompt.user).toBe(`Brief: ${BRIEF}`);
        expect(r.body.data.prompt.system).toContain('Summarise the brief.');
        expect(getProvider).not.toHaveBeenCalled();
        expect(mockDb.calls.every((c) => ['find', 'findOne'].includes(c.method))).toBe(true);
        expect(mockDb.calls.every((c) => c.companyId === C)).toBe(true);
    });

    it('previews the risk as the union of the emitted actions and the effective actions as the agent\'s intersection', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENT_SKILLS, dataSkill());
        mockDb.seed(SCHEMA_TYPE.TASKS, task());
        mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: AGENT_ID, name: 'Intake', allowedActions: ['task.get', 'task.comment'], deletedStatusKey: 0 });

        const withAgent = await call(skillsCtrl.dryRunSkill, req({ taskId: TASK_ID, agentId: AGENT_ID }));
        expect(withAgent.body.data.risk).toBe('medium');
        expect(withAgent.body.data.actions.map((a) => a.key)).toEqual(['task.comment', 'task.assign']);
        expect(withAgent.body.data.actions.find((a) => a.key === 'task.assign').risk).toBe('medium');
        expect(withAgent.body.data.effectiveActions).toEqual(['task.comment']);
        expect(withAgent.body.data.outsideAgent).toEqual(['task.assign']);

        const noAgent = await call(skillsCtrl.dryRunSkill, req({ taskId: TASK_ID }));
        expect(noAgent.body.data.effectiveActions).toEqual(['task.comment', 'task.assign']);
        expect(noAgent.body.data.outsideAgent).toEqual([]);
    });

    it('says what the task is missing instead of running when the input is not there', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENT_SKILLS, dataSkill());
        mockDb.seed(SCHEMA_TYPE.TASKS, task({ description: '<p>tbd</p>' }));

        const r = await call(skillsCtrl.dryRunSkill, req({ taskId: TASK_ID }));

        expect(r.body.data.ran).toBe(false);
        expect(r.body.data.prompt).toBe(null);
        expect(r.body.data.skipped).toMatch(/brief is too short/);
        expect(r.body.data.missingInput).toMatchObject({ code: 'brief' });
    });

    it('refuses a task outside the caller\'s projects and a skill that does not exist', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENT_SKILLS, dataSkill());
        mockDb.seed(SCHEMA_TYPE.TASKS, task());
        scope.visibleProjectIds.mockResolvedValue([]);
        const hidden = await call(skillsCtrl.dryRunSkill, req({ taskId: TASK_ID }));
        expect(hidden.code).toBe(404);
        expect(hidden.body.status).toBe(false);

        scope.visibleProjectIds.mockResolvedValue([PROJECT_ID]);
        const unknown = await call(skillsCtrl.dryRunSkill, req({ taskId: TASK_ID }, { params: { key: 'no.such.skill' } }));
        expect(unknown.code).toBe(404);
    });

    it('is owner and admin only', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENT_SKILLS, dataSkill());
        mockDb.seed(SCHEMA_TYPE.TASKS, task());
        getRoleType.mockResolvedValue(3);

        const r = await call(skillsCtrl.dryRunSkill, req({ taskId: TASK_ID }));
        expect(r.code).toBe(403);
        expect(r.body.status).toBe(false);
    });

    it('dry-runs a built-in code skill too, so the library is one list', async () => {
        mockDb.seed(SCHEMA_TYPE.TASKS, task());

        const r = await call(skillsCtrl.dryRunSkill, req({ taskId: TASK_ID }, { params: { key: 'brief.parse' } }));

        expect(r.body.status).toBe(true);
        expect(r.body.data.skill).toMatchObject({ key: 'brief.parse', source: 'code' });
        expect(r.body.data.ran).toBe(true);
        expect(r.body.data.actions.map((a) => a.key)).toEqual(['subtask.create', 'task.comment']);
    });
});
