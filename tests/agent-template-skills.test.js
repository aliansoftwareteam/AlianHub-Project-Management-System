const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Modules/AICore/llmProvider', () => ({ getProvider: jest.fn(), isAnyProviderConfigured: jest.fn(() => true) }));
jest.mock('../Modules/Agents/memory', () => ({ contextFor: jest.fn(async () => '') }));
jest.mock('../Modules/CustomField/aiFields/fill', () => {
    const actual = jest.requireActual('../Modules/CustomField/aiFields/fill');
    return { ...actual, loadDefinition: jest.fn(), fillTask: jest.fn() };
});

const { SCHEMA_TYPE } = require('../Config/schemaType');
const codeSkills = require('../Modules/Agents/skills');
const actions = require('../Modules/Agents/actions');
const policy = require('../Modules/Agents/policy');
const tools = require('../Modules/Automations/engine/tools');
const aiFields = require('../Modules/CustomField/aiFields/fill');

const C = '6a9954186dd786246031e47b';
const PROJECT = '6f0000000000000000000901';
const OTHER_PROJECT = '6f0000000000000000000902';
const TASK_ID = '6f0000000000000000000701';
const PERSON = '6f0000000000000000000d01';
const SUMMARY = '6f00000000000000000000f1';
const CATEGORY = '6f00000000000000000000f2';
const ELSEWHERE = '6f00000000000000000000f3';
const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(Date.now() - days * DAY);

const aiField = (_id, over = {}) => ({
    _id, fieldTitle: 'Summary', fieldType: 'textarea', isDelete: true, global: false, projectId: [PROJECT],
    fieldAi: { enabled: true, template: 'summary', reads: ['title', 'description'] }, ...over,
});

const taskOf = (over = {}) => ({
    _id: TASK_ID, TaskName: 'Checkout redesign', TaskKey: 'CK-12', ProjectID: PROJECT, CompanyId: C,
    description: 'Rework the checkout so a returning customer pays in one step, with saved cards and an order summary.', ...over,
});

const runSkill = async (key, task, answer) => {
    const skill = codeSkills.getSkill(key);
    const context = await skill.gather({ task, companyId: C, startedBy: PERSON });
    if (context.skip) return { skip: context.skip };
    const verified = skill.verify ? skill.verify({ raw: answer, context }) : { raw: answer, dropped: [] };
    const out = skill.toChanges({ task, raw: verified.raw, context });
    return { ...out, prompt: skill.buildUserPrompt({ task, context }), ungrounded: verified.dropped };
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((type) => { delete mockDb.store[type]; });
    jest.clearAllMocks();
});

