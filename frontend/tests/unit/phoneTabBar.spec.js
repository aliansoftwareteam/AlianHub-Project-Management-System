import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';

vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true }),
    useGetterFunctions: () => ({ getUser: () => ({ Employee_Name: 'Pat', Employee_Email: 'pat@example.test' }) })
}));
vi.mock('@/composable/aiAvailability', () => ({ aiUsable: ref(true), aiReachable: ref(true), canUseAi: () => true }));
vi.mock('@/services', () => ({
    useAuth: () => ({ logOut: vi.fn() }),
    apiRequest: vi.fn(async () => ({ data: { data: { spaces: ['s1', 's2'], direct: ['task_s1_l1_dm1_comments'], channels: ['task_s2_l2_default_comments'] } } }))
}));
vi.mock('vue-router', () => ({
    useRoute: () => ({ name: 'Home', fullPath: '/', path: '/' }),
    useRouter: () => ({ hasRoute: () => true, resolve: () => ({ href: '#/' }) })
}));

import MobileTabBar from '@/components/organisms/Shell/MobileTabBar.vue';

const storeWith = (counts) => createStore({
    modules: {
        settings: { namespaced: true, getters: { rules: () => ({ ready: true }), companyUserDetail: () => ({ roleType: 1 }) } },
        users: { namespaced: true, getters: { myCounts: () => ({ data: counts }) } },
        brandSettingTab: { namespaced: true, getters: { brandSettings: () => ({}) } }
    }
});

let wrapper;
const mountTabBar = async (counts = {}) => {
    wrapper = mount(MobileTabBar, {
        global: {
            plugins: [storeWith(counts)],
            provide: { $companyId: ref('c1'), $userId: ref('u1') },
            stubs: { RouterLink: RouterLinkStub, ShellIcon: true, UserProfile: true, teleport: true }
        }
    });
    await flushPromises();
    return wrapper;
};

const tabLabels = () => wrapper.findAll('.ah-tabbar > .ah-tabbar__item').map((el) => el.text().trim());

afterEach(() => wrapper?.unmount());

describe('the phone tab bar', () => {
    it('keeps Inbox one tap away and moves Planner into More', async () => {
        await mountTabBar();
        const labels = tabLabels();
        expect(labels).toContain('Inbox.title');
        expect(labels).not.toContain('Shell.planner');
        expect(labels.length).toBeLessThanOrEqual(6);
    });

    it('shows the unread count on the Inbox tab, capped at 99+', async () => {
        await mountTabBar({ notification_counts: 3, mention_counts: 2 });
        const inbox = wrapper.find('[data-test="tab-inbox"]');
        expect(inbox.find('.ah-unread-badge').text()).toBe('5');
        expect(inbox.attributes('aria-label')).toBe('Shell.inbox_unread');
        wrapper.unmount();

        await mountTabBar({ notification_counts: 120, mention_counts: 0 });
        expect(wrapper.find('[data-test="tab-inbox"] .ah-unread-badge').text()).toBe('99+');
    });

    it('shows no badge when nothing is unread', async () => {
        await mountTabBar({ notification_counts: 0, mention_counts: -1 });
        expect(wrapper.find('[data-test="tab-inbox"] .ah-unread-badge').exists()).toBe(false);
        expect(wrapper.find('[data-test="tab-inbox"]').attributes('aria-label')).toBeUndefined();
    });

    it('shows the unread count on the Chat tab for the conversations Chat lists, and nothing left from a closed one', async () => {
        await mountTabBar({ task_s1_l1_dm1_comments: 2, task_s2_l2_default_comments: 1, task_s2_l9_default_comments: 7, task_p1_l1_t1_comments: 4 });
        const chat = wrapper.find('[data-test="tab-chat"]');
        expect(chat.find('.ah-unread-badge').text()).toBe('3');
        expect(chat.attributes('aria-label')).toBe('Shell.chat_unread');
    });

    it('still reaches Planner from the More sheet', async () => {
        await mountTabBar();
        await wrapper.find('[data-test="tab-more"]').trigger('click');
        const cells = wrapper.findAll('.ah-sheet__cell').map((el) => el.text());
        expect(cells).toContain('Shell.planner');
    });
});
