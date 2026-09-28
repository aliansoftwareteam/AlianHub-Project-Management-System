import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const ids = vi.hoisted(() => ({ next: 0 }));
const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ debounce: (fn) => fn, makeUniqueId: () => `u${++ids.next}` }),
}));
vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/components/organisms/TaskDetailOverlay/useTaskOverlay', () => ({ openTask: vi.fn() }));

import AssignActionEditor from '@/views/Automations/AssignActionEditor.vue';
import AutomationsPage from '@/views/Automations/AutomationsPage.vue';

const PRIYA = 'u-priya';
const SAM = 'u-sam';
const GONE = 'u-gone';
const echo = (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key);

const storeWith = (roleType = 1) => createStore({
    modules: {
        settings: {
            namespaced: true,
            getters: {
                companyUserDetail: () => ({ roleType }),
                companyUsers: () => [
                    { userId: PRIYA, isDelete: false, status: 2 },
                    { userId: SAM, isDelete: false, status: 2 },
                    { userId: GONE, isDelete: true, status: 2 },
                ],
            },
        },
        users: {
            namespaced: true,
            getters: {
                users: () => [
                    { _id: PRIYA, Employee_Name: 'Priya Shah' },
                    { _id: SAM, Employee_Name: 'Sam Lee' },
                    { _id: GONE, Employee_Name: 'Gone Person' },
                ],
            },
        },
    },
});

let wrapper;
const mountEditor = async (modelValue, trigger = 'task.created') => {
    wrapper = mount(AssignActionEditor, {
        props: { modelValue, trigger },
        attachTo: '#app',
        global: { plugins: [storeWith()], mocks: { $t: echo } },
    });
    await flushPromises();
    return wrapper;
};

const lastConfig = () => {
    const events = wrapper.emitted('update:modelValue') || [];
    return events.length ? events[events.length - 1][0] : null;
};
const peopleTrigger = () => document.querySelector('#app [aria-haspopup="listbox"]');
const openPeople = async () => {
    peopleTrigger().click();
    await flushPromises();
    return document.getElementById(peopleTrigger().getAttribute('aria-controls'));
};
const options = (list) => [...list.querySelectorAll('[role="option"]')];
const optionNamed = (list, text) => options(list).find((el) => el.textContent.includes(text));

beforeEach(() => {
    document.body.innerHTML = '<div id="my-dropdown"></div><div id="app"></div>';
});

afterEach(() => { wrapper?.unmount(); wrapper = null; });

