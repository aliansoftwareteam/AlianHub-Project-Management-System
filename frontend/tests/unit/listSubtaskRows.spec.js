/* Task 045.4 — a subtask row in the List edits in place and joins bulk selection like a task row. */
import { describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createStore } from 'vuex';
import { defineComponent, h, ref } from 'vue';
import en from '@/locales/en';
import taskSelection from '@/store/TaskSelection';

vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ data: [] })) }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true, debounce: (fn) => fn })
}));
vi.mock('@/views/Projects/helper.js', () => ({
    taskListHelper: () => ({ getSprintTasks: vi.fn(() => Promise.resolve()) }),
    useUpdateTasks: () => ({ updateTaskByGroup: vi.fn(() => Promise.resolve()) })
}));
vi.mock('@/views/Projects/ListView/useProjectAgentActivity.js', () => ({
    useProjectAgentActivity: () => ({ runFor: () => null, proposalFor: () => null, load: () => {} })
}));
vi.mock('@/views/Projects/ListView/useListDragDrop.js', () => ({ useListDragDrop: () => ({ applyDrag: vi.fn() }) }));

import ListRow from '@/views/Projects/ListView/ListRow.vue';
import ListGroup from '@/views/Projects/ListView/ListGroup.vue';
import { snapshotTasks } from '@/views/Projects/ListView/bulkUndo.js';
import { selectionShape } from '@/views/Projects/ListView/bulkPlacement.js';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
config.global.plugins = [i18n];

const PID = 'p1';
const SPRINT = 's1';
const OPEN = { key: 1, name: 'Open', type: 'default_active' };
const DONE = { key: 2, name: 'Complete', type: 'close' };
const FIELD = { _id: 'cf1', fieldTitle: 'Budget', fieldType: 'number' };

const sub = (id, over = {}) => ({
    _id: id, TaskName: `Subtask ${id}`, TaskKey: `AH-${id}`, ProjectID: PID, sprintId: SPRINT, isParentTask: false, ParentTaskId: 't1',
    statusKey: 1, AssigneeUserId: [], Task_Priority: 'HIGH', DueDate: '', deletedStatusKey: 0, ...over
});
const parent = (over = {}) => ({
    _id: 't1', TaskName: 'Parent task', TaskKey: 'AH-1', ProjectID: PID, sprintId: SPRINT, isParentTask: true, statusKey: 1,
    groupByStatusIndex: 1, AssigneeUserId: [], deletedStatusKey: 0, subTasks: 2, subtaskArray: [sub('s-a'), sub('s-b')], ...over
});
const loner = () => ({ _id: 't2', TaskName: 'Other task', ProjectID: PID, sprintId: SPRINT, isParentTask: true, statusKey: 1, groupByStatusIndex: 2, AssigneeUserId: [], deletedStatusKey: 0 });

const ALL = { status: true, assignee: true, due: true, priority: true, rename: true, subtask: true, estimate: true, points: true, customField: true, template: true };
const NONE = Object.fromEntries(Object.keys(ALL).map((key) => [key, false]));

const edit = (rights = ALL) => ({
    rights: ref(rights),
    showPriority: ref(true),
    statuses: ref([OPEN, DONE]),
    multipleAssignees: ref(false),
    fields: { allTasks: ref([]), defs: ref([FIELD]) },
    assigneeOptions: () => ['u1', 'u2'],
    setStatus: vi.fn(), setAssignee: vi.fn(), setDue: vi.fn(), setPriority: vi.fn(), setEstimate: vi.fn(), setCustomField: vi.fn(), rename: vi.fn(),
    copyLink: vi.fn(), copyKey: vi.fn(), taskHref: () => 'http://x/#/s-a'
});
const menu = () => ({
    rights: ref({ archive: true, delete: true, move: true, duplicate: true }),
    archive: vi.fn(), remove: vi.fn(), startMove: vi.fn(), duplicate: vi.fn(), openSidebar: vi.fn()
});

const COLUMNS = [
    { id: 'assignee' }, { id: 'due' }, { id: 'priority' }, { id: 'estimate' }, { id: 'tags' },
    { id: 'cf:cf1', field: FIELD, label: 'Budget' }
];

