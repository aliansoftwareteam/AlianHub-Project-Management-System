import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createMemoryHistory, createRouter } from 'vue-router';

vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/views/Ai/useAgents', () => ({
    useAgents: () => ({ waiting: { value: 3 }, running: { value: 0 }, spend: { value: { totalUsd: 0, agents: [] } }, pauseAll: vi.fn() }),
}));

import AiMobileNav from '@/views/Ai/AiMobileNav.vue';
import AiSidebar from '@/views/Ai/AiSidebar.vue';
import aiRoutes from '@/router/ai';

const blank = { render: () => null };

const routerFor = () => createRouter({
    history: createMemoryHistory(),
    routes: [
        ...aiRoutes.map((r) => ({ path: r.path, name: r.name, component: blank })),
        { path: '/:cid/workflows', name: 'WorkflowBuilder', component: blank },
        { path: '/:cid/connections', name: 'Connections', component: blank },
        { path: '/:cid/audit', name: 'AuditLog', component: blank },
    ],
});

const storeFor = (roleType) => createStore({
    modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }) } } },
});

const open = async (component = AiMobileNav, { roleType = 1, start = 'AiHub' } = {}) => {
    const router = routerFor();
    await router.push({ name: start, params: { cid: 'c1' } });
    await router.isReady();
    const wrapper = mount(component, {
        global: { plugins: [storeFor(roleType), router], provide: { $companyId: 'c1', $userId: 'u1' } },
        attachTo: document.body,
    });
    await flushPromises();
    return { wrapper, router };
};

const primary = (wrapper) => wrapper.findAll('[data-test="ai-mnav-item"]');

describe('AI phone navigation', () => {
    beforeEach(() => { document.body.innerHTML = ''; });

    it('puts Ask, the AI Inbox, Agents and Skills in reach, in that order', async () => {
        const { wrapper } = await open();
        expect(primary(wrapper).map((a) => a.attributes('href'))).toEqual(['/c1/ai/ask', '/c1/ai/inbox', '/c1/ai/agents', '/c1/ai/skills']);
        expect(primary(wrapper).map((a) => a.find('[data-test="ai-mnav-label"]').text())).toEqual(['Parity.nav_ask', 'Ai.inbox', 'Ai.agents', 'Ai.skills']);
        wrapper.unmount();
    });

    it('shows how many proposals wait in the AI Inbox', async () => {
        const { wrapper } = await open();
        expect(wrapper.find('[data-test="ai-mnav-count"]').text()).toBe('3');
        wrapper.unmount();
    });

    it('marks the page being shown', async () => {
        const { wrapper } = await open(AiMobileNav, { start: 'AiInbox' });
        const inbox = primary(wrapper)[1];
        expect(inbox.attributes('aria-current')).toBe('page');
        expect(primary(wrapper)[0].attributes('aria-current')).toBeUndefined();
        wrapper.unmount();
    });

    it('keeps the rest of the AI section behind More', async () => {
        const { wrapper } = await open();
        const more = wrapper.find('[data-test="ai-mnav-more"]');
        expect(more.attributes('aria-expanded')).toBe('false');
        expect(more.attributes('aria-label')).toBe('Ai.more');
        await more.trigger('click');
        expect(more.attributes('aria-expanded')).toBe('true');
        const labels = wrapper.findAll('[data-test="ai-mnav-extra"]').map((a) => a.text());
        expect(labels).toContain('Parity.nav_connections');
        expect(labels).toContain('AiHealth.nav');
        expect(labels).toContain('WorkflowBuilder.nav');
        expect(labels).not.toContain('Ai.inbox');
        wrapper.unmount();
    });

    it('keeps the workflow builder away from a member', async () => {
        const { wrapper } = await open(AiMobileNav, { roleType: 3 });
        await wrapper.find('[data-test="ai-mnav-more"]').trigger('click');
        expect(wrapper.findAll('[data-test="ai-mnav-extra"]').map((a) => a.text())).not.toContain('WorkflowBuilder.nav');
        wrapper.unmount();
    });

    it('closes More on Escape and after picking a page', async () => {
        const { wrapper, router } = await open();
        const more = wrapper.find('[data-test="ai-mnav-more"]');
        await more.trigger('click');
        await wrapper.find('[data-test="ai-mnav-menu"]').trigger('keydown', { key: 'Escape' });
        expect(more.attributes('aria-expanded')).toBe('false');
        await more.trigger('click');
        await wrapper.findAll('[data-test="ai-mnav-extra"]')[0].trigger('click');
        await flushPromises();
        expect(more.attributes('aria-expanded')).toBe('false');
        expect(router.currentRoute.value.name).not.toBe('AiHub');
        wrapper.unmount();
    });

    it('rides along with every AI page through the sidebar', async () => {
        const { wrapper } = await open(AiSidebar);
        expect(wrapper.findComponent(AiMobileNav).exists()).toBe(true);
        wrapper.unmount();
    });
});
