import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { createStore } from 'vuex';
import { h } from 'vue';
import { RouterView } from 'vue-router';

const { apiRequestWithoutCompnay } = vi.hoisted(() => ({ apiRequestWithoutCompnay: vi.fn() }));

vi.mock('@/services', () => ({ apiRequestWithoutCompnay }));
vi.mock('@/composable', () => ({ useCustomComposable: () => ({ checkPermission: () => true }) }));
vi.mock('@/plugins/customFieldView/helper.js', () => ({ customField: () => ({ tabRouteHelper: () => [] }) }));
vi.mock('@/plugins/chargebee/router', () => ({ default: {} }));
vi.mock('@/plugins/paddle/router.js', () => ({ default: {} }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/components/molecules/AddTeamSidebar/AddTeamSidebar.vue', () => ({ default: { name: 'AddTeamSidebar', render: () => null } }));
vi.mock('@/components/organisms/CreateProject/CreateProjectSidebar.vue', () => ({ default: { name: 'CreateProjectSidebar', render: () => null } }));

import SettingsShell from '@/views/Settings/SettingsShell.vue';

const auditMounts = { count: 0 };
const page = (name) => ({ render: () => h('div', { 'data-test': `page-${name}` }) });
const routes = [
    { path: '/:cid/settings/my-profile', name: 'My Profile', component: page('profile') },
    { path: '/:cid/settings/setting', name: 'Setting', component: page('setting') },
    { path: '/:cid/settings/instance/health', name: 'InstanceHealth', component: page('health') },
    { path: '/:cid/settings/instance/settings', name: 'InstanceSettings', component: page('instance-settings') },
    { path: '/:cid/settings/audit-logs', name: 'AuditLog', component: { mounted: () => { auditMounts.count += 1; }, render: () => h('div', { 'data-test': 'page-audit' }) } },
    {
        path: '/:cid/settings/console',
        name: 'Instance',
        component: { render: () => h(RouterView) },
        children: [{ path: 'enforcement', name: 'InstanceEnforcement', component: page('enforcement') }]
    }
];

const roleType = { value: 1 };
const storeFor = (role) => createStore({
    modules: { settings: { namespaced: true, getters: { companies: () => [], selectedCompany: () => ({}), companyUserDetail: () => ({ roleType: role }) } } }
});

const access = (allowed) => Promise.resolve({ data: { status: true, data: { allowed } } });
const pending = () => new Promise(() => {});

const open = async (path, answer) => {
    apiRequestWithoutCompnay.mockImplementation(answer);
    const router = createRouter({ history: createMemoryHistory(), routes });
    router.push(path);
    await router.isReady();
    const wrapper = mount(SettingsShell, { global: { plugins: [router, storeFor(roleType.value)] } });
    await flushPromises();
    return { wrapper, router };
};

describe('SettingsShell instance route guard', () => {
    beforeEach(() => { apiRequestWithoutCompnay.mockReset(); roleType.value = 1; });

    it('holds an instance route without rendering it while the access check is pending', async () => {
        const { wrapper, router } = await open('/company-1/settings/instance/settings', pending);
        expect(router.currentRoute.value.name).toBe('InstanceSettings');
        expect(wrapper.find('[data-test="page-instance-settings"]').exists()).toBe(false);
        expect(wrapper.find('.st__nav').text()).not.toContain('Instance.nav_settings');
    });

    it('stays on the instance route and renders it once access is allowed', async () => {
        const { wrapper, router } = await open('/company-1/settings/instance/settings', () => access(true));
        expect(router.currentRoute.value.name).toBe('InstanceSettings');
        expect(wrapper.find('[data-test="page-instance-settings"]').exists()).toBe(true);
        expect(wrapper.find('.st__nav').text()).toContain('Instance.nav_settings');
    });

    it('redirects a member to My Profile once access is denied', async () => {
        const { wrapper, router } = await open('/company-1/settings/instance/settings', () => access(false));
        expect(router.currentRoute.value.name).toBe('My Profile');
        expect(wrapper.find('[data-test="page-profile"]').exists()).toBe(true);
        expect(wrapper.find('.st__nav').text()).not.toContain('Instance.nav_settings');
    });

    it('treats a failed access check as denied', async () => {
        const { router } = await open('/company-1/settings/instance/settings', () => Promise.reject(new Error('boom')));
        expect(router.currentRoute.value.name).toBe('My Profile');
    });

    it('keeps in-shell navigation between instance routes for an owner', async () => {
        const { wrapper, router } = await open('/company-1/settings/setting', () => access(true));
        await router.push({ name: 'InstanceHealth', params: { cid: 'company-1' } });
        await flushPromises();
        expect(router.currentRoute.value.name).toBe('InstanceHealth');
        expect(wrapper.find('[data-test="page-health"]').exists()).toBe(true);
    });

    it('redirects a member who navigates to an instance route from inside the shell', async () => {
        const { router } = await open('/company-1/settings/setting', () => access(false));
        await router.push({ name: 'InstanceHealth', params: { cid: 'company-1' } });
        await flushPromises();
        expect(router.currentRoute.value.name).toBe('My Profile');
    });

    it('leaves non-instance routes alone while the check is pending', async () => {
        const { wrapper, router } = await open('/company-1/settings/setting', pending);
        expect(router.currentRoute.value.name).toBe('Setting');
        expect(wrapper.find('[data-test="page-setting"]').exists()).toBe(true);
    });

    it('redirects a member away from an instance console tab that has no nav item of its own', async () => {
        const { wrapper, router } = await open('/company-1/settings/console/enforcement', () => access(false));
        expect(router.currentRoute.value.name).toBe('My Profile');
        expect(wrapper.find('[data-test="page-enforcement"]').exists()).toBe(false);
    });

    it('holds an instance console tab while the access check is pending, then shows it to the instance owner', async () => {
        const held = await open('/company-1/settings/console/enforcement', pending);
        expect(held.wrapper.find('[data-test="page-enforcement"]').exists()).toBe(false);
        const { wrapper, router } = await open('/company-1/settings/console/enforcement', () => access(true));
        expect(router.currentRoute.value.name).toBe('InstanceEnforcement');
        expect(wrapper.find('[data-test="page-enforcement"]').exists()).toBe(true);
    });
});

describe('SettingsShell hidden routes', () => {
    beforeEach(() => { apiRequestWithoutCompnay.mockReset(); roleType.value = 1; });

    it('never mounts a page the nav hides from this role, so it cannot fire its own refused requests', async () => {
        roleType.value = 3;
        auditMounts.count = 0;
        const { router } = await open('/company-1/settings/audit-logs', () => access(false));
        expect(router.currentRoute.value.name).toBe('My Profile');
        expect(auditMounts.count).toBe(0);
    });

    it('shows the audit log to an owner', async () => {
        const { wrapper, router } = await open('/company-1/settings/audit-logs', () => access(false));
        expect(router.currentRoute.value.name).toBe('AuditLog');
        expect(wrapper.find('[data-test="page-audit"]').exists()).toBe(true);
    });
});
