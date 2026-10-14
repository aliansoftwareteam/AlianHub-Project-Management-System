const mockChat = jest.fn();
const mockCrud = jest.fn(async () => []);

jest.mock('../Modules/AICore/llmProvider', () => ({
    getProvider: () => ({ name: 'fake', chat: (...a) => mockChat(...a) }),
    isAnyProviderConfigured: () => true,
}));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCrud(...a) }));
jest.mock('../Modules/settings/ProjectSkills/helper', () => ({ resolveProjectSkills: jest.fn(async () => []), getActiveSkillSlugs: jest.fn(async () => []) }));
jest.mock('../Modules/AIProjectGenerator/orchestrator', () => ({ normalizePlanColors: (p) => p, executeTasksIntoProject: jest.fn(async () => ({ ok: true })) }));
jest.mock('../Modules/AIProjectGenerator/sseEmitter', () => ({ emit: jest.fn(), handleEvents: jest.fn(), COMPLETE_EVENT: 'complete' }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    evaluatePermission: jest.fn(),
    isWritable: (value) => value === true || value === 1 || value === 2,
}));

const scope = require('../Modules/Agents/scope');
const guard = require('../Config/permissionGuard');
const { canEditProject } = require('../Modules/AIProjectGenerator/projectAccess');
const ctrl = require('../Modules/AIProjectGenerator/controller');
const orchestrator = require('../Modules/AIProjectGenerator/orchestrator');
const planStash = require('../Modules/AIProjectGenerator/planStash');
const { myCache } = require('../Config/config');

const C = '6f0000000000000000000c01';
const OPEN = '6f0000000000000000000a01';
const PRIVATE = '6f0000000000000000000a02';
const GUEST = '6f0000000000000000000004';

const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; return r; };
const req = (projectId, body, uid = GUEST) => ({ headers: { companyid: C }, aud: [C], uid, params: { projectId }, body });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const OTHER = '6f0000000000000000000005';
const OTHER_PROJECT = '6f0000000000000000000a03';
const task = (TaskName) => ({ TaskName, status: 'To Do', priority: 'Medium', descriptionBlocks: [
    { type: 'paragraph', data: { text: 'Context.' } },
    { type: 'header', data: { text: 'What to do', level: 4 } },
    { type: 'list', data: { style: 'ordered', items: ['Step one'] } },
    { type: 'header', data: { text: 'Acceptance criteria', level: 4 } },
    { type: 'list', data: { style: 'unordered', items: ['It works'] } },
] });
const names = (plan) => plan.sprints.map((s) => [s.sprintName, s.tasks.map((t) => t.TaskName)]);
const FULL = { sprints: [{ sprintName: 'Week 1', tasks: [task('One'), task('Two')] }, { sprintName: 'Week 2', tasks: [task('Three')] }] };
const stash = (extra = {}) => planStash.rememberTasksPlan({ uid: GUEST, companyId: C, projectId: OPEN, mode: 'full', plan: FULL, ...extra });
const execute = async (body, uid) => {
    const out = res();
    await ctrl.tasksExecute(req(OPEN, { mode: 'full', ...body }, uid), out);
    await sleep(250);
    return out;
};
const made = () => orchestrator.executeTasksIntoProject.mock.calls[0][0];

beforeEach(() => {
    jest.clearAllMocks();
    myCache.flushAll();
    scope.visibleProjectIds.mockResolvedValue([OPEN]);
    guard.evaluatePermission.mockResolvedValue(true);
});

describe('AUT-07 canEditProject', () => {
    it('hides a project the caller cannot open', async () => {
        expect(await canEditProject({ companyId: C, uid: GUEST, projectId: PRIVATE, permissions: ['task.task_create'] })).toEqual({ hidden: true });
        expect(guard.evaluatePermission).not.toHaveBeenCalled();
    });

    it('forbids a visible project when a permission is not writable there', async () => {
        guard.evaluatePermission.mockResolvedValue(false);
        expect(await canEditProject({ companyId: C, uid: GUEST, projectId: OPEN, permissions: ['task.task_create'] })).toEqual({ forbidden: 'task.task_create' });
        expect(guard.evaluatePermission).toHaveBeenCalledWith(C, GUEST, 'task.task_create', { projectId: OPEN });
    });

    it('forbids when the rules cannot be read', async () => {
        guard.evaluatePermission.mockRejectedValue(new Error('db down'));
        expect((await canEditProject({ companyId: C, uid: GUEST, projectId: OPEN, permissions: ['task.task_create'] })).forbidden).toBe('task.task_create');
    });

    it('allows a visible project with every permission writable', async () => {
        expect(await canEditProject({ companyId: C, uid: GUEST, projectId: OPEN, permissions: ['project.project_sprint_create'] })).toEqual({ projectId: OPEN });
    });
});

