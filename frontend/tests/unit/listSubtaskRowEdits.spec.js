/* A subtask row in the List, through the real store, the real task loader action, the real
   useListRowEdit and the real assigneeOptions helpers: who it can be assigned to, and that its
   parent stays open while it is edited. Only the HTTP layer and the task writes are mocked; the
   assignee write is the real one, since it is what shows the change in the store. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { defineComponent, h, provide, ref } from 'vue';
import en from '@/locales/en';

const { ops, http } = vi.hoisted(() => ({
    ops: {
        updateStatus: vi.fn(() => Promise.resolve()),
        updateAssignee: vi.fn(() => Promise.resolve()),
        updatePriority: vi.fn(() => Promise.resolve()),
        updateDueDate: vi.fn(() => Promise.resolve())
    },
    http: { subtasks: [] }
}));

vi.mock('@/utils/TaskOperations', async (importOriginal) => {
    const real = (await importOriginal()).default;
    ops.updateAssignee.mockImplementation((payload) => real.updateAssignee(payload));
    return { default: ops };
});
vi.mock('@/services', () => ({
    apiRequest: vi.fn((method, url, body) => {
        if (method === 'patch') return Promise.resolve({ status: 200, data: { status: true } });
        const match = body?.findQuery?.[0]?.$match || {};
        if (typeof match.ParentTaskId === 'string') {
            return Promise.resolve({ status: 200, data: [{ result: http.subtasks.map((task) => ({ ...task })), count: [{ count: http.subtasks.length }] }] });
        }
        return Promise.resolve({ status: 200, data: [] });
    })
}));
vi.mock('vue-router', () => ({
    useRouter: () => ({ resolve: () => ({ href: '/task' }), hasRoute: () => false, push: vi.fn() }),
    useRoute: () => ({ params: {}, query: {} })
}));
vi.mock('@/views/Projects/ListView/useProjectAgentActivity.js', () => ({
    useProjectAgentActivity: () => ({ runFor: () => null, proposalFor: () => null, load: () => {} })
}));
vi.mock('@/views/Projects/ListView/useListDragDrop.js', () => ({ useListDragDrop: () => ({ applyDrag: vi.fn() }) }));
vi.mock('@/views/Projects/helper.js', async () => {
    const { default: store } = await import('@/store/index');
    return {
        taskListHelper: () => ({
            getSprintTasks: ({ projectId, sprintId, item, fetchNew, parentId }) => store.dispatch('projectData/getPaginatedTasks', {
                pid: projectId, sprintId, item, fetchNew, parentId, showAllTasks: true
            })
        }),
        useUpdateTasks: () => ({ updateTaskByGroup: vi.fn(() => Promise.resolve()) })
    };
});

import Store from '@/store/index';
import ListGroup from '@/views/Projects/ListView/ListGroup.vue';
import { useListRowEdit } from '@/views/Projects/ListView/useListInlineEdit';
import { dismissUndoToast } from '@/composable/useUndoToast';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
config.global.plugins = [i18n];

const PID = 'p1';
const SPRINT = 's1';
const OPEN = { key: 1, name: 'Open', type: 'default_active', value: 'open', bgColor: '#eee', textColor: '#777' };
const DONE = { key: 2, name: 'Complete', type: 'close', value: 'complete', bgColor: '#e2f7e2', textColor: '#2a2' };
const PEOPLE = ['u1', 'u2', 'u3', 'u4'];

const PROJECT = {
    _id: PID, CompanyId: 'c1', ProjectName: 'QA Sandbox', ProjectCode: 'QA', isGlobalPermission: true, isPrivateSpace: false,
    AssigneeUserId: PEOPLE, taskStatusData: [OPEN, DONE], apps: [], sprintsObj: { [SPRINT]: { id: SPRINT, name: 'List', private: false } }
};
const STATUS_GROUP = { key: '0_0_Open', name: 'Open', isExpanded: true, searchKey: 'statusKey', searchValue: 1, indexName: 'groupByStatusIndex' };

const subtask = (id, over = {}) => ({
    _id: id, TaskName: `Subtask ${id}`, TaskKey: `QA-${id}`, ProjectID: PID, sprintId: SPRINT, isParentTask: false, ParentTaskId: 't1',
    statusKey: 1, statusType: 'default_active', AssigneeUserId: [], Task_Priority: '', DueDate: 0, deletedStatusKey: 0, ...over
});
const parentTask = (over = {}) => ({
    _id: 't1', TaskName: 'Parent task', TaskKey: 'QA-1', ProjectID: PID, sprintId: SPRINT, isParentTask: true, statusKey: 1,
    statusType: 'default_active', groupByStatusIndex: 1, AssigneeUserId: [], deletedStatusKey: 0, subTasks: 2, ...over
});

function seedStore(parent) {
    Store.state.settings.companyUserDetail = { userId: 'u1', roleType: 1 };
    Store.state.settings.rules = { task: {} };
    Store.state.settings.companyUsers = PEOPLE.map((userId) => ({ _id: `cu-${userId}`, userId, isDelete: false }));
    Store.state.users.users = PEOPLE.map((id) => ({ _id: id, Employee_Name: `Person ${id}` }));
    Store.state.projectData.searchedTasks = [];
    Store.state.projectData.tasks = {
        [PID]: { projectId: PID, sprints: [SPRINT], [SPRINT]: { index: {}, found: { statusKey_1: 1 }, tasks: [parent], snapshot: null } }
    };
    Store.state.taskSelection.selectedTaskIds = [];
}

const PICKER = 'Assignee';
const AssigneeStub = defineComponent({
    name: PICKER,
    props: { users: Array, options: Array, multiSelect: Boolean },
    emits: ['selected', 'removed'],
    setup: (props, { slots }) => () => h('div', { class: 'assignee-stub' }, slots.trigger ? slots.trigger({ open: () => {} }) : [])
});
const DraggableStub = defineComponent({
    name: 'DraggableStub',
    props: ['list'],
    setup: (props, { slots }) => () => h('div', props.list.map((element) => slots.item({ element })))
});

/* The toolbar's subtask switch starts collapsed, as it does on the project page. */
function mountList({ parent = parentTask(), subtasks = [subtask('s-a'), subtask('s-b')] } = {}) {
    http.subtasks = subtasks;
    seedStore(parent);
    const project = ref(PROJECT);
    const Host = defineComponent({
        setup() {
            provide('selectedProject', project);
            provide('listRowEdit', useListRowEdit(project, ref(false)));
            return () => h('div', { class: 'lv2' }, [h(ListGroup, { item: STATUS_GROUP, sprint: { id: SPRINT }, project: project.value, groupType: 0 })]);
        }
    });
    return mount(Host, {
        global: {
            plugins: [Store],
            provide: {
                searchedTask: ref(false), showArchived: ref(false), taskCollapsed: ref(true),
                $userId: ref('u1'), $companyId: ref('c1'), $dateFormat: ref('DD/MM/YYYY'), $clientWidth: ref(1280)
            },
            stubs: {
                draggable: DraggableStub, Assignee: AssigneeStub, CreateTask: true, ShellIcon: true, ProvenanceBadge: true,
                TaskTagCell: true, ListStatusCircle: true, ListDueCell: true, ListPriorityCell: true, ListRowActions: true,
                EstimateCell: true, TaskColumnCell: true
            }
        }
    });
}

