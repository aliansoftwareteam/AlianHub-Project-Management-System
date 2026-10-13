/* Task 046 — the task panel shows its own copy of the task. It follows an edit at once, wherever in
   the tab the edit was made, and returns to the old value when the server refuses it. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';

const { stub, shows, payload, toast, http } = vi.hoisted(() => ({
    stub: (name) => ({ default: { name, render: () => null } }),
    shows: (name, props) => ({ default: { name, props, emits: ['update:taskName'], render: () => null } }),
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
    http: { writes: [] },
    payload: {
        _id: 'proj-1',
        isGlobalPermission: false,
        apps: [],
        taskStatusData: [
            { key: 'st-open', name: 'Open', type: 'open', value: 'open' },
            { key: 'st-done', name: 'Done', type: 'close', value: 'done' }
        ],
        taskTypeCounts: [],
        sprintsObj: [],
        sprintsfolders: [],
        tasks: [],
        subtasks: []
    }
}));

vi.mock('@/config/publicConfig', () => ({ publicConfig: { agentSessions: false } }));
vi.mock('@/services', () => ({
    apiRequest: vi.fn((method, url) => {
        if (method === 'patch') return new Promise((resolve, reject) => http.writes.push({ resolve, reject }));
        if (String(url).includes('/taskData')) return Promise.resolve({ status: 200, data: [{ ...payload, sprintsObj: [], sprintsfolders: [] }] });
        if (method === 'post' && url === '/api/v1/task/find') return Promise.resolve({ status: 200, data: [] });
        return Promise.resolve({ status: 200, data: { status: false, data: [] } });
    })
}));
vi.mock('@/store/index', () => ({ default: { state: {}, commit: () => {} } }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({
        checkPermission: () => true,
        checkApps: (app, project) => Boolean(project?.apps?.some((x) => x.key === app)),
        makeUniqueId: () => 'id'
    }),
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
vi.mock('@/components/molecules/TaskDetailTitle/TaskDetailTitle.vue', () => shows('TaskDetailTitle', ['taskName', 'taskType']));
vi.mock('@/components/molecules/TaskDetailAction/TaskDetailAction.vue', () => stub('TaskDetailAction'));
vi.mock('@/components/molecules/TaskDetailTab/TaskDetailTab.vue', () => stub('TaskDetailTab'));
vi.mock('@/components/organisms/TaskDetailRightSide/TaskDetailRightSide.vue', () => shows('TaskDetailRightSide', ['task']));
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

const TOAST = { position: 'top-right' };
const PROJECT = { _id: 'proj-1', CompanyId: 'company-1', ProjectName: 'Website' };
const USER = { id: 'u1', Employee_Name: 'Olivia Owner', companyOwnerId: 'u1' };
const task = (over = {}) => ({
    _id: 'task-1', TaskName: 'Landing page', TaskKey: 'AH-8', statusKey: 'st-open', statusType: 'open', status: { key: 'st-open', type: 'open', text: 'Open' },
    Task_Priority: 'LOW', AssigneeUserId: ['u1'], DueDate: null, dueDateDeadLine: [], ProjectID: 'proj-1', sprintId: 'sprint-1', isParentTask: true,
    sprintArray: { id: 'sprint-1', name: 'Sprint 1' }, ...over
});

const store = () => createStore({
    getters: {
        'settings/companyUserDetail': () => ({ roleType: 1 }),
        'settings/companyOwnerDetail': () => ({}),
        'projectData/gettaskDetailData': () => null,
        'settings/companyUsers': () => [],
        'settings/projectRules': () => ({ 'task.task_status': true }),
        'settings/selectedCompany': () => ({})
    },
    actions: { 'projectData/getTaskDetailSnapShot': () => Promise.resolve() },
    mutations: {
        'projectData/setTaskDetailData': () => {},
        'projectData/setTaskdetailPayloadId': () => {},
        'projectData/mutateUpdateFirebaseTasks': () => {},
        'projectData/mutateMongoUpdatedTask': () => {},
        'projectData/mutateTypesenseTableTasks': () => {}
    }
});

async function openPanel({ width = 1280 } = {}) {
    payload.tasks = [task()];
    const wrapper = mount(TaskDetailPanel, {
        props: { companyId: 'company-1', projectId: 'proj-1', sprintId: 'sprint-1', taskId: 'task-1' },
        global: { plugins: [store()], mocks: { $t: i18n.global.t }, provide: { $userId: ref('u1'), $clientWidth: ref(width) } }
    });
    await flushPromises();
    return wrapper;
}

const shown = (wrapper) => wrapper.findComponent({ name: 'TaskDetailRightSide' }).props('task');
const title = (wrapper) => wrapper.findComponent({ name: 'TaskDetailTitle' });
const refuse = (statusText = '') => http.writes[0].reject({ response: { status: 400, data: { status: false, statusText } } });
const setPriority = (target, value) => taskClass.updatePriority({
    firebaseObj: { Task_Priority: value }, projectData: PROJECT, taskData: target, priorityObj: { taskId: target._id }, userData: USER, announce: true
});

beforeEach(() => {
    http.writes = [];
});

afterEach(async () => {
    http.writes.forEach((write) => write.resolve({ data: { status: true } }));
    await flushPromises();
});

describe('the task panel while an edit is on its way to the server', () => {
    it('shows a new title before the server answers', async () => {
        const wrapper = await openPanel();
        title(wrapper).vm.$emit('update:taskName', 'Landing page v2');
        await flushPromises();
        expect(http.writes).toHaveLength(1);
        expect(title(wrapper).props('taskName')).toBe('Landing page v2');
        wrapper.unmount();
    });

    it('returns to the old title and says why when the server refuses it', async () => {
        const wrapper = await openPanel();
        title(wrapper).vm.$emit('update:taskName', 'Landing page v2');
        await flushPromises();
        refuse('You do not have permission to rename this task.');
        await flushPromises();
        expect(title(wrapper).props('taskName')).toBe('Landing page');
        expect(toast.error).toHaveBeenCalledTimes(1);
        expect(toast.error).toHaveBeenCalledWith('You do not have permission to rename this task.', TOAST);
        expect(toast.success).not.toHaveBeenCalled();
        wrapper.unmount();
    });

    it('marks the task done at once and reopens it, with one message, when that fails', async () => {
        const wrapper = await openPanel({ width: 390 });
        await wrapper.get('.ah-detail__complete').trigger('click');
        expect(http.writes).toHaveLength(1);
        expect(wrapper.get('.ah-detail__complete').attributes('aria-pressed')).toBe('true');
        refuse();
        await flushPromises();
        expect(wrapper.get('.ah-detail__complete').attributes('aria-pressed')).toBe('false');
        expect(toast.error).toHaveBeenCalledTimes(1);
        expect(toast.error).toHaveBeenCalledWith(en.Toast.Status_not_updated, TOAST);
        wrapper.unmount();
    });

    it('follows an edit of its task made from the properties or from a row behind it', async () => {
        const wrapper = await openPanel();
        setPriority(shown(wrapper), 'HIGH').catch(() => {});
        await flushPromises();
        expect(shown(wrapper).Task_Priority).toBe('HIGH');
        refuse();
        await flushPromises();
        expect(shown(wrapper).Task_Priority).toBe('LOW');
        wrapper.unmount();
    });

    it('leaves its task alone when another task is edited, and stops listening once closed', async () => {
        const wrapper = await openPanel();
        setPriority(task({ _id: 'task-2' }), 'HIGH').catch(() => {});
        await flushPromises();
        expect(shown(wrapper).Task_Priority).toBe('LOW');
        const before = shown(wrapper);
        wrapper.unmount();
        setPriority(task(), 'HIGH').catch(() => {});
        expect(before.Task_Priority).toBe('LOW');
    });
});
