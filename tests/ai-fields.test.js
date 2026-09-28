/* Task 043 slice 6: a long text or dropdown field the model fills from the task. A fill reads only
   what the person asking can open, writes through the task custom-field update path with its
   permission check, books its spend under its own feature, and a bulk run stops at the caps. */
const { create } = require('./fixtures/fakeMongo');

const COMPANY = '6a9954186dd786246031e47b';
const OTHER_COMPANY = '6a9954186dd786246031e400';
const PROJECT = '6a9954186dd786246031e481';
const HIDDEN_PROJECT = '6a9954186dd786246031e482';
const ALICE = '6f0000000000000000000d01';
const BOB = '6f0000000000000000000d02';

const mockDbs = {};
const mockDbFor = (companyId) => {
    const key = String(companyId);
    if (!mockDbs[key]) mockDbs[key] = create();
    return mockDbs[key];
};
const mockChat = jest.fn();
const mockUpdateTaskCustomField = jest.fn();
const mockBudgetCheck = jest.fn();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, ...rest) => mockDbFor(companyId).crud(companyId, ...rest),
}));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/projectAccess', () => ({
    canReadProject: jest.fn(async (companyId, uid, projectId) => (String(projectId) === '6a9954186dd786246031e481'
        ? { allowed: true }
        : { allowed: false, statusCode: 404 })),
    requireProjectAccess: () => (req, res, next) => next(),
}));
jest.mock('../Modules/Agents/scope', () => ({
    visibleProjectIds: jest.fn(async () => ['6a9954186dd786246031e481']),
}));
jest.mock('../Config/permissionGuard', () => {
    const actual = jest.requireActual('../Config/permissionGuard');
    return {
        ...actual,
        evaluatePermission: jest.fn(async (companyId, uid, key) => (key === 'task.task_custom_field' ? String(uid) === '6f0000000000000000000d01' : true)),
    };
});
jest.mock('../Modules/AICore/llmProvider', () => ({
    isAnyProviderConfigured: () => true,
    getProvider: () => ({ chat: (...args) => mockChat(...args) }),
}));
jest.mock('../Modules/Agents/budget', () => ({ check: (...args) => mockBudgetCheck(...args) }));
jest.mock('../Modules/Tasks/helpers/task_class_Mongo', () => ({
    taskMongo: { updateTaskCustomField: (...args) => mockUpdateTaskCustomField(...args) },
}));

const mongoose = require('mongoose');
const socketEmitter = require('../event/socketEventEmitter');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { evaluatePermission } = require('../Config/permissionGuard');
const aiSwitch = require('../Modules/AICore/aiSwitch');
const { FEATURES } = require('../Modules/AICore/features');
const { fieldInsertFrom, fieldUpdateFrom, FieldWriteError } = require('../Modules/CustomField/helpers/fieldWrite');
const { describeCustomFieldValue } = require('../Modules/Tasks/helpers/taskItemHistory');
const config = require('../Modules/CustomField/aiFields/config');
const fill = require('../Modules/CustomField/aiFields/fill');
const jobs = require('../Modules/CustomField/aiFields/jobs');
const autoRefill = require('../Modules/CustomField/aiFields/autoRefill');
const controller = require('../Modules/CustomField/aiFields/controller');

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const db = () => mockDbFor(COMPANY);

const OPTIONS = [
    { id: 'opt01', label: 'Backend', value: 'backend', color: '#34495E' },
    { id: 'opt02', label: 'Design', value: 'design', color: '#34495E' },
];

const seedField = (overrides = {}, companyId = COMPANY) => mockDbFor(companyId).seed(SCHEMA_TYPE.CUSTOM_FIELDS, {
    fieldTitle: 'Summary', fieldType: 'textarea', type: 'task', isDelete: true, global: true, projectId: [],
    fieldAi: { enabled: true, template: 'summary', reads: ['title', 'description'], autoRefill: false, language: '', prompt: '' },
    ...overrides,
});

const seedTask = (overrides = {}) => db().seed(SCHEMA_TYPE.TASKS, {
    TaskName: 'Ship the login page', description: 'Build the form and wire the SSO button.',
    ProjectID: oid(PROJECT), CompanyId: COMPANY, deletedStatusKey: 0, customField: {}, ...overrides,
});

