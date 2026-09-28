import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';

const { apiRequest, perms, toast } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    perms: {},
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }
}));
vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: (key) => (key in perms ? perms[key] : true) })
}));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import TaskRepeatControl from '@/components/organisms/TaskDetailOverlay/TaskRepeatControl.vue';
import { repeatFromRule, ruleFromRepeat } from '@/components/organisms/TaskDetailOverlay/taskRepeat';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);

const TASK = { _id: 'task-1', TaskName: 'Weekly report', ProjectID: 'proj-1' };
const ROUTE = '/api/v1/recurring-tasks/task/task-1';

let stored;
const serve = () => apiRequest.mockImplementation(async (method, url, body) => {
    if (url !== ROUTE) return { data: { status: false } };
    if (method === 'get') return { data: { status: true, data: stored } };
    if (method === 'put') {
        stored = { _id: 'rule-1', sourceTaskId: 'task-1', runCount: 0, ...body };
        return { data: { status: true, data: stored } };
    }
    if (method === 'delete') {
        stored = null;
        return { data: { status: true } };
    }
    return { data: { status: false } };
});

const mountControl = () => mount(TaskRepeatControl, {
    props: { task: TASK, project: { _id: 'proj-1', isGlobalPermission: false } },
    global: { mocks: { $t: i18n.global.t } },
    attachTo: document.body
});

beforeEach(() => {
    stored = null;
    Object.keys(perms).forEach((key) => { delete perms[key]; });
    apiRequest.mockReset();
    serve();
});

describe('the Repeat control in the task panel', () => {
    it('says the task does not repeat when it has no rule', async () => {
        const wrapper = mountControl();
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('get', ROUTE);
        expect(wrapper.get('.ah-repeat__summary').text()).toContain("Doesn't repeat");
    });

    it('saves a weekly rule through the task route and reads it back into the editor', async () => {
        const wrapper = mountControl();
        await flushPromises();

        await wrapper.get('.ah-repeat__summary').trigger('click');
        await wrapper.get('[data-test="repeat-freq"]').setValue('weekly');
        const on = wrapper.findAll('.ah-repeat__day').filter((b) => b.attributes('aria-pressed') === 'true');
        for (const button of on) await button.trigger('click');
        await wrapper.get('[data-test="repeat-day-1"]').trigger('click');
        await wrapper.get('[data-test="repeat-day-4"]').trigger('click');
        await wrapper.get('[data-test="repeat-interval"]').setValue(2);
        await wrapper.get('[data-test="repeat-ends-after"]').setValue(true);
        await wrapper.get('[data-test="repeat-max-runs"]').setValue(6);
        await wrapper.get('[data-test="repeat-missed"]').setValue('roll');
        await wrapper.get('[data-test="repeat-save"]').trigger('click');
        await flushPromises();

        expect(apiRequest).toHaveBeenCalledWith('put', ROUTE, {
            freq: 'weekly', interval: 2, byweekday: [1, 4], monthday: null, until: null, maxRuns: 6, missedPolicy: 'roll'
        });
        expect(wrapper.find('.ah-repeat__editor').exists()).toBe(false);
        expect(wrapper.get('.ah-repeat__summary').text()).toMatch(/Every 2 weeks on .+, 6 times/);

        const reread = mountControl();
        await flushPromises();
        await reread.get('.ah-repeat__summary').trigger('click');
        expect(reread.get('[data-test="repeat-freq"]').element.value).toBe('weekly');
        expect(reread.get('[data-test="repeat-interval"]').element.value).toBe('2');
        expect(reread.get('[data-test="repeat-day-1"]').attributes('aria-pressed')).toBe('true');
        expect(reread.get('[data-test="repeat-day-4"]').attributes('aria-pressed')).toBe('true');
        expect(reread.get('[data-test="repeat-max-runs"]').element.value).toBe('6');
        expect(reread.get('[data-test="repeat-missed"]').element.value).toBe('roll');
    });

    it('stops repeating through the task route', async () => {
        stored = { _id: 'rule-1', freq: 'daily', interval: 1, missedPolicy: 'skip' };
        const wrapper = mountControl();
        await flushPromises();
        expect(wrapper.get('.ah-repeat__summary').text()).toContain('Every day');

        await wrapper.get('.ah-repeat__summary').trigger('click');
        await wrapper.get('[data-test="repeat-remove"]').trigger('click');
        await flushPromises();

        expect(apiRequest).toHaveBeenCalledWith('delete', ROUTE);
        expect(wrapper.get('.ah-repeat__summary').text()).toContain("Doesn't repeat");
    });

    it('asks for a day before saving a weekly rule with none', async () => {
        const wrapper = mountControl();
        await flushPromises();
        await wrapper.get('.ah-repeat__summary').trigger('click');
        const on = wrapper.findAll('.ah-repeat__day').filter((b) => b.attributes('aria-pressed') === 'true');
        for (const button of on) await button.trigger('click');
        await wrapper.get('[data-test="repeat-save"]').trigger('click');

        expect(wrapper.get('[role="alert"]').text()).toBe('Pick at least one day.');
        expect(apiRequest).not.toHaveBeenCalledWith('put', expect.anything(), expect.anything());
    });

    it('shows the rule but does not open the editor without the due date and create permissions', async () => {
        perms['task.task_create'] = false;
        stored = { _id: 'rule-1', freq: 'monthly', interval: 1, monthday: 15 };
        const wrapper = mountControl();
        await flushPromises();
        const summary = wrapper.get('.ah-repeat__summary');
        expect(summary.text()).toContain('Monthly on day 15');
        expect(summary.element.disabled).toBe(true);
    });

    it('is hidden from someone who may not see the due date', async () => {
        perms['task.task_due_date'] = null;
        const wrapper = mountControl();
        await flushPromises();
        expect(wrapper.find('.ah-repeat').exists()).toBe(false);
        expect(apiRequest).not.toHaveBeenCalled();
    });
});

describe('repeat form and rule', () => {
    it('round-trip each shape', () => {
        const rules = [
            { freq: 'daily', interval: 3, byweekday: [], monthday: null, until: null, maxRuns: null, missedPolicy: 'create' },
            { freq: 'weekly', interval: 1, byweekday: [0, 6], monthday: null, until: null, maxRuns: 4, missedPolicy: 'skip' },
            { freq: 'monthly', interval: 2, byweekday: [], monthday: 28, until: '2027-03-01', maxRuns: null, missedPolicy: 'roll' }
        ];
        rules.forEach((rule) => expect(ruleFromRepeat(repeatFromRule(rule))).toEqual(rule));
    });
});
