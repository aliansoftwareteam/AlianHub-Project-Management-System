import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';

const { apiRequestWithoutCompnay } = vi.hoisted(() => ({ apiRequestWithoutCompnay: vi.fn() }));

vi.mock('@/services', () => ({ apiRequestWithoutCompnay, getAuth: () => Promise.resolve() }));
vi.mock('@/composable', () => ({
    useGetterFunctions: () => ({ getUser: () => ({ Employee_Email: 'owner@example.test' }) }),
    useCustomComposable: () => ({ makeUniqueId: () => 'abc' })
}));
vi.mock('@/config/publicConfig', () => ({ isManagedHosting: () => true }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: () => Promise.resolve() }) }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/components/molecules/Sidebar/Sidebar.vue', () => ({
    default: { name: 'Sidebar', props: ['visible'], template: '<div v-if="visible"><slot name="body" /></div>' }
}));

import CreateWorkspaceSidebar from '@/components/organisms/CreateWorkspaceSidebar/CreateWorkspaceSidebar.vue';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);

vi.stubGlobal('EventSource', class { close() {} });

const PLAN = '/api/v2/plan/workspaces';
const CREATE = '/api/v2/company/create';

const open = async (room) => {
    apiRequestWithoutCompnay.mockImplementation((method, url) => {
        if (url === PLAN) return Promise.resolve({ data: { data: { managed: true, ...room } } });
        if (url === CREATE) return Promise.resolve({ data: { status: false, code: 'workspace_limit' } });
        return Promise.resolve({ data: {} });
    });
    const store = createStore({ modules: { settings: { namespaced: true, getters: { companies: () => [{ Cst_CompanyName: 'Acme HQ' }] } } } });
    const wrapper = mount(CreateWorkspaceSidebar, {
        props: { visible: true },
        global: { plugins: [store], provide: { $userId: ref('u1') }, mocks: { $t: i18n.global.t } }
    });
    await flushPromises();
    return wrapper;
};

const createCalls = () => apiRequestWithoutCompnay.mock.calls.filter(([method, url]) => method === 'post' && url === CREATE);

beforeEach(() => apiRequestWithoutCompnay.mockReset());

describe('the New workspace sidebar', () => {
    it('at the plan limit says so, points to adding workspaces, and does not create', async () => {
        const wrapper = await open({ count: 2, limit: 2, canCreate: false, portalUrl: 'https://account.example.test' });
        expect(wrapper.find('[data-test="workspace-limit"]').text()).toContain(en.Plan.banner.add_workspaces);
        expect(wrapper.find('[data-test="create-workspace-submit"]').attributes('disabled')).toBeDefined();
        await wrapper.find('form').trigger('submit');
        await flushPromises();
        expect(createCalls()).toHaveLength(0);
    });

    it('with room left, refuses a name already in use, then creates with a sample project', async () => {
        const wrapper = await open({ count: 1, limit: 3, canCreate: true });
        expect(wrapper.find('[data-test="workspace-count"]').exists()).toBe(true);

        await wrapper.find('#cws-name').setValue('acme hq');
        await wrapper.find('form').trigger('submit');
        await flushPromises();
        expect(createCalls()).toHaveLength(0);

        await wrapper.find('#cws-name').setValue('Beta Labs');
        await wrapper.find('form').trigger('submit');
        await flushPromises();
        const [[, , body]] = createCalls();
        expect(body).toMatchObject({ companyName: 'Beta Labs', seedSampleProject: true, teamFocus: 'other', email: 'owner@example.test' });
    });
});
