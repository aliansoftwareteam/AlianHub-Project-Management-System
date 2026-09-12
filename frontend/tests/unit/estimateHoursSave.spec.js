import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequest, toast, EstimateHourTableStub } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
    EstimateHourTableStub: { name: 'EstimateHourTable', emits: ['update:updatedETA'], template: '<div />' }
}));

vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vuex', () => ({
    createStore: () => ({ getters: {}, dispatch: vi.fn(), commit: vi.fn() }),
    useStore: () => ({
        getters: {
            'settings/selectedCompany': { planFeature: { timeEstimateProjectApp: true } },
            'settings/companyUserDetail': { roleType: 1, userId: 'user-1' },
            'projectData/projects': { data: [{ _id: 'project-1', ProjectName: 'Apollo' }] }
        }
    })
}));
vi.mock('@/composable', () => ({
    useConvertDate: () => ({ convertDateFormat: (value) => String(value) }),
    useMoment: () => ({ changeDateFormate: (value) => String(value) }),
    useCustomComposable: () => ({ checkPermission: () => true, addZero: (value) => String(value).padStart(2, '0'), sanitizeInput: (value) => value }),
    useGetterFunctions: () => ({
        getUser: (id) => ({ _id: id, Employee_Name: 'Ada', companyOwnerId: 'owner-1' })
    })
}));

vi.mock('@/components/molecules/EstimateHourTable/EstimateHourTable.vue', () => ({ default: EstimateHourTableStub }));

import EstimateHours from '@/components/molecules/EstimateHours/EstimateHours.vue';

const task = {
    _id: 'task-1',
    ProjectID: 'project-1',
    TaskName: 'Ship the planner',
    AssigneeUserId: ['user-1'],
    DueDate: '2026-09-30',
    sprintId: 'sprint-1',
    totalEstimatedTime: 600
};

const estimate = { UserId: 'user-1', minutes: 90, timeStamp: '2026-09-15T00:00:00.000Z', id: null };

const openPlanner = async () => {
    const wrapper = mount(EstimateHours, {
        props: { task, permission: 2 },
        global: {
            stubs: {
                Sidebar: { template: '<div><slot name="head-right" /><slot name="body" /></div>' },
                Spinner: true,
                InputText: true,
                DueDateCompo: true,
                UpgradePlan: true
            }
        }
    });
    await flushPromises();
    wrapper.findComponent(EstimateHourTableStub).vm.$emit('update:updatedETA', [estimate]);
    await flushPromises();
    return wrapper;
};

const save = async (wrapper) => {
    await wrapper.find('button.btn-primary').trigger('click');
    await flushPromises();
};

describe('EstimateHours save', () => {
    beforeEach(() => {
        apiRequest.mockReset();
        toast.success.mockReset();
        toast.error.mockReset();
    });

    it('reports a failure instead of success when a plan save is rejected', async () => {
        apiRequest.mockImplementation((method) => (method === 'put'
            ? Promise.reject(new Error('save failed'))
            : Promise.resolve({ data: [] })));

        const wrapper = await openPlanner();
        await save(wrapper);

        expect(apiRequest).toHaveBeenCalledWith('put', expect.any(String), expect.objectContaining({
            userId: 'user-1',
            taskId: 'task-1',
            projectId: 'project-1',
            minutes: 90
        }));
        expect(toast.error).toHaveBeenCalledWith('Toast.Estimated_time_not_updated', { position: 'top-right' });
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('reports success once every plan save settles', async () => {
        apiRequest.mockImplementation((method) => (method === 'put'
            ? Promise.resolve({ data: { _id: 'eta-1', Date: estimate.timeStamp, UserId: 'user-1', EstimatedTime: 90 } })
            : Promise.resolve({ data: [] })));

        const wrapper = await openPlanner();
        await save(wrapper);

        expect(toast.success).toHaveBeenCalledWith('Toast.Estimated_time_updated_successfully', { position: 'top-right' });
        expect(toast.error).not.toHaveBeenCalled();
    });
});