const answer = (value) => ({ content: JSON.stringify({ value }), usage: { prompt_tokens: 10, completion_tokens: 5 } });

/* The spend meter books one ai_usage row per call; the provider is mocked below it, so the mock books it. */
const modelAnswers = (...values) => {
    let next = 0;
    mockChat.mockImplementation(async (opts) => {
        const spend = (opts && opts.spend) || {};
        mockDbFor(spend.companyId).seed(SCHEMA_TYPE.AI_USAGE, { companyId: spend.companyId, feature: spend.feature, userId: spend.userId, at: new Date(), billedToWorkspace: true });
        const value = values[Math.min(next, values.length - 1)];
        next += 1;
        return answer(value);
    });
};

const storedTask = (id) => db().store(SCHEMA_TYPE.TASKS).find((row) => String(row._id) === String(id));
const promptSent = (index = 0) => mockChat.mock.calls[index][0].messages.map((m) => m.content).join('\n');

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => delete mockDbs[key]);
    jest.clearAllMocks();
    mockBudgetCheck.mockResolvedValue({ ok: true, reason: '' });
    mockUpdateTaskCustomField.mockImplementation(async ({ companyId, taskId, customFieldId, updateDetail }) => {
        await mockDbFor(companyId).crud(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [{ _id: oid(taskId) }, { $set: { [`customField.${customFieldId}`]: updateDetail } }],
        }, 'updateOne');
        return { status: true };
    });
    delete process.env.AI_ENABLED;
    delete process.env.AI_FIELD_DAILY_LIMIT;
    delete process.env.AI_FIELD_BULK_MAX;
    aiSwitch.forget();
    autoRefill.stop();
});

describe('the AI config on a long text or dropdown field', () => {
    it('fills in the defaults: reads the title and description, no auto-refill', () => {
        expect(config.normaliseAiConfig({ template: 'summary' }, 'textarea')).toEqual({
            enabled: true, template: 'summary', language: '', prompt: '', reads: ['title', 'description'], autoRefill: false,
        });
    });

    it('offers category only on a dropdown and the text templates only on long text', () => {
        expect(() => config.normaliseAiConfig({ template: 'category' }, 'textarea')).toThrow();
        expect(() => config.normaliseAiConfig({ template: 'summary' }, 'dropdown')).toThrow();
        expect(config.normaliseAiConfig({ template: 'category' }, 'dropdown').template).toBe('category');
        expect(() => config.normaliseAiConfig({ template: 'summary' }, 'number')).toThrow();
    });

    it('needs a language to translate into and a prompt for a custom field', () => {
        expect(() => config.normaliseAiConfig({ template: 'translation' }, 'textarea')).toThrow();
        expect(config.normaliseAiConfig({ template: 'translation', language: ' French ' }, 'textarea').language).toBe('French');
        expect(() => config.normaliseAiConfig({ template: 'custom', prompt: '   ' }, 'textarea')).toThrow();
    });

    it('reads only the known task parts', () => {
        expect(() => config.normaliseAiConfig({ template: 'summary', reads: ['title', 'attachments'] }, 'textarea')).toThrow();
        expect(() => config.normaliseAiConfig({ template: 'summary', reads: [] }, 'textarea')).toThrow();
    });

    it('is checked where a field definition is written, and stored normalised', () => {
        expect(() => fieldInsertFrom({ fieldTitle: 'Area', fieldType: 'textarea', fieldAi: { template: 'category' } })).toThrow(FieldWriteError);
        expect(() => fieldUpdateFrom({ key: '$set', id: '6a9954186dd786246031e499', updateObject: { fieldAi: { template: 'summary' } } })).toThrow(FieldWriteError);
        const updateObject = { fieldTitle: 'Notes', fieldType: 'textarea', fieldAi: { template: 'summary', autoRefill: 'yes', extra: 1 } };
        fieldInsertFrom(updateObject);
        expect(updateObject.fieldAi).toEqual({ enabled: true, template: 'summary', language: '', prompt: '', reads: ['title', 'description'], autoRefill: false });
    });

    it('can be switched off', () => {
        const updateObject = { fieldType: 'textarea', fieldAi: { enabled: false } };
        fieldUpdateFrom({ key: '$set', id: '6a9954186dd786246031e499', updateObject });
        expect(updateObject.fieldAi).toEqual({ enabled: false });
    });
});

