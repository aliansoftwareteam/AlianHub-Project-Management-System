import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
const echo = (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key);

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/components/organisms/TaskDetailOverlay/useTaskOverlay', () => ({ openTask: vi.fn() }));

import AutomationsPage from '@/views/Automations/AutomationsPage.vue';

const MANIFEST = {
    triggers: [
        { key: 'task.created', label: 'Task is created', entity: 'task', hasDiff: false },
        { key: 'task.subtasks_all_done', label: 'All subtasks of a task are done', entity: 'task', hasDiff: false },
    ],
    conditionFields: [],
    actions: [
        { key: 'set_status', label: 'Change status', schema: { status: { type: 'status_picker', label: 'Status', required: true } } },
        { key: 'add_comment', label: 'Add a comment', schema: { body: { type: 'textarea', label: 'Comment', required: true } } },
        { key: 'notify', label: 'Send a notification', schema: { recipients: { type: 'user_multi', label: 'Recipients', required: true }, message: { type: 'textarea', label: 'Message', required: true } } },
    ],
    operators: {},
};
const PROJECTS = [{ _id: 'p1', ProjectName: 'Web' }, { _id: 'p2', ProjectName: 'App' }];
const SAVED = {
    _id: 'r1', enabled: true, sentence: 'When all subtasks are done, comment', firedCount: 0, reactToAutomation: true,
    trigger: { type: 'event', event: 'task.subtasks_all_done' }, scope: { allProjects: true, projectIds: [] }, conditions: {},
    steps: [{ id: 's1', type: 'action', action: 'add_comment', config: { body: 'All done' } }],
};
const MISSING_STATUS = { step: 0, action: 'set_status', field: 'status', code: 'required', text: 'required by "set_status"' };
const RAW = 'steps[0].config.status: required by "set_status"';

const ok = (data) => Promise.resolve({ data: { status: true, data } });
let compileAnswer;
let saveAnswer;
let dryRunAnswer;

const open = async (props = {}) => {
    apiRequest.mockImplementation((method, url, body) => {
        if (url.endsWith('/registry')) return ok(MANIFEST);
        if (url.endsWith('/compile')) return compileAnswer(body);
        if (url.endsWith('/dry-run')) return dryRunAnswer(body);
        if (url.endsWith('/find')) return Promise.resolve({ data: [{ _id: 't1', TaskName: 'Launch', TaskKey: 'WEB-1' }] });
        if (url === '/api/v1/project') return ok(PROJECTS);
        if (url.endsWith('/automations') && method === 'get') return ok([SAVED]);
        if (method === 'post' || method === 'put') return saveAnswer(body);
        return ok([]);
    });
    const store = createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: 1 }) } } } });
    const wrapper = mount(AutomationsPage, { props, global: { plugins: [store], mocks: { $t: echo } } });
    await flushPromises();
    return wrapper;
};

const press = async (wrapper, label) => {
    await wrapper.findAll('button').find((b) => b.text().startsWith(label)).trigger('click');
    await flushPromises();
};
const startNew = (wrapper) => press(wrapper, 'Automations.new');
const editSaved = (wrapper) => press(wrapper, 'Automations.edit');
const compiles = () => apiRequest.mock.calls.filter(([, url]) => url.endsWith('/compile')).map(([, , body]) => body);
const saves = () => apiRequest.mock.calls.filter(([method, url]) => ['post', 'put'].includes(method) && /\/automations(\/r1)?$/.test(url)).map(([, , body]) => body);
const shownErrors = (wrapper) => (wrapper.find('.au__errors').exists() ? wrapper.find('.au__errors').text() : '');

beforeEach(() => {
    apiRequest.mockReset();
    compileAnswer = () => ok({ sentence: 'When a task is created, change status', errors: [RAW], issues: [MISSING_STATUS], parseErrors: [], ambiguities: [], grammar: {} });
    saveAnswer = () => Promise.resolve({ data: { status: false, statusText: RAW, errors: [RAW, 'name: required'], issues: [MISSING_STATUS] } });
    dryRunAnswer = () => ok({});
});

