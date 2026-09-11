import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import AutomationsPage from '@/views/Automations/AutomationsPage.vue';

const RULE = { _id: 'r1', enabled: false, sentence: 'When a task is created, post a comment', firedCount: 0 };

const answer = (method, url) => {
    if (url.endsWith('/registry')) return { data: { status: true, data: { triggers: [], conditionFields: [], actions: [], operators: {} } } };
    if (url.endsWith('/automations')) return { data: { status: true, data: [RULE] } };
    return { data: { status: true, data: [] } };
};

const open = async (roleType) => {
    const store = createStore({
        modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }) } } }
    });
    const wrapper = mount(AutomationsPage, { global: { plugins: [store] } });
    await flushPromises();
    return wrapper;
};

const buttonTexts = (wrapper) => wrapper.findAll('button').map((b) => b.text());

describe('AutomationsPage rule management controls', () => {
    beforeEach(() => {
        apiRequest.mockReset();
        apiRequest.mockImplementation(async (method, url) => answer(method, url));
    });

    it.each([[3, 'member'], [0, 'guest']])('shows a roleType %i (%s) the rules without any control to change them', async (roleType) => {
        const wrapper = await open(roleType);
        expect(wrapper.find('.au__rule-text').text()).toBe(RULE.sentence);
        expect(buttonTexts(wrapper)).not.toContain('Automations.new');
        expect(buttonTexts(wrapper)).not.toContain('Automations.edit');
        expect(buttonTexts(wrapper)).not.toContain('Automations.delete');
        expect(wrapper.find('.au__toggle').attributes('disabled')).toBeDefined();
        expect(wrapper.find('.au__readonly').text()).toBe('Automations.manage_owner_admin');
    });

    it('does not call the toggle endpoint when a member clicks the switch', async () => {
        const wrapper = await open(3);
        await wrapper.find('.au__toggle').trigger('click');
        expect(apiRequest.mock.calls.map(([method]) => method)).not.toContain('patch');
    });

    it.each([[1, 'owner'], [2, 'admin']])('gives a roleType %i (%s) the full set of controls', async (roleType) => {
        const wrapper = await open(roleType);
        expect(buttonTexts(wrapper)).toEqual(expect.arrayContaining(['Automations.new', 'Automations.edit', 'Automations.delete']));
        expect(wrapper.find('.au__toggle').attributes('disabled')).toBeUndefined();
        expect(wrapper.find('.au__readonly').exists()).toBe(false);
    });
});
