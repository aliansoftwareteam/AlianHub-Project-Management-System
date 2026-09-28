/* 042 slice 13: the List row menu archives, deletes, moves and duplicates a task through the
   same bulk calls the List's bulk bar makes, and every one of them offers Undo. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { defineComponent, h, ref } from 'vue';

const { apiRequest, toast, perms } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn() },
    perms: { value: {} }
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: (path) => (path in perms.value ? perms.value[path] : true), checkApps: () => true }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id, Employee_Name: `User ${id}` }) })
}));

import * as env from '@/config/env';
import en from '@/locales/en';
import { dismissUndoToast, runUndo, undoToast } from '@/composable/useUndoToast';
import { rowMenuRights, useListRowMenu } from '@/views/Projects/ListView/useListRowMenu.js';
import ListRowActions from '@/views/Projects/ListView/ListRowActions.vue';
import ListRow from '@/views/Projects/ListView/ListRow.vue';

const statuses = [
    { key: 1, name: 'To do', type: 'default_active', bgColor: '#eee', textColor: '#111' },
    { key: 3, name: 'Done', type: 'close', bgColor: '#ccc', textColor: '#333' }
];
const project = {
    _id: 'p1', ProjectCode: 'P1', ProjectName: 'Project one', isGlobalPermission: true,
    taskStatusData: statuses,
    taskTypeCounts: [{ key: 'k1', value: 'Task', name: 'Task' }],
    sprintsObj: { s1: { id: 's1', name: 'Sprint 1' } }
};
const destination = { _id: 'p2', ProjectCode: 'P2', ProjectName: 'Project two' };
const destSprint = { id: 's9', name: 'Backlog' };

const task = (overrides = {}) => ({
    _id: 't1', TaskName: 'Write the brief', TaskKey: 'P1-4', ProjectID: 'p1', sprintId: 's1',
    sprintArray: { id: 's1', name: 'Sprint 1' }, statusKey: 1, isParentTask: true, subTasks: 0,
    AssigneeUserId: ['u1'], watchers: ['u2'], tagsArray: [], deletedStatusKey: 0,
    ...overrides
});

const ok = (data) => Promise.resolve({ data: { status: true, data } });
const bodies = () => apiRequest.mock.calls.map(([method, url, body]) => ({ method, url, ...body }));

const makeStore = () => createStore({
    state: { projectData: { tasks: {}, searchedTasks: [] } },
    getters: {
        'settings/companyOwnerDetail': () => ({ userId: 'owner' }),
        'settings/companyPriority': () => [],
        'settings/companyMembers': () => [],
        'projectData/currentProjectDetails': () => ({}),
        'settings/teams': () => []
    }
});

function useMenu({ archived = false } = {}) {
    let api;
    const Harness = defineComponent({
        setup() {
            api = useListRowMenu(ref(project), ref(archived));
            return () => h('div');
        }
    });
    mount(Harness, { global: { plugins: [makeStore()] } });
    return api;
}

beforeEach(() => {
    apiRequest.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
    perms.value = {};
    dismissUndoToast();
});

describe('rowMenuRights', () => {
    const check = (granted) => (path) => (path in granted ? granted[path] : true);

    it('grants each action on its own task permission, as the bulk bar and task panel do', () => {
        expect(rowMenuRights(check({}))).toEqual({ archive: true, delete: true, move: true, duplicate: true, undoDuplicate: true });
        expect(rowMenuRights(check({ 'task.task_archive': false }))).toMatchObject({ archive: false, delete: true });
        expect(rowMenuRights(check({ 'task.task_delete': null }))).toMatchObject({ delete: false, undoDuplicate: false });
        expect(rowMenuRights(check({ 'task.task_move': false }))).toMatchObject({ move: false });
        expect(rowMenuRights(check({ 'task.task_duplicate': false }))).toMatchObject({ duplicate: false });
    });

    it('offers none of them while the list shows archived tasks', () => {
        expect(rowMenuRights(check({}), { archived: true })).toMatchObject({ archive: false, delete: false, move: false, duplicate: false });
    });
});

describe('ListRowActions', () => {
    const mountActions = (props = {}) => mount(ListRowActions, {
        props: { task: task(), href: 'https://x/t1', ...props },
        attachTo: document.body,
        global: { stubs: { ShellIcon: true } }
    });
    const openMenu = async (wrapper) => {
        await wrapper.find('[data-action="menu"]').trigger('click');
        return wrapper.find('[role="menu"]');
    };

    it('shows no archive, delete, move or duplicate item without the permission', async () => {
        const menu = await openMenu(mountActions());
        for (const item of ['archive', 'delete', 'move', 'duplicate', 'duplicate-subtasks']) {
            expect(menu.find(`[data-item="${item}"]`).exists()).toBe(false);
        }
    });

    it('shows each item the row is allowed, as a menu item', async () => {
        const menu = await openMenu(mountActions({ canArchive: true, canDelete: true, canMove: true, canDuplicate: true }));
        for (const item of ['archive', 'delete', 'move', 'duplicate']) {
            expect(menu.find(`[data-item="${item}"]`).attributes('role')).toBe('menuitem');
        }
        expect(menu.find('[data-item="duplicate-subtasks"]').exists()).toBe(false);
    });

    it('offers "Duplicate with subtasks" only for a task that has some', async () => {
        const menu = await openMenu(mountActions({ task: task({ subTasks: 2 }), canDuplicate: true }));
        expect(menu.find('[data-item="duplicate-subtasks"]').exists()).toBe(true);
    });

    it('emits the chosen action and closes', async () => {
        const wrapper = mountActions({ canArchive: true, canDelete: true, canMove: true, canDuplicate: true, task: task({ subTasks: 1 }) });
        for (const [item, event] of [['archive', 'archive'], ['delete', 'delete'], ['move', 'move'], ['duplicate', 'duplicate'], ['duplicate-subtasks', 'duplicate-subtasks']]) {
            const menu = await openMenu(wrapper);
            await menu.find(`[data-item="${item}"]`).trigger('click');
            expect(wrapper.emitted(event)).toHaveLength(1);
            expect(wrapper.find('[role="menu"]').exists()).toBe(false);
        }
        wrapper.unmount();
    });

    it('reaches the new items from the keyboard', async () => {
        const wrapper = mountActions({ canArchive: true });
        const menu = await openMenu(wrapper);
        const items = menu.findAll('[role="menuitem"]');
        items[items.length - 2].element.focus();
        await menu.trigger('keydown', { key: 'End' });
        expect(document.activeElement.dataset.item).toBe(items[items.length - 1].element.dataset.item);
        expect(menu.find('[data-item="archive"]').exists()).toBe(true);
        wrapper.unmount();
    });
});

describe('the row passes its menu through to the list', () => {
    const edit = {
        rights: ref({ status: false, assignee: false, due: false, priority: false, rename: false, subtask: false, estimate: false, points: false, customField: false }),
        statuses: ref([]),
        showPriority: ref(false),
        multipleAssignees: ref(false),
        taskHref: () => '',
        assigneeOptions: () => [],
        copyLink: vi.fn()
    };
    const mountRow = (menu) => mount(ListRow, {
        props: { data: task() },
        global: {
            plugins: [makeStore()],
            provide: { listRowEdit: edit, listRowMenu: menu, $defaultUserAvatar: ref(''), $defaultGhostCustomUserImg: ref(''), $defaultTaskStatusImg: ref('') },
            stubs: { ShellIcon: true, ProvenanceBadge: true, TaskTagCell: true }
        }
    });

    it('hides the items the menu does not grant and calls the menu for the ones it does', async () => {
        const menu = {
            rights: ref({ archive: true, delete: false, move: true, duplicate: false }),
            archive: vi.fn(), remove: vi.fn(), startMove: vi.fn(), duplicate: vi.fn()
        };
        const wrapper = mountRow(menu);
        await wrapper.find('[data-action="menu"]').trigger('click');
        expect(wrapper.find('[data-item="delete"]').exists()).toBe(false);
        expect(wrapper.find('[data-item="duplicate"]').exists()).toBe(false);
        await wrapper.find('[data-item="archive"]').trigger('click');
        expect(menu.archive).toHaveBeenCalledWith(expect.objectContaining({ _id: 't1' }));
        await wrapper.find('[data-action="menu"]').trigger('click');
        await wrapper.find('[data-item="move"]').trigger('click');
        expect(menu.startMove).toHaveBeenCalledWith(expect.objectContaining({ _id: 't1' }));
    });
});

describe('useListRowMenu', () => {
    it('archives through bulkArchive and Undo restores through bulkRestore', async () => {
        apiRequest.mockImplementation(() => ok({ updated: ['t1'], totals: { updated: 1 } }));
        const menu = useMenu();
        await menu.archive(task());
        await flushPromises();

        expect(bodies()[0]).toMatchObject({ method: 'post', url: env.V2_TASKS_BULK, action: 'bulkArchive', taskIds: ['t1'] });
        expect(bodies()[0].userData).toMatchObject({ id: 'user-1', companyOwnerId: 'owner' });
        expect(undoToast.current?.message).toBe('List.row_archived');

        await runUndo();
        await flushPromises();
        expect(bodies()[1]).toMatchObject({ action: 'bulkRestore', taskIds: ['t1'] });
        expect(toast.success).toHaveBeenCalledWith('List.bulk_undone', expect.anything());
    });

    it('deletes softly through bulkTrash and Undo restores it', async () => {
        apiRequest.mockImplementation(() => ok({ updated: ['t1'] }));
        const menu = useMenu();
        await menu.remove(task());
        await flushPromises();
        expect(bodies()[0]).toMatchObject({ action: 'bulkTrash', taskIds: ['t1'] });
        expect(undoToast.current?.message).toBe('List.row_deleted');

        await runUndo();
        await flushPromises();
        expect(bodies()[1]).toMatchObject({ action: 'bulkRestore', taskIds: ['t1'] });
    });

    it('moves to the picked project and sprint through bulkMove, and Undo moves it back', async () => {
        apiRequest.mockImplementation(() => ok({ updated: ['t1'] }));
        const menu = useMenu();
        menu.startMove(task());
        expect(menu.moving.value?._id).toBe('t1');
        await menu.confirmMove({ project: destination, sprint: destSprint });
        await flushPromises();

        expect(menu.moving.value).toBe(null);
        expect(bodies()[0]).toMatchObject({
            action: 'bulkMove', taskIds: ['t1'], sprintObj: destSprint,
            projectData: { id: 'p2', ProjectCode: 'P2', ProjectName: 'Project two' }
        });
        expect(undoToast.current?.message).toBe('List.row_moved');

        await runUndo();
        await flushPromises();
        expect(bodies()[1]).toMatchObject({
            action: 'bulkMove', taskIds: ['t1'], sprintObj: project.sprintsObj.s1,
            projectData: { id: 'p1', ProjectCode: 'P1', ProjectName: 'Project one' }
        });
    });

    it('duplicates through bulkDuplicate as "Copy of …" and Undo removes the copy', async () => {
        apiRequest.mockImplementation(() => ok({ updated: ['t1'], newTaskIds: ['n1'] }));
        const menu = useMenu();
        await menu.duplicate(task({ subTasks: 2 }), { withSubtasks: true });
        await flushPromises();

        const body = bodies()[0];
        expect(body).toMatchObject({
            action: 'bulkDuplicate', taskIds: ['t1'],
            sprintObj: project.sprintsObj.s1,
            projectData: { id: 'p1', ProjectCode: 'P1', ProjectName: 'Project one' },
            oldProject: { id: 'p1', ProjectName: 'Project one', taskStatusData: statuses, taskTypeCounts: project.taskTypeCounts },
            isSubTask: true,
            assignee: ['u1'],
            watcher: ['u2'],
            taskName: 'List.copy_of'
        });
        expect(body.duplicateData).toEqual(expect.arrayContaining(['Checklists', 'Due Date', 'Copy Assignees', 'Copy Watchers']));
        expect(undoToast.current?.message).toBe('List.row_duplicated');

        await runUndo();
        await flushPromises();
        expect(bodies()[1]).toMatchObject({ action: 'bulkTrash', taskIds: ['n1'] });
    });

    it('leaves subtasks behind unless asked', async () => {
        apiRequest.mockImplementation(() => ok({ updated: ['t1'], newTaskIds: ['n1'] }));
        await useMenu().duplicate(task({ subTasks: 2 }));
        expect(bodies()[0].isSubTask).toBe(false);
    });

    it('offers no Undo on a duplicate the user could not delete again', async () => {
        perms.value = { 'task.task_delete': false };
        apiRequest.mockImplementation(() => ok({ updated: ['t1'], newTaskIds: ['n1'] }));
        await useMenu().duplicate(task());
        await flushPromises();
        expect(undoToast.current).toBe(null);
        expect(toast.success).toHaveBeenCalledWith('List.row_duplicated', expect.anything());
    });

    it('reports a refusal and offers nothing to undo', async () => {
        apiRequest.mockImplementation(() => Promise.resolve({ data: { status: false, statusText: 'Not allowed' } }));
        await useMenu().archive(task());
        await flushPromises();
        expect(undoToast.current).toBe(null);
        expect(toast.error).toHaveBeenCalledWith('Not allowed', expect.anything());
    });

    it('does nothing the row is not allowed to do', async () => {
        perms.value = { 'task.task_archive': false };
        await useMenu().archive(task());
        expect(apiRequest).not.toHaveBeenCalled();
    });
});

describe('copy', () => {
    it('has English text for every new key', () => {
        for (const key of ['menu_archive', 'menu_delete', 'menu_move', 'menu_duplicate', 'menu_duplicate_subtasks',
            'row_archived', 'row_deleted', 'row_moved', 'row_duplicated', 'copy_of']) {
            expect(typeof en.List[key]).toBe('string');
        }
        expect(en.List.copy_of).toContain('{name}');
    });
});
