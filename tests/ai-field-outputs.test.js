/* Task 045 slice 15: an AI field can also fill a number, a rating, labels from its options or a date. The model is
   told the exact format, and its answer is checked on the server: an answer that does not fit is never stored,
   while the call it cost is still booked. */
const { create } = require('./fixtures/fakeMongo');

const COMPANY = '6a9954186dd786246031e47b';
const PROJECT = '6a9954186dd786246031e481';
const ALICE = '6f0000000000000000000d01';

const mockDbs = {};
const mockDbFor = (companyId) => {
    const key = String(companyId);
    if (!mockDbs[key]) mockDbs[key] = create();
    return mockDbs[key];
};
const mockChat = jest.fn();
const mockUpdateTaskCustomField = jest.fn();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, ...rest) => mockDbFor(companyId).crud(companyId, ...rest),
}));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/projectAccess', () => ({
    canReadProject: jest.fn(async () => ({ allowed: true })),
    requireProjectAccess: () => (req, res, next) => next(),
}));
jest.mock('../Modules/Agents/scope', () => ({
    visibleProjectIds: jest.fn(async () => ['6a9954186dd786246031e481']),
}));
jest.mock('../Modules/Tasks/helpers/taskListProjects', () => require('./fixtures/taskListRules').taskListHeldEverywhere());
jest.mock('../Modules/Tasks/helpers/taskReadAccess', () => require('./fixtures/taskReadByProject').taskReadByProject());
jest.mock('../Config/permissionGuard', () => {
    const actual = jest.requireActual('../Config/permissionGuard');
    return { ...actual, evaluatePermission: jest.fn(async () => true) };
});
jest.mock('../Modules/AICore/llmProvider', () => ({
    isAnyProviderConfigured: () => true,
    getProvider: () => ({ chat: (...args) => mockChat(...args) }),
}));
jest.mock('../Modules/Agents/budget', () => ({ check: async () => ({ ok: true, reason: '' }) }));
jest.mock('../Modules/Tasks/helpers/task_class_Mongo', () => ({
    taskMongo: { updateTaskCustomField: (...args) => mockUpdateTaskCustomField(...args) },
}));

const mongoose = require('mongoose');
const socketEmitter = require('../event/socketEventEmitter');
const { dbCollections } = require('../Config/collections');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { schema } = require('../utils/mongo-handler/schema');
const config = require('../Modules/CustomField/aiFields/config');
const fill = require('../Modules/CustomField/aiFields/fill');
const jobs = require('../Modules/CustomField/aiFields/jobs');
const autoRefill = require('../Modules/CustomField/aiFields/autoRefill');

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const db = () => mockDbFor(COMPANY);

const OPTIONS = [
    { id: 'opt01', label: 'Backend', value: 'backend', color: '#34495E' },
    { id: 'opt02', label: 'Design', value: 'design', color: '#34495E' },
    { id: 'opt03', label: 'Docs', value: 'docs', color: '#34495E' },
];

const AI = { enabled: true, template: 'custom', prompt: 'Fill it in.', reads: ['title', 'description'], autoRefill: false, language: '' };

const seedField = (fieldType, fieldAi = {}, overrides = {}) => db().seed(SCHEMA_TYPE.CUSTOM_FIELDS, {
    fieldTitle: 'Field', fieldType, type: 'task', isDelete: true, global: true, projectId: [],
    fieldAi: { ...AI, ...fieldAi }, ...overrides,
});

const seedTask = (overrides = {}) => db().seed(SCHEMA_TYPE.TASKS, {
    TaskName: 'Ship the login page', description: 'Build the form and wire the SSO button.',
    ProjectID: oid(PROJECT), CompanyId: COMPANY, deletedStatusKey: 0, customField: {}, ...overrides,
});

const bookSpend = (opts) => {
    const spend = (opts && opts.spend) || {};
    mockDbFor(spend.companyId).seed(SCHEMA_TYPE.AI_USAGE, { companyId: spend.companyId, feature: spend.feature, userId: spend.userId, at: new Date() });
};

