const mockDb = require('./fixtures/fakeMongo').create();
const mockChat = jest.fn();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/AICore/llmProvider', () => ({
    getProvider: () => ({ name: 'fake', chat: (...a) => mockChat(...a) }),
    isAnyProviderConfigured: () => true,
}));
jest.mock('../Modules/settings/ProjectSkills/helper', () => ({ resolveProjectSkills: jest.fn(async () => []), getActiveSkillSlugs: jest.fn(async () => []) }));
jest.mock('../Modules/AIProjectGenerator/orchestrator', () => ({ normalizePlanColors: (p) => p, executePlan: jest.fn(async () => ({ ok: true })) }));
jest.mock('../Modules/AIProjectGenerator/sseEmitter', () => ({ emit: jest.fn(), handleEvents: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { myCache } = require('../Config/config');
const orchestrator = require('../Modules/AIProjectGenerator/orchestrator');
const ctrl = require('../Modules/AIProjectGenerator/controller');
const guideCtrl = require('../Modules/AIProjectGenerator/guideController');
const planStash = require('../Modules/AIProjectGenerator/planStash');

const C = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const OWNER = '6f0000000000000000000a01';
const MEMBER = '6f0000000000000000000a03';
const BRIEF = '## What and for whom\nA bike shop that sells online.';

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

const storedPlan = () => ({
    project: {
        ProjectName: 'Bike shop',
        description: 'A project long enough to pass the minimum.',
        projectStatusData: [{ name: 'Planning', type: 'default_active' }, { name: 'Closed', type: 'close' }],
        taskStatusData: [{ name: 'To Do', type: 'default_active' }, { name: 'Done', type: 'close' }],
        taskTypeCounts: [{ name: 'Task', key: 1 }],
        isPrivateSpace: false,
    },
    sprints: [{ sprintName: 'Week 1', tasks: [task('Set up the repo'), task('Draft the catalogue')] }],
});

const GUIDE = {
    stages: [{ name: 'Build', goal: 'Ship the shop' }, { name: 'Launch', goal: 'Open it' }],
    essentials: ['Payments work'],
    escalations: ['A refund is asked for'],
    style: 'Short.',
};

const routes = {};
require('../Modules/AIProjectGenerator/routes').init({
    post: (path, ...handlers) => { routes[path] = handlers.flat(); },
    get: () => {},
});

const res = () => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; return r; };
    r.json = r.send;
    return r;
};
const req = (body, uid = OWNER, company = C) => ({ headers: { companyid: company }, aud: [company], body, uid });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const post = async (path, request) => {
    const r = res();
    for (const handler of routes[path]) {
        let passed = false;
        await handler(request, r, () => { passed = true; });
        if (!passed) break;
    }
    return r;
};

const execute = async (body, uid) => {
    const r = await post('/api/v1/ai/project/execute', req(body, uid));
    await sleep(250);
    return r;
};
const built = () => orchestrator.executePlan.mock.calls[0][0];

const mode = process.env.PERMISSION_ENFORCEMENT_MODE;
beforeAll(() => { process.env.PERMISSION_ENFORCEMENT_MODE = 'enforce'; });
afterAll(() => { if (mode === undefined) delete process.env.PERMISSION_ENFORCEMENT_MODE; else process.env.PERMISSION_ENFORCEMENT_MODE = mode; });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    myCache.flushAll();
    mockChat.mockReset();
    orchestrator.executePlan.mockClear();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false, Employee_Name: 'Owner' });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: 3, status: 2, isDelete: false, Employee_Name: 'Member' });
    const project = mockDb.seed(SCHEMA_TYPE.RULES, { key: 'project', name: 'Project', isParent: true, roles: [{ key: 3, permission: false }] });
    mockDb.seed(SCHEMA_TYPE.RULES, { key: 'project_create', name: 'project_create', isParent: false, parentId: String(project._id), roles: [] });
});

