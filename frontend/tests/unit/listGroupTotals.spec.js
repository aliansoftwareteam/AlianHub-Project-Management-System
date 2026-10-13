/* 046: a grouped List totals its number columns per group, for the whole group and not only the rows it holds. */
import { describe, expect, test, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import { defineComponent, h, reactive, ref } from 'vue';

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

import ListGroup from '@/views/Projects/ListView/ListGroup.vue';
import { loadedTotals, totalColumnsOf, totalText } from '@/views/Projects/composables/groupTotals';
import { columnCatalogue } from '@/views/Projects/composables/viewColumns';
import { MANUAL } from '@/views/Projects/composables/viewSort';
import en from '@/locales/en';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
config.global.plugins = [];
config.global.mocks = {};

const COST = { _id: 'a'.repeat(24), fieldTitle: 'Cost', fieldType: 'number' };
const BUDGET = { _id: 'b'.repeat(24), fieldTitle: 'Budget', fieldType: 'money', fieldMoneySymbol: '₹' };
const MARGIN = { _id: 'c'.repeat(24), fieldTitle: 'Margin', fieldType: 'formula', fieldValidation: 'number' };
const VERDICT = { _id: 'd'.repeat(24), fieldTitle: 'Verdict', fieldType: 'formula', fieldValidation: 'text' };
const NOTE = { _id: 'e'.repeat(24), fieldTitle: 'Note', fieldType: 'text' };
const BUG_COST = { _id: 'f'.repeat(24), fieldTitle: 'Bug cost', fieldType: 'number', fieldTaskTypes: [2] };
const columns = (fields) => columnCatalogue('list', { fields });
const idOf = (field) => `cf:${field._id}`;
const value = (field, fieldValue) => ({ [field._id]: { fieldValue, _id: field._id } });

describe('the columns a group totals', () => {
    test('are story points, number and money fields, and formulas and rollups that give a number', () => {
        const totals = totalColumnsOf(columns([COST, BUDGET, MARGIN, VERDICT, NOTE]));
        expect(totals.map((total) => total.id)).toEqual(['points', idOf(COST), idOf(BUDGET), idOf(MARGIN)]);
        expect(totals[0]).toMatchObject({ path: 'points', wrapped: false });
        expect(totals[1]).toMatchObject({ path: `customField.${COST._id}`, wrapped: true, taskTypes: [] });
    });

    test('leave out a field whose id could not be a path in the query', () => {
        expect(totalColumnsOf(columns([{ ...COST, _id: 'x.$where' }])).map((total) => total.id)).toEqual(['points']);
    });
});

describe('the total of the rows the List holds', () => {
    const totals = totalColumnsOf(columns([COST, BUG_COST]));

    test('counts a blank as zero and skips a row the field is not for', () => {
        const rows = [
            { _id: 't1', points: 3, TaskTypeKey: 1, customField: { ...value(COST, '120'), ...value(BUG_COST, '9') } },
            { _id: 't2', points: '', TaskTypeKey: 2, customField: { ...value(COST, ''), ...value(BUG_COST, 4) } },
            { _id: 't3', TaskTypeKey: 2, customField: value(COST, 30.5) }
        ];
        expect(loadedTotals(rows, totals)).toEqual({ points: 3, [idOf(COST)]: 150.5, [idOf(BUG_COST)]: 4 });
    });

    test('shows money with the field\'s currency symbol', () => {
        const [, budget] = totalColumnsOf(columns([BUDGET]));
        expect(totalText(budget, 1250.5)).toBe('₹1250.5');
        expect(totalText(totals[1], 0.1 + 0.2)).toBe('0.3');
    });
});

describe('the totals row of a List group', () => {
    const PID = 'p1';
    const SPRINT = 's1';
    const item = { key: '0_0_To Do', name: 'To Do', isExpanded: true, searchKey: 'statusKey', searchValue: 1, indexName: 'groupByStatusIndex' };
    const row = (id, more) => ({ _id: id, TaskName: id, sprintId: SPRINT, statusKey: 1, groupByStatusIndex: 1, isParentTask: true, TaskTypeKey: 1, AssigneeUserId: [], deletedStatusKey: 0, ...more });
    const RowStub = defineComponent({ name: 'ListRow', props: { data: Object }, setup: (props) => () => h('div', { class: 'row', 'data-id': props.data._id }) });
    const DraggableStub = defineComponent({ name: 'DraggableStub', props: ['list'], setup: (props, { slots }) => () => h('div', props.list.map((element) => slots.item({ element }))) });

    const group = async ({ found, totals, fields = [COST, BUDGET], shown = ['points', idOf(COST), idOf(BUDGET)] }) => {
        const sprint = reactive({
            tasks: [
                row('t1', { points: 5, customField: { ...value(COST, '120'), ...value(BUDGET, '1000') } }),
                row('t2', { points: 3, customField: value(COST, 30) }),
                row('t3', { customField: value(COST, '') })
            ],
            found: found === undefined ? {} : { statusKey_1: found },
            totals: totals ? { statusKey_1: totals } : {}
        });
        const store = createStore({
            state: { taskSelection: { selectedTaskIds: [], lastAnchorId: null, activeView: 'list' } },
            getters: {
                'projectData/tasks': () => ({ [PID]: { [SPRINT]: sprint } }),
                'projectData/searchedTasks': () => [],
                'settings/companyPriority': () => []
            }
        });
        const listColumns = ref(columns(fields).filter((column) => shown.includes(column.id) || column.base));
        const refresh = vi.fn();
        const wrapper = mount(ListGroup, {
            props: { item, sprint: { id: SPRINT }, project: { _id: PID, taskStatusData: [] }, groupType: 0 },
            global: {
                plugins: [store, i18n],
                provide: {
                    searchedTask: ref(false), showArchived: ref(false), taskCollapsed: ref(true), listSort: ref(MANUAL), listColumns,
                    listTotals: { columns: ref(totalColumnsOf(listColumns.value)), refresh }
                },
                stubs: { ListRow: RowStub, draggable: DraggableStub, CreateTask: true }
            }
        });
        await flushPromises();
        return { wrapper, sprint, refresh };
    };
    const cell = (wrapper, id) => wrapper.get(`[data-total="${id}"]`).text();

    test('adds the loaded rows when the whole group is loaded, under each column', async () => {
        const { wrapper, refresh } = await group({ found: 3 });
        expect(wrapper.get('[data-group-totals] .lv2__totals-label').text()).toBe('Total');
        expect(wrapper.get(`[data-total="${idOf(COST)}"]`).attributes('title')).toBe('Sum of Cost: 150');
        expect(cell(wrapper, idOf(COST))).toBe('150');
        expect(cell(wrapper, idOf(BUDGET))).toBe('₹1000');
        expect(cell(wrapper, 'points')).toBe('8');
        expect(cell(wrapper, 'assignee')).toBe('');
        expect(refresh).not.toHaveBeenCalled();
    });

    test('follows a value that changes in a loaded row', async () => {
        const { wrapper, sprint } = await group({ found: 3 });
        sprint.tasks[2].customField = value(COST, '50');
        await flushPromises();
        expect(cell(wrapper, idOf(COST))).toBe('200');
    });

    test('shows the server\'s total while part of the group is not loaded', async () => {
        const { wrapper, refresh } = await group({ found: 40, totals: { points: 61, [idOf(COST)]: 4200, [idOf(BUDGET)]: 9000 } });
        expect(cell(wrapper, idOf(COST))).toBe('4200');
        expect(cell(wrapper, idOf(BUDGET))).toBe('₹9000');
        expect(cell(wrapper, 'points')).toBe('61');
        expect(wrapper.get('.lv2__group-points').text()).toBe('61 pts');
        expect(refresh).toHaveBeenCalled();
    });

    test('shows no number for a partly loaded group until the server has answered', async () => {
        const { wrapper, sprint, refresh } = await group({ found: 40 });
        expect(cell(wrapper, idOf(COST))).toBe('');
        expect(refresh).toHaveBeenCalled();
        sprint.totals = { statusKey_1: { points: 61, [idOf(COST)]: 4200, [idOf(BUDGET)]: 0 } };
        await flushPromises();
        expect(cell(wrapper, idOf(COST))).toBe('4200');
        expect(cell(wrapper, idOf(BUDGET))).toBe('₹0');
    });

    test('is left out when no number column is shown', async () => {
        const { wrapper } = await group({ found: 3, shown: [] });
        expect(wrapper.find('[data-group-totals]').exists()).toBe(false);
    });
});