const modelSays = (...contents) => {
    let next = 0;
    mockChat.mockImplementation(async (opts) => {
        bookSpend(opts);
        const content = contents[Math.min(next, contents.length - 1)];
        next += 1;
        return { content, usage: { prompt_tokens: 10, completion_tokens: 5 } };
    });
};

const modelAnswers = (...values) => modelSays(...values.map((value) => JSON.stringify({ value })));

const spendRows = () => (db().store[SCHEMA_TYPE.AI_USAGE] || []).length;
const storedTask = (id) => (db().store[SCHEMA_TYPE.TASKS] || []).find((row) => String(row._id) === String(id));
const systemSent = (index = 0) => mockChat.mock.calls[index][0].systemPrompt;
const promptSent = (index = 0) => `${systemSent(index)}\n${mockChat.mock.calls[index][0].messages.map((m) => m.content).join('\n')}`;

const previewOne = async (field, task) => {
    const { proposals } = await fill.proposeFills({ companyId: COMPANY, uid: ALICE, fieldId: String(field._id), taskIds: [String(task._id)] });
    return proposals[0];
};

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => delete mockDbs[key]);
    jest.clearAllMocks();
    mockUpdateTaskCustomField.mockImplementation(async ({ companyId, taskId, customFieldId, updateDetail }) => {
        await mockDbFor(companyId).crud(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [{ _id: oid(taskId) }, { $set: { [`customField.${customFieldId}`]: updateDetail } }],
        }, 'updateOne');
        return { status: true };
    });
    require('../Config/config').myCache.flushAll();
    delete process.env.AI_ENABLED;
    autoRefill.stop();
});

describe('the output an AI field is set up with', () => {
    it('is text or one option by default, so existing fields keep working', () => {
        expect(config.normaliseAiConfig({ template: 'summary' }, 'textarea').output).toBe('text');
        expect(config.normaliseAiConfig({ template: 'category' }, 'dropdown').output).toBe('option');
    });

    it('takes a number with its range, decimals and what to do outside the range', () => {
        expect(config.normaliseAiConfig({ template: 'custom', prompt: 'Hours', min: '1', max: 40, decimals: 1, outOfRange: 'reject', extra: true }, 'number')).toEqual({
            enabled: true, template: 'custom', output: 'number', language: '', prompt: 'Hours', reads: ['title', 'description'], autoRefill: false,
            min: 1, max: 40, decimals: 1, outOfRange: 'reject',
        });
        expect(config.normaliseAiConfig({ template: 'custom', prompt: 'Hours' }, 'number')).toEqual(expect.objectContaining({
            min: null, max: null, decimals: null, outOfRange: 'clamp',
        }));
    });

    it('refuses a range that makes no sense', () => {
        expect(() => config.normaliseAiConfig({ template: 'custom', prompt: 'x', min: 10, max: 2 }, 'number')).toThrow(config.AiConfigError);
        expect(() => config.normaliseAiConfig({ template: 'custom', prompt: 'x', min: 'ten' }, 'number')).toThrow(config.AiConfigError);
        expect(() => config.normaliseAiConfig({ template: 'custom', prompt: 'x', decimals: 9 }, 'number')).toThrow(config.AiConfigError);
        expect(() => config.normaliseAiConfig({ template: 'custom', prompt: 'x', decimals: 1.5 }, 'number')).toThrow(config.AiConfigError);
        expect(() => config.normaliseAiConfig({ template: 'custom', prompt: 'x', outOfRange: 'ignore' }, 'number')).toThrow(config.AiConfigError);
    });

    it('offers a rating on a number field, labels on a dropdown and a date rule on a date', () => {
        expect(config.normaliseAiConfig({ output: 'rating', template: 'custom', prompt: 'How risky?' }, 'number')).toEqual(expect.objectContaining({ output: 'rating' }));
        expect(config.normaliseAiConfig({ output: 'labels', template: 'labels' }, 'dropdown')).toEqual(expect.objectContaining({ output: 'labels', template: 'labels' }));
        expect(config.normaliseAiConfig({ template: 'custom', prompt: 'When?', dateRule: 'after_start' }, 'date')).toEqual(expect.objectContaining({ output: 'date', dateRule: 'after_start' }));
        expect(config.normaliseAiConfig({ template: 'custom', prompt: 'When?' }, 'date').dateRule).toBe('');
    });

    it('refuses an output the field type cannot hold, and a template the output cannot use', () => {
        expect(() => config.normaliseAiConfig({ output: 'labels', template: 'custom', prompt: 'x' }, 'number')).toThrow(config.AiConfigError);
        expect(() => config.normaliseAiConfig({ output: 'rating', template: 'custom', prompt: 'x' }, 'textarea')).toThrow(config.AiConfigError);
        expect(() => config.normaliseAiConfig({ output: 'labels', template: 'category' }, 'dropdown')).toThrow(config.AiConfigError);
        expect(() => config.normaliseAiConfig({ template: 'summary' }, 'date')).toThrow(config.AiConfigError);
        expect(() => config.normaliseAiConfig({ template: 'custom', prompt: 'x', dateRule: 'someday' }, 'date')).toThrow(config.AiConfigError);
        expect(() => config.normaliseAiConfig({ template: 'custom', prompt: 'x' }, 'checkbox')).toThrow(config.AiConfigError);
    });

    it('is declared on the stored field definition', () => {
        const CustomField = mongoose.model('CustomFieldAiOutputsCheck', new mongoose.Schema(schema.customFields, { strict: true }));
        const saved = new CustomField({
            fieldTitle: 'Hours', fieldType: 'number', type: 'task',
            fieldAi: { enabled: true, template: 'custom', output: 'number', prompt: 'Hours', reads: ['title'], autoRefill: false, language: '', min: 0, max: 40, decimals: 1, outOfRange: 'reject', dateRule: '' },
        }).toObject();
        expect(saved.fieldAi).toEqual(expect.objectContaining({ output: 'number', min: 0, max: 40, decimals: 1, outOfRange: 'reject', dateRule: '', reads: ['title'] }));
        expect(new CustomField({ fieldTitle: 'Notes', fieldType: 'text', type: 'task' }).toObject().fieldAi).toBeUndefined();
    });
});

