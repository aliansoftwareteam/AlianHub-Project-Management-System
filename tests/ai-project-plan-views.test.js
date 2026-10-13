const mockChat = jest.fn();
jest.mock('../Modules/AICore/llmProvider', () => ({
    getProvider: () => ({ name: 'fake', chat: (...a) => mockChat(...a) }),
    isAnyProviderConfigured: () => true,
}));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => []) }));
jest.mock('../Modules/settings/ProjectSkills/helper', () => ({ resolveProjectSkills: jest.fn(async () => []), getActiveSkillSlugs: jest.fn(async () => []) }));
jest.mock('../Modules/AIProjectGenerator/orchestrator', () => ({ normalizePlanColors: (p) => p, executePlan: jest.fn(async () => ({ ok: true })) }));
jest.mock('../Modules/AIProjectGenerator/sseEmitter', () => ({ emit: jest.fn(), handleEvents: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/projectAccess', () => ({ ...jest.requireActual('../Config/projectAccess'), canEditProject: jest.fn() }));

const persistence = require('../Modules/AICore/persistence');
const projectAccess = require('../Config/projectAccess');
const projectSetup = require('../Modules/Agents/projectSetup');
const sseEmitter = require('../Modules/AIProjectGenerator/sseEmitter');
const orchestrator = require('../Modules/AIProjectGenerator/orchestrator');
const ctrl = require('../Modules/AIProjectGenerator/controller');
const planViews = require('../Modules/AIProjectGenerator/planViews');
const { PlanSchema } = require('../Modules/AIProjectGenerator/schemaValidator');
const { buildSystemPrompt } = require('../Modules/AIProjectGenerator/promptBuilder');

const C = '6f0000000000000000000c01';
const U = '6f0000000000000000000a01';
const P = '6f0000000000000000000702';

const BY_PERSON = { name: 'Board by person', kind: 'board', look: { groupBy: 'assignee' } };
const DUE_DATES = { name: 'Due dates', kind: 'calendar' };

const validPlan = (views) => ({
    project: {
        ProjectName: 'Bike shop',
        description: 'A project long enough to pass the minimum.',
        projectStatusData: [{ name: 'Planning', type: 'default_active' }, { name: 'Closed', type: 'close' }],
        taskStatusData: [{ name: 'To Do', type: 'default_active' }, { name: 'Done', type: 'close' }],
        taskTypeCounts: [{ name: 'Task', key: 1 }],
    },
    sprints: [{
        sprintName: 'Sprint 1',
        tasks: [{
            TaskName: 'Set up the repo',
            status: 'To Do',
            priority: 'Medium',
            descriptionBlocks: [
                { type: 'paragraph', data: { text: 'Context for the task.' } },
                { type: 'header', data: { text: 'What to do', level: 4 } },
                { type: 'list', data: { style: 'ordered', items: ['Step one'] } },
                { type: 'header', data: { text: 'Acceptance criteria', level: 4 } },
                { type: 'list', data: { style: 'unordered', items: ['It works'] } },
            ],
        }],
    }],
    ...(views ? { views } : {}),
});

const named = (n) => ({ name: `View ${n}`, kind: 'list' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; return r; };
const req = (body) => ({ headers: { companyid: C }, aud: [C], body, uid: U });

let mem;
beforeEach(() => {
    mockChat.mockReset();
    sseEmitter.emit.mockClear();
    orchestrator.executePlan.mockClear();
    projectAccess.canEditProject.mockReset();
    mem = persistence.useInMemory();
});
afterEach(() => { mem.reset(); persistence.useMongo(); jest.restoreAllMocks(); });

describe('the plan schema and prompt', () => {
    it('takes views, and lets more than five through for /plan to trim rather than sending the plan back for repair', () => {
        expect(PlanSchema.safeParse(validPlan([BY_PERSON, DUE_DATES])).data.views).toEqual([BY_PERSON, DUE_DATES]);
        expect(PlanSchema.safeParse(validPlan([1, 2, 3, 4, 5, 6].map(named))).success).toBe(true);
        expect(PlanSchema.safeParse(validPlan()).success).toBe(true);
        expect(PlanSchema.safeParse(validPlan([{ ...DUE_DATES, showFields: ['Budget'] }])).data.views).toEqual([DUE_DATES]);
    });

    it('asks the model for up to five views of the kinds a setup plan takes', () => {
        const prompt = buildSystemPrompt();
        expect(prompt).toContain('# Views');
        expect(prompt).toContain('`list`, `board`, `table`, `calendar`, `workload`');
        expect(prompt).toContain('"views": [');
    });
});

describe('trimming the views', () => {
    it('keeps up to five good views and drops a sixth, an unknown kind and a twice-used name, each with a reason', () => {
        const { kept, dropped } = planViews.trimViews([
            BY_PERSON, { name: 'Gantt', kind: 'gantt' }, { name: 'board BY person', kind: 'list' }, DUE_DATES, named(3), named(4), named(5), named(6),
        ]);
        expect(kept.map((view) => view.name)).toEqual(['Board by person', 'Due dates', 'View 3', 'View 4', 'View 5']);
        expect(dropped).toEqual([
            { name: 'Gantt', reason: expect.stringMatching(/^needs a kind: one of list, board, table, calendar, workload/), code: 'kind' },
            { name: 'board BY person', reason: '"board BY person" is named twice in views', code: 'name_taken' },
            { name: 'View 6', reason: 'a plan holds at most 5 views', code: 'too_many' },
        ]);
    });

    it('drops a view with no name or a look the shared check refuses', () => {
        const { kept, dropped } = planViews.trimViews([{ name: '', kind: 'list' }, { name: 'Sorted', kind: 'list', look: { sortDirection: 'asc' } }]);
        expect(kept).toEqual([]);
        expect(dropped.map((entry) => entry.reason)).toEqual(['needs a name', 'sortDirection needs sortBy']);
        expect(dropped.map((entry) => entry.code)).toEqual(['name_missing', 'look']);
    });

    it('keeps each view in the shape that is made, so the preview shows the trimmed name', () => {
        const long = { name: `${'A'.repeat(70)}`, kind: 'board', look: { groupBy: 'assignee', junk: true } };
        const { kept } = planViews.trimViews([long]);
        expect(kept).toEqual([projectSetup.viewOf(long)]);
        expect(kept[0].name).toHaveLength(60);
        expect(kept[0].look).toEqual({ groupBy: 'assignee' });
        expect(planViews.trimViews(kept).kept).toEqual(kept);
    });

    it('takes each code from where the plan check raises it', () => {
        const at = (views) => projectSetup.viewsProblemOf({ views });
        expect(at([{ name: '', kind: 'list' }])).toEqual({ code: 'name_missing', message: 'views[0] needs a name' });
        expect(at([{ name: 'G', kind: 'gantt' }])).toEqual({ code: 'kind', message: 'views[0] (G) needs a kind: one of list, board, table, calendar, workload' });
        expect(at([{ name: 'S', kind: 'list', look: { sortDirection: 'asc' } }])).toEqual({ code: 'look', message: 'views[0] (S): sortDirection needs sortBy' });
        expect(at([{ name: 'A', kind: 'list' }, { name: 'a', kind: 'board' }])).toEqual({ code: 'name_taken', message: '"a" is named twice in views' });
        expect(at([1, 2, 3, 4, 5, 6].map(named))).toEqual({ code: 'too_many', message: 'views needs 1 to 5 views' });
        expect(at([BY_PERSON])).toEqual({ code: '', message: '' });
    });

    it('takes each code from where making a view refuses it', async () => {
        const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
        const setup = require('../Modules/Agents/setupRequests');
        const project = { _id: P, ProjectName: 'Bike shop', taskStatusData: [], ProjectRequiredComponent: [
            { _id: '6f0000000000000000000b01', keyName: 'ProjectListView', name: 'List', viewStatus: true },
            { _id: '6f0000000000000000000b02', keyName: 'ProjectListView', title: 'Mine', viewStatus: true },
        ] };
        MongoDbCrudOpration.mockImplementation(async (companyId, { type }, op) => (op === 'findOne' && type === 'projects' ? project : []));
        const refusal = (asked) => setup.createView({ companyId: C, who: { uid: U, via: '' }, projectId: P, kind: 'list', ...asked }).catch((error) => ({ code: error.code, message: error.message }));
        expect(await refusal({ name: 'G', kind: 'gantt' })).toEqual({ code: 'kind', message: 'The kind of view must be one of list, board, table, calendar, workload.' });
        expect(await refusal({ name: 'mine' })).toEqual({ code: 'name_taken', message: expect.stringMatching(/^This project already has a saved view named "Mine"\. Use that one/) });
        expect(await refusal({ name: 'Grouped', look: { groupBy: 'colour' } })).toEqual({ code: 'look', message: expect.stringMatching(/^groupBy must be one of status, assignee, priority, due_date/) });
        expect(await refusal({ name: 'Due', kind: 'calendar' })).toEqual({ code: 'no_source', message: 'this project has no calendar view to start from; the person adds one in AlianHub first' });
        expect((await refusal({ name: 'Fresh' })).code).toBe('other');
        expect([403, 404, 500].map(setup.routeRefusalCode)).toEqual(['permission', 'other', 'other']);
        MongoDbCrudOpration.mockImplementation(async () => []);
    });

    it('reads a code from the English text only for a reason that came without one', () => {
        expect(planViews.reasonCode('This project already has a saved view named "Mine". Use that one, or pick another name.')).toBe('name_taken');
        expect(planViews.reasonCode('The person approving may not make this part: x is not granted')).toBe('permission');
        expect(planViews.reasonCode('this project has no calendar view to start from; the person adds one in AlianHub first')).toBe('no_source');
        expect(planViews.reasonCode('groupBy must be one of status, assignee, priority, due_date, or the id of a custom field')).toBe('look');
        expect(planViews.reasonCode('The kind of view must be one of list, board.')).toBe('kind');
        expect(planViews.reasonCode('The view was not added. Try again, or tell the person.')).toBe('other');
        expect(planViews.reasonCode(undefined)).toBe('other');
    });

    it('names the tab each kept kind needs on the new project', () => {
        expect([...planViews.tabKeysFor([BY_PERSON, DUE_DATES, { name: 'x', kind: 'gantt' }])]).toEqual(['projectkanban', 'calendar']);
        expect(planViews.tabKeysFor(undefined).size).toBe(0);
    });

    it('adds the tab of a planned kind beside the allowlist when the project is built', () => {
        const { pickRequiredComponents } = jest.requireActual('../Modules/AIProjectGenerator/orchestrator');
        const catalog = ['ProjectListView', 'ProjectKanban', 'Calendar', 'TableView', 'Workload'].map((keyName, at) => ({ _id: `6f00000000000000000001${at}0`, keyName, name: keyName }));
        expect(pickRequiredComponents(catalog).map((tab) => tab.keyName)).toEqual(['ProjectListView', 'ProjectKanban']);
        expect(pickRequiredComponents(catalog, planViews.tabKeysFor([DUE_DATES])).map((tab) => tab.keyName)).toEqual(['ProjectListView', 'ProjectKanban', 'Calendar']);
    });
});

describe('/plan', () => {
    it('sends the kept views and what was left out, with why', async () => {
        mockChat.mockResolvedValue({ content: JSON.stringify({ needsClarification: false, plan: validPlan([BY_PERSON, { name: 'Gantt', kind: 'gantt' }, DUE_DATES]) }), inputTokens: 1, outputTokens: 1, totalTokens: 2, model: 'fake-1' });
        const r = res();
        await ctrl.plan(req({ description: 'A shop for bikes, with a board by person and a calendar of due dates.' }), r);
        expect(r.body).toMatchObject({ status: true });
        await sleep(350);
        const complete = sseEmitter.emit.mock.calls.map(([, payload]) => payload).find((payload) => payload.event === 'complete');
        expect(complete.plan.views.map((view) => view.name)).toEqual(['Board by person', 'Due dates']);
        expect(complete.plan.viewsDropped).toEqual([{ name: 'Gantt', reason: expect.stringContaining('needs a kind'), code: 'kind' }]);
    });

    it('trims the views again at /execute, whatever the client sends back', async () => {
        const r = res();
        await ctrl.execute(req({ plan: { ...validPlan([1, 2, 3, 4, 5, 6].map(named)), viewsDropped: [] }, source: 'other' }), r);
        expect(r.body).toMatchObject({ status: true });
        await sleep(350);
        const { plan } = orchestrator.executePlan.mock.calls[0][0];
        expect(plan.views).toHaveLength(5);
        expect(plan.viewsDropped).toBeUndefined();
    });

    it('keeps only company members in a view\'s assignees at /execute', async () => {
        const MEMBER = '6f0000000000000000000a02';
        const STRANGER = '6f0000000000000000000a09';
        const { sanitizeMemberIds } = require('../Modules/AIProjectGenerator/schemaValidator');
        const sanitized = sanitizeMemberIds({ project: { LeadUserId: [] }, sprints: [], views: [{ name: 'Mine', kind: 'list', look: { assigneeIds: [MEMBER, STRANGER] } }] }, new Set([MEMBER]));
        expect(sanitized.plan.views[0].look.assigneeIds).toEqual([MEMBER]);
        expect(sanitized.removed).toEqual([{ label: 'view:Mine', id: STRANGER }]);

        const r = res();
        await ctrl.execute(req({ plan: validPlan([{ name: 'Theirs', kind: 'list', look: { assigneeIds: [STRANGER] } }]), source: 'other' }), r);
        await sleep(350);
        expect(orchestrator.executePlan.mock.calls[0][0].plan.views[0].look.assigneeIds).toEqual([]);
    });
});

describe('making the views', () => {
    it('hands the kept views to the shared plan executor as the person who ran the generator', async () => {
        const carryOut = jest.spyOn(projectSetup, 'carryOut').mockResolvedValue([{ part: 'views', ok: false, items: [
            { name: 'Board by person', kind: 'board', made: true, viewId: 'v1', leftOut: [] },
            { name: 'Due dates', kind: 'calendar', made: false, error: 'the view was not added' },
        ] }]);
        const out = await planViews.makeViews({ companyId: C, uid: U, projectId: P, views: [BY_PERSON, DUE_DATES, { name: 'Gantt', kind: 'gantt' }] });
        expect(carryOut).toHaveBeenCalledTimes(1);
        const [given] = carryOut.mock.calls[0];
        expect(given).toMatchObject({ companyId: C, projectId: P, who: { uid: U, via: '' } });
        expect(given.approvedBy).toBeUndefined();
        expect(Object.keys(given.plan)).toEqual(['views']);
        expect(given.plan.views.map((view) => [view.name, view.kind])).toEqual([['Board by person', 'board'], ['Due dates', 'calendar']]);
        expect(out).toEqual({ made: [{ name: 'Board by person', kind: 'board' }], notMade: [{ name: 'Due dates', reason: 'the view was not added', code: 'other' }] });
    });

    it('makes nothing and asks nothing when the plan has no views', async () => {
        const carryOut = jest.spyOn(projectSetup, 'carryOut');
        expect(await planViews.makeViews({ companyId: C, uid: U, projectId: P, views: undefined })).toEqual({ made: [], notMade: [] });
        expect(carryOut).not.toHaveBeenCalled();
    });

    it('gives a person who may not add views the project without them, and a line saying why', async () => {
        projectAccess.canEditProject.mockResolvedValue({ allowed: false, permission: 'ProjectRequiredComponent' });
        const out = await planViews.makeViews({ companyId: C, uid: U, projectId: P, views: [BY_PERSON, DUE_DATES] });
        expect(out.made).toEqual([]);
        expect(out.notMade).toEqual([
            { name: 'Board by person', reason: 'permission_denied: ProjectRequiredComponent is not granted', code: 'permission' },
            { name: 'Due dates', reason: 'permission_denied: ProjectRequiredComponent is not granted', code: 'permission' },
        ]);
    });

    it('never throws, so a view that breaks cannot undo the project', async () => {
        jest.spyOn(projectSetup, 'carryOut').mockRejectedValue(new Error('the database went away'));
        await expect(planViews.makeViews({ companyId: C, uid: U, projectId: P, views: [BY_PERSON] }))
            .resolves.toEqual({ made: [], notMade: [{ name: 'Board by person', reason: 'the database went away', code: 'other' }] });
    });
});