describe('a new automation starts in the project it was opened from', () => {
    it('scopes the rule to that project', async () => {
        const wrapper = await open({ openTemplates: true, templateProjectId: 'p2' });
        await startNew(wrapper);
        expect(wrapper.find('[data-test="scope-picker"]').element.value).toBe('p2');
        expect(compiles().at(-1).rule.scope).toEqual({ allProjects: false, projectIds: ['p2'] });
    });

    it('stays on any project when it was opened from the workspace, or from a project the person cannot see', async () => {
        const workspace = await open();
        await startNew(workspace);
        expect(workspace.find('[data-test="scope-picker"]').element.value).toBe('all');

        const gone = await open({ templateProjectId: 'p9' });
        await startNew(gone);
        expect(gone.find('[data-test="scope-picker"]').element.value).toBe('all');
        expect(compiles().at(-1).rule.scope).toEqual({ allProjects: true, projectIds: [] });
    });
});

describe('a sentence typed while the builder is still opening', () => {
    it('is kept and read, not replaced by the wording of the empty rule', async () => {
        const waiting = [];
        const typed = 'When a task is created, post a comment saying "Hi"';
        const read = { trigger: { event: 'task.created' }, steps: [{ id: 's1', type: 'action', action: 'add_comment', config: { body: 'Hi' } }], conditions: {}, scope: { allProjects: true, projectIds: [] } };
        compileAnswer = (body) => (body.sentence
            ? ok({ sentence: body.sentence, rule: read, errors: [], issues: [], parseErrors: [], ambiguities: [], grammar: {} })
            : new Promise((resolve) => { waiting.push(() => resolve({ data: { status: true, data: { sentence: 'When a task is created, set the status to .', errors: [], issues: [], parseErrors: [], ambiguities: [], grammar: {} } } })); }));
        const wrapper = await open();
        await startNew(wrapper);
        const sentence = wrapper.find('.au__sentence-input');
        await sentence.setValue(typed);
        waiting.splice(0).forEach((land) => land());
        await flushPromises();
        expect(sentence.element.value).toBe(typed);

        await sentence.trigger('keyup', { key: 'Enter' });
        await flushPromises();
        expect(compiles().at(-1).sentence).toBe(typed);
        expect(wrapper.findAll('.au__compiled select').some((select) => select.element.value === 'add_comment')).toBe(true);
    });

    it('finds the box the person is in still empty when that answer arrives, and filled once they change a part instead', async () => {
        const store = createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: 1 }) } } } });
        apiRequest.mockImplementation((method, url) => {
            if (url.endsWith('/registry')) return ok(MANIFEST);
            if (url.endsWith('/compile')) return ok({ sentence: 'When a task is created, set the status to .', errors: [], issues: [], parseErrors: [], ambiguities: [], grammar: {} });
            if (url === '/api/v1/project') return ok(PROJECTS);
            return ok([]);
        });
        const wrapper = mount(AutomationsPage, { attachTo: document.body, global: { plugins: [store], mocks: { $t: echo } } });
        await flushPromises();
        await startNew(wrapper);
        const sentence = wrapper.find('.au__sentence-input');
        expect(document.activeElement).toBe(sentence.element);
        expect(sentence.element.value).toBe('');

        const scope = wrapper.find('[data-test="scope-picker"]');
        scope.element.focus();
        await scope.setValue('p1');
        await flushPromises();
        expect(sentence.element.value).toBe('When a task is created, set the status to .');
        wrapper.unmount();
    });
});

