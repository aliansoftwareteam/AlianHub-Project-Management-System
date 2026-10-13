import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { TEMPLATES } from '@automationTemplates';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import AutomationsPage from '@/views/Automations/AutomationsPage.vue';

const PROJECTS = [
    { _id: 'p1', ProjectName: 'Web', taskStatusData: [{ key: 1, name: 'To do', type: 'default_active' }, { key: 3, name: 'Shipped', type: 'close' }] },
    { _id: 'p2', ProjectName: 'Ops', taskStatusData: [{ key: 9, name: 'Complete', type: 'close' }] },
];
const MANIFEST = {
    triggers: [
        { key: 'task.created', label: 'Task is created', entity: 'task', hasDiff: false },
        { key: 'task.status_changed', label: 'Task status changes', entity: 'task', hasDiff: true },
    ],
    conditionFields: [{ field: 'statusRef', label: 'Status', type: 'status', ops: ['in', 'notIn', 'changedTo', 'changedFrom'] }],
    actions: [
        { key: 'set_priority', label: 'Change priority', schema: { priority: { type: 'select', label: 'Priority', options: ['LOW', 'MEDIUM', 'HIGH'] } } },
        { key: 'add_comment', label: 'Add a comment', schema: { body: { type: 'textarea', label: 'Comment' } } },
        { key: 'assign', label: 'Assign to', schema: {} },
    ],
    operators: {},
};

const ok = (data) => Promise.resolve({ data: { status: true, data } });
const compiled = () => apiRequest.mock.calls.filter(([, url, body]) => url.endsWith('/compile') && body && body.rule).map(([, , body]) => body.rule);

const open = async ({ roleType = 1, props = {} } = {}) => {
    apiRequest.mockImplementation((method, url) => {
        if (url.endsWith('/registry')) return ok(MANIFEST);
        if (url.endsWith('/automations')) return ok([]);
        if (url.endsWith('/compile')) return ok({ sentence: 'When a task status changes, …', errors: [] });
        if (url === '/api/v1/project') return Promise.resolve({ data: PROJECTS });
        return ok([]);
    });
    const store = createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }) } } } });
    const wrapper = mount(AutomationsPage, { props, global: { plugins: [store], stubs: { AssignActionEditor: true } } });
    await flushPromises();
    return wrapper;
};

const cards = (wrapper) => wrapper.findAll('[data-test="template-card"]');
const doneTemplate = TEMPLATES.find((t) => t.id === 'done_back_to_creator');

describe('the automation template gallery', () => {
    beforeEach(() => { apiRequest.mockReset(); });

    it('opens from the toolbar for an owner or admin and lists every template', async () => {
        const wrapper = await open();
        expect(wrapper.find('[data-test="template-gallery"]').exists()).toBe(false);
        await wrapper.find('[data-test="open-templates"]').trigger('click');
        expect(cards(wrapper)).toHaveLength(TEMPLATES.length);
    });

    it('gives a member no way into the gallery, even from a link', async () => {
        const wrapper = await open({ roleType: 3, props: { openTemplates: true, templateProjectId: 'p1' } });
        expect(wrapper.find('[data-test="open-templates"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="template-gallery"]').exists()).toBe(false);
    });

    it('opens scoped to the project a link names', async () => {
        const wrapper = await open({ props: { openTemplates: true, templateProjectId: 'p1' } });
        expect(wrapper.find('[data-test="template-gallery"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="template-project"]').element.value).toBe('p1');
    });

    it('narrows by search over the name and description', async () => {
        const wrapper = await open({ props: { openTemplates: true } });
        await wrapper.find('[data-test="template-search"]').setValue(doneTemplate.nameKey);
        expect(cards(wrapper).map((c) => c.attributes('data-id'))).toEqual([doneTemplate.id]);
        await wrapper.find('[data-test="template-search"]').setValue('no template says this');
        expect(cards(wrapper)).toHaveLength(0);
        expect(wrapper.find('[data-test="template-none"]').exists()).toBe(true);
    });

    it('filters by category', async () => {
        const wrapper = await open({ props: { openTemplates: true } });
        const chip = wrapper.findAll('[data-test="template-category"]').find((b) => b.attributes('data-category') === 'forms');
        await chip.trigger('click');
        const expected = TEMPLATES.filter((t) => t.category === 'forms').map((t) => t.id);
        expect(cards(wrapper).map((c) => c.attributes('data-id'))).toEqual(expected);
    });

    it('fills the builder for review without saving anything', async () => {
        const wrapper = await open({ props: { openTemplates: true, templateProjectId: 'p1' } });
        const card = cards(wrapper).find((c) => c.attributes('data-id') === doneTemplate.id);
        await card.find('[data-test="template-use"]').trigger('click');
        await flushPromises();

        expect(wrapper.find('[data-test="template-gallery"]').exists()).toBe(false);
        expect(wrapper.find('.au__sentence-input').exists()).toBe(true);
        expect(wrapper.find('[data-test="status-picker"]').element.value).toBe('Shipped');

        const rule = compiled().pop();
        expect(rule.trigger.event).toBe('task.status_changed');
        expect(rule.scope).toEqual({ allProjects: false, projectIds: ['p1'] });
        expect(rule.conditions).toEqual({ op: 'changedTo', field: 'statusRef', value: ['p1:3'], label: 'Shipped' });
        const saves = apiRequest.mock.calls.filter(([method, url]) => ['post', 'put'].includes(method) && !url.endsWith('/compile'));
        expect(saves).toEqual([]);
    });

    it('keeps the backtest in reach for a filled-in template', async () => {
        const wrapper = await open({ props: { openTemplates: true, templateProjectId: 'p1' } });
        await cards(wrapper)[0].find('[data-test="template-use"]').trigger('click');
        await flushPromises();
        expect(wrapper.findAll('button').some((b) => b.text() === 'Parity.test_30_days')).toBe(true);
    });
});
