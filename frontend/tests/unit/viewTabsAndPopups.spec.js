import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ref } from 'vue';

const { apiRequest, toast, commit, editView, deleteView, addView, router, state } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
    commit: vi.fn(),
    editView: vi.fn(),
    deleteView: vi.fn(),
    addView: vi.fn(),
    router: { push: vi.fn(), replace: vi.fn() },
    state: { ids: 0, memberRow: null, permissions: new Set(), route: { params: {}, query: {} } },
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({
        debounce: (fn) => fn,
        makeUniqueId: () => `u${++state.ids}`,
        checkPermission: (key) => (state.permissions.has(key) ? true : null),
    }),
}));
vi.mock('@/composable/commonFunction', () => ({ projectComponentsIcons: () => ({ icon: 'icon.svg', activeIcon: 'active.svg' }) }));
vi.mock('@/components/molecules/EmbedView/helper', () => ({ addView, editView, deleteView }));
vi.mock('@/components/molecules/EmbedView/helper.js', () => ({ addView, editView, deleteView }));
vi.mock('vue-router', () => ({ useRoute: () => state.route, useRouter: () => router }));
vi.mock('vuex', async (importOriginal) => ({
    ...(await importOriginal()),
    useStore: () => ({ getters: { 'settings/companyUsers': [state.memberRow], 'projectData/projects': { data: [] } }, commit }),
}));

import ViewsDropdown from '@/components/molecules/ProjectViews/ViewsDropdown.vue';
import ViewsList from '@/components/atom/ViewsList/ViewsList.vue';
import DropDown from '@/components/molecules/DropDown/DropDown.vue';
import ConfirmationSidebar from '@/components/molecules/ConfirmationSidebar/ConfirmationSidebar.vue';

const SRC = resolve(__dirname, '../../src');
const source = (file) => readFileSync(resolve(SRC, file), 'utf8');

const LIST_ID = 'a'.repeat(24);
const SPRINT_ID = 'b'.repeat(24);
const PRIVATE_VIEW_URL = '/api/v1/members/private-view';
const shared = (extra = {}) => ({ _id: LIST_ID, id: LIST_ID, name: 'List', keyName: 'ProjectListView', ...extra });
const mine = (extra = {}) => ({ _id: LIST_ID, id: 'mine000001', isPrivate: true, projectId: 'p1', name: 'List', keyName: 'ProjectListView', title: 'Sprint', sourceViewId: SPRINT_ID, ...extra });

const CATALOGUE = [
    { _id: 'cat-list', name: 'List', keyName: 'ProjectListView', sortIndex: 1 },
    { _id: 'cat-board', name: 'Board', keyName: 'ProjectKanban', sortIndex: 2 },
];
const ADDED = { _id: 'new-view', id: 'new-view', keyName: 'ProjectListView', name: 'List', title: 'Sprint list', settings: { groupBy: 2 } };

let wrapper;
let templates;
let added;

const calls = (method, url) => apiRequest.mock.calls.filter(([m, u]) => m === method && u === url);
const answer = (method, url) => {
    if (method === 'get' && url === '/api/v1/projectTabs') return { data: CATALOGUE };
    if (method === 'get' && url === '/api/v2/view-templates') return { data: { status: true, data: templates } };
    if (method === 'post' && url === '/api/v1/project/p1/views') return { data: added };
    return { data: { status: true } };
};

const settle = async () => {
    await flushPromises();
    vi.advanceTimersByTime(150);
    await flushPromises();
};

beforeEach(() => {
    state.ids = 0;
    state.permissions = new Set(['project.view_list']);
    state.route = { params: {}, query: {} };
    router.replace.mockReset();
    state.memberRow = { _id: 'row-1', userId: 'user-1', ProjectRequiredComponent: [mine(), { id: 'other00001', projectId: 'p9' }] };
    templates = [{ _id: 't-list', name: 'Sprint list', viewType: 'ProjectListView', canManage: false }];
    added = { status: true, data: ADDED, leftOut: [] };
    apiRequest.mockReset().mockImplementation((method, url) => Promise.resolve(answer(method, url)));
    editView.mockReset().mockImplementation((ids, view, value, field) => Promise.resolve({ data: { elementId: view._id, updateValue: value, field } }));
    deleteView.mockReset().mockResolvedValue({ data: { _id: LIST_ID }, statusText: 'ok' });
    addView.mockReset().mockImplementation((ids, view) => Promise.resolve({ data: { ...view, id: view._id }, statusText: 'ok' }));
    Object.values(toast).forEach((fn) => fn.mockReset());
    commit.mockReset();
    document.body.innerHTML = '<div id="my-dropdown"></div><div id="app"></div>';
});

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.useRealTimers();
});

