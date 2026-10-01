import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';

const { stub, convertToSubTask, toast } = vi.hoisted(() => ({
    stub: (name) => ({ default: { name, render: () => null } }),
    convertToSubTask: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
}));

vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ status: 200, data: [] })) }));
vi.mock('@/utils/TaskOperations', () => ({ default: { convertToSubTask } }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => ({ id: 'u1', Employee_Name: 'Mira' }) }) }));
vi.mock('@/composable/commonFunction', () => ({ taskPlanPermission: () => ({ checkTaskPerSprintPermisssion: () => Promise.resolve(true) }) }));
vi.mock('vue-router', () => ({ useRoute: () => ({ params: { id: 'proj-1' }, query: {} }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/atom/UserProfile/UserProfile.vue', () => stub('UserProfile'));
vi.mock('@/components/molecules/DropDown/DropDown.vue', () => stub('DropDown'));
vi.mock('@/components/molecules/DropDownOption/DropDownOption.vue', () => stub('DropDownOption'));
vi.mock('@/components/atom/ConfirmationsInTask/ConfirmationsInTask.vue', () => stub('ConfirmationsInTask'));
vi.mock('@/components/atom/SpinnerComp/SpinnerComp.vue', () => stub('SpinnerComp'));

import TaskInSidebar from '@/components/organisms/TaskInSidebar/TaskInSidebar.vue';

const project = { _id: 'proj-1', ProjectName: 'Site', taskStatusData: [{ key: 1, name: 'To Do', textColor: 'inherit' }], taskTypeCounts: [], sprintsObj: { 'sprint-1': { id: 'sprint-1', tasks: 3 } } };
const moved = { _id: 'moved', TaskName: 'Moved', isParentTask: true, ProjectID: 'proj-1', sprintId: 'sprint-1' };
const parent = { _id: 'second', TaskName: 'Second', isParentTask: false, ParentTaskId: 'top', ancestors: ['top'], ProjectID: 'proj-1', sprintId: 'sprint-1', statusKey: 1, AssigneeUserId: [] };

async function convertUnder(candidate) {
    const wrapper = mount(TaskInSidebar, {
        props: { data: candidate, task: moved, taskData: [candidate], selectedProjectData: project, selectedSprintData: { _id: 'sprint-1', id: 'sprint-1', tasks: 3 }, item: {} },
        global: {
            plugins: [createStore({ getters: { 'users/users': () => [], 'projectData/tasks': () => ({}) }, mutations: { 'projectData/mutateSprints': () => {} } })],
            mocks: { $t: (key) => key },
            provide: { selectedProject: ref(project), toggleTaskDetail: vi.fn(), $userId: ref('u1'), $companyId: ref('company-1'), $clientWidth: ref(1280) }
        }
    });
    await wrapper.get('.task__name-sidebar').trigger('click');
    await flushPromises();
    wrapper.vm.taskOperationFun(false);
    await flushPromises();
    wrapper.getComponent({ name: 'ConfirmationsInTask' }).vm.$emit('finalConfirm');
    await flushPromises();
    return wrapper;
}

describe('converting a task to a subtask the server refuses', () => {
    it('says the reason the server gave', async () => {
        const reason = 'Subtasks nest three levels deep at most, and the subtasks of this task would go past the third.';
        convertToSubTask.mockRejectedValue({ status: false, error: { response: { status: 400, data: { status: false, statusText: reason, code: 'SUBTREE_TOO_DEEP' } } } });
        await convertUnder(parent);
        expect(convertToSubTask.mock.calls[0][0]).toMatchObject({ selectedTaskId: 'moved', taskId: 'second' });
        expect(toast.error).toHaveBeenCalledTimes(1);
        expect(toast.error.mock.calls[0][0]).toBe(reason);
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('says something went wrong for any other failure', async () => {
        convertToSubTask.mockRejectedValue({ status: false, error: new Error('Network Error') });
        await convertUnder(parent);
        expect(toast.error.mock.calls[0][0]).toBe('Toast.something_went_wrong');
    });
});
