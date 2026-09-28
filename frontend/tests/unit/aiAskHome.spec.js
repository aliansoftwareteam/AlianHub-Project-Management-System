import { describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createMemoryHistory, createRouter } from 'vue-router';

vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ data: { status: false } })), apiRequestWithoutCompnay: vi.fn() }));
vi.mock('@/composable', () => ({ useCustomComposable: () => ({ checkPermission: () => true }) }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import aiRoutes from '@/router/ai';
import { AI_GATE, aiGateFor } from '@/router/ai/gate';
import { aiAvailability, applyAiAvailability, resetAiAvailability } from '@/composable/aiAvailability';
import { useNavItems } from '@/components/organisms/Shell/navItems';
import AiOffPage from '@/views/Ai/AiOffPage.vue';

const blank = { render: () => null };

const routerFor = () => createRouter({
    history: createMemoryHistory(),
    routes: [
        { path: '/:cid/home', name: 'Home', component: blank },
        { path: '/:cid/workflows', name: 'WorkflowBuilder', component: blank },
        { path: '/:cid/connections', name: 'Connections', component: blank },
        { path: '/:cid/audit', name: 'AuditLog', component: blank },
        { path: '/:cid/settings/setting', name: 'Setting', component: blank },
        ...aiRoutes.map((route) => (route.component ? { ...route, component: blank } : route)),
    ],
});

const landOn = async (path) => {
    const router = routerFor();
    await router.push(path);
    await router.isReady();
    return router.currentRoute.value;
};

describe('Ask is the AI home', () => {
    it('opens Ask from the AI index', async () => {
        const route = await landOn('/c1/ai');
        expect(route.name).toBe('AiAsk');
        expect(route.fullPath).toBe('/c1/ai/ask');
    });

    it('keeps a question passed to the AI index', async () => {
        expect((await landOn('/c1/ai?q=what%20is%20late')).query).toEqual({ q: 'what is late' });
    });

    it.each(['/c1/ai/home', '/c1/ai/analytics'])('sends the old %s link to Ask', async (path) => {
        const route = await landOn(path);
        expect(route.name).toBe('AiAsk');
        expect(route.params.cid).toBe('c1');
    });

    it('has no stub screens left', () => {
        const names = aiRoutes.map((route) => route.name).filter(Boolean);
        expect(names).not.toContain('AiHome');
        expect(names).not.toContain('AiAnalytics');
    });

    it('keeps the AI sidebar beside the AI-off notice, so setup screens stay reachable', async () => {
        applyAiAvailability({ state: 'off_workspace', workspaceEnabled: false });
        const router = routerFor();
        await router.push('/c1/ai');
        await router.isReady();
        expect(aiGateFor(router.currentRoute.value.name, aiAvailability.state)).toBe(AI_GATE.PAGE);
        const store = createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: 1 }) } } } });
        const wrapper = mount(AiOffPage, { global: { plugins: [store, router], provide: { $companyId: 'c1', $userId: 'u1' } } });
        await flushPromises();
        expect(wrapper.find('[data-test="ai-unavailable"]').exists()).toBe(true);
        expect(wrapper.find('.ai-side').exists()).toBe(true);
        wrapper.unmount();
        resetAiAvailability();
    });

    it('points the rail AI tile, and so the phone tab, at Ask', async () => {
        const router = routerFor();
        await router.push('/c1/home');
        await router.isReady();
        const store = createStore({
            modules: {
                settings: { namespaced: true, getters: { rules: () => ({ any: true }), companyUserDetail: () => ({ roleType: 1 }) } },
                brandSettingTab: { namespaced: true, getters: { brandSettings: () => ({}) } },
            },
        });
        let rail;
        const Probe = defineComponent({
            setup() {
                rail = useNavItems(ref('c1')).rail;
                return () => null;
            },
        });
        mount(Probe, { global: { plugins: [store, router] } });
        await flushPromises();
        const ai = rail.value.find((item) => item.key === 'ai');
        expect(ai.to).toMatchObject({ name: 'AiAsk', params: { cid: 'c1' } });
        expect(router.resolve(ai.to).path).toBe('/c1/ai/ask');
    });
});
