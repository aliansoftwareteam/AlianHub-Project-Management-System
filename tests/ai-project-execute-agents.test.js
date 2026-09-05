const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Agents/proposals', () => ({ create: jest.fn() }));
jest.mock('../Modules/Agents/actions', () => ({ perform: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const runs = require('../Modules/Agents/runs');
const planRules = require('../Modules/AIProjectGenerator/planRules');
const X = require('../Modules/AIProjectGenerator/executeAgents');

const C = 'c1';
const UID = 'u-owner';
const PROJECT_ID = '6f0000000000000000000p01';
const REVIEWER = '6f0000000000000000000a01';
const GUIDE = { stages: [{ name: 'Catalogue in place', goal: 'Every product listed.' }, { name: 'First orders', goal: 'A stranger can pay.' }], essentials: ['Payment account'], escalations: [], style: 'Short.' };

const reviewer = (over = {}) => ({ _id: REVIEWER, name: 'Reviewer', skills: [{ key: 'qa-review' }], allowedActions: ['task.get', 'task.comment'], account: 'workspace', autonomy: 1, spendCapUsd: 10, paused: false, projectIds: [], deletedStatusKey: 0, ...over });

const plan = () => ({
    project: { ProjectName: 'Bike shop', LeadUserId: ['u-lead'] },
    sprints: [
        { sprintName: 'W1', tasks: [
            { TaskName: 'Audit https://example.com/checkout for contrast', descriptionBlocks: [], AssigneeUserId: [] },
            { TaskName: 'Decide the launch pricing', descriptionBlocks: [], AssigneeUserId: ['u-pm'] },
        ] },
        { sprintName: 'W2', tasks: [
            { TaskName: 'Set up analytics', descriptionBlocks: [], AssigneeUserId: [], subtasks: [{ TaskName: 'Meet the analytics vendor', descriptionBlocks: [] }] },
        ] },
    ],
});

const docsFor = (labelled) => {
    let n = 0;
    return labelled.sprints.map((s) => X.pairDocs(s.tasks, s.tasks.flatMap((t) => [t].concat(t.subtasks || [])).map((t) => ({ _id: `6f00000000000000000009${String(++n).padStart(2, '0')}`, TaskName: t.TaskName, ProjectID: PROJECT_ID, CompanyId: C }))));
};

const flushImmediates = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    jest.spyOn(runs, 'executeSkill').mockResolvedValue({ status: 'done' });
});

afterEach(flushImmediates);

describe('what lands on the project', () => {
    it('stores the approved brief and the assumptions as the description block, and the guide', () => {
        const fields = X.projectFields({
            approvedBrief: '## What and for whom\nA shop for bikes.\n- commuters\n- couriers',
            assumptions: [{ point: 'constraints', text: 'No launch date given; planning six weeks.' }, 'Budget unknown'],
            guide: GUIDE,
        });
        const types = fields.descriptionBlock.blocks.map((b) => b.type);
        expect(types).toEqual(['header', 'paragraph', 'list', 'header', 'list']);
        expect(fields.descriptionBlock.blocks[3].data.text).toBe('Assumptions');
        expect(fields.descriptionBlock.blocks[4].data.items.map((i) => i.content)).toEqual(['No launch date given; planning six weeks.', 'Budget unknown']);
        expect(fields.description).toContain('A shop for bikes.');
        expect(fields.aiAssumptions).toEqual([{ point: 'constraints', text: 'No launch date given; planning six weeks.' }, { point: null, text: 'Budget unknown' }]);
        expect(fields.aiGuide.stages).toEqual(GUIDE.stages);
        expect(fields.aiGuide.markdown).toContain('Catalogue in place');
    });

    it('does not repeat an Assumptions section the brief already carries, and writes nothing for a legacy execute', () => {
        const { descriptionBlock } = X.briefDescription({ approvedBrief: '## Assumptions\n- already here', assumptions: ['again'] });
        expect(descriptionBlock.blocks.filter((b) => b.type === 'header')).toHaveLength(1);
        expect(X.projectFields({})).toEqual({});
        expect(X.projectFields({ guide: { stages: [] } })).toEqual({});
    });
});

describe('what person tasks get', () => {
    it('the plan\'s assignee, or the lead, and a due date inside their sprint', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENTS, reviewer());
        const from = new Date(2026, 8, 9);
        const { plan: out } = await X.prepare({ plan: plan(), companyId: C, fallbackAssignee: 'u-lead', from });
        const [audit, decide] = out.sprints[0].tasks;
        const [setup] = out.sprints[1].tasks;
        expect(audit.split.label).toBe('agent');
        expect(audit.DueDate).toBeUndefined();
        expect(audit.AssigneeUserId).toEqual([]);
        expect(decide.split.label).toBe('person');
        expect(decide.AssigneeUserId).toEqual(['u-pm']);
        const monday = planRules.mondayOf(from);
        const week1Friday = new Date(monday); week1Friday.setDate(monday.getDate() + 4);
        const week2Friday = new Date(monday); week2Friday.setDate(monday.getDate() + 11);
        expect(new Date(decide.DueDate).toDateString()).toBe(week1Friday.toDateString());
        expect(setup.AssigneeUserId).toEqual(['u-lead']);
        expect(new Date(setup.DueDate).toDateString()).toBe(week2Friday.toDateString());
        expect(setup.subtasks[0].split.label).toBe('person');
        expect(new Date(setup.subtasks[0].DueDate).toDateString()).toBe(week2Friday.toDateString());
        expect(out.splitSummary).toEqual({ agent: 1, agentAfter: 0, person: 3 });
    });

    it('pairs every plan entry with its created doc: parents first, then sub-tasks in order', () => {
        const tasks = [{ TaskName: 'A', subtasks: [{ TaskName: 'A1' }, { TaskName: 'A2' }] }, { TaskName: 'B' }];
        const docs = ['A', 'B', 'A1', 'A2'].map((TaskName, i) => ({ _id: String(i), TaskName }));
        const pairs = X.pairDocs(tasks, docs);
        expect(pairs.map((p) => [p.planTask.TaskName, p.doc.TaskName])).toEqual([['A', 'A'], ['B', 'B'], ['A1', 'A1'], ['A2', 'A2']]);
    });
});

