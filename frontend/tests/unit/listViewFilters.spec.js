/* Task 037 slice 1: List view narrows on search, "Me" and saved filters exactly as Board
   and Table do, groups by assignee with a task under each of its assignees, and the Add
   View menu headings are translated. */
import { describe, test, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref, defineComponent, h } from 'vue';

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
import { groupLabel, groupRows, listSourceTasks, groupCountsFor, taskInGroup, searchExpandIds } from '@/views/Projects/ListView/listFilter';
import { assigneeGroups, assigneeCondition } from '@/views/Projects/taskGroups';
import en from '@/locales/en';

const PID = 'p1';
const SPRINT = 's1';
const ME = 'user-1';
const OTHER = 'user-2';
const STATUS = { key: 1, name: 'To Do' };

const statusItem = { key: '0_0_To Do', name: 'To Do', isExpanded: true, searchKey: 'statusKey', searchValue: STATUS.key, indexName: 'groupByStatusIndex' };

const task = (n, overrides = {}) => ({
    _id: `t${n}`,
    TaskName: `Task ${n}`,
    sprintId: SPRINT,
    statusKey: STATUS.key,
    groupByStatusIndex: n,
    isParentTask: true,
    AssigneeUserId: [],
    deletedStatusKey: 0,
    ...overrides
});

const ELEVEN = Array.from({ length: 11 }, (_, i) => task(i + 1, { AssigneeUserId: i < 3 ? [ME] : [OTHER] }));

const makeStore = ({ tasks = ELEVEN, searched = [] } = {}) => createStore({
    state: { taskSelection: { selectedTaskIds: [], lastAnchorId: null, activeView: 'list' } },
    getters: {
        'projectData/tasks': () => ({ [PID]: { [SPRINT]: { tasks, found: { [`statusKey_${STATUS.key}`]: tasks.length } } } }),
        'projectData/searchedTasks': () => searched
    }
});

const RowStub = defineComponent({
    name: 'ListRow',
    props: { data: Object, isSub: Boolean },
    setup: (props) => () => h('div', { class: props.isSub ? 'row-sub' : 'row', 'data-id': props.data._id }, props.data.TaskName)
});
const DraggableStub = defineComponent({
    name: 'DraggableStub',
    props: ['list'],
    setup: (props, { slots }) => () => h('div', props.list.map((element) => slots.item({ element })))
});

const mountGroup = ({ searchedTask = false, store = makeStore(), item = statusItem } = {}) => mount(ListGroup, {
    props: { item, sprint: { id: SPRINT }, project: { _id: PID, taskStatusData: [] }, groupType: 0 },
    global: {
        plugins: [store],
        provide: { searchedTask: ref(searchedTask), showArchived: ref(false), taskCollapsed: ref(true) },
        stubs: { ListRow: RowStub, draggable: DraggableStub, CreateTask: true }
    }
});

const rowIds = (wrapper) => wrapper.findAll('.row').map((row) => row.attributes('data-id'));

describe('List renders the searched tasks, like Board and Table', () => {
    test('without a search it lists every task of the group (the audit\'s 11 rows)', () => {
        expect(rowIds(mountGroup())).toHaveLength(11);
    });

    test('a search for one task leaves one row, not eleven', async () => {
        const wrapper = mountGroup({ searchedTask: true, store: makeStore({ searched: [ELEVEN[6]] }) });
        await flushPromises();
        expect(rowIds(wrapper)).toEqual(['t7']);
    });

    test('"Me" shows only the tasks the server returned for me', async () => {
        const mine = ELEVEN.filter((t) => t.AssigneeUserId.includes(ME));
        const wrapper = mountGroup({ searchedTask: true, store: makeStore({ searched: mine }) });
        await flushPromises();
        expect(rowIds(wrapper)).toEqual(['t1', 't2', 't3']);
    });

    test('a saved filter whose result is in another sprint leaves this sprint empty', async () => {
        const wrapper = mountGroup({ searchedTask: true, store: makeStore({ searched: [task(40, { sprintId: 'other-sprint' })] }) });
        await flushPromises();
        expect(rowIds(wrapper)).toEqual([]);
    });

    test('the group count reads the narrowed rows, not the unfiltered server count', async () => {
        const wrapper = mountGroup({ searchedTask: true, store: makeStore({ searched: [ELEVEN[0], ELEVEN[1]] }) });
        await flushPromises();
        expect(wrapper.find('.lv2__group-meta').text()).toBe('2');
    });

    test('a subtask that matched shows under its parent, which opens by itself', async () => {
        const parent = task(5, { subtaskArray: [{ _id: 'sub-1', TaskName: 'Matched subtask', isParentTask: false, sprintId: SPRINT, deletedStatusKey: 0 }] });
        const wrapper = mountGroup({ searchedTask: true, store: makeStore({ searched: [parent] }) });
        await flushPromises();
        expect(rowIds(wrapper)).toEqual(['t5']);
        expect(wrapper.findAll('.row-sub').map((row) => row.attributes('data-id'))).toEqual(['sub-1']);
    });
});

