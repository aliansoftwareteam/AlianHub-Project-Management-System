import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';

const { apiRequest, toast, commit, state } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
    commit: vi.fn(),
    state: { ids: 0, memberRow: null },
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ debounce: (fn) => fn, makeUniqueId: () => `u${++state.ids}`, checkPermission: () => true }),
}));
vi.mock('@/composable/commonFunction', () => ({ projectComponentsIcons: () => ({ icon: 'icon.svg', activeIcon: 'icon.svg' }) }));
vi.mock('@/components/molecules/EmbedView/helper', () => ({ addView: vi.fn(), editView: vi.fn(), deleteView: vi.fn() }));
vi.mock('@/components/molecules/EmbedView/helper.js', () => ({ addView: vi.fn(), editView: vi.fn(), deleteView: vi.fn() }));
vi.mock('vue-router', () => ({ useRoute: () => ({ params: {}, query: {} }), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('vuex', async (importOriginal) => ({
    ...(await importOriginal()),
    useStore: () => ({ getters: { 'settings/companyUsers': [state.memberRow], 'projectData/projects': { data: [] } }, commit }),
}));

import ViewsDropdown from '@/components/molecules/ProjectViews/ViewsDropdown.vue';
import ViewsList from '@/components/atom/ViewsList/ViewsList.vue';
import { TEMPLATE_VIEW_TYPES, VIEW_TEMPLATES_EVENT, fittingTemplates, leftOutText } from '@/components/molecules/ProjectViews/viewTemplates';
import { VIEW_TYPES } from '../../../Modules/ViewTemplates/templateRules';

const CATALOGUE = [
    { _id: 'cat-list', name: 'List', keyName: 'ProjectListView', sortIndex: 1 },
    { _id: 'cat-board', name: 'Board', keyName: 'ProjectKanban', sortIndex: 2 },
    { _id: 'cat-comments', name: 'Comments', keyName: 'Comments', sortIndex: 4 },
];
const TEMPLATES = [
    { _id: 't-list', name: 'Sprint list', viewType: 'ProjectListView', canManage: false },
    { _id: 't-board', name: 'Release board', viewType: 'ProjectKanban', canManage: false },
    { _id: 't-table', name: 'Wide table', viewType: 'TableView', canManage: false },
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

const socket = () => ref({ id: 'sock', on: vi.fn(), off: vi.fn(), emit: vi.fn() });

beforeEach(() => {
    state.ids = 0;
    state.memberRow = { _id: 'row-1', userId: 'user-1', ProjectRequiredComponent: [{ id: 'old', projectId: 'p9' }] };
    templates = TEMPLATES.map((template) => ({ ...template }));
    added = { status: true, data: ADDED, leftOut: [] };
    apiRequest.mockReset().mockImplementation((method, url) => Promise.resolve(answer(method, url)));
    Object.values(toast).forEach((fn) => fn.mockReset());
    commit.mockReset();
    document.body.innerHTML = '<div id="my-dropdown"></div><div id="app"></div>';
});

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.useRealTimers();
});

describe('view template helpers', () => {
    it('offers a template only for a kind of view the catalogue has and that keeps a setup', () => {
        const fitting = fittingTemplates([...TEMPLATES, { _id: 't-comments', name: 'Chatty', viewType: 'Comments' }], CATALOGUE);
        expect(fitting.map((template) => [template._id, template.viewName])).toEqual([['t-list', 'List'], ['t-board', 'Board']]);
    });

    it('names each part that was left out, in the order the server gives', () => {
        const t = (key, params) => (params ? `${key}|${params.parts}` : key);
        expect(leftOutText(['group', 'filters'], t)).toBe('ViewTemplates.added_left_out|ViewTemplates.part_group, ViewTemplates.part_filters');
        expect(leftOutText([], t)).toBe('');
    });

    it('templates the same kinds of view the server accepts', () => {
        expect([...TEMPLATE_VIEW_TYPES].sort()).toEqual([...VIEW_TYPES].sort());
    });
});

describe('the Add view menu', () => {
    const mountMenu = async (provide = {}) => {
        wrapper = mount(ViewsDropdown, {
            props: { projectData: { _id: 'p1', ProjectRequiredComponent: [] } },
            attachTo: '#app',
            global: { stubs: { EmbedView: true }, provide },
        });
        await flushPromises();
    };
    const section = () => wrapper.find('[data-view-templates]');
    const pick = (id) => wrapper.find(`[data-template-pick="${id}"]`);

    it('lists the templates that fit under their own heading, each with its kind of view', async () => {
        await mountMenu();
        expect(section().exists()).toBe(true);
        expect(section().text()).toContain('ViewTemplates.from_template');
        expect(pick('t-list').text()).toContain('Sprint list');
        expect(pick('t-list').text()).toContain('ViewList.List');
        expect(pick('t-board').exists()).toBe(true);
        expect(pick('t-table').exists()).toBe(false);
    });

    it('shows no template section when the company has none', async () => {
        templates = [];
        await mountMenu();
        expect(section().exists()).toBe(false);
    });

    it('narrows the templates with the search box', async () => {
        await mountMenu();
        await wrapper.find('input[type="search"]').setValue('release');
        expect(pick('t-board').exists()).toBe(true);
        expect(pick('t-list').exists()).toBe(false);
        expect(wrapper.find('.view__empty').exists()).toBe(false);
    });

    it('adds the view from the picked template, puts it in the store and closes', async () => {
        await mountMenu();
        await pick('t-list').trigger('click');
        await flushPromises();
        expect(calls('post', '/api/v1/project/p1/views')[0][2]).toEqual({ templateId: 't-list', isPin: false, isPrivate: false });
        expect(commit).toHaveBeenCalledWith('projectData/projectLocalUpdate', { itemData: ADDED, projectId: 'p1', key: 'ProjectView', subKey: 'add', userId: '' });
        expect(toast.success).toHaveBeenCalledTimes(1);
        expect(toast.warning).not.toHaveBeenCalled();
        expect(wrapper.emitted('closeDropdown')).toHaveLength(1);
    });

    it('says which parts the project could not take', async () => {
        added = { status: true, data: ADDED, leftOut: ['group', 'columns'] };
        await mountMenu();
        await pick('t-list').trigger('click');
        await flushPromises();
        expect(toast.warning).toHaveBeenCalledTimes(1);
        expect(toast.warning.mock.calls[0][0]).toContain('ViewTemplates.added_left_out');
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('keeps a private view on the member row and off the project', async () => {
        added = { status: true, data: { _id: 'cat-list', keyName: 'ProjectListView', name: 'List', title: 'Sprint list', settings: { groupBy: 2 } }, leftOut: [] };
        await mountMenu();
        const [privateBox, pinBox] = wrapper.findAll('.view__footer input[type="checkbox"]');
        await privateBox.setValue(true);
        await pinBox.setValue(true);
        await pick('t-list').trigger('click');
        await flushPromises();
        expect(calls('post', '/api/v1/project/p1/views')[0][2]).toEqual({ templateId: 't-list', isPin: true, isPrivate: true });
        const [, , pushed] = calls('post', '/api/v1/members/private-view')[0];
        expect(pushed).toMatchObject({ id: 'row-1', operation: 'push' });
        expect(pushed.data).toMatchObject({ _id: 'cat-list', keyName: 'ProjectListView', title: 'Sprint list', isPrivate: true, isPin: true, projectId: 'p1', sourceViewId: 'cat-list', settings: { groupBy: 2 } });
        expect(pushed.data.id).toBeTruthy();
        expect(commit).not.toHaveBeenCalledWith('projectData/projectLocalUpdate', expect.anything());
        const [, stored] = commit.mock.calls.find(([name]) => name === 'settings/mutateCompanyUsers');
        expect(stored.data.ProjectRequiredComponent.map((view) => view.id)).toEqual(['old', pushed.data.id]);
    });

    it('tells the person when the view could not be added, and stays open', async () => {
        apiRequest.mockImplementation((method, url) => (method === 'post'
            ? Promise.reject({ response: { data: { statusText: 'This project has as many views as it can hold.' } } })
            : Promise.resolve(answer(method, url))));
        await mountMenu();
        await pick('t-list').trigger('click');
        await flushPromises();
        expect(toast.error).toHaveBeenCalledWith('This project has as many views as it can hold.', expect.anything());
        expect(wrapper.emitted('closeDropdown')).toBeUndefined();
    });

    it('shows rename and delete only to someone who may manage templates', async () => {
        await mountMenu();
        expect(wrapper.find('[data-template-rename="t-list"]').exists()).toBe(false);
        expect(wrapper.find('[data-template-delete="t-list"]').exists()).toBe(false);
        wrapper.unmount();
        templates = TEMPLATES.map((template) => ({ ...template, canManage: true }));
        await mountMenu();
        expect(wrapper.find('[data-template-rename="t-list"]').exists()).toBe(true);
        expect(wrapper.find('[data-template-delete="t-list"]').exists()).toBe(true);
    });

    it('renames a template in place', async () => {
        templates = TEMPLATES.map((template) => ({ ...template, canManage: true }));
        await mountMenu();
        await wrapper.find('[data-template-rename="t-list"]').trigger('click');
        const input = wrapper.find('[data-template-name]');
        expect(input.element.value).toBe('Sprint list');
        expect(input.attributes('maxlength')).toBe('60');
        await input.setValue('  Release list ');
        await wrapper.find('[data-template-form]').trigger('submit');
        await flushPromises();
        expect(calls('patch', '/api/v2/view-templates/t-list')[0][2]).toEqual({ name: 'Release list' });
        expect(calls('get', '/api/v2/view-templates')).toHaveLength(2);
    });

    it('deletes a template only after a second, confirming press', async () => {
        templates = TEMPLATES.map((template) => ({ ...template, canManage: true }));
        await mountMenu();
        await wrapper.find('[data-template-delete="t-list"]').trigger('click');
        expect(calls('delete', '/api/v2/view-templates/t-list')).toHaveLength(0);
        await wrapper.find('[data-template-confirm-delete]').trigger('click');
        await flushPromises();
        expect(calls('delete', '/api/v2/view-templates/t-list')).toHaveLength(1);
        expect(calls('get', '/api/v2/view-templates')).toHaveLength(2);
    });

    it('reads the list again when the server says the templates changed', async () => {
        const live = socket();
        await mountMenu({ $socket: live });
        const [, handler] = live.value.on.mock.calls.find(([event]) => event === VIEW_TEMPLATES_EVENT);
        templates = [{ _id: 't-new', name: 'Fresh', viewType: 'ProjectListView', canManage: false }];
        handler({ type: 'insert' });
        await flushPromises();
        expect(pick('t-new').exists()).toBe(true);
        expect(pick('t-list').exists()).toBe(false);
        wrapper.unmount();
        wrapper = null;
        expect(live.value.off).toHaveBeenCalledWith(VIEW_TEMPLATES_EVENT, handler);
    });
});

describe('a view tab\'s options', () => {
    const mountTab = async (item) => {
        vi.useFakeTimers();
        wrapper = mount(ViewsList, {
            props: { item },
            attachTo: '#app',
            global: { stubs: { ConfirmationSidebar: true }, provide: { selectedProject: ref({ _id: 'p1', ProjectRequiredComponent: [] }) } },
        });
        await flushPromises();
        document.querySelector('#app [aria-haspopup]').click();
        await flushPromises();
        vi.advanceTimersByTime(150);
        await flushPromises();
    };
    const saveItem = () => document.querySelector('[data-action="save-view-template"]');
    const dialog = () => document.querySelector('[data-view-template-dialog]');
    const typeName = async (value) => {
        const input = dialog().querySelector('[data-view-template-name]');
        input.value = value;
        input.dispatchEvent(new Event('input'));
        await flushPromises();
    };

    it('offers Save as template on a view that keeps a setup', async () => {
        await mountTab({ _id: 'view_1234567', name: 'List', keyName: 'ProjectListView' });
        expect(saveItem()).not.toBeNull();
        expect(saveItem().textContent).toContain('ViewTemplates.save_as');
    });

    it('does not offer it on a view that keeps none', async () => {
        await mountTab({ _id: 'view_1234567', name: 'Comments', keyName: 'Comments' });
        expect(saveItem()).toBeNull();
    });

    it('asks for a name, starting from the view\'s own, and saves the view under it', async () => {
        await mountTab({ _id: 'view_1234567', name: 'List', keyName: 'ProjectListView', title: 'Due this week' });
        saveItem().click();
        await flushPromises();
        expect(dialog()).not.toBeNull();
        expect(dialog().getAttribute('role')).toBe('dialog');
        const input = dialog().querySelector('[data-view-template-name]');
        expect(input.value).toBe('Due this week');
        expect(input.getAttribute('maxlength')).toBe('60');
        await typeName('  Weekly review ');
        dialog().querySelector('[data-action="save"]').click();
        await flushPromises();
        expect(calls('post', '/api/v2/view-templates')[0][2]).toEqual({ projectId: 'p1', viewId: 'view_1234567', name: 'Weekly review' });
        expect(toast.success).toHaveBeenCalledTimes(1);
        expect(dialog()).toBeNull();
    });

    it('saves a private view by its own id', async () => {
        await mountTab({ _id: 'cat-list-000', id: 'mine000001', isPrivate: true, name: 'List', keyName: 'ProjectListView' });
        saveItem().click();
        await flushPromises();
        dialog().querySelector('[data-action="save"]').click();
        await flushPromises();
        expect(calls('post', '/api/v2/view-templates')[0][2]).toMatchObject({ viewId: 'mine000001' });
    });

    it('keeps the dialog open and shows why when the save is refused', async () => {
        apiRequest.mockImplementation(() => Promise.reject({ response: { data: { statusText: 'This workspace has as many view templates as it can hold.' } } }));
        await mountTab({ _id: 'view_1234567', name: 'List', keyName: 'ProjectListView' });
        saveItem().click();
        await flushPromises();
        dialog().querySelector('[data-action="save"]').click();
        await flushPromises();
        expect(dialog().textContent).toContain('This workspace has as many view templates as it can hold.');
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('needs a name before it sends anything', async () => {
        await mountTab({ _id: 'view_1234567', name: 'List', keyName: 'ProjectListView' });
        saveItem().click();
        await flushPromises();
        await typeName('   ');
        dialog().querySelector('[data-action="save"]').click();
        await flushPromises();
        expect(calls('post', '/api/v2/view-templates')).toHaveLength(0);
        expect(dialog()).not.toBeNull();
    });
});
