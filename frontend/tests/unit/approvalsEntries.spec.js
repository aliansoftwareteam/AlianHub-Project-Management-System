/* Task 046: the Approvals page had no way in but its address. It is reached from the Timesheets
   tabs, the rail's More menu and the command palette, by the people who may approve. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { defineComponent, ref } from 'vue';

const { current, router, apiRequest } = vi.hoisted(() => ({
    current: { name: 'Home', path: '/c1/home', params: { cid: 'c1' }, query: {} },
    router: {
        hasRoute: () => true,
        push: vi.fn(() => Promise.resolve()),
        replace: vi.fn(() => Promise.resolve()),
        resolve: (to) => ({ href: `#/named/${to.name}` })
    },
    apiRequest: vi.fn(() => Promise.resolve({ data: { status: true, data: [] } }))
}));
vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn(), apiRequestWithoutSecure: vi.fn(), useAuth: () => ({ logOut: vi.fn() }) }));
vi.mock('vue-router', async (importOriginal) => ({ ...(await importOriginal()), useRoute: () => current, useRouter: () => router }));
vi.mock('vue-toast-notification', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { theme: 'light' }, toggleTheme: vi.fn() }));
vi.mock('@/composable', () => ({ useCustomComposable: () => ({ debounce: (fn) => fn, checkPermission: () => true }) }));

import en from '@/locales/en';
import { useNavItems } from '@/components/organisms/Shell/navItems';
import TimesheetTabs from '@/views/Timesheet/TimesheetTabs.vue';
import CommandPalette from '@/components/molecules/AdvanceSearch/CommandPalette.vue';
import { canApprove } from '@/views/Approvals/approvalAccess';

config.global.plugins[0].global.setLocaleMessage('en', en);

const OWNER = 1;
const ADMIN = 2;
const MEMBER = 3;

const storeFor = (roleType) => createStore({
    getters: { 'settings/rules': () => ({ project: {} }), 'brandSettingTab/brandSettings': () => ({}) },
    modules: {
        users: { namespaced: true, getters: { users: () => [] } },
        projectData: { namespaced: true, getters: { projects: () => ({ data: [] }), allProjects: () => ({ data: [] }) } },
        settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }), teams: () => [] } }
    }
});

const mounted = [];
const keep = (wrapper) => {
    mounted.push(wrapper);
    return wrapper;
};
afterEach(() => { mounted.splice(0).forEach((wrapper) => wrapper.unmount()); });

const RouterLinkStub = { props: ['to'], template: '<a :data-route="to.name"><slot /></a>' };

describe('who may approve', () => {
    it('is an owner or an admin, as the server rules it', () => {
        expect([OWNER, ADMIN, MEMBER, undefined].map((roleType) => canApprove({ roleType }))).toEqual([true, true, false, false]);
        expect(canApprove(undefined)).toBe(false);
    });
});

describe('the rail\'s More menu', () => {
    const Harness = defineComponent({ setup: () => useNavItems(ref('c1')), render: () => null });
    const moreItems = (roleType) => keep(mount(Harness, { global: { plugins: [storeFor(roleType)] } })).vm.more.flatMap((group) => group.items);

    it.each([['an owner', OWNER], ['an admin', ADMIN]])('offers Approvals to %s', (label, roleType) => {
        const item = moreItems(roleType).find((entry) => entry.key === 'approvals');
        expect(item.to).toEqual({ name: 'Approvals', params: { cid: 'c1' }, query: undefined });
        expect(en.Time[item.label.split('.')[1]]).toBe('Approvals');
        expect(item.match({ name: 'Approvals' })).toBe(true);
    });

    it('offers it to no one else', () => {
        expect(moreItems(MEMBER).map((entry) => entry.key)).not.toContain('approvals');
    });
});

describe('the Timesheets tabs', () => {
    const tabs = (roleType, active = 'mine') => keep(mount(TimesheetTabs, {
        props: { active },
        global: { plugins: [storeFor(roleType)], provide: { $companyId: ref('c1') }, stubs: { RouterLink: RouterLinkStub }, mocks: { $t: (key) => key } }
    }));
    const routesOf = (wrapper) => wrapper.findAll('a').map((link) => link.attributes('data-route'));

    it.each([['an owner', OWNER], ['an admin', ADMIN]])('end with Approvals for %s', (label, roleType) => {
        expect(routesOf(tabs(roleType))).toEqual(['User Timesheet', 'project Timesheet', 'Workload Timesheet', 'Tracker Timesheet', 'Approvals']);
    });

    it('leave it out for a member', () => {
        expect(routesOf(tabs(MEMBER))).toEqual(['User Timesheet', 'project Timesheet', 'Workload Timesheet', 'Tracker Timesheet']);
    });

    it('mark it as the current page on the Approvals page', () => {
        const link = tabs(OWNER, 'approvals').findAll('a').find((item) => item.attributes('data-route') === 'Approvals');
        expect(link.attributes('aria-current')).toBe('page');
    });
});

describe('the command palette', () => {
    const found = async (roleType) => {
        const wrapper = keep(mount(CommandPalette, {
            props: { open: true },
            attachTo: document.body,
            global: { plugins: [storeFor(roleType)], stubs: { ShellIcon: true, teleport: true } }
        }));
        await flushPromises();
        await wrapper.find('input').setValue('approvals');
        await flushPromises();
        return wrapper.findAll('[role="option"]').filter((option) => option.attributes('data-kind') === 'nav').map((option) => option.text());
    };

    it('finds Approvals for someone who may approve', async () => {
        expect((await found(OWNER)).some((text) => text.includes('Approvals'))).toBe(true);
    });

    it('does not for a member', async () => {
        expect(await found(MEMBER)).toEqual([]);
    });
});