describe('filling one task', () => {
    it('previews first, then writes the previewed value through the custom-field update path', async () => {
        const field = seedField();
        const task = seedTask();
        modelAnswers('A login page with SSO is being built.');

        const preview = await fill.proposeFills({ companyId: COMPANY, uid: ALICE, fieldId: String(field._id), taskIds: [String(task._id)] });
        expect(preview.proposals).toEqual([expect.objectContaining({ taskId: String(task._id), text: 'A login page with SSO is being built.', empty: false })]);
        expect(mockUpdateTaskCustomField).not.toHaveBeenCalled();

        const applied = await fill.applyProposals({ companyId: COMPANY, uid: ALICE, fieldId: String(field._id), proposalIds: [preview.proposals[0].proposalId] });
        expect(applied.applied).toEqual([String(task._id)]);
        expect(mockChat).toHaveBeenCalledTimes(1);
        expect(mockUpdateTaskCustomField).toHaveBeenCalledWith(expect.objectContaining({
            companyId: COMPANY,
            taskId: String(task._id),
            customFieldId: String(field._id),
            updateDetail: { fieldValue: 'A login page with SSO is being built.', _id: String(field._id) },
            userData: expect.objectContaining({ id: ALICE }),
            storedTask: expect.objectContaining({ TaskName: 'Ship the login page' }),
            filledByAi: true,
        }));
        const fills = storedTask(task._id).aiFieldFills[String(field._id)];
        expect(fills).toEqual(expect.objectContaining({ by: ALICE, template: 'summary', trigger: 'manual' }));
        expect(fills.at).toBeInstanceOf(Date);
        expect(typeof fills.hash).toBe('string');
    });

    it('asks for task.task_custom_field in the task project before any model call', async () => {
        const field = seedField();
        const task = seedTask();
        modelAnswers('never');

        await expect(fill.proposeFills({ companyId: COMPANY, uid: BOB, fieldId: String(field._id), taskIds: [String(task._id)] }))
            .resolves.toEqual({ proposals: [expect.objectContaining({ taskId: String(task._id), proposalId: null, reason: 'forbidden' })] });
        expect(evaluatePermission).toHaveBeenCalledWith(COMPANY, BOB, 'task.task_custom_field', expect.objectContaining({ projectId: PROJECT }));
        expect(mockChat).not.toHaveBeenCalled();
        expect(mockUpdateTaskCustomField).not.toHaveBeenCalled();
    });

    it('treats a task in a project the person cannot open as not found and never reads it into a prompt', async () => {
        const field = seedField();
        const hidden = seedTask({ ProjectID: oid(HIDDEN_PROJECT), TaskName: 'Secret merger' });
        modelAnswers('never');

        const result = await fill.proposeFills({ companyId: COMPANY, uid: ALICE, fieldId: String(field._id), taskIds: [String(hidden._id)] });
        expect(result.proposals[0]).toEqual(expect.objectContaining({ proposalId: null, reason: 'not_found' }));
        expect(mockChat).not.toHaveBeenCalled();
    });

    it('sends only the task parts the field reads', async () => {
        const field = seedField({ fieldAi: { enabled: true, template: 'summary', reads: ['title', 'comments'], autoRefill: false, language: '', prompt: '' } });
        const task = seedTask();
        db().seed(SCHEMA_TYPE.COMMENTS, { taskId: String(task._id), message: 'Waiting on the SSO certificate', type: 'text', userId: ALICE, createdAt: new Date() });
        modelAnswers('Blocked on the certificate.');

        await fill.proposeFills({ companyId: COMPANY, uid: ALICE, fieldId: String(field._id), taskIds: [String(task._id)] });
        expect(promptSent()).toContain('Ship the login page');
        expect(promptSent()).toContain('Waiting on the SSO certificate');
        expect(promptSent()).not.toContain('wire the SSO button');
    });

    it('books the spend under the ai_field feature, the workspace and the person', async () => {
        expect(FEATURES.AI_FIELD).toBe('ai_field');
        const field = seedField();
        const task = seedTask();
        modelAnswers('Summary');

        await fill.proposeFills({ companyId: COMPANY, uid: ALICE, fieldId: String(field._id), taskIds: [String(task._id)] });
        expect(mockChat.mock.calls[0][0].spend).toEqual({ feature: 'ai_field', companyId: COMPANY, userId: ALICE });
    });

    it('turns a category answer into one of the dropdown options', async () => {
        const field = seedField({ fieldTitle: 'Area', fieldType: 'dropdown', fieldOptions: OPTIONS, fieldAi: { enabled: true, template: 'category', reads: ['title'], autoRefill: false, language: '', prompt: '' } });
        const task = seedTask();
        modelAnswers('backend');

        const preview = await fill.proposeFills({ companyId: COMPANY, uid: ALICE, fieldId: String(field._id), taskIds: [String(task._id)] });
        expect(preview.proposals[0]).toEqual(expect.objectContaining({ text: 'Backend', fieldValue: ['opt01'], empty: false }));
        expect(promptSent()).toContain('"Backend"');
        expect(promptSent()).toContain('"Design"');
    });

    it('leaves a category empty when the answer is not one of the options, and writes nothing for it', async () => {
        const field = seedField({ fieldTitle: 'Area', fieldType: 'dropdown', fieldOptions: OPTIONS, fieldAi: { enabled: true, template: 'category', reads: ['title'], autoRefill: false, language: '', prompt: '' } });
        const task = seedTask();
        modelAnswers('Marketing');

        const preview = await fill.proposeFills({ companyId: COMPANY, uid: ALICE, fieldId: String(field._id), taskIds: [String(task._id)] });
        expect(preview.proposals[0]).toEqual(expect.objectContaining({ text: '', fieldValue: [], empty: true, reason: 'no_fit' }));
        const applied = await fill.applyProposals({ companyId: COMPANY, uid: ALICE, fieldId: String(field._id), proposalIds: [preview.proposals[0].proposalId] });
        expect(applied.applied).toEqual([]);
        expect(mockUpdateTaskCustomField).not.toHaveBeenCalled();
    });

    it('turns action items into one line each', async () => {
        const field = seedField({ fieldTitle: 'Next', fieldAi: { enabled: true, template: 'action_items', reads: ['title'], autoRefill: false, language: '', prompt: '' } });
        const task = seedTask();
        modelAnswers(['Order the certificate', 'Add the SSO button']);

        const preview = await fill.proposeFills({ companyId: COMPANY, uid: ALICE, fieldId: String(field._id), taskIds: [String(task._id)] });
        expect(preview.proposals[0].text).toBe('- Order the certificate\n- Add the SSO button');
    });

    it('refuses a field that is not an AI field', async () => {
        const field = seedField({ fieldAi: undefined });
        const task = seedTask();
        await expect(fill.proposeFills({ companyId: COMPANY, uid: ALICE, fieldId: String(field._id), taskIds: [String(task._id)] }))
            .rejects.toMatchObject({ statusCode: 404 });
    });
});

