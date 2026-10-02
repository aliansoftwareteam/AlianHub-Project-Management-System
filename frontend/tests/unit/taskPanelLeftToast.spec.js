/* A move or a convert takes the task off its list by marking it deleted for a moment. The open
   task panel closes on that event; it must not call it a delete, and the tab that asked for the
   move or the convert shows that action's own result and nothing more. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';

const { stub, payload, toast, http } = vi.hoisted(() => ({
    stub: (name) => ({ default: { name, render: () => null } }),
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
    http: { writes: [] },
    payload: {
        _id: 'proj-1',
        isGlobalPermission: false,
        apps: [],
        taskStatusData: [{ key: 'st-open', name: 'Open', type: 'open', value: 'open' }],
        taskTypeCounts: [],
        sprintsObj: [],
        sprintsfolders: [],
        tasks: [],
        subtasks: []
    }
}));

vi.mock('@/config/publicConfig', () => ({ publicConfig: { agentSessions: false } }));
vi.mock('@/services', () => ({
    apiRequest: vi.fn((method, url, body) => {
        if (method === 'patch') return new Promise((resolve, reject) => http.writes.push({ body, resolve, reject }));
        if (String(url).includes('/taskData')) return Promise.resolve({ status: 200, data: [{ ...payload, sprintsObj: [], sprintsfolders: [] }] });
        if (method === 'post' && url === '/api/v1/task/find') return Promise.resolve({ status: 200, data: [] });
        return Promise.resolve({ status: 200, data: { status: false, data: [] } });
    })
}));
vi.mock('@/store/index', () => ({ default: { state: {}, commit: () => {} } }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true, checkApps: () => false, makeUniqueId: () => 'id' }),
    useGetterFunctions: () => ({ getUser: () => ({}), getPriority: () => ({}) })
}));
vi.mock('@/views/Projects/helper', () => ({ useUpdateTasks: () => ({ updateTaskByGroup: vi.fn() }) }));
vi.mock('vue-router', () => ({
    useRouter: () => ({ push: vi.fn(), resolve: () => ({ href: '#' }) }),
    useRoute: () => ({ params: {}, query: {}, name: 'ProjectSprint' })
}));
vi.mock('@/components/organisms/TaskDetailOverlay/useTaskOverlay', () => ({ openTask: vi.fn(), setTaskMeta: vi.fn() }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => stub('ShellIcon'));
vi.mock('@/components/atom/Skelaton/Skelaton.vue', () => stub('Skelaton'));
vi.mock('@/components/molecules/TaskDetailTitle/TaskDetailTitle.vue', () => stub('TaskDetailTitle'));
vi.mock('@/components/molecules/TaskDetailAction/TaskDetailAction.vue', () => stub('TaskDetailAction'));
vi.mock('@/components/molecules/TaskDetailTab/TaskDetailTab.vue', () => stub('TaskDetailTab'));
vi.mock('@/components/organisms/TaskDetailRightSide/TaskDetailRightSide.vue', () => stub('TaskDetailRightSide'));
vi.mock('@/components/organisms/LinkedTasks/LinkedTasks.vue', () => stub('LinkedTasks'));
vi.mock('@/views/Projects/Comments/Comments.vue', () => stub('Comments'));
vi.mock('@/components/templates/ActivityLog/ActivityLog.vue', () => stub('ActivityLog'));
vi.mock('@/components/molecules/Pages/PagesPanel.vue', () => stub('PagesPanel'));
vi.mock('@/components/molecules/TagList/CreateTagPopup.vue', () => stub('CreateTagPopup'));
vi.mock('@/components/atom/FavouriteStar/FavouriteStar.vue', () => stub('FavouriteStar'));
vi.mock('@/components/organisms/TaskDetailOverlay/TaskSummaryBlock.vue', () => stub('TaskSummaryBlock'));
vi.mock('@/components/organisms/TaskDetailOverlay/TaskActionItems.vue', () => stub('TaskActionItems'));
vi.mock('@/components/organisms/TaskDetailOverlay/TaskAiRow.vue', () => stub('TaskAiRow'));
vi.mock('@/components/organisms/TaskDetailOverlay/TaskTimerChip.vue', () => stub('TaskTimerChip'));
vi.mock('@/components/organisms/TaskDetailOverlay/TaskAgentStrip.vue', () => stub('TaskAgentStrip'));
vi.mock('@/components/organisms/TaskDetailOverlay/TaskTrackerHandoff.vue', () => stub('TaskTrackerHandoff'));
vi.mock('@/components/organisms/TaskDetailOverlay/TaskListsRow.vue', () => stub('TaskListsRow'));

import TaskDetailPanel from '@/components/organisms/TaskDetailOverlay/TaskDetailPanel.vue';
import taskClass from '@/utils/TaskOperations';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);

const PLACE = { companyId: 'company-1', projectId: 'proj-1', sprintId: 'sprint-1', taskId: 'task-1' };
const task = (over = {}) => ({
    _id: 'task-1', TaskName: 'Landing page', TaskKey: 'AH-8', statusKey: 'st-open', statusType: 'open', status: { key: 'st-open', type: 'open', text: 'Open' },
    AssigneeUserId: ['u1'], ProjectID: 'proj-1', sprintId: 'sprint-1', isParentTask: true, checklistArray: [], tagsArray: [], attachments: [], watchers: [],
    sprintArray: { id: 'sprint-1', name: 'Sprint 1' }, ...over
});

const store = () => createStore({
    state: { live: null },
    getters: {
        'settings/companyUserDetail': () => ({ roleType: 1 }),
        'settings/companyOwnerDetail': () => ({}),
        'projectData/gettaskDetailData': (state) => state.live,
        'settings/companyUsers': () => [],
        'settings/projectRules': () => ({ 'task.task_status': true }),
        'settings/selectedCompany': () => ({})
    },
    actions: { 'projectData/getTaskDetailSnapShot': () => Promise.resolve() },
    mutations: {
        live: (state, event) => { state.live = event; },
        'projectData/setTaskDetailData': () => {},
        'projectData/setTaskdetailPayloadId': () => {},
        'projectData/mutateUpdateFirebaseTasks': () => {},
        'projectData/mutateMongoUpdatedTask': () => {},
        'projectData/mutateTypesenseTableTasks': () => {}
    }
});

async function openPanel() {
    payload.tasks = [task()];
    const live = store();
    const wrapper = mount(TaskDetailPanel, {
        props: PLACE,
        global: { plugins: [live], mocks: { $t: i18n.global.t }, provide: { $userId: ref('u1'), $clientWidth: ref(1280) } }
    });
    await flushPromises();
    const hears = async (event) => { live.commit('live', event); await flushPromises(); };
    return { wrapper, hears };
}

const leftItsList = (leftBecause) => ({ fullDocument: task({ deletedStatusKey: 1 }), updatedFields: { deletedStatusKey: 1 }, ...(leftBecause ? { leftBecause } : {}) });
const said = () => toast.info.mock.calls.map(([text]) => text);
const closed = (wrapper) => (wrapper.emitted('close') || []).length;

const ASKED_HERE = [
    ['a move', 'moved', (taskId) => taskClass.moveTask({ companyId: 'company-1', moveTaskId: taskId })],
    ['a convert to a list', 'list', (taskId) => taskClass.convertToList({ companyId: 'company-1', taskId })],
    ['a convert to a subtask', 'subtask', (taskId) => taskClass.convertToSubTask({ companyId: 'company-1', selectedTaskId: taskId, taskId: 'task-9' })],
    ['a subtask made a task', 'task', (taskId) => taskClass.convertToTask({ companyId: 'company-1', taskId })]
];

/* Each test starts an hour after the last, so what one asked for is long over in the next. */
let now = Date.UTC(2026, 9, 2, 9);