describe('a number output', () => {
    it('tells the model the format and range, and stores the rounded number', async () => {
        const field = seedField('number', { min: 0, max: 100, decimals: 1 });
        const task = seedTask();
        modelAnswers(12.345);

        const proposal = await previewOne(field, task);
        expect(proposal).toEqual(expect.objectContaining({ fieldValue: '12.3', text: '12.3', empty: false }));
        expect(systemSent()).toMatch(/single number/);
        expect(systemSent()).toContain('between 0 and 100');
        expect(systemSent()).toContain('at most 1 decimal place');

        await fill.applyProposals({ companyId: COMPANY, uid: ALICE, fieldId: String(field._id), proposalIds: [proposal.proposalId] });
        expect(storedTask(task._id).customField[String(field._id)].fieldValue).toBe('12.3');
    });

    it('reads a number written as text, with thousands separators', async () => {
        const field = seedField('number', { decimals: 0 });
        modelAnswers('1,200');
        expect(await previewOne(field, seedTask())).toEqual(expect.objectContaining({ fieldValue: '1200', empty: false }));
    });

    it('clamps an answer outside the range when the field says so', async () => {
        const field = seedField('number', { min: 0, max: 100, outOfRange: 'clamp' });
        modelAnswers(250);
        expect(await previewOne(field, seedTask())).toEqual(expect.objectContaining({ fieldValue: '100', empty: false }));
    });

    it('rejects an answer outside the range when the field says so, and still books the call', async () => {
        const field = seedField('number', { min: 0, max: 100, outOfRange: 'reject' });
        modelAnswers(250);
        const proposal = await previewOne(field, seedTask());
        expect(proposal).toEqual(expect.objectContaining({ proposalId: null, empty: true, invalid: true, reason: 'out_of_range' }));
        expect(spendRows()).toBe(1);
        expect(mockUpdateTaskCustomField).not.toHaveBeenCalled();
    });

    it.each([
        ['words', JSON.stringify({ value: 'about ten' })],
        ['a boolean', JSON.stringify({ value: true })],
        ['an object', JSON.stringify({ value: { hours: 3 } })],
        ['a list', JSON.stringify({ value: [1, 2] })],
        ['a number with a unit', JSON.stringify({ value: '3 hours' })],
        ['no JSON at all', 'I think it is 5'],
        ['JSON without a value', JSON.stringify({ answer: 5 })],
    ])('never stores %s', async (_label, content) => {
        const field = seedField('number');
        modelSays(content);
        const proposal = await previewOne(field, seedTask());
        expect(proposal).toEqual(expect.objectContaining({ proposalId: null, empty: true, invalid: true, reason: 'invalid' }));
        expect(spendRows()).toBe(1);
    });

    it('leaves the field empty, without calling it a failure, when the model has no number', async () => {
        const field = seedField('number');
        modelAnswers(null);
        const proposal = await previewOne(field, seedTask());
        expect(proposal).toEqual(expect.objectContaining({ proposalId: null, empty: true, reason: 'no_answer' }));
        expect(proposal.invalid).toBeFalsy();
    });
});

