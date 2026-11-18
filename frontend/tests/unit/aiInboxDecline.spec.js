import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => `t:${key}` } } }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { agentsRunning: 0 } }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/views/Ai/AiSidebar.vue', () => ({ default: { name: 'AiSidebar', render: () => null } }));

import AiInbox from '@/views/Ai/AiInbox.vue';

const proposal = {
    _id: 'pr1', agentName: 'QA', what: 'Move 3 tasks to the next sprint', why: 'The sprint is full', status: 'pending',
    changes: [{ label: 'Move T-1', reversible: true }], createdAt: new Date().toISOString()
};

const store = createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: 1 }) } } } });

const answer = (type, url) => {
    if (type === 'post') return Promise.resolve({ data: { status: true, data: {} } });
    if (url.includes('/proposals')) return Promise.resolve({ data: { status: true, data: [proposal], counts: { waiting: 1 } } });
    return Promise.resolve({ data: { status: true, data: {} } });
};

const openDecline = async () => {
    apiRequest.mockImplementation(answer);
    const wrapper = mount(AiInbox, { global: { plugins: [store] } });
    await flushPromises();
    await wrapper.find('.ai-item').trigger('click');
    await wrapper.find('[data-test="decline"]').trigger('click');
    return wrapper;
};

const declineCall = () => apiRequest.mock.calls.find(([type, url]) => type === 'post' && url.endsWith('/decline'));

describe('AiInbox decline', () => {
    beforeEach(() => { apiRequest.mockReset(); });

    it('asks for a reason before declining and sends nothing until one is picked', async () => {
        const wrapper = await openDecline();
        const step = wrapper.find('[data-test="decline-reason"]');
        expect(step.exists()).toBe(true);
        expect(step.findAll('.ai-decline__chip').map((c) => c.attributes('data-reason'))).toEqual(['too_many_changes', 'wrong_tone', 'needs_person', 'not_now']);
        expect(step.find('[data-test="decline-send"]').attributes('disabled')).toBeDefined();
        expect(declineCall()).toBeUndefined();

        await step.find('[data-test="decline-cancel"]').trigger('click');
        expect(wrapper.find('[data-test="decline-reason"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="decline"]').exists()).toBe(true);
    });

    it('sends the canned reason key', async () => {
        const wrapper = await openDecline();
        await wrapper.find('[data-reason="too_many_changes"]').trigger('click');
        expect(wrapper.find('[data-reason="too_many_changes"]').classes()).toContain('is-on');
        await wrapper.find('[data-test="decline-send"]').trigger('click');
        await flushPromises();
        expect(declineCall()).toEqual(['post', '/api/v2/agents/proposals/pr1/decline', { reason: 'too_many_changes' }]);
        expect(wrapper.find('[data-test="decline-reason"]').exists()).toBe(false);
    });

    it('sends the free text when no chip is picked', async () => {
        const wrapper = await openDecline();
        await wrapper.find('[data-test="decline-note"]').setValue('  The sprint is already locked  ');
        await wrapper.find('[data-test="decline-send"]').trigger('click');
        await flushPromises();
        expect(declineCall()[2]).toEqual({ reason: 'The sprint is already locked' });
    });

    it('keeps the chip and the note mutually exclusive', async () => {
        const wrapper = await openDecline();
        await wrapper.find('[data-test="decline-note"]').setValue('extra context');
        await wrapper.find('[data-reason="not_now"]').trigger('click');
        expect(wrapper.find('[data-test="decline-note"]').element.value).toBe('');
        expect(wrapper.find('[data-reason="not_now"]').classes()).toContain('is-on');

        await wrapper.find('[data-test="decline-note"]').setValue('sprint is locked');
        expect(wrapper.find('[data-reason="not_now"]').classes()).not.toContain('is-on');
        expect(wrapper.find('[data-reason="not_now"]').attributes('aria-pressed')).toBe('false');

        await wrapper.find('[data-test="decline-send"]').trigger('click');
        await flushPromises();
        expect(declineCall()[2]).toEqual({ reason: 'sprint is locked' });
    });

    it('declines without a reason from the skip link', async () => {
        const wrapper = await openDecline();
        await wrapper.find('[data-test="decline-skip"]').trigger('click');
        await flushPromises();
        expect(declineCall()).toEqual(['post', '/api/v2/agents/proposals/pr1/decline', {}]);
    });

    it('keeps the reason step open and shows the refusal when the decline fails', async () => {
        const wrapper = await openDecline();
        apiRequest.mockImplementation((type, url) => (type === 'post'
            ? Promise.reject(Object.assign(new Error('Request failed with status code 409'), { response: { status: 409, data: { status: false, statusText: 'Already decided.' } } }))
            : answer(type, url)));
        await wrapper.find('[data-reason="wrong_tone"]').trigger('click');
        await wrapper.find('[data-test="decline-send"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="decline-reason"]').exists()).toBe(true);
        expect(wrapper.find('.ah-field__error').text()).toBe('Already decided.');
    });
});
