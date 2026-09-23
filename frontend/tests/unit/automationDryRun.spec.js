import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
const echo = (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key);

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/components/organisms/TaskDetailOverlay/useTaskOverlay', () => ({ openTask: vi.fn() }));

import AutomationsPage from '@/views/Automations/AutomationsPage.vue';

const RULE = {
    _id: 'r1', enabled: true, sentence: 'When priority changes, comment', firedCount: 0,
    trigger: { type: 'event', event: 'task.priority_changed' }, scope: { allProjects: true, projectIds: [] },
    conditions: { op: 'eq', field: 'Task_Priority', value: 'HIGH' },
    steps: [{ id: 's1', type: 'action', action: 'add_comment', config: { body: 'Escalated: {{task.TaskName}}' } }],
};
const MANIFEST = {
    triggers: [{ key: 'task.priority_changed', label: 'Task priority changes', entity: 'task', hasDiff: true }],
    conditionFields: [{ field: 'Task_Priority', label: 'Priority', type: 'select', options: ['LOW', 'HIGH'], ops: ['eq'] }],
    actions: [{ key: 'add_comment', label: 'Add a comment', schema: { body: { type: 'textarea', label: 'Comment' } } }],
    operators: {},
};
const PLAN = {
    matched: true, inScope: true,
    rule: { id: 'r1', name: 'Escalate', enabled: true, trigger: 'task.priority_changed' },
    task: { id: 't1', key: 'WEB-7', name: 'Fix login', projectId: 'p1' },
    reasons: ['Every condition holds for this task.', '<b>not bold</b>'],
    conditions: [{ field: 'Task_Priority', op: 'eq', value: 'HIGH', actual: 'HIGH', passed: true }],
    actions: [{ id: 's1', type: 'action', action: 'add_comment', label: 'Add a comment', params: { body: 'Escalated: Fix login' }, wouldRun: true }],
    basis: 'Evaluated against the task as it is stored now. Nothing was saved and no action ran.',
};

const ok = (data) => Promise.resolve({ data: { status: true, data } });
let dryRunAnswer;

const open = async (roleType = 1) => {
    apiRequest.mockImplementation((method, url, body) => {
        if (url.endsWith('/registry')) return ok(MANIFEST);
        if (url.endsWith('/automations')) return ok([RULE]);
        if (url.endsWith('/compile')) return ok({ sentence: RULE.sentence, errors: [], ambiguities: [], grammar: {} });
        if (url.endsWith('/dry-run')) return dryRunAnswer(body);
        if (url.endsWith('/find')) return Promise.resolve({ data: [{ _id: 't1', TaskName: 'Fix login', TaskKey: 'WEB-7' }] });
        if (method === 'get') return ok([{ _id: 'p1', ProjectName: 'Web' }]);
        return ok([]);
    });
    const store = createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }) } } } });
    const wrapper = mount(AutomationsPage, { global: { plugins: [store], mocks: { $t: echo } } });
    await flushPromises();
    return wrapper;
};

const editRule = async (wrapper) => {
    const edit = wrapper.findAll('button').find((b) => b.text() === 'Automations.edit');
    await edit.trigger('click');
    await flushPromises();
};

const pickTask = async (wrapper) => {
    await wrapper.find('[data-test="dry-run-project"]').setValue('p1');
    await flushPromises();
    await wrapper.find('[data-test="dry-run-task"]').setValue('t1');
};

describe('AutomationsPage — test a saved rule on a task', () => {
    beforeEach(() => {
        apiRequest.mockReset();
        dryRunAnswer = () => ok(PLAN);
    });

    it('is not offered for a rule that has not been saved yet', async () => {
        const wrapper = await open();
        const create = wrapper.findAll('button').find((b) => b.text().includes('Automations.new'));
        await create.trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="dry-run"]').exists()).toBe(false);
    });

    it('posts the chosen task to POST /api/v2/automations/:id/dry-run', async () => {
        const wrapper = await open();
        await editRule(wrapper);
        expect(wrapper.find('[data-test="dry-run"]').text()).toBe('Automations.dry_run');
        expect(wrapper.find('[data-test="dry-run"]').attributes('disabled')).toBeDefined();
        await pickTask(wrapper);
        await wrapper.find('[data-test="dry-run"]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', '/api/v2/automations/r1/dry-run', { taskId: 't1' });
    });

    it('shows whether it matched, why, and each action with its resolved params', async () => {
        const wrapper = await open();
        await editRule(wrapper);
        await pickTask(wrapper);
        await wrapper.find('[data-test="dry-run"]').trigger('click');
        await flushPromises();
        const result = wrapper.find('[data-test="dry-run-result"]');
        expect(result.find('[data-test="dry-run-verdict"]').text()).toBe('Automations.dry_run_matched');
        expect(result.text()).toContain('Every condition holds for this task.');
        const action = result.find('[data-test="dry-run-action"]');
        expect(action.text()).toContain('Add a comment');
        expect(action.text()).toContain('Escalated: Fix login');
        expect(action.text()).toContain('Automations.dry_run_would_run');
        expect(result.text()).toContain('Nothing was saved');
        expect(result.find('b').exists()).toBe(false);
        expect(result.text()).toContain('<b>not bold</b>');
    });

    it('shows a no-match verdict with the reason', async () => {
        dryRunAnswer = () => ok({ ...PLAN, matched: false, reasons: ['Task_Priority is "LOW", and the rule needs Task_Priority eq "HIGH".'], actions: [{ ...PLAN.actions[0], wouldRun: false, note: 'The rule does not match this task.' }] });
        const wrapper = await open();
        await editRule(wrapper);
        await pickTask(wrapper);
        await wrapper.find('[data-test="dry-run"]').trigger('click');
        await flushPromises();
        const result = wrapper.find('[data-test="dry-run-result"]');
        expect(result.find('[data-test="dry-run-verdict"]').text()).toBe('Automations.dry_run_not_matched');
        expect(result.text()).toContain('Task_Priority is "LOW"');
        expect(result.find('[data-test="dry-run-action"]').text()).toContain('Automations.dry_run_would_not_run');
    });

    it('shows the server refusal when the task cannot be opened', async () => {
        dryRunAnswer = () => Promise.reject(Object.assign(new Error('Request failed with status code 404'), { response: { status: 404, data: { status: false, statusText: 'Not found.' } } }));
        const wrapper = await open();
        await editRule(wrapper);
        await pickTask(wrapper);
        await wrapper.find('[data-test="dry-run"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="dry-run-result"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="dry-run-error"]').text()).toBe('Not found.');
    });
});
