import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import en from '@/locales/en';
import { TYPES, TASK_PROPERTIES, menu } from '../../../Modules/Forms/helpers/questionTypes';

const { apiRequest, toast } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/views/Projects/FormsView/FormSubmissions.vue', () => ({ default: { render: () => null } }));
vi.mock('vuedraggable', async () => {
    const { h } = await import('vue');
    return {
        default: {
            props: ['modelValue'],
            setup: (props, { slots }) => () => h('div', props.modelValue.map((element, index) => slots.item({ element, index }))),
        },
    };
});

import FormBuilder from '@/views/Projects/FormsView/FormBuilder.vue';
import FormField from '@/views/Projects/FormsView/FormField.vue';
import { ruleState, summarize, withSources } from '@/views/Projects/FormsView/formLogicBuilder';

const [i18n] = config.global.plugins;
const t = (...args) => i18n.global.t(...args);

beforeAll(() => i18n.global.setLocaleMessage('en', en));
afterAll(() => i18n.global.setLocaleMessage('en', {}));

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((value) => ({ id: value, label: value }));
const KINDS = [{ id: 'o1', label: 'Bug' }, { id: 'o2', label: 'Feature' }];
const AREAS = [{ id: 'o1', label: 'Billing' }, { id: 'o2', label: 'Login' }, { id: 'o3', label: 'Reports' }];
const TASK_FIELDS = Object.keys(TASK_PROPERTIES).map((key) => ({ key, ...TASK_PROPERTIES[key] }));

const when = (question, op, value) => ({ all: [value === undefined ? { question, op } : { question, op, value }] });

const SOURCES = [
    { id: 'qco', type: 'short_text', label: 'Company' },
    { id: 'qseats', type: 'number', label: 'Seats' },
    { id: 'qdate', type: 'date', label: 'Needed by' },
    { id: 'qkind', type: 'dropdown', label: 'Kind', options: KINDS },
    { id: 'qareas', type: 'labels', label: 'Areas', options: AREAS },
    { id: 'qsev', type: 'dropdown', mapTo: 'Task_Priority', label: 'Priority', options: PRIORITIES },
    { id: 'target', type: 'short_text', label: 'Target' },
];
const says = (rule) => summarize(rule, SOURCES, t);
const stateOf = (rule, sources = SOURCES, index = sources.findIndex((q) => q.id === 'target')) => ruleState({ ...sources[index], showWhen: rule }, index, sources);

describe('a rule in plain words', () => {
    it.each([
        [when('qsev', 'equals', 'HIGH'), 'Shown when Priority is HIGH'],
        [when('qkind', 'not_equals', 'o1'), 'Shown when Kind is not Bug'],
        [when('qkind', 'one_of', ['o1', 'o2']), 'Shown when Kind is one of Bug, Feature'],
        [when('qco', 'contains', 'acme'), 'Shown when Company contains acme'],
        [when('qco', 'is_empty'), 'Shown when Company is empty'],
        [when('qco', 'is_not_empty'), 'Shown when Company is answered'],
        [when('qseats', 'greater_than', 3), 'Shown when Seats is more than 3'],
        [when('qseats', 'less_than', 3), 'Shown when Seats is less than 3'],
        [when('qdate', 'greater_than', '2026-10-01'), 'Shown when Needed by is after 2026-10-01'],
        [when('qdate', 'less_than', '2026-10-01'), 'Shown when Needed by is before 2026-10-01'],
        [when('qareas', 'contains', 'o2'), 'Shown when Areas includes Login'],
        [when('qareas', 'one_of', ['o1', 'o3']), 'Shown when Areas includes any of Billing, Reports'],
    ])('%j reads "%s"', (rule, text) => {
        expect(says(rule)).toBe(text);
    });

    it('joins all-of with "and" and any-of with "or"', () => {
        const pair = [{ question: 'qkind', op: 'equals', value: 'o1' }, { question: 'qseats', op: 'greater_than', value: 3 }];

        expect(says({ all: pair })).toBe('Shown when Kind is Bug and Seats is more than 3');
        expect(says({ any: pair })).toBe('Shown when Kind is Bug or Seats is more than 3');
    });

    it('puts a group inside a group in brackets', () => {
        const rule = { all: [{ question: 'qco', op: 'is_not_empty' }, { any: [{ question: 'qseats', op: 'less_than', value: 0 }, { question: 'qdate', op: 'greater_than', value: '2026-01-01' }] }] };

        expect(says(rule)).toBe('Shown when Company is answered and (Seats is less than 0 or Needed by is after 2026-01-01)');
    });
});