describe('company scoping', () => {
    it('never finds a field defined in another company', async () => {
        const foreign = seedField({}, OTHER_COMPANY);
        const task = seedTask();
        await expect(fill.proposeFills({ companyId: COMPANY, uid: ALICE, fieldId: String(foreign._id), taskIds: [String(task._id)] }))
            .rejects.toMatchObject({ statusCode: 404 });
        expect(mockChat).not.toHaveBeenCalled();
    });

    it('applies a preview only in the company and for the person it was made for', async () => {
        const field = seedField();
        const task = seedTask();
        modelAnswers('Summary');
        const { proposals } = await fill.proposeFills({ companyId: COMPANY, uid: ALICE, fieldId: String(field._id), taskIds: [String(task._id)] });

        const elsewhere = await fill.applyProposals({ companyId: OTHER_COMPANY, uid: ALICE, fieldId: String(field._id), proposalIds: [proposals[0].proposalId] });
        const someoneElse = await fill.applyProposals({ companyId: COMPANY, uid: BOB, fieldId: String(field._id), proposalIds: [proposals[0].proposalId] });
        expect(elsewhere.applied).toEqual([]);
        expect(someoneElse.applied).toEqual([]);
        expect(mockUpdateTaskCustomField).not.toHaveBeenCalled();
    });

    it('reads the task, its comments and the field from the request company only', async () => {
        const field = seedField({ fieldAi: { enabled: true, template: 'summary', reads: ['title', 'comments', 'subtasks'], autoRefill: false, language: '', prompt: '' } });
        const task = seedTask();
        modelAnswers('Summary');
        await fill.proposeFills({ companyId: COMPANY, uid: ALICE, fieldId: String(field._id), taskIds: [String(task._id)] });
        const reads = Object.entries(mockDbs).flatMap(([key, fake]) => fake.calls.map((call) => ({ key, type: call.type })));
        const companyData = [SCHEMA_TYPE.TASKS, SCHEMA_TYPE.COMMENTS];
        expect(reads.filter((r) => companyData.includes(r.type)).every((r) => r.key === COMPANY)).toBe(true);
    });
});

