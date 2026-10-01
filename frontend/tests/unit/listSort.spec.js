/* 042 slice 13: the List sorts within each group by due, priority, created, updated, name or
   status; Manual keeps the drag order and is the default; a sorted list cannot be dragged. */
import { describe, expect, test, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { computed, defineComponent, h, nextTick, ref } from 'vue';

vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true, debounce: (fn) => fn })
}));
vi.mock('@/views/Projects/helper.js', () => ({
    taskListHelper: () => ({ getSprintTasks: vi.fn(() => Promise.resolve()) }),
    useUpdateTasks: () => ({ updateTaskByGroup: vi.fn(() => Promise.resolve()) })
}));
vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ data: [] })) }));
vi.mock('@/views/Projects/ListView/useProjectAgentActivity.js', () => ({
    useProjectAgentActivity: () => ({ runFor: () => null, proposalFor: () => null, load: () => {} })
}));
vi.mock('@/views/Projects/ListView/useListDragDrop.js', () => ({ useListDragDrop: () => ({ applyDrag: vi.fn() }) }));
vi.mock('@/views/Projects/composables/savedViewApi', () => ({
    saveSharedViewSettings: vi.fn(async () => ({ status: true })),
    createSharedView: vi.fn(async () => ({ status: true, data: {} })),
    savePrivateViewSettings: vi.fn(async () => ({ status: true })),
    createPrivateView: vi.fn(async () => ({ status: true }))
}));

import { MANUAL, SORT_KEYS, cleanSort, settingsFromSort, sortFromSettings, sortTasks, useListSort } from '@/views/Projects/composables/viewSort';
import { useProjectSearch } from '@/views/Projects/composables/useProjectSearch';
import { useSavedViews } from '@/views/Projects/composables/useSavedViews';
import { provideViewSettings } from '@/views/Projects/composables/viewSettingsContext';
import ListGroup from '@/views/Projects/ListView/ListGroup.vue';
import ListSortControl from '@/views/Projects/ListView/ListSortControl.vue';
import en from '@/locales/en';

const priorities = [{ name: 'Urgent', value: 'URGENT' }, { name: 'High', value: 'HIGH' }, { name: 'Low', value: 'LOW' }];
const statuses = [{ key: 1, name: 'To do' }, { key: 2, name: 'Doing' }, { key: 3, name: 'Done' }];

const tasks = [
    { _id: 'a', TaskName: 'banana', DueDate: '2026-10-03', Task_Priority: 'LOW', createdAt: '2026-01-02', updatedAt: '2026-05-01', statusKey: 2 },
    { _id: 'b', TaskName: 'Apple', DueDate: null, Task_Priority: '', createdAt: { seconds: Date.parse('2026-01-01') / 1000 }, updatedAt: '2026-06-01', statusKey: 3 },
    { _id: 'c', TaskName: 'cherry 10', DueDate: '2026-10-01', Task_Priority: 'URGENT', createdAt: '2026-01-03', updatedAt: null, statusKey: 1 },
    { _id: 'd', TaskName: 'cherry 9', DueDate: '2026-10-02', Task_Priority: 'HIGH', createdAt: '2026-01-04', updatedAt: '2026-04-01', statusKey: 1 }
];
const ids = (rows) => rows.map((row) => row._id);
const sorted = (key, dir) => ids(sortTasks(tasks, { key, dir }, { priorities, statuses }));

describe('sortTasks', () => {
    test('offers manual, due, priority, created, updated, name, status, assignee, points and estimate', () => {
        expect(SORT_KEYS).toEqual(['manual', 'due', 'priority', 'created', 'updated', 'name', 'status', 'assignee', 'points', 'estimate']);
    });

    test('manual keeps the drag order and is the default', () => {
        expect(MANUAL).toEqual({ key: 'manual', dir: 'asc' });
        expect(sorted('manual', 'asc')).toEqual(['a', 'b', 'c', 'd']);
        expect(sortTasks(tasks, null)).toEqual(tasks);
    });

    test('due: soonest first, undated last either way', () => {
        expect(sorted('due', 'asc')).toEqual(['c', 'd', 'a', 'b']);
        expect(sorted('due', 'desc')).toEqual(['a', 'd', 'c', 'b']);
    });

    test('priority follows the company vocabulary, no priority last', () => {
        expect(sorted('priority', 'asc')).toEqual(['c', 'd', 'a', 'b']);
        expect(sorted('priority', 'desc')).toEqual(['a', 'd', 'c', 'b']);
    });

    test('created reads dates and stored seconds alike', () => {
        expect(sorted('created', 'asc')).toEqual(['b', 'a', 'c', 'd']);
        expect(sorted('created', 'desc')).toEqual(['d', 'c', 'a', 'b']);
    });

    test('updated puts a task with no date last', () => {
        expect(sorted('updated', 'desc')).toEqual(['b', 'a', 'd', 'c']);
        expect(sorted('updated', 'asc')).toEqual(['d', 'a', 'b', 'c']);
    });

    test('name ignores case and reads numbers as numbers', () => {
        expect(sorted('name', 'asc')).toEqual(['b', 'a', 'd', 'c']);
        expect(sorted('name', 'desc')).toEqual(['c', 'd', 'a', 'b']);
    });

    test('status follows the project workflow, ties keep the drag order', () => {
        expect(sorted('status', 'asc')).toEqual(['c', 'd', 'a', 'b']);
        expect(sorted('status', 'desc')).toEqual(['b', 'a', 'c', 'd']);
    });

    test('never changes the list it was given', () => {
        const copy = [...tasks];
        sortTasks(copy, { key: 'name', dir: 'asc' });
        expect(ids(copy)).toEqual(['a', 'b', 'c', 'd']);
    });
});