describe('AUT-07 AI task generation refuses projects the caller cannot open', () => {
    it('answers 404 to tasks/execute on a hidden project and writes nothing', async () => {
        const out = res();
        await ctrl.tasksExecute(req(PRIVATE, { mode: 'sprints', planId: stash({ projectId: PRIVATE, mode: 'sprints' }) }), out);
        expect(out.code).toBe(404);
        expect(out.body).toEqual({ status: false, statusText: 'Project not found' });
        expect(mockCrud).not.toHaveBeenCalled();
    });

    it('answers 403 to tasks/execute when the caller may not create sprints there', async () => {
        guard.evaluatePermission.mockResolvedValue(false);
        const out = res();
        await ctrl.tasksExecute(req(OPEN, { mode: 'sprints', planId: stash({ mode: 'sprints' }) }), out);
        expect(out.code).toBe(403);
        expect(guard.evaluatePermission).toHaveBeenCalledWith(C, GUEST, 'project.project_sprint_create', { projectId: OPEN });
    });

    it('answers 404 to tasks/plan on a hidden project before any model call', async () => {
        const out = res();
        await ctrl.tasksPlan(req(PRIVATE, { mode: 'full' }), out);
        expect(out.code).toBe(404);
        expect(mockChat).not.toHaveBeenCalled();
    });
});

