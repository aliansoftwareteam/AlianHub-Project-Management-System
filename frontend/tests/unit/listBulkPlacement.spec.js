import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import taskSelection from '@/store/TaskSelection';
import en from '@/locales/en';

const { apiRequest, toast, denied } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
    denied: new Set()
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/composable/aiAvailability', () => ({ aiUsable: ref(false), canUseAi: () => false }));
vi.mock('@/views/Projects/TableView/useTaskSummaries.js', () => ({ useTaskSummaries: () => ({ generateMany: vi.fn() }) }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: (key) => !denied.has(key) }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id, Employee_Name: `User ${id}` }) })
}));
vi.mock('@/components/molecules/ConvertToSubTaskSidebar/ConvertToSubTaskSidebar.vue', () => ({
    __esModule: true,
    default: {
        name: 'ConvertToSubTaskSidebar',
        props: ['closeSideBar', 'isMoveTask', 'isBulkMove', 'isOpenSubTask', 'isBulkConvert', 'task', 'projectOptions'],
        emits: ['isConvertSubtaskOPen', 'bulkMoveConfirm', 'bulkConvertConfirm'],
        template: '<div class="placement-stub"></div>'
    }
}));

import { moveTargets, convertTargets, parentTargets, placementActions, selectionShape, bulkReport } from '@/views/Projects/ListView/bulkPlacement.js';
import { snapshotTasks, undoRequests } from '@/views/Projects/ListView/bulkUndo.js';
import ListBulkBar from '@/views/Projects/ListView/ListBulkBar.vue';

const SRC = path.resolve(__dirname, '../../src');
const ready = { taskStatusData: [{ key: 1, name: 'To do', type: 'default_active' }], taskTypeCounts: [{ key: 1, name: 'Task', value: 'Task' }] };
const project = {
    _id: 'p1', ProjectCode: 'P1', ProjectName: 'Current', isGlobalPermission: true, statusType: 'active', ...ready,
    apps: [{ key: 'MultipleAssignees' }],
    sprintsObj: { s1: { id: 's1', name: 'Sprint 1' } },
    tagsArray: [{ uid: 'tag1', tagName: 'Bug' }],
    AssigneeUserId: ['u1', 'u2']
};
const other = { _id: 'p2', ProjectCode: 'P2', ProjectName: 'Other', isGlobalPermission: true, statusType: 'active', ...ready };
const closed = { _id: 'p3', ProjectCode: 'P3', ProjectName: 'Closed', isGlobalPermission: true, statusType: 'close', ...ready };
const unready = { _id: 'p4', ProjectCode: 'P4', ProjectName: 'Empty', isGlobalPermission: true, statusType: 'active', taskStatusData: [], taskTypeCounts: [] };

const parent = { _id: 't1', isParentTask: true, subTasks: 1, statusKey: 1, sprintId: 's1', AssigneeUserId: ['u1'], tagsArray: ['tag1'], subtaskArray: [] };
const lone = { _id: 't2', isParentTask: true, subTasks: 0, statusKey: 1, sprintId: 's1', AssigneeUserId: ['u1'], tagsArray: ['tag1'] };
const child = { _id: 's-a', isParentTask: false, ParentTaskId: 't1', statusKey: 1, sprintId: 's1', AssigneeUserId: [], tagsArray: [] };
const stray = { _id: 's-b', isParentTask: false, ParentTaskId: 't9', statusKey: 1, sprintId: 's1', AssigneeUserId: [], tagsArray: [] };
parent.subtaskArray = [child];
const projectDataState = () => ({
    tasks: { p1: { sprints: ['s1'], s1: { tasks: [parent, lone, { ...stray, _id: 't9', isParentTask: true, subtaskArray: [stray] }] } } },
    searchedTasks: [],
    allProjects: { data: [project, other, closed, unready] }
});

