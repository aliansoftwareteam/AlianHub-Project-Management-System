const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { splitFor, splitSummary, classifyTask } = require('../Modules/Agents/taskSplit');
const { attachSplit, labelPlan } = require('../Modules/AIProjectGenerator/planSplit');

const agent = (over = {}) => ({ _id: 'a1', name: 'Reviewer', skills: [{ key: 'qa-review' }], allowedActions: ['task.get', 'task.comment'], paused: false, projectIds: [], ...over });
const LONG = 'a'.repeat(60);

describe('the label for one task', () => {
    it('is a person for a decision or a conversation, with the reason', () => {
        const decision = splitFor({ task: { TaskName: 'Decide the pricing tiers' }, agents: [agent()] });
        expect(decision).toMatchObject({ label: 'person', skill: null, need: null });
        expect(decision.reason).toMatch(/decision/);
        const call = splitFor({ task: { TaskName: 'Call the vendor about the SLA' }, agents: [agent()] });
        expect(call.label).toBe('person');
        expect(call.reason).toMatch(/outside the tool/);
    });

    it('public_url: qa-review takes a review task that carries a public URL, waits when it does not', () => {
        const ready = splitFor({ task: { TaskName: 'Audit https://example.com/checkout for contrast' }, agents: [agent()] });
        expect(ready).toMatchObject({ label: 'agent', skill: 'qa-review', need: null, agentId: 'a1' });
        const waiting = splitFor({ task: { TaskName: 'Audit the checkout page for contrast' }, agents: [agent()] });
        expect(waiting).toMatchObject({ label: 'agent-after', skill: 'qa-review', need: 'public_url' });
        expect(waiting.reason).toMatch(/public URL/);
        const local = splitFor({ task: { TaskName: 'Audit http://localhost:4000/ai for contrast' }, agents: [agent()] });
        expect(local.need).toBe('public_url');
    });

    it('pr_link: pr.summary takes code work with a pull request link, waits without one', () => {
        const a = agent({ skills: [{ key: 'pr.summary' }] });
        const ready = splitFor({ task: { TaskName: 'Fix the failing checkout test', links: [{ kind: 'pr', url: 'https://github.com/a/b/pull/7' }] }, agents: [a] });
        expect(ready).toMatchObject({ label: 'agent', skill: 'pr.summary', need: null });
        const waiting = splitFor({ task: { TaskName: 'Fix the failing checkout test' }, agents: [a] });
        expect(waiting).toMatchObject({ label: 'agent-after', skill: 'pr.summary', need: 'pr_link' });
    });

    it('brief: brief.parse takes a breakdown with a long enough brief, waits on a thin one', () => {
        const a = agent({ skills: [{ key: 'brief.parse' }], allowedActions: ['task.get', 'subtask.create', 'task.comment'] });
        const ready = splitFor({ task: { TaskName: 'Break down the onboarding epic', rawDescription: LONG }, agents: [a] });
        expect(ready).toMatchObject({ label: 'agent', skill: 'brief.parse', need: null });
        const waiting = splitFor({ task: { TaskName: 'Break down the onboarding epic', rawDescription: 'short' }, agents: [a] });
        expect(waiting).toMatchObject({ label: 'agent-after', skill: 'brief.parse', need: 'brief' });
        expect(waiting.reason).toMatch(/40 characters/);
    });

    it('project_task: a digest skill matches a report but always needs the project, never one task', () => {
        const a = agent({ skills: [{ key: 'digest.ceo' }] });
        const out = splitFor({ task: { TaskName: 'Write the weekly digest', rawDescription: LONG }, agents: [a] });
        expect(out).toMatchObject({ label: 'agent-after', skill: 'digest.ceo', need: 'project_task' });
    });

    it('prefers a skill that can start now over one that has to wait', () => {
        const agents = [agent({ _id: 'w', name: 'Waiter', skills: [{ key: 'risk.today' }] }), agent({ _id: 'r', name: 'Ready', skills: [{ key: 'qa-review' }] })];
        const out = splitFor({ task: { TaskName: 'Review https://example.com/checkout for consistency' }, agents });
        expect(out).toMatchObject({ label: 'agent', skill: 'qa-review', agentId: 'r' });
    });

    it('is a person when no agent has a runnable skill for the kind of work', () => {
        expect(splitFor({ task: { TaskName: 'Audit https://example.com' }, agents: [] }).label).toBe('person');
        const wrongSkill = splitFor({ task: { TaskName: 'Audit https://example.com' }, agents: [agent({ skills: [{ key: 'brief.parse' }] })] });
        expect(wrongSkill.label).toBe('person');
        expect(wrongSkill.reason).toMatch(/find the problems/);
        const general = splitFor({ task: { TaskName: 'Something else entirely' }, agents: [agent()] });
        expect(general.label).toBe('person');
        expect(classifyTask({ TaskName: 'Something else entirely' }).kind).toBe('general');
    });

    it('ignores an agent that cannot read tasks, is scoped elsewhere, or has the skill disabled', () => {
        const task = { TaskName: 'Audit https://example.com/checkout', ProjectID: 'p9' };
        expect(splitFor({ task, agents: [agent({ allowedActions: ['task.comment'] })] }).label).toBe('person');
        expect(splitFor({ task, agents: [agent({ projectIds: ['p1'] })] }).label).toBe('person');
        expect(splitFor({ task, agents: [agent({ projectIds: ['p9'] })] }).label).toBe('agent');
        expect(splitFor({ task, agents: [agent({ skills: [{ key: 'qa-review', enabled: false }] })] }).label).toBe('person');
    });

    it('accepts legacy string skills', () => {
        expect(splitFor({ task: { TaskName: 'Audit https://example.com' }, agents: [agent({ skills: ['qa-review'] })] }).label).toBe('agent');
    });
});