const tabGlobal = () => ({
    stubs: { ConfirmationSidebar: true },
    provide: { selectedProject: ref({ _id: 'p1', isGlobalPermission: true, ProjectRequiredComponent: [shared(), shared({ _id: SPRINT_ID, id: SPRINT_ID, title: 'Sprint' })] }), $userId: ref('user-1'), $companyId: ref('c1') },
});

const mountTab = async (item, props = {}) => {
    vi.useFakeTimers();
    wrapper = mount(ViewsList, { props: { item, ...props }, attachTo: '#app', global: tabGlobal() });
    await flushPromises();
    return wrapper;
};
const openMenu = async () => {
    document.querySelector('#app [aria-haspopup]').click();
    await settle();
};
const menuItem = (action) => document.querySelector(`#my-dropdown [data-action="${action}"]`);
const renameInput = () => wrapper.find('[data-view-rename]');
const startRename = async () => {
    await openMenu();
    menuItem('rename-view').click();
    await settle();
};

describe('a private view tab', () => {
    it('carries a lock with an accessible name, and a shared tab carries none', async () => {
        await mountTab(mine());
        const marker = wrapper.find('[data-private-marker]');
        expect(marker.exists()).toBe(true);
        expect(marker.attributes('role')).toBe('img');
        expect(marker.attributes('aria-label')).toBe('Projects.private_view');
        expect(marker.find('svg').exists()).toBe(true);
        wrapper.unmount();

        await mountTab(shared());
        expect(wrapper.find('[data-private-marker]').exists()).toBe(false);
    });

    it('has a tab id and an options menu id of its own beside the view it copies', async () => {
        vi.useFakeTimers();
        const Pair = {
            components: { ViewsList },
            data: () => ({ views: [shared(), mine({ sourceViewId: LIST_ID })] }),
            template: '<div><ViewsList v-for="view in views" :key="view.id" :item="view" /></div>',
        };
        wrapper = mount(Pair, { attachTo: '#app', global: tabGlobal() });
        await flushPromises();

        const tabIds = [...document.querySelectorAll('#app [data-view-tab]')].map((el) => el.id);
        const menuIds = [...document.querySelectorAll('#app [aria-haspopup]')].map((el) => el.id);
        expect(tabIds).toHaveLength(2);
        expect(menuIds).toHaveLength(2);
        expect(new Set(tabIds).size).toBe(2);
        expect(new Set(menuIds).size).toBe(2);
        expect(tabIds.every(Boolean)).toBe(true);
    });
});

