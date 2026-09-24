/* Task 037 slice 1: group-by, "Me" and the search text are remembered per user per
   project and come back on reload; search, "Me" and a saved filter all reach the query
   the views render from. */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref, defineComponent, h, nextTick } from 'vue';

vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true, debounce: (fn) => fn })
}));

import { loadViewPrefs, saveViewPrefs, viewPrefsKey } from '@/views/Projects/composables/projectViewPrefs';
import { useProjectSearch } from '@/views/Projects/composables/useProjectSearch';
import { clearFilterSignal } from '@/views/Projects/composables/taskFilterSignal';

const IDS = { companyId: 'company-1', userId: 'user-1', projectId: 'p1' };

const memoryStorage = () => {
    const data = new Map();
    return {
        getItem: (k) => (data.has(k) ? data.get(k) : null),
        setItem: (k, v) => data.set(k, String(v)),
        removeItem: (k) => data.delete(k),
        data
    };
};

describe('view preferences storage', () => {
    test('the key is scoped by company, user and project', () => {
        expect(viewPrefsKey(IDS)).toContain('company-1');
        expect(viewPrefsKey(IDS)).toContain('user-1');
        expect(viewPrefsKey(IDS)).toContain('p1');
        expect(viewPrefsKey(IDS)).not.toBe(viewPrefsKey({ ...IDS, userId: 'user-2' }));
        expect(viewPrefsKey(IDS)).not.toBe(viewPrefsKey({ ...IDS, projectId: 'p2' }));
    });

    test('what is saved is what is loaded', () => {
        const storage = memoryStorage();
        saveViewPrefs(IDS, { groupBy: 1, me: true, search: 'invoice' }, storage);
        expect(loadViewPrefs(IDS, storage)).toEqual({ groupBy: 1, me: true, search: 'invoice' });
        expect(loadViewPrefs({ ...IDS, projectId: 'p2' }, storage)).toEqual({ groupBy: 0, me: false, search: '' });
    });

    test('defaults leave nothing behind in storage', () => {
        const storage = memoryStorage();
        saveViewPrefs(IDS, { groupBy: 2, me: false, search: '' }, storage);
        saveViewPrefs(IDS, { groupBy: 0, me: false, search: '' }, storage);
        expect(storage.data.size).toBe(0);
    });

    test('corrupt or foreign values fall back to the defaults', () => {
        const storage = memoryStorage();
        storage.setItem(viewPrefsKey(IDS), '{not json');
        expect(loadViewPrefs(IDS, storage)).toEqual({ groupBy: 0, me: false, search: '' });
        storage.setItem(viewPrefsKey(IDS), JSON.stringify({ groupBy: 42, me: 'yes', search: 7 }));
        expect(loadViewPrefs(IDS, storage)).toEqual({ groupBy: 0, me: false, search: '' });
    });

    test('a storage that throws (private window, blocked site data) never breaks the view', () => {
        const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
        expect(loadViewPrefs(IDS, throwing)).toEqual({ groupBy: 0, me: false, search: '' });
        expect(() => saveViewPrefs(IDS, { groupBy: 1, me: true, search: 'x' }, throwing)).not.toThrow();
        expect(loadViewPrefs({ ...IDS, userId: '' }, memoryStorage())).toEqual({ groupBy: 0, me: false, search: '' });
    });
});

describe('useProjectSearch remembers the view', () => {
    let dispatch;
    let api;

    beforeEach(() => {
        window.localStorage.clear();
        dispatch = vi.fn(() => Promise.resolve());
    });

    const mountSearch = (projectData) => {
        const store = createStore({
            getters: { 'projectData/searchedTasks': () => [] },
            mutations: { 'projectData/mutateSearchTask': () => {} },
            actions: { 'projectData/searchTask': (_ctx, payload) => dispatch(payload) }
        });
        const Host = defineComponent({
            setup() {
                api = useProjectSearch(projectData, ref(false));
                return () => h('div');
            }
        });
        return mount(Host, { global: { plugins: [store] } });
    };

    const lastMatch = () => dispatch.mock.calls.at(-1)[0].query[0].$match.$and;

    test('group, "Me" and search are restored for the project on reload', async () => {
        saveViewPrefs(IDS, { groupBy: 2, me: true, search: 'invoice' });
        const project = ref({ _id: 'p1', isGlobalPermission: true });
        mountSearch(project);
        api.resetFilters();
        await nextTick();
        expect(api.groupBy.value).toBe(2);
        expect(api.filterUsers.value).toEqual(['user-1']);
        expect(api.taskSearch.value).toBe('invoice');
        expect(api.searchTask.value).toBe(true);
        expect(lastMatch()).toContainEqual({ AssigneeUserId: { $in: ['user-1'] } });
    });

    test('changing group, "Me" or search is saved for this user and project only', async () => {
        const project = ref({ _id: 'p1', isGlobalPermission: true });
        mountSearch(project);
        api.resetFilters();
        api.groupBy.value = 1;
        api.manageFilterUsers('user-1');
        api.taskSearch.value = 'roadmap';
        await nextTick();
        expect(loadViewPrefs(IDS)).toEqual({ groupBy: 1, me: true, search: 'roadmap' });
        expect(loadViewPrefs({ ...IDS, projectId: 'p2' })).toEqual({ groupBy: 0, me: false, search: '' });
    });

    test('another project starts from its own saved state, not the last one\'s', async () => {
        saveViewPrefs(IDS, { groupBy: 2, me: true, search: 'invoice' });
        const project = ref({ _id: 'p1', isGlobalPermission: true });
        mountSearch(project);
        api.resetFilters();
        project.value = { _id: 'p2', isGlobalPermission: true };
        api.resetFilters();
        await nextTick();
        expect(api.groupBy.value).toBe(0);
        expect(api.filterUsers.value).toEqual([]);
        expect(api.taskSearch.value).toBe('');
        expect(api.searchTask.value).toBe(false);
        expect(loadViewPrefs(IDS)).toEqual({ groupBy: 2, me: true, search: 'invoice' });
    });

    test('search text, "Me" and a saved filter each narrow the query', async () => {
        const project = ref({ _id: 'p1', isGlobalPermission: true });
        mountSearch(project);
        api.resetFilters();

        api.taskSearch.value = 'Attach';
        api.searchMongoDB();
        expect(lastMatch()).toContainEqual({ $or: [{ TaskName: { $regex: 'Attach', $options: 'i' } }] });

        api.manageFilterUsers('user-1');
        expect(lastMatch()).toContainEqual({ AssigneeUserId: { $in: ['user-1'] } });

        api.applyFilter({ statusKey: { $in: [3] } });
        expect(lastMatch()).toContainEqual({ statusKey: { $in: [3] } });
        expect(api.searchTask.value).toBe(true);
    });

    test('clearing every filter empties search, "Me" and the saved filter, and tells the filter panel', async () => {
        const project = ref({ _id: 'p1', isGlobalPermission: true });
        mountSearch(project);
        api.resetFilters();
        api.taskSearch.value = 'x';
        api.manageFilterUsers('user-1');
        api.applyFilter({ statusKey: { $in: [3] } });
        const before = clearFilterSignal.value;

        api.clearAllFilters();
        await nextTick();
        expect(api.taskSearch.value).toBe('');
        expect(api.filterUsers.value).toEqual([]);
        expect(api.searchTask.value).toBe(false);
        expect(clearFilterSignal.value).toBe(before + 1);
    });
});
