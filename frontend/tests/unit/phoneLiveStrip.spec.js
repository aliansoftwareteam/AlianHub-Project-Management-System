import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => key } } }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { agentsRunning: 0 } }));
vi.mock('vue-router', () => ({ useRoute: () => ({ params: {}, query: {} }), useRouter: () => ({ push: vi.fn() }) }));

import AgentLiveStrip from '@/views/Ai/AgentLiveStrip.vue';

const ok = (data) => Promise.resolve({ data: { status: true, data } });
const team = {
    people: [],
    agents: [
        { id: 'a1', name: 'Daily PM with a very long agent name', status: 'running', run: { taskKey: 'AP-116' } },
        { id: 'a2', name: 'Code Reviewer', status: 'running', run: { taskKey: 'AR-1' } }
    ],
    totals: { running: 2 }
};

const store = () => createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: 1 }) } } } });

let wrapper;
const mountAt = async (width) => {
    wrapper = mount(AgentLiveStrip, {
        global: {
            plugins: [store()],
            provide: { $companyId: ref('c1'), $userId: ref('u1'), $clientWidth: ref(width) },
            stubs: { RouterLink: RouterLinkStub, ShellIcon: true }
        }
    });
    await flushPromises();
    return wrapper;
};

beforeEach(() => {
    apiRequest.mockReset();
    apiRequest.mockImplementation((type, url) => (url === '/api/v2/agents/team' ? ok(team) : ok([])));
});

afterEach(() => wrapper?.unmount());

describe('the live strip at phone width', () => {
    it('shows a one-line summary with Pause instead of every name', async () => {
        await mountAt(390);
        const summary = wrapper.find('[data-test="live-summary"]');
        expect(summary.exists()).toBe(true);
        expect(summary.attributes('aria-expanded')).toBe('false');
        expect(wrapper.find('.live').classes()).toContain('live--compact');
        expect(wrapper.findAll('.live__item')).toHaveLength(0);
        expect(wrapper.find('[data-test="pause-all"]').exists()).toBe(true);
    });

    it('expands to the full list and collapses again', async () => {
        await mountAt(390);
        await wrapper.find('[data-test="live-summary"]').trigger('click');
        expect(wrapper.find('[data-test="live-summary"]').attributes('aria-expanded')).toBe('true');
        const list = wrapper.find('[data-test="live-list"]');
        expect(list.exists()).toBe(true);
        expect(list.findAll('.live__row')).toHaveLength(2);
        expect(list.text()).toContain('Code Reviewer');

        await wrapper.find('[data-test="live-summary"]').trigger('click');
        expect(wrapper.find('[data-test="live-list"]').exists()).toBe(false);
    });

    it('keeps the inline line on wider screens', async () => {
        await mountAt(1280);
        expect(wrapper.find('[data-test="live-summary"]').exists()).toBe(false);
        expect(wrapper.find('.live').classes()).not.toContain('live--compact');
        expect(wrapper.findAll('.live__item')).toHaveLength(2);
    });
});