const subRows = (wrapper) => wrapper.findAll('.lv2__row.is-sub');
const subRow = (wrapper, name) => subRows(wrapper).find((row) => row.text().includes(name));
const pickerOf = (row) => row.findComponent(AssigneeStub);
const offered = (row) => [...pickerOf(row).props('options')].sort();

async function expandParent(wrapper) {
    await wrapper.find('.lv2__disclose').trigger('click');
    await flushPromises();
}

const storedParent = () => Store.state.projectData.tasks[PID][SPRINT].tasks.find((task) => task._id === 't1');
const storedSubtask = (id) => storedParent().subtaskArray.find((task) => task._id === id);

beforeEach(() => {
    Object.values(ops).forEach((op) => op.mockClear());
});
afterEach(() => dismissUndoToast());

describe('who a subtask row can be assigned to', () => {
    it('offers the people of the list when its parent has nobody assigned', async () => {
        const wrapper = mountList();
        await expandParent(wrapper);
        expect(offered(subRow(wrapper, 'Subtask s-a'))).toEqual(PEOPLE);
    });

    it('offers the same people as its parent task row in that case', async () => {
        const wrapper = mountList();
        await expandParent(wrapper);
        const parentRow = wrapper.find('.lv2__row:not(.is-sub)');
        expect(offered(subRow(wrapper, 'Subtask s-a'))).toEqual(offered(parentRow));
    });

    it('is narrowed to the people on its parent, the rule the task panel and the Board apply', async () => {
        const wrapper = mountList({ parent: parentTask({ AssigneeUserId: ['u2', 'u3'] }) });
        await expandParent(wrapper);
        expect(offered(subRow(wrapper, 'Subtask s-a'))).toEqual(['u2', 'u3']);
    });

    it('keeps someone already on the subtask in the list, so they can be removed', async () => {
        const wrapper = mountList({
            parent: parentTask({ AssigneeUserId: ['u2'] }),
            subtasks: [subtask('s-a', { AssigneeUserId: ['u4'] }), subtask('s-b')]
        });
        await expandParent(wrapper);
        expect(offered(subRow(wrapper, 'Subtask s-a'))).toEqual(['u2', 'u4']);
    });

    it('still offers people after the subtask is unassigned', async () => {
        const wrapper = mountList({ subtasks: [subtask('s-a', { AssigneeUserId: ['u2'] }), subtask('s-b')] });
        await expandParent(wrapper);

        pickerOf(subRow(wrapper, 'Subtask s-a')).vm.$emit('removed', { id: 'u2' });
        await flushPromises();

        expect(ops.updateAssignee).toHaveBeenCalledWith(expect.objectContaining({ type: 'assigneRemove', taskData: expect.objectContaining({ _id: 's-a' }) }));
        expect(storedSubtask('s-a').AssigneeUserId).toEqual([]);
        const row = subRow(wrapper, 'Subtask s-a');
        expect(pickerOf(row).props('users')).toEqual([]);
        expect(offered(row)).toEqual(PEOPLE);
    });
});