describe('the Guide agent and the runs', () => {
    it('creates a Guide agent at L1, scoped to the project, that may only read, comment and create subtasks', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENTS, reviewer());
        const { plan: out, agents } = await X.prepare({ plan: plan(), companyId: C });
        const pairs = docsFor(out).flat();
        const result = await X.start({ companyId: C, uid: UID, projectId: PROJECT_ID, projectName: 'Bike shop', pairs, agents, withGuide: true });
        const guide = mockDb.store[SCHEMA_TYPE.AGENTS].find((a) => a.name === 'Bike shop Guide');
        expect(guide).toBeTruthy();
        expect(result.guideAgentId).toBe(String(guide._id));
        expect(guide).toMatchObject({ autonomy: 1, projectIds: [PROJECT_ID], allowedActions: ['task.get', 'task.comment', 'subtask.create'], trigger: 'mention', ownerId: UID, paused: false, account: 'workspace', deletedStatusKey: 0 });
        expect(guide.skills).toEqual([{ key: 'project.guide', name: 'Project Guide', enabled: true }]);
        expect(socketEmitter.emit).toHaveBeenCalledWith('update', expect.objectContaining({ module: 'agent', data: expect.objectContaining({ kind: 'agent' }) }));
    });

    it('skips the Guide agent for a legacy execute', async () => {
        const result = await X.start({ companyId: C, uid: UID, projectId: PROJECT_ID, projectName: 'Bike shop', pairs: [], agents: [], withGuide: false });
        expect(result).toEqual({ guideAgentId: null, runsQueued: 0, runsRefused: [] });
        expect(mockDb.store[SCHEMA_TYPE.AGENTS] || []).toHaveLength(0);
    });

    it('queues a run for every agent-labelled task and executes it off the request', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENTS, reviewer());
        const { plan: out, agents } = await X.prepare({ plan: plan(), companyId: C });
        const pairs = docsFor(out).flat();
        const result = await X.start({ companyId: C, uid: UID, projectId: PROJECT_ID, projectName: 'Bike shop', pairs, agents, withGuide: true });
        expect(result.runsQueued).toBe(1);
        expect(result.runsRefused).toEqual([]);
        const rows = mockDb.store[SCHEMA_TYPE.AGENT_RUNS];
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ agentId: REVIEWER, skill: 'qa-review', trigger: 'assignment', status: 'running', projectId: PROJECT_ID, startedBy: UID, taskId: pairs[0].doc._id });
        expect(rows[0].actions[0].note).toMatch(/AI project plan/);
        await flushImmediates();
        expect(runs.executeSkill).toHaveBeenCalledTimes(1);
        const [companyId, run, agent, task, deps] = runs.executeSkill.mock.calls[0];
        expect(companyId).toBe(C);
        expect(String(run._id)).toBe(String(rows[0]._id));
        expect(String(agent._id)).toBe(REVIEWER);
        expect(task.TaskName).toMatch(/^Audit/);
        expect(deps.actor).toMatchObject({ kind: 'agent', agentId: REVIEWER, userId: UID, runId: String(rows[0]._id) });
    });

    it('creates no run and says why when every agent is paused', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENTS, reviewer({ paused: true, pausedReason: 'Paused by the owner' }));
        const { plan: out, agents } = await X.prepare({ plan: plan(), companyId: C });
        expect(out.sprints[0].tasks[0].split.label).toBe('agent');
        const pairs = docsFor(out).flat();
        const result = await X.start({ companyId: C, uid: UID, projectId: PROJECT_ID, projectName: 'Bike shop', pairs, agents, withGuide: true });
        expect(result.runsQueued).toBe(0);
        expect(result.runsRefused).toEqual([{ taskId: pairs[0].doc._id, reason: 'Agent is paused (Paused by the owner).' }]);
        expect(mockDb.store[SCHEMA_TYPE.AGENT_RUNS] || []).toHaveLength(0);
        await flushImmediates();
        expect(runs.executeSkill).not.toHaveBeenCalled();
    });

    it('respects the spend cap and the daily limit', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENTS, reviewer({ spendCapUsd: 5, spendMonth: { month: runs.monthKey(), usd: 5 } }));
        let prepared = await X.prepare({ plan: plan(), companyId: C });
        let result = await X.start({ companyId: C, uid: UID, projectId: PROJECT_ID, projectName: 'Bike shop', pairs: docsFor(prepared.plan).flat(), agents: prepared.agents, withGuide: false });
        expect(result.runsRefused[0].reason).toMatch(/Spend cap reached/);

        mockDb.store[SCHEMA_TYPE.AGENTS].length = 0;
        mockDb.seed(SCHEMA_TYPE.AGENTS, reviewer({ rateLimitPerDay: 1 }));
        mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: REVIEWER, status: 'done', startedAt: new Date() });
        prepared = await X.prepare({ plan: plan(), companyId: C });
        result = await X.start({ companyId: C, uid: UID, projectId: PROJECT_ID, projectName: 'Bike shop', pairs: docsFor(prepared.plan).flat(), agents: prepared.agents, withGuide: false });
        expect(result.runsQueued).toBe(0);
        expect(result.runsRefused[0].reason).toMatch(/Daily run limit/);
    });

    it('refuses an agent that was scoped to another project after the plan was made', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENTS, reviewer());
        const { plan: out, agents } = await X.prepare({ plan: plan(), companyId: C });
        agents[0].projectIds = ['6f0000000000000000000p99'];
        const result = await X.start({ companyId: C, uid: UID, projectId: PROJECT_ID, projectName: 'Bike shop', pairs: docsFor(out).flat(), agents, withGuide: false });
        expect(result.runsRefused[0].reason).toMatch(/not scoped/);
    });
});
