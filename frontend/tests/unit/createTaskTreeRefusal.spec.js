import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';

const { stub, create, toast } = vi.hoisted(() => ({
    stub: (name) => ({ default: { name, render: () => null } }),
    create: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
}));

vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true, checkApps: () => false }),
    useGetterFunctions: () => ({ getUser: () => ({ id: 'u1', Employee_Name: 'Mira' }) })
}));
vi.mock('@/composable/commonFunction', () => ({ taskPlanPermission: () => ({ checkTaskPerSprintPermisssion: () => Promise.resolve(true) }) }));
vi.mock('@/composable/Validation', () => ({ useValidation: () => ({ checkErrors: vi.fn(), checkAllFields: vi.fn(() => Promise.resolve(true)) }) }));
vi.mock('@/utils/TaskOperations', () => ({ default: { create } }));
vi.mock('@/components/molecules/DueDateCompo/DueDateCompo.vue', () => stub('DueDateCompo'));
vi.mock('@/components/molecules/Assignee/Assignee.vue', () => stub('Assignee'));
vi.mock('@/components/molecules/PriorityCompo/PriorityComp.vue', () => stub('PriorityComp'));
vi.mock('@/components/atom/TaskType/TaskType.vue', () => stub('TaskType'));

import CreateTask from '@/components/atom/CreateTask/CreateTask.vue';

const refused = (code, statusText) => ({ status: false, error: { response: { status: code === 'PARENT_NOT_FOUND' ? 404 : 400, data: { status: false, statusText, code } } } });
const project = {
    _id: 'proj-1', CompanyId: 'company-1', ProjectName: 'Site', ProjectCode: 'SITE', lastTaskId: 3, isGlobalPermission: true,
    taskTypeCounts: [{ key: 1, value: 'task', name: 'Task' }],
    taskStatusData: [{ key: 1, name: 'To Do', value: 'to_do', type: 'default_active' }],
    sprintsObj: { 'sprint-1': { id: 'sprint-1', name: 'Sprint 1', tasks: 2 } }
};

function mountRow() {
    return mount(CreateTask, {
        props: { sprint: { id: 'sprint-1', name: 'Sprint 1' }, taskId: 'parent-1', considerWidth: false },
        global: {
            plugins: [createStore({ getters: { 'settings/companyOwnerDetail': () => ({ userId: 'owner-1' }) }, mutations: { 'projectData/mutateSprints': () => {} } })],
            mocks: { $t: (key) => key, $route: { query: {} } },
            provide: { selectedProject: ref(project), $userId: ref('u1'), $companyId: ref('company-1'), $clientWidth: ref(1280) }
        },
        attachTo: document.body
    });
}

async function typeAndSave(wrapper, name) {
    const input = wrapper.get('input.create__task-inputtext');
    await input.setValue(name);
    await wrapper.get('button.save__btn-primary').trigger('click');
    await flushPromises();
    return input;
}

describe('creating a subtask the server refuses', () => {
    beforeEach(() => create.mockReset());

    it('says the reason the server gave for a parent on the third level and keeps the name', async () => {
        const reason = 'Subtasks nest three levels deep at most, and that parent is already on the third.';
        create.mockRejectedValue(refused('PARENT_AT_MAX_DEPTH', reason));
        const wrapper = mountRow();
        const input = await typeAndSave(wrapper, 'Check the copy');
        expect(create.mock.calls[0][0].data).toMatchObject({ TaskName: 'Check the copy', ParentTaskId: 'parent-1' });
        expect(create.mock.calls[0][0].data).not.toHaveProperty('ancestors');
        expect(toast.error).toHaveBeenCalledTimes(1);
        expect(toast.error.mock.calls[0][0]).toBe(reason);
        expect(input.element.value).toBe('Check the copy');
        wrapper.unmount();
    });

    it('does the same when the parent is gone', async () => {
        create.mockRejectedValue(refused('PARENT_NOT_FOUND', 'The parent task was not found.'));
        const wrapper = mountRow();
        const input = await typeAndSave(wrapper, 'Check the copy');
        expect(toast.error.mock.calls[0][0]).toBe('The parent task was not found.');
        expect(input.element.value).toBe('Check the copy');
        wrapper.unmount();
    });

    it('does not put the name back over one typed while the request was out', async () => {
        let reject;
        create.mockReturnValue(new Promise((_, no) => { reject = no; }));
        const wrapper = mountRow();
        const input = await typeAndSave(wrapper, 'Check the copy');
        await input.setValue('Next one');
        reject(refused('PARENT_AT_MAX_DEPTH', 'Too deep.'));
        await flushPromises();
        expect(input.element.value).toBe('Next one');
        expect(toast.error.mock.calls[0][0]).toBe('Too deep.');
        wrapper.unmount();
    });

    it('still clears the row after a subtask is created', async () => {
        create.mockResolvedValue({ status: true, id: 'new-1' });
        const wrapper = mountRow();
        const input = await typeAndSave(wrapper, 'Check the copy');
        expect(toast.success).toHaveBeenCalledTimes(1);
        expect(toast.error).not.toHaveBeenCalled();
        expect(input.element.value).toBe('');
        expect(wrapper.emitted('submit')).toHaveLength(1);
        wrapper.unmount();
    });
});