describe('what a rule still lacks', () => {
    it('is not shown before the person has touched the field', async () => {
        const wrapper = await open();
        await startNew(wrapper);
        expect(wrapper.find('.au__errors').exists()).toBe(false);
        expect(wrapper.text()).not.toContain('steps[0]');
    });

    it('is shown in words, naming the step and the field, once the field has been touched', async () => {
        const wrapper = await open();
        await startNew(wrapper);
        const status = wrapper.find('[data-test="step-field-status"]');
        await status.setValue('');
        await status.trigger('change');
        await flushPromises();
        expect(shownErrors(wrapper)).toContain('Automations.issue_step_required {"n":1,"action":"Change status","field":"Status"}');
        expect(wrapper.text()).not.toContain('steps[0]');
        expect(wrapper.text()).not.toContain('required by');
    });

    it('is shown for every field after an attempt to save, and never as a path', async () => {
        const wrapper = await open();
        await startNew(wrapper);
        await press(wrapper, 'Parity.save_automation');
        expect(shownErrors(wrapper)).toContain('Automations.issue_step_required {"n":1,"action":"Change status","field":"Status"}');
        expect(wrapper.text()).not.toContain('steps[0]');
        expect(wrapper.text()).not.toContain('name: required');
    });

    it('is forgotten when the builder is opened again', async () => {
        const wrapper = await open();
        await startNew(wrapper);
        await press(wrapper, 'Parity.save_automation');
        await press(wrapper, 'Automations.cancel');
        await startNew(wrapper);
        expect(wrapper.find('.au__errors').exists()).toBe(false);
    });

    it('names an action in the reader\'s language and keeps an action\'s own reason in words', async () => {
        compileAnswer = () => ok({ sentence: 'x', errors: [], ambiguities: [], grammar: {}, parseErrors: [], issues: [
            { step: 1, action: 'notify', field: 'recipients', code: 'other', text: '"somebody" is not a person of this workspace' },
            { code: 'no_steps', text: 'at least one action is required' },
        ] });
        const wrapper = await open();
        await startNew(wrapper);
        await press(wrapper, 'Parity.save_automation');
        saveAnswer = () => Promise.resolve({ data: { status: false, statusText: 'x' } });
        const text = shownErrors(wrapper);
        expect(text).toContain('Automations.issue_step_required');
        await wrapper.find('[data-test="step-field-status"]').trigger('change');
        await flushPromises();
        const later = shownErrors(wrapper);
        expect(later).toContain('Automations.issue_step_other {"n":2,"action":"Automations.action_notify","field":"Automations.notify_recipients","reason":"\\"somebody\\" is not a person of this workspace"}');
        expect(later).toContain('Automations.issue_no_steps');
    });

    it('still shows what the sentence could not be read as, which the person typed', async () => {
        compileAnswer = (body) => (body.sentence
            ? ok({ sentence: body.sentence, rule: null, errors: ['Could not read "purple".'], parseErrors: ['Could not read "purple".'], issues: [], ambiguities: [], grammar: {} })
            : ok({ sentence: '', errors: [], issues: [], parseErrors: [], ambiguities: [], grammar: {} }));
        const wrapper = await open();
        await startNew(wrapper);
        const sentence = wrapper.find('.au__sentence-input');
        await sentence.setValue('purple');
        await sentence.trigger('blur');
        await flushPromises();
        expect(shownErrors(wrapper)).toContain('Could not read "purple".');
    });

    it('falls back to the server\'s sentences when it sends no parts', async () => {
        compileAnswer = () => ok({ sentence: 'x', errors: ['Something else is wrong.'], ambiguities: [], grammar: {} });
        const wrapper = await open();
        await startNew(wrapper);
        expect(shownErrors(wrapper)).toContain('Something else is wrong.');
    });
});

