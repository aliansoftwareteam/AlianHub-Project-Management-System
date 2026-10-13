jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => []) }));
jest.mock('../Modules/settings/ProjectSkills/helper', () => ({ resolveProjectSkills: jest.fn(async () => []), getActiveSkillSlugs: jest.fn(async () => []) }));
jest.mock('../Modules/AIProjectGenerator/orchestrator', () => ({ normalizePlanColors: (p) => p, executePlan: jest.fn(async () => ({ ok: true })) }));
jest.mock('../Modules/AIProjectGenerator/sseEmitter', () => ({ emit: jest.fn(), handleEvents: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));

const orchestrator = require('../Modules/AIProjectGenerator/orchestrator');
const automationRequests = require('../Modules/Agents/automationRequests');
const projectCreate = require('../Modules/Agents/projectCreate');
const planPicks = require('../Modules/AIProjectGenerator/planPicks');
const planStash = require('../Modules/AIProjectGenerator/planStash');
const ctrl = require('../Modules/AIProjectGenerator/controller');

const C = '6f0000000000000000000c01';
const U = '6f0000000000000000000a01';

const TELL_CREATOR = { name: 'Tell the creator when done', trigger: 'task.status_changed', conditions: [{ field: 'statusRef', op: 'changedTo', value: 'Done' }], actions: [{ action: 'notify', config: { recipients: ['task_creator'], message: 'Finished.' } }] };
const REVIEW_SUBTASK = { name: 'Add a review subtask', trigger: 'task.created', actions: [{ action: 'create_subtask', config: { title: 'Review' } }] };

const task = (TaskName) => ({
    TaskName,
    status: 'To Do',
    priority: 'Medium',
    descriptionBlocks: [
        { type: 'paragraph', data: { text: 'Context for the task.' } },
        { type: 'header', data: { text: 'What to do', level: 4 } },
        { type: 'list', data: { style: 'ordered', items: ['Step one'] } },
        { type: 'header', data: { text: 'Acceptance criteria', level: 4 } },
        { type: 'list', data: { style: 'unordered', items: ['It works'] } },
    ],
});

const plan = () => ({
    project: {
        ProjectName: 'Bike shop',
        description: 'A project long enough to pass the minimum.',
        projectStatusData: [{ name: 'Planning', type: 'default_active' }, { name: 'Closed', type: 'close' }],
        taskStatusData: [{ name: 'To Do', type: 'default_active' }, { name: 'Done', type: 'close' }],
        taskTypeCounts: [{ name: 'Task', key: 1 }],
    },
    sprints: [
        { sprintName: 'W1', tasks: [task('Repo'), task('Theme')] },
        { sprintName: 'W2', tasks: [task('Launch')] },
    ],
    views: [{ name: 'Board by person', kind: 'board', look: { groupBy: 'assignee' } }, { name: 'Due dates', kind: 'calendar' }],
    rules: [TELL_CREATOR, REVIEW_SUBTASK],
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; return r; };
const req = (body) => ({ headers: { companyid: C }, aud: [C], body: { source: 'other', ...body }, uid: U });

const TAMPERED = { project: { ProjectName: 'Other' }, sprints: [{ sprintName: 'Extra', tasks: [task('Extra')] }], views: [], rules: [] };

/* The plan and brief are stored as /plan stores them; the body carries a different plan and brief, which are ignored. */
const run = async ({ plan: proposed, approvedBrief = '', ...body }) => {
    orchestrator.executePlan.mockClear();
    const planId = planStash.rememberPlan({ uid: U, companyId: C, plan: proposed, approvedBrief });
    const r = res();
    await ctrl.execute(req({ ...body, planId, plan: TAMPERED, approvedBrief: approvedBrief ? '' : '## Brief from the body' }), r);
    await sleep(300);
    const calls = orchestrator.executePlan.mock.calls;
    return { r, call: calls[0] && calls[0][0] };
};

const namesIn = (made) => ({
    lists: made.plan.sprints.map((sprint) => sprint.sprintName),
    tasks: made.plan.sprints.flatMap((sprint) => sprint.tasks.map((t) => t.TaskName)),
    views: made.plan.views.map((view) => view.name),
    rules: made.plan.rules.map((rule) => rule.name),
});

beforeEach(() => {
    jest.spyOn(automationRequests, 'mayManage').mockResolvedValue(true);
    jest.spyOn(projectCreate, 'refusedFor').mockResolvedValue({ project: '', parts: [] });
});
afterEach(() => jest.restoreAllMocks());

describe('/execute with the parts ticked on the plan card', () => {
    it('makes every part, the Guide agent too, when no picks are sent', async () => {
        const { r, call } = await run({ plan: plan(), approvedBrief: '## Brief' });
        expect(r.body).toMatchObject({ status: true });
        expect(namesIn(call)).toEqual({ lists: ['W1', 'W2'], tasks: ['Repo', 'Theme', 'Launch'], views: ['Board by person', 'Due dates'], rules: ['Tell the creator when done', 'Add a review subtask'] });
        expect(call.withGuideAgent).toBe(true);
    });

    it('makes no Guide agent for a plan stored without a brief, whatever brief the body carries', async () => {
        const { call } = await run({ plan: plan() });
        expect(namesIn(call).lists).toEqual(['W1', 'W2']);
        expect(call.withGuideAgent).toBe(false);
        expect(call.approvedBrief).toBe('');
    });

    it('makes only the ticked parts', async () => {
        const { call } = await run({ plan: plan(), approvedBrief: '## Brief', picks: { lists: [0, 1], tasks: [0, 2], views: [1], rules: [0], agents: [] } });
        expect(namesIn(call)).toEqual({ lists: ['W1', 'W2'], tasks: ['Repo', 'Launch'], views: ['Due dates'], rules: ['Tell the creator when done'] });
        expect(call.withGuideAgent).toBe(false);
    });

    it('ignores places and kinds the plan does not hold, so picks never add a part', async () => {
        const { call } = await run({ plan: plan(), picks: { lists: [0, 7, -1, '1'], tasks: [0, 1, 2, 99, 1.5], views: [5], rules: [0, 0, 2], agents: [0], dashboards: [0] } });
        expect(namesIn(call)).toEqual({ lists: ['W1'], tasks: ['Repo', 'Theme'], views: [], rules: ['Tell the creator when done'] });
        expect(call.withGuideAgent).toBe(false);
        expect(call.plan).not.toHaveProperty('dashboards');
    });

    it('leaves a task out with its list', async () => {
        const { call } = await run({ plan: plan(), picks: { lists: [1], tasks: [0, 1, 2], views: [0, 1], rules: [0, 1] } });
        expect(namesIn(call).lists).toEqual(['W2']);
        expect(namesIn(call).tasks).toEqual(['Launch']);
    });

    it('keeps a ticked list whose tasks are all unticked, as an empty list', async () => {
        const { call } = await run({ plan: plan(), picks: { lists: [0, 1], tasks: [2], views: [], rules: [] } });
        expect(call.plan.sprints.map((sprint) => [sprint.sprintName, sprint.tasks.length])).toEqual([['W1', 0], ['W2', 1]]);
    });

    it('refuses a plan with no list kept, or picks that are not a record', async () => {
        const none = await run({ plan: plan(), picks: { lists: [], tasks: [] } });
        expect(none.r.code).toBe(400);
        expect(none.r.body.statusText).toBe(planPicks.REFUSED.noList);
        expect(none.call).toBeUndefined();
        const odd = await run({ plan: plan(), picks: ['lists:0'] });
        expect(odd.r.code).toBe(400);
        expect(odd.call).toBeUndefined();
    });

    it('leaves out the parts the person may not make, whatever is ticked', async () => {
        automationRequests.mayManage.mockResolvedValue(false);
        projectCreate.refusedFor.mockResolvedValue({ project: '', parts: [{ part: 'views', reason: 'ProjectRequiredComponent is not granted' }] });
        const ticked = await run({ plan: plan(), picks: { lists: [0, 1], tasks: [0, 1, 2], views: [0, 1], rules: [0, 1] } });
        expect(namesIn(ticked.call)).toEqual({ lists: ['W1', 'W2'], tasks: ['Repo', 'Theme', 'Launch'], views: [], rules: [] });
        const whole = await run({ plan: plan() });
        expect(namesIn(whole.call)).toMatchObject({ views: [], rules: [] });
    });
});

describe('the locks a generator plan carries', () => {
    it('locks the rules for a person who may not manage automations, and the views for one whose role may not add them', async () => {
        automationRequests.mayManage.mockResolvedValue(false);
        projectCreate.refusedFor.mockResolvedValue({ project: '', parts: [{ part: 'views', reason: 'x' }] });
        const marks = planPicks.marksOf(await planPicks.locksFor({ companyId: C, uid: U, plan: plan() }));
        expect(marks).toEqual({
            locked: ['rules:0', 'rules:1', 'views:0', 'views:1'],
            lockedWhy: { 'rules:0': 'owner_admin', 'rules:1': 'owner_admin', 'views:0': 'own_rights', 'views:1': 'own_rights' },
        });
    });

    it('locks the views for a person who may not create a project at all', async () => {
        projectCreate.refusedFor.mockResolvedValue({ project: 'project.create is not granted', parts: [] });
        const marks = planPicks.marksOf(await planPicks.locksFor({ companyId: C, uid: U, plan: plan() }));
        expect(marks.locked).toEqual(['views:0', 'views:1']);
    });

    it('locks nothing for an owner or admin', async () => {
        expect(planPicks.marksOf(await planPicks.locksFor({ companyId: C, uid: U, plan: plan() }))).toEqual({ locked: [], lockedWhy: {} });
    });
});
