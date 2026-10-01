/* Task 045.4 — a subtask row in the List edits in place and joins bulk selection like a task row. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createStore } from 'vuex';
import { defineComponent, h, ref } from 'vue';
import en from '@/locales/en';
import taskSelection from '@/store/TaskSelection';

const { apiRequest, toast } = vi.hoisted(() => ({
    apiRequest: vi.fn(() => Promise.resolve({ data: [] })),
    toast: { success: vi.fn(), error: vi.fn() }
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/composable/aiAvailability', () => ({ aiUsable: ref(false), canUseAi: () => false }));
vi.mock('@/views/Projects/TableView/useTaskSummaries.js', () => ({ useTaskSummaries: () => ({ generateMany: vi.fn() }) }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true, debounce: (fn) => fn }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id, Employee_Name: `User ${id}` }) })
}));
vi.mock('@/views/Projects/helper.js', () => ({
    taskListHelper: () => ({ getSprintTasks: vi.fn(() => Promise.resolve()) }),
    useUpdateTasks: () => ({ updateTaskByGroup: vi.fn(() => Promise.resolve()) })
}));
vi.mock('@/views/Projects/ListView/useProjectAgentActivity.js', () => ({
    useProjectAgentActivity: () => ({ runFor: () => null, proposalFor: () => null, load: () => {} })
}));
vi.mock('@/views/Projects/ListView/useListDragDrop.js', () => ({ useListDragDrop: () => ({ applyDrag: vi.fn() }) }));
vi.mock('@/components/atom/CalenderCompo/CalenderCompo.vue', () => ({
    default: { name: 'CalenderCompo', template: '<div class="cal-stub"><slot name="trigger" /></div>' }
}));

import ListRow from '@/views/Projects/ListView/ListRow.vue';
import ListGroup from '@/views/Projects/ListView/ListGroup.vue';
import ListBulkBar from '@/views/Projects/ListView/ListBulkBar.vue';
import { useTaskSelection } from '@/composable/useTaskSelection.js';
import { selectionMix, subtaskIdsIn } from '@/composable/selectionKinds.js';

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
    archive: vi.fn(), remove: vi.fn(), startMove: vi.fn(), duplicate: vi.fn()
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
        expect(items).toEqual(expect.arrayContaining(['rename', 'copy-link', 'copy-key', 'open', 'archive', 'delete']));
        for (const item of ['subtask', 'save-template', 'move', 'duplicate']) expect(items).not.toContain(item);
        await wrapper.find('[data-item="archive"]').trigger('click');
        expect(rowMenu.archive).toHaveBeenCalledWith(expect.objectContaining({ _id: 's-a' }));
    });
});

describe('the selection tells subtasks apart', () => {
    const state = () => ({
        tasks: { [PID]: { sprints: [SPRINT], [SPRINT]: { tasks: [parent(), loner()] } } },
        searchedTasks: [parent({ _id: 't9', subtaskArray: [sub('s-z', { ParentTaskId: 't9' })] })]
    });

    it('finds the selected ids that are subtasks, in the sprint lists and in a search', () => {
        expect(subtaskIdsIn(state(), ['t1', 's-a', 't2', 's-z', 'unknown'])).toEqual(['s-a', 's-z']);
    });

    it('names the mix of a selection', () => {
        expect(selectionMix(0, 0)).toBe('none');
        expect(selectionMix(3, 0)).toBe('tasks');
        expect(selectionMix(2, 2)).toBe('subtasks');
        expect(selectionMix(3, 1)).toBe('mixed');
    });
});

const selectionStore = (selected = []) => createStore({
    modules: {
        taskSelection: { ...taskSelection, state: () => ({ selectedTaskIds: [...selected], lastAnchorId: null, activeView: 'list', activeProjectId: PID }) },
        projectData: {
            namespaced: true,
            state: () => ({ tasks: { [PID]: { sprints: [SPRINT], [SPRINT]: { tasks: [parent(), loner()], found: { statusKey_1: 2 } } } }, searchedTasks: [] }),
            getters: {
                tasks: (s) => s.tasks,
                searchedTasks: (s) => s.searchedTasks
            }
        },
        settings: {
            namespaced: true,
            getters: {
                companyUsers: () => [],
                companyOwnerDetail: () => ({ userId: 'owner' }),
                companyPriority: () => [],
                selectedCompany: () => ({ planFeature: {} }),
                finalCustomFields: () => []
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
    const mountGroup = (store) => mount(ListGroup, {
        props: { item: statusItem, sprint: { id: SPRINT }, project: { _id: PID, taskStatusData: [OPEN, DONE] }, groupType: 0 },
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

    it('useTaskSelection reports which selected ids are subtasks', () => {
        const store = selectionStore(['t2', 's-a']);
        let selection;
        mount(defineComponent({ setup() { selection = useTaskSelection(); return () => null; } }), { global: { plugins: [store] } });
        expect(selection.selectedSubtaskIds.value).toEqual(['s-a']);
        expect(selection.mix.value).toBe('mixed');
    });
});

describe('the bulk bar with subtasks in the selection', () => {
    const project = {
        _id: PID, ProjectCode: 'AH', ProjectName: 'Project', isGlobalPermission: true, apps: [],
        taskStatusData: [OPEN, DONE], sprintsObj: { s1: { id: 's1', name: 'Sprint 1' }, s2: { id: 's2', name: 'Sprint 2' } }, tagsArray: [], AssigneeUserId: []
    };
    const mountBar = (selected) => mount(ListBulkBar, {
        props: { project },
        global: { plugins: [selectionStore(selected)], provide: { $userId: ref('u1') }, stubs: { ConfirmationSidebar: true } }
    });
    const button = (wrapper, label) => wrapper.findAll('.lv2-bulk__btn').find((b) => b.text().startsWith(label));

    beforeEach(() => {
        apiRequest.mockReset();
        apiRequest.mockImplementation(() => Promise.resolve({ data: { status: true, data: { updated: ['s-a', 't2'], totals: { updated: 2 } } } }));
    });

    it('sets the status of a mixed selection in one bulk call over every id', async () => {
        const wrapper = mountBar(['s-a', 't2']);
        await button(wrapper, en.List.status).trigger('click');
        await wrapper.findAll('.lv2-bulk__item').find((item) => item.text() === 'Complete').trigger('click');
        await flushPromises();
        expect(apiRequest.mock.calls[0][2]).toMatchObject({ action: 'bulkUpdateStatus', taskIds: ['s-a', 't2'] });
    });

    it('turns Sprint off when only subtasks are selected, and says why', () => {
        const wrapper = mountBar(['s-a', 's-b']);
        const sprint = button(wrapper, en.List.sprint);
        expect(sprint.attributes('disabled')).toBeDefined();
        expect(sprint.attributes('title')).toBe(en.List.bulk_sprint_subtasks);
        expect(button(wrapper, en.List.status).attributes('disabled')).toBeUndefined();
    });

    it('keeps Sprint for a mixed selection, noting that subtasks go with their task', async () => {
        const wrapper = mountBar(['s-a', 't2']);
        const sprint = button(wrapper, en.List.sprint);
        expect(sprint.attributes('disabled')).toBeUndefined();
        await sprint.trigger('click');
        expect(wrapper.find('.lv2-bulk__menu .lv2-bulk__note').text()).toBe(en.List.bulk_sprint_subtasks);
    });

    it('leaves Sprint alone for a selection of tasks', () => {
        const wrapper = mountBar(['t1', 't2']);
        expect(button(wrapper, en.List.sprint).attributes('title')).toBeUndefined();
    });
});