describe('whether a rule can be saved', () => {
    const rule = when('qkind', 'equals', 'o1');
    const without = (id) => SOURCES.filter((q) => q.id !== id);
    const movedBelow = [...without('qkind'), SOURCES.find((q) => q.id === 'qkind')];

    it('sends a finished rule as it stands', () => {
        expect(stateOf(rule)).toEqual({ rule, stale: false, unfinished: false });
    });

    it.each([
        ['was deleted', without('qkind')],
        ['was moved below it', movedBelow],
        ['was hidden from the form', SOURCES.map((q) => (q.id === 'qkind' ? { ...q, hidden: true } : q))],
        ['lost the option it names', SOURCES.map((q) => (q.id === 'qkind' ? { ...q, options: [KINDS[1]] } : q))],
    ])('drops a rule whose question %s', (_label, sources) => {
        expect(stateOf(rule, sources)).toEqual({ rule: undefined, stale: true, unfinished: false });
    });

    it('leaves an unfinished condition out and keeps the finished ones', () => {
        const draft = { any: [{ question: 'qkind', op: 'equals', value: 'o1' }, { question: 'qco', op: 'contains', value: '' }, { question: '', op: '' }] };

        expect(stateOf(draft)).toEqual({ rule: { any: [{ question: 'qkind', op: 'equals', value: 'o1' }] }, stale: false, unfinished: true });
        expect(stateOf({ all: [{ question: '', op: '' }] })).toEqual({ rule: undefined, stale: false, unfinished: true });
        expect(stateOf(undefined)).toEqual({ rule: undefined, stale: false, unfinished: false });
    });

    it('reads a task field question the builder has not saved yet by the field it fills', () => {
        const unsaved = SOURCES.map((q) => (q.id === 'qsev' ? { id: 'qsev', type: '', mapTo: 'Task_Priority', label: 'Priority', options: [] } : q));
        const sources = withSources(unsaved, TASK_FIELDS);

        expect(sources.find((q) => q.id === 'qsev')).toMatchObject({ type: 'dropdown', options: PRIORITIES });
        expect(stateOf(when('qsev', 'equals', 'HIGH'), sources).rule).toEqual(when('qsev', 'equals', 'HIGH'));
        expect(stateOf(when('qsev', 'equals', 'HIGH'), unsaved).rule).toBeUndefined();
    });
});

const FORM = {
    _id: 'form-1',
    title: 'Intake',
    state: 'draft',
    settings: { createTask: true },
    questions: [
        { id: 'qname', type: 'short_text', mapTo: 'TaskName', label: 'Summary', required: true, order: 1, span: 12 },
        { id: 'qsev', type: 'dropdown', mapTo: 'Task_Priority', label: 'Priority', options: PRIORITIES, order: 2, span: 12 },
        { id: 'qkind', type: 'dropdown', mapTo: '', label: 'Kind', options: KINDS, order: 3, span: 12 },
        { id: 'qsteps', type: 'long_text', mapTo: '', label: 'Steps', showWhen: when('qkind', 'equals', 'o1'), order: 4, span: 12 },
        { id: 'qwho', type: 'short_text', mapTo: '', label: 'Who to call', showWhen: when('qsev', 'equals', 'HIGH'), order: 5, span: 12 },
        { id: 'qwhy', type: 'short_text', mapTo: '', label: 'Why now', showWhen: when('qsteps', 'is_not_empty'), order: 6, span: 12 },
    ],
};

const puts = () => apiRequest.mock.calls.filter(([method]) => method === 'put').map(([, , body]) => body);
const sentQuestion = (id) => puts().at(-1).questions.find((q) => q.id === id);

const mountBuilder = async () => {
    apiRequest.mockImplementation(async (method, url, body) => {
        if (url === '/api/v2/forms/fields') return { data: { status: true, data: { groups: menu(), widgets: TYPES, task: TASK_FIELDS } } };
        if (method === 'put') return { data: { status: true, data: { ...FORM, questions: body.questions } } };
        return { data: { status: true, data: [] } };
    });
    const wrapper = mount(FormBuilder, { props: { form: FORM, projectData: { _id: 'p1' } }, global: { stubs: { 'router-link': true } } });
    await flushPromises();
    return wrapper;
};

const peek = (wrapper, label) => wrapper.findAll('.fb__peek').find((node) => node.text().includes(label));
const openQuestion = async (wrapper, label) => { await peek(wrapper, label).trigger('click'); };
const save = async (wrapper) => {
    await wrapper.find('.fb__bar .ah-btn--secondary').trigger('click');
    await flushPromises();
};
const field = (wrapper, id) => wrapper.findAllComponents(FormField).find((node) => node.props('question').id === id);
const previewLabels = (wrapper) => wrapper.findAllComponents(FormField).map((node) => node.props('question').label);

