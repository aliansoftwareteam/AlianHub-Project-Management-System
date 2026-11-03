import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest, apiRequestWithoutCompnay, route, router } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    apiRequestWithoutCompnay: vi.fn(),
    route: { query: {}, params: { cid: 'c1' } },
    router: { replace: vi.fn() },
}));

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay }));
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => router }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/views/Ai/AiSidebar.vue', () => ({ default: { name: 'AiSidebar', render: () => null } }));

import ConnectionsPage from '@/views/Integrations/ConnectionsPage.vue';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);
const t = i18n.global.t;

const OWNER = 1;
const MEMBER = 3;
const GUEST = 0;
const CONN = '/api/v2/connectors';

const aiRules = () => ({ artificial_intelligence: { ai_connectors: { roles: [{ key: 3, permission: true }] } } });
const storeFor = (roleType) => createStore({ modules: {
    settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }), companyUsers: () => [], rules: () => aiRules() } },
    users: { namespaced: true, getters: { users: () => [] } },
} });

const openPage = async (catalogue, roleType) => {
    route.query = {};
    apiRequest.mockImplementation((method, url) => {
        if (url.endsWith('/catalog')) return Promise.resolve({ data: catalogue });
        if (url === CONN) return Promise.resolve({ data: { status: true, data: { providers: [], connections: [] } } });
        if (url === `${CONN}/members`) return Promise.resolve({ data: { status: true, data: { connections: [] } } });
        if (url === `${CONN}/apps`) return Promise.resolve({ data: { status: true, data: { apps: [], catalog: [] } } });
        return Promise.resolve({ data: { status: true, data: [] } });
    });
    apiRequestWithoutCompnay.mockResolvedValue({ data: { status: true, data: {} } });
    const wrapper = mount(ConnectionsPage, { global: { plugins: [storeFor(roleType)], mocks: { $t: t }, stubs: { 'router-link': true } } });
    await flushPromises();
    return wrapper;
};

const hitConnectorRoute = () => apiRequest.mock.calls.some(([, url]) => url === CONN || url === `${CONN}/members` || url === `${CONN}/apps`);

beforeEach(() => {
    apiRequest.mockReset();
    apiRequestWithoutCompnay.mockReset();
});

describe('the three connection cards gate on what the server actually serves', () => {
    it('shows none of them, and calls none of their routes, while no registry provider is named', async () => {
        const wrapper = await openPage({ status: true, data: [] }, OWNER);
        expect(wrapper.find('[data-test="my-connections"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="admin-connections"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="company-apps"]').exists()).toBe(false);
        expect(hitConnectorRoute()).toBe(false);
    });

    it('shows My connections to a member once a registry provider is named', async () => {
        const wrapper = await openPage({ status: true, data: [], registryConnectors: true }, MEMBER);
        expect(wrapper.find('[data-test="my-connections"]').exists()).toBe(true);
    });

    it('hides My connections from a guest even when a registry provider is named', async () => {
        const wrapper = await openPage({ status: true, data: [], registryConnectors: true }, GUEST);
        expect(wrapper.find('[data-test="my-connections"]').exists()).toBe(false);
        expect(apiRequest.mock.calls.some(([, url]) => url === CONN)).toBe(false);
    });

    it('shows Everyone\'s connections to an owner once a registry provider is named', async () => {
        const wrapper = await openPage({ status: true, data: [], registryConnectors: true }, OWNER);
        expect(wrapper.find('[data-test="admin-connections"]').exists()).toBe(true);
        expect(apiRequest.mock.calls.some(([, url]) => url === `${CONN}/members`)).toBe(true);
    });

    it('shows Company OAuth apps to an owner once a connector is requested, with no registry provider needed', async () => {
        const wrapper = await openPage({ status: true, data: [], connectors: ['slack'] }, OWNER);
        expect(wrapper.find('[data-test="company-apps"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="admin-connections"]').exists()).toBe(false);
        expect(apiRequest.mock.calls.some(([, url]) => url === `${CONN}/apps`)).toBe(true);
    });
});
