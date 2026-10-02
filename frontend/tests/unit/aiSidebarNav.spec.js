import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createMemoryHistory, createRouter } from 'vue-router';

vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/views/Ai/useLiveAgents', () => ({ useLiveAgents: () => ({ running: { value: 0 }, refresh: vi.fn() }) }));
vi.mock('@/views/Ai/useAgents', () => ({
    useAgents: () => ({ waiting: { value: 2 }, running: { value: 0 }, spend: { value: { totalUsd: 0, agents: [] } }, pauseAll: vi.fn() }),
}));

import AiSidebar from '@/views/Ai/AiSidebar.vue';
import aiRoutes from '@/router/ai';
import { isAiSectionRoute } from '@/router/ai/section';

const blank = { render: () => null };

const routerFor = () => createRouter({
    history: createMemoryHistory(),
    routes: [
        ...aiRoutes.map((route) => (route.component ? { ...route, component: blank } : route)),
        { path: '/:cid/workflows', name: 'WorkflowBuilder', component: blank },
        { path: '/:cid/connections', name: 'Connections', component: blank },
        { path: '/:cid/audit', name: 'AuditLog', component: blank },
    ],
});

const storeFor = (roleType) => createStore({
    modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }) } } },
});

const open = async (roleType = 1, start = 'AiAsk') => {
    const router = routerFor();
    await router.push({ name: start, params: { cid: 'c1' } });
    await router.isReady();
    const wrapper = mount(AiSidebar, {
        global: { plugins: [storeFor(roleType), router], provide: { $companyId: 'c1', $userId: 'u1' } },
    });
    await flushPromises();
    return wrapper;
};

const labels = (links) => links.map((link) => link.find('span').text());
const groupOpen = (wrapper) => wrapper.find('[data-test="ai-setup-toggle"]').attributes('aria-expanded') === 'true';
const groupHiddenStyle = (wrapper) => (wrapper.find('#ai-side-setup').attributes('style') || '').includes('display: none');
const everyday = (wrapper) => labels(wrapper.findAll('.ai-side__nav > .ai-side__item'));
const setup = (wrapper) => labels(wrapper.findAll('.ai-side__group-body .ai-side__item'));

describe('AI sidebar structure', () => {
    beforeEach(() => localStorage.clear());

    it('leads the everyday entries with Ask and keeps the consoles out of them', async () => {
        const wrapper = await open();
        expect(everyday(wrapper)).toEqual(['Parity.nav_ask', 'Ai.inbox', 'Ai.agents', 'Ai.skills', 'Parity.nav_connections', 'ConnectAi.title']);
        expect(wrapper.find('.ai-side__count').text()).toBe('2');
        expect(setup(wrapper)).toContain('AiHealth.nav');
        expect(setup(wrapper)).not.toContain('Parity.nav_ask');
    });

    it('marks Ask as the current page on the AI home', async () => {
        const first = (await open()).find('.ai-side__nav > .ai-side__item');
        expect(first.classes()).toContain('router-link-active');
        expect(first.attributes('aria-current')).toBe('page');
    });

    it('starts the setup group collapsed and remembers the toggle', async () => {
        const wrapper = await open();
        expect(groupOpen(wrapper)).toBe(false);
        expect(groupHiddenStyle(wrapper)).toBe(true);

        await wrapper.find('[data-test="ai-setup-toggle"]').trigger('click');
        expect(groupOpen(wrapper)).toBe(true);
        expect(groupHiddenStyle(wrapper)).toBe(false);
        expect(localStorage.getItem('ah.ai.setup')).toBe('1');
    });

    it('opens the group when the page behind it is the one being shown', async () => {
        expect(groupOpen(await open(1, 'AiHealth'))).toBe(true);
        expect(groupOpen(await open(1, 'AiAsk'))).toBe(false);
    });

    it('keeps the workflow builder out of a member setup group', async () => {
        expect(setup(await open(1))).toContain('WorkflowBuilder.nav');
        expect(setup(await open(3))).not.toContain('WorkflowBuilder.nav');
    });
});

describe('AI section membership', () => {
    it('claims the section screens that are not named with the Ai prefix', () => {
        ['AiAsk', 'AiHub', 'AgentTeammates', 'AgentRouting', 'WorkflowBuilder', 'WorkflowRun', 'WorkflowLineage', 'Connections']
            .forEach((name) => expect(isAiSectionRoute(name)).toBe(true));
    });

    it('leaves other sections alone', () => {
        ['Home', 'Projects', 'AuditLog', 'Automations', undefined].forEach((name) => expect(isAiSectionRoute(name)).toBe(false));
    });
});
