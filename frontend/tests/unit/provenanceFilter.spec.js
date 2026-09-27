/* Task 010 (29b): "Done by" narrows List, Table and Board through the one task search the
   toolbar's search, "Me" and saved filters already use, and is remembered with them. The
   Mongo condition itself is proved against the row badge in tests/provenance-done-by-query.test.js. */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref, defineComponent, h, nextTick } from 'vue';

const { groupItem } = vi.hoisted(() => ({
    groupItem: { key: '0_0_Done', name: 'Done', isExpanded: true, searchKey: 'statusKey', searchValue: 1, indexName: 'groupByStatusIndex' }
}));

vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true, debounce: (fn) => fn }),
    useGetterFunctions: () => ({ getUser: () => null })
}));
vi.mock('@/views/Projects/helper.js', () => ({
    taskListHelper: () => ({
        getSprintTasks: vi.fn(() => Promise.resolve()),
        groupBy: (_g, _n, _p, sprints, _r, _a, _v, _b, _c, cb) => cb([{ id: sprints[0].id, items: [groupItem] }])
    }),
    useUpdateTasks: () => ({ updateTaskByGroup: vi.fn(() => Promise.resolve()) })
}));
vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ data: [] })) }));
vi.mock('@/views/Projects/ListView/useProjectAgentActivity.js', () => ({
    useProjectAgentActivity: () => ({ runFor: () => null, proposalFor: () => null, load: () => {} })
}));
vi.mock('@/views/Projects/ListView/useListDragDrop.js', () => ({ useListDragDrop: () => ({ applyDrag: vi.fn() }) }));
vi.mock('@/composable/firstRunProgress', () => ({ markFirstRunStep: () => {}, FIRST_RUN_STEPS: {} }));
vi.mock('vue-router', () => ({ useRoute: () => ({ params: {} }) }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import ListGroup from '@/views/Projects/ListView/ListGroup.vue';
import TableViewTable from '@/views/Projects/TableView/TableViewTable.vue';
import BoardView from '@/views/Projects/Kanban/BoardView.vue';
import ProvenanceFilter from '@/components/molecules/Provenance/ProvenanceFilter.vue';
import { badgeOf } from '@/components/molecules/Provenance/provenance';
import { DONE_BY_OPTIONS, doneByMatch } from '@/components/molecules/Provenance/doneByQuery';
import { loadViewPrefs, saveViewPrefs } from '@/views/Projects/composables/projectViewPrefs';
import { useProjectSearch } from '@/views/Projects/composables/useProjectSearch';

const PID = 'p1';
const SPRINT = 's1';
const IDS = { companyId: 'company-1', userId: 'user-1', projectId: PID };
const at = '2026-09-01T10:00:00Z';
const person = (id) => ({ actorId: id, actorType: 'human', at });
const human = { actorId: 'u1', actorType: 'human', hours: 1 };
const agent = { actorId: 'u2', actorType: 'agent', agentId: 'a1', hours: 1 };

let index = 0;
const task = (id, statusType, completion) => ({
    _id: id,
    TaskName: id,
    sprintId: SPRINT,
    statusKey: 1,
    statusType,
    groupByStatusIndex: index++,
    isParentTask: true,
    AssigneeUserId: [],
    deletedStatusKey: 0,
    completion
});

const TASKS = [
    task('human', 'close', { workBy: [human], checkedBy: null, closedBy: person('u1') }),
    task('agent', 'close', { workBy: [agent], checkedBy: person('u3'), closedBy: person('u3') }),
    task('mixed', 'close', { workBy: [human, agent], checkedBy: person('u3'), closedBy: person('u3') }),
    task('unchecked', 'close', { workBy: [agent], checkedBy: null, closedBy: person('u1') }),
    task('open', 'active', { workBy: [agent], checkedBy: null, closedBy: null })
];

/* What the task search answers for a Done by option: the rows whose badge reads it. */
const answerFor = (option) => TASKS.filter((t) => option === 'all' || badgeOf(t) === option.toUpperCase());

const makeStore = (searched) => createStore({
    state: { taskSelection: { selectedTaskIds: [], lastAnchorId: null, activeView: 'list' } },
    getters: {
        'projectData/tasks': () => ({ [PID]: { [SPRINT]: { tasks: TASKS, found: {} } } }),
        'projectData/tableTasks': () => ({ [PID]: { [SPRINT]: { tasks: TASKS } } }),
        'projectData/searchedTasks': () => searched,
        'settings/selectedCompany': () => ({ planFeature: { boardView: true, tableView: true } })
    },
    mutations: { 'taskSelection/setActiveView': () => {}, 'taskSelection/setActiveProject': () => {} },
    actions: { 'projectData/setTableTasksFromTypesense': () => Promise.resolve() }
});

const provide = (searched) => ({
    searchedTask: ref(searched),
    showArchived: ref(false),
    taskCollapsed: ref(true),
    selectedProject: ref({ _id: PID, isGlobalPermission: true, taskStatusData: [], lastTaskId: 9 })
});

const RowStub = defineComponent({
    name: 'RowStub',
    props: { data: Object },
    setup: (props) => () => h('div', { class: 'row', 'data-id': props.data._id })
});
const DraggableStub = defineComponent({
    name: 'DraggableStub',
    props: ['list'],
    setup: (props, { slots }) => () => h('div', props.list.map((element) => slots.item({ element })))
});
const KanbanStub = defineComponent({
    name: 'KanbanBoard',
    props: { data: Array },
    setup: (props) => () => h('div', props.data.flatMap((group) => group.tasksArray.map((t) => h('div', { class: 'row', 'data-id': t._id }))))
});

const ids = (wrapper) => wrapper.findAll('.row').map((row) => row.attributes('data-id'));

const listIds = async (option) => {
    const wrapper = mount(ListGroup, {
        props: { item: groupItem, sprint: { id: SPRINT }, project: { _id: PID, taskStatusData: [] }, groupType: 0 },
        global: { plugins: [makeStore(answerFor(option))], provide: provide(option !== 'all'), stubs: { ListRow: RowStub, draggable: DraggableStub, CreateTask: true } }
    });
    await flushPromises();
    return ids(wrapper);
};

const tableIds = async (option) => {
    const wrapper = mount(TableViewTable, {
        props: { data: groupItem, sprintId: SPRINT },
        global: { plugins: [makeStore(answerFor(option))], provide: provide(option !== 'all'), stubs: { TableRow: RowStub, Skelaton: true } }
    });
    await flushPromises();
    return ids(wrapper);
};

const boardIds = async (option) => {
    const wrapper = mount(BoardView, {
        props: { grouped: 0, sprints: [{ id: SPRINT }], projectData: { _id: PID } },
        global: { plugins: [makeStore(answerFor(option))], provide: provide(option !== 'all'), stubs: { KanbanBoard: KanbanStub, ListBulkBar: true, EmptyState: true, Skelaton: true } }
    });
    await flushPromises();
    vi.advanceTimersByTime(600);
    await flushPromises();
    return ids(wrapper);
};

describe('List, Table and Board narrow the same way for every Done by option', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    test.each(DONE_BY_OPTIONS)('%s', async (option) => {
        const expected = answerFor(option).map((t) => t._id);
        expect(await listIds(option)).toEqual(expected);
        expect(await tableIds(option)).toEqual(expected);
        expect(await boardIds(option)).toEqual(expected);
        if (option !== 'all') expect(expected).toEqual([option]);
    });
});

describe('Done by rides the shared task search', () => {
    let dispatch;
    let api;

    beforeEach(() => {
        window.localStorage.clear();
        dispatch = vi.fn(() => Promise.resolve());
    });

    const mountSearch = () => {
        const store = createStore({
            getters: { 'projectData/searchedTasks': () => [] },
            mutations: { 'projectData/mutateSearchTask': () => {} },
            actions: { 'projectData/searchTask': (_ctx, payload) => dispatch(payload) }
        });
        const Host = defineComponent({
            setup() {
                api = useProjectSearch(ref({ _id: PID, isGlobalPermission: true }), ref(false));
                return () => h('div');
            }
        });
        return mount(Host, { global: { plugins: [store] } });
    };

    const lastMatch = () => dispatch.mock.calls.at(-1)[0].query[0].$match.$and;

    test.each(['human', 'agent', 'mixed', 'unchecked'])('choosing %s adds its condition and turns the search on', (option) => {
        mountSearch();
        api.resetFilters();
        api.setDoneBy(option);
        expect(api.doneBy.value).toBe(option);
        expect(api.searchTask.value).toBe(true);
        expect(lastMatch()).toContainEqual(doneByMatch(option));
    });

    test('All on its own switches the search back off', () => {
        mountSearch();
        api.resetFilters();
        api.setDoneBy('agent');
        const calls = dispatch.mock.calls.length;
        api.setDoneBy('all');
        expect(api.searchTask.value).toBe(false);
        expect(dispatch.mock.calls.length).toBe(calls);
    });

    test('it combines with search text and "Me"', () => {
        mountSearch();
        api.resetFilters();
        api.manageFilterUsers('user-1');
        api.setDoneBy('unchecked');
        expect(lastMatch()).toContainEqual({ AssigneeUserId: { $in: ['user-1'] } });
        expect(lastMatch()).toContainEqual(doneByMatch('unchecked'));
    });

    test('it is remembered per user and project like group, "Me" and search', async () => {
        mountSearch();
        api.resetFilters();
        api.setDoneBy('mixed');
        await nextTick();
        expect(loadViewPrefs(IDS).doneBy).toBe('mixed');
        expect(loadViewPrefs({ ...IDS, projectId: 'p2' }).doneBy).toBe('all');
    });

    test('a remembered choice comes back on reload and narrows the query', async () => {
        saveViewPrefs(IDS, { groupBy: 0, me: false, search: '', doneBy: 'agent' });
        mountSearch();
        api.resetFilters();
        await nextTick();
        expect(api.doneBy.value).toBe('agent');
        expect(lastMatch()).toContainEqual(doneByMatch('agent'));
    });

    test('clearing every filter clears it too', async () => {
        mountSearch();
        api.resetFilters();
        api.setDoneBy('human');
        api.clearAllFilters();
        await nextTick();
        expect(api.doneBy.value).toBe('all');
        expect(api.searchTask.value).toBe(false);
    });

    test('a foreign stored value falls back to all', () => {
        window.localStorage.setItem(`ah.projectView.company-1.user-1.${PID}`, JSON.stringify({ doneBy: 'robots', me: true }));
        expect(loadViewPrefs(IDS)).toEqual({ groupBy: 0, me: true, search: '', doneBy: 'all' });
    });
});

describe('the Done by control', () => {
    test('is a labelled select with every option', () => {
        const wrapper = mount(ProvenanceFilter, { props: { modelValue: 'all' } });
        const select = wrapper.get('select');
        expect(select.attributes('aria-label')).toBe('Provenance.filter_label');
        expect(wrapper.findAll('option').map((o) => o.element.value)).toEqual(DONE_BY_OPTIONS);
        expect(wrapper.classes()).not.toContain('is-active');
    });

    test('reports the chosen option and marks itself active', async () => {
        const wrapper = mount(ProvenanceFilter, { props: { modelValue: 'all' } });
        await wrapper.get('select').setValue('unchecked');
        expect(wrapper.emitted('update:modelValue')).toEqual([['unchecked']]);
        await wrapper.setProps({ modelValue: 'unchecked' });
        expect(wrapper.classes()).toContain('is-active');
    });
});
