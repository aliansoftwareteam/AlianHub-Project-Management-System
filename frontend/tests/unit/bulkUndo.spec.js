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

import { snapshotTasks, undoRequests } from '@/views/Projects/ListView/bulkUndo.js';
import ListBulkBar from '@/views/Projects/ListView/ListBulkBar.vue';

const statuses = [
    { key: 1, name: 'To do', type: 'default_active', bgColor: '#eee', textColor: '#111' },
    { key: 2, name: 'Doing', type: 'active', bgColor: '#ddd', textColor: '#222' },
    { key: 3, name: 'Done', type: 'close', bgColor: '#ccc', textColor: '#333' }
];
const project = {
    _id: 'p1', ProjectCode: 'P1', ProjectName: 'Project', isGlobalPermission: true,
    taskStatusData: statuses,
    sprintsObj: { s1: { id: 's1', name: 'Sprint 1' }, s2: { id: 's2', name: 'Sprint 2' } },
    tagsArray: [{ uid: 'tag1', tagName: 'Urgent' }],
    AssigneeUserId: ['u1', 'u2']
};
const tasks = [
    { _id: 't1', statusKey: 1, AssigneeUserId: ['u1'], tagsArray: [], sprintId: 's1', deletedStatusKey: 0 },
    { _id: 't2', statusKey: 2, AssigneeUserId: ['u2'], tagsArray: ['tag1'], sprintId: 's2', deletedStatusKey: 0 },
    { _id: 't3', statusKey: 3, AssigneeUserId: [], tagsArray: [], sprintId: 's1', deletedStatusKey: 0 }
];
const projectDataState = () => ({ tasks: { p1: { sprints: ['s1'], s1: { tasks } } }, searchedTasks: [] });

describe('snapshotTasks', () => {
    it('records the fields a bulk change can touch for each selected task', () => {
        const before = snapshotTasks(projectDataState(), ['t1', 't2']);
        expect(before.t1).toEqual({ statusKey: 1, AssigneeUserId: ['u1'], tagsArray: [], sprintId: 's1', deletedStatusKey: 0 });
        expect(Object.keys(before)).toEqual(['t1', 't2']);
    });

    it('finds subtasks and table-view tasks', () => {
        const state = {
            tasks: { p1: { sprints: ['s1'], s1: { tasks: [{ _id: 'p', subtaskArray: [{ _id: 'sub', statusKey: 2 }] }] } } },
            tableTasks: { p1: { s9: { tasks: [{ _id: 'tt', statusKey: 3 }] } } }
        };
        const before = snapshotTasks(state, ['sub', 'tt']);
        expect(before.sub.statusKey).toBe(2);
        expect(before.tt.statusKey).toBe(3);
    });
});

describe('undoRequests', () => {
    const before = snapshotTasks(projectDataState(), ['t1', 't2', 't3']);

    it('puts each task back on its own previous status, one request per status', () => {
        const requests = undoRequests({
            action: 'bulkUpdateStatus',
            payload: { newStatus: { statusKey: 3 } },
            before,
            updatedIds: ['t1', 't2', 't3'],
            project
        });
        expect(requests).toEqual([
            { action: 'bulkUpdateStatus', taskIds: ['t1'], newStatus: { status: { key: 1, value: '', text: 'To do', type: 'default_active', bgColor: '#eee', textColor: '#111' }, statusKey: 1, statusType: 'default_active' } },
            { action: 'bulkUpdateStatus', taskIds: ['t2'], newStatus: { status: { key: 2, value: '', text: 'Doing', type: 'active', bgColor: '#ddd', textColor: '#222' }, statusKey: 2, statusType: 'active' } }
        ]);
    });

    it('removes an added assignee only from tasks that did not already have them', () => {
        const requests = undoRequests({
            action: 'bulkUpdateAssignee',
            payload: { type: 'assigneeAdd', employeeId: ['u1'], employeeName: 'User u1' },
            before,
            updatedIds: ['t1', 't2', 't3'],
            project
        });
        expect(requests).toEqual([{ action: 'bulkUpdateAssignee', type: 'assigneRemove', employeeId: ['u1'], employeeName: 'User u1', taskIds: ['t2', 't3'] }]);
    });

    it('removes an added tag only where it was new', () => {
        const requests = undoRequests({ action: 'bulkUpdateTags', payload: { tagId: 'tag1', operation: 'add' }, before, updatedIds: ['t1', 't2'], project });
        expect(requests).toEqual([{ action: 'bulkUpdateTags', tagId: 'tag1', operation: 'remove', taskIds: ['t1'] }]);
    });

    it('moves tasks back to the sprint each came from', () => {
        const requests = undoRequests({ action: 'bulkMove', payload: { sprintObj: { id: 's2' } }, before, updatedIds: ['t1', 't2', 't3'], project });
        expect(requests).toEqual([{
            action: 'bulkMove',
            taskIds: ['t1', 't3'],
            sprintObj: project.sprintsObj.s1,
            projectData: { id: 'p1', ProjectCode: 'P1', ProjectName: 'Project' }
        }]);
    });

    it('restores archived and deleted tasks, because both are soft', () => {
        for (const action of ['bulkArchive', 'bulkTrash']) {
            expect(undoRequests({ action, payload: {}, before, updatedIds: ['t1', 't2'], project }))
                .toEqual([{ action: 'bulkRestore', taskIds: ['t1', 't2'] }]);
        }
    });

    it('offers no undo for tasks it has no snapshot of, or for an unknown action', () => {
        expect(undoRequests({ action: 'bulkUpdateStatus', payload: { newStatus: { statusKey: 3 } }, before: {}, updatedIds: ['t1'], project })).toEqual([]);
        expect(undoRequests({ action: 'bulkDelete', payload: {}, before, updatedIds: ['t1'], project })).toEqual([]);
    });
});

