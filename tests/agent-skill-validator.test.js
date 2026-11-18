jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));

const { validateSkill } = require('../Modules/Agents/skills/validateSkill');
const { SKILL_VERSION } = require('../Modules/Agents/skills/catalogues');

const good = (over = {}) => ({
    key: 'task.summary',
    name: 'Summariser',
    description: 'Posts a one-paragraph summary of the brief.',
    inputs: ['brief'],
    gather: [{ reader: 'task', params: { maxChars: 3000 } }, { reader: 'project.tasks', as: 'board', params: { limit: 20 } }],
    prompt: {
        partials: ['in_tool', 'data_not_instructions', 'json_only'],
        instructions: 'Summarise the brief in one paragraph.',
        template: 'TASK: {{TaskName}} ({{task.TaskKey}})\nBRIEF: {{input.brief}}\nBOARD: {{gather.board.list}}\n{{memory}}',
        output: '{"summary":"...","subtasks":[{"title":"...","why":"..."}]}',
    },
    emit: [
        { action: 'task.comment', label: 'Post the summary', params: { body: '{{answer.summary}}' } },
        { action: 'subtask.create', each: 'answer.subtasks', max: 5, params: { title: '{{item.title}}', description: '{{item.why}}' } },
    ],
    ...over,
});

const codesOf = (result) => result.errors.map((e) => `${e.field}:${e.code}`);