describe('the sort choice is the saved view sort', () => {
    const LIST = 'a'.repeat(24);
    const mountView = (settings) => {
        const project = ref({ _id: 'p1', isGlobalPermission: true, ProjectRequiredComponent: [{ _id: LIST, id: LIST, name: 'List', keyName: 'ProjectListView', viewStatus: true, settings }] });
        const companyUser = ref({ _id: 'row-1', userId: 'user-1', ProjectRequiredComponent: [] });
        const store = createStore({
            getters: { 'projectData/searchedTasks': () => [] },
            mutations: { 'projectData/mutateSearchTask': () => {}, 'projectData/projectLocalUpdate': () => {}, 'settings/mutateCompanyUsers': () => {} },
            actions: { 'projectData/searchTask': () => Promise.resolve() }
        });
        const out = {};
        const Sorter = defineComponent({ setup() { out.list = useListSort(); return () => null; } });
        const Host = defineComponent({
            setup() {
                const search = useProjectSearch(project, ref(false), { buildFilterQuery: (rows) => ({ rows: rows.length }) });
                out.saved = useSavedViews({
                    project, activeTab: ref('ProjectListView'), views: computed(() => project.value.ProjectRequiredComponent),
                    requestedViewKey: ref(undefined), companyUser, search, canSaveShared: ref(true)
                });
                provideViewSettings(out.saved);
                return () => h(Sorter);
            }
        });
        mount(Host, { global: { plugins: [store] } });
        return out;
    };

    test('an unknown key or direction falls back to Manual', () => {
        expect(cleanSort({ key: 'colour', dir: 'up' })).toEqual(MANUAL);
        expect(cleanSort({ key: 'due', dir: 'sideways' })).toEqual({ key: 'due', dir: 'asc' });
        expect(cleanSort(null)).toEqual(MANUAL);
    });

    test('Manual is stored as no sort, and every other key as the task field the Table sorts by', () => {
        expect(settingsFromSort(MANUAL)).toBe(null);
        expect(settingsFromSort({ key: 'name', dir: 'desc' })).toEqual({ field: 'TaskName', dir: -1 });
        expect(settingsFromSort({ key: 'status', dir: 'asc' })).toEqual({ field: 'statusKey', dir: 1 });
        expect(settingsFromSort({ key: 'due', dir: 'asc' })).toEqual({ field: 'DueDate', dir: 1 });
        for (const key of SORT_KEYS.slice(1)) {
            for (const dir of ['asc', 'desc']) expect(sortFromSettings(settingsFromSort({ key, dir }))).toEqual({ key, dir });
        }
        expect(sortFromSettings(null)).toEqual(MANUAL);
        expect(sortFromSettings({ field: 'Task_Leader', dir: 1 })).toEqual(MANUAL);
    });

    test('a view saved with a sort opens sorted', async () => {
        const { list, saved } = mountView({ sort: { field: 'createdAt', dir: -1 } });
        await flushPromises();
        expect(list.sort.value).toEqual({ key: 'created', dir: 'desc' });
        expect(list.isManual.value).toBe(false);
        expect(saved.dirty.value).toBe(false);
    });

    test('changing the sort is an unsaved change of the view, and Manual puts it back', async () => {
        const { list, saved } = mountView(undefined);
        await flushPromises();
        expect(list.sort.value).toEqual(MANUAL);

        list.setKey('updated');
        await nextTick();
        expect(saved.sort.value).toEqual({ field: 'updatedAt', dir: -1 });
        expect(saved.dirty.value).toBe(true);

        list.setDir('asc');
        await nextTick();
        expect(list.sort.value).toEqual({ key: 'updated', dir: 'asc' });

        list.setKey('manual');
        await nextTick();
        expect(saved.sort.value).toBe(null);
        expect(saved.dirty.value).toBe(false);
    });
});