describe('the dry run headline states one outcome', () => {
    const PLAN = {
        matched: true, wouldRun: true, inScope: true,
        rule: { id: 'r1', name: 'Tell', enabled: true, trigger: 'task.subtasks_all_done' },
        task: { id: 't1', key: 'WEB-1', name: 'Launch', projectId: 'p1' },
        reasons: ['The rule has no conditions, so it runs on every such event.'],
        conditions: [],
        actions: [
            { id: 's1', type: 'action', action: 'notify', label: 'Send a notification', params: { message: 'Done' }, wouldRun: true, notify: { wouldNotify: [], skipped: [] } },
            { id: 's2', type: 'action', action: 'add_comment', label: 'Add a comment', params: { body: 'All done' }, wouldRun: true },
        ],
        trigger: { event: 'task.subtasks_all_done', wouldFire: true, reason: 'subtasks_done', open: 0, total: 2 },
        basis: 'Nothing was saved and no action ran.',
    };
    const NOT_NOW = {
        ...PLAN, wouldRun: false,
        actions: PLAN.actions.map((a) => ({ ...a, wouldRun: false })),
        trigger: { event: 'task.subtasks_all_done', wouldFire: false, reason: 'subtasks_open', open: 1, total: 1 },
    };

    const run = async (plan) => {
        dryRunAnswer = () => ok(plan);
        const wrapper = await open();
        await editSaved(wrapper);
        await wrapper.find('[data-test="dry-run-project"]').setValue('p1');
        await flushPromises();
        await wrapper.find('[data-test="dry-run-task"]').setValue('t1');
        await wrapper.find('[data-test="dry-run"]').trigger('click');
        await flushPromises();
        return wrapper.find('[data-test="dry-run-result"]');
    };

    it('says "would not run now" with the reason when the trigger does not apply, and never "would run" beside it', async () => {
        const result = await run(NOT_NOW);
        expect(result.find('[data-test="dry-run-verdict"]').text()).toBe('Automations.dry_run_not_now');
        expect(result.find('[data-test="dry-run-headline"]').text()).toContain('Automations.dry_run_trigger_subtasks_open {"open":1,"total":1}');
        expect(result.text()).not.toContain('Automations.dry_run_matched');
        expect(result.text()).not.toContain('Automations.dry_run_would_run');
        expect(result.findAll('[data-test="dry-run-trigger"]')).toHaveLength(0);
    });

    it('reads an older answer, which had no outcome of its own, the same way', async () => {
        const { wouldRun, ...older } = NOT_NOW;
        const result = await run({ ...older, actions: PLAN.actions });
        expect(wouldRun).toBe(false);
        expect(result.find('[data-test="dry-run-verdict"]').text()).toBe('Automations.dry_run_not_now');
        expect(result.text()).not.toContain('Automations.dry_run_would_run');
    });

    it('says "would run" with what it would do', async () => {
        const result = await run(PLAN);
        expect(result.find('[data-test="dry-run-verdict"]').text()).toBe('Automations.dry_run_matched');
        expect(result.find('[data-test="dry-run-headline"]').text()).toContain('Automations.dry_run_would_do {"actions":"Automations.action_notify, Add a comment"}');
        expect(result.find('[data-test="dry-run-trigger"]').text()).toContain('Automations.dry_run_trigger_subtasks_done');
    });

    it('says a rule that is switched off would run once it is on, not that it runs', async () => {
        const result = await run({ ...PLAN, rule: { ...PLAN.rule, enabled: false }, reasons: [...PLAN.reasons, 'The rule is switched off, so it will not run until it is switched on.'] });
        expect(result.find('[data-test="dry-run-verdict"]').text()).toBe('Automations.dry_run_matched_when_on');
    });

    it('numbers each step and names its action in words, not by its id', async () => {
        const result = await run(PLAN);
        const steps = result.findAll('[data-test="dry-run-action"]');
        expect(steps[0].find('[data-test="dry-run-step-name"]').text()).toBe('1. Automations.action_notify');
        expect(steps[1].find('[data-test="dry-run-step-name"]').text()).toBe('2. Add a comment');
        expect(result.text()).not.toMatch(/\bs1\b|\bs2\b/);
    });
});

describe('running on a change another automation or an agent made', () => {
    beforeEach(() => {
        compileAnswer = () => ok({ sentence: 'x', errors: [], issues: [], parseErrors: [], ambiguities: [], grammar: {} });
        saveAnswer = () => ok({});
    });

    it('is a checkbox that is off for a new automation and saved when ticked', async () => {
        const wrapper = await open();
        await startNew(wrapper);
        const box = wrapper.find('[data-test="react-to-automation"]');
        expect(box.element.checked).toBe(false);
        expect(wrapper.find('[data-test="react-to-automation-label"]').text()).toContain('Automations.react_to_automation');

        await press(wrapper, 'Parity.save_automation');
        expect(saves().at(-1).reactToAutomation).toBe(false);

        await startNew(wrapper);
        await wrapper.find('[data-test="react-to-automation"]').setValue(true);
        await press(wrapper, 'Parity.save_automation');
        expect(saves().at(-1).reactToAutomation).toBe(true);
    });

    it('shows what a saved rule holds and does not switch it off when the rule is saved again', async () => {
        const wrapper = await open();
        await editSaved(wrapper);
        expect(wrapper.find('[data-test="react-to-automation"]').element.checked).toBe(true);
        await press(wrapper, 'Parity.save_automation');
        expect(saves().at(-1).reactToAutomation).toBe(true);
    });

    it('keeps the choice when the sentence is compiled again, which knows nothing of it', async () => {
        compileAnswer = (body) => ok({ sentence: body.sentence || 'x', rule: body.sentence ? { trigger: { event: 'task.created' }, steps: [{ id: 's1', type: 'action', action: 'add_comment', config: { body: 'Hi' } }], conditions: {}, scope: { allProjects: true, projectIds: [] } } : undefined, errors: [], issues: [], parseErrors: [], ambiguities: [], grammar: {} });
        const wrapper = await open();
        await startNew(wrapper);
        await wrapper.find('[data-test="react-to-automation"]').setValue(true);
        const sentence = wrapper.find('.au__sentence-input');
        await sentence.setValue('when a task is created, comment "Hi"');
        await sentence.trigger('blur');
        await flushPromises();
        expect(wrapper.find('[data-test="react-to-automation"]').element.checked).toBe(true);
    });
});