beforeEach(() => {
    http.writes = [];
    Object.values(toast).forEach((spy) => spy.mockClear());
    now += 60 * 60 * 1000;
    vi.useFakeTimers({ toFake: ['Date'], now });
});

afterEach(async () => {
    http.writes.forEach((write) => write.resolve({ data: { status: true, data: {} } }));
    await flushPromises();
    vi.useRealTimers();
});

describe('the open task leaves its list because of an action asked for in this tab', () => {
    it.each(ASKED_HERE)('%s closes the panel and is not called a delete', async (name, leftBecause, ask) => {
        const { wrapper, hears } = await openPanel();
        ask('task-1').catch(() => {});
        await hears(leftItsList(leftBecause));

        expect(closed(wrapper)).toBe(1);
        expect(said()).toEqual([]);
        wrapper.unmount();
    });

    it('stays quiet when the event comes just after the answer', async () => {
        const { wrapper, hears } = await openPanel();
        taskClass.moveTask({ companyId: 'company-1', moveTaskId: 'task-1' }).catch(() => {});
        http.writes[0].resolve({ data: { status: true, data: { sprintCount: 1 } } });
        await flushPromises();
        vi.advanceTimersByTime(2000);
        await hears(leftItsList('moved'));

        expect(closed(wrapper)).toBe(1);
        expect(said()).toEqual([]);
        wrapper.unmount();
    });

    it('a move of another task does not hide what happened to this one', async () => {
        const { wrapper, hears } = await openPanel();
        taskClass.moveTask({ companyId: 'company-1', moveTaskId: 'task-2' }).catch(() => {});
        await hears(leftItsList('moved'));

        expect(said()).toEqual(['This task was moved to another list.']);
        wrapper.unmount();
    });
});