describe('the List group sorts its own rows and stops dragging while sorted', () => {
    const PID = 'p1';
    const SPRINT = 's1';
    const item = { key: '0_0_To Do', name: 'To Do', isExpanded: true, searchKey: 'statusKey', searchValue: 1, indexName: 'groupByStatusIndex' };
    const row = (id, name, index, statusKey = 1) => ({ _id: id, TaskName: name, sprintId: SPRINT, statusKey, groupByStatusIndex: index, isParentTask: true, AssigneeUserId: [], deletedStatusKey: 0 });
    const stored = [row('t1', 'Zebra', 1), row('t2', 'apple', 2), row('t3', 'Mango', 3), row('t4', 'Aardvark', 4, 2)];

    const store = createStore({
        state: { taskSelection: { selectedTaskIds: [], lastAnchorId: null, activeView: 'list' } },
        getters: {
            'projectData/tasks': () => ({ [PID]: { [SPRINT]: { tasks: stored, found: {} } } }),
            'projectData/searchedTasks': () => [],
            'settings/companyPriority': () => priorities
        }
    });
    const RowStub = defineComponent({ name: 'ListRow', props: { data: Object, isSub: Boolean }, setup: (props) => () => h('div', { class: 'row', 'data-id': props.data._id }) });
    const DraggableStub = defineComponent({
        name: 'DraggableStub',
        props: ['list', 'disabled'],
        setup: (props, { slots }) => () => h('div', { class: 'drag', 'data-disabled': String(Boolean(props.disabled)) }, props.list.map((element) => slots.item({ element })))
    });
    const mountGroup = (sort) => mount(ListGroup, {
        props: { item, sprint: { id: SPRINT }, project: { _id: PID, taskStatusData: statuses }, groupType: 0 },
        global: {
            plugins: [store],
            provide: { searchedTask: ref(false), showArchived: ref(false), taskCollapsed: ref(true), listSort: ref(sort) },
            stubs: { ListRow: RowStub, draggable: DraggableStub, CreateTask: true }
        }
    });
    const rowIds = (wrapper) => wrapper.findAll('.row').map((r) => r.attributes('data-id'));

    test('manual keeps the stored order and can be dragged', () => {
        const wrapper = mountGroup(MANUAL);
        expect(rowIds(wrapper)).toEqual(['t1', 't2', 't3']);
        expect(wrapper.find('.drag').attributes('data-disabled')).toBe('false');
    });

    test('a sort orders only this group\'s rows and turns dragging off', () => {
        const wrapper = mountGroup({ key: 'name', dir: 'asc' });
        expect(rowIds(wrapper)).toEqual(['t2', 't3', 't1']);
        expect(wrapper.find('.drag').attributes('data-disabled')).toBe('true');
    });
});

describe('ListSortControl', () => {
    const mountControl = (sort = MANUAL) => mount(ListSortControl, { props: { sort }, attachTo: document.body, global: { stubs: { ShellIcon: true } } });

    test('lists every key and emits the one picked', async () => {
        const wrapper = mountControl();
        await wrapper.find('.lvs__trigger').trigger('click');
        const options = wrapper.findAll('input[name="lvs-key"]');
        expect(options.map((o) => o.element.value)).toEqual(SORT_KEYS);
        await options[5].setValue(true);
        expect(wrapper.emitted('key')[0]).toEqual(['name']);
        wrapper.unmount();
    });

    test('hides the direction under Manual and emits it otherwise', async () => {
        const manual = mountControl();
        await manual.find('.lvs__trigger').trigger('click');
        expect(manual.findAll('input[name="lvs-dir"]')).toHaveLength(0);
        manual.unmount();

        const wrapper = mountControl({ key: 'due', dir: 'asc' });
        await wrapper.find('.lvs__trigger').trigger('click');
        await wrapper.findAll('input[name="lvs-dir"]')[1].setValue(true);
        expect(wrapper.emitted('dir')[0]).toEqual(['desc']);
        wrapper.unmount();
    });

    test('says dragging is off while sorted', () => {
        expect(mountControl({ key: 'due', dir: 'asc' }).find('.lvs__hint').exists()).toBe(true);
        expect(mountControl().find('.lvs__hint').exists()).toBe(false);
    });

    test('closes on Escape and hands focus back to the trigger', async () => {
        const wrapper = mountControl();
        await wrapper.find('.lvs__trigger').trigger('click');
        await wrapper.find('.lvs__panel').trigger('keydown', { key: 'Escape' });
        expect(wrapper.find('.lvs__panel').exists()).toBe(false);
        wrapper.unmount();
    });

    test('has English text for every label', () => {
        for (const key of ['sort', 'sort_title', 'sort_order', 'sort_asc', 'sort_desc', 'sort_drag_off', ...SORT_KEYS.map((k) => `sort_${k}`)]) {
            expect(typeof en.List[key]).toBe('string');
        }
    });
});