describe('renaming a view from its own menu', () => {
    it('is offered to someone who may edit the project\'s views', async () => {
        await mountTab(shared());
        await openMenu();
        expect(menuItem('rename-view')).not.toBeNull();
        expect(menuItem('rename-view').textContent).toContain('SavedViews.rename');
    });

    it('is not offered on a shared view without that permission', async () => {
        state.permissions = new Set();
        await mountTab(shared());
        expect(document.querySelector('#app [aria-haspopup]')).toBeNull();
    });

    it('is always offered to the owner of a private view', async () => {
        state.permissions = new Set();
        await mountTab(mine());
        await openMenu();
        expect(menuItem('rename-view')).not.toBeNull();
    });

    it('edits the name in the tab and saves it on Enter', async () => {
        await mountTab(shared({ title: 'Due soon' }));
        await startRename();
        expect(renameInput().exists()).toBe(true);
        expect(renameInput().element.value).toBe('Due soon');
        expect(document.activeElement).toBe(renameInput().element);
        expect(renameInput().attributes('aria-label')).toBe('SavedViews.rename_label');

        await renameInput().setValue('  Due this week ');
        await wrapper.find('[data-view-rename-form]').trigger('submit');
        await flushPromises();

        expect(editView).toHaveBeenCalledTimes(1);
        expect(editView.mock.calls[0].slice(1)).toEqual([expect.objectContaining({ _id: LIST_ID }), 'Due this week', 'title']);
        expect(commit).toHaveBeenCalledWith('projectData/projectLocalUpdate', expect.objectContaining({ key: 'ProjectView', subKey: 'edit', itemData: { elementId: LIST_ID, updateValue: 'Due this week', field: 'title' } }));
        expect(renameInput().exists()).toBe(false);
    });

    it('drops the edit on Escape', async () => {
        await mountTab(shared({ title: 'Due soon' }));
        await startRename();
        await renameInput().setValue('Something else');
        await renameInput().trigger('keydown', { key: 'Escape' });
        await flushPromises();

        expect(renameInput().exists()).toBe(false);
        expect(editView).not.toHaveBeenCalled();
        expect(wrapper.text()).toContain('Due soon');
    });

    it('sends nothing for an empty or unchanged name', async () => {
        await mountTab(shared({ title: 'Due soon' }));
        await startRename();
        await renameInput().setValue('   ');
        await wrapper.find('[data-view-rename-form]').trigger('submit');
        await flushPromises();
        expect(editView).not.toHaveBeenCalled();
    });

    it('renames a private view on its owner\'s member row, never on the project', async () => {
        await mountTab(mine());
        await startRename();
        await renameInput().setValue('My sprint');
        await wrapper.find('[data-view-rename-form]').trigger('submit');
        await flushPromises();

        expect(editView).not.toHaveBeenCalled();
        expect(calls('post', PRIVATE_VIEW_URL)[0][2]).toEqual({ id: 'row-1', operation: 'update', key: 'title', data: { id: 'mine000001', title: 'My sprint' } });
        const [, stored] = commit.mock.calls.find(([name]) => name === 'settings/mutateCompanyUsers');
        expect(stored.data.ProjectRequiredComponent.map((view) => [view.id, view.title])).toEqual([['mine000001', 'My sprint'], ['other00001', undefined]]);
    });

    it('says so when the name could not be saved, and keeps the old one', async () => {
        editView.mockRejectedValue(new Error('nope'));
        await mountTab(shared({ title: 'Due soon' }));
        await startRename();
        await renameInput().setValue('Other');
        await wrapper.find('[data-view-rename-form]').trigger('submit');
        await flushPromises();
        expect(toast.error).toHaveBeenCalledWith('SavedViews.rename_failed', expect.anything());
        expect(commit).not.toHaveBeenCalled();
    });
});

describe('the other options of a private view', () => {
    it('pins the private view itself, not the shared view whose catalogue id it copies', async () => {
        await mountTab(mine());
        await openMenu();
        menuItem('pin-view').click();
        await settle();

        expect(editView).not.toHaveBeenCalled();
        expect(calls('post', PRIVATE_VIEW_URL)[0][2]).toEqual({ id: 'row-1', operation: 'update', key: 'isPin', data: { id: 'mine000001', isPin: true } });
    });

    it('deletes the private view itself, and leaves the project\'s views alone', async () => {
        await mountTab(mine());
        await openMenu();
        menuItem('delete-view').click();
        await settle();
        wrapper.findComponent(ConfirmationSidebar).vm.$emit('confirm');
        await settle();

        expect(deleteView).not.toHaveBeenCalled();
        expect(calls('post', PRIVATE_VIEW_URL)[0][2]).toEqual({ id: 'row-1', operation: 'delete', data: { id: 'mine000001' } });
        const [, stored] = commit.mock.calls.find(([name]) => name === 'settings/mutateCompanyUsers');
        expect(stored.data.ProjectRequiredComponent.map((view) => view.id)).toEqual(['other00001']);
        expect(router.replace).not.toHaveBeenCalled();
    });

    it('opens the shared view of its kind when the deleted private view was the open one', async () => {
        state.route = { params: {}, query: { tab: 'ProjectListView', view: 'mine000001' } };
        await mountTab(mine());
        await openMenu();
        menuItem('delete-view').click();
        await settle();
        wrapper.findComponent(ConfirmationSidebar).vm.$emit('confirm');
        await settle();

        expect(router.replace).toHaveBeenCalledWith({ query: { tab: 'ProjectListView' } });
    });
});