describe('bulk fill jobs', () => {
    const threeTasks = () => [seedTask({ TaskName: 'One' }), seedTask({ TaskName: 'Two' }), seedTask({ TaskName: 'Three' })];

    it('fills every task, one model call each, and reports its progress', async () => {
        const field = seedField();
        const tasks = threeTasks();
        modelAnswers('Filled');

        const { job, done } = await jobs.startJob({ companyId: COMPANY, uid: ALICE, fieldId: String(field._id), taskIds: tasks.map((t) => String(t._id)) });
        expect(job).toEqual(expect.objectContaining({ status: 'queued', total: 3, processed: 0 }));
        await done;

        const read = await jobs.readJob({ companyId: COMPANY, uid: ALICE, jobId: String(job._id) });
        expect(read).toEqual(expect.objectContaining({ status: 'done', total: 3, processed: 3, filled: 3, skipped: 0 }));
        expect(mockChat).toHaveBeenCalledTimes(3);
        expect(mockUpdateTaskCustomField).toHaveBeenCalledTimes(3);
        tasks.forEach((t) => expect(storedTask(t._id).aiFieldFills[String(field._id)].trigger).toBe('bulk'));
    });

    it('writes the previewed values without asking the model again', async () => {
        const field = seedField();
        const tasks = threeTasks();
        modelAnswers('Previewed');
        const { proposals } = await fill.proposeFills({ companyId: COMPANY, uid: ALICE, fieldId: String(field._id), taskIds: [String(tasks[0]._id)] });
        mockChat.mockClear();
        modelAnswers('Filled');

        const { done } = await jobs.startJob({ companyId: COMPANY, uid: ALICE, fieldId: String(field._id), taskIds: tasks.map((t) => String(t._id)), proposalIds: [proposals[0].proposalId] });
        await done;
        expect(mockChat).toHaveBeenCalledTimes(2);
        expect(storedTask(tasks[0]._id).customField[String(field._id)].fieldValue).toBe('Previewed');
    });

    it('stops at the daily limit and leaves the rest untouched', async () => {
        process.env.AI_FIELD_DAILY_LIMIT = '2';
        const field = seedField();
        const tasks = threeTasks();
        modelAnswers('Filled');

        const { job, done } = await jobs.startJob({ companyId: COMPANY, uid: ALICE, fieldId: String(field._id), taskIds: tasks.map((t) => String(t._id)) });
        await done;
        const read = await jobs.readJob({ companyId: COMPANY, uid: ALICE, jobId: String(job._id) });
        expect(read).toEqual(expect.objectContaining({ status: 'stopped', stopReason: 'daily_limit', processed: 2, filled: 2 }));
        expect(mockChat).toHaveBeenCalledTimes(2);
        expect(storedTask(tasks[2]._id).customField[String(field._id)]).toBeUndefined();
    });

    it('stops when the workspace budget is reached', async () => {
        const field = seedField();
        const tasks = threeTasks();
        modelAnswers('Filled');
        mockBudgetCheck.mockResolvedValueOnce({ ok: true }).mockResolvedValue({ ok: false, reason: 'Company agent budget reached' });

        const { job, done } = await jobs.startJob({ companyId: COMPANY, uid: ALICE, fieldId: String(field._id), taskIds: tasks.map((t) => String(t._id)) });
        await done;
        const read = await jobs.readJob({ companyId: COMPANY, uid: ALICE, jobId: String(job._id) });
        expect(read).toEqual(expect.objectContaining({ status: 'stopped', stopReason: 'budget' }));
        expect(read.processed).toBeLessThan(3);
    });

    it('skips a task the person may not edit and carries on', async () => {
        const field = seedField();
        const [visible] = threeTasks();
        const hidden = seedTask({ ProjectID: oid(HIDDEN_PROJECT) });
        modelAnswers('Filled');

        const { job, done } = await jobs.startJob({ companyId: COMPANY, uid: ALICE, fieldId: String(field._id), taskIds: [String(hidden._id), String(visible._id)] });
        await done;
        const read = await jobs.readJob({ companyId: COMPANY, uid: ALICE, jobId: String(job._id) });
        expect(read).toEqual(expect.objectContaining({ status: 'done', processed: 2, filled: 1, skipped: 1 }));
        expect(mockChat).toHaveBeenCalledTimes(1);
    });

    it('refuses more tasks than one job may take', async () => {
        process.env.AI_FIELD_BULK_MAX = '2';
        const field = seedField();
        const tasks = threeTasks();
        await expect(jobs.startJob({ companyId: COMPANY, uid: ALICE, fieldId: String(field._id), taskIds: tasks.map((t) => String(t._id)) }))
            .rejects.toMatchObject({ statusCode: 400 });
    });

    it('does not start while AI is off', async () => {
        process.env.AI_ENABLED = 'false';
        const field = seedField();
        const tasks = threeTasks();
        await expect(jobs.startJob({ companyId: COMPANY, uid: ALICE, fieldId: String(field._id), taskIds: tasks.map((t) => String(t._id)) }))
            .rejects.toMatchObject({ statusCode: 403, code: 'ai_off' });
        expect(mockChat).not.toHaveBeenCalled();
    });

    it('shows a job only to the person who started it, in its own company', async () => {
        const field = seedField();
        const tasks = threeTasks();
        modelAnswers('Filled');
        const { job, done } = await jobs.startJob({ companyId: COMPANY, uid: ALICE, fieldId: String(field._id), taskIds: [String(tasks[0]._id)] });
        await done;
        expect(await jobs.readJob({ companyId: COMPANY, uid: BOB, jobId: String(job._id) })).toBeNull();
        expect(await jobs.readJob({ companyId: OTHER_COMPANY, uid: ALICE, jobId: String(job._id) })).toBeNull();
    });
});

