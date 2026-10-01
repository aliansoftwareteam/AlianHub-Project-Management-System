/* Task 047, slice S-1: Simple shows five places and tucks the rest into More; Full is the app as it was.
   The choice only hides entry points: no route, role or permission reads it. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';
import { createStore } from 'vuex';
import { defineComponent, nextTick, ref } from 'vue';
import fs from 'fs';
import path from 'path';

const { permissions, people, current, apiRequestWithoutCompnay, fetchDashboards } = vi.hoisted(() => ({
    permissions: { denied: [] },
    people: { list: [] },
    current: { name: 'Home', path: '/c1/home', fullPath: '/c1/home' },
    apiRequestWithoutCompnay: vi.fn(),
    fetchDashboards: vi.fn()
}));
vi.mock('@/services', () => ({ apiRequest: vi.fn(), apiRequestWithoutCompnay, apiRequestWithoutSecure: vi.fn(), useAuth: () => ({ logOut: vi.fn() }) }));
vi.mock('vue-router', async (importOriginal) => ({
    ...(await importOriginal()),
    useRoute: () => current,
    useRouter: () => ({ hasRoute: () => true, resolve: () => ({ href: '#/' }) })
}));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: (key) => (permissions.denied.includes(key) ? null : true) }),
    useGetterFunctions: () => ({ getUser: () => ({ Employee_Name: 'Pat', Employee_Email: 'pat@example.test' }) })
}));
vi.mock('@/plugins/dashboard/dashboardsApi', () => ({ fetchDashboards }));
vi.mock('@/composable/useAppVersion', () => ({ useAppVersion: () => ({ version: { value: '1.0.0' } }) }));

import homeRoutes from '@/router/home';
import en from '@/locales/en';
import { useNavItems } from '@/components/organisms/Shell/navItems';
import { shellState } from '@/components/organisms/Shell/shellState';
import { SIMPLE_PLACES, navModeOf } from '@/components/organisms/Shell/navMode';
import { placesInUse } from '@/components/organisms/Shell/placesInUse';
import { AI_STATE, applyAiAvailability, resetAiAvailability } from '@/composable/aiAvailability';
import MobileTabBar from '@/components/organisms/Shell/MobileTabBar.vue';
import NavModePicker from '@/views/Settings/MySettings/NavModePicker.vue';
import GlobalRail from '@/components/organisms/Shell/GlobalRail.vue';

const SRC = path.resolve(__dirname, '../../src');
const ROUTE = '/api/v2/users/nav-preferences';
const FULL_RAIL = ['home', 'everything', 'goals', 'projects', 'inbox', 'planner', 'chat', 'ai', 'docs', 'dash', 'time'];
const TUCKED = ['goals', 'planner', 'chat', 'docs', 'dash', 'time'];
const MORE_GROUPS = ['Shell.work', 'Header.Reports', 'Shell.tools', 'Shell.workspace'];

const store = () => createStore({
    modules: {
        settings: { namespaced: true, getters: { rules: () => ({ project: {} }), companyUserDetail: () => ({ roleType: 3 }), companies: () => [] } },
        users: { namespaced: true, getters: { myCounts: () => ({ data: {} }), users: () => people.list } },
        brandSettingTab: { namespaced: true, getters: { brandSettings: () => ({}) } }
    }
});

const Harness = defineComponent({ setup: () => useNavItems(ref('c1')), render: () => null });
const mounted = [];
const mountNav = () => {
    const wrapper = mount(Harness, { global: { plugins: [store()] } });
    mounted.push(wrapper);
    return wrapper.vm;
};
const keysOf = (items) => items.map((item) => item.key);
const at = (name) => Object.assign(current, { name, path: `/c1/${name}`, fullPath: `/c1/${name}` });
const use = (mode, pinned = []) => { shellState.nav = { pinned, mode }; };

beforeEach(() => {
    localStorage.clear();
    permissions.denied = [];
    people.list = [];
    at('Home');
    use('full');
    applyAiAvailability({ state: AI_STATE.ON, loaded: true, planAllowsAi: true });
    apiRequestWithoutCompnay.mockReset();
    apiRequestWithoutCompnay.mockResolvedValue({ data: { status: true, data: {} } });
    fetchDashboards.mockReset();
    fetchDashboards.mockResolvedValue([]);
});
afterEach(() => {
    mounted.splice(0).forEach((wrapper) => wrapper.unmount());
    resetAiAvailability();
});

describe('Full', () => {
    it('is the app as it was: eleven places and the same More menu', () => {
        const nav = mountNav();
        expect(keysOf(nav.rail)).toEqual(FULL_RAIL);
        expect(nav.more.map((group) => group.label)).toEqual(MORE_GROUPS);
        expect(nav.rail.find((item) => item.key === 'everything')).toMatchObject({ label: 'Shell.everything', to: { name: 'Everything', query: undefined } });
        expect(nav.rail.find((item) => item.key === 'ai')).toMatchObject({ label: 'Shell.ai', to: { name: 'AiAsk' } });
    });

    it('is what an unknown or missing choice means', () => {
        expect(navModeOf(undefined)).toBe('full');
        expect(navModeOf('expert')).toBe('full');
        expect(navModeOf('simple')).toBe('simple');
        use(undefined);
        expect(keysOf(mountNav().rail)).toEqual(FULL_RAIL);
    });

    it('keeps no record of the places a person opens', async () => {
        at('Planner');
        mountNav();
        await nextTick();
        expect(shellState.nav.pinned).toEqual([]);
    });
});

describe('Simple', () => {
    it('shows five places: Home, My work, Projects, Inbox and Ask', () => {
        use('simple');
        const nav = mountNav();
        expect(SIMPLE_PLACES).toEqual(['home', 'everything', 'projects', 'inbox', 'ai']);
        expect(keysOf(nav.rail)).toEqual(SIMPLE_PLACES);
        expect(nav.rail.map((item) => item.label)).toEqual(['Shell.home', 'Shell.my_work', 'Header.Projects', 'Inbox.title', 'Shell.ask']);
    });

    it('opens My work as the Everything page narrowed to the person', () => {
        use('simple');
        const item = mountNav().rail.find((entry) => entry.key === 'everything');
        expect(item.to).toEqual({ name: 'Everything', params: { cid: 'c1' }, query: { mine: '1' } });
        expect(item.match({ name: 'Everything' })).toBe(true);
    });

    it('moves the other places to the top of More and keeps the rest of the menu', () => {
        const full = mountNav().more;
        use('simple');
        const { more } = mountNav();
        expect(more[0].label).toBe('Shell.more_places');
        expect(keysOf(more[0].items)).toEqual(TUCKED);
        expect(more[0].items.find((item) => item.key === 'planner').to).toEqual({ name: 'Planner', params: { cid: 'c1' }, query: undefined });
        expect(more.slice(1).map((group) => [group.label, keysOf(group.items)])).toEqual(full.map((group) => [group.label, keysOf(group.items)]));
    });

    it('shows nothing a permission hid before', () => {
        permissions.denied = ['project.project_list', 'chat'];
        use('simple');
        const nav = mountNav();
        expect(keysOf(nav.rail)).toEqual(['home', 'everything', 'inbox', 'ai']);
        expect(keysOf(nav.more[0].items)).toEqual(['goals', 'planner', 'docs', 'time']);
    });

    it('takes a switch back to Full at once', async () => {
        use('simple');
        const nav = mountNav();
        expect(keysOf(nav.rail)).toHaveLength(5);
        shellState.nav.mode = 'full';
        await nextTick();
        expect(keysOf(nav.rail)).toEqual(FULL_RAIL);
        expect(nav.more.map((group) => group.label)).toEqual(MORE_GROUPS);
    });
});

describe('Ask', () => {
    it('opens Ask when the workspace has a model', () => {
        use('simple');
        expect(mountNav().rail.find((item) => item.key === 'ai').to.name).toBe('AiAsk');
    });

    it('opens the page that connects the person\'s own AI when the server has no key', () => {
        applyAiAvailability({ state: AI_STATE.UNCONFIGURED, loaded: true });
        use('simple');
        const ask = mountNav().rail.find((item) => item.key === 'ai');
        expect(ask.to).toEqual({ name: 'AiAccounts', params: { cid: 'c1' }, query: undefined });
        expect(ask.match({ name: 'AiAccounts' })).toBe(true);
    });

    it('leaves Full pointing at Ask with no key, as before', () => {
        applyAiAvailability({ state: AI_STATE.UNCONFIGURED, loaded: true });
        expect(mountNav().rail.find((item) => item.key === 'ai').to.name).toBe('AiAsk');
    });

    it('stays hidden in both modes where an admin switched AI off', () => {
        applyAiAvailability({ state: AI_STATE.OFF_WORKSPACE, loaded: true });
        expect(keysOf(mountNav().rail)).not.toContain('ai');
        use('simple');
        expect(keysOf(mountNav().rail)).toEqual(['home', 'everything', 'projects', 'inbox']);
    });
});

describe('a place the person opens stays on their rail', () => {
    it('adds a tucked place after the five, once, and takes it out of More', async () => {
        use('simple');
        at('Planner');
        const nav = mountNav();
        await nextTick();
        expect(shellState.nav.pinned).toEqual(['planner']);
        expect(keysOf(nav.rail)).toEqual([...SIMPLE_PLACES, 'planner']);
        expect(keysOf(nav.more[0].items)).toEqual(TUCKED.filter((key) => key !== 'planner'));

        mountNav();
        await nextTick();
        expect(shellState.nav.pinned).toEqual(['planner']);
    });

    it('keeps the places in the order of the full rail', () => {
        use('simple', ['time', 'goals']);
        expect(keysOf(mountNav().rail)).toEqual([...SIMPLE_PLACES, 'goals', 'time']);
    });

    it('drops the group from More once every place is on the rail', () => {
        use('simple', TUCKED);
        const nav = mountNav();
        expect(keysOf(nav.rail)).toEqual([...SIMPLE_PLACES, ...TUCKED]);
        expect(nav.more.map((group) => group.label)).toEqual(MORE_GROUPS);
    });

    it('adds nothing for one of the five, for a More item, or for a place the person may not see', async () => {
        use('simple');
        for (const name of ['Home', 'Everything', 'Approvals', 'Setting']) {
            at(name);
            mountNav();
            await nextTick();
        }
        permissions.denied = ['chat'];
        at('chats');
        const nav = mountNav();
        await nextTick();
        expect(shellState.nav.pinned).toEqual([]);
        expect(keysOf(nav.rail)).not.toContain('chat');
    });

    it('never shows a kept place the person lost the right to see', () => {
        permissions.denied = ['chat'];
        use('simple', ['chat', 'settings', 'no-such-place']);
        expect(keysOf(mountNav().rail)).toEqual(SIMPLE_PLACES);
    });
});

describe('a place the person\'s projects use', () => {
    it('is Dash once a project has a dashboard', async () => {
        fetchDashboards.mockResolvedValue([{ _id: 'd1', visibility: 'private' }, { _id: 'd2', visibility: 'project', projectId: 'p1' }]);
        expect(await placesInUse()).toEqual(['dash']);
    });

    it('is nothing while dashboards are only personal, or the list cannot be read', async () => {
        fetchDashboards.mockResolvedValue([{ _id: 'd1', visibility: 'private' }, { _id: 'd3', visibility: 'workspace' }]);
        expect(await placesInUse()).toEqual([]);
        fetchDashboards.mockRejectedValue(new Error('offline'));
        expect(await placesInUse()).toEqual([]);
    });
});

describe('the phone tab bar agrees with the rail', () => {
    const mountBar = async () => {
        const wrapper = mount(MobileTabBar, {
            global: {
                plugins: [store()],
                provide: { $companyId: ref('c1'), $userId: ref('u1') },
                stubs: { RouterLink: RouterLinkStub, ShellIcon: true, UserProfile: true, teleport: true }
            }
        });
        mounted.push(wrapper);
        await flushPromises();
        return wrapper;
    };
    const tabs = (wrapper) => wrapper.findAll('.ah-tabbar > a.ah-tabbar__item').map((el) => el.attributes('data-test'));
    const openSheet = async (wrapper) => {
        await wrapper.find('[data-test="tab-more"]').trigger('click');
        await flushPromises();
    };
    const sheetText = (wrapper, selector) => wrapper.findAll(selector).map((el) => el.text().trim());

    it('shows Home, Inbox, Chat and AI in Full, with the other places in the sheet', async () => {
        const wrapper = await mountBar();
        expect(tabs(wrapper)).toEqual(['tab-home', 'tab-inbox', 'tab-chat', 'tab-ai']);
        await openSheet(wrapper);
        expect(sheetText(wrapper, '.ah-sheet__cell')).toEqual(['Shell.everything', 'Shell.goals', 'Header.Projects', 'Shell.planner', 'Shell.docs', 'Shell.dash', 'Shell.time']);
        expect(sheetText(wrapper, '.ah-pop__label')).toEqual(MORE_GROUPS);
    });

    it('shows Home, My work, Inbox and Ask in Simple, Projects one tap away and the rest under More', async () => {
        use('simple');
        const wrapper = await mountBar();
        expect(tabs(wrapper)).toEqual(['tab-home', 'tab-everything', 'tab-inbox', 'tab-ai']);
        expect(wrapper.find('[data-test="tab-everything"]').text()).toBe('Shell.my_work');
        expect(wrapper.find('[data-test="tab-ai"]').text()).toBe('Shell.ask');
        expect(wrapper.findAll('.ah-tabbar > .ah-tabbar__item')).toHaveLength(6);

        await openSheet(wrapper);
        expect(sheetText(wrapper, '.ah-sheet__cell')).toEqual(['Header.Projects']);
        expect(sheetText(wrapper, '.ah-pop__label')).toEqual(['Shell.more_places', ...MORE_GROUPS]);
        const tucked = wrapper.findAll('.ah-sheet a.ah-pop__item').map((el) => el.text().trim());
        expect(tucked.slice(0, TUCKED.length)).toEqual(['Shell.goals', 'Shell.planner', 'Shell.chat', 'Shell.docs', 'Shell.dash', 'Shell.time']);
    });

    it('puts a kept place in the sheet beside Projects', async () => {
        use('simple', ['planner']);
        const wrapper = await mountBar();
        await openSheet(wrapper);
        expect(sheetText(wrapper, '.ah-sheet__cell')).toEqual(['Header.Projects', 'Shell.planner']);
    });
});

describe('the switch in My settings', () => {
    const mountPicker = async () => {
        const wrapper = mount(NavModePicker, { attachTo: document.body });
        mounted.push(wrapper);
        await flushPromises();
        return wrapper;
    };
    const option = (wrapper, mode) => wrapper.find(`[data-nav-mode="${mode}"]`);

    it('is one labelled group of two choices, with the current one checked', async () => {
        use('simple');
        const wrapper = await mountPicker();
        const group = wrapper.find('[role="radiogroup"]');
        expect(wrapper.find(`#${group.attributes('aria-labelledby')}`).text()).toBe('Settings.nav_mode');
        expect(wrapper.findAll('input[type="radio"]')).toHaveLength(2);
        expect(option(wrapper, 'simple').element.checked).toBe(true);
        expect(option(wrapper, 'full').element.checked).toBe(false);
    });

    it('changes the rail in one click and saves the choice on the person', async () => {
        const nav = mountNav();
        const wrapper = await mountPicker();
        await option(wrapper, 'simple').setValue(true);
        expect(keysOf(nav.rail)).toEqual(SIMPLE_PLACES);
        await flushPromises();
        expect(apiRequestWithoutCompnay.mock.calls).toEqual([['put', ROUTE, { mode: 'simple' }]]);
        expect(wrapper.find('[data-test="nav-mode-error"]').exists()).toBe(false);

        await option(wrapper, 'full').setValue(true);
        await flushPromises();
        expect(keysOf(nav.rail)).toEqual(FULL_RAIL);
        expect(apiRequestWithoutCompnay.mock.calls.at(-1)).toEqual(['put', ROUTE, { mode: 'full' }]);
    });

    it('goes back and says so when the choice could not be saved', async () => {
        apiRequestWithoutCompnay.mockRejectedValue(new Error('offline'));
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const wrapper = await mountPicker();
        await option(wrapper, 'simple').setValue(true);
        await flushPromises();
        expect(shellState.nav.mode).toBe('full');
        expect(option(wrapper, 'full').element.checked).toBe(true);
        expect(wrapper.find('[data-test="nav-mode-error"]').attributes('role')).toBe('alert');
        vi.restoreAllMocks();
    });

    it('sits in the look section of My settings', () => {
        const page = fs.readFileSync(path.join(SRC, 'views/Settings/MySettings/MySettings.vue'), 'utf8');
        expect(page).toMatch(/<NavModePicker \/>/);
    });

    it('says what each choice does in plain words', () => {
        for (const key of ['nav_mode', 'nav_mode_hint', 'nav_mode_simple', 'nav_mode_simple_hint', 'nav_mode_full', 'nav_mode_full_hint', 'nav_mode_failed']) {
            expect(en.Settings[key], key).toEqual(expect.any(String));
        }
        expect(en.Shell.my_work).toBe('My work');
        expect(en.Shell.ask).toBe('Ask');
        expect(en.Shell.more_places).toEqual(expect.any(String));
    });
});

describe('the choice hides entry points and nothing else', () => {
    const jsFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return jsFiles(full);
        return /\.(js|vue)$/.test(entry.name) ? [full] : [];
    });
    const READS_MODE = /navMode|nav\.mode|NAV_MODES|applyNavMode/;

    it('is read by no route, guard or role helper', () => {
        const guards = [...jsFiles(path.join(SRC, 'router')), path.join(SRC, 'utils/roles.js'), path.join(SRC, 'composable/index.js')];
        expect(guards.length).toBeGreaterThan(10);
        expect(guards.filter((file) => READS_MODE.test(fs.readFileSync(file, 'utf8')))).toEqual([]);
    });

    it('leaves every tucked place a route that opens by its address', () => {
        use('simple');
        const { more } = mountNav();
        const names = more[0].items.map((item) => item.to.name);
        expect(names).toEqual(['Goals', 'Planner', 'chats', 'Pages', 'Dashboards', 'User Timesheet']);
        for (const name of ['Goals', 'Planner']) {
            const route = homeRoutes.find((entry) => entry.name === name);
            expect(Object.keys(route.meta).sort()).toEqual(['requiresAuth', 'title']);
        }
    });
});

/* Last on purpose: mounting the rail ties the shell to a signed-in person, and from then on every
   kept place is saved a moment later. */