describe('the Add view menu', () => {
    const mountMenu = async () => {
        wrapper = mount(ViewsDropdown, {
            props: { projectData: { _id: 'p1', ProjectRequiredComponent: [] } },
            attachTo: '#app',
            global: { stubs: { EmbedView: true }, provide: { $userId: ref('user-1'), $companyId: ref('c1') } },
        });
        await flushPromises();
    };
    const pick = (id) => wrapper.find(`[data-template-pick="${id}"]`);

    it('lists the templates above the built-in kinds of view', async () => {
        await mountMenu();
        const sections = wrapper.findAll('.view__groups > .view__group');
        expect(sections[0].attributes('data-view-templates')).toBeDefined();
        expect(sections.length).toBeGreaterThan(1);
    });

    it('hands back the view it added from a template, so the page can open it', async () => {
        await mountMenu();
        await pick('t-list').trigger('click');
        await flushPromises();
        expect(wrapper.emitted('added')).toEqual([[ADDED]]);
    });

    it('hands back a private view added from a template under its own id', async () => {
        added = { status: true, data: { _id: 'cat-list', keyName: 'ProjectListView', name: 'List', title: 'Sprint list', settings: {} }, leftOut: [] };
        await mountMenu();
        await wrapper.findAll('.view__footer input[type="checkbox"]')[0].setValue(true);
        await pick('t-list').trigger('click');
        await flushPromises();
        const [[view]] = wrapper.emitted('added');
        const [, , pushed] = calls('post', PRIVATE_VIEW_URL)[0];
        expect(view).toMatchObject({ isPrivate: true, keyName: 'ProjectListView', id: pushed.data.id });
    });

    it('hands back the view it added from a kind of view', async () => {
        await mountMenu();
        const cell = wrapper.findAll('.view__cell').find((el) => el.text().includes('ViewList.Board'));
        await cell.trigger('click');
        await flushPromises();
        expect(wrapper.emitted('added')).toEqual([[expect.objectContaining({ _id: 'cat-board', keyName: 'ProjectKanban' })]]);
        expect(wrapper.emitted('closeDropdown')).toHaveLength(1);
    });

    it('hands back nothing when the view could not be added', async () => {
        apiRequest.mockImplementation((method, url) => (method === 'post' ? Promise.reject({ response: { data: { statusText: 'no' } } }) : Promise.resolve(answer(method, url))));
        await mountMenu();
        await pick('t-list').trigger('click');
        await flushPromises();
        expect(wrapper.emitted('added')).toBeUndefined();
    });

    it('keeps a long list of templates short until the rest is asked for', async () => {
        templates = Array.from({ length: 7 }, (_, index) => ({ _id: `t-${index}`, name: `Template ${index}`, viewType: 'ProjectListView', canManage: false }));
        await mountMenu();
        expect(wrapper.findAll('[data-template-pick]')).toHaveLength(4);
        const more = wrapper.find('[data-template-more]');
        expect(more.attributes('aria-expanded')).toBe('false');
        await more.trigger('click');
        expect(wrapper.findAll('[data-template-pick]')).toHaveLength(7);
        expect(wrapper.find('[data-template-more]').attributes('aria-expanded')).toBe('true');
    });

    it('shows every matching template while the search box narrows them', async () => {
        templates = Array.from({ length: 7 }, (_, index) => ({ _id: `t-${index}`, name: `Template ${index}`, viewType: 'ProjectListView', canManage: false }));
        await mountMenu();
        await wrapper.find('input[type="search"]').setValue('template');
        expect(wrapper.findAll('[data-template-pick]')).toHaveLength(7);
        expect(wrapper.find('[data-template-more]').exists()).toBe(false);
    });

    it('is wired so the project page opens the added view, on the desktop menu and the phone sheet', () => {
        expect(source('components/molecules/ProjectViews/AddViewMenu.vue')).toMatch(/<ViewsDropdown\b[^>]*@added="\$emit\('added', \$event\)"/);
        expect(source('views/Projects/components/ProjectBottomModals.vue')).toMatch(/<ViewsDropdown\b[^>]*@added="\$emit\('viewAdded', \$event\)"/);
        const page = source('views/Projects/Projects.vue');
        expect(page).toMatch(/<AddViewMenu\b[^>]*@added="selectView"/);
        expect(page).toMatch(/<ProjectBottomModals\b[^>]*@viewAdded="selectView"/s);
    });
});

