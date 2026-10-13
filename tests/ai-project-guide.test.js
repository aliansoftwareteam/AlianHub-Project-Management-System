const fs = require('fs');
const path = require('path');
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider', () => ({ getProvider: jest.fn(), isAnyProviderConfigured: jest.fn(() => true) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const llm = require('../Modules/AICore/llmProvider');
const guideCtrl = require('../Modules/AIProjectGenerator/guideController');
const skills = require('../Modules/Agents/skills');
const persistence = require('../Modules/AICore/persistence');
const memory = require('../Modules/Agents/memory');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// The names every generic "project lifecycle" template reaches for. None may be
// written into the prompt or the code; the stages come from the brief alone.
const TEMPLATE_STAGES = /\b(discovery|post-launch|go-live|launch|handover|deployment|store architecture|kick-?off)\b/i;

const GUIDE = { stages: [{ name: 'Catalogue in place', goal: 'Every product is listed.' }, { name: 'First orders', goal: 'A stranger can pay.' }], essentials: ['Payment account'], escalations: ['Budget over plan'], style: 'Short.' };

describe('the guide has no fixed stage list', () => {
    it('the generation prompt derives stages from the brief and names none itself', () => {
        const prompt = read('Modules/AIProjectGenerator/prompts/guide/system.md');
        expect(prompt).toMatch(/comes from THIS brief/i);
        expect(prompt).not.toMatch(TEMPLATE_STAGES);
        expect(prompt).not.toMatch(/→/);
    });

    it('no code path carries a stage list either', () => {
        ['Modules/AIProjectGenerator/guideController.js', 'Modules/AIProjectGenerator/executeAgents.js', 'Modules/Agents/skills/seeds/projectGuide.js'].forEach((rel) => {
            const src = read(rel);
            expect(src).not.toMatch(TEMPLATE_STAGES);
            expect(src).not.toMatch(/stages\s*:\s*\[\s*['"{]/);
        });
    });
});

describe('the guide shape', () => {
    it('normalises the model output, caps it, and renders the markdown from the stages it was given', () => {
        const guide = guideCtrl.normaliseGuide({ ...GUIDE, essentials: [...GUIDE.essentials, { text: 'Brand assets' }, ''], style: 'x'.repeat(2000) });
        expect(guide.stages).toEqual(GUIDE.stages);
        expect(guide.essentials).toEqual(['Payment account', 'Brand assets']);
        expect(guide.style.length).toBe(800);
        expect(guide.markdown).toContain('1. **Catalogue in place** — Every product is listed.');
        expect(guide.markdown).toContain('- Payment account');
        expect(guide.markdown).toContain('## Escalate to a person when');
    });

    it('rejects a guide with fewer than two stages or no object at all', () => {
        expect(guideCtrl.normaliseGuide({ stages: [{ name: 'Only one' }] })).toBeNull();
        expect(guideCtrl.normaliseGuide(null)).toBeNull();
        expect(guideCtrl.normaliseGuide({ stages: ['A', 'B'] }).stages).toEqual([{ name: 'A', goal: '' }, { name: 'B', goal: '' }]);
    });

    it('feeds the model the brief, the assumptions and the plan outline', () => {
        const msg = guideCtrl.buildGuideUserMessage({
            approvedBrief: '## What and for whom\nA shop for bikes.',
            assumptions: [{ point: 'constraints', text: 'No date given.' }],
            plan: { sprints: [{ sprintName: 'Week 1', tasks: [{ TaskName: 'List the bikes' }] }] },
        });
        expect(msg).toContain('A shop for bikes.');
        expect(msg).toContain('- No date given.');
        expect(msg).toContain('1. Week 1');
        expect(msg).toContain('  - List the bikes');
    });
});

describe('POST /api/v1/ai/project/guide', () => {
    const res = () => { const r = { status: jest.fn(() => r), send: jest.fn(() => r) }; return r; };
    const req = (body, over = {}) => ({ uid: 'u1', aud: ['6f0000000000000000000c01'], headers: { companyid: '6f0000000000000000000c01' }, body, ...over });

    it('refuses without a user, a company, or a real brief', async () => {
        let r = res(); await guideCtrl.guide(req({ approvedBrief: 'x'.repeat(40) }, { uid: null }), r);
        expect(r.status).toHaveBeenCalledWith(401);
        r = res(); await guideCtrl.guide(req({ approvedBrief: 'x'.repeat(40) }, { aud: ['other'] }), r);
        expect(r.status).toHaveBeenCalledWith(403);
        r = res(); await guideCtrl.guide(req({ approvedBrief: 'short' }), r);
        expect(r.status).toHaveBeenCalledWith(400);
    });

    it('returns the normalised guide from the model', async () => {
        const chat = jest.fn(async () => ({ content: JSON.stringify(GUIDE), model: 'test-model', usage: { inputTokens: 10, outputTokens: 5 } }));
        llm.getProvider.mockReturnValue({ chat });
        const r = res();
        await guideCtrl.guide(req({ approvedBrief: '## What and for whom\nA shop for bikes, for commuters.', assumptions: [], plan: null }), r);
        expect(r.status).not.toHaveBeenCalled();
        const body = r.send.mock.calls[0][0];
        expect(body.status).toBe(true);
        expect(body.data.guide.stages).toEqual(GUIDE.stages);
        expect(body.data.guide.markdown).toContain('Catalogue in place');
        expect(chat.mock.calls[0][0].jsonMode).toBe(true);
        expect(chat.mock.calls[0][0].systemPrompt).toContain('Project guide author');
    });

    it('fails cleanly when the model returns nothing usable', async () => {
        llm.getProvider.mockReturnValue({ chat: jest.fn(async () => ({ content: 'not json' })) });
        const r = res();
        await guideCtrl.guide(req({ approvedBrief: 'x'.repeat(40) }), r);
        expect(r.status).toHaveBeenCalledWith(500);
    });
});

describe('skill project.guide', () => {
    const skill = skills.getSkill('project.guide');
    const C = 'c1';
    const P1 = '6f0000000000000000000701';
    const P2 = '6f0000000000000000000702';
    const ASKER = '6f0000000000000000000a01';
    const task = (over = {}) => ({ _id: '6f0000000000000000000901', TaskName: 'Set up payments', ProjectID: P1, rawDescription: 'Stripe or Razorpay', ...over });

    let mem;
    beforeEach(() => { mem = persistence.useInMemory(); Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; }); mockDb.calls.length = 0; mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: ASKER, roleType: 3, status: 2, isDelete: false }); });
    afterEach(() => { mem.reset(); persistence.useMongo(); });

    it('is registered as a generic skill that may only read, comment and create subtasks', () => {
        expect(skill).toBeTruthy();
        expect(skill.kind).toBe('generic');
        expect(skill.emits).toEqual(['subtask.create', 'task.comment']);
    });

    it('reads the stored guide and the plan of the task\'s project, and nothing from another project', async () => {
        mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: P1, ProjectName: 'Bike shop', isPrivateSpace: false, aiGuide: { ...GUIDE, markdown: '## Stages\n1. Catalogue' }, deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: P2, ProjectName: 'Other', isPrivateSpace: false, aiGuide: { markdown: 'SECRET' }, deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.TASKS, { ProjectID: P1, TaskKey: 'BS-1', TaskName: 'List the bikes', statusType: 'active', isParentTask: true, DueDate: new Date('2026-09-11'), AssigneeUserId: ['u1'], sprintArray: { name: 'Week 1' } });
        mockDb.seed(SCHEMA_TYPE.TASKS, { ProjectID: P1, TaskKey: 'BS-2', TaskName: 'Old task', statusType: 'done', isParentTask: true, sprintArray: { name: 'Week 1' } });
        mockDb.seed(SCHEMA_TYPE.TASKS, { ProjectID: P2, TaskKey: 'OT-1', TaskName: 'Elsewhere', statusType: 'active', isParentTask: true });
        const context = await skill.gather({ task: task(), companyId: C, startedBy: ASKER });
        expect(context.skip).toBeUndefined();
        expect(context.gather.project.guide).toContain('Catalogue');
        expect(context.gather.project.guide).not.toContain('SECRET');
        expect(context.gather.plan.plan).toContain('BS-1 List the bikes');
        expect(context.gather.plan.plan).toContain('Week 1: 1 open, 1 done');
        expect(context.gather.plan.plan).not.toContain('OT-1');
        expect(context.fallback).toContain('Start with BS-1 List the bikes');
        mockDb.calls.forEach((c) => {
            expect(c.companyId).toBe(C);
            if (c.type === SCHEMA_TYPE.TASKS) expect(c.data[0].ProjectID).toBe(P1);
            if (c.type === SCHEMA_TYPE.PROJECTS && c.data[0]._id) expect(String(c.data[0]._id)).toBe(P1);
        });
        const prompt = skill.buildUserPrompt({ task: task(), context });
        expect(prompt).toContain('GUIDE:');
        expect(prompt).toContain('TASK: Set up payments');
    });

    it('gathers what the workspace remembers about the project into context.memory, which the prompt renders as MEMORY', async () => {
        mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: P1, ProjectName: 'Bike shop', isPrivateSpace: false, aiGuide: { ...GUIDE, markdown: '## Stages\n1. Catalogue' }, deletedStatusKey: 0 });
        await memory.remember({ companyId: C, kind: 'project.constraint', scopeId: P1, text: 'Budget is fixed at $12k.', source: { origin: 'brief' } });
        const run = mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { projectId: P1, status: 'done', finishedAt: new Date('2026-09-09T10:00:00.000Z') });
        await memory.recordEpisode({ companyId: C, projectId: P1, runId: run._id, patch: { skill: 'project.guide', taskTitle: 'Set up CI', proposed: 3, approved: 2, at: '2026-09-09T10:00:00.000Z' } });
        const context = await skill.gather({ task: task(), companyId: C, startedBy: ASKER });
        expect(context.gather.memory.text).toContain('- Budget is fixed at $12k. (from the approved brief)');
        expect(context.gather.memory.text).toContain('- 2026-09-09 project.guide on "Set up CI": proposed 3, approved 2');
        const prompt = skill.buildUserPrompt({ task: task(), context });
        expect(prompt.indexOf('GUIDE:')).toBeLessThan(prompt.indexOf('MEMORY:'));
        expect(prompt.indexOf('MEMORY:')).toBeLessThan(prompt.indexOf('PLAN:'));
        expect((await skill.gather({ task: task({ ProjectID: P2 }), companyId: C, startedBy: ASKER })).skip).toMatch(/cannot open this project/);
    });

    it('answers from the description and the plan when the project has no stored guide, and says so', async () => {
        mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: P1, ProjectName: 'Bike shop', isPrivateSpace: false, description: '<p>An online shop for <b>used bikes</b>.</p>', deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.TASKS, { ProjectID: P1, TaskKey: 'BS-1', TaskName: 'List the bikes', statusType: 'active', isParentTask: true, sprintArray: { name: 'Week 1' } });
        const context = await skill.gather({ task: task(), companyId: C, startedBy: ASKER });
        expect(context.skip).toBeUndefined();
        expect(context.gather.project).toMatchObject({ hasGuide: false, guide: '', description: 'An online shop for used bikes .' });
        const prompt = skill.buildUserPrompt({ task: task(), context });
        expect(prompt).toContain('GUIDE: (none stored for this project)');
        expect(prompt).toContain('DESCRIPTION:\nAn online shop for used bikes .');
        expect(prompt).toContain('BS-1 List the bikes');
        const { changes } = skill.toChanges({ task: task(), raw: { nextStep: 'List the first ten bikes.' }, context });
        expect(changes[changes.length - 1].params.body).toMatch(/^No guide is stored for this project yet, so this comes from its description and plan.\nNext step: List the first ten bikes./);
    });

    it('reads the description from the editor blocks when there is no plain one', async () => {
        mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: P1, ProjectName: 'Bike shop', isPrivateSpace: false, descriptionBlock: { blocks: [{ type: 'paragraph', data: { text: 'Bikes for commuters' } }] }, deletedStatusKey: 0 });
        const context = await skill.gather({ task: task(), companyId: C, startedBy: ASKER });
        expect(context.gather.project.description).toContain('Bikes for commuters');
        expect(skill.buildUserPrompt({ task: task(), context })).toContain('(no tasks yet)');
    });

    it('with a stored guide, the prompt and the comment are as before: no description, no note', async () => {
        mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: P1, ProjectName: 'Bike shop', isPrivateSpace: false, description: 'Used bikes', aiGuide: { ...GUIDE, markdown: '## Stages\n1. Catalogue' }, deletedStatusKey: 0 });
        const context = await skill.gather({ task: task(), companyId: C, startedBy: ASKER });
        const prompt = skill.buildUserPrompt({ task: task(), context });
        expect(prompt).toContain('GUIDE:\n## Stages\n1. Catalogue\n\nPLAN:');
        expect(prompt).not.toContain('DESCRIPTION');
        const { changes } = skill.toChanges({ task: task(), raw: { nextStep: 'Wire payments.' }, context });
        expect(changes[changes.length - 1].params.body).toMatch(/^Next step: Wire payments./);
    });

    it('skips when the task has no project or the project is not one the asker can open', async () => {
        expect((await skill.gather({ task: task({ ProjectID: '' }), companyId: C, startedBy: ASKER })).skip).toMatch(/no project/);
        expect((await skill.gather({ task: task({ ProjectID: P2 }), companyId: C, startedBy: ASKER })).skip).toMatch(/cannot open this project/);
    });

    describe('as the person who mentioned it', () => {
        const HEX_C = '6f0000000000000000000c01';
        const OPEN_LIST = '6f0000000000000000000b01';
        const PRIVATE_LIST = '6f0000000000000000000b02';

        beforeEach(() => {
            mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: OPEN_LIST, projectId: P1, name: 'Week 1' });
            mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: PRIVATE_LIST, projectId: P1, name: 'Secret', private: true, AssigneeUserId: ['someone-else'] });
            mockDb.seed(SCHEMA_TYPE.TASKS, { ProjectID: P1, TaskKey: 'BS-1', TaskName: 'List the bikes', statusType: 'active', isParentTask: true, sprintId: OPEN_LIST, sprintArray: { name: 'Week 1' } });
            mockDb.seed(SCHEMA_TYPE.TASKS, { ProjectID: P1, TaskKey: 'BS-9', TaskName: 'Hidden pricing deal', statusType: 'active', isParentTask: true, sprintId: PRIVATE_LIST, sprintArray: { name: 'Secret' } });
        });

        it('leaves out the tasks of a private list the asker is not on', async () => {
            mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: P1, ProjectName: 'Bike shop', description: 'Used bikes', isPrivateSpace: false, deletedStatusKey: 0 });
            const context = await skill.gather({ task: task(), companyId: HEX_C, startedBy: ASKER });
            expect(context.skip).toBeUndefined();
            expect(context.gather.plan.plan).toContain('BS-1 List the bikes');
            expect(context.gather.plan.plan).not.toContain('BS-9');
            expect(context.gather.plan.plan).not.toContain('Secret');
            expect(context.fallback).not.toContain('BS-9');
        });

        it('skips with no person to read as, reading no project or task', async () => {
            mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: P1, ProjectName: 'Bike shop', description: 'Used bikes', isPrivateSpace: false, deletedStatusKey: 0 });
            mockDb.calls.length = 0;
            const context = await skill.gather({ task: task(), companyId: HEX_C, startedBy: null });
            expect(context.skip).toMatch(/no person to read as/);
            expect(mockDb.calls.some((c) => c.type === SCHEMA_TYPE.TASKS || c.type === SCHEMA_TYPE.PROJECTS)).toBe(false);
            const readers = require('../Modules/Agents/skills/readers');
            expect((await readers.read('project.tasks', HEX_C, { task: task(), startedBy: null }, { asStarter: true })).skip).toMatch(/no person to read as/);
        });

        it('reads nothing of a project the asker cannot open', async () => {
            mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: P1, ProjectName: 'Bike shop', description: 'Used bikes', isPrivateSpace: true, AssigneeUserId: ['someone-else'], deletedStatusKey: 0 });
            const context = await skill.gather({ task: task(), companyId: HEX_C, startedBy: ASKER });
            expect(context.skip).toMatch(/cannot open this project/);
            expect(mockDb.calls.some((c) => c.type === SCHEMA_TYPE.TASKS)).toBe(false);
        });
    });

    it('turns the answer into one comment plus at most three proposed subtasks', () => {
        const raw = { nextStep: 'Wire the payment account first.', why: 'Every order needs it.', proposedTasks: [{ title: 'Create the payment account', why: 'Needed', hours: 2 }, { title: 'Add the webhook', hours: 3 }, { title: 'Test a payment', hours: 1 }, { title: 'Too many' }], flags: ['No launch date in the brief'] };
        const { summary, changes } = skill.toChanges({ task: task(), raw, context: {} });
        expect(summary).toBe('Wire the payment account first.');
        expect(changes.map((c) => c.action)).toEqual(['subtask.create', 'subtask.create', 'subtask.create', 'task.comment']);
        const comment = changes[changes.length - 1];
        expect(comment.params.body).toContain('Next step: Wire the payment account first.');
        expect(comment.params.body).toContain('• No launch date in the brief');
        expect(comment.params.body).toContain('Proposed 3 follow-up task(s).');
        expect(changes[0].params).toMatchObject({ taskId: '6f0000000000000000000901', title: 'Create the payment account' });
    });

    it('answers from the deterministic fallback when the model gave nothing', () => {
        const context = { fallback: 'Start with BS-1 List the bikes. It is the earliest open task in the plan.' };
        const { changes } = skill.toChanges({ task: task(), raw: null, context });
        expect(changes).toHaveLength(1);
        expect(changes[0].params.body).toContain('Start with BS-1 List the bikes');
    });
});