describe('the rail asks what the person\'s projects use', () => {
    const mountRail = async (userId) => {
        const wrapper = mount(GlobalRail, {
            global: {
                plugins: [store()],
                provide: { $companyId: ref('c1'), $userId: ref(userId) },
                stubs: { RouterLink: RouterLinkStub, ShellIcon: true, UserProfile: true, KeyHint: true }
            }
        });
        mounted.push(wrapper);
        await flushPromises();
        return wrapper;
    };
    const railLabels = (wrapper) => wrapper.findAll('.ah-rail__items > a.ah-rail__item').map((el) => el.text().trim());

    it('asks nothing for an account that was here before: it stays in Full', async () => {
        people.list = [{ _id: 'u1', navPreferences: { pinned: ['planner'] } }];
        const wrapper = await mountRail('u1');
        expect(shellState.nav.mode).toBe('full');
        expect(fetchDashboards).not.toHaveBeenCalled();
        expect(railLabels(wrapper)).toHaveLength(FULL_RAIL.length);
    });

    it('starts a new account on five places, and adds Dash once a project has a dashboard', async () => {
        fetchDashboards.mockResolvedValue([{ _id: 'd2', visibility: 'project', projectId: 'p1' }]);
        people.list = [{ _id: 'u2', navPreferences: { mode: 'simple' } }];
        const wrapper = await mountRail('u2');
        expect(shellState.nav.mode).toBe('simple');
        expect(fetchDashboards).toHaveBeenCalledTimes(1);
        expect(railLabels(wrapper)).toEqual(['Shell.home', 'Shell.my_work', 'Header.Projects', 'Inbox.title', 'Shell.ask', 'Shell.dash']);
    });
});
