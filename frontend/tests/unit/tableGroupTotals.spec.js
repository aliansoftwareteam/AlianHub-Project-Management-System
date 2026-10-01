/* 046 (AP-441): the Table totals each group the way the List does, from the same composable and the same server query. */
import { describe, expect, test, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import { defineComponent, h, reactive, ref } from 'vue';

const api = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true, checkApps: () => true, debounce: (fn) => fn }),
    useGetterFunctions: () => ({ getUser: () => null })
}));
vi.mock('@/views/Projects/helper.js', () => ({
    taskListHelper: () => ({ getSprintTasks: vi.fn(() => Promise.resolve()) }),
    useUpdateTasks: () => ({ updateTaskByGroup: vi.fn(() => Promise.resolve()) })
}));
vi.mock('@/services', () => ({ apiRequest: api.apiRequest }));
vi.mock('@/views/Projects/ListView/useProjectAgentActivity.js', () => ({
    useProjectAgentActivity: () => ({ runFor: () => null, proposalFor: () => null, load: () => {} })
}));
vi.mock('@/views/Projects/ListView/useListDragDrop.js', () => ({ useListDragDrop: () => ({ applyDrag: vi.fn() }) }));

import ListGroup from '@/views/Projects/ListView/ListGroup.vue';
import TableViewTable from '@/views/Projects/TableView/TableViewTable.vue';
import { totalColumnsOf } from '@/views/Projects/composables/groupTotals';
import { columnCatalogue } from '@/views/Projects/composables/viewColumns';
import { MANUAL } from '@/views/Projects/composables/viewSort';
import { refreshGroupCounts } from '@/store/ProjectData/actions';
import { mutateTableGroupCounts } from '@/store/ProjectData/mutations';
import { groupCountsQuery } from '@/store/ProjectData/taskQueries';
import en from '@/locales/en';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
config.global.plugins = [];
config.global.mocks = {};

const PID = 'p1';
const SPRINT = 's1';
const COST = { _id: 'a'.repeat(24), fieldTitle: 'Cost', fieldType: 'number' };
const BUDGET = { _id: 'b'.repeat(24), fieldTitle: 'Budget', fieldType: 'money', fieldMoneySymbol: '₹' };
const NOTE = { _id: 'e'.repeat(24), fieldTitle: 'Note', fieldType: 'text' };
const idOf = (field) => `cf:${field._id}`;
const value = (field, fieldValue) => ({ [field._id]: { fieldValue, _id: field._id } });
const item = { key: '0_0_To Do', name: 'To Do', isExpanded: true, searchKey: 'statusKey', searchValue: 1, indexName: 'groupByStatusIndex', conditions: [{ statusKey: 1 }] };
const row = (id, more) => ({ _id: id, TaskName: id, sprintId: SPRINT, statusKey: 1, groupByStatusIndex: 1, isParentTask: true, TaskTypeKey: 1, AssigneeUserId: [], deletedStatusKey: 0, ...more });
const rows = () => [
    row('t1', { points: 5, customField: { ...value(COST, '120'), ...value(BUDGET, '1000.5') } }),
    row('t2', { points: 3, customField: value(COST, 30) }),
    row('t3', { customField: value(COST, '') })
];
const SERVER = { points: 61, [idOf(COST)]: 4200, [idOf(BUDGET)]: 9000.25 };

const RowStub = defineComponent({ name: 'ListRow', props: { data: Object }, setup: (props) => () => h('div', { class: 'row', 'data-id': props.data._id }) });
const DraggableStub = defineComponent({ name: 'DraggableStub', props: ['list'], setup: (props, { slots }) => () => h('div', props.list.map((element) => slots.item({ element }))) });

const table = async ({ found, totals, fields = [COST, BUDGET], shown = ['points', idOf(COST), idOf(BUDGET)], tasks = rows(), searched = false }) => {
    const state = reactive({ tasks, counts: found === undefined ? null : { found: { statusKey_1: found }, totals: totals ? { statusKey_1: totals } : {} } });
    const store = createStore({
        state: { taskSelection: { selectedTaskIds: [], lastAnchorId: null, activeView: 'table' } },
        getters: {
            'projectData/tableTasks': () => ({ [PID]: { [SPRINT]: { tasks: state.tasks } } }),
            'projectData/tableGroupCounts': () => ({ [PID]: { [SPRINT]: state.counts } }),
            'projectData/searchedTasks': () => (searched ? state.tasks : [])
        },
        mutations: { 'taskSelection/setActiveView': () => {}, 'taskSelection/setActiveProject': () => {} },
        actions: { 'projectData/setTableTasksFromTypesense': () => Promise.resolve() }
    });
    const tableColumns = ref(columnCatalogue('table', { fields }).filter((column) => shown.includes(column.id) || column.base));
    const refresh = vi.fn();
    const wrapper = mount(TableViewTable, {
        props: { data: item, sprintId: SPRINT, showPoints: true },
        global: {
            plugins: [store, i18n],
            provide: {
                searchedTask: ref(searched), showArchived: ref(false), selectedProject: ref({ _id: PID, isGlobalPermission: true }),
                tableColumns, tableTotals: { columns: ref(totalColumnsOf(tableColumns.value)), refresh }
            },
            stubs: { TableRow: true, TableSubtaskRows: true, Skelaton: true }
        }
    });
    await flushPromises();
    return { wrapper, state, refresh };
};

