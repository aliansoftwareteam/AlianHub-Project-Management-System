/* Task 042 slice 4: a view keeps its filters, group, sort, columns and "Me" on the server.
   Differences from the saved view show as unsaved changes that can be saved for everyone,
   saved for me, saved as a new view or reset; the old per-browser prefs arrive as unsaved
   changes once and are no longer written. */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref, computed, defineComponent, h, nextTick } from 'vue';

vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true, debounce: (fn) => fn })
}));

vi.mock('@/views/Projects/composables/savedViewApi', () => ({
    saveSharedViewSettings: vi.fn(async () => ({ status: true })),
    createSharedView: vi.fn(async (projectId, body) => ({ status: true, data: { _id: 'c'.repeat(24), id: 'c'.repeat(24), keyName: 'ProjectListView', name: 'List', title: body.title, settings: body.settings } })),
    savePrivateViewSettings: vi.fn(async () => ({ status: true })),
    createPrivateView: vi.fn(async () => ({ status: true }))
}));

import * as api from '@/views/Projects/composables/savedViewApi';
import { useProjectSearch } from '@/views/Projects/composables/useProjectSearch';
import { useSavedViews } from '@/views/Projects/composables/useSavedViews';
import { resolveActiveView, viewKeyOf } from '@/views/Projects/composables/savedViewSettings';
import { viewPrefsKey } from '@/views/Projects/composables/projectViewPrefs';
import { columnCatalogue, columnStorageKey, useViewColumns } from '@/views/Projects/composables/viewColumns';
import { provideViewSettings } from '@/views/Projects/composables/viewSettingsContext';
import SavedViewBar from '@/views/Projects/components/SavedViewBar.vue';

const LIST = 'a'.repeat(24);
const LIST_COPY = 'b'.repeat(24);
const PREFS = viewPrefsKey({ companyId: 'company-1', userId: 'user-1', projectId: 'p1' });

const listView = (extra = {}) => ({ _id: LIST, id: LIST, name: 'List', keyName: 'ProjectListView', viewStatus: true, ...extra });

let localUpdates;
let memberUpdates;
let dispatch;

const mountViews = ({ views, tab = 'ProjectListView', requested, canSaveShared = true, privateViews = [], columnsOf }) => {
    const project = ref({ _id: 'p1', isGlobalPermission: true, ProjectRequiredComponent: views });
    const companyUser = ref({ _id: 'row-1', userId: 'user-1', ProjectRequiredComponent: privateViews });
    const store = createStore({
        getters: { 'projectData/searchedTasks': () => [] },
        mutations: {
            'projectData/mutateSearchTask': () => {},
            'projectData/projectLocalUpdate': (_s, payload) => localUpdates.push(payload),
            'settings/mutateCompanyUsers': (_s, payload) => memberUpdates.push(payload)
        },
        actions: { 'projectData/searchTask': (_ctx, payload) => dispatch(payload) }
    });
    const onSelect = vi.fn();
    const out = { project, companyUser, onSelect, activeTab: ref(tab), requested: ref(requested) };
    const Host = defineComponent({
        setup() {
            out.search = useProjectSearch(project, ref(false), { buildFilterQuery: (rows) => ({ rows: rows.length }) });
            out.saved = useSavedViews({
                project,
                activeTab: out.activeTab,
                views: computed(() => [...(project.value.ProjectRequiredComponent || []), ...(companyUser.value.ProjectRequiredComponent || [])]),
                requestedViewKey: out.requested,
                companyUser,
                search: out.search,
                canSaveShared: ref(canSaveShared),
                onSelect
            });
            provideViewSettings(out.saved);
            return () => h(Columns);
        }
    });
    const Columns = defineComponent({
        setup() {
            if (columnsOf) out.columns = useViewColumns(ref('p1'), columnsOf, computed(() => columnCatalogue(columnsOf)));
            return () => null;
        }
    });
    out.wrapper = mount(Host, { global: { plugins: [store] } });
    return out;
};