describe('a rating output', () => {
    it('asks for a whole number from 1 to 5 and stores it', async () => {
        const field = seedField('number', { output: 'rating' });
        modelAnswers(4);
        expect(await previewOne(field, seedTask())).toEqual(expect.objectContaining({ fieldValue: '4', text: '4', empty: false }));
        expect(systemSent()).toContain('whole number from 1 to 5');
    });

    it('rounds a fractional rating', async () => {
        const field = seedField('number', { output: 'rating' });
        modelAnswers('3.6');
        expect(await previewOne(field, seedTask())).toEqual(expect.objectContaining({ fieldValue: '4' }));
    });

    it.each([[0, 'out_of_range'], [6, 'out_of_range'], ['five', 'invalid'], [[4], 'invalid']])('never stores %p', async (value, reason) => {
        const field = seedField('number', { output: 'rating' });
        modelAnswers(value);
        expect(await previewOne(field, seedTask())).toEqual(expect.objectContaining({ proposalId: null, invalid: true, reason }));
    });
});

describe('a rating output on a rating field', () => {
    const ratingField = (max) => seedField('rating', { output: 'rating' }, { fieldRatingMax: max });

    it('asks for a whole number up to the field\'s own maximum and proposes the number itself', async () => {
        const field = ratingField(10);
        modelAnswers(8);
        expect(await previewOne(field, seedTask())).toEqual(expect.objectContaining({ fieldValue: 8, text: '8', empty: false }));
        expect(systemSent()).toContain('whole number from 1 to 10');
    });

    it('never stores a rating above the field\'s maximum', async () => {
        const field = ratingField(5);
        modelAnswers(6);
        expect(await previewOne(field, seedTask())).toEqual(expect.objectContaining({ proposalId: null, invalid: true, reason: 'out_of_range' }));
    });

    it('is what a new AI rating field is saved as, with its maximum checked', () => {
        const { fieldInsertFrom, FieldWriteError } = require('../Modules/CustomField/helpers/fieldWrite');
        const fieldAi = { enabled: true, output: 'rating', template: 'custom', prompt: 'How risky is this?' };
        const saved = fieldInsertFrom({ fieldTitle: 'Risk', fieldType: 'rating', fieldRatingMax: 7, fieldAi });
        expect(saved).toMatchObject({ fieldType: 'rating', fieldRatingMax: 7, fieldAi: { enabled: true, output: 'rating' } });
        expect(() => fieldInsertFrom({ fieldTitle: 'Risk', fieldType: 'rating', fieldRatingMax: 20, fieldAi })).toThrow(FieldWriteError);
    });

    it('leaves a rating output stored on a number field working as it did', async () => {
        const field = seedField('number', { output: 'rating' });
        modelAnswers(5);
        expect(await previewOne(field, seedTask())).toEqual(expect.objectContaining({ fieldValue: '5', text: '5' }));
        expect(config.aiConfigOf(field)).toEqual(expect.objectContaining({ output: 'rating' }));
    });
});