describe('a themed dropdown panel', () => {
    const mountPanel = async (props) => {
        vi.useFakeTimers();
        wrapper = mount(DropDown, {
            props: { mode: 'menu', id: 'probe', ...props },
            slots: { button: '<span>open</span>', options: '<div role="menuitem">one</div>' },
            attachTo: '#app',
        });
        document.querySelector('#probe [aria-haspopup]').click();
        await settle();
        return document.getElementById('dd_probe');
    };

    it('takes its colours from the tokens and drops the legacy colour classes', async () => {
        const panel = await mountPanel({ themed: true });
        expect(panel.classList.contains('dd-tokens')).toBe(true);
        expect(panel.classList.contains('bg-white')).toBe(false);
        expect(panel.querySelector('.drop-down-options').classList.contains('black')).toBe(false);
    });

    it('is left as it was everywhere else', async () => {
        const panel = await mountPanel({});
        expect(panel.classList.contains('dd-tokens')).toBe(false);
        expect(panel.classList.contains('bg-white')).toBe(true);
    });
});

describe('the view tabs and their popups in the source', () => {
    const HEX = /#[0-9a-fA-F]{3,8}\b(?![-\w])/g;
    const withoutNoise = (text) => text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/href="#"/g, '')
        .replace(/url\([^)]*\)/g, '');
    const THEMED_FILES = [
        'components/atom/ViewsList/ViewsList.vue',
        'components/molecules/ProjectViews/AddViewMenu.vue',
        'components/molecules/ProjectViews/ViewsDropdown.vue',
        'components/molecules/ProjectViews/ViewTemplateList.vue',
        'components/molecules/ProjectViews/style.css',
        'components/molecules/TaskFilter/TaskFilter.vue',
        'components/molecules/TaskFilter/HomeTaskFilter.vue',
        'components/molecules/TaskFilter/FieldsTable.vue',
        'components/molecules/TaskFilter/FieldsActions.vue',
        'components/molecules/TaskFilter/CustomFieldFilterValue.vue',
        'components/molecules/TaskFilter/style.css',
        'views/Projects/components/ProjectFiltersToolbar.vue',
    ];

    it.each(THEMED_FILES)('%s names no hex colour and no bg-white', (file) => {
        const text = withoutNoise(source(file));
        expect(text.match(HEX) || []).toEqual([]);
        expect(text).not.toMatch(/\bbg-white\b/);
    });

    it('the Filters popup, its option dropdowns and the Group by dropdown are themed panels', () => {
        expect(source('components/molecules/TaskFilter/TaskFilter.vue')).toMatch(/<DropDown\b[^>]*\bthemed\b/);
        const table = source('components/molecules/TaskFilter/FieldsTable.vue');
        expect(table.match(/<CustomDropDown\b/g)).toHaveLength(table.match(/<CustomDropDown\b[^>]*\bthemed\b/g)?.length);
        const actions = source('components/molecules/TaskFilter/FieldsActions.vue');
        expect(actions.match(/<DropDown\b/g)).toHaveLength(actions.match(/<DropDown\b[^>]*\bthemed\b/g)?.length);
        expect(source('views/Projects/components/ProjectFiltersToolbar.vue')).toMatch(/<DropDown\b[^>]*id="group_by"[^>]*\bthemed\b/);
        expect(source('components/atom/ViewsList/ViewsList.vue')).toMatch(/<DropDown\b[^>]*\bthemed\b/);
    });

    it('the Add view panel is as wide as its content, and no wider than a phone', () => {
        expect(source('views/Projects/style.css')).not.toMatch(/669px/);
        const css = source('components/molecules/ProjectViews/style.css');
        expect(css).toMatch(/\.view__list-dropdown\s*\{[^}]*max-width:\s*100%/);
    });

    it('the project page gives each tab a key and an id of its own', () => {
        const page = source('views/Projects/Projects.vue');
        expect(page).not.toMatch(/<ViewsList\b[^>]*:id="view\.keyName"/s);
    });

    it('the phone view switcher lists what the tab bar lists, private views included, in a themed sheet', () => {
        const page = source('views/Projects/Projects.vue');
        expect(page).toMatch(/const phoneViews = computed\(\(\) => \[\.\.\.viewsListArray\.value, \.\.\.embedViews\.value\]\)/);
        expect(page).toMatch(/v-for="view in phoneViews"/);
        expect(page).toMatch(/<DropDown\b[^>]*\bthemed\b[^>]*id="project_avail_views"/);
        expect(page).toMatch(/v-if="view\.isPrivate"[^>]*role="img"[^>]*:aria-label="\$t\('Projects\.private_view'\)"/);
    });
});