const rowStore = () => createStore({
    getters: {
        'settings/companyPriority': () => [],
        'projectData/searchedTasks': () => [],
        'projectData/tasks': () => ({})
    }
});

const renderSub = ({ ctx = edit(), rowMenu = menu(), data = sub('s-a'), props = {} } = {}) => mount(ListRow, {
    props: { data, isSub: true, canSelect: true, ...props },
    global: {
        plugins: [rowStore()],
        mocks: { $t: (key, values) => i18n.global.t(key, values) },
        provide: { listRowEdit: ctx, listRowMenu: rowMenu, listColumns: ref(COLUMNS), selectedProject: ref({ _id: PID }) },
        stubs: {
            ShellIcon: true, ProvenanceBadge: true, TaskTagCell: true, ListStatusCircle: true, ListAssigneeCell: true,
            ListDueCell: true, ListPriorityCell: true, EstimateCell: true, CustomFieldCell: true
        }
    }
});

describe('a subtask row edits in place like a task row', () => {
    it('has a selection checkbox named for the subtask, and ticking it asks the group to select it', async () => {
        const wrapper = renderSub();
        const box = wrapper.find('.lv2__c-select input[type="checkbox"]');
        expect(box.exists()).toBe(true);
        expect(box.attributes('aria-label')).toBe('Select subtask Subtask s-a');
        await box.trigger('click');
        expect(wrapper.emitted('select')[0][0]).toMatchObject({ _id: 's-a' });
    });

    it('shows no selection checkbox where the list does not allow selecting', () => {
        expect(renderSub({ props: { canSelect: false } }).find('.lv2__c-select input').exists()).toBe(false);
    });

    it('a task row names its checkbox through i18n as well', () => {
        const wrapper = renderSub({ data: parent(), props: { isSub: false } });
        expect(wrapper.find('.lv2__c-select input').attributes('aria-label')).toBe('Select Parent task');
    });

    it('status is the same editable circle, writing through the shared status update', () => {
        const ctx = edit();
        const wrapper = renderSub({ ctx });
        const circle = wrapper.findComponent({ name: 'ListStatusCircle' });
        expect(circle.props('editable')).toBe(true);
        expect(wrapper.find('.lv2__c-title input[type="checkbox"]').exists()).toBe(false);
        circle.vm.$emit('change', DONE);
        expect(ctx.setStatus).toHaveBeenCalledWith(expect.objectContaining({ _id: 's-a' }), DONE, expect.anything());
    });

    it('assignee, due date, priority, estimate and custom fields open for editing', () => {
        const ctx = edit();
        const wrapper = renderSub({ ctx });
        for (const name of ['ListAssigneeCell', 'ListDueCell', 'ListPriorityCell', 'EstimateCell', 'CustomFieldCell']) {
            expect(wrapper.findComponent({ name }).exists(), name).toBe(true);
            expect(wrapper.findComponent({ name }).props('editable'), name).toBe(true);
        }
        expect(wrapper.findComponent({ name: 'ListAssigneeCell' }).props('options')).toEqual(['u1', 'u2']);
        expect(wrapper.findComponent({ name: 'TaskTagCell' }).props('canAdd')).toBe(true);

        wrapper.findComponent({ name: 'ListAssigneeCell' }).vm.$emit('change', { type: 'add', uid: 'u2' });
        wrapper.findComponent({ name: 'ListDueCell' }).vm.$emit('change', '2026-10-01');
        wrapper.findComponent({ name: 'ListPriorityCell' }).vm.$emit('change', { value: 'LOW' });
        wrapper.findComponent({ name: 'EstimateCell' }).vm.$emit('change', 90, '');
        wrapper.findComponent({ name: 'CustomFieldCell' }).vm.$emit('change', 12);
        const target = expect.objectContaining({ _id: 's-a' });
        expect(ctx.setAssignee).toHaveBeenCalledWith(target, { type: 'add', uid: 'u2' }, expect.anything());
        expect(ctx.setDue).toHaveBeenCalledWith(target, '2026-10-01', expect.anything());
        expect(ctx.setPriority).toHaveBeenCalledWith(target, { value: 'LOW' }, expect.anything());
        expect(ctx.setEstimate).toHaveBeenCalledWith(target, 90, expect.anything());
        expect(ctx.setCustomField).toHaveBeenCalledWith(target, FIELD, 12, expect.anything());
    });

    it('without the rights nothing opens, the same as on a task row', () => {
        const wrapper = renderSub({ ctx: edit(NONE) });
        expect(wrapper.findComponent({ name: 'ListStatusCircle' }).props('editable')).toBe(false);
        for (const name of ['ListAssigneeCell', 'ListDueCell', 'ListPriorityCell', 'CustomFieldCell']) {
            expect(wrapper.findComponent({ name }).props('editable'), name).toBe(false);
        }
        expect(wrapper.findComponent({ name: 'EstimateCell' }).exists()).toBe(false);
        expect(wrapper.find('[data-action="rename"]').exists()).toBe(false);
    });

    it('renames in place through the shared rename', async () => {
        const ctx = edit();
        const wrapper = renderSub({ ctx });
        await wrapper.find('[data-action="rename"]').trigger('click');
        const input = wrapper.find('input.lv2__rename');
        expect(input.attributes('aria-label')).toBe(en.List.rename_label);
        await input.setValue('Renamed subtask');
        await input.trigger('keydown', { key: 'Enter' });
        expect(ctx.rename).toHaveBeenCalledWith(expect.objectContaining({ _id: 's-a' }), 'Renamed subtask', expect.anything());
    });

    it('offers the actions a subtask supports and leaves out the ones only a task has', async () => {
        const rowMenu = menu();
        const wrapper = renderSub({ rowMenu });
        const actions = wrapper.findAll('.lv2__actions [data-action]').map((b) => b.attributes('data-action'));
        expect(actions).toEqual(['rename', 'copy-link', 'new-tab', 'menu']);
        await wrapper.find('[data-action="menu"]').trigger('click');
        const items = wrapper.findAll('[role="menu"] [role="menuitem"]').map((i) => i.attributes('data-item'));
        expect(items).toEqual(expect.arrayContaining(['rename', 'copy-link', 'copy-key', 'open', 'move', 'duplicate', 'archive', 'delete']));
        for (const item of ['subtask', 'save-template', 'convert-subtask', 'duplicate-subtasks']) expect(items).not.toContain(item);
        await wrapper.find('[data-item="archive"]').trigger('click');
        expect(rowMenu.archive).toHaveBeenCalledWith(expect.objectContaining({ _id: 's-a' }));
        await wrapper.find('[data-action="menu"]').trigger('click');
        await wrapper.find('[data-item="move"]').trigger('click');
        expect(rowMenu.openSidebar).toHaveBeenCalledWith('move', expect.objectContaining({ _id: 's-a' }));
        expect(rowMenu.startMove).not.toHaveBeenCalled();
    });
});