describe('a labels output', () => {
    const labelsField = () => seedField('dropdown', { output: 'labels', template: 'labels', prompt: '' }, { fieldOptions: OPTIONS });

    it('lists the options, asks for every one that applies, and keeps only real options', async () => {
        const field = labelsField();
        modelAnswers(['backend', 'Marketing', 'Design', 'Backend']);
        const proposal = await previewOne(field, seedTask());
        expect(proposal).toEqual(expect.objectContaining({ fieldValue: ['opt01', 'opt02'], text: 'Backend, Design', empty: false }));
        expect(promptSent()).toContain('"Docs"');
        expect(systemSent()).toMatch(/every option that applies/);
    });

    it('takes a single label given as text', async () => {
        const field = labelsField();
        modelAnswers('Docs');
        expect(await previewOne(field, seedTask())).toEqual(expect.objectContaining({ fieldValue: ['opt03'] }));
    });

    it('stays empty when no answer is one of the options', async () => {
        const field = labelsField();
        modelAnswers(['Marketing']);
        const proposal = await previewOne(field, seedTask());
        expect(proposal).toEqual(expect.objectContaining({ fieldValue: [], empty: true, reason: 'no_fit', proposalId: null }));
    });

    it.each([42, { label: 'Backend' }, true])('never stores %p', async (value) => {
        const field = labelsField();
        modelAnswers(value);
        expect(await previewOne(field, seedTask())).toEqual(expect.objectContaining({ proposalId: null, invalid: true, reason: 'invalid' }));
    });
});

describe('a date output', () => {
    const seedZone = (Time_Zone) => mockDbFor(dbCollections.GLOBAL).seed(SCHEMA_TYPE.USERS, { _id: ALICE, Time_Zone });

    it('asks for YYYY-MM-DD and stores the start of that day in the time zone of the person filling', async () => {
        seedZone('Asia/Kolkata');
        const field = seedField('date');
        modelAnswers('2026-10-05');
        const proposal = await previewOne(field, seedTask());
        expect(proposal).toEqual(expect.objectContaining({ fieldValue: '2026-10-04T18:30:00.000Z', text: '2026-10-05', empty: false }));
        expect(systemSent()).toContain('YYYY-MM-DD');
        expect(promptSent()).toMatch(/Today: \d{4}-\d{2}-\d{2}/);
    });

    it('uses UTC when the person has no time zone', async () => {
        const field = seedField('date');
        modelAnswers('2026-10-05T15:00:00');
        expect(await previewOne(field, seedTask())).toEqual(expect.objectContaining({ fieldValue: '2026-10-05T00:00:00.000Z', text: '2026-10-05' }));
    });

    it.each(['next Friday', '2026-02-30', '05/10/2026', 20261005])('never stores %p', async (value) => {
        const field = seedField('date');
        modelAnswers(value);
        expect(await previewOne(field, seedTask())).toEqual(expect.objectContaining({ proposalId: null, invalid: true, reason: 'invalid' }));
    });

    it('holds a date to the task start date when the field says so', async () => {
        const field = seedField('date', { dateRule: 'after_start' });
        const task = seedTask({ startDate: new Date('2026-10-10T09:00:00.000Z') });
        modelAnswers('2026-10-05', '2026-10-12');

        expect(await previewOne(field, task)).toEqual(expect.objectContaining({ proposalId: null, invalid: true, reason: 'date_rule' }));
        expect(promptSent()).toContain('2026-10-10');
        expect(await previewOne(field, task)).toEqual(expect.objectContaining({ fieldValue: '2026-10-12T00:00:00.000Z', empty: false }));
    });

    it('accepts any date under the start-date rule when the task has no start date', async () => {
        const field = seedField('date', { dateRule: 'after_start' });
        modelAnswers('2020-01-01');
        expect(await previewOne(field, seedTask())).toEqual(expect.objectContaining({ empty: false, fieldValue: '2020-01-01T00:00:00.000Z' }));
    });

    it('refuses a past date under the not-past rule', async () => {
        const field = seedField('date', { dateRule: 'not_past' });
        modelAnswers('2001-01-01');
        expect(await previewOne(field, seedTask())).toEqual(expect.objectContaining({ invalid: true, reason: 'date_rule' }));
    });
});

