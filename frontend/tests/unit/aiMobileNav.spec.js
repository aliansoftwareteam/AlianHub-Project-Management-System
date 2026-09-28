import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createMemoryHistory, createRouter } from 'vue-router';

vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/views/Ai/useLiveAgents', () => ({ useLiveAgents: () => ({ running: { value: 0 }, refresh: vi.fn() }) }));
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
        ...aiRoutes.filter((r) => r.name).map((r) => ({ path: r.path, name: r.name, component: blank })),
        { path: '/:cid/workflows', name: 'WorkflowBuilder', component: blank },
        { path: '/:cid/connections', name: 'Connections', component: blank },
        { path: '/:cid/audit', name: 'AuditLog', component: blank },
    ],
});

const storeFor = (roleType) => createStore({
    modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }) } } },
});

const open = async ({ roleType = 1, start = 'AiHub' } = {}) => {
    const router = routerFor();
    await router.push({ name: start, params: { cid: 'c1' } });
    await router.isReady();
    const wrapper = mount(AiSidebar, {
        global: { plugins: [storeFor(roleType), router], provide: { $companyId: 'c1', $userId: 'u1' } },
        attachTo: document.body,
    });
    await flushPromises();
    return { wrapper, router, nav: wrapper.findComponent(AiMobileNav) };
};

const primary = (nav) => nav.findAll('[data-test="ai-mnav-item"]');
const sidebarLabels = (wrapper, selector) => wrapper.findAll(selector).map((a) => a.find('span').text());

describe('AI phone navigation', () => {
    beforeEach(() => { document.body.innerHTML = ''; });

    it('rides along with every AI page through the sidebar', async () => {
        const { wrapper, nav } = await open();
        expect(nav.exists()).toBe(true);
        expect(wrapper.findAll('[data-test="ai-mnav"]')).toHaveLength(1);
        wrapper.unmount();
    });

    it('puts Ask first and the AI Inbox in reach, in the sidebar\'s own order', async () => {
        const { wrapper, nav } = await open();
        expect(primary(nav).map((a) => a.attributes('href')).slice(0, 4)).toEqual(['/c1/ai/ask', '/c1/ai/inbox', '/c1/ai/agents', '/c1/ai/skills']);
        expect(primary(nav).map((a) => a.find('[data-test="ai-mnav-label"]').text())).toEqual(sidebarLabels(wrapper, '.ai-side__nav > .ai-side__item'));
        wrapper.unmount();
    });

    it('shows how many proposals wait in the AI Inbox', async () => {
        const { wrapper, nav } = await open();
        expect(nav.find('[data-test="ai-mnav-count"]').text()).toBe('3');
        wrapper.unmount();
    });

    it('marks the page being shown', async () => {
        const { wrapper, nav } = await open({ start: 'AiInbox' });
        expect(primary(nav)[1].attributes('aria-current')).toBe('page');
        expect(primary(nav)[0].attributes('aria-current')).toBeUndefined();
        wrapper.unmount();
    });

    it('keeps the Setup pages behind More', async () => {
        const { wrapper, nav } = await open();
        const more = nav.find('[data-test="ai-mnav-more"]');
        expect(more.attributes('aria-expanded')).toBe('false');
        expect(more.attributes('aria-label')).toBe('Ai.more');
        await more.trigger('click');
        expect(more.attributes('aria-expanded')).toBe('true');
        const labels = nav.findAll('[data-test="ai-mnav-extra"]').map((a) => a.text());
        expect(labels).toEqual(sidebarLabels(wrapper, '.ai-side__group-body .ai-side__item'));
        expect(labels).toContain('AiHealth.nav');
        expect(labels).not.toContain('Ai.inbox');
        wrapper.unmount();
    });

    it('keeps the workflow builder away from a member', async () => {
        const { wrapper, nav } = await open({ roleType: 3 });
        await nav.find('[data-test="ai-mnav-more"]').trigger('click');
        expect(nav.findAll('[data-test="ai-mnav-extra"]').map((a) => a.text())).not.toContain('WorkflowBuilder.nav');
        wrapper.unmount();
    });

    it('closes More on Escape and after picking a page', async () => {
        const { wrapper, router, nav } = await open();
        const more = nav.find('[data-test="ai-mnav-more"]');
        await more.trigger('click');
        await nav.find('[data-test="ai-mnav-menu"]').trigger('keydown', { key: 'Escape' });
        expect(more.attributes('aria-expanded')).toBe('false');
        await more.trigger('click');
        await nav.findAll('[data-test="ai-mnav-extra"]')[0].trigger('click');
        await flushPromises();
        expect(more.attributes('aria-expanded')).toBe('false');
        expect(router.currentRoute.value.name).not.toBe('AiHub');
        wrapper.unmount();
    });
});