const selectionStore = (selected = [], tasks = [parent(), loner()]) => createStore({
    modules: {
        taskSelection: { ...taskSelection, state: () => ({ selectedTaskIds: [...selected], lastAnchorId: null, activeView: 'list', activeProjectId: PID }) },
        projectData: {
            namespaced: true,
            state: () => ({ tasks: { [PID]: { sprints: [SPRINT], [SPRINT]: { tasks, found: { statusKey_1: 2 } } } }, searchedTasks: [] }),
            getters: {
                tasks: (s) => s.tasks,
                searchedTasks: (s) => s.searchedTasks
            }
        }
    }
});

describe('the List selects subtask rows on their own', () => {
    const RowStub = defineComponent({
        name: 'ListRow',
        props: { data: Object, isSub: Boolean, canSelect: Boolean, selected: Boolean },
        emits: ['select'],
        setup: (props, { emit }) => () => h('div', {
            class: props.isSub ? 'row-sub' : 'row',
            'data-id': props.data._id,
            'data-can-select': String(props.canSelect),
            'data-selected': String(props.selected),
            onClick: (event) => emit('select', props.data, event)
        }, props.data.TaskName)
    });
    const DraggableStub = defineComponent({
        name: 'DraggableStub',
        props: ['list'],
        setup: (props, { slots }) => () => h('div', props.list.map((element) => slots.item({ element })))
    });
    const statusItem = { key: '0_0_Open', name: 'Open', isExpanded: true, searchKey: 'statusKey', searchValue: 1, indexName: 'groupByStatusIndex' };
    const mountGroup = (store, item = statusItem, groupType = 0) => mount(ListGroup, {
        props: { item, sprint: { id: SPRINT }, project: { _id: PID, taskStatusData: [OPEN, DONE] }, groupType },
        global: {
            plugins: [store],
            provide: { searchedTask: ref(false), showArchived: ref(false), taskCollapsed: ref(false) },
            stubs: { ListRow: RowStub, draggable: DraggableStub, CreateTask: true }
        }
    });
    const selected = (store) => [...store.state.taskSelection.selectedTaskIds].sort();

    it('gives the subtask rows a checkbox and their selected state', async () => {
        const store = selectionStore(['s-b']);
        const wrapper = mountGroup(store);
        await flushPromises();
        const subs = wrapper.findAll('.row-sub');
        expect(subs.map((row) => row.attributes('data-id'))).toEqual(['s-a', 's-b']);
        expect(subs.map((row) => row.attributes('data-can-select'))).toEqual(['true', 'true']);
        expect(subs.map((row) => row.attributes('data-selected'))).toEqual(['false', 'true']);
    });

    it('selecting every subtask of a task leaves the task itself out of the selection', async () => {
        const store = selectionStore();
        const wrapper = mountGroup(store);
        await flushPromises();
        for (const row of wrapper.findAll('.row-sub')) await row.trigger('click');
        expect(selected(store)).toEqual(['s-a', 's-b']);
        await wrapper.findAll('.row-sub')[0].trigger('click');
        expect(selected(store)).toEqual(['s-b']);
    });

    it('selecting a task still takes its loaded subtasks along', async () => {
        const store = selectionStore();
        const wrapper = mountGroup(store);
        await flushPromises();
        await wrapper.find('.row[data-id="t1"]').trigger('click');
        expect(selected(store)).toEqual(['s-a', 's-b', 't1']);
    });

    it('a subtask under a task in a custom-field group is selectable, whatever its own field value', async () => {
        const stage = {
            key: 'cf_cf1_opt-a', name: 'Stage A', isExpanded: true, customFieldId: 'cf1', customFieldType: 'dropdown',
            searchKey: 'customField.cf1', searchValue: 'opt-a', indexName: 'groupByStatusIndex'
        };
        const store = selectionStore([], [parent({ customField: { cf1: { fieldValue: ['opt-a'] } } }), loner()]);
        const wrapper = mountGroup(store, stage, 'cf:cf1');
        await flushPromises();
        expect(wrapper.findAll('.row').map((row) => row.attributes('data-id'))).toEqual(['t1']);
        const subs = wrapper.findAll('.row-sub');
        expect(subs.map((row) => row.attributes('data-can-select'))).toEqual(['true', 'true']);
        await subs[1].trigger('click');
        expect(selected(store)).toEqual(['s-b']);
    });
});