describe('the generator asks for the right to create a project', () => {
    it('refuses /plan to a member without it, before any AI call', async () => {
        const r = await post('/api/v1/ai/project/plan', req({ description: 'A shop for bikes that sells online and ships.' }, MEMBER));
        await sleep(250);
        expect(r.code).toBe(403);
        expect(r.body.statusText).toBe('You do not have permission to perform this action.');
        expect(mockChat).not.toHaveBeenCalled();
    });

    it('refuses /execute to a member without it, and nothing is built', async () => {
        const planId = planStash.rememberPlan({ uid: MEMBER, companyId: C, plan: storedPlan() });
        const r = await execute({ planId, source: 'other' }, MEMBER);
        expect(r.code).toBe(403);
        expect(r.body.statusText).toBe('You do not have permission to perform this action.');
        expect(orchestrator.executePlan).not.toHaveBeenCalled();
    });

    it('lets the owner through to build', async () => {
        const planId = planStash.rememberPlan({ uid: OWNER, companyId: C, plan: storedPlan() });
        const r = await execute({ planId, source: 'other' });
        expect(r.body).toMatchObject({ status: true, jobId: expect.any(String) });
        expect(orchestrator.executePlan).toHaveBeenCalledTimes(1);
    });
});

describe('/execute builds the plan /plan proposed', () => {
    it('builds the stored plan whatever plan the body carries', async () => {
        const planId = planStash.rememberPlan({ uid: OWNER, companyId: C, plan: storedPlan() });
        const other = storedPlan();
        other.sprints.push({ sprintName: 'Extra', tasks: [task('Extra work')] });
        other.sprints[0].tasks.push(task('Another task'));
        await execute({ planId, plan: other, source: 'other' });
        const { plan } = built();
        expect(plan.sprints.map((s) => s.sprintName)).toEqual(['Week 1']);
        expect(plan.sprints[0].tasks.map((t) => t.TaskName)).toEqual(['Set up the repo', 'Draft the catalogue']);
    });

    it('applies the renames and the privacy choice to the stored plan, and leaves the stored copy as it was', async () => {
        const planId = planStash.rememberPlan({ uid: OWNER, companyId: C, plan: storedPlan() });
        orchestrator.executePlan.mockResolvedValueOnce({ ok: false, error: 'rolled back' });
        await execute({
            planId,
            source: 'other',
            isPrivateSpace: true,
            edits: { project: { ProjectName: 'Cycle store' }, sprints: [{ sprintName: 'Kickoff', tasks: [null, { TaskName: 'Write the catalogue' }, { TaskName: 'Ignored' }] }, { sprintName: 'Ignored' }] },
        });
        const { plan } = built();
        expect(plan.project.ProjectName).toBe('Cycle store');
        expect(plan.project.isPrivateSpace).toBe(true);
        expect(plan.sprints.map((s) => s.sprintName)).toEqual(['Kickoff']);
        expect(plan.sprints[0].tasks.map((t) => t.TaskName)).toEqual(['Set up the repo', 'Write the catalogue']);
        expect(planStash.storedPlan({ uid: OWNER, companyId: C, planId }).plan.project.ProjectName).toBe('Bike shop');
    });

    it.each([
        ['no planId', () => undefined],
        ['an unknown planId', () => 'f'.repeat(24)],
        ['a planId that has expired', () => {
            const planId = planStash.rememberPlan({ uid: OWNER, companyId: C, plan: storedPlan() });
            myCache.del(planStash.cacheKey('plan', OWNER, planId));
            return planId;
        }],
        ['another person\'s planId', () => planStash.rememberPlan({ uid: MEMBER, companyId: C, plan: storedPlan() })],
        ['a planId from another company', () => planStash.rememberPlan({ uid: OWNER, companyId: OTHER_COMPANY, plan: storedPlan() })],
    ])('answers 410 for %s and builds nothing', async (_, planIdOf) => {
        const r = await execute({ planId: planIdOf(), plan: storedPlan(), source: 'other' });
        expect(r.code).toBe(410);
        expect(r.body).toEqual({ status: false, statusText: 'This plan has expired. Generate it again.', code: 'PLAN_EXPIRED' });
        expect(orchestrator.executePlan).not.toHaveBeenCalled();
    });

    it('keeps the plan for the generator session', () => {
        expect(planStash.PLAN_TTL_SECONDS).toBeGreaterThanOrEqual(60 * 60);
    });

    it('builds one project from a plan: a second /execute with the same planId answers 410', async () => {
        const planId = planStash.rememberPlan({ uid: OWNER, companyId: C, plan: storedPlan() });
        const first = await execute({ planId, source: 'other' });
        expect(first.body.status).toBe(true);
        const second = await execute({ planId, source: 'other' });
        expect(second.code).toBe(410);
        expect(orchestrator.executePlan).toHaveBeenCalledTimes(1);
    });

    it('refuses a second /execute while the first is still building, and frees the plan when the build fails', async () => {
        let finish;
        orchestrator.executePlan.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
        const planId = planStash.rememberPlan({ uid: OWNER, companyId: C, plan: storedPlan() });
        expect((await execute({ planId, source: 'other' })).body.status).toBe(true);
        const second = await execute({ planId, source: 'other' });
        expect(second.code).toBe(409);
        expect(second.body).toEqual({ status: false, statusText: 'This plan is already being built.', code: 'PLAN_IN_USE' });
        finish({ ok: false, error: 'rolled back' });
        await sleep(10);
        expect((await execute({ planId, source: 'other' })).body.status).toBe(true);
        expect(orchestrator.executePlan).toHaveBeenCalledTimes(2);
    });

    it('starts exactly one build when two /execute calls for the same plan race', async () => {
        const planId = planStash.rememberPlan({ uid: OWNER, companyId: C, plan: storedPlan() });
        const [a, b] = await Promise.all([
            post('/api/v1/ai/project/execute', req({ planId, source: 'other' })),
            post('/api/v1/ai/project/execute', req({ planId, source: 'other' })),
        ]);
        await sleep(250);
        expect([a, b].filter((r) => r.body.status === true)).toHaveLength(1);
        expect([a, b].map((r) => r.code).sort()).toEqual([200, 409]);
        expect(orchestrator.executePlan).toHaveBeenCalledTimes(1);
    });

    it('holds a plan for a build with a claim shorter than the plan\'s life, which lapses so the person can retry', async () => {
        orchestrator.executePlan.mockImplementationOnce(() => new Promise(() => {}));
        const planId = planStash.rememberPlan({ uid: OWNER, companyId: C, plan: storedPlan() });
        expect((await execute({ planId, source: 'other' })).body.status).toBe(true);
        const claim = planStash.cacheKey('planclaim', OWNER, planId);
        expect(planStash.CLAIM_TTL_SECONDS).toBeLessThan(planStash.PLAN_TTL_SECONDS);
        expect(myCache.getTtl(claim) - Date.now()).toBeLessThanOrEqual(planStash.CLAIM_TTL_SECONDS * 1000);
        expect((await execute({ planId, source: 'other' })).code).toBe(409);
        myCache.del(claim);
        expect((await execute({ planId, source: 'other' })).body.status).toBe(true);
        expect(orchestrator.executePlan).toHaveBeenCalledTimes(2);
    });

    it('keeps a lapsed build from freeing or using up the plan another build has since claimed', async () => {
        let finishA;
        orchestrator.executePlan.mockImplementationOnce(() => new Promise((resolve) => { finishA = resolve; }));
        orchestrator.executePlan.mockImplementationOnce(() => new Promise(() => {}));
        const planId = planStash.rememberPlan({ uid: OWNER, companyId: C, plan: storedPlan() });
        expect((await execute({ planId, source: 'other' })).body.status).toBe(true);
        myCache.del(planStash.cacheKey('planclaim', OWNER, planId));
        expect((await execute({ planId, source: 'other' })).body.status).toBe(true);
        finishA({ ok: true });
        await sleep(10);
        expect(planStash.storedPlan({ uid: OWNER, companyId: C, planId })).toBeTruthy();
        expect(planStash.isClaimed({ uid: OWNER, planId })).toBe(true);
        expect((await execute({ planId, source: 'other' })).code).toBe(409);
    });

    it('releases a claim only for the token that holds it', () => {
        const planId = planStash.rememberPlan({ uid: OWNER, companyId: C, plan: storedPlan() });
        const token = planStash.claimPlan({ uid: OWNER, planId });
        expect(planStash.claimPlan({ uid: OWNER, planId })).toBeNull();
        expect(planStash.releasePlan({ uid: OWNER, planId, token: 'f'.repeat(24) })).toBe(false);
        expect(planStash.releasePlan({ uid: OWNER, planId })).toBe(false);
        expect(planStash.forgetPlan({ uid: OWNER, planId, token: 'f'.repeat(24) })).toBe(false);
        expect(planStash.forgetPlan({ uid: OWNER, planId })).toBe(false);
        expect(planStash.isClaimed({ uid: OWNER, planId })).toBe(true);
        expect(planStash.releasePlan({ uid: OWNER, planId, token })).toBe(true);
        expect(planStash.isClaimed({ uid: OWNER, planId })).toBe(false);
    });

    it('renews the claim while the build runs, and stops when it settles', async () => {
        const planId = planStash.rememberPlan({ uid: OWNER, companyId: C, plan: storedPlan() });
        const claim = { uid: OWNER, planId, token: planStash.claimPlan({ uid: OWNER, planId }) };
        const key = planStash.cacheKey('planclaim', OWNER, planId);
        myCache.ttl(key, 1);
        let finish;
        const running = planStash.keepClaimWhile(claim, new Promise((resolve) => { finish = resolve; }), { every: 20 });
        await sleep(60);
        expect(myCache.getTtl(key) - Date.now()).toBeGreaterThan(60 * 1000);
        finish('done');
        expect(await running).toBe('done');
        myCache.ttl(key, 1);
        await sleep(60);
        expect(myCache.getTtl(key) - Date.now()).toBeLessThanOrEqual(1000);
    });

    it('frees the plan when the build throws', async () => {
        orchestrator.executePlan.mockRejectedValueOnce(new Error('boom'));
        const planId = planStash.rememberPlan({ uid: OWNER, companyId: C, plan: storedPlan() });
        await execute({ planId, source: 'other' });
        expect(planStash.isClaimed({ uid: OWNER, planId })).toBe(false);
        expect((await execute({ planId, source: 'other' })).body.status).toBe(true);
    });

    it('never pushes out a plan being built, and refuses a new plan when every kept plan is being built', async () => {
        const ids = [1, 2, 3].map(() => planStash.rememberPlan({ uid: OWNER, companyId: C, plan: storedPlan() }));
        const token = planStash.claimPlan({ uid: OWNER, planId: ids[0] });
        const fourth = planStash.rememberPlan({ uid: OWNER, companyId: C, plan: storedPlan() });
        expect(ids.map((planId) => Boolean(planStash.storedPlan({ uid: OWNER, companyId: C, planId })))).toEqual([true, false, true]);
        planStash.claimPlan({ uid: OWNER, planId: ids[2] });
        planStash.claimPlan({ uid: OWNER, planId: fourth });
        expect(planStash.rememberPlan({ uid: OWNER, companyId: C, plan: storedPlan() })).toBeNull();
        [ids[0], ids[2], fourth].forEach((planId) => expect(planStash.storedPlan({ uid: OWNER, companyId: C, planId })).toBeTruthy());

        const r = await post('/api/v1/ai/project/plan', req({ description: 'A shop for bikes that sells online and ships.' }));
        expect(r.code).toBe(409);
        expect(r.body.code).toBe('PLANS_BUSY');
        expect(mockChat).not.toHaveBeenCalled();

        planStash.releasePlan({ uid: OWNER, planId: ids[0], token });
        expect(planStash.rememberPlan({ uid: OWNER, companyId: C, plan: storedPlan() })).toEqual(expect.any(String));
        expect(planStash.storedPlan({ uid: OWNER, companyId: C, planId: ids[0] })).toBeNull();
    });

    it('keeps the last three plans a person generated', () => {
        const ids = [1, 2, 3, 4].map(() => planStash.rememberPlan({ uid: OWNER, companyId: C, plan: storedPlan() }));
        expect(ids.map((planId) => Boolean(planStash.storedPlan({ uid: OWNER, companyId: C, planId })))).toEqual([false, true, true, true]);
        expect(planStash.storedPlan({ uid: MEMBER, companyId: C, planId: planStash.rememberPlan({ uid: MEMBER, companyId: C, plan: storedPlan() }) })).toBeTruthy();
        expect(planStash.storedPlan({ uid: OWNER, companyId: C, planId: ids[1] })).toBeTruthy();
    });
});