describe('the split on a whole plan', () => {
    const plan = {
        project: { ProjectName: 'Shop' },
        sprints: [{
            sprintName: 'S1',
            tasks: [
                { TaskName: 'Audit https://example.com/checkout', descriptionBlocks: [{ type: 'paragraph', data: { text: 'Check it' } }] },
                { TaskName: 'Decide the launch pricing', descriptionBlocks: [] },
                {
                    TaskName: 'Set up analytics',
                    descriptionBlocks: [],
                    subtasks: [{ TaskName: 'Review https://example.com/analytics tag', descriptionBlocks: [] }, { TaskName: 'Meet the analytics vendor', descriptionBlocks: [] }],
                },
            ],
        }],
    };

    beforeEach(() => { Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; }); mockDb.calls.length = 0; });

    it('labels every task and subtask, counts them, and echoes the assumptions', () => {
        const out = labelPlan(plan, [agent()]);
        const [audit, decide, setup] = out.sprints[0].tasks;
        expect(audit.split.label).toBe('agent');
        expect(decide.split.label).toBe('person');
        expect(setup.split.label).toBe('person');
        expect(setup.subtasks.map((s) => s.split.label)).toEqual(['agent', 'person']);
        expect(out.splitSummary).toEqual({ agent: 2, agentAfter: 0, person: 3 });
        expect(splitSummary([{ label: 'agent-after' }])).toEqual({ agent: 0, agentAfter: 1, person: 0 });
        expect(plan.sprints[0].tasks[0].split).toBeUndefined();
    });

    it('reads only live, unpaused, workspace-wide agents from the company', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENTS, agent({ _id: '6f0000000000000000000a01', deletedStatusKey: 0 }));
        mockDb.seed(SCHEMA_TYPE.AGENTS, agent({ _id: '6f0000000000000000000a02', name: 'Gone', deletedStatusKey: 1 }));
        mockDb.seed(SCHEMA_TYPE.AGENTS, agent({ _id: '6f0000000000000000000a03', name: 'Paused', paused: true, deletedStatusKey: 0 }));
        mockDb.seed(SCHEMA_TYPE.AGENTS, agent({ _id: '6f0000000000000000000a04', name: 'Elsewhere', projectIds: ['p1'], deletedStatusKey: 0 }));
        const assumptions = [{ point: 'constraints', text: 'No launch date given; planning for six weeks.' }];
        const out = await attachSplit(plan, { companyId: 'c1', assumptions });
        expect(mockDb.calls[0]).toMatchObject({ companyId: 'c1', type: SCHEMA_TYPE.AGENTS, method: 'find' });
        expect(out.sprints[0].tasks[0].split).toMatchObject({ label: 'agent', agentId: '6f0000000000000000000a01' });
        expect(out.assumptions).toEqual(assumptions);
        expect(out.splitSummary.agent).toBe(2);
    });

    it('is all person with no agents at all, and never throws on a thin plan', async () => {
        const out = await attachSplit({ project: {}, sprints: [{ tasks: [{ TaskName: 'Audit https://example.com' }] }] }, { companyId: 'c1' });
        expect(out.sprints[0].tasks[0].split.label).toBe('person');
        expect(out.splitSummary).toEqual({ agent: 0, agentAfter: 0, person: 1 });
        expect(out.assumptions).toEqual([]);
    });
});