describe('bulk placement helpers', () => {
    const check = (grants) => (key, p) => (grants[p._id] || []).includes(key);

    it('offers as move targets only open projects you can add tasks to and move into', () => {
        const grants = {
            p1: ['task.task_create', 'task.task_list', 'task.task_move'],
            p2: ['task.task_create', 'task.task_list', 'task.task_status'],
            p3: ['task.task_create', 'task.task_list', 'task.task_move'],
            p4: ['task.task_create', 'task.task_list', 'task.task_move'],
            p5: ['task.task_list', 'task.task_move'],
            p6: ['task.task_create', 'task.task_list']
        };
        const noCreate = { ...other, _id: 'p5', ProjectName: 'No create' };
        const noMove = { ...other, _id: 'p6', ProjectName: 'No move' };
        const ids = moveTargets([project, other, closed, unready, noCreate, noMove], check(grants)).map((p) => p._id);
        expect(ids).toEqual(['p1', 'p2']);
    });

    it('offers convert-to-task destinations where you can add tasks, and parents where you can add subtasks', () => {
        const grants = {
            p1: ['task.task_create', 'task.task_list', 'task.sub_task_create', 'task.task_convert_to_subtask'],
            p2: ['task.task_create', 'task.task_list']
        };
        expect(convertTargets([project, other, closed], check(grants)).map((p) => p._id)).toEqual(['p1', 'p2']);
        expect(parentTargets([project, other, closed], check(grants)).map((p) => p._id)).toEqual(['p1']);
    });

    it('reads which selected rows are subtasks, and which travel with a selected parent', () => {
        const state = projectDataState();
        expect(selectionShape(state, ['t1', 's-a'])).toEqual({ count: 2, subtasks: 1, looseSubtasks: 0 });
        expect(selectionShape(state, ['s-b'])).toEqual({ count: 1, subtasks: 1, looseSubtasks: 1 });
        expect(selectionShape(state, ['t2', 'unknown'])).toEqual({ count: 2, subtasks: 0, looseSubtasks: 0 });
    });

    it('disables each placement action with the reason it cannot apply', () => {
        const all = { move: true, toSubtask: true, toTask: true };
        expect(placementActions({ count: 1, subtasks: 1, looseSubtasks: 1 }, all).moveProject)
            .toEqual({ enabled: false, reason: 'BulkActions.subtask_moves_hint' });
        expect(placementActions({ count: 2, subtasks: 0, looseSubtasks: 0 }, all).toTask)
            .toEqual({ enabled: false, reason: 'List.bulk_no_subtasks' });
        const none = placementActions({ count: 2, subtasks: 1, looseSubtasks: 1 }, { move: false, toSubtask: false, toTask: false });
        expect(none.moveProject).toEqual({ enabled: false, reason: 'BulkActions.move_denied' });
        expect(none.toSubtask).toEqual({ enabled: false, reason: 'BulkActions.convert_denied' });
        expect(none.toTask).toEqual({ enabled: false, reason: 'BulkActions.convert_denied' });
        expect(placementActions({ count: 2, subtasks: 1, looseSubtasks: 1 }, all))
            .toEqual({ moveProject: { enabled: true }, toSubtask: { enabled: true }, toTask: { enabled: true } });
    });

    it('reports skipped and failed items with the commonest reason', () => {
        const t = (key, params) => (params ? `${key}${JSON.stringify(params)}` : key);
        expect(bulkReport({ updated: ['a'], skipped: [], errors: [] }, t)).toBeNull();
        const text = bulkReport({
            updated: ['a'],
            skipped: [{ reason: 'already-a-top-level-task' }, { reason: 'already-a-top-level-task' }, { reason: 'permission' }],
            errors: [{ reason: 'boom' }]
        }, t);
        expect(text).toContain('BulkActions.result_skipped{"n":3,"reason":"BulkActions.reason_already_a_top_level_task"}');
        expect(text).toContain('BulkActions.result_failed{"n":1}');
    });

    it('undoes an assignee or tag removal by giving it back to the tasks that had it', () => {
        const before = snapshotTasks(projectDataState(), ['t1', 't2', 's-a']);
        expect(undoRequests({ action: 'bulkUpdateAssignee', payload: { type: 'assigneRemove', employeeId: ['u1'], employeeName: 'User u1' }, before, updatedIds: ['t1', 't2', 's-a'], project }))
            .toEqual([{ action: 'bulkUpdateAssignee', type: 'assigneeAdd', employeeId: ['u1'], employeeName: 'User u1', taskIds: ['t1', 't2'] }]);
        expect(undoRequests({ action: 'bulkUpdateTags', payload: { tagId: 'tag1', operation: 'remove' }, before, updatedIds: ['t1', 't2', 's-a'], project }))
            .toEqual([{ action: 'bulkUpdateTags', tagId: 'tag1', operation: 'add', taskIds: ['t1', 't2'] }]);
    });

    it('undoes a replaced assignee by putting each task back on its own people', () => {
        const before = snapshotTasks(projectDataState(), ['t1', 's-a']);
        expect(undoRequests({ action: 'bulkUpdateAssignee', payload: { type: 'replace', employeeId: ['u2'], employeeName: 'User u2' }, before, updatedIds: ['t1', 's-a'], project }))
            .toEqual([
                { action: 'bulkUpdateAssignee', type: 'replace', employeeId: ['u1'], employeeName: '', taskIds: ['t1'] },
                { action: 'bulkUpdateAssignee', type: 'assigneRemove', employeeId: ['u2'], employeeName: 'User u2', taskIds: ['s-a'] }
            ]);
    });

    it('undoes a promotion to task by putting each subtask back under its old parent', () => {
        const before = snapshotTasks(projectDataState(), ['s-a', 's-b']);
        expect(undoRequests({ action: 'bulkConvertToTask', payload: {}, before, updatedIds: ['s-a', 's-b'], project }))
            .toEqual([
                { action: 'bulkConvertToSubTask', taskIds: ['s-a'], parentTaskId: 't1' },
                { action: 'bulkConvertToSubTask', taskIds: ['s-b'], parentTaskId: 't9' }
            ]);
    });
});

