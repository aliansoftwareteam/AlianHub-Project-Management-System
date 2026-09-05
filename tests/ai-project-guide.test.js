const fs = require('fs');
const path = require('path');
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/AIProjectGenerator/llmProvider', () => ({ getProvider: jest.fn(), isAnyProviderConfigured: jest.fn(() => true) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const llm = require('../Modules/AIProjectGenerator/llmProvider');
const guideCtrl = require('../Modules/AIProjectGenerator/guideController');
const skills = require('../Modules/Agents/skills');

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
        ['Modules/AIProjectGenerator/guideController.js', 'Modules/AIProjectGenerator/executeAgents.js', 'Modules/Agents/skills/projectGuide.js'].forEach((rel) => {
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
    const task = (over = {}) => ({ _id: '6f0000000000000000000901', TaskName: 'Set up payments', ProjectID: P1, rawDescription: 'Stripe or Razorpay', ...over });

    beforeEach(() => { Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; }); mockDb.calls.length = 0; });

    it('is registered as a generic skill that may only read, comment and create subtasks', () => {
        expect(skill).toBeTruthy();
        expect(skill.kind).toBe('generic');
        expect(skill.scopes).toEqual(['task.read', 'task.comment', 'task.subtask.create']);
    });

    it('reads the stored guide and the plan of the task\'s project, and nothing from another project', async () => {
        mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: P1, ProjectName: 'Bike shop', aiGuide: { ...GUIDE, markdown: '## Stages\n1. Catalogue' }, deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: P2, ProjectName: 'Other', aiGuide: { markdown: 'SECRET' }, deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.TASKS, { ProjectID: P1, TaskKey: 'BS-1', TaskName: 'List the bikes', statusType: 'active', isParentTask: true, DueDate: new Date('2026-09-11'), AssigneeUserId: ['u1'], sprintArray: { name: 'Week 1' } });
        mockDb.seed(SCHEMA_TYPE.TASKS, { ProjectID: P1, TaskKey: 'BS-2', TaskName: 'Old task', statusType: 'done', isParentTask: true, sprintArray: { name: 'Week 1' } });
        mockDb.seed(SCHEMA_TYPE.TASKS, { ProjectID: P2, TaskKey: 'OT-1', TaskName: 'Elsewhere', statusType: 'active', isParentTask: true });
        const context = await skill.gather({ task: task(), companyId: C });
        expect(context.skip).toBeUndefined();
        expect(context.guide).toContain('Catalogue');
        expect(context.guide).not.toContain('SECRET');
        expect(context.plan).toContain('BS-1 List the bikes');
        expect(context.plan).toContain('Week 1: 1 open, 1 done');
        expect(context.plan).not.toContain('OT-1');
        expect(context.fallback.nextStep).toBe('Start with BS-1 List the bikes');
        mockDb.calls.forEach((c) => {
            expect(c.companyId).toBe(C);
            if (c.type === SCHEMA_TYPE.TASKS) expect(c.data[0].ProjectID).toBe(P1);
            if (c.type === SCHEMA_TYPE.PROJECTS) expect(String(c.data[0]._id)).toBe(P1);
        });
        const prompt = skill.buildUserPrompt({ task: task(), context });
        expect(prompt).toContain('GUIDE:');
        expect(prompt).toContain('TASK: Set up payments');
    });

    it('skips when the project has no stored guide, or the task no project', async () => {
        mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: P1, ProjectName: 'Bike shop', deletedStatusKey: 0 });
        expect((await skill.gather({ task: task(), companyId: C })).skip).toMatch(/no stored guide/);
        expect((await skill.gather({ task: task({ ProjectID: '' }), companyId: C })).skip).toMatch(/no project/);
        expect((await skill.gather({ task: task({ ProjectID: P2 }), companyId: C })).skip).toMatch(/not found/);
    });

    it('turns the answer into one comment plus at most three proposed subtasks', () => {
        const raw = { nextStep: 'Wire the payment account first.', why: 'Every order needs it.', proposedTasks: [{ title: 'Create the payment account', why: 'Needed', hours: 2 }, { title: 'Add the webhook', hours: 3 }, { title: 'Test a payment', hours: 1 }, { title: 'Too many' }], flags: ['No launch date in the brief'] };
        const { summary, changes } = skill.toChanges({ task: task(), raw, context: { fallback: {} } });
        expect(summary).toBe('Wire the payment account first.');
        expect(changes.map((c) => c.action)).toEqual(['task.comment', 'subtask.create', 'subtask.create', 'subtask.create']);
        expect(changes[0].params.body).toContain('Next step: Wire the payment account first.');
        expect(changes[0].params.body).toContain('• No launch date in the brief');
        expect(changes[1].params).toMatchObject({ taskId: '6f0000000000000000000901', title: 'Create the payment account' });
    });

    it('answers from the deterministic fallback when the model gave nothing', () => {
        const context = { fallback: { nextStep: 'Start with BS-1 List the bikes', why: 'It is the earliest open task in the plan.', proposedTasks: [], flags: [] } };
        const { changes } = skill.toChanges({ task: task(), raw: null, context });
        expect(changes).toHaveLength(1);
        expect(changes[0].params.body).toContain('Start with BS-1 List the bikes');
    });
});
