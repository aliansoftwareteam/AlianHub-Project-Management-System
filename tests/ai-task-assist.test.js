const mockDb = require('./fixtures/fakeMongo').create();
const mockChat = jest.fn();
const mockProvider = { configured: true };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(), visibleProjects: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/taskReadAccess', () => ({ canReadTask: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async () => 3), isPrivileged: (roleType) => roleType === 1 || roleType === 2 }));
jest.mock('../utils/companyMembers', () => ({ memberProfiles: jest.fn(async (companyId, ids) => ids.map((id) => ({ _id: id, Employee_Name: `Person ${String(id).slice(-2)}` }))) }));
jest.mock('../Modules/AICore/llmProvider', () => ({
    isAnyProviderConfigured: () => mockProvider.configured,
    getProvider: () => ({ name: 'fake', chat: (...a) => mockChat(...a) }),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { myCache } = require('../Config/config');
const scope = require('../Modules/Agents/scope');
const { canReadTask } = require('../Modules/Tasks/helpers/taskReadAccess');
const { FEATURES } = require('../Modules/AICore/features');
const { classOfFeature } = require('../Modules/AICore/taskClass');
const { TASK_ACTIONS } = require('../Config/taskWritePermissions');
const { taskContext } = require('../Modules/AI/taskContext');
const { suggestNextSteps } = require('../Modules/AI/taskAssist');
const research = require('../Modules/AI/taskResearch');
const { improveSelection, splitSelection, MODES } = require('../Modules/AI/selectionAssist');
const assist = require('../Modules/AI/assistController');
const { ask } = require('../Modules/AI/ask');

const C = '6f0000000000000000000c01';
const OPEN = '6f0000000000000000000a01';
const HIDDEN_PROJECT = '6f0000000000000000000a02';
const ME = '6f0000000000000000000001';
const OTHER = '6f0000000000000000000002';
const PRIVATE_SPRINT = '6f0000000000000000000d01';
const OPEN_SPRINT = '6f0000000000000000000d02';

const seed = (type, doc) => mockDb.seed(type, doc);
const task = (over = {}) => seed(SCHEMA_TYPE.TASKS, { TaskName: 'Launch the pricing page', TaskKey: 'AH-1', ProjectID: OPEN, sprintId: OPEN_SPRINT, deletedStatusKey: 0, rawDescription: 'Ship the new tiers.', ...over });
const reply = (content) => ({ content: typeof content === 'string' ? content : JSON.stringify(content), totalTokens: 42, model: 'fake-1' });

const fakeRes = () => {
    const res = { statusCode: 200, body: null };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.send = jest.fn((body) => { res.body = body; return res; });
    res.json = res.send;
    return res;
};
const request = (body = {}, over = {}) => ({ headers: { companyid: C }, uid: ME, aud: C, body, query: {}, params: {}, ...over });
const writes = () => mockDb.calls.filter((c) => !['find', 'findOne', 'aggregate', 'countDocuments', 'distinct'].includes(c.method));
const promptOf = (call) => JSON.stringify(call[0].messages) + String(call[0].systemPrompt || '');

let parent;

const seedNeighbourhood = () => {
    parent = task();
    seed(SCHEMA_TYPE.SPRINTS, { _id: PRIVATE_SPRINT, projectId: OPEN, private: true, AssigneeUserId: [OTHER], deletedStatusKey: 0 });
    task({ TaskName: 'Draft tier copy', TaskKey: 'AH-2', ParentTaskId: String(parent._id) });
    task({ TaskName: 'Secret payroll subtask', TaskKey: 'AH-3', ParentTaskId: String(parent._id), sprintId: PRIVATE_SPRINT });
    task({ TaskName: 'Deleted subtask', TaskKey: 'AH-4', ParentTaskId: String(parent._id), deletedStatusKey: 1 });
    task({ TaskName: 'Unrelated task', TaskKey: 'AH-5' });
    const linked = [require('mongoose').Types.ObjectId.createFromHexString(String(parent._id))];
    seed(SCHEMA_TYPE.PAGES, { title: 'Pricing research', ProjectID: OPEN, linkedTasks: linked, visibility: 'project', createdBy: OTHER, rawText: 'Competitors charge per seat.', deletedStatusKey: 0 });
    seed(SCHEMA_TYPE.PAGES, { title: 'Private salary notes', ProjectID: OPEN, linkedTasks: linked, visibility: 'private', createdBy: OTHER, rawText: 'confidential', deletedStatusKey: 0 });
    seed(SCHEMA_TYPE.PAGES, { title: 'Hidden project plan', ProjectID: HIDDEN_PROJECT, linkedTasks: linked, visibility: 'project', createdBy: OTHER, rawText: 'hidden', deletedStatusKey: 0 });
    seed(SCHEMA_TYPE.PAGES, { title: 'Trashed doc', ProjectID: OPEN, linkedTasks: linked, visibility: 'project', createdBy: OTHER, rawText: 'gone', deletedStatusKey: 1 });
    seed(SCHEMA_TYPE.COMMENTS, { taskId: String(parent._id), message: 'Legal signed off on the tiers', userId: OTHER, type: 'text', createdAt: new Date('2026-09-01') });
    seed(SCHEMA_TYPE.COMMENTS, { taskId: String(parent._id), message: 'removed comment', userId: OTHER, type: 'text', isDeleted: true, createdAt: new Date('2026-09-02') });
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    myCache.flushAll();
    mockProvider.configured = true;
    scope.visibleProjectIds.mockResolvedValue([OPEN]);
    scope.visibleProjects.mockResolvedValue([{ _id: OPEN, ProjectName: 'Growth' }]);
    canReadTask.mockResolvedValue(true);
    delete process.env.SKILL_EXTERNAL_READS;
    seedNeighbourhood();
});

describe('the task-scoped context', () => {
    it('holds the task, its comments, subtasks and linked docs, and nothing the caller cannot open', async () => {
        const ctx = await taskContext({ companyId: C, uid: ME, taskId: String(parent._id) });
        expect(ctx.task.TaskName).toBe('Launch the pricing page');
        expect(ctx.subtasks.map((s) => s.TaskName)).toEqual(['Draft tier copy']);
        expect(ctx.docs.map((d) => d.title)).toEqual(['Pricing research']);
        expect(ctx.comments.map((c) => c.message)).toEqual(['Legal signed off on the tiers']);
        const text = JSON.stringify(ctx);
        ['Secret payroll subtask', 'Deleted subtask', 'Private salary notes', 'Hidden project plan', 'Trashed doc', 'Unrelated task', 'removed comment']
            .forEach((hidden) => expect(text).not.toContain(hidden));
    });

    it('is null for a task the caller cannot read, and for a malformed or missing id', async () => {
        canReadTask.mockResolvedValue(false);
        expect(await taskContext({ companyId: C, uid: ME, taskId: String(parent._id) })).toBeNull();
        canReadTask.mockResolvedValue(true);
        expect(await taskContext({ companyId: C, uid: ME, taskId: 'nope' })).toBeNull();
        expect(await taskContext({ companyId: C, uid: '', taskId: String(parent._id) })).toBeNull();
    });

    it('keeps a narrowed API token inside its projects', async () => {
        expect(await taskContext({ companyId: C, uid: ME, taskId: String(parent._id), tokenProjectIds: [HIDDEN_PROJECT] })).toBeNull();
    });
});

describe('Ask about this task', () => {
    it('answers from the task context only and cites what it read', async () => {
        mockChat.mockResolvedValue(reply('Legal approved it [AH-1].'));
        const res = fakeRes();
        await ask(request({ question: 'Is this ready?', taskId: String(parent._id) }), res);
        expect(res.body.status).toBe(true);
        const refs = res.body.data.sources.map((s) => s.title);
        expect(refs).toEqual(expect.arrayContaining(['Launch the pricing page', 'Draft tier copy', 'Pricing research']));
        const prompt = promptOf(mockChat.mock.calls[0]);
        expect(prompt).toContain('Legal signed off on the tiers');
        ['Secret payroll subtask', 'Private salary notes', 'Hidden project plan', 'Unrelated task'].forEach((hidden) => {
            expect(prompt).not.toContain(hidden);
            expect(JSON.stringify(res.body)).not.toContain(hidden);
        });
        expect(mockChat.mock.calls[0][0].spend).toEqual({ feature: FEATURES.ASK, companyId: C, userId: ME });
    });

    it('refuses a task the caller cannot open before any model call', async () => {
        canReadTask.mockResolvedValue(false);
        const res = fakeRes();
        await ask(request({ question: 'What is this?', taskId: String(parent._id) }), res);
        expect(res.body).toMatchObject({ status: false, code: 'task_not_found' });
        expect(JSON.stringify(res.body)).not.toContain('Launch the pricing page');
        expect(mockChat).not.toHaveBeenCalled();
    });
});

describe('Suggest next steps', () => {
    it('returns three to seven concrete steps and books the spend under task_assist', async () => {
        mockChat.mockResolvedValue(reply({ steps: ['Confirm tier prices with finance', 'Write the FAQ', ' Write the FAQ ', 'Add the checkout link', '', 'Book the launch review', 'Update docs', 'Tell support', 'Brief sales', 'Ninth step'] }));
        const out = await suggestNextSteps({ companyId: C, uid: ME, taskId: String(parent._id) });
        expect(out.status).toBe(true);
        expect(out.data.steps.length).toBeGreaterThanOrEqual(3);
        expect(out.data.steps.length).toBeLessThanOrEqual(7);
        expect(out.data.steps.filter((s) => s === 'Write the FAQ')).toHaveLength(1);
        expect(mockChat.mock.calls[0][0].spend).toEqual({ feature: FEATURES.TASK_ASSIST, companyId: C, userId: ME });
        expect(promptOf(mockChat.mock.calls[0])).not.toContain('Secret payroll subtask');
    });

    it('writes nothing: steps are only applied through the normal checklist and subtask paths', async () => {
        mockChat.mockResolvedValue(reply({ steps: ['One', 'Two', 'Three'] }));
        const res = fakeRes();
        await assist.nextSteps(request({ taskId: String(parent._id) }), res);
        expect(res.body).toMatchObject({ status: true, data: { steps: ['One', 'Two', 'Three'] } });
        expect(writes()).toEqual([]);
        expect(TASK_ACTIONS.AddAiChecklist.needs).toEqual([expect.objectContaining({ key: 'task.task_checklist', write: true })]);
        expect(TASK_ACTIONS.createSubTaskWithAi.needs({ type: 'subTask' })).toEqual([expect.objectContaining({ key: 'task.sub_task_create', write: true })]);
        expect(TASK_ACTIONS.createSubTaskWithAi.needs({ type: 'task' })).toEqual([expect.objectContaining({ key: 'task.task_create', write: true })]);
    });

    it('answers not found for a hidden task and fails plainly when the model gives too few steps', async () => {
        canReadTask.mockResolvedValue(false);
        const hidden = fakeRes();
        await assist.nextSteps(request({ taskId: String(parent._id) }), hidden);
        expect(hidden.statusCode).toBe(404);
        expect(mockChat).not.toHaveBeenCalled();

        canReadTask.mockResolvedValue(true);
        mockChat.mockResolvedValue(reply({ steps: ['Only one'] }));
        const thin = await suggestNextSteps({ companyId: C, uid: ME, taskId: String(parent._id) });
        expect(thin).toMatchObject({ status: false, code: 'no_steps' });
    });

    it('respects AI off: the refusal comes back as ai_off and nothing is written', async () => {
        mockChat.mockRejectedValue(Object.assign(new Error('AI is turned off for this workspace.'), { code: 'ai_off', statusCode: 403 }));
        const res = fakeRes();
        await assist.nextSteps(request({ taskId: String(parent._id) }), res);
        expect(res.body).toMatchObject({ status: false, code: 'ai_off' });
        expect(writes()).toEqual([]);
    });
});

describe("the asker's own notes", () => {
    beforeEach(() => seed(SCHEMA_TYPE.AI_PROFILES, { ownerId: ME, nickname: 'Mev', preferences: 'Short bullet points', facts: [] }));

    it('shape Ask about this task and Suggest next steps for the person asking', async () => {
        mockChat.mockResolvedValue(reply('Ready [AH-1].'));
        await ask(request({ question: 'Ready?', taskId: String(parent._id) }), fakeRes());
        expect(promptOf(mockChat.mock.calls[0])).toContain('Short bullet points');

        mockChat.mockResolvedValue(reply({ steps: ['One', 'Two', 'Three'] }));
        await assist.nextSteps(request({ taskId: String(parent._id) }), fakeRes());
        const content = mockChat.mock.calls[1][0].messages[0].content;
        expect(content).toContain('about_the_asker');
        expect(content).toContain('Short bullet points');
        expect(content.indexOf('about_the_asker')).toBeLessThan(content.indexOf('workspace_data'));
    });

    it('are left out for a narrowed API token', async () => {
        mockChat.mockResolvedValue(reply({ steps: ['One', 'Two', 'Three'] }));
        await assist.nextSteps(request({ taskId: String(parent._id) }, { apiToken: { projectIds: [OPEN] } }), fakeRes());
        expect(promptOf(mockChat.mock.calls[0])).not.toContain('Short bullet points');

        const outside = fakeRes();
        await assist.nextSteps(request({ taskId: String(parent._id) }, { apiToken: { projectIds: [HIDDEN_PROJECT] } }), outside);
        expect(outside.statusCode).toBe(404);
        expect(mockChat).toHaveBeenCalledTimes(1);
    });
});

describe('Research this', () => {
    it('is hidden while the instance allows no outbound web access for AI', async () => {
        expect(research.capability()).toMatchObject({ available: false, reason: 'egress_off' });
        const caps = fakeRes();
        await assist.capabilities(request(), caps);
        expect(caps.body).toMatchObject({ status: true, data: { research: false } });

        const res = fakeRes();
        await assist.research(request({ taskId: String(parent._id) }), res);
        expect(res.statusCode).toBe(404);
        expect(res.body).toMatchObject({ status: false, code: 'research_not_available' });
        expect(mockChat).not.toHaveBeenCalled();
    });

    it('stays hidden with egress on until a web-search tool exists', async () => {
        process.env.SKILL_EXTERNAL_READS = 'on';
        expect(research.capability()).toMatchObject({ available: false, reason: 'no_web_search_tool' });
    });

    it('returns a cited summary with source links and books the spend, given a search tool', async () => {
        const search = jest.fn(async () => [
            { title: 'Pricing pages that convert', url: 'https://example.org/pricing', snippet: 'Three tiers work best.' },
            { title: 'Bad link', url: 'javascript:alert(1)', snippet: 'x' },
        ]);
        mockChat.mockResolvedValue(reply({ summary: 'Three tiers convert best [1].' }));
        const out = await research.researchTask({ companyId: C, uid: ME, taskId: String(parent._id), search });
        expect(out.status).toBe(true);
        expect(out.data.summary).toBe('Three tiers convert best [1].');
        expect(out.data.sources).toEqual([{ n: 1, title: 'Pricing pages that convert', url: 'https://example.org/pricing' }]);
        expect(mockChat.mock.calls[0][0].spend).toEqual({ feature: FEATURES.TASK_ASSIST, companyId: C, userId: ME });
        expect(search.mock.calls[0][0]).not.toContain('Secret payroll subtask');
    });
});

describe('Selection tools', () => {
    it('improves a selection in each mode through the writing_assist feature', async () => {
        expect(MODES).toEqual(['rewrite', 'shorten', 'expand', 'grammar', 'translate']);
        mockChat.mockResolvedValue(reply({ text: 'A tighter sentence.' }));
        const out = await improveSelection({ companyId: C, uid: ME, mode: 'shorten', text: 'A long and winding sentence.' });
        expect(out).toEqual({ status: true, data: { text: 'A tighter sentence.' } });
        expect(mockChat.mock.calls[0][0].spend).toEqual({ feature: FEATURES.WRITING_ASSIST, companyId: C, userId: ME });
    });

    it('refuses an unknown mode, an empty selection and a translation without a language before any call', async () => {
        expect(await improveSelection({ companyId: C, uid: ME, mode: 'poem', text: 'x' })).toMatchObject({ status: false, code: 'invalid_mode' });
        expect(await improveSelection({ companyId: C, uid: ME, mode: 'rewrite', text: '   ' })).toMatchObject({ status: false, code: 'text_required' });
        expect(await improveSelection({ companyId: C, uid: ME, mode: 'translate', text: 'Hello' })).toMatchObject({ status: false, code: 'language_required' });
        expect(mockChat).not.toHaveBeenCalled();
    });

    it('splits a selection into distinct task titles', async () => {
        mockChat.mockResolvedValue(reply({ titles: ['Write the FAQ', 'write the faq', 'Book the review', '  '] }));
        const out = await splitSelection({ companyId: C, uid: ME, text: 'We need an FAQ and a review.' });
        expect(out).toEqual({ status: true, data: { titles: ['Write the FAQ', 'Book the review'] } });
        expect(mockChat.mock.calls[0][0].spend).toEqual({ feature: FEATURES.WRITING_ASSIST, companyId: C, userId: ME });
    });

    it('answers unconfigured without a model and writes nothing', async () => {
        mockProvider.configured = false;
        const res = fakeRes();
        await assist.improve(request({ mode: 'rewrite', text: 'Hello' }), res);
        expect(res.body).toMatchObject({ status: false, code: 'unconfigured' });
        expect(mockChat).not.toHaveBeenCalled();
        expect(writes()).toEqual([]);
    });
});

describe('spend tags', () => {
    it('are known features, each in a task class', () => {
        expect(FEATURES.TASK_ASSIST).toBe('task_assist');
        expect(FEATURES.WRITING_ASSIST).toBe('writing_assist');
        expect(classOfFeature(FEATURES.TASK_ASSIST)).toBe('assist');
        expect(classOfFeature(FEATURES.WRITING_ASSIST)).toBe('assist');
    });
});