describe('the open task leaves its list because of someone else', () => {
    it.each([
        ['moved', 'This task was moved to another list.'],
        ['list', 'This task was turned into a list.'],
        ['subtask', 'This task is now a subtask of another task.'],
        ['task', 'This subtask is now a task of its own.']
    ])('%s: the panel closes and says so once', async (leftBecause, text) => {
        const { wrapper, hears } = await openPanel();
        await hears(leftItsList(leftBecause));

        expect(closed(wrapper)).toBe(1);
        expect(said()).toEqual([text]);
        wrapper.unmount();
    });

    it('a move made here long ago no longer speaks for a new one', async () => {
        const { wrapper, hears } = await openPanel();
        taskClass.moveTask({ companyId: 'company-1', moveTaskId: 'task-1' }).catch(() => {});
        http.writes[0].resolve({ data: { status: true, data: { sprintCount: 1 } } });
        await flushPromises();
        vi.advanceTimersByTime(6000);
        await hears(leftItsList('moved'));

        expect(said()).toEqual(['This task was moved to another list.']);
        wrapper.unmount();
    });
});

describe('the open task is deleted or archived', () => {
    it('a delete still says deleted', async () => {
        const { wrapper, hears } = await openPanel();
        await hears(leftItsList());

        expect(closed(wrapper)).toBe(1);
        expect(said()).toEqual(['Task deleted successfully']);
        wrapper.unmount();
    });

    it('a delete says deleted even while a move of the same task is being asked for', async () => {
        const { wrapper, hears } = await openPanel();
        taskClass.moveTask({ companyId: 'company-1', moveTaskId: 'task-1' }).catch(() => {});
        await hears(leftItsList());

        expect(said()).toEqual(['Task deleted successfully']);
        wrapper.unmount();
    });

    it('an archive says archived', async () => {
        const { wrapper, hears } = await openPanel();
        await hears({ fullDocument: task({ deletedStatusKey: 2 }), updatedFields: { deletedStatusKey: 2 } });

        expect(closed(wrapper)).toBe(1);
        expect(said()).toEqual(['Task archived successfully']);
        wrapper.unmount();
    });
});

describe('what the person who moved or converted the task is told', () => {
    it('is spelt right', () => {
        expect([en.Toast.Task_moved_sucessfully, en.Toast.Converted_sucessfully, en.Toast.Task_converted_sucessfully, en.Toast.Convert_in_to_task_sucessfully])
            .toEqual(['Task moved successfully', 'Converted successfully', 'Task converted successfully', 'Converted to a task successfully']);
    });
});
