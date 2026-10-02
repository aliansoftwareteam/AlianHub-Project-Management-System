import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { h, ref } from 'vue';

const { stub, perms, payload, progress, toast } = vi.hoisted(() => ({
    stub: (name) => ({ default: { name, render: () => null } }),
    perms: {},
    progress: { rows: [] },
    toast: { success: () => {}, error: () => {}, info: () => {}, warning: () => {} },
    payload: {
        _id: 'proj-1',
        isGlobalPermission: false,
        apps: [{ key: 'TimeTracking' }],
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
    apiRequest: vi.fn((method, url, body) => {
        if (String(url).includes('/taskData')) return Promise.resolve({ status: 200, data: [{ ...payload, sprintsObj: [], sprintsfolders: [] }] });
        if (method === 'post' && url === '/api/v1/task/find' && body?.findQuery?.[1]?.$group?._id === '$ParentTaskId') return Promise.resolve({ status: 200, data: progress.rows });
        if (method === 'post' && url === '/api/v1/task/find') return Promise.resolve({ status: 200, data: [] });
        return Promise.resolve({ status: 200, data: { status: false, data: [] } });
    })
}));
vi.mock('@/utils/TaskOperations', () => ({ default: { updateStatus: vi.fn(() => Promise.resolve()) } }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
/* checkApps here knows a project only when it is handed one, as the real one does inside the panel that provides it. */
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({
        checkPermission: (key) => (key in perms ? perms[key] : true),
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
vi.mock('@/components/molecules/TaskDetailTab/TaskDetailTab.vue', () => ({
    default: { name: 'TaskDetailTab', setup: (_, { slots }) => () => (slots['after-description'] ? slots['after-description']() : null) }
}));
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
vi.mock('@/components/atom/CreateTask/CreateTask.vue', () => ({
    default: { name: 'CreateTask', props: ['taskId', 'sprint'], emits: ['submit', 'cancel'], render: () => h('div', { class: 'create-task-stub' }) }
}));

import TaskDetailPanel from '@/components/organisms/TaskDetailOverlay/TaskDetailPanel.vue';
import TaskSubtaskList from '@/components/organisms/TaskDetailOverlay/TaskSubtaskList.vue';
import { openTask } from '@/components/organisms/TaskDetailOverlay/useTaskOverlay';
import { apiRequest } from '@/services';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);
const t = i18n.global.t;

const base = { _id: 'task-1', TaskName: 'Landing page', TaskKey: 'AH-8', statusKey: 'st-open', statusType: 'open', AssigneeUserId: [], ProjectID: 'proj-1', sprintId: 'sprint-1', sprintArray: { id: 'sprint-1', name: 'Sprint 1' } };
const levelOne = { ...base, isParentTask: true };
const levelTwo = { ...base, isParentTask: false, ParentTaskId: 'root-1', ancestors: ['root-1'] };
const levelThree = { ...base, isParentTask: false, ParentTaskId: 'parent-1', ancestors: ['root-1', 'parent-1'] };
const child = (id, extra = {}) => ({ _id: id, TaskName: `Child ${id}`, TaskKey: id.toUpperCase(), statusKey: 'st-open', statusType: 'open', AssigneeUserId: [], ProjectID: 'proj-1', sprintId: 'sprint-1', isParentTask: false, ParentTaskId: 'task-1', ...extra });

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
    mutations: { 'projectData/setTaskDetailData': () => {}, 'projectData/setTaskdetailPayloadId': () => {} }
});

async function openSubtasksTab(task, subtasks = []) {
    payload.tasks = [task];
    payload.subtasks = subtasks;
    const wrapper = mount(TaskDetailPanel, {
        props: { companyId: 'company-1', projectId: 'proj-1', sprintId: 'sprint-1', taskId: 'task-1' },
        global: { plugins: [store()], mocks: { $t: t }, provide: { $userId: ref('u1'), $clientWidth: ref(1280) } }
    });
    await flushPromises();
    const tab = wrapper.findAll('[role="tab"]').find((item) => item.text().startsWith('Subtasks'));
    if (tab) {
        await tab.trigger('click');
        await flushPromises();
    }
    return { wrapper, tab };
}

const progressReads = () => apiRequest.mock.calls.filter(([, url, body]) => url === '/api/v1/task/find' && body?.findQuery?.[1]?.$group?._id === '$ParentTaskId' && body.findQuery[0].$match.ParentTaskId.$in);

describe('the subtasks of a task in the panel', () => {
    beforeEach(() => {
        for (const key of Object.keys(perms)) delete perms[key];
        progress.rows = [];
        payload.apps = [{ key: 'TimeTracking' }];
    });

    it('lists the direct children of a second-level subtask, each with its own count', async () => {
        progress.rows = [{ _id: 'sub-a', total: 5, completed: 2 }];
        const { wrapper } = await openSubtasksTab(levelTwo, [child('sub-a', { subTasks: 5 }), child('sub-b', { subTasks: 0 })]);
        const rows = wrapper.findAll('.ah-subtasks__row');
        expect(rows.map((row) => row.get('.ah-subtasks__name').text())).toEqual(['Child sub-a', 'Child sub-b']);
        expect(rows[0].get('.ah-subtasks__count').text()).toBe('2/5');
        expect(rows[0].get('.ah-subtasks__count').attributes('aria-label')).toBe(t('TaskPanel.subtask_children', { done: 2, total: 5 }));
        expect(rows[1].find('.ah-subtasks__count').exists()).toBe(false);
        const reads = progressReads();
        expect(reads).toHaveLength(1);
        expect(reads[0][2].findQuery[0].$match.ParentTaskId.$in).toEqual(['sub-a']);
    });

    it('asks for no counts when no child has subtasks', async () => {
        await openSubtasksTab(levelOne, [child('sub-a'), child('sub-b', { subTasks: 0 })]);
        expect(progressReads()).toHaveLength(0);
    });

    it('opens a child in the panel', async () => {
        const { wrapper } = await openSubtasksTab(levelTwo, [child('sub-a', { subTasks: 5 })]);
        await wrapper.get('.ah-subtasks__name').trigger('click');
        expect(openTask).toHaveBeenLastCalledWith(expect.objectContaining({ taskId: 'sub-a', projectId: 'proj-1', sprintId: 'sprint-1' }));
    });

    it('adds a subtask under a task and under a subtask, and reads the children again', async () => {
        for (const task of [levelOne, levelTwo]) {
            const { wrapper } = await openSubtasksTab(task);
            await wrapper.get('.ah-subtasks__add').trigger('click');
            const create = wrapper.getComponent({ name: 'CreateTask' });
            expect(create.props('taskId')).toBe('task-1');
            const before = apiRequest.mock.calls.filter(([, url]) => String(url).includes('/taskData')).length;
            create.vm.$emit('submit', { data: { _id: 'new-1' } });
            await flushPromises();
            expect(apiRequest.mock.calls.filter(([, url]) => String(url).includes('/taskData')).length).toBe(before + 1);
        }
    });

    it('has no subtasks tab on the third level', async () => {
        const { tab, wrapper } = await openSubtasksTab(levelThree);
        expect(tab).toBeUndefined();
        expect(wrapper.find('.ah-subtasks').exists()).toBe(false);
    });

    it('offers no add in the list itself on the third level', () => {
        const wrapper = mount(TaskSubtaskList, {
            props: { task: levelThree, project: payload, subtasks: [] },
            global: { plugins: [store()], mocks: { $t: t }, provide: { $userId: ref('u1') } }
        });
        expect(wrapper.find('.ah-subtasks__add').exists()).toBe(false);
        expect(wrapper.text()).toContain(en.TaskPanel.subtask_depth_limit);
    });

    it('keeps add away from a member who may not create subtasks', async () => {
        perms['task.sub_task_create'] = false;
        const { wrapper } = await openSubtasksTab(levelTwo, [child('sub-a')]);
        expect(wrapper.find('.ah-subtasks__add').exists()).toBe(false);
        expect(wrapper.findAll('.ah-subtasks__row')).toHaveLength(1);
    });

    it('shows the time section only for the project it hands to the app check', async () => {
        const on = await openSubtasksTab(levelTwo);
        expect(on.wrapper.find('.ah-time').exists()).toBe(true);
        payload.apps = [];
        const off = await openSubtasksTab(levelTwo);
        expect(off.wrapper.find('.ah-time').exists()).toBe(false);
    });
});

describe('the Lists row in the panel', () => {
    it('is handed the open task with its project, and its own change reaches the task and the list rows', async () => {
        payload.tasks = [levelOne];
        payload.subtasks = [];
        const committed = vi.fn();
        const withRows = createStore({
            getters: {
                'settings/companyUserDetail': () => ({ roleType: 1 }),
                'settings/companyOwnerDetail': () => ({}),
                'projectData/gettaskDetailData': () => null,
                'settings/companyUsers': () => [],
                'settings/projectRules': () => ({}),
                'settings/selectedCompany': () => ({})
            },
            actions: { 'projectData/getTaskDetailSnapShot': () => Promise.resolve() },
            mutations: {
                'projectData/setTaskDetailData': () => {},
                'projectData/setTaskdetailPayloadId': () => {},
                'projectData/mutateUpdateFirebaseTasks': (_, change) => committed(change),
                'projectData/mutateMongoUpdatedTask': () => {},
                'projectData/mutateTypesenseTableTasks': () => {}
            }
        });
        const wrapper = mount(TaskDetailPanel, {
            props: { companyId: 'company-1', projectId: 'proj-1', sprintId: 'sprint-1', taskId: 'task-1' },
            global: { plugins: [withRows], mocks: { $t: t }, provide: { $userId: ref('u1'), $clientWidth: ref(1280) } }
        });
        await flushPromises();

        const row = wrapper.findComponent({ name: 'TaskListsRow' });
        expect([row.props('task')._id, row.props('project')._id, row.props('homeName')]).toEqual(['task-1', 'proj-1', 'Sprint 1']);

        const entry = { projectId: 'proj-1', sprintId: 'sprint-2', addedBy: 'u1', addedAt: '2026-10-01T00:00:00.000Z' };
        row.vm.$emit('changed', [entry]);
        await flushPromises();

        expect(row.props('task').extraLists).toEqual([entry]);
        expect(committed).toHaveBeenCalledWith(expect.objectContaining({ pid: 'proj-1', sprintId: 'sprint-1', updatedFields: { extraLists: [entry] } }));
    });
});
