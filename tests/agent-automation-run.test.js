const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Agents/runs', () => ({
    STATUS: { RUNNING: 'running', WAITING: 'waiting_approval', DONE: 'done', SKIPPED: 'skipped', FAILED: 'failed', STOPPED: 'stopped' },
    canStart: jest.fn(async () => ({ ok: true, reason: '' })),
    create: jest.fn(async (companyId, { agent, skill }) => ({ _id: 'run1', agentId: String(agent._id), skill, viaAccount: 'workspace' })),
    skillSlugOf: jest.fn((agent, explicit) => explicit || 'qa-review'),
    executeSkill: jest.fn(async () => ({ status: 'done', outcome: '2 change(s) applied', refusals: 0 })),
}));
jest.mock('../Modules/Agents/proposals', () => ({ create: jest.fn() }));
jest.mock('../Modules/Agents/actions', () => ({ perform: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const runs = require('../Modules/Agents/runs');
const runAgent = require('../Modules/Automations/engine/actions/runAgent');
const { parseSentence, describeRule } = require('../Modules/Automations/helpers/sentenceRules');

const C = 'c1';
const AGENT_ID = '6f0000000000000000000a01';
const RULE_ID = '6f0000000000000000000b01';
const TASK_ID = '6f0000000000000000000701';
const task = { _id: TASK_ID, ProjectID: 'p1', TaskName: 'Fix', TaskKey: 'AR-1' };
const args = (config) => ({ companyId: C, entity: { kind: 'task', id: TASK_ID }, config, context: { runId: 'auto1', ruleId: RULE_ID, ruleName: 'QA on done', depth: 0, task } });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: AGENT_ID, name: 'Code Reviewer', account: 'workspace', projectIds: [], deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.AUTOMATION_RULES, { _id: RULE_ID, name: 'QA on done', createdBy: 'u1' });
});

describe('#1 rule-triggered agent runs go through the run engine', () => {
    it('refuses, deterministically, when the rule names no agent', async () => {
        await expect(runAgent.run(args({ skill: 'qa-review' }))).rejects.toMatchObject({ deterministic: true, message: expect.stringMatching(/does not name an agent/) });
        expect(runs.create).not.toHaveBeenCalled();
    });

    it('refuses when the named agent does not exist (or was deleted)', async () => {
        await expect(runAgent.run(args({ skill: 'qa-review', agent: 'Nobody' }))).rejects.toMatchObject({ deterministic: true, message: 'No agent named "Nobody" in this workspace.' });
        mockDb.store[SCHEMA_TYPE.AGENTS][0].deletedStatusKey = 1;
        await expect(runAgent.run(args({ skill: 'qa-review', agent: 'Code Reviewer' }))).rejects.toThrow(/No agent named/);
    });

    it('refuses with canStart\'s reason — paused, pause-all, spend cap and the daily limit all apply', async () => {
        runs.canStart.mockResolvedValueOnce({ ok: false, reason: 'Agent is paused (pause_all).' });
        await expect(runAgent.run(args({ skill: 'qa-review', agent: 'code reviewer' }))).rejects.toMatchObject({ deterministic: true, message: 'Code Reviewer cannot run: Agent is paused (pause_all).' });
        expect(runs.canStart).toHaveBeenCalledWith(expect.objectContaining({ name: 'Code Reviewer' }), { trigger: 'rule', companyId: C });
        expect(runs.create).not.toHaveBeenCalled();
    });

    it('refuses when the agent is scoped to other projects', async () => {
        mockDb.store[SCHEMA_TYPE.AGENTS][0].projectIds = ['p9'];
        await expect(runAgent.run(args({ skill: 'qa-review', agent: AGENT_ID }))).rejects.toThrow(/not scoped to this project/);
    });

    it('creates a rule-triggered run for the named agent and executes it as that agent, on behalf of the rule\'s author', async () => {
        const out = await runAgent.run(args({ skill: 'pr.summary', agent: 'Code Reviewer' }));
        expect(runs.create).toHaveBeenCalledWith(C, expect.objectContaining({ taskId: TASK_ID, projectId: 'p1', skill: 'pr.summary', trigger: 'rule', startedBy: 'u1', note: 'rule "QA on done"' }));
        const [, run, agent, t, deps] = runs.executeSkill.mock.calls[0];
        expect(run._id).toBe('run1');
        expect(agent.name).toBe('Code Reviewer');
        expect(t).toBe(task);
        expect(deps.actor).toMatchObject({ kind: 'agent', userId: 'u1', agentId: AGENT_ID, runId: 'run1', viaAccount: 'workspace' });
        expect(out).toMatchObject({ changed: true, verdict: 'applied', runId: 'run1', agent: 'Code Reviewer', status: 'done' });
    });

    it('reports a proposal as not-changed, a skip as skipped, and a failure as a deterministic error', async () => {
        runs.executeSkill.mockResolvedValueOnce({ status: 'waiting_approval', proposalId: 'prop1' });
        expect(await runAgent.run(args({ skill: 'qa-review', agent: 'Code Reviewer' }))).toMatchObject({ changed: false, verdict: 'proposed', proposalId: 'prop1' });
        runs.executeSkill.mockResolvedValueOnce({ status: 'skipped', outcome: 'no reviewable URL found in the task title or description' });
        expect(await runAgent.run(args({ skill: 'qa-review', agent: 'Code Reviewer' }))).toMatchObject({ changed: false, verdict: 'skipped', reason: /no reviewable URL/ });
        runs.executeSkill.mockResolvedValueOnce({ status: 'failed', error: 'could not fetch' });
        await expect(runAgent.run(args({ skill: 'qa-review', agent: 'Code Reviewer' }))).rejects.toMatchObject({ deterministic: true, message: 'could not fetch' });
    });

    it('the builder schema asks for the agent and offers every executable skill', () => {
        expect(runAgent.schema.agent).toMatchObject({ required: true });
        expect(runAgent.schema.skill.options).toEqual(expect.arrayContaining(['qa-review', 'pr.summary', 'brief.parse', 'digest.ceo']));
    });
});

describe('sentence rules name the agent', () => {
    it('parses "run the <skill> agent as <name>" and describes it back', () => {
        const out = parseSentence('When a task status changes to Done, run the pr.summary agent as "Code Reviewer".');
        expect(out.rule.steps[0]).toEqual({ id: 's1', type: 'action', action: 'run_agent', config: { skill: 'pr.summary', agent: 'Code Reviewer' } });
        expect(describeRule(out.rule)).toMatch(/run the pr\.summary agent as "Code Reviewer"/);
    });
});
