import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { createStore } from 'vuex';
import { h } from 'vue';

const { apiRequest, apiRequestWithoutCompnay } = vi.hoisted(() => ({ apiRequest: vi.fn(), apiRequestWithoutCompnay: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay }));
vi.mock('@/composable', () => ({ useCustomComposable: () => ({ checkPermission: () => true }) }));
vi.mock('@/plugins/customFieldView/helper.js', () => ({ customField: () => ({ tabRouteHelper: () => [] }) }));
vi.mock('@/plugins/chargebee/router', () => ({ default: {} }));
vi.mock('@/plugins/paddle/router.js', () => ({ default: {} }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/components/molecules/AddTeamSidebar/AddTeamSidebar.vue', () => ({ default: { name: 'AddTeamSidebar', render: () => null } }));
vi.mock('@/components/organisms/CreateProject/CreateProjectSidebar.vue', () => ({ default: { name: 'CreateProjectSidebar', render: () => null } }));

import SettingsShell from '@/views/Settings/SettingsShell.vue';
import RoutingPolicy from '@/views/Settings/RoutingPolicy/RoutingPolicy.vue';

const ROLE_OWNER = 1;
const ROLE_ADMIN = 2;
const ROLE_MEMBER = 3;

const policy = {
    routerEnabled: false,
    classes: [
        { taskClass: 'classify', model: null, qualityFloor: 'basic', latencyTargetMs: 1500, inputBudgetTokens: 4000 },
        { taskClass: 'agent', model: 'gpt-4.1', qualityFloor: 'high', latencyTargetMs: 30000, inputBudgetTokens: 120000 }
    ]
};
const models = { models: [{ model: 'gpt-4.1', provider: 'openai' }] };

const ok = (data) => Promise.resolve({ data: { status: true, data } });
const storeFor = (roleType) => createStore({
    modules: { settings: { namespaced: true, getters: { companies: () => [], selectedCompany: () => ({}), companyUserDetail: () => ({ roleType }) } } }
});

const page = (name) => ({ render: () => h('div', { 'data-test': `page-${name}` }) });
const routes = [
    { path: '/:cid/settings/my-profile', name: 'My Profile', component: page('profile') },
    { path: '/:cid/settings/routing-policy', name: 'RoutingPolicy', component: page('routing-policy') }
];

const openShell = async (roleType) => {
    apiRequestWithoutCompnay.mockImplementation(() => ok({ allowed: false }));
    const router = createRouter({ history: createMemoryHistory(), routes });
    router.push('/company-1/settings/routing-policy');
    await router.isReady();
    const wrapper = mount(SettingsShell, { global: { plugins: [router, storeFor(roleType)] } });
    await flushPromises();
    return { wrapper, router };
};

const mountPage = async (roleType) => {
    apiRequest.mockImplementation((type, url) => ok(url.includes('routing-policy') ? policy : models));
    const wrapper = mount(RoutingPolicy, { global: { plugins: [storeFor(roleType)] } });
    await flushPromises();
    return wrapper;
};

describe('routing policy in workspace settings', () => {
    beforeEach(() => { apiRequest.mockReset(); apiRequestWithoutCompnay.mockReset(); });

    it('offers the entry to an admin and keeps them on the page', async () => {
        const { wrapper, router } = await openShell(ROLE_ADMIN);
        expect(router.currentRoute.value.name).toBe('RoutingPolicy');
        expect(wrapper.find('.st__nav').text()).toContain('Routing.nav');
        expect(wrapper.find('[data-test="page-routing-policy"]').exists()).toBe(true);
    });

    it('offers the entry to an owner', async () => {
        const { wrapper } = await openShell(ROLE_OWNER);
        expect(wrapper.find('.st__nav').text()).toContain('Routing.nav');
    });

    it('hides the entry from a member and redirects them off the route', async () => {
        const { wrapper, router } = await openShell(ROLE_MEMBER);
        expect(router.currentRoute.value.name).toBe('My Profile');
        expect(wrapper.find('.st__nav').text()).not.toContain('Routing.nav');
        expect(wrapper.find('[data-test="page-routing-policy"]').exists()).toBe(false);
    });

    it('renders the classes and the flag banner for an admin', async () => {
        const wrapper = await mountPage(ROLE_ADMIN);
        expect(wrapper.find('[data-test="routing-policy"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="router-off"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="class-classify"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="model-agent"]').element.value).toBe('gpt-4.1');
    });

    it('renders nothing and asks the server for nothing when a member reaches the page', async () => {
        const wrapper = await mountPage(ROLE_MEMBER);
        expect(wrapper.find('[data-test="routing-policy"]').exists()).toBe(false);
        expect(apiRequest).not.toHaveBeenCalled();
    });

    it('sends the edited classes to the workspace endpoint', async () => {
        const wrapper = await mountPage(ROLE_ADMIN);
        await wrapper.find('[data-test="latency-classify"]').setValue(2000);
        await wrapper.find('[data-test="save-routing"]').trigger('click');
        await flushPromises();
        const put = apiRequest.mock.calls.find((c) => c[0] === 'put');
        expect(put[1]).toBe('/api/v2/agents/routing-policy');
        expect(put[2].classes.classify.latencyTargetMs).toBe(2000);
    });
});
