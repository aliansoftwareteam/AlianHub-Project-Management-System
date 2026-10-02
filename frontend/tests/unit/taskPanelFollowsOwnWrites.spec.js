/* Task 047, tenth sweep — the task panel shows its own copy of the task. A write made in the panel
   shows there at once, whether or not a live event comes back for it, and returns when the server
   refuses it. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';

const { stub, shows, payload, toast, http } = vi.hoisted(() => ({
    stub: (name) => ({ default: { name, render: () => null } }),
    shows: (name, props) => ({ default: { name, props, render: () => null } }),
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
vi.mock('@/components/molecules/TaskDetailTitle/TaskDetailTitle.vue', () => stub('TaskDetailTitle'));
vi.mock('@/components/molecules/TaskDetailAction/TaskDetailAction.vue', () => stub('TaskDetailAction'));
vi.mock('@/components/molecules/TaskDetailTab/TaskDetailTab.vue', () => shows('TaskDetailTab', ['task']));
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
const FIRST = { id: 'c1', name: 'Checklist', AssigneeUserId: [], isChecked: false, isExpand: false };
const SECOND = { id: 'c2', name: 'Checklist', AssigneeUserId: [], isChecked: false, isExpand: false };
const task = (over = {}) => ({
    _id: 'task-1', TaskName: 'Landing page', TaskKey: 'AH-8', statusKey: 'st-open', statusType: 'open', status: { key: 'st-open', type: 'open', text: 'Open' },
    AssigneeUserId: ['u1'], ProjectID: 'proj-1', sprintId: 'sprint-1', isParentTask: true, checklistArray: [], tagsArray: [], attachments: [], watchers: [],
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

async function openPanel(stored = {}) {
    payload.tasks = [task(stored)];
    const wrapper = mount(TaskDetailPanel, {
        props: PLACE,
        global: { plugins: [store()], mocks: { $t: i18n.global.t }, provide: { $userId: ref('u1'), $clientWidth: ref(1280) } }
    });
    await flushPromises();
    return wrapper;
}

const shown = (wrapper) => wrapper.findComponent({ name: 'TaskDetailTab' }).props('task');
const refuse = (statusText = '') => http.writes[0].reject({ response: { status: 400, data: { status: false, statusText } } });
const writeChecklist = (wrapper, ops, data, localUpdateArray) => taskClass.updateChecklistsv2({
    ...PLACE, ops, data, localUpdateArray, historyObj: {}, taskData: shown(wrapper)
});

beforeEach(() => {
    http.writes = [];
});

afterEach(async () => {
    http.writes.forEach((write) => write.resolve({ data: { status: true } }));
    await flushPromises();
});

describe('a checklist written in the task panel, with no live event coming back', () => {
    it('shows a new checklist before the server answers', async () => {
        const wrapper = await openPanel();
        writeChecklist(wrapper, 'taskchecklistcreate', FIRST, [FIRST]).catch(() => {});
        await flushPromises();
        expect(http.writes).toHaveLength(1);
        expect(shown(wrapper).checklistArray).toEqual([FIRST]);
        wrapper.unmount();
    });

    it('keeps it after the server has answered', async () => {
        const wrapper = await openPanel();
        const saved = writeChecklist(wrapper, 'taskchecklistcreate', FIRST, [FIRST]);
        await flushPromises();
        http.writes[0].resolve({ data: { status: true } });
        await expect(saved).resolves.toMatchObject({ status: true });
        expect(shown(wrapper).checklistArray).toEqual([FIRST]);
        wrapper.unmount();
    });

    it('drops a deleted checklist at once', async () => {
        const wrapper = await openPanel({ checklistArray: [FIRST, SECOND] });
        writeChecklist(wrapper, 'checklistremove', ['c1'], [SECOND]).catch(() => {});
        await flushPromises();
        expect(http.writes[0].body).toMatchObject({ action: 'updateChecklists', operation: 'checklistremove', data: ['c1'] });
        expect(shown(wrapper).checklistArray).toEqual([SECOND]);
        wrapper.unmount();
    });

    it('takes the new checklist away again and says so when the server refuses it', async () => {
        const wrapper = await openPanel({ checklistArray: [FIRST] });
        const saved = writeChecklist(wrapper, 'taskchecklistcreate', SECOND, [FIRST, SECOND]);
        await flushPromises();
        expect(shown(wrapper).checklistArray).toEqual([FIRST, SECOND]);
        refuse('You do not have permission to change this checklist.');
        await expect(saved).rejects.toMatchObject({ status: false });
        expect(shown(wrapper).checklistArray).toEqual([FIRST]);
        expect(toast.error).toHaveBeenCalledWith('You do not have permission to change this checklist.', { position: 'top-right' });
        wrapper.unmount();
    });
});