describe('tasks/execute makes the plan tasks/plan stored', () => {
    it('stores the generated plan with its mode, project and person at tasks/plan', () => {
        const planId = stash();
        expect(planStash.storedTasksPlan({ uid: GUEST, companyId: C, projectId: OPEN, planId })).toMatchObject({ mode: 'full', plan: FULL });
    });

    it('makes the stored plan whatever plan the body carries, keeping only the ticked tasks', async () => {
        const planId = stash();
        const out = await execute({ planId, keep: [0, 2], plan: { sprints: [{ sprintName: 'Injected', tasks: [task('Injected')] }] } });
        expect(out.body).toMatchObject({ status: true, jobId: expect.any(String) });
        expect(names(made().tasksPlan)).toEqual([['Week 1', ['One']], ['Week 2', ['Three']]]);
        expect(made()).toMatchObject({ projectId: OPEN, companyId: C, mode: 'full' });
    });

    it('refuses when nothing is kept, or keep is not a list', async () => {
        for (const keep of [[], undefined, null, { 0: true }, '0,1', [99, -1, 1.5]]) {
            const out = await execute({ planId: stash(), keep });
            expect(out.code).toBe(400);
        }
        expect(orchestrator.executeTasksIntoProject).not.toHaveBeenCalled();
    });

    it('makes a kept task once however often it is named', async () => {
        await execute({ planId: stash(), keep: [2, 2, 0, 0, 7] });
        expect(names(made().tasksPlan)).toEqual([['Week 1', ['One']], ['Week 2', ['Three']]]);
    });

    it('carries links, epics and fields only for the kept tasks', async () => {
        const plan = {
            sprints: [{ sprintName: 'Week 1', tasks: [
                { ...task('One'), ref: 't1', epicRef: 'e1', fieldValues: [{ fieldRef: 'f1', value: 'x' }] },
                { ...task('Two'), ref: 't2', epicRef: 'e2', fieldValues: [{ fieldRef: 'f2', value: 'y' }] },
                { ...task('Three'), ref: 't3' },
            ] }],
            links: [{ from: 't1', to: 't3', type: 'blocks' }, { from: 't1', to: 't2', type: 'blocks' }],
            epics: [{ ref: 'e1', name: 'Kept' }, { ref: 'e2', name: 'Dropped' }],
            customFields: [{ ref: 'f1', title: 'Kept', type: 'text' }, { ref: 'f2', title: 'Dropped', type: 'text' }],
        };
        await execute({ planId: stash({ plan }), keep: [0, 2] });
        expect(made().tasksPlan.links).toEqual([{ from: 't1', to: 't3', type: 'blocks' }]);
        expect(made().tasksPlan.epics.map((e) => e.ref)).toEqual(['e1']);
        expect(made().tasksPlan.customFields.map((f) => f.ref)).toEqual(['f1']);
    });

    it('starts exactly one run when two calls for the same plan race', async () => {
        const planId = stash();
        const calls = [res(), res()];
        await Promise.all(calls.map((out) => ctrl.tasksExecute(req(OPEN, { mode: 'full', planId, keep: [0] }), out)));
        await sleep(250);
        expect(calls.map((out) => out.code).sort()).toEqual([200, 409]);
        expect(orchestrator.executeTasksIntoProject).toHaveBeenCalledTimes(1);
    });

    it('keeps a lapsed run from freeing the plan another run has since claimed', async () => {
        let finishA;
        orchestrator.executeTasksIntoProject.mockImplementationOnce(() => new Promise((resolve) => { finishA = resolve; }));
        orchestrator.executeTasksIntoProject.mockImplementationOnce(() => new Promise(() => {}));
        const planId = stash();
        expect((await execute({ planId, keep: [0] })).body.status).toBe(true);
        myCache.del(planStash.cacheKey('tasksplanclaim', GUEST, planId));
        expect((await execute({ planId, keep: [0] })).body.status).toBe(true);
        finishA({ ok: true });
        await sleep(10);
        expect(planStash.storedTasksPlan({ uid: GUEST, companyId: C, projectId: OPEN, planId })).toBeTruthy();
        expect((await execute({ planId, keep: [0] })).code).toBe(409);
    });

    it.each([
        ['no planId', () => undefined],
        ['an unknown planId', () => 'f'.repeat(24)],
        ['another person\'s planId', () => planStash.rememberTasksPlan({ uid: OTHER, companyId: C, projectId: OPEN, mode: 'full', plan: FULL })],
        ['a planId from another company', () => planStash.rememberTasksPlan({ uid: GUEST, companyId: '6f0000000000000000000c02', projectId: OPEN, mode: 'full', plan: FULL })],
        ['a planId for another project', () => stash({ projectId: OTHER_PROJECT })],
    ])('answers 410 for %s and makes nothing', async (_, planIdOf) => {
        const out = await execute({ planId: planIdOf(), keep: [0], plan: FULL });
        expect(out.code).toBe(410);
        expect(out.body).toEqual({ status: false, statusText: 'This plan has expired. Generate it again.', code: 'PLAN_EXPIRED' });
        expect(orchestrator.executeTasksIntoProject).not.toHaveBeenCalled();
    });

    it('uses a plan once: a second call after it was made answers 410', async () => {
        const planId = stash();
        expect((await execute({ planId, keep: [0] })).body.status).toBe(true);
        expect((await execute({ planId, keep: [0] })).code).toBe(410);
        expect(orchestrator.executeTasksIntoProject).toHaveBeenCalledTimes(1);
    });

    it('answers 409 while the plan is being made, and frees it when the run fails', async () => {
        let finish;
        orchestrator.executeTasksIntoProject.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
        const planId = stash();
        expect((await execute({ planId, keep: [0] })).body.status).toBe(true);
        const second = await execute({ planId, keep: [0] });
        expect(second.code).toBe(409);
        expect(second.body.code).toBe('PLAN_IN_USE');
        finish({ ok: false, error: 'rolled back' });
        await sleep(10);
        expect((await execute({ planId, keep: [0] })).body.status).toBe(true);
        expect(orchestrator.executeTasksIntoProject).toHaveBeenCalledTimes(2);
    });

    it('refuses a mode other than the one the plan was generated for', async () => {
        const out = await execute({ planId: stash(), mode: 'sprints', keep: [0] });
        expect(out.code).toBe(400);
        expect(orchestrator.executeTasksIntoProject).not.toHaveBeenCalled();
    });
});