describe('auto-refill', () => {
    const filledTask = async (fieldAi) => {
        const field = seedField({ fieldAi: { enabled: true, template: 'summary', reads: ['title'], autoRefill: true, language: '', prompt: '', ...fieldAi } });
        const task = seedTask();
        modelAnswers('First');
        const { proposals } = await fill.proposeFills({ companyId: COMPANY, uid: ALICE, fieldId: String(field._id), taskIds: [String(task._id)] });
        await fill.applyProposals({ companyId: COMPANY, uid: ALICE, fieldId: String(field._id), proposalIds: [proposals[0].proposalId] });
        mockChat.mockClear();
        mockUpdateTaskCustomField.mockClear();
        modelAnswers('Second');
        return { field, task };
    };

    const rename = async (task, TaskName) => {
        await db().crud(COMPANY, { type: SCHEMA_TYPE.TASKS, data: [{ _id: task._id }, { $set: { TaskName } }] }, 'updateOne');
        return { ...storedTask(task._id), TaskName };
    };

    beforeEach(() => autoRefill.start({ debounceMs: 0 }));

    it('refills a filled task when a part the field reads changes, as the person who filled it', async () => {
        const { field, task } = await filledTask();
        const doc = await rename(task, 'Ship the signup page');
        socketEmitter.emit('update', { type: 'update', module: 'task', data: doc, updatedFields: { TaskName: 'Ship the signup page' } });
        await autoRefill.flush();

        expect(mockChat).toHaveBeenCalledTimes(1);
        expect(mockChat.mock.calls[0][0].spend.userId).toBe(ALICE);
        expect(storedTask(task._id).customField[String(field._id)].fieldValue).toBe('Second');
        expect(storedTask(task._id).aiFieldFills[String(field._id)].trigger).toBe('auto');
    });

    it('ignores a change to a part the field does not read', async () => {
        const { task } = await filledTask();
        socketEmitter.emit('update', { type: 'update', module: 'task', data: storedTask(task._id), updatedFields: { Task_Priority: 'High' } });
        socketEmitter.emit('update', { type: 'update', module: 'task', data: storedTask(task._id), updatedFields: { description: 'New words' } });
        await autoRefill.flush();
        expect(mockChat).not.toHaveBeenCalled();
    });

    it('does nothing when the read parts come back unchanged', async () => {
        const { task } = await filledTask();
        socketEmitter.emit('update', { type: 'update', module: 'task', data: storedTask(task._id), updatedFields: { TaskName: 'Ship the login page' } });
        await autoRefill.flush();
        expect(mockChat).not.toHaveBeenCalled();
    });

    it('leaves a field with auto-refill off alone', async () => {
        const { task } = await filledTask({ autoRefill: false });
        const doc = await rename(task, 'Something else');
        socketEmitter.emit('update', { type: 'update', module: 'task', data: doc, updatedFields: { TaskName: 'Something else' } });
        await autoRefill.flush();
        expect(mockChat).not.toHaveBeenCalled();
    });

    it('never makes a first fill on its own', async () => {
        seedField({ fieldAi: { enabled: true, template: 'summary', reads: ['title'], autoRefill: true, language: '', prompt: '' } });
        const task = seedTask();
        modelAnswers('Unasked');
        const doc = await rename(task, 'Renamed');
        socketEmitter.emit('update', { type: 'update', module: 'task', data: doc, updatedFields: { TaskName: 'Renamed' } });
        await autoRefill.flush();
        expect(mockChat).not.toHaveBeenCalled();
    });

    it('refills on a new comment when the field reads comments', async () => {
        const { task } = await filledTask({ reads: ['comments'] });
        const comment = db().seed(SCHEMA_TYPE.COMMENTS, { taskId: String(task._id), message: 'Certificate arrived', type: 'text', userId: ALICE, createdAt: new Date() });
        socketEmitter.emit('insert', { type: 'insert', module: 'comments', companyId: COMPANY, data: comment, updatedFields: {} });
        await autoRefill.flush();
        expect(mockChat).toHaveBeenCalledTimes(1);
        expect(promptSent()).toContain('Certificate arrived');
    });
});

