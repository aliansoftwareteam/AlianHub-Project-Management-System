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

describe('the other parts of the task panel, with no live event coming back', () => {
    const USER = { id: 'u1', Employee_Name: 'Olivia Owner', companyOwnerId: 'u1' };
    const PROJECT = { _id: 'proj-1', CompanyId: 'company-1', ProjectName: 'Website' };

    it('drops a tag that was taken off', async () => {
        const wrapper = await openPanel({ tagsArray: ['tag-1', 'tag-2'] });
        taskClass.updateTags({ ...PLACE, tagsArray: shown(wrapper).tagsArray, tagId: 'tag-1', operation: 'remove' }).catch(() => {});
        await flushPromises();
        expect(shown(wrapper).tagsArray).toEqual(['tag-2']);
        wrapper.unmount();
    });

    it('shows a new start date', async () => {
        const wrapper = await openPanel({ startDate: null });
        taskClass.updateStartDate({ firebaseObj: { startDate: '2026-10-05T00:00:00.000Z' }, project: PROJECT, task: shown(wrapper), obj: {}, userData: USER }).catch(() => {});
        await flushPromises();
        expect(shown(wrapper).startDate).toBe('2026-10-05T00:00:00.000Z');
        wrapper.unmount();
    });

    it('shows a new estimate and new story points', async () => {
        const wrapper = await openPanel({ totalEstimatedTime: 0, storyPoints: 1 });
        taskClass.updateTotalEstimatedTime({ firebaseObj: { totalEstimatedTime: 90 }, projectData: PROJECT, taskData: shown(wrapper), obj: {}, userData: USER }).catch(() => {});
        taskClass.updatePoints({ firebaseObj: { storyPoints: 5 }, projectData: PROJECT, taskData: shown(wrapper), userData: USER }).catch(() => {});
        await flushPromises();
        expect(shown(wrapper)).toMatchObject({ totalEstimatedTime: 90, storyPoints: 5 });
        wrapper.unmount();
    });

    it('shows a new task leader', async () => {
        const wrapper = await openPanel({ Task_Leader: 'u1' });
        taskClass.updateTaskLeader({ firebaseObj: { Task_Leader: 'u2' }, projectData: PROJECT, taskData: shown(wrapper), employeeName: 'Max', userData: USER }).catch(() => {});
        await flushPromises();
        expect(shown(wrapper).Task_Leader).toBe('u2');
        wrapper.unmount();
    });

    it('counts a watcher once when added and not at all when removed', async () => {
        const wrapper = await openPanel({ watchers: ['u2'] });
        const watch = (add) => taskClass.updateWatcher({ ...PLACE, userId: 'u1', add, userData: USER, employeeName: 'Olivia Owner', watchers: shown(wrapper).watchers }).catch(() => {});
        watch(true);
        await flushPromises();
        expect(shown(wrapper).watchers).toEqual(['u2', 'u1']);
        watch(false);
        await flushPromises();
        expect(shown(wrapper).watchers).toEqual(['u2']);
        wrapper.unmount();
    });

    it('keeps a saved description when the tab is left and opened again', async () => {
        const wrapper = await openPanel({ descriptionBlock: { blocks: [] }, rawDescription: '' });
        const blocks = { blocks: [{ type: 'paragraph', data: { text: 'Brief' } }] };
        const saved = taskClass.updateDescription({ companyId: 'company-1', task: shown(wrapper), text: { blocks, text: 'Brief' } });
        await flushPromises();
        expect(shown(wrapper).rawDescription).toBe('');
        http.writes[0].resolve({ data: { status: true } });
        await saved;
        expect(shown(wrapper)).toMatchObject({ descriptionBlock: blocks, rawDescription: 'Brief' });
        wrapper.unmount();
    });

    it('counts a subtask as done in the tab as soon as it is ticked', async () => {
        const sub = { _id: 'sub-1', TaskName: 'Draft', ProjectID: 'proj-1', sprintId: 'sprint-1', ParentTaskId: 'task-1', isParentTask: false, deletedStatusKey: 0, statusKey: 'st-open', statusType: 'open', status: { key: 'st-open', type: 'open' } };
        payload.subtasks = [sub];
        const wrapper = await openPanel();
        const tab = () => wrapper.findAll('[role="tab"]').find((button) => button.text().startsWith(en.TaskPanel.subtasks));
        expect(tab().text()).toContain('0/1');
        taskClass.updateStatus({
            newStatus: { status: { text: 'Done', key: 'st-done', type: 'close', value: 'done' }, statusType: 'close', statusKey: 'st-done' },
            prevStatus: {}, projectData: PROJECT, task: sub, userData: USER
        }).catch(() => {});
        await flushPromises();
        expect(tab().text()).toContain('1/1');
        payload.subtasks = [];
        wrapper.unmount();
    });

    it('reads its relations again when one is added or removed in the tab', async () => {
        const { apiRequest } = await import('@/services');
        const wrapper = await openPanel();
        await wrapper.findAll('[role="tab"]').find((button) => button.text().startsWith(en.TaskPanel.relations_tab)).trigger('click');
        const reads = () => apiRequest.mock.calls.filter(([method, url, body]) => method === 'post' && url === '/api/v2/tasks/relations' && body.action === 'list').length;
        const before = reads();
        wrapper.findComponent({ name: 'LinkedTasks' }).vm.$emit('changed');
        await flushPromises();
        expect(reads()).toBe(before + 1);
        wrapper.unmount();
    });
});

describe('a task panel left open while the tab was out of view', () => {
    it('joins its room again on the connection the tab comes back with', async () => {
        const joins = vi.fn(() => Promise.resolve());
        const connection = () => ({ id: 's', on: vi.fn(), off: vi.fn(), emit: vi.fn() });
        const first = connection();
        const second = connection();
        const socket = ref(first);
        const live = createStore({
            getters: {
                'settings/companyUserDetail': () => ({ roleType: 1 }), 'settings/companyOwnerDetail': () => ({}), 'projectData/gettaskDetailData': () => null,
                'settings/companyUsers': () => [], 'settings/projectRules': () => ({ 'task.task_status': true }), 'settings/selectedCompany': () => ({})
            },
            actions: { 'projectData/getTaskDetailSnapShot': joins },
            mutations: { 'projectData/setTaskDetailData': () => {}, 'projectData/setTaskdetailPayloadId': () => {}, 'projectData/mutateUpdateFirebaseTasks': () => {} }
        });
        payload.tasks = [task()];
        const wrapper = mount(TaskDetailPanel, {
            props: PLACE,
            global: { plugins: [live], mocks: { $t: i18n.global.t }, provide: { $userId: ref('u1'), $clientWidth: ref(1280), $socket: socket } }
        });
        await flushPromises();
        expect(joins).toHaveBeenCalledTimes(1);
        socket.value = second;
        await flushPromises();
        expect(joins).toHaveBeenCalledTimes(2);
        expect(second.on.mock.calls.map(([event]) => event)).toEqual(expect.arrayContaining(['commentInsert', 'taskDetail_agentSession']));
        wrapper.unmount();
    });
});