describe('the form builder', () => {
    beforeEach(() => {
        apiRequest.mockReset();
        Object.values(toast).forEach((fn) => fn.mockReset());
    });

    it('says under a question when it is shown', async () => {
        const wrapper = await mountBuilder();

        expect(peek(wrapper, 'Steps').find('[data-test="form-logic-summary"]').text()).toBe('Shown when Kind is Bug');
        expect(peek(wrapper, 'Who to call').find('[data-test="form-logic-summary"]').text()).toBe('Shown when Priority is HIGH');
        expect(peek(wrapper, 'Kind').find('[data-test="form-logic-summary"]').exists()).toBe(false);
    });

    it('warns that a rule lost its question, and drops the rule on save with a notice', async () => {
        const wrapper = await mountBuilder();
        await openQuestion(wrapper, 'Kind');
        await wrapper.find('.fb__del').trigger('click');

        const steps = peek(wrapper, 'Steps');
        expect(steps.find('[data-test="form-logic-summary"]').exists()).toBe(false);
        expect(steps.find('[data-test="form-logic-stale"]').text()).toContain('It will be removed when you save.');

        await save(wrapper);

        expect(sentQuestion('qsteps')).not.toHaveProperty('showWhen');
        expect(sentQuestion('qwho').showWhen).toEqual(when('qsev', 'equals', 'HIGH'));
        expect(toast.warning).toHaveBeenCalledTimes(1);
        expect(toast.warning.mock.calls[0][0]).toBe('Rule removed from Steps: it referred to a question or option that is no longer above it.');
        expect(peek(wrapper, 'Steps').find('[data-test="form-logic-stale"]').exists()).toBe(false);
    });

    it('saves without a notice when every rule still holds', async () => {
        const wrapper = await mountBuilder();
        await openQuestion(wrapper, 'Kind');
        await wrapper.find('.fb__label-in').setValue('Type of request');

        await save(wrapper);

        expect(sentQuestion('qsteps').showWhen).toEqual(when('qkind', 'equals', 'o1'));
        expect(toast.warning).not.toHaveBeenCalled();
    });

    it('builds a rule from an earlier question, an operator its type offers and one of its options', async () => {
        const wrapper = await mountBuilder();
        await openQuestion(wrapper, 'Kind');

        await wrapper.find('[data-test="form-logic-add"]').trigger('click');
        const question = wrapper.find('[data-test="form-logic-question"]');
        expect(question.findAll('option').map((node) => node.text())).toEqual(['Pick a question', 'Summary', 'Priority']);
        await question.setValue('qsev');
        expect(wrapper.find('[data-test="form-logic-operator"]').findAll('option').map((node) => node.text())).toEqual(['is', 'is not', 'is one of', 'is empty', 'is answered']);
        expect(wrapper.find('[data-test="form-logic-unfinished"]').exists()).toBe(true);
        await wrapper.find('[data-test="form-logic-value"]').setValue('URGENT');
        expect(wrapper.find('[data-test="form-logic-unfinished"]').exists()).toBe(false);

        await save(wrapper);

        expect(sentQuestion('qkind').showWhen).toEqual(when('qsev', 'equals', 'URGENT'));
    });

    it('offers no rule on the question that names the task', async () => {
        const wrapper = await mountBuilder();
        await openQuestion(wrapper, 'Summary');

        expect(wrapper.find('[data-test="form-logic-add"]').exists()).toBe(false);
        expect(wrapper.find('.fb__card').text()).toContain('The question that names the task is always shown.');
    });

    it('runs the rules in the preview, announces new questions and forgets a hidden answer', async () => {
        const wrapper = await mountBuilder();
        await wrapper.findAll('.fb__tab')[1].trigger('click');

        expect(previewLabels(wrapper)).toEqual(['Summary', 'Priority', 'Kind']);
        const live = wrapper.find('[data-test="form-logic-live"]');
        expect(live.attributes('aria-live')).toBe('polite');
        expect(live.text()).toBe('');

        await field(wrapper, 'qkind').find('select').setValue('Bug');
        expect(previewLabels(wrapper)).toEqual(['Summary', 'Priority', 'Kind', 'Steps']);
        expect(live.text()).toBe('More questions appeared below.');

        await field(wrapper, 'qsteps').find('textarea').setValue('Open the page');
        expect(previewLabels(wrapper)).toEqual(['Summary', 'Priority', 'Kind', 'Steps', 'Why now']);
        await field(wrapper, 'qkind').find('select').setValue('Feature');
        expect(previewLabels(wrapper)).toEqual(['Summary', 'Priority', 'Kind']);
        expect(live.text()).toBe('');

        await field(wrapper, 'qkind').find('select').setValue('Bug');
        expect(previewLabels(wrapper)).toEqual(['Summary', 'Priority', 'Kind', 'Steps']);
        expect(field(wrapper, 'qsteps').find('textarea').element.value).toBe('');
    });
});
