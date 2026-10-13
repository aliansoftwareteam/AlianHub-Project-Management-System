import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => `t:${key}` } } }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { agentsRunning: 0 } }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/views/Ai/AiSidebar.vue', () => ({ default: { name: 'AiSidebar', render: () => null } }));

import AiInbox from '@/views/Ai/AiInbox.vue';

const store = createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: 1 }) } } } });

describe('AiInbox with nothing waiting', () => {
    it('says the queue is clear without an unlabelled number above it', async () => {
        apiRequest.mockImplementation((type, url) => Promise.resolve(url.includes('/proposals')
            ? { data: { status: true, data: [], counts: { waiting: 0, doneByAi: 0, declined: 0 } } }
            : { data: { status: true, data: {} } }));
        const wrapper = mount(AiInbox, { global: { plugins: [store] } });
        await flushPromises();

        const done = wrapper.find('.ai-done');
        expect(done.exists()).toBe(true);
        expect(done.find('.ai-done__n').exists()).toBe(false);
        expect(done.text()).not.toMatch(/^\s*0/);
    });
});
