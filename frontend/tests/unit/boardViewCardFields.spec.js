/* Task 044 slice 1: the Board's card fields offer the project's custom fields, the same
   "shown fields" choice the List and Table make, saved with the view. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, inject, ref } from 'vue';
import { createStore } from 'vuex';

const access = vi.hoisted(() => ({ fieldPermission: true, fieldsApp: true }));
const composable = vi.hoisted(() => ({
    useCustomComposable: () => ({
        checkPermission: (path) => (path === 'task.task_custom_field' ? access.fieldPermission : true),
        checkApps: (app) => (app === 'CustomFields' ? access.fieldsApp : true)
    })
}));
vi.mock('@/composable', () => composable);
vi.mock('@/composable/index', () => composable);
vi.mock('@/composable/index.js', () => composable);
vi.mock('@/composable/firstRunProgress', () => ({ markFirstRunStep: vi.fn(), FIRST_RUN_STEPS: { BOARD_VIEW: 'board' } }));
vi.mock('@/views/Projects/helper.js', () => ({
    taskListHelper: () => ({
        groupBy: (...args) => args[args.length - 1]([{ id: 's1', items: [{ name: 'To do', searchKey: 'statusKey', searchValue: 1 }] }])
    })
}));
vi.mock('@/views/Projects/composables/useTaskEmptyState.js', () => ({ useTaskEmptyState: () => ({ emptyTitleKey: ref('a'), emptyMessageKey: ref('b') }) }));
vi.mock('vue-router', () => ({ useRoute: () => ({ name: 'ProjectKanban', params: {} }) }));

import BoardView from '@/views/Projects/Kanban/BoardView.vue';
import { provideViewSettings } from '@/views/Projects/composables/viewSettingsContext';

const DEFS = [
    { _id: 'f-text', fieldType: 'text', fieldTitle: 'Customer', isDelete: true, type: 'task', projectId: ['p1'] },
    { _id: 'f-num', fieldType: 'number', fieldTitle: 'Seats', isDelete: true, global: true },
    { _id: 'f-other', fieldType: 'text', fieldTitle: 'Elsewhere', isDelete: true, projectId: ['p2'] }
];

const seen = {};
const Chooser = defineComponent({
    name: 'ViewColumnChooser',
    props: { columns: { type: Array, default: () => [] }, titleKey: { type: String, default: '' } },
    setup(props) {
        seen.chooser = props;
        return () => h('div', { class: 'chooser' });
    }
});
const Board = defineComponent({
    name: 'KanbanBoard',
    setup() {
        seen.cardFields = inject('boardCardFields', null);
        seen.fieldTasks = inject('boardFieldTasks', null);
        return () => h('div', { class: 'board' });
    }
});

const mountBoard = async ({ columns = { order: [], shown: [], hidden: [] } } = {}) => {
    const settings = { sort: ref(null), columns: ref(columns) };
    settings.setSort = (value) => { settings.sort.value = value; };
    settings.setColumns = (value) => { settings.columns.value = value; };
    const store = createStore({
        getters: {
            'settings/selectedCompany': () => ({ planFeature: { boardView: true, customFields: true } }),
            'settings/finalCustomFields': () => DEFS,
            'projectData/tasks': () => ({ p1: { s1: { tasks: [{ _id: 't1', statusKey: 1, sprintId: 's1', customField: {} }] } } }),
            'projectData/tableTasks': () => ({}),
            'projectData/searchedTasks': () => []
        }
    });
    const Host = defineComponent({
        setup() {
            provideViewSettings(settings);
            return () => h(BoardView, { sprints: [{ id: 's1' }] });
        }
    });
    const wrapper = mount(Host, {
        global: {
            plugins: [store],
            provide: {
                showArchived: ref(false),
                searchedTask: ref(false),
                selectedProject: ref({ _id: 'p1', isGlobalPermission: true, taskStatusData: [] })
            },
            stubs: { ViewColumnChooser: Chooser, KanbanBoard: Board, ListBulkBar: true, UpgradePlan: true, Skelaton: true, EmptyState: true }
        }
    });
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 550));
    await flushPromises();
    return { wrapper, settings };
};

const chooserIds = () => seen.chooser.columns.map((column) => [column.id, column.visible]);

describe('board card fields', () => {
    beforeEach(() => {
        access.fieldPermission = true;
        access.fieldsApp = true;
        Object.keys(seen).forEach((key) => delete seen[key]);
    });

    it("offers the project's custom fields beside points, none shown until chosen", async () => {
        await mountBoard();
        expect(chooserIds()).toEqual([['points', false], ['cf:f-text', false], ['cf:f-num', false]]);
        expect(seen.chooser.columns.find((column) => column.id === 'cf:f-text').label).toBe('Customer');
        expect(seen.cardFields.value).toEqual([]);
    });

    it('puts the fields the saved view shows on the cards, in its order, with what rollups need', async () => {
        await mountBoard({ columns: { order: ['cf:f-num', 'points', 'cf:f-text'], shown: ['cf:f-num', 'cf:f-text'], hidden: [] } });
        expect(seen.cardFields.value.map((column) => column.id)).toEqual(['cf:f-num', 'cf:f-text']);
        expect(seen.cardFields.value[0].field._id).toBe('f-num');
        expect(Array.isArray(seen.fieldTasks.value)).toBe(true);
    });

    it('writes a choice into the open view, where saving stores it', async () => {
        const { wrapper, settings } = await mountBoard();
        wrapper.findComponent(Chooser).vm.$emit('toggle', 'cf:f-text', true);
        await flushPromises();
        expect(settings.columns.value.shown).toEqual(['cf:f-text']);
        expect(seen.cardFields.value.map((column) => column.id)).toEqual(['cf:f-text']);
    });

    it.each([
        ['without custom field access', () => { access.fieldPermission = null; }],
        ['with the Custom Fields app off', () => { access.fieldsApp = false; }]
    ])('offers only points %s', async (_, arrange) => {
        arrange();
        await mountBoard();
        expect(chooserIds()).toEqual([['points', false]]);
    });
});