describe('a parent row stays open while its subtasks change', () => {
    it('opens on the first click and shows its subtasks once they have loaded', async () => {
        const wrapper = mountList();
        await expandParent(wrapper);
        expect(wrapper.find('.lv2__disclose').attributes('aria-expanded')).toBe('true');
        expect(subRows(wrapper).map((row) => row.find('.lv2__name').text())).toEqual(['Subtask s-a', 'Subtask s-b']);
    });

    it('stays open after an edit made from a subtask row', async () => {
        const wrapper = mountList({ subtasks: [subtask('s-a', { AssigneeUserId: ['u2'] }), subtask('s-b')] });
        await expandParent(wrapper);

        pickerOf(subRow(wrapper, 'Subtask s-a')).vm.$emit('removed', { id: 'u2' });
        await flushPromises();

        expect(wrapper.find('.lv2__disclose').attributes('aria-expanded')).toBe('true');
        expect(subRows(wrapper)).toHaveLength(2);
    });

    it.each([
        ['status', { statusKey: 2, statusType: 'close', status: { key: 2, text: 'Complete', type: 'close' } }],
        ['priority', { Task_Priority: 'HIGH' }],
        ['due date', { DueDate: new Date('2026-10-09T00:00:00.000Z') }]
    ])('stays open when the store takes a %s change for one of its subtasks', async (label, fields) => {
        const wrapper = mountList();
        await expandParent(wrapper);

        Store.commit('projectData/mutateUpdateFirebaseTasks', {
            snap: null, op: 'modified', pid: PID, sprintId: SPRINT, data: { ...storedSubtask('s-a'), ...fields }, updatedFields: fields
        });
        await flushPromises();

        expect(storedSubtask('s-a')).toMatchObject(fields);
        expect(wrapper.find('.lv2__disclose').attributes('aria-expanded')).toBe('true');
        expect(subRows(wrapper)).toHaveLength(2);
    });

    it('stays open when the store replaces the parent itself', async () => {
        const wrapper = mountList();
        await expandParent(wrapper);
        const before = storedParent();

        Store.commit('projectData/mutateUpdateFirebaseTasks', {
            snap: null, op: 'modified', pid: PID, sprintId: SPRINT, data: { ...before, TaskName: 'Parent task, renamed' }, updatedFields: { TaskName: 'Parent task, renamed' }
        });
        await flushPromises();

        expect(storedParent()).not.toBe(before);
        expect(wrapper.find('.lv2__row:not(.is-sub) .lv2__name').text()).toBe('Parent task, renamed');
        expect(wrapper.find('.lv2__disclose').attributes('aria-expanded')).toBe('true');
        expect(subRows(wrapper)).toHaveLength(2);
    });

    it('still closes when its own disclosure is clicked again', async () => {
        const wrapper = mountList();
        await expandParent(wrapper);
        await wrapper.find('.lv2__disclose').trigger('click');
        expect(wrapper.find('.lv2__disclose').attributes('aria-expanded')).toBe('false');
        expect(subRows(wrapper)).toHaveLength(0);
    });
});
