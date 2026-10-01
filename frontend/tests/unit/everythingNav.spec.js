/* Task 046 M2, slice E2: the Everything page has a route of its own and a rail item between
   Home and Projects, shown to anyone whose workspace has loaded. */
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { defineComponent, ref } from 'vue';

const { permissions, current } = vi.hoisted(() => ({ permissions: { denied: [] }, current: { name: 'Home', path: '/c1/home' } }));
vi.mock('@/services', () => ({ apiRequest: vi.fn(), apiRequestWithoutCompnay: vi.fn(), apiRequestWithoutSecure: vi.fn() }));
vi.mock('vue-router', async (importOriginal) => ({
    ...(await importOriginal()),
    useRoute: () => current,
    useRouter: () => ({ hasRoute: () => true })
}));
vi.mock('@/composable', async (importOriginal) => {
    const real = await importOriginal();
    return { ...real, useCustomComposable: () => ({ ...real.useCustomComposable(), checkPermission: (key) => (permissions.denied.includes(key) ? null : true) }) };
});

import homeRoutes from '@/router/home';
import { useNavItems } from '@/components/organisms/Shell/navItems';
import en from '@/locales/en';

const Harness = defineComponent({ setup: () => useNavItems(ref('c1')), render: () => null });
const mountNav = (rules = { project: {} }) => mount(Harness, {
    global: {
        plugins: [createStore({
            getters: {
                'settings/rules': () => rules,
                'settings/companyUserDetail': () => ({ roleType: 3 }),
                'brandSettingTab/brandSettings': () => ({})
            }
        })]
    }
});

describe('the route', () => {
    const route = homeRoutes.find((entry) => entry.name === 'Everything');

    it('is /:cid/everything, behind sign-in, and loads the page on its own', () => {
        expect(route).toMatchObject({ path: '/:cid/everything', meta: { requiresAuth: true } });
        expect(typeof route.component).toBe('function');
    });

    it('is not the project page', async () => {
        const page = (await route.component()).default;
        expect(page.name || page.__name).toMatch(/Everything/);
    });
});

describe('the rail item', () => {
    it('sits between Home and Projects and opens the page', () => {
        const { rail } = mountNav().vm;
        const keys = rail.map((item) => item.key);
        expect(keys.slice(0, 3)).toEqual(['home', 'everything', 'projects']);
        const item = rail.find((entry) => entry.key === 'everything');
        expect(item.to).toEqual({ name: 'Everything', params: { cid: 'c1' }, query: undefined });
        expect(item.icon).toBe('layers');
        expect(en.Shell.everything).toBe('Everything');
        expect(item.label).toBe('Shell.everything');
    });

    it('is lit on the page and nowhere else', () => {
        const { rail, isActive } = mountNav().vm;
        const item = rail.find((entry) => entry.key === 'everything');
        expect(isActive(item)).toBe(false);
        expect(item.match({ name: 'Everything' })).toBe(true);
        expect(rail.find((entry) => entry.key === 'home').match({ name: 'Everything' })).toBe(false);
        expect(rail.find((entry) => entry.key === 'projects').match({ name: 'Everything' })).toBe(false);
    });

    it('needs no project permission, only a loaded workspace', () => {
        permissions.denied = ['project.project_list'];
        const keys = mountNav().vm.rail.map((item) => item.key);
        expect(keys).toContain('everything');
        expect(keys).not.toContain('projects');
        permissions.denied = [];

        expect(mountNav({}).vm.rail.map((item) => item.key)).not.toContain('everything');
    });
});

describe('the icon', () => {
    it('is one the shell icon set draws', async () => {
        const ShellIcon = (await import('@/components/organisms/Shell/ShellIcon.vue')).default;
        const drawn = (name) => mount(ShellIcon, { props: { name } }).html();
        expect(drawn('layers')).not.toBe(drawn('no-such-icon'));
    });
});