describe('the brief and the guide come from the server copy', () => {
    it('takes the brief and assumptions stored at /plan, not the body', async () => {
        const assumptions = [{ point: 'team', text: 'The owner works alone.' }];
        const planId = planStash.rememberPlan({ uid: OWNER, companyId: C, plan: storedPlan(), approvedBrief: BRIEF, assumptions });
        await execute({ planId, source: 'other', approvedBrief: 'Something else entirely, long enough.', assumptions: [{ text: 'other' }], guide: GUIDE });
        expect(built()).toMatchObject({ approvedBrief: BRIEF, assumptions, guide: null });
    });

    it('stores the plan with the brief it was built from at /plan', async () => {
        mockChat.mockResolvedValue({ content: JSON.stringify({ needsClarification: false, plan: storedPlan() }), inputTokens: 1, outputTokens: 1, totalTokens: 2, model: 'fake-1' });
        const sse = require('../Modules/AIProjectGenerator/sseEmitter');
        sse.emit.mockClear();
        await post('/api/v1/ai/project/plan', req({ approvedBrief: BRIEF, assumptions: [{ point: 'team', text: 'The owner works alone.' }] }));
        await sleep(400);
        const complete = sse.emit.mock.calls.map(([, payload]) => payload).find((payload) => payload.event === 'complete');
        const stash = planStash.storedPlan({ uid: OWNER, companyId: C, planId: complete.planId });
        expect(stash.approvedBrief).toBe(BRIEF);
        expect(stash.assumptions).toEqual([{ point: 'team', text: 'The owner works alone.' }]);
    });

    it('builds with the guide drafted at /guide for that plan', async () => {
        const planId = planStash.rememberPlan({ uid: OWNER, companyId: C, plan: storedPlan(), approvedBrief: BRIEF });
        mockChat.mockResolvedValue({ content: JSON.stringify(GUIDE), model: 'fake-1' });
        const g = res();
        await guideCtrl.guide(req({ planId, approvedBrief: 'A different brief the body carries, long enough.' }), g);
        expect(g.body.status).toBe(true);
        expect(mockChat.mock.calls[0][0].messages[0].content).toContain('A bike shop that sells online.');
        expect(mockChat.mock.calls[0][0].messages[0].content).not.toContain('A different brief');

        await execute({ planId, source: 'other', guide: { ...GUIDE, stages: [{ name: 'Other' }, { name: 'Steps' }] } });
        expect(built().guide.stages.map((s) => s.name)).toEqual(['Build', 'Launch']);
        expect(built().guide.markdown).toContain('**Build**');
    });

    it('keeps the person\'s rewording of the stored guide, cut to 20000 characters', async () => {
        const planId = planStash.rememberPlan({ uid: OWNER, companyId: C, plan: storedPlan(), approvedBrief: BRIEF });
        planStash.rememberGuide({ uid: OWNER, companyId: C, planId, guide: { ...GUIDE, markdown: '## Stages\n1. Build' } });
        await execute({ planId, source: 'other', edits: { guideMarkdown: `## My stages\n${'x'.repeat(30000)}`, guide: { stages: [] } } });
        expect(built().guide.stages).toEqual(GUIDE.stages);
        expect(built().guide.markdown.startsWith('## My stages')).toBe(true);
        expect(built().guide.markdown).toHaveLength(20000);
    });

    it('stores an empty guide when the person cleared it, and the drafted one when the guide was not edited', async () => {
        const cleared = planStash.rememberPlan({ uid: OWNER, companyId: C, plan: storedPlan(), approvedBrief: BRIEF });
        planStash.rememberGuide({ uid: OWNER, companyId: C, planId: cleared, guide: { ...GUIDE, markdown: '## Stages\n1. Build' } });
        await execute({ planId: cleared, source: 'other', edits: { guideMarkdown: '' } });
        expect(built().guide.markdown).toBe('');
        const { projectFields } = jest.requireActual('../Modules/AIProjectGenerator/executeAgents');
        expect(projectFields({ guide: built().guide }).aiGuide.markdown).toBe('');

        orchestrator.executePlan.mockClear();
        const kept = planStash.rememberPlan({ uid: OWNER, companyId: C, plan: storedPlan(), approvedBrief: BRIEF });
        planStash.rememberGuide({ uid: OWNER, companyId: C, planId: kept, guide: { ...GUIDE, markdown: '## Stages\n1. Build' } });
        await execute({ planId: kept, source: 'other', edits: {} });
        expect(built().guide.markdown).toBe('## Stages\n1. Build');
    });

    it('ignores a guide rewording when no guide was drafted for the plan', async () => {
        const planId = planStash.rememberPlan({ uid: OWNER, companyId: C, plan: storedPlan(), approvedBrief: BRIEF });
        await execute({ planId, source: 'other', edits: { guideMarkdown: '## Stages\n1. Mine' } });
        expect(built().guide).toBeNull();
    });

    it('writes the reworded guide onto the project', () => {
        const { projectFields } = jest.requireActual('../Modules/AIProjectGenerator/executeAgents');
        expect(projectFields({ guide: { ...GUIDE, markdown: '## Mine' } }).aiGuide).toMatchObject({ stages: GUIDE.stages, markdown: '## Mine' });
        expect(projectFields({ guide: GUIDE }).aiGuide.markdown).toContain('**Build**');
    });
});