describe('validateSkill', () => {
    it('accepts a well-formed skill and normalises it', () => {
        const out = validateSkill(good());
        expect(out.ok).toBe(true);
        expect(out.errors).toEqual([]);
        expect(out.value.version).toBe(SKILL_VERSION);
        expect(out.value.enabled).toBe(true);
        expect(out.value.emits).toEqual(['task.comment', 'subtask.create']);
        expect(out.value.risk).toBe('low');
        expect(out.value.gather).toEqual([{ reader: 'task', as: 'task', params: { maxChars: 3000 } }, { reader: 'project.tasks', as: 'board', params: { limit: 20 } }]);
        expect(out.value.prompt.maxTokens).toBe(2500);
    });

    it('returns field-level errors with a field, a code and a message', () => {
        const out = validateSkill({});
        expect(out.ok).toBe(false);
        expect(out.value).toBeNull();
        out.errors.forEach((e) => { expect(typeof e.field).toBe('string'); expect(typeof e.code).toBe('string'); expect(typeof e.message).toBe('string'); });
        expect(codesOf(out)).toEqual(expect.arrayContaining(['key:required', 'name:required', 'prompt.template:required', 'prompt.output:required', 'emit:required']));
    });

    it('rejects a malformed key and an overlong name', () => {
        expect(codesOf(validateSkill(good({ key: 'Bad Key!' })))).toContain('key:invalid');
        expect(codesOf(validateSkill(good({ name: 'n'.repeat(81) })))).toContain('name:too_long');
    });

    it('rejects an unknown input, reader, partial and action', () => {
        expect(codesOf(validateSkill(good({ inputs: ['page_html'] })))).toContain('inputs[0]:unknown_input');
        expect(codesOf(validateSkill(good({ gather: [{ reader: 'pr_diff' }] })))).toContain('gather[0].reader:unknown_reader');
        expect(codesOf(validateSkill(good({ prompt: { ...good().prompt, partials: ['be_nice'] } })))).toContain('prompt.partials[0]:unknown_partial');
        expect(codesOf(validateSkill(good({ emit: [{ action: 'task.explode', params: {} }] })))).toContain('emit[0].action:unknown_action');
    });

    it('rejects a never-listed action as never_listed, not merely unknown', () => {
        const out = validateSkill(good({ emit: [{ action: 'task.delete', params: {} }] }));
        expect(out.errors).toContainEqual(expect.objectContaining({ field: 'emit[0].action', code: 'never_listed' }));
        expect(codesOf(validateSkill(good({ emit: [{ action: 'billing.refund', params: {} }] })))).toContain('emit[0].action:never_listed');
    });

    it('rejects a read action as an emit: only a write is a change', () => {
        expect(codesOf(validateSkill(good({ emit: [{ action: 'task.get', params: {} }] })))).toContain('emit[0].action:not_a_write');
    });

    it('rejects a template that reads an input the skill does not declare', () => {
        const out = validateSkill(good({ inputs: ['project_task'] }));
        expect(out.errors).toContainEqual(expect.objectContaining({ field: 'prompt.template', code: 'undeclared_input' }));
    });

    it('rejects a template that reads a gathered value no step provides, and unknown task fields', () => {
        expect(codesOf(validateSkill(good({ gather: [{ reader: 'task' }] })))).toContain('prompt.template:undeclared_reader');
        expect(codesOf(validateSkill(good({ prompt: { ...good().prompt, template: '{{secretField}} {{task.AssigneeUserId}}' } })))).toEqual(expect.arrayContaining(['prompt.template:unknown_placeholder']));
        expect(codesOf(validateSkill(good({ prompt: { ...good().prompt, template: '{{answer.summary}}' } })))).toContain('prompt.template:unknown_placeholder');
    });

    it('rejects an emit mapping that reads {{item}} without "each", or misses a required param', () => {
        expect(codesOf(validateSkill(good({ emit: [{ action: 'task.comment', params: { body: '{{item.text}}' } }] })))).toContain('emit[0].params.body:unknown_placeholder');
        expect(codesOf(validateSkill(good({ emit: [{ action: 'task.comment', params: {} }] })))).toContain('emit[0].params.body:required');
        expect(codesOf(validateSkill(good({ emit: [{ action: 'subtask.create', each: 'subtasks', params: { title: '{{item.title}}' } }] })))).toContain('emit[0].each:invalid');
        expect(codesOf(validateSkill(good({ emit: [{ action: 'subtask.create', each: 'answer.subtasks', max: 999, params: { title: '{{item.title}}' } }] })))).toContain('emit[0].max:invalid');
    });

    it('checks reader params against the catalogue', () => {
        expect(codesOf(validateSkill(good({ gather: [{ reader: 'task', params: { maxChars: 1 } }, { reader: 'project.tasks', as: 'board' }] })))).toContain('gather[0].params.maxChars:invalid_params');
        expect(codesOf(validateSkill(good({ gather: [{ reader: 'task', params: { where: 'x' } }, { reader: 'project.tasks', as: 'board' }] })))).toContain('gather[0].params.where:invalid_params');
        expect(codesOf(validateSkill(good({ gather: [{ reader: 'task' }, { reader: 'task', as: 'task' }, { reader: 'project.tasks', as: 'board' }] })))).toContain('gather:duplicate');
    });

    it('computes risk from the emitted actions and only lets the author raise it', () => {
        const medium = good({ emit: [{ action: 'task.create', params: { title: '{{answer.summary}}' } }], prompt: { ...good().prompt, template: '{{input.brief}} {{gather.board.list}}' } });
        expect(validateSkill(medium).value.risk).toBe('medium');
        expect(validateSkill({ ...medium, risk: 'low' }).value.risk).toBe('medium');
        expect(validateSkill({ ...medium, risk: 'high' }).value.risk).toBe('high');
        expect(codesOf(validateSkill({ ...medium, risk: 'scary' }))).toContain('risk:invalid');
    });

    it('rejects a non-boolean enabled and an out-of-range maxTokens', () => {
        expect(codesOf(validateSkill(good({ enabled: 'yes' })))).toContain('enabled:invalid');
        expect(codesOf(validateSkill(good({ prompt: { ...good().prompt, maxTokens: 99999 } })))).toContain('prompt.maxTokens:invalid');
        expect(validateSkill(good({ enabled: false, prompt: { ...good().prompt, maxTokens: 1000 } })).value).toMatchObject({ enabled: false, prompt: { maxTokens: 1000 } });
    });
});