describe('a selected subtask is told apart by its loaded task', () => {
    const state = () => ({
        tasks: { [PID]: { sprints: [SPRINT], [SPRINT]: { tasks: [parent(), loner()] } } },
        searchedTasks: [parent({ _id: 't9', subtaskArray: [sub('s-z', { ParentTaskId: 't9', statusKey: 2 })] })]
    });

    it('the bulk snapshot finds a subtask under its task in the sprint list', () => {
        expect(snapshotTasks(state(), ['s-a', 't2'])).toMatchObject({ 's-a': { statusKey: 1 }, t2: { statusKey: 1 } });
    });

    it('and under a searched task, where a filtered List takes its subtask rows from', () => {
        expect(snapshotTasks(state(), ['s-z'])).toMatchObject({ 's-z': { statusKey: 2, sprintId: SPRINT } });
    });

    it('the bulk bar reads the selected subtasks, and which of them have their task selected too', () => {
        expect(selectionShape(state(), ['s-a', 's-b'])).toEqual({ count: 2, subtasks: 2, looseSubtasks: 2 });
        expect(selectionShape(state(), ['t1', 's-a', 't2'])).toEqual({ count: 3, subtasks: 1, looseSubtasks: 0 });
        expect(selectionShape(state(), ['s-z'])).toEqual({ count: 1, subtasks: 1, looseSubtasks: 1 });
    });
});
