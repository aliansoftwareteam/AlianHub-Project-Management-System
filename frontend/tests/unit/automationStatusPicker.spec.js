import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
const echo = (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key);

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import AutomationsPage from '@/views/Automations/AutomationsPage.vue';
import { statusChoices } from '@/views/Automations/statusChoices';

const PROJECTS = [
    { _id: 'p1', ProjectName: 'Web', taskStatusData: [{ key: 4, name: 'Blocked', type: 'active' }, { key: 6, name: 'Done', type: 'close' }] },
    { _id: 'p2', ProjectName: 'Ops', taskStatusData: [{ key: 7, name: 'blocked', type: 'active' }] },
];
const MANIFEST = {
    triggers: [{ key: 'task.created', label: 'Task is created', entity: 'task', hasDiff: false }],
    conditionFields: [
        { field: 'statusRef', label: 'Status', type: 'status', ops: ['in', 'notIn'] },
        { field: 'statusType', label: 'Status type', type: 'select', options: ['default_active', 'active', 'close'], ops: ['eq', 'neq'] },
    ],
    actions: [{ key: 'set_priority', label: 'Set priority', schema: { priority: { type: 'select', label: 'Priority', options: ['LOW', 'HIGH'] } } }],
    operators: {},
};
const FLAGGED = {
    _id: 'r1', enabled: true, sentence: 'When a task is created, if the status is Frozen, set the priority to HIGH.', firedCount: 0,
    needsReview: [{ reason: 'unknown_status', status: 'Frozen' }],
};

const ok = (data) => Promise.resolve({ data: { status: true, data } });

const open = async () => {
    apiRequest.mockImplementation((method, url) => {
        if (url.endsWith('/registry')) return ok(MANIFEST);
        if (url.endsWith('/automations')) return method === 'get' ? ok([FLAGGED]) : ok({});
        if (url.endsWith('/compile')) return ok({ sentence: 'When a task is created, set the priority to LOW.', errors: [], ambiguities: [], grammar: {} });
        if (url === '/api/v1/project') return Promise.resolve({ data: PROJECTS });
        return ok([]);
    });
    const store = createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: 1 }) } } } });
    const wrapper = mount(AutomationsPage, { global: { plugins: [store], mocks: { $t: echo } } });
    await flushPromises();
    return wrapper;
};

const button = (wrapper, text) => wrapper.findAll('button').find((b) => b.text() === text);

describe('the status picker in the rule builder', () => {
    beforeEach(() => { apiRequest.mockReset(); });

    it('offers each status name once, carrying every project\'s key for it', () => {
        expect(statusChoices(PROJECTS)).toEqual([
            { label: 'Blocked', refs: ['p1:4', 'p2:7'] },
            { label: 'Done', refs: ['p1:6'] },
        ]);
        expect(statusChoices(PROJECTS, 'p2')).toEqual([{ label: 'blocked', refs: ['p2:7'] }]);
    });

    it('saves the keys of the status picked, with its name to read back', async () => {
        const wrapper = await open();
        await button(wrapper, 'Automations.new').trigger('click');
        await flushPromises();
        await button(wrapper, 'Automations.add_condition').trigger('click');
        await flushPromises();

        const picker = wrapper.find('[data-test="status-picker"]');
        expect(picker.findAll('option').map((o) => o.text())).toEqual(['Automations.status_pick', 'Blocked', 'Done']);
        await picker.setValue('Blocked');
        await flushPromises();
        await wrapper.find('.au__save .ah-btn--primary').trigger('click');
        await flushPromises();

        const saved = apiRequest.mock.calls.find(([method, url]) => method === 'post' && url.endsWith('/automations'));
        expect(saved[2].conditions).toEqual({ op: 'in', field: 'statusRef', value: ['p1:4', 'p2:7'], label: 'Blocked' });
    });

    it('re-keys a picked status when the rule is narrowed to one project', async () => {
        const wrapper = await open();
        await button(wrapper, 'Automations.new').trigger('click');
        await flushPromises();
        await button(wrapper, 'Automations.add_condition').trigger('click');
        await wrapper.find('[data-test="status-picker"]').setValue('Blocked');
        const scopeSelect = wrapper.findAll('select').find((s) => s.findAll('option').some((o) => o.text() === 'Automations.all_projects'));
        await scopeSelect.setValue('p2');
        await flushPromises();
        await wrapper.find('.au__save .ah-btn--primary').trigger('click');
        await flushPromises();

        const saved = apiRequest.mock.calls.find(([method, url]) => method === 'post' && url.endsWith('/automations'));
        expect(saved[2].scope).toEqual({ allProjects: false, projectIds: ['p2'] });
        expect(saved[2].conditions.value).toEqual(['p2:7']);
    });

    it('marks a rule whose condition names a status that does not exist', async () => {
        const wrapper = await open();
        expect(wrapper.find('[data-test="needs-review"]').text()).toBe('Automations.status_needs_review {"status":"Frozen"}');
    });
});
