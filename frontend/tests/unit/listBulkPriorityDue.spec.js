import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';
import taskSelection from '@/store/TaskSelection';

const { apiRequest, toast } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn() }
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/composable/aiAvailability', () => ({ aiUsable: ref(false) }));
vi.mock('@/views/Projects/TableView/useTaskSummaries.js', () => ({ useTaskSummaries: () => ({ generateMany: vi.fn() }) }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id, Employee_Name: `User ${id}` }) })
}));
vi.mock('@/components/atom/CalenderCompo/CalenderCompo.vue', () => ({
    default: {
        name: 'CalenderCompo',
        props: ['modelValue'],
        emits: ['update:modelValue'],
        template: '<div class="cal-stub"><slot name="trigger" /></div>'
    }
}));

import { snapshotTasks, undoRequests } from '@/views/Projects/ListView/bulkUndo.js';
import ListBulkBar from '@/views/Projects/ListView/ListBulkBar.vue';

const priorities = [
    { value: 'HIGH', name: 'High' },
    { value: 'MEDIUM', name: 'Medium' },
    { value: 'LOW', name: 'Low' }
];
const project = {
    _id: 'p1', ProjectCode: 'P1', ProjectName: 'Project', isGlobalPermission: true,
    apps: [{ key: 'Priority' }],
    taskStatusData: [{ key: 1, name: 'To do', type: 'default_active' }],
    sprintsObj: { s1: { id: 's1', name: 'Sprint 1' } },
    tagsArray: [],
    AssigneeUserId: []
};
const OCT_1 = '2026-10-01T00:00:00.000Z';
const OCT_5 = '2026-10-05T00:00:00.000Z';
const tasks = [
    { _id: 't1', statusKey: 1, sprintId: 's1', Task_Priority: 'HIGH', DueDate: OCT_1 },
    { _id: 't2', statusKey: 1, sprintId: 's1', Task_Priority: 'LOW', DueDate: null },
    { _id: 't3', statusKey: 1, sprintId: 's1', DueDate: OCT_5 }
];
const projectDataState = () => ({ tasks: { p1: { sprints: ['s1'], s1: { tasks } } }, searchedTasks: [] });

describe('undoRequests for priority and due date', () => {
    const before = snapshotTasks(projectDataState(), ['t1', 't2', 't3']);

    it('puts each task back on its own previous priority, "none" included', () => {
        const requests = undoRequests({
            action: 'bulkUpdatePriority',
            payload: { firebaseObj: { Task_Priority: 'HIGH' }, priorityObj: { priorityName: 'High', newPriorityName: 'High' } },
            before,
            updatedIds: ['t1', 't2', 't3'],
            project,
            priorities
        });
        expect(requests).toEqual([
            { action: 'bulkUpdatePriority', taskIds: ['t2'], firebaseObj: { Task_Priority: 'LOW' }, priorityObj: { priorityName: 'Low', newPriorityName: 'Low' } },
            { action: 'bulkUpdatePriority', taskIds: ['t3'], firebaseObj: { Task_Priority: '' }, priorityObj: { priorityName: 'N/A', newPriorityName: 'N/A' } }
        ]);
    });

    it('puts each task back on its own previous due date, clearing where there was none', () => {
        const requests = undoRequests({
            action: 'bulkUpdateDueDate',
            payload: { DueDate: new Date(OCT_1) },
            before,
            updatedIds: ['t1', 't2', 't3'],
            project
        });
        expect(requests).toEqual([
            { action: 'bulkUpdateDueDate', taskIds: ['t2'], DueDate: null },
            { action: 'bulkUpdateDueDate', taskIds: ['t3'], DueDate: OCT_5 }
        ]);
    });

    it('gives a cleared due date back only to the tasks that had one', () => {
        const requests = undoRequests({ action: 'bulkUpdateDueDate', payload: { DueDate: null }, before, updatedIds: ['t1', 't2', 't3'], project });
        expect(requests).toEqual([
            { action: 'bulkUpdateDueDate', taskIds: ['t1'], DueDate: OCT_1 },
            { action: 'bulkUpdateDueDate', taskIds: ['t3'], DueDate: OCT_5 }
        ]);
    });
});

