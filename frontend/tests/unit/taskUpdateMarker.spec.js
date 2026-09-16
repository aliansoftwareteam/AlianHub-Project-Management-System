import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref } from 'vue';

const h = vi.hoisted(() => ({
    SESSION: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOiJ1c2VyLTEifQ.c2Vzc2lvbg',
    LOGIN_COPY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOiJ1c2VyLTEiLCJvbGQiOjF9.bG9naW4',
    apiRequest: vi.fn(),
    commit: vi.fn(),
    getters: {}
}));

vi.mock('js-cookie', () => ({
    default: { get: (key) => (key === 'accessToken' ? h.SESSION : undefined), set: () => {}, remove: () => {} }
}));
vi.mock('vuex', async (importOriginal) => ({
    ...(await importOriginal()),
    useStore: () => ({ commit: h.commit, dispatch: () => Promise.resolve(), getters: h.getters, state: {} })
}));
vi.mock('@/store/index', () => ({ default: { commit: h.commit, dispatch: () => Promise.resolve(), getters: h.getters, state: {} } }));
vi.mock('@/services', () => ({ apiRequest: h.apiRequest }));
vi.mock('@/views/Projects/helper', () => ({
    useUpdateTasks: () => ({ updateTaskByGroup: () => Promise.resolve(true) }),
    taskListHelper: () => ({ getSprintTasks: () => Promise.resolve() })
}));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true, checkApps: () => true })
}));
vi.mock('@/composable/useTaskSelection.js', () => ({
    useTaskSelection: () => ({ setActiveView: () => {}, setActiveProject: () => {}, count: { value: 0 }, groupState: () => 'none', toggleGroup: () => {} })
}));
vi.mock('@/views/Projects/Kanban/useProjectAgents', () => ({
    useProjectAgents: () => ({ start: () => {}, runFor: () => null, proposalFor: () => null })
}));
vi.mock('@/utils/TaskOperations', () => ({ default: {} }));
vi.mock('@/plugins/customFieldView/helper.js', () => ({ customField: () => ({ isCustomFields: () => false }) }));

import { useListDragDrop } from '@/views/Projects/ListView/useListDragDrop';
import KanbanBoard from '@/views/Projects/Kanban/KanbanBoard.vue';
import ItemList from '@/components/organisms/ItemList/ItemList.vue';
import { mutateUpdateFirebaseTasks } from '@/store/ProjectData/mutations';

const TAB_ID = /^tab-[0-9a-f]{32}$/;
const PROJECT = 'p1';
const SPRINT = 's1';

// groupType: 0 status, 1 assignee, 2 priority, 3 due date
const GROUPS = [
    { groupType: 0, indexName: 'groupByStatusIndex', searchKey: 'statusKey', searchValue: 2, value: 2, key: 2, name: 'Done', type: 'close' },
    { groupType: 1, indexName: 'groupByAssigneeIndex', searchKey: 'AssigneeUserId', searchValue: 'u1', value: 'u1', key: 'u1', name: 'u1' },
    { groupType: 2, indexName: 'groupByPriorityIndex', searchKey: 'Task_Priority', searchValue: 'HIGH', value: 'HIGH', key: 'HIGH', name: 'High' },
    { groupType: 3, indexName: 'groupByDueDateIndex', searchKey: 'DueDate', searchValue: 1767225600, value: 'TODAY', key: 'TODAY', name: 'Today', operation: 'non' }
];

const row = (id, index) => ({
    _id: id, TaskKey: `AH-${id}`, TaskName: `Task ${id}`, ProjectID: PROJECT, CompanyId: 'c1', sprintId: SPRINT,
    isParentTask: true, statusKey: 2, Task_Priority: 'HIGH', AssigneeUserId: ['u1'], DueDate: null,
    groupByStatusIndex: index, groupByAssigneeIndex: index, groupByPriorityIndex: index, groupByDueDateIndex: index
});

const sentMarkers = () => h.apiRequest.mock.calls.map(([, , body]) => body?.updateData?.updateToken).filter(Boolean);

const expectTabMarker = (marker) => {
    expect(marker.user).toMatch(TAB_ID);
    expect(marker.user).not.toBe(h.SESSION);
    expect(marker.user).not.toBe(h.LOGIN_COPY);
    expect(typeof marker.timeStamp).toBe('number');
};

const dragWithList = async (group) => {
    const rows = [row('t1', 0), row('t2', 65536)];
    useListDragDrop().applyDrag({ event: { moved: { element: rows[0], newIndex: 0 } }, item: group, groupType: group.groupType, rows, project: { _id: PROJECT } });
    await flushPromises();
};