beforeEach(() => {
    window.localStorage.clear();
    localUpdates = [];
    memberUpdates = [];
    dispatch = vi.fn(() => Promise.resolve());
    vi.clearAllMocks();
});

describe('which view is open', () => {
    const views = [listView(), listView({ _id: LIST_COPY, id: LIST_COPY, title: 'Due soon', setAsDefault: true })];

    test('a tab with two views of its kind opens the project default', () => {
        expect(viewKeyOf(resolveActiveView(views, 'ProjectListView'))).toBe(LIST_COPY);
    });

    test('a view named in the address wins over the default', () => {
        expect(viewKeyOf(resolveActiveView(views, 'ProjectListView', LIST))).toBe(LIST);
    });

    test('a private view is keyed by its own id, not the catalogue row it copies', () => {
        expect(viewKeyOf({ _id: LIST, id: 'mine000001', isPrivate: true })).toBe('mine000001');
    });

    test('opening the project applies the default view\'s saved settings', async () => {
        const { search, saved } = mountViews({ views: [listView(), listView({ _id: LIST_COPY, id: LIST_COPY, setAsDefault: true, settings: { groupBy: 3, search: 'late' } })] });
        await flushPromises();
        expect(viewKeyOf(saved.activeView.value)).toBe(LIST_COPY);
        expect(search.groupBy.value).toBe(3);
        expect(search.taskSearch.value).toBe('late');
        expect(saved.dirty.value).toBe(false);
    });
});

describe('unsaved changes', () => {
    test('a change to group, search, "Me", filters, sort or columns marks the view', async () => {
        const { search, saved } = mountViews({ views: [listView({ settings: { groupBy: 1 } })] });
        await flushPromises();
        expect(search.groupBy.value).toBe(1);
        expect(saved.dirty.value).toBe(false);

        search.groupBy.value = 2;
        await nextTick();
        expect(saved.dirty.value).toBe(true);
        search.groupBy.value = 1;
        await nextTick();
        expect(saved.dirty.value).toBe(false);

        search.manageFilterUsers('user-1');
        await nextTick();
        expect(saved.dirty.value).toBe(true);
        search.manageFilterUsers('user-1');

        saved.setSort({ field: 'DueDate', dir: -1 });
        await nextTick();
        expect(saved.dirty.value).toBe(true);
        saved.setSort(null);

        saved.setColumns({ order: [], shown: [], hidden: ['due'] });
        await nextTick();
        expect(saved.dirty.value).toBe(true);
    });

    test('reset puts the saved settings back', async () => {
        const { search, saved } = mountViews({ views: [listView({ settings: { groupBy: 1, search: 'saved' } })] });
        await flushPromises();
        search.groupBy.value = 3;
        search.taskSearch.value = 'draft';
        saved.setSort({ field: 'TaskName', dir: 1 });
        await nextTick();
        saved.reset();
        await nextTick();
        expect(search.groupBy.value).toBe(1);
        expect(search.taskSearch.value).toBe('saved');
        expect(saved.sort.value).toBe(null);
        expect(saved.dirty.value).toBe(false);
    });

    test('switching away and back keeps the unsaved changes of a view', async () => {
        const board = { _id: 'd'.repeat(24), id: 'd'.repeat(24), name: 'Board', keyName: 'ProjectKanban', settings: { groupBy: 2 } };
        const { search, saved, activeTab } = mountViews({ views: [listView(), board] });
        await flushPromises();
        search.taskSearch.value = 'draft';
        await nextTick();
        activeTab.value = 'ProjectKanban';
        await flushPromises();
        expect(search.taskSearch.value).toBe('');
        expect(search.groupBy.value).toBe(2);
        activeTab.value = 'ProjectListView';
        await flushPromises();
        expect(search.taskSearch.value).toBe('draft');
        expect(saved.dirty.value).toBe(true);
    });
});