describe('ListBulkBar placement', () => {
    let store;
    const mountBar = (selected, { apps = project.apps } = {}) => {
        store = createStore({
            modules: {
                taskSelection: { ...taskSelection, state: () => ({ selectedTaskIds: selected, lastAnchorId: null, activeView: 'list', activeProjectId: 'p1' }) },
                projectData: {
                    namespaced: true,
                    state: projectDataState,
                    getters: { onlyActiveProjects: (state) => state.allProjects },
                    mutations: { mutateSprints: () => {} }
                },
                settings: {
                    namespaced: true,
                    getters: { companyUsers: () => [{ userId: 'u1', isDelete: false }, { userId: 'u2', isDelete: false }], companyOwnerDetail: () => ({ userId: 'owner' }), projectRawRules: () => [] }
                }
            }
        });
        return mount(ListBulkBar, {
            props: { project: { ...project, apps } },
            global: { plugins: [store], stubs: { ConfirmationSidebar: true } }
        });
    };
    const ok = (data) => Promise.resolve({ data: { status: true, data } });
    const bodies = () => apiRequest.mock.calls.filter(([method]) => method === 'post').map(([, , body]) => body);
    const menu = (wrapper, key) => wrapper.findAll('.lv2-bulk__btn').find((button) => button.text().startsWith(key));
    const item = (wrapper, text) => wrapper.findAll('.lv2-bulk__item').find((button) => button.text().includes(text));
    const sidebar = (wrapper) => wrapper.findComponent({ name: 'ConvertToSubTaskSidebar' });

    beforeEach(() => {
        denied.clear();
        apiRequest.mockReset();
        apiRequest.mockImplementation((method, url, body) => (method === 'post'
            ? ok({ updated: body.taskIds, skipped: [], errors: [], totals: { updated: body.taskIds.length } })
            : Promise.resolve({ data: [] })));
        Object.values(toast).forEach((fn) => fn.mockReset());
    });

    it('moves the selection to a sprint in another project, offering only projects you can add tasks to', async () => {
        const wrapper = mountBar(['t2']);
        await menu(wrapper, 'List.sprint').trigger('click');
        await item(wrapper, 'List.bulk_move_project').trigger('click');
        await flushPromises();

        const picker = sidebar(wrapper);
        expect(picker.exists()).toBe(true);
        expect(picker.props()).toMatchObject({ isMoveTask: true, isBulkMove: true });
        expect(picker.props('projectOptions').map((p) => p._id)).toEqual(['p1', 'p2']);

        picker.vm.$emit('bulkMoveConfirm', { project: other, sprint: { id: 'x1', name: 'Inbox' } });
        await flushPromises();
        expect(bodies()[0]).toMatchObject({
            action: 'bulkMove',
            taskIds: ['t2'],
            projectData: { id: 'p2', ProjectCode: 'P2', ProjectName: 'Other' },
            sprintObj: { id: 'x1', name: 'Inbox' }
        });
        expect(store.state.taskSelection.selectedTaskIds).toEqual([]);
    });

    it('will not move subtasks away from their parent, and says why', async () => {
        const wrapper = mountBar(['s-b']);
        await menu(wrapper, 'List.sprint').trigger('click');
        const moveProject = item(wrapper, 'List.bulk_move_project');
        expect(moveProject.attributes('disabled')).toBeDefined();
        expect(moveProject.attributes('title')).toBe('BulkActions.subtask_moves_hint');
        const sprintHere = item(wrapper, 'Sprint 1');
        expect(sprintHere.attributes('disabled')).toBeDefined();
        expect(sprintHere.attributes('title')).toBe('BulkActions.subtask_moves_hint');
    });

    it('words that reason as a sentence of its own, and keeps the skipped-count reason a fragment', () => {
        expect(en.BulkActions.subtask_moves_hint).toMatch(/^A subtask moves with its parent/);
        expect(en.BulkActions.reason_subtask_moves_with_its_parent).toMatch(/^a subtask moves with its parent/);
        expect(en.BulkActions.result_skipped).toBe('{n} skipped ({reason})');
    });

    it('makes the selection subtasks of the chosen task', async () => {
        const wrapper = mountBar(['t2']);
        await menu(wrapper, 'List.bulk_convert').trigger('click');
        await item(wrapper, 'BulkActions.convert_subtask_title').trigger('click');
        await flushPromises();

        const picker = sidebar(wrapper);
        expect(picker.props()).toMatchObject({ isOpenSubTask: true, isBulkConvert: true });
        expect(picker.props('projectOptions').map((p) => p._id)).toEqual(['p1', 'p2']);
        picker.vm.$emit('bulkConvertConfirm', { task: { _id: 't1' } });
        await flushPromises();
        expect(bodies()[0]).toMatchObject({ action: 'bulkConvertToSubTask', taskIds: ['t2'], parentTaskId: 't1' });
    });

    it('promotes selected subtasks to tasks in the chosen sprint, and offers to undo it', async () => {
        const wrapper = mountBar(['s-a', 't2']);
        await menu(wrapper, 'List.bulk_convert').trigger('click');
        await item(wrapper, 'BulkActions.convert_task_title').trigger('click');
        await flushPromises();

        const picker = sidebar(wrapper);
        expect(picker.props()).toMatchObject({ isMoveTask: true, isBulkMove: true });
        apiRequest.mockImplementationOnce(() => ok({ updated: ['s-a'], skipped: [{ taskId: 't2', reason: 'already-a-top-level-task' }], errors: [], totals: { updated: 1, skipped: 1 } }));
        picker.vm.$emit('bulkMoveConfirm', { project, sprint: { id: 's1', name: 'Sprint 1' } });
        await flushPromises();

        expect(bodies()[0]).toMatchObject({ action: 'bulkConvertToTask', taskIds: ['s-a', 't2'], projectData: { id: 'p1' }, sprintObj: { id: 's1' } });
        expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('BulkActions.result_skipped'));

        await wrapper.find('.lv2-undo button').trigger('click');
        await flushPromises();
        expect(bodies()[1]).toMatchObject({ action: 'bulkConvertToSubTask', taskIds: ['s-a'], parentTaskId: 't1' });
    });

    it('keeps the selection when Esc is pressed while a picker is open', async () => {
        const wrapper = mountBar(['t2']);
        await menu(wrapper, 'List.bulk_convert').trigger('click');
        await item(wrapper, 'BulkActions.convert_subtask_title').trigger('click');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(store.state.taskSelection.selectedTaskIds).toEqual(['t2']);
        wrapper.unmount();
    });

    it('greys out Convert to task when no subtask is selected, and says why', async () => {
        const wrapper = mountBar(['t1', 't2']);
        await menu(wrapper, 'List.bulk_convert').trigger('click');
        const toTask = item(wrapper, 'BulkActions.convert_task_title');
        expect(toTask.attributes('disabled')).toBeDefined();
        expect(toTask.attributes('title')).toBe('List.bulk_no_subtasks');
    });

    it('greys out the conversions you have no permission for', async () => {
        denied.add('task.task_convert_to_subtask');
        denied.add('task.convert_to_task');
        const wrapper = mountBar(['s-a']);
        expect(menu(wrapper, 'List.bulk_convert').attributes('disabled')).toBeDefined();
    });

    it('reports a run where nothing changed instead of claiming success', async () => {
        apiRequest.mockImplementationOnce(() => ok({ updated: [], skipped: [{ taskId: 't2', reason: 'permission' }], errors: [], totals: { updated: 0, skipped: 1 } }));
        const wrapper = mountBar(['t2']);
        await menu(wrapper, 'List.status').trigger('click');
        await item(wrapper, 'To do').trigger('click');
        await flushPromises();
        expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('BulkActions.result_skipped'));
        expect(wrapper.find('.lv2-undo').exists()).toBe(false);
    });

    it('removes an assignee every selected task already has, and adds one they do not', async () => {
        const wrapper = mountBar(['t1', 't2']);
        await menu(wrapper, 'List.assignee').trigger('click');
        const u1 = item(wrapper, 'User u1');
        expect(u1.attributes('aria-pressed')).toBe('true');
        expect(item(wrapper, 'User u2').attributes('aria-pressed')).toBe('false');
        await u1.trigger('click');
        await flushPromises();
        expect(bodies()[0]).toMatchObject({ action: 'bulkUpdateAssignee', type: 'assigneRemove', employeeId: ['u1'] });
    });

    it('replaces the assignee when the project allows only one', async () => {
        const wrapper = mountBar(['t1', 't2'], { apps: [] });
        await menu(wrapper, 'List.assignee').trigger('click');
        await item(wrapper, 'User u2').trigger('click');
        await flushPromises();
        expect(bodies()[0]).toMatchObject({ action: 'bulkUpdateAssignee', type: 'replace', employeeId: ['u2'] });
    });

    it('removes a tag every selected task already has', async () => {
        const wrapper = mountBar(['t1', 't2']);
        await menu(wrapper, 'List.tags').trigger('click');
        await item(wrapper, 'Bug').trigger('click');
        await flushPromises();
        expect(bodies()[0]).toMatchObject({ action: 'bulkUpdateTags', tagId: 'tag1', operation: 'remove' });
    });

    it('clears the selection from a button, for touch screens with no Esc key', async () => {
        const wrapper = mountBar(['t1']);
        const clear = wrapper.find('.lv2-bulk__clear');
        expect(clear.attributes('aria-label')).toBe('BulkActions.clear_selection');
        await clear.trigger('click');
        expect(store.state.taskSelection.selectedTaskIds).toEqual([]);
    });
});

describe('one bulk bar', () => {
    it('retires the legacy BulkActionBar', () => {
        expect(existsSync(path.join(SRC, 'components/molecules/BulkActionBar'))).toBe(false);
        expect(readFileSync(path.join(SRC, 'views/Projects/Projects.vue'), 'utf8')).not.toMatch(/BulkActionBar/);
    });

    it('is mounted by every view that selects rows', () => {
        for (const view of ['views/Projects/ListView/ListView.vue', 'views/Projects/TableView/TableView.vue', 'views/Projects/Kanban/BoardView.vue']) {
            expect(readFileSync(path.join(SRC, view), 'utf8')).toMatch(/<ListBulkBar\b/);
        }
    });
});