describe('an answer that does not fit, outside a preview', () => {
    it('is not stored by a bulk fill: the task is marked as not filled, the job counts it, and the call is booked', async () => {
        const field = seedField('number', { output: 'rating' });
        const good = seedTask({ TaskName: 'Good' });
        const bad = seedTask({ TaskName: 'Bad' });
        modelAnswers(3, 'terrible');
        const updates = [];
        const listen = (payload) => updates.push(payload);
        socketEmitter.on('task:update', listen);

        const { job, done } = await jobs.startJob({ companyId: COMPANY, uid: ALICE, fieldId: String(field._id), taskIds: [String(good._id), String(bad._id)] });
        await done;
        socketEmitter.off('task:update', listen);

        const read = await jobs.readJob({ companyId: COMPANY, uid: ALICE, jobId: String(job._id) });
        expect(read).toEqual(expect.objectContaining({ status: 'done', processed: 2, filled: 1, failed: 1 }));
        expect(storedTask(good._id).customField[String(field._id)].fieldValue).toBe('3');
        expect(storedTask(bad._id).customField[String(field._id)]).toBeUndefined();
        expect(storedTask(bad._id).aiFieldFills[String(field._id)].failed).toEqual(expect.objectContaining({ reason: 'invalid', trigger: 'bulk' }));
        expect(storedTask(bad._id).aiFieldFills[String(field._id)].failed.at).toBeInstanceOf(Date);
        expect(updates.some((payload) => String(payload.data && payload.data._id) === String(bad._id))).toBe(true);
        expect(spendRows()).toBe(2);
    });

    it('is cleared by the next fill that fits', async () => {
        const field = seedField('number', { output: 'rating' });
        const task = seedTask();
        modelAnswers('terrible', 5);
        await fill.fillTask({ companyId: COMPANY, uid: ALICE, definition: { ...field, _id: String(field._id) }, config: config.aiConfigOf(field), taskId: String(task._id), trigger: 'bulk' });
        expect(storedTask(task._id).aiFieldFills[String(field._id)].failed).toBeTruthy();

        await fill.fillTask({ companyId: COMPANY, uid: ALICE, definition: { ...field, _id: String(field._id) }, config: config.aiConfigOf(field), taskId: String(task._id), trigger: 'bulk' });
        expect(storedTask(task._id).aiFieldFills[String(field._id)].failed).toBeUndefined();
        expect(storedTask(task._id).customField[String(field._id)].fieldValue).toBe('5');
    });

    it('keeps the old value when an auto-refill answer does not fit', async () => {
        autoRefill.start({ debounceMs: 0 });
        const field = seedField('number', { output: 'rating', autoRefill: true, reads: ['title'] });
        const task = seedTask();
        modelAnswers(2);
        const proposal = await previewOne(field, task);
        await fill.applyProposals({ companyId: COMPANY, uid: ALICE, fieldId: String(field._id), proposalIds: [proposal.proposalId] });
        modelAnswers(11);

        await db().crud(COMPANY, { type: SCHEMA_TYPE.TASKS, data: [{ _id: task._id }, { $set: { TaskName: 'Ship the signup page' } }] }, 'updateOne');
        socketEmitter.emit('update', { type: 'update', module: 'task', data: storedTask(task._id), updatedFields: { TaskName: 'Ship the signup page' } });
        await autoRefill.flush();

        expect(storedTask(task._id).customField[String(field._id)].fieldValue).toBe('2');
        expect(storedTask(task._id).aiFieldFills[String(field._id)]).toEqual(expect.objectContaining({ by: ALICE, failed: expect.objectContaining({ reason: 'out_of_range', trigger: 'auto' }) }));
    });
});
