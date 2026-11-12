import { beforeEach, describe, expect, it, vi } from 'vitest';
import { h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { RouterView, createMemoryHistory, createRouter } from 'vue-router';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/views/Ai/AiSidebar.vue', () => ({ default: { name: 'AiSidebar', render: () => null } }));
vi.mock('@/views/Ai/ConnectYourAi.vue', () => ({ default: { name: 'ConnectYourAi', props: { embedded: Boolean }, render() { return h('div', { 'data-test': 'connect-ai', 'data-embedded': String(this.embedded) }); } } }));
vi.mock('@/views/Integrations/ConnectorsTab.vue', () => ({
    default: { name: 'ConnectorsTab', props: ['available', 'guest', 'privileged', 'legacyGoogle'], emits: ['open-workspace'], render() { return h('div', { 'data-test': 'connectors-tab', 'data-available': String(this.available), 'data-legacy': String(this.legacyGoogle) }); } },
}));
vi.mock('@/views/Integrations/ConnectorsWorkspace.vue', () => ({
    default: { name: 'ConnectorsWorkspace', props: ['registry', 'apps', 'limits'], render() { return h('div', { 'data-test': 'workspace-tab', 'data-limits': String(this.limits) }); } },
}));

import CustomizePage from '@/views/Ai/CustomizePage.vue';
import aiRoutes from '@/router/ai';
import integrationRoutes from '@/router/integrations';
import { CUSTOMIZE_ROUTE } from '@/router/ai/customize';

const blank = { render: () => null };
const OWNER = 1;
const MEMBER = 3;
const CATALOGUE = { status: true, data: [], connectors: ['google', 'google_calendar'], registryConnectors: true, connectorLimits: true };

const routerFor = () => createRouter({
    history: createMemoryHistory(),
    routes: [...aiRoutes, ...integrationRoutes].map((route) => (route.component ? { ...route, component: route.name === CUSTOMIZE_ROUTE ? CustomizePage : blank } : route)),
});

/* A member whose role may connect their own AI, unless `ownAi` is false. */
const storeFor = (roleType, ownAi = true) => createStore({ modules: {
    settings: { namespaced: true, getters: {
        companyUserDetail: () => ({ roleType }),
        rules: () => ({ artificial_intelligence: { ai_external_clients: { roles: [{ key: MEMBER, permission: ownAi }] } } }),
    } },
} });

const open = async ({ roleType = MEMBER, ownAi = true, path = '/c1/ai/customize' } = {}) => {
    const router = routerFor();
    await router.push(path);
    await router.isReady();
    const wrapper = mount({ render: () => h(RouterView) }, { global: { plugins: [storeFor(roleType, ownAi), router], provide: { $companyId: 'c1', $userId: 'u1' } } });
    await flushPromises();
    return { wrapper, router };
};

const tabs = (wrapper) => wrapper.findAll('[role="tab"]').map((tab) => tab.attributes('data-test'));

beforeEach(() => {
    apiRequest.mockReset();
    apiRequest.mockImplementation((method, url) => Promise.resolve({ data: url.endsWith('/catalog') ? CATALOGUE : { status: true, data: [] } }));
});

describe('the Customize page', () => {
    it('opens on Connectors and hands it what the server registered', async () => {
        const { wrapper } = await open();
        expect(wrapper.find('[data-test="cz-tab-connectors"]').attributes('aria-selected')).toBe('true');
        const tab = wrapper.find('[data-test="connectors-tab"]');
        expect(tab.attributes('data-available')).toBe('true');
        expect(tab.attributes('data-legacy')).toBe('true');
    });

    it('keeps the Workspace tab for owners and admins', async () => {
        expect(tabs((await open({ roleType: MEMBER })).wrapper)).toEqual(['cz-tab-connectors', 'cz-tab-connect-ai']);
        expect(tabs((await open({ roleType: OWNER })).wrapper)).toEqual(['cz-tab-connectors', 'cz-tab-connect-ai', 'cz-tab-workspace']);
        expect(tabs((await open({ roleType: MEMBER, ownAi: false })).wrapper)).toEqual(['cz-tab-connectors']);
    });

    it('shows a member who asks for the Workspace tab their connectors instead', async () => {
        const { wrapper } = await open({ roleType: MEMBER, path: '/c1/ai/customize?tab=workspace' });
        expect(wrapper.find('[data-test="workspace-tab"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="connectors-tab"]').exists()).toBe(true);
    });

    it('switches tabs through the address, by click and by arrow key', async () => {
        const { wrapper, router } = await open({ roleType: OWNER });
        await wrapper.find('[data-test="cz-tab-workspace"]').trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.query.tab).toBe('workspace');
        expect(wrapper.find('[data-test="workspace-tab"]').attributes('data-limits')).toBe('true');

        await wrapper.find('[data-test="cz-tab-workspace"]').trigger('keydown', { key: 'ArrowRight' });
        await flushPromises();
        expect(router.currentRoute.value.query.tab).toBeUndefined();
        expect(wrapper.find('[data-test="connectors-tab"]').exists()).toBe(true);

        await wrapper.find('[data-test="cz-tab-connectors"]').trigger('keydown', { key: 'ArrowRight' });
        await flushPromises();
        expect(wrapper.find('[data-test="connect-ai"]').attributes('data-embedded')).toBe('true');
    });

    it('calls no connector route while the server registers none', async () => {
        apiRequest.mockImplementation(() => Promise.resolve({ data: { status: true, data: [] } }));
        const { wrapper } = await open();
        expect(wrapper.find('[data-test="connectors-tab"]').attributes('data-available')).toBe('false');
        expect(apiRequest.mock.calls.map(([, url]) => url)).toEqual(['/api/v1/integrations/catalog']);
    });
});

describe('the old addresses', () => {
    const landOn = async (to) => {
        const router = routerFor();
        await router.push(to);
        await router.isReady();
        return router.currentRoute.value;
    };

    it('send Connections, App connections and Connect your AI to Customize', async () => {
        expect(await landOn({ name: 'Connections', params: { cid: 'c1' } })).toMatchObject({ name: CUSTOMIZE_ROUTE, params: { cid: 'c1' }, query: {} });
        expect(await landOn('/c1/app-connections')).toMatchObject({ name: CUSTOMIZE_ROUTE, params: { cid: 'c1' } });
        expect(await landOn({ name: 'AiConnect', params: { cid: 'c1' } })).toMatchObject({ name: CUSTOMIZE_ROUTE, query: { tab: 'connect-ai' } });
    });

    it('carry a provider\'s sign-in return along, so it still finishes', async () => {
        const route = await landOn('/c1/connections?connector=notion&state=s&code=c');
        expect(route).toMatchObject({ name: CUSTOMIZE_ROUTE, query: { connector: 'notion', state: 's', code: 'c' } });
    });

    it('let a GitHub workspace sign-in started on App connections finish there', async () => {
        expect(await landOn('/c1/app-connections?github=1&state=s&code=c')).toMatchObject({ name: 'AppConnections' });
    });
});