const list = async ({ found, totals, fields = [COST, BUDGET], shown = ['points', idOf(COST), idOf(BUDGET)] }) => {
    const sprint = reactive({ tasks: rows(), found: { statusKey_1: found }, totals: totals ? { statusKey_1: totals } : {} });
    const store = createStore({
        state: { taskSelection: { selectedTaskIds: [], lastAnchorId: null, activeView: 'list' } },
        getters: {
            'projectData/tasks': () => ({ [PID]: { [SPRINT]: sprint } }),
            'projectData/searchedTasks': () => [],
            'settings/companyPriority': () => []
        }
    });
    const listColumns = ref(columnCatalogue('list', { fields }).filter((column) => shown.includes(column.id) || column.base));
    const wrapper = mount(ListGroup, {
        props: { item, sprint: { id: SPRINT }, project: { _id: PID, taskStatusData: [] }, groupType: 0 },
        global: {
            plugins: [store, i18n],
            provide: {
                searchedTask: ref(false), showArchived: ref(false), taskCollapsed: ref(true), listSort: ref(MANUAL), listColumns,
                listTotals: { columns: ref(totalColumnsOf(listColumns.value)), refresh: vi.fn() }
            },
            stubs: { ListRow: RowStub, draggable: DraggableStub, CreateTask: true }
        }
    });
    await flushPromises();
    return wrapper;
};

const cell = (wrapper, id) => wrapper.get(`[data-total="${id}"]`).text();

describe('the totals row of a Table group', () => {
    test('adds the rows of a fully loaded group, under each shown number column', async () => {
        const { wrapper, refresh } = await table({ found: 3 });
        expect(wrapper.get('.tv2__totals-label').text()).toBe('Total');
        expect(cell(wrapper, idOf(COST))).toBe('150');
        expect(cell(wrapper, 'points')).toBe('8');
        expect(wrapper.get(`[data-total="${idOf(COST)}"]`).attributes('title')).toBe('Sum of Cost: 150');
        expect(wrapper.get('.tv2__points-total').text()).toBe('8 pts');
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    test('follows a value that changes in a loaded row', async () => {
        const { wrapper, state, refresh } = await table({ found: 3 });
        state.tasks[2].customField = value(COST, '50');
        await flushPromises();
        expect(cell(wrapper, idOf(COST))).toBe('200');
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    test('shows the server\'s total for a partly loaded group, and nothing until it arrives', async () => {
        const { wrapper, state, refresh } = await table({ found: 40 });
        expect(cell(wrapper, idOf(COST))).toBe('');
        expect(refresh).toHaveBeenCalled();
        state.counts = { found: { statusKey_1: 40 }, totals: { statusKey_1: SERVER } };
        await flushPromises();
        expect(cell(wrapper, idOf(COST))).toBe('4200');
        expect(cell(wrapper, 'points')).toBe('61');
        expect(wrapper.get('.tv2__points-total').text()).toBe('61 pts');
    });

    test('waits for the group count rather than showing a sum of the rows loaded so far', async () => {
        const { wrapper } = await table({});
        expect(cell(wrapper, idOf(COST))).toBe('');
    });

    test('is left out when no number column is shown', async () => {
        const { wrapper } = await table({ found: 3, fields: [COST, NOTE], shown: [idOf(NOTE)] });
        expect(wrapper.find('[data-group-totals]').exists()).toBe(false);
    });

    test('shows money with the field\'s symbol', async () => {
        const { wrapper } = await table({ found: 40, totals: SERVER });
        expect(cell(wrapper, idOf(BUDGET))).toBe('₹9000.25');
        const full = await table({ found: 3 });
        expect(cell(full.wrapper, idOf(BUDGET))).toBe('₹1000.5');
    });

    test('adds the rows of a search result as they are', async () => {
        const { wrapper } = await table({ searched: true });
        expect(cell(wrapper, idOf(COST))).toBe('150');
    });
});

describe('List and Table', () => {
    test.each([
        ['a fully loaded group', { found: 3 }],
        ['a partly loaded group', { found: 40, totals: SERVER }]
    ])('show the same total for %s', async (_, scenario) => {
        const inList = await list(scenario);
        const { wrapper: inTable } = await table(scenario);
        for (const id of ['points', idOf(COST), idOf(BUDGET)]) {
            expect(cell(inTable, id)).toBe(cell(inList, id));
        }
    });

    test('ask the server with the same query', async () => {
        const commit = vi.fn();
        api.apiRequest.mockResolvedValue({ status: 200, data: [{ g0: [{ count: 40, t0: 4200, t1: 9000.25, t2: 0 }] }] });
        const totals = totalColumnsOf(columnCatalogue('table', { fields: [COST, BUDGET] }));
        const payload = { pid: PID, sprintId: SPRINT, items: [item], showAllTasks: false, userId: 'u1', totals };
        await refreshGroupCounts({ state: { tasks: {}, tableTasks: {} }, commit }, { ...payload, table: true });
        expect(api.apiRequest).toHaveBeenCalledWith('post', expect.any(String), { findQuery: groupCountsQuery(payload) });
        expect(commit).toHaveBeenCalledWith('mutateTableGroupCounts', expect.objectContaining({
            found: { statusKey_1: 40 },
            totals: { statusKey_1: { points: 4200, [idOf(COST)]: 9000.25, [idOf(BUDGET)]: 0 } }
        }));
    });

    test('keep a table group\'s answer apart from the List\'s', () => {
        const state = { tableGroupCounts: {} };
        mutateTableGroupCounts(state, { pid: PID, sprintId: SPRINT, found: { statusKey_1: 4 }, totals: { statusKey_1: { points: 1 } } });
        mutateTableGroupCounts(state, { pid: PID, sprintId: SPRINT, found: { statusKey_2: 2 }, totals: null });
        expect(state.tableGroupCounts[PID][SPRINT]).toEqual({ found: { statusKey_1: 4, statusKey_2: 2 }, totals: { statusKey_1: { points: 1 } } });
    });
});