describe('the list filter helpers', () => {
    test('the searched source is scoped to the sprint', () => {
        const searched = [task(1), task(2, { sprintId: 'x' })];
        expect(listSourceTasks({ searched: true, searchedTasks: searched, storeTasks: ELEVEN, sprintId: SPRINT }).map((t) => t._id)).toEqual(['t1']);
        expect(listSourceTasks({ searched: false, searchedTasks: searched, storeTasks: ELEVEN, sprintId: SPRINT })).toHaveLength(11);
    });

    test('group rows drop archived tasks unless the archive is shown, and sort by the group index', () => {
        const rows = groupRows([task(3), task(1), task(2, { deletedStatusKey: 2 })], statusItem, false);
        expect(rows.map((t) => t._id)).toEqual(['t1', 't3']);
        expect(groupRows([task(2, { deletedStatusKey: 2 })], statusItem, true).map((t) => t._id)).toEqual(['t2']);
    });

    test('counts per group come from the rows the list will draw', () => {
        const counts = groupCountsFor([task(1), task(2), task(3, { statusKey: 9 })], [statusItem], false);
        expect(counts[`statusKey_${STATUS.key}`]).toBe(2);
    });

    test('rows with matched subtasks are the ones opened under a search', () => {
        expect(searchExpandIds([task(1, { subtaskArray: [{ _id: 's' }] }), task(2)])).toEqual(['t1']);
    });

    test('a due-date "Today" bucket matches a task due today', () => {
        const start = new Date(2026, 8, 24).getTime() / 1000;
        const today = { searchKey: 'DueDate', operation: 'range', seconds: start, endSeconds: start + 86400, searchValue: start };
        expect(taskInGroup(task(1, { DueDate: new Date(2026, 8, 24, 15).toISOString() }), today)).toBe(true);
        expect(taskInGroup(task(1, { DueDate: new Date(2026, 8, 25, 15).toISOString() }), today)).toBe(false);
        expect(taskInGroup(task(1), { searchKey: 'DueDate', operation: 'non' })).toBe(true);
    });
});

describe('grouping by assignee', () => {
    const getUser = (id) => ({ id, Employee_Name: id === ME ? 'Me Myself' : 'Other Person' });

    test('one group per member, and an unassigned group last', () => {
        const groups = assigneeGroups([OTHER, ME, OTHER], getUser, 'Unassigned');
        expect(groups.map((g) => g.value)).toEqual([OTHER, ME, '']);
        expect(groups[2].name).toBe('Unassigned');
        expect(groups[2].users).toEqual([]);
    });

    test('a task with two assignees appears under each of them', () => {
        const shared = task(1, { AssigneeUserId: [ME, OTHER] });
        const [other, me, none] = assigneeGroups([OTHER, ME], getUser, 'Unassigned').map((g) => ({ ...g, searchKey: 'AssigneeUserId' }));
        expect(taskInGroup(shared, me)).toBe(true);
        expect(taskInGroup(shared, other)).toBe(true);
        expect(taskInGroup(shared, none)).toBe(false);
        expect(taskInGroup(task(2), none)).toBe(true);
    });

    test('the server query fetches a member\'s tasks by membership and unassigned tasks by emptiness', () => {
        expect(assigneeCondition(ME)).toEqual({ AssigneeUserId: { $in: [ME] } });
        expect(assigneeCondition('')).toEqual({ AssigneeUserId: { $in: [null, []] } });
    });

    const TEAM = 'tId_team-1';
    const teams = [{ _id: 'team-1', assigneeUsersArray: [ME] }, { _id: 'team-2', assigneeUsersArray: [] }];

    test('a task assigned only to a team appears under each member of that team', () => {
        const teamTask = task(1, { AssigneeUserId: [TEAM] });
        const [other, me, none] = assigneeGroups([OTHER, ME], getUser, 'Unassigned', teams).map((g) => ({ ...g, searchKey: 'AssigneeUserId' }));
        expect(me.teamIds).toEqual([TEAM]);
        expect(other.teamIds).toEqual([]);
        expect(taskInGroup(teamTask, me)).toBe(true);
        expect(taskInGroup(teamTask, other)).toBe(false);
        expect(taskInGroup(teamTask, none)).toBe(false);
    });

    test('the server query fetches a member\'s team tasks with their own', () => {
        expect(assigneeCondition(ME, [TEAM])).toEqual({ AssigneeUserId: { $in: [ME, TEAM] } });
    });
});

describe('group labels', () => {
    test('an assignee group reads as the person, collapsed or open; other groups keep their name', () => {
        expect(groupLabel({ searchKey: 'AssigneeUserId', name: 'Assignee', users: [{ Employee_Name: 'Olivia Owner' }] })).toBe('Olivia Owner');
        expect(groupLabel({ searchKey: 'AssigneeUserId', name: 'Unassigned', users: [] })).toBe('Unassigned');
        expect(groupLabel({ searchKey: 'statusKey', name: 'To Do' })).toBe('To Do');
    });
});

describe('labels', () => {
    test('the Add View menu headings and the new group option are translated', () => {
        expect(en.Projects.menu_popular).toBeTruthy();
        expect(en.Projects.menu_integrations).toBeTruthy();
        expect(en.Projects.menu_more_views).toBeTruthy();
        expect(en.Projects.assignee).toBeTruthy();
        expect(en.Projects.unassigned).toBeTruthy();
        expect(en.EmptyState.no_match_action).toBeTruthy();
    });
});