describe('history', () => {
    it('says a value was filled by AI', () => {
        const entry = describeCustomFieldValue({
            actor: { id: ALICE, Employee_Name: 'Alice' },
            definition: { fieldTitle: 'Summary', fieldType: 'textarea' },
            next: { fieldValue: 'Short summary' },
            previous: null,
            viaAi: true,
        });
        expect(entry.message).toContain('with AI');
        expect(entry.message).toContain('Short summary');
    });
});

describe('the HTTP handlers', () => {
    const respond = () => {
        const res = {};
        res.status = jest.fn(() => res);
        res.json = jest.fn(() => res);
        res.send = jest.fn(() => res);
        return res;
    };
    const lastBody = (res) => (res.json.mock.calls.length ? res.json.mock.calls[res.json.mock.calls.length - 1][0] : undefined);

    it('takes the company from the header the session may use', async () => {
        const field = seedField();
        const task = seedTask();
        modelAnswers('Summary');
        const res = respond();
        await controller.preview({ headers: { companyid: COMPANY }, aud: COMPANY, uid: ALICE, params: { fieldId: String(field._id) }, body: { taskIds: [String(task._id)], companyId: OTHER_COMPANY } }, res);
        expect(lastBody(res)).toEqual(expect.objectContaining({ status: true, data: { proposals: [expect.objectContaining({ text: 'Summary' })] } }));

        const refused = respond();
        await controller.preview({ headers: { companyid: OTHER_COMPANY }, aud: COMPANY, uid: ALICE, params: { fieldId: String(field._id) }, body: { taskIds: [String(task._id)] } }, refused);
        expect(refused.status).toHaveBeenCalledWith(403);
    });

    it('refuses an empty or oversized preview', async () => {
        const field = seedField();
        const res = respond();
        await controller.preview({ headers: { companyid: COMPANY }, aud: COMPANY, uid: ALICE, params: { fieldId: String(field._id) }, body: { taskIds: [] } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });
});