describe('ListBulkBar priority and due date', () => {
    let store;
    const mountBar = ({ apps = project.apps } = {}) => {
        store = createStore({
            modules: {
                taskSelection: { ...taskSelection, state: () => ({ selectedTaskIds: ['t1', 't2', 't3'], lastAnchorId: null, activeView: 'list', activeProjectId: 'p1' }) },
                projectData: { namespaced: true, state: projectDataState },
                settings: {
                    namespaced: true,
                    getters: {
                        companyUsers: () => [],
                        companyOwnerDetail: () => ({ userId: 'owner' }),
                        companyPriority: () => priorities,
                        selectedCompany: () => ({ planFeature: { projectProjectApp: true } })
                    }
                }
            }
        });
        return mount(ListBulkBar, {
            props: { project: { ...project, apps } },
            global: { plugins: [store], stubs: { ConfirmationSidebar: true } }
        });
    };
    const ok = (updated) => Promise.resolve({ data: { status: true, data: { updated, totals: { updated: updated.length } } } });
    const menuButton = (wrapper, key) => wrapper.findAll('.lv2-bulk__btn').find((button) => button.text().startsWith(key));
    const bodies = () => apiRequest.mock.calls.map(([, , body]) => body);

    beforeEach(() => {
        apiRequest.mockReset();
        apiRequest.mockImplementation(() => ok(['t1', 't2', 't3']));
        toast.success.mockReset();
        toast.error.mockReset();
    });

    it('offers Priority and Due date next to the other bulk actions', () => {
        const wrapper = mountBar();
        expect(menuButton(wrapper, 'List.priority')?.exists()).toBe(true);
        expect(menuButton(wrapper, 'List.due_date')?.exists()).toBe(true);
    });

    it('hides Priority when the Priority app is off for the project', () => {
        const wrapper = mountBar({ apps: [] });
        expect(menuButton(wrapper, 'List.priority')).toBeUndefined();
        expect(menuButton(wrapper, 'List.due_date')?.exists()).toBe(true);
    });

    it('sets the picked priority on every selected task, and Undo restores each previous one', async () => {
        const wrapper = mountBar();
        await menuButton(wrapper, 'List.priority').trigger('click');
        await wrapper.findAll('.lv2-bulk__item').find((item) => item.text() === 'High').trigger('click');
        await flushPromises();

        expect(bodies()[0]).toMatchObject({ action: 'bulkUpdatePriority', taskIds: ['t1', 't2', 't3'], firebaseObj: { Task_Priority: 'HIGH' } });

        await wrapper.find('.lv2-undo button').trigger('click');
        await flushPromises();
        expect(bodies().slice(1).map((body) => ({ action: body.action, taskIds: body.taskIds, priority: body.firebaseObj.Task_Priority }))).toEqual([
            { action: 'bulkUpdatePriority', taskIds: ['t2'], priority: 'LOW' },
            { action: 'bulkUpdatePriority', taskIds: ['t3'], priority: '' }
        ]);
        expect(toast.success).toHaveBeenCalledWith('List.bulk_undone');
    });

    it('sets the picked due date on every selected task, and Undo restores each previous one', async () => {
        const wrapper = mountBar();
        await menuButton(wrapper, 'List.due_date').trigger('click');
        const picked = new Date(OCT_1);
        wrapper.findComponent({ name: 'CalenderCompo' }).vm.$emit('update:modelValue', picked);
        await flushPromises();

        expect(bodies()[0]).toMatchObject({ action: 'bulkUpdateDueDate', taskIds: ['t1', 't2', 't3'], DueDate: picked });

        await wrapper.find('.lv2-undo button').trigger('click');
        await flushPromises();
        expect(bodies().slice(1).map((body) => ({ action: body.action, taskIds: body.taskIds, DueDate: body.DueDate }))).toEqual([
            { action: 'bulkUpdateDueDate', taskIds: ['t2'], DueDate: null },
            { action: 'bulkUpdateDueDate', taskIds: ['t3'], DueDate: OCT_5 }
        ]);
    });

    it('clears the due date on every selected task, and Undo gives each its date back', async () => {
        const wrapper = mountBar();
        await menuButton(wrapper, 'List.due_date').trigger('click');
        await wrapper.findAll('.lv2-bulk__item').find((item) => item.text() === 'List.bulk_due_clear').trigger('click');
        await flushPromises();

        expect(bodies()[0]).toMatchObject({ action: 'bulkUpdateDueDate', taskIds: ['t1', 't2', 't3'], DueDate: null });

        await wrapper.find('.lv2-undo button').trigger('click');
        await flushPromises();
        expect(bodies().slice(1).map((body) => ({ taskIds: body.taskIds, DueDate: body.DueDate }))).toEqual([
            { taskIds: ['t1'], DueDate: OCT_1 },
            { taskIds: ['t3'], DueDate: OCT_5 }
        ]);
    });
});