describe('the field filler picks AI fields and fills each through the AI-field fill', () => {
    const seed = () => {
        mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, aiField(SUMMARY));
        mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, aiField(CATEGORY, { fieldTitle: 'Area', fieldType: 'dropdown', global: true, projectId: [], fieldAi: { enabled: true, template: 'category', reads: ['title'] } }));
        mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, aiField(ELSEWHERE, { fieldTitle: 'Other project', projectId: [OTHER_PROJECT] }));
        mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id: '6f00000000000000000000f4', fieldTitle: 'Plain', fieldType: 'textarea', isDelete: true, global: true });
        mockDb.seed(SCHEMA_TYPE.TASKS, { ...taskOf(), customField: { [CATEGORY]: { fieldValue: ['design'], _id: CATEGORY } } });
    };

    it('proposes one aifield.fill per field the model picks from the list, and drops an id it made up', async () => {
        seed();
        const out = await runSkill('fields.fill', taskOf(), { fill: [
            { fieldId: SUMMARY, field: 'Summary', why: 'empty' },
            { fieldId: '6f00000000000000000000ff', field: 'Invented', why: 'not listed' },
        ] });
        expect(out.prompt).toContain(`${SUMMARY}: Summary (summary, empty)`);
        expect(out.prompt).toContain(`${CATEGORY}: Area (category, has a value)`);
        expect(out.prompt).not.toContain(ELSEWHERE);
        expect(out.prompt).not.toContain('Plain');
        expect(out.ungrounded).toHaveLength(1);
        expect(out.changes).toEqual([expect.objectContaining({ action: 'aifield.fill', label: 'Fill the AI field "Summary"', params: { fieldId: SUMMARY, taskId: TASK_ID } })]);
        expect(out.summary).toBe('Proposed filling 1 AI field(s).');
    });

    it('skips a task whose project has no AI field', async () => {
        mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, aiField(ELSEWHERE, { projectId: [OTHER_PROJECT] }));
        mockDb.seed(SCHEMA_TYPE.TASKS, taskOf());
        expect(await runSkill('fields.fill', taskOf(), { fill: [] })).toEqual({ skip: 'no AI field applies to this task\'s project' });
    });

    it('fills as the person behind the agent, and undo puts back the value and the fill record', async () => {
        mockDb.seed(SCHEMA_TYPE.TASKS, { ...taskOf(), customField: { [SUMMARY]: { fieldValue: 'old', _id: SUMMARY } }, aiFieldFills: { [SUMMARY]: { trigger: 'manual' } } });
        aiFields.loadDefinition.mockResolvedValue({ definition: { _id: SUMMARY, fieldTitle: 'Summary' }, config: { template: 'summary' } });
        aiFields.fillTask.mockResolvedValue({ outcome: 'filled' });
        const out = await actions.executors['aifield.fill']({ companyId: C, actor: { kind: 'agent', userId: PERSON, agentId: 'a1' }, params: { taskId: TASK_ID, fieldId: SUMMARY } });
        expect(aiFields.fillTask).toHaveBeenCalledWith(expect.objectContaining({ companyId: C, uid: PERSON, taskId: TASK_ID, trigger: 'agent' }));
        expect(out.undo).toEqual({ kind: 'update', taskId: TASK_ID, previous: { [`customField.${SUMMARY}`]: { fieldValue: 'old', _id: SUMMARY }, [`aiFieldFills.${SUMMARY}`]: { trigger: 'manual' } } });
    });

    it('reports a refused or empty fill as a failed action, never as done', async () => {
        mockDb.seed(SCHEMA_TYPE.TASKS, taskOf());
        const run = () => actions.executors['aifield.fill']({ companyId: C, actor: { kind: 'agent', userId: PERSON }, params: { taskId: TASK_ID, fieldId: SUMMARY } });
        aiFields.loadDefinition.mockResolvedValue({ definition: { _id: SUMMARY, fieldTitle: 'Summary' }, config: {} });
        aiFields.fillTask.mockResolvedValue({ outcome: 'skipped', reason: 'forbidden' });
        await expect(run()).rejects.toBeInstanceOf(tools.DeterministicError);
        aiFields.fillTask.mockRejectedValue(new aiFields.AiFieldError(429, 'The daily limit of 500 AI field fills is reached.', 'daily_limit'));
        await expect(run()).rejects.toThrow('The daily limit of 500 AI field fills is reached.');
        aiFields.loadDefinition.mockRejectedValue(new aiFields.AiFieldError(404, 'AI field not found.'));
        await expect(run()).rejects.toBeInstanceOf(tools.DeterministicError);
    });

    it('is proposed at L1 and acts at L2 within the agent\'s project', () => {
        const decide = (autonomy) => policy.decide({ agent: { autonomy, projectIds: [PROJECT] }, action: 'aifield.fill', params: { taskId: TASK_ID, fieldId: SUMMARY }, rating: actions.rating('aifield.fill'), task: taskOf() });
        expect(decide(1).decision).toBe('propose');
        expect(decide(2).decision).toBe('act');
    });
});

