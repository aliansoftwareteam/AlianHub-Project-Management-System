/* Task 046 M3, slice G3: the Goals page has a route of its own, a second one that opens a goal in
   its panel, and a rail item after Everything. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { defineComponent, ref } from 'vue';

const { current } = vi.hoisted(() => ({ current: { name: 'Home', path: '/c1/home' } }));
vi.mock('@/services', () => ({ apiRequest: vi.fn(), apiRequestWithoutCompnay: vi.fn(), apiRequestWithoutSecure: vi.fn() }));
vi.mock('vue-router', async (importOriginal) => ({
    ...(await importOriginal()),
    useRoute: () => current,
    useRouter: () => ({ hasRoute: () => true })
}));
vi.mock('@/composable', () => ({ useCustomComposable: () => ({ checkPermission: () => null }) }));

import homeRoutes from '@/router/home';
import { useNavItems } from '@/components/organisms/Shell/navItems';
import en from '@/locales/en';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const Harness = defineComponent({ setup: () => useNavItems(ref('c1')), render: () => null });
const mountNav = ({ rules = { project: {} }, roleType = 3 } = {}) => mount(Harness, {
    global: {
        plugins: [createStore({
            getters: {
                'settings/rules': () => rules,
                'settings/companyUserDetail': () => ({ roleType }),
                'brandSettingTab/brandSettings': () => ({})
            }
        })]
    }
});
const item = (nav = mountNav()) => nav.vm.rail.find((entry) => entry.key === 'goals');

describe('the routes', () => {
    const list = homeRoutes.find((entry) => entry.name === 'Goals');
    const one = homeRoutes.find((entry) => entry.name === 'Goal');

    it('are /:cid/goals and /:cid/goals/:goalId, behind sign-in', () => {
        expect(list).toMatchObject({ path: '/:cid/goals', meta: { requiresAuth: true } });
        expect(one).toMatchObject({ path: '/:cid/goals/:goalId', meta: { requiresAuth: true } });
    });

    it('load the same page, so opening a goal keeps the list on screen', async () => {
        const page = (await list.component()).default;
        expect(page.name || page.__name).toMatch(/Goals/);
        expect((await one.component()).default).toBe(page);
    });
});

describe('the rail item', () => {
    it('sits after Everything and opens the page', () => {
        const nav = mountNav();
        expect(nav.vm.rail.map((entry) => entry.key).slice(0, 3)).toEqual(['home', 'everything', 'goals']);
        expect(item(nav).to).toEqual({ name: 'Goals', params: { cid: 'c1' }, query: undefined });
        expect(item(nav).label).toBe('Shell.goals');
        expect(en.Shell.goals).toBe('Goals');
    });

    it('is lit on the list and on an open goal, and nowhere else', () => {
        const nav = mountNav();
        expect(nav.vm.isActive(item(nav))).toBe(false);
        expect(item(nav).match({ name: 'Goals' })).toBe(true);
        expect(item(nav).match({ name: 'Goal' })).toBe(true);
        expect(item(nav).match({ name: 'Everything' })).toBe(false);
        expect(nav.vm.rail.find((entry) => entry.key === 'everything').match({ name: 'Goals' })).toBe(false);
    });

    it('needs no project permission, only a loaded workspace, and is there for a guest too', () => {
        expect(item()).toBeTruthy();
        expect(item(mountNav({ roleType: 0 }))).toBeTruthy();
        expect(item(mountNav({ rules: {} }))).toBeUndefined();
    });

    it('can be pinned: the server knows its id', () => {
        const source = fs.readFileSync(path.join(ROOT, 'Modules/Users/helpers/navPreferencesRules.js'), 'utf8');
        expect(source).toMatch(/NAV_ITEM_IDS = \[[^\]]*'goals'/);
    });
});

describe('the icon', () => {
    it('is one the shell icon set draws', async () => {
        const ShellIcon = (await import('@/components/organisms/Shell/ShellIcon.vue')).default;
        const drawn = (name) => mount(ShellIcon, { props: { name } }).html();
        expect(item().icon).toBe('target');
        expect(drawn('target')).not.toBe(drawn('no-such-icon'));
    });
});