describe('saving', () => {
    test('save stores the settings on the shared view for everyone', async () => {
        const { search, saved } = mountViews({ views: [listView()] });
        await flushPromises();
        search.groupBy.value = 2;
        saved.setColumns({ order: ['due'], shown: [], hidden: ['tags'] });
        await nextTick();
        await saved.save();
        expect(api.saveSharedViewSettings).toHaveBeenCalledWith('p1', LIST, expect.objectContaining({ groupBy: 2, columns: { order: ['due'], shown: [], hidden: ['tags'] } }));
        expect(localUpdates.at(-1)).toMatchObject({ key: 'ProjectView', subKey: 'edit', projectId: 'p1', itemData: { elementId: LIST, field: 'settings' } });
        expect(saved.dirty.value).toBe(false);
    });

    test('without the view permission, save for everyone is refused and nothing is sent', async () => {
        const { search, saved } = mountViews({ views: [listView()], canSaveShared: false });
        await flushPromises();
        search.groupBy.value = 2;
        await nextTick();
        await expect(saved.save()).rejects.toThrow();
        expect(api.saveSharedViewSettings).not.toHaveBeenCalled();
        expect(saved.dirty.value).toBe(true);
    });

    test('save for me creates a private copy of a shared view and opens it', async () => {
        const { search, saved, onSelect } = mountViews({ views: [listView()] });
        await flushPromises();
        search.groupBy.value = 2;
        await nextTick();
        await saved.saveForMe();
        expect(api.saveSharedViewSettings).not.toHaveBeenCalled();
        expect(api.createPrivateView).toHaveBeenCalledWith('row-1', expect.objectContaining({
            _id: LIST, keyName: 'ProjectListView', isPrivate: true, projectId: 'p1', sourceViewId: LIST, settings: expect.objectContaining({ groupBy: 2 })
        }));
        const created = api.createPrivateView.mock.calls[0][1];
        expect(created.id).toMatch(/^[A-Za-z0-9]{10}$/);
        expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: created.id }));
        expect(memberUpdates.at(-1).data.ProjectRequiredComponent).toContainEqual(expect.objectContaining({ id: created.id }));
    });

    test('save for me updates my private copy when I already have one', async () => {
        const mine = { ...listView(), id: 'mine000001', isPrivate: true, projectId: 'p1', sourceViewId: LIST, title: 'Mine' };
        const { search, saved } = mountViews({ views: [listView()], privateViews: [mine] });
        await flushPromises();
        search.groupBy.value = 3;
        await nextTick();
        await saved.saveForMe();
        expect(api.createPrivateView).not.toHaveBeenCalled();
        expect(api.savePrivateViewSettings).toHaveBeenCalledWith('row-1', 'mine000001', expect.objectContaining({ groupBy: 3 }));
    });

    test('save on a private view stays private', async () => {
        const mine = { ...listView(), id: 'mine000001', isPrivate: true, projectId: 'p1' };
        const { search, saved } = mountViews({ views: [], privateViews: [mine], requested: 'mine000001', canSaveShared: false });
        await flushPromises();
        search.taskSearch.value = 'mine';
        await nextTick();
        await saved.save();
        expect(api.saveSharedViewSettings).not.toHaveBeenCalled();
        expect(api.savePrivateViewSettings).toHaveBeenCalledWith('row-1', 'mine000001', expect.objectContaining({ search: 'mine' }));
    });

    test('save as new adds a shared view, or a private one when asked', async () => {
        const { search, saved, onSelect } = mountViews({ views: [listView()] });
        await flushPromises();
        search.groupBy.value = 1;
        await nextTick();
        await saved.saveAsNew({ title: 'By assignee', isPrivate: false });
        expect(api.createSharedView).toHaveBeenCalledWith('p1', expect.objectContaining({ sourceViewId: LIST, title: 'By assignee', settings: expect.objectContaining({ groupBy: 1 }) }));
        expect(localUpdates.at(-1)).toMatchObject({ key: 'ProjectView', subKey: 'add' });
        expect(onSelect).toHaveBeenCalled();

        await saved.saveAsNew({ title: 'Just me', isPrivate: true });
        expect(api.createPrivateView).toHaveBeenCalledWith('row-1', expect.objectContaining({ title: 'Just me', isPrivate: true, sourceViewId: LIST }));
    });
});

