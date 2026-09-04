import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { updateStatus, stub, projectPayload } = vi.hoisted(() => ({
    updateStatus: vi.fn(() => Promise.resolve()),
    stub: (name) => ({ default: { name, render: () => null } }),
    projectPayload: {
    _id: 'proj-1',
    isGlobalPermission: false,
    taskStatusData: [
        { key: 'st-open', name: 'Open', type: 'open', value: 'open', bgColor: '#eee', textColor: '#000' },
        { key: 'st-done', name: 'Done', type: 'close', value: 'done', bgColor: '#cfc', textColor: '#000' }
    ],
    taskTypeCounts: [],
    sprintsObj: [],
    sprintsfolders: [],
    tasks: [{ _id: 'task-1', TaskName: 'Write spec', TaskKey: 'AH-1', statusKey: 'st-open', statusType: 'open', AssigneeUserId: [] }],
    subtasks: []
    }
}));

vi.mock('@/services', () => ({
    apiRequest: vi.fn((method, url) => {
        if (String(url).includes('/taskData')) return Promise.resolve({ status: 200, data: [projectPayload] });
        return Promise.resolve({ status: 200, data: { status: false, data: [] } });
    })
}));
vi.mock('@/utils/TaskOperations', () => ({ default: { updateStatus } }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true, checkApps: () => true }),
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
vi.mock('@/components/atom/TagChip/TagChip.vue', () => stub('TagChip'));
vi.mock('@/components/molecules/TagList/CreateTagPopup.vue', () => stub('CreateTagPopup'));
vi.mock('@/components/organisms/TaskDetailOverlay/TaskSummaryBlock.vue', () => stub('TaskSummaryBlock'));
vi.mock('@/components/organisms/TaskDetailOverlay/TaskSubtaskList.vue', () => stub('TaskSubtaskList'));
vi.mock('@/components/organisms/TaskDetailOverlay/TaskTimerChip.vue', () => stub('TaskTimerChip'));
vi.mock('@/components/organisms/TaskDetailOverlay/TaskAgentStrip.vue', () => stub('TaskAgentStrip'));

import TaskDetailPanel from '@/components/organisms/TaskDetailOverlay/TaskDetailPanel.vue';

function mountPanel() {
    const store = createStore({
        getters: {
            'settings/companyOwnerDetail': () => ({}),
            'projectData/gettaskDetailData': () => null,
            'settings/companyUsers': () => [],
            'settings/projectRules': () => ({ 'task.task_status': true }),
            'settings/selectedCompany': () => ({})
        },
        actions: { 'projectData/getTaskDetailSnapShot': () => Promise.resolve() },
        mutations: { 'projectData/setTaskDetailData': () => {}, 'projectData/setTaskdetailPayloadId': () => {} }
    });
    return mount(TaskDetailPanel, {
        props: { companyId: 'company-1', projectId: 'proj-1', sprintId: 'sprint-1', taskId: 'task-1' },
        global: { plugins: [store] }
    });
}

describe('TaskDetailPanel', () => {
    it('moves the task to the close status when the done checkbox is ticked', async () => {
        const wrapper = mountPanel();
        await flushPromises();
        const done = wrapper.find('input.ah-detail__done');
        expect(done.exists()).toBe(true);
        expect(done.element.disabled).toBe(false);
        await done.setValue(true);
        expect(updateStatus).toHaveBeenCalledTimes(1);
        const call = updateStatus.mock.calls[0][0];
        expect(call.newStatus).toMatchObject({ statusKey: 'st-done', statusType: 'close' });
        expect(call.task._id).toBe('task-1');
    });
});