describe('AssignActionEditor', () => {
    it('offers the four modes and reports the one picked', async () => {
        await mountEditor({ mode: 'add', userIds: [] });
        const select = wrapper.find('[data-test="assign-mode"]');
        expect(select.findAll('option').map((o) => o.attributes('value'))).toEqual(['add', 'replace', 'remove', 'clear']);
        expect(select.findAll('option').map((o) => o.text())).toEqual([
            'Automations.assign_mode_add', 'Automations.assign_mode_replace', 'Automations.assign_mode_remove', 'Automations.assign_mode_clear',
        ]);
        await select.setValue('replace');
        expect(lastConfig()).toMatchObject({ mode: 'replace' });
    });

    it('picks people from a keyboard-reachable listbox of active members and the task creator', async () => {
        await mountEditor({ mode: 'add', userIds: [] });
        expect(peopleTrigger()).not.toBeNull();
        const list = await openPeople();
        expect(list.getAttribute('role')).toBe('listbox');
        expect(list.getAttribute('aria-multiselectable')).toBe('true');
        const names = options(list).map((el) => el.textContent.trim());
        expect(names).toEqual(expect.arrayContaining(['Automations.assign_task_creator', 'Priya Shah', 'Sam Lee']));
        expect(names.join(' ')).not.toMatch(/Gone Person/);
        expect(names.join(' ')).not.toMatch(/assign_form_submitter/);
    });

    it('offers the form submitter only on a form trigger', async () => {
        await mountEditor({ mode: 'add', userIds: [] }, 'form.submitted');
        const list = await openPeople();
        expect(optionNamed(list, 'Automations.assign_form_submitter')).toBeDefined();
    });

    it('toggles a person in and out, marking the selection on the option', async () => {
        await mountEditor({ mode: 'add', userIds: [SAM] });
        const list = await openPeople();
        expect(optionNamed(list, 'Sam Lee').getAttribute('aria-selected')).toBe('true');
        optionNamed(list, 'Priya Shah').click();
        await flushPromises();
        expect(lastConfig().userIds).toEqual([SAM, PRIYA]);
        await wrapper.setProps({ modelValue: lastConfig() });
        optionNamed(list, 'Sam Lee').click();
        await flushPromises();
        expect(lastConfig().userIds).toEqual([PRIYA]);
    });

    it('narrows the list with its search field', async () => {
        await mountEditor({ mode: 'add', userIds: [] });
        const list = await openPeople();
        const search = document.querySelector('#my-dropdown [data-test="assign-search"]');
        search.value = 'pri';
        search.dispatchEvent(new Event('input'));
        await flushPromises();
        expect(options(list).map((el) => el.textContent.trim())).toEqual(['Priya Shah']);
    });

    it('offers taking turns only when adding or replacing with two or more people', async () => {
        await mountEditor({ mode: 'add', userIds: [PRIYA] });
        expect(wrapper.find('[data-test="assign-round-robin"]').exists()).toBe(false);
        await wrapper.setProps({ modelValue: { mode: 'add', userIds: [PRIYA, SAM] } });
        const box = wrapper.find('[data-test="assign-round-robin"]');
        expect(box.exists()).toBe(true);
        await box.setValue(true);
        expect(lastConfig()).toMatchObject({ roundRobin: true });
        await wrapper.setProps({ modelValue: { mode: 'remove', userIds: [PRIYA, SAM] } });
        expect(wrapper.find('[data-test="assign-round-robin"]').exists()).toBe(false);
    });

    it('asks for nobody when clearing', async () => {
        await mountEditor({ mode: 'clear', userIds: [] });
        expect(peopleTrigger()).toBeNull();
    });

    it('drops round robin and people that no longer apply when switching to clear', async () => {
        await mountEditor({ mode: 'add', userIds: [PRIYA, SAM], roundRobin: true });
        await wrapper.find('[data-test="assign-mode"]').setValue('clear');
        expect(lastConfig()).toEqual({ mode: 'clear', userIds: [] });
    });
});

const MANIFEST = {
    triggers: [{ key: 'task.created', label: 'Task is created', entity: 'task', hasDiff: false }],
    conditionFields: [],
    actions: [
        { key: 'add_comment', label: 'Add a comment', schema: { body: { type: 'textarea', label: 'Comment' } } },
        { key: 'assign', label: 'Assign to', schema: { mode: { type: 'select', label: 'Mode', options: ['add', 'replace', 'remove', 'clear'] }, userIds: { type: 'user_multi', label: 'People' }, roundRobin: { type: 'boolean', label: 'Take turns' } } },
    ],
    operators: {},
};
const RULE = {
    _id: 'r1', enabled: true, sentence: 'When a task is created, assign to Priya Shah.', firedCount: 0,
    trigger: { type: 'event', event: 'task.created' }, scope: { allProjects: true, projectIds: [] }, conditions: {},
    steps: [{ id: 's1', type: 'action', action: 'assign', config: { mode: 'add', userIds: [PRIYA] } }],
};
const PLAN = {
    matched: true, inScope: true, reasons: [], conditions: [], basis: 'Nothing was saved.',
    rule: { id: 'r1', name: 'Assign', enabled: true, trigger: 'task.created' },
    task: { id: 't1', key: 'WEB-7', name: 'Fix login', projectId: 'p1' },
    actions: [{
        id: 's1', type: 'action', action: 'assign', label: 'Assign to', wouldRun: true, params: { mode: 'add', userIds: [PRIYA, GONE] },
        assign: { mode: 'add', wouldAssign: [{ userId: PRIYA, name: 'Priya Shah' }], skipped: [{ userId: GONE, name: 'Gone Person', reason: 'not_a_member' }] },
    }],
};
const ok = (data) => Promise.resolve({ data: { status: true, data } });