describe('the old per-browser preferences', () => {
    test('arrive once as unsaved changes on a view with no saved settings', async () => {
        window.localStorage.setItem(PREFS, JSON.stringify({ groupBy: 2, me: true, search: 'invoice' }));
        const { search, saved } = mountViews({ views: [listView()] });
        await flushPromises();
        expect(search.groupBy.value).toBe(2);
        expect(search.filterUsers.value).toEqual(['user-1']);
        expect(search.taskSearch.value).toBe('invoice');
        expect(saved.dirty.value).toBe(true);
        expect(api.saveSharedViewSettings).not.toHaveBeenCalled();
    });

    test('are ignored when the view already has saved settings', async () => {
        window.localStorage.setItem(PREFS, JSON.stringify({ groupBy: 2, me: true, search: 'invoice' }));
        const { search, saved } = mountViews({ views: [listView({ settings: { groupBy: 1 } })] });
        await flushPromises();
        expect(search.groupBy.value).toBe(1);
        expect(saved.dirty.value).toBe(false);
    });

    test('are no longer written, and go once the view is saved', async () => {
        const { search, saved } = mountViews({ views: [listView()] });
        await flushPromises();
        search.groupBy.value = 3;
        search.taskSearch.value = 'x';
        await nextTick();
        expect(window.localStorage.getItem(PREFS)).toBe(null);

        window.localStorage.setItem(PREFS, JSON.stringify({ groupBy: 2 }));
        await saved.save();
        expect(window.localStorage.getItem(PREFS)).toBe(null);
    });
});

describe('columns', () => {
    const LIST_COLUMNS = { order: ['due', 'assignee'], shown: ['start'], hidden: ['tags'] };

    test('a saved view restores its columns, and the chooser marks the view', async () => {
        const { saved, columns } = mountViews({ views: [listView({ settings: { columns: LIST_COLUMNS } })], columnsOf: 'list' });
        await flushPromises();
        expect(columns.isVisible('tags')).toBe(false);
        expect(columns.isVisible('start')).toBe(true);
        expect(columns.visibleColumns.value.map((c) => c.id).slice(0, 2)).toEqual(['due', 'assignee']);
        expect(saved.dirty.value).toBe(false);

        columns.setVisible('tags', true);
        await nextTick();
        expect(saved.dirty.value).toBe(true);
        expect(columns.isVisible('tags')).toBe(true);

        saved.reset();
        await nextTick();
        expect(columns.isVisible('tags')).toBe(false);
        expect(saved.dirty.value).toBe(false);
    });

    test('the Board\'s card fields are part of its saved view', async () => {
        const board = { _id: 'd'.repeat(24), id: 'd'.repeat(24), name: 'Board', keyName: 'ProjectKanban', settings: { columns: { order: [], shown: ['points'], hidden: [] } } };
        const { columns } = mountViews({ views: [board], tab: 'ProjectKanban', columnsOf: 'board' });
        await flushPromises();
        expect(columns.isVisible('points')).toBe(true);
    });

    test('columns chosen in this browser by an older build arrive as unsaved changes, and are never written again', async () => {
        const key = columnStorageKey({ companyId: 'company-1', userId: 'user-1', projectId: 'p1' }, 'list');
        window.localStorage.setItem(key, JSON.stringify({ order: ['due'], shown: { tags: false } }));
        const { saved, columns } = mountViews({ views: [listView()], columnsOf: 'list' });
        await flushPromises();
        expect(columns.isVisible('tags')).toBe(false);
        expect(saved.dirty.value).toBe(true);

        columns.setVisible('start', true);
        await nextTick();
        expect(JSON.parse(window.localStorage.getItem(key))).toEqual({ order: ['due'], shown: { tags: false } });

        await saved.save();
        expect(api.saveSharedViewSettings).toHaveBeenCalledWith('p1', LIST, expect.objectContaining({ columns: { order: ['due'], shown: ['start'], hidden: ['tags'] } }));
        expect(window.localStorage.getItem(key)).toBe(null);
    });
});