const dragOnKanban = async (group) => {
    const column = { ...group, sprintId: SPRINT, tasksArray: [row('t1', 0), row('t2', 65536)] };
    const wrapper = mount(KanbanBoard, {
        props: { data: [column], group: group.groupType, sprintId: SPRINT },
        global: {
            provide: { selectedProject: ref({ _id: PROJECT }), showArchived: ref(false), $companyId: ref('c1'), $clientWidth: ref(1280) },
            stubs: { Draggable: true, BoardViewTaskCreateVue: true, BoardViewDisplayCardComponent: true }
        }
    });
    wrapper.findComponent({ name: 'draggable' }).vm.$emit('change', { moved: { element: column.tasksArray[0], newIndex: 0 } });
    await flushPromises();
    wrapper.unmount();
};

const dragInList = async (group) => {
    h.getters['projectData/tasks'] = { [PROJECT]: { [SPRINT]: { tasks: [row('t1', 0), row('t2', 65536)], found: {}, index: {} } } };
    h.getters['settings/finalCustomFields'] = [];
    const item = { operation: 'eq', ...group, _id: 'g1', isExpanded: true, users: [] };
    const wrapper = mount(ItemList, {
        props: { item, groupType: group.groupType, sprintId: SPRINT, projectId: PROJECT, project: { _id: PROJECT }, sprintObject: { id: SPRINT } },
        global: {
            provide: {
                selectedProject: ref({ _id: PROJECT, viewColumn: [], taskFields: {} }), showArchived: ref(false), searchedTask: '',
                taskCollapsed: ref(false), $companyId: ref('c1'), $userId: ref('u1'), $clientWidth: ref(1280)
            },
            stubs: { draggable: true, CustomFieldsSidebarComponent: true, Task: true, Toggle: true, CreateTask: true, Assignee: true, DropDown: true, WasabiImage: true, DropDownOption: true, Skelaton: true }
        }
    });
    await flushPromises();
    const list = wrapper.findAllComponents({ name: 'draggable' }).find((d) => String(d.attributes('id') || '').startsWith('subtasklist_driver'));
    list.vm.$emit('change', { moved: { element: row('t1', 0), newIndex: 0 } });
    await flushPromises();
    wrapper.unmount();
};

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    localStorage.setItem('updateToken', h.LOGIN_COPY);
    h.apiRequest.mockReset();
    h.apiRequest.mockResolvedValue({ data: { status: true } });
    h.commit.mockReset();
    Object.keys(h.getters).forEach((key) => { delete h.getters[key]; });
});

afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
});

describe('drag writers mark their update with the per-tab id, never a credential', () => {
    it.each(GROUPS)('list view drag (groupType $groupType)', async (group) => {
        await dragWithList(group);
        expect(sentMarkers()).toHaveLength(1);
        expectTabMarker(sentMarkers()[0]);
    });

    it.each(GROUPS)('kanban drag (groupType $groupType)', async (group) => {
        await dragOnKanban(group);
        expect(sentMarkers()).toHaveLength(1);
        expectTabMarker(sentMarkers()[0]);
    });

    it.each(GROUPS)('legacy list drag (groupType $groupType)', async (group) => {
        await dragInList(group);
        expect(sentMarkers()).toHaveLength(1);
        expectTabMarker(sentMarkers()[0]);
    });

    it('all three writers send the same id for the life of the tab', async () => {
        for (const group of GROUPS) {
            await dragWithList(group);
            await dragOnKanban(group);
            await dragInList(group);
        }
        expect(new Set(sentMarkers().map((marker) => marker.user)).size).toBe(1);
    });
});

describe('the realtime echo check', () => {
    const boardWith = (task) => ({ tasks: { [PROJECT]: { groupBy: null, sprints: [SPRINT], [SPRINT]: { tasks: [task], found: {} } } } });

    const ownMarker = async () => {
        await dragWithList(GROUPS[2]);
        return sentMarkers()[0];
    };

    const echo = (state, marker) => {
        const data = { ...row('t1', 20), TaskName: 'Server copy', islocalSnapStop: true, updateToken: marker };
        mutateUpdateFirebaseTasks(state, { pid: PROJECT, sprintId: SPRINT, op: 'modified', data, updatedFields: { groupByPriorityIndex: 20, updateToken: marker } });
        return state.tasks[PROJECT][SPRINT].tasks[0];
    };

    it("takes only the new index from this tab's own update", async () => {
        const marker = await ownMarker();
        expect(marker.user).toMatch(TAB_ID);
        const state = boardWith({ ...row('t1', 10), TaskName: 'Local copy', updateTimeStamp: marker.timeStamp });

        const task = echo(state, marker);

        expect(task.groupByPriorityIndex).toBe(20);
        expect(task.TaskName).toBe('Local copy');
    });

    it("applies another tab's update in full", async () => {
        const own = await ownMarker();
        const other = { user: `tab-${'f'.repeat(32)}`, timeStamp: own.timeStamp };
        const state = boardWith({ ...row('t1', 10), TaskName: 'Local copy', updateTimeStamp: own.timeStamp });

        const task = echo(state, other);

        expect(task.groupByPriorityIndex).toBe(20);
        expect(task.TaskName).toBe('Server copy');
    });
});