describe('wiki upkeep reads the project\'s stale pages', () => {
    const page = (title, over = {}) => mockDb.seed(SCHEMA_TYPE.PAGES, { title, ProjectID: PROJECT, visibility: 'project', deletedStatusKey: 0, updatedAt: ago(5), rawText: `${title} body`, ...over });

    it('lists wiki pages past review and pages untouched for months, and nothing private, drafted or elsewhere', async () => {
        page('Onboarding guide', { isWiki: true, reviewDate: ago(200), updatedAt: ago(250) });
        page('API conventions', { updatedAt: ago(120) });
        page('Release checklist', { updatedAt: ago(3) });
        page('My private notes', { visibility: 'private', updatedAt: ago(300) });
        page('Agent draft', { agentStatus: 'draft', updatedAt: ago(300) });
        page('Other project page', { ProjectID: OTHER_PROJECT, updatedAt: ago(300) });
        const out = await runSkill('wiki.upkeep', taskOf(), { pages: [
            { title: 'Onboarding guide', severity: 'stale', why: 'The setup steps predate the new checkout.' },
            { title: 'Quarterly roadmap', severity: 'old', why: 'Not a listed page.' },
        ], summary: 'One page needs a rewrite.' });
        expect(out.prompt).toContain('STALE PAGES (2 of 3)');
        expect(out.prompt).toMatch(/Onboarding guide \[wiki review stale since \d{4}-\d{2}-\d{2}\]/);
        expect(out.prompt).toMatch(/API conventions \[not updated since \d{4}-\d{2}-\d{2}\]/);
        ['Release checklist', 'My private notes', 'Agent draft', 'Other project page'].forEach((title) => expect(out.prompt).not.toContain(title));
        expect(out.ungrounded).toHaveLength(1);
        expect(out.changes).toHaveLength(1);
        expect(out.changes[0]).toMatchObject({ action: 'task.comment', params: { taskId: TASK_ID } });
        expect(out.changes[0].params.body).toContain('[stale] Onboarding guide: The setup steps predate the new checkout.');
        expect(out.changes[0].params.body).not.toContain('Quarterly roadmap');
    });

    it('skips when every page is current', async () => {
        page('Release checklist', { updatedAt: ago(3) });
        expect((await runSkill('wiki.upkeep', taskOf(), {})).skip).toMatch(/no page in the project/);
    });
});

describe('the PRD writer drafts a page from the brief', () => {
    it('proposes a page draft on the task\'s project, linked to the task, and a comment with the open questions', async () => {
        mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT, ProjectName: 'Storefront', deletedStatusKey: 0 });
        const out = await runSkill('prd.draft', taskOf(), {
            title: 'One-step checkout', prd: '# One-step checkout\n\n## Problem\nReturning customers drop off.', questions: ['Which payment providers?'], summary: 'A PRD for one-step checkout.',
        });
        expect(out.prompt).toContain('PROJECT: Storefront');
        expect(out.changes.map((c) => c.action)).toEqual(['page.draft', 'task.comment']);
        expect(out.changes[0].params).toEqual({ title: 'PRD: One-step checkout', text: '# One-step checkout\n\n## Problem\nReturning customers drop off.', taskId: TASK_ID, projectId: PROJECT });
        expect(out.changes[1].params.body).toContain('Drafted the PRD as a page for review.');
        expect(out.changes[1].params.body).toContain('• Which payment providers?');
    });

    it('skips a task without a brief to work from', async () => {
        expect((await runSkill('prd.draft', taskOf({ description: 'Short.' }), {})).skip).toMatch(/brief is too short/);
    });

    it('saves the drafted text as the page body the editor opens', async () => {
        const out = await actions.executors['page.draft']({ companyId: C, actor: { kind: 'agent', userId: PERSON, agentName: 'PRD Writer' }, params: { title: 'PRD: One-step checkout', text: '# One-step checkout\n\n## Problem\nReturning customers drop off.', projectId: PROJECT, taskId: TASK_ID } });
        const saved = mockDb.store[SCHEMA_TYPE.PAGES].find((p) => String(p._id) === out.result.pageId);
        expect(saved.content.blocks.blocks.map((b) => b.type)).toEqual(['header', 'header', 'paragraph']);
        expect(saved.content.html).toContain('Returning customers drop off.');
        expect(saved.agentStatus).toBe('draft');
    });
});