describe('the unsaved-changes bar', () => {
    const bar = (props = {}) => mount(SavedViewBar, { props: { canSaveShared: true, isPrivate: false, saving: false, ...props }, attachTo: document.body });

    test('offers save, save for me, save as new and reset', async () => {
        const wrapper = bar();
        expect(wrapper.text()).toContain('SavedViews.unsaved');
        for (const [name, event] of [['save', 'save'], ['save-for-me', 'saveForMe'], ['reset', 'reset']]) {
            await wrapper.find(`[data-action="${name}"]`).trigger('click');
            expect(wrapper.emitted(event)).toHaveLength(1);
        }
        wrapper.unmount();
    });

    test('hides save for everyone without the permission, and save for me on a private view', () => {
        expect(bar({ canSaveShared: false }).find('[data-action="save"]').exists()).toBe(false);
        const priv = bar({ isPrivate: true });
        expect(priv.find('[data-action="save"]').exists()).toBe(true);
        expect(priv.find('[data-action="save-for-me"]').exists()).toBe(false);
    });

    test('save as new asks for a name, is keyboard friendly and forces private without the permission', async () => {
        const wrapper = bar({ canSaveShared: false });
        await wrapper.find('[data-action="save-as-new"]').trigger('click');
        const input = wrapper.find('input[type="text"]');
        expect(document.activeElement).toBe(input.element);
        const onlyMe = wrapper.find('input[type="checkbox"]');
        expect(onlyMe.element.checked).toBe(true);
        expect(onlyMe.element.disabled).toBe(true);

        await input.setValue('  ');
        await wrapper.find('form').trigger('submit');
        expect(wrapper.emitted('saveAsNew')).toBeUndefined();

        await input.setValue('Due soon');
        await wrapper.find('form').trigger('submit');
        expect(wrapper.emitted('saveAsNew')[0]).toEqual([{ title: 'Due soon', isPrivate: true }]);

        await wrapper.find('[data-action="save-as-new"]').trigger('click');
        await wrapper.find('input[type="text"]').trigger('keydown', { key: 'Escape' });
        expect(wrapper.find('form').exists()).toBe(false);
        wrapper.unmount();
    });
});

describe('the workload view keeps its unit', () => {
    const WORKLOAD = 'd'.repeat(24);
    const workloadView = (extra = {}) => ({ _id: WORKLOAD, id: WORKLOAD, name: 'Workload', keyName: 'Workload', viewStatus: true, ...extra });

    test('opens in the saved unit, marks a change and saves it for everyone', async () => {
        const { saved } = mountViews({ views: [workloadView({ settings: { workloadUnit: 'points' } })], tab: 'Workload' });
        await flushPromises();
        expect(saved.workloadUnit.value).toBe('points');
        expect(saved.dirty.value).toBe(false);

        saved.setWorkloadUnit('count');
        await nextTick();
        expect(saved.dirty.value).toBe(true);
        await saved.save();
        expect(api.saveSharedViewSettings).toHaveBeenCalledWith('p1', WORKLOAD, expect.objectContaining({ workloadUnit: 'count' }));
        expect(saved.dirty.value).toBe(false);
    });

    test('a view with no saved unit opens in hours, whatever the list left in this browser', async () => {
        window.localStorage.setItem(PREFS, JSON.stringify({ groupBy: 3 }));
        const { saved } = mountViews({ views: [workloadView()], tab: 'Workload' });
        await flushPromises();
        expect(saved.workloadUnit.value).toBe('hours');
        expect(saved.dirty.value).toBe(false);
        saved.setWorkloadUnit('bananas');
        expect(saved.workloadUnit.value).toBe('hours');
    });
});