const openPage = async () => {
    apiRequest.mockImplementation((method, url) => {
        if (url.endsWith('/registry')) return ok(MANIFEST);
        if (url.endsWith('/automations')) return ok([RULE]);
        if (url.endsWith('/compile')) return ok({ sentence: RULE.sentence, errors: [], ambiguities: [], grammar: {} });
        if (url.endsWith('/dry-run')) return ok(PLAN);
        if (url.endsWith('/backtest')) return ok({ windowDays: 30, matched: 4, sample: [], basis: 'b', assignments: [{ stepId: 's1', mode: 'add', roundRobin: true, people: [{ userId: PRIYA, name: 'Priya Shah' }, { userId: SAM, name: 'Sam Lee' }], skipped: [] }] });
        if (url.endsWith('/find')) return Promise.resolve({ data: [{ _id: 't1', TaskName: 'Fix login', TaskKey: 'WEB-7' }] });
        if (method === 'get') return ok([{ _id: 'p1', ProjectName: 'Web' }]);
        return ok([]);
    });
    wrapper = mount(AutomationsPage, { attachTo: '#app', global: { plugins: [storeWith()], mocks: { $t: echo } } });
    await flushPromises();
    return wrapper;
};

describe('AutomationsPage with an assign step', () => {
    beforeEach(() => apiRequest.mockReset());

    it('draws the assign editor in place of plain fields when the step assigns', async () => {
        await openPage();
        await wrapper.findAll('button').find((b) => b.text() === 'Automations.edit').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="assign-mode"]').exists()).toBe(true);
        expect(wrapper.findAll('input.au__slot--text').length).toBe(0);
    });

    it('sets sensible defaults when a step is switched to assign', async () => {
        await openPage();
        await wrapper.findAll('button').find((b) => b.text() === 'Automations.new').trigger('click');
        await flushPromises();
        const actionSelect = wrapper.findAll('select.au__slot').find((s) => s.findAll('option').some((o) => o.attributes('value') === 'assign'));
        await actionSelect.setValue('assign');
        await flushPromises();
        expect(wrapper.find('[data-test="assign-mode"]').element.value).toBe('add');
    });

    it('shows who the dry run would assign and who it would skip, and why', async () => {
        await openPage();
        await wrapper.findAll('button').find((b) => b.text() === 'Automations.edit').trigger('click');
        await flushPromises();
        await wrapper.find('[data-test="dry-run-project"]').setValue('p1');
        await flushPromises();
        await wrapper.find('[data-test="dry-run-task"]').setValue('t1');
        await wrapper.find('[data-test="dry-run"]').trigger('click');
        await flushPromises();
        const text = wrapper.find('[data-test="dry-run-assign"]').text();
        expect(text).toContain('Priya Shah');
        expect(text).toContain('Gone Person');
        expect(text).toContain('Automations.assign_skip_not_a_member');
    });

    it('shows who the backtest would rotate between', async () => {
        await openPage();
        await wrapper.findAll('button').find((b) => b.text() === 'Automations.edit').trigger('click');
        await flushPromises();
        await wrapper.findAll('button').find((b) => b.text() === 'Parity.test_30_days').trigger('click');
        await flushPromises();
        const text = wrapper.find('[data-test="backtest-assign"]').text();
        expect(text).toContain('Priya Shah');
        expect(text).toContain('Sam Lee');
    });
});