describe('ListBulkBar undo', () => {
    let store;
    const mountBar = () => {
        store = createStore({
            modules: {
                taskSelection: { ...taskSelection, state: () => ({ selectedTaskIds: ['t1', 't2'], lastAnchorId: null, activeView: 'list', activeProjectId: 'p1' }) },
                projectData: { namespaced: true, state: projectDataState },
                settings: { namespaced: true, getters: { companyUsers: () => [], companyOwnerDetail: () => ({ userId: 'owner' }) } }
            }
        });
        return mount(ListBulkBar, {
            props: { project },
            global: { plugins: [store], stubs: { ConfirmationSidebar: { template: '<div class="confirm-stub"></div>', emits: ['confirm'] } } }
        });
    };
    const ok = (updated) => Promise.resolve({ data: { status: true, data: { updated, totals: { updated: updated.length } } } });

    beforeEach(() => {
        apiRequest.mockReset();
        toast.success.mockReset();
        toast.error.mockReset();
    });

    it('shows "Updated n tasks." with Undo, and Undo restores each previous status', async () => {
        apiRequest.mockImplementation(() => ok(['t1', 't2']));
        const wrapper = mountBar();
        await wrapper.findAll('.lv2-bulk__btn')[0].trigger('click');
        const done = wrapper.findAll('.lv2-bulk__item').find((item) => item.text() === 'Done');
        await done.trigger('click');
        await flushPromises();

        expect(apiRequest).toHaveBeenCalledTimes(1);
        expect(store.state.taskSelection.selectedTaskIds).toEqual([]);
        const bar = wrapper.find('.lv2-undo');
        expect(bar.exists()).toBe(true);
        expect(bar.attributes('role')).toBe('status');
        expect(bar.text()).toContain('List.bulk_done');

        await bar.find('button').trigger('click');
        await flushPromises();
        const undoCalls = apiRequest.mock.calls.slice(1).map(([, , body]) => ({ action: body.action, taskIds: body.taskIds, statusKey: body.newStatus.statusKey }));
        expect(undoCalls).toEqual([
            { action: 'bulkUpdateStatus', taskIds: ['t1'], statusKey: 1 },
            { action: 'bulkUpdateStatus', taskIds: ['t2'], statusKey: 2 }
        ]);
        expect(wrapper.find('.lv2-undo').exists()).toBe(false);
        expect(toast.success).toHaveBeenCalledWith('List.bulk_undone');
    });

    it('reports a failed undo', async () => {
        apiRequest.mockImplementationOnce(() => ok(['t1', 't2']))
            .mockImplementationOnce(() => Promise.resolve({ data: { status: false, statusText: 'nope' } }));
        const wrapper = mountBar();
        await wrapper.findAll('.lv2-bulk__btn')[0].trigger('click');
        await wrapper.findAll('.lv2-bulk__item').find((item) => item.text() === 'Done').trigger('click');
        await flushPromises();
        await wrapper.find('.lv2-undo button').trigger('click');
        await flushPromises();
        expect(toast.error).toHaveBeenCalledWith('List.bulk_undo_failed');
    });
});
