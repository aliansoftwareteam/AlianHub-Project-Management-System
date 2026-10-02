/* Task 046 A1.4: the Board card and the List row offer one task menu — the same items, in the
   same order, under the same labels and permissions — from a single definition. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';
import { createStore } from 'vuex';

const { apiRequest, perms } = vi.hoisted(() => ({ apiRequest: vi.fn(), perms: { value: {} } }));
const composable = vi.hoisted(() => ({
    useCustomComposable: () => ({
        checkPermission: (path) => (path in perms.value ? perms.value[path] : true),
        checkApps: () => true,
        makeUniqueId: () => 'id',
        debounce: (fn) => fn
    }),
    useConvertDate: () => ({ convertDateFormat: () => '' }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id, Employee_Name: `User ${id}` }), getTeam: () => ({}), getPriorities: () => [] })
}));
vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/composable', () => composable);
vi.mock('@/composable/index', () => composable);
vi.mock('@/composable/index.js', () => composable);
vi.mock('@/composable/commonFunction', () => ({ companyPrioritiesIcons: () => ({}), isBundledPriorityImage: () => true }));
vi.mock('@/composable/useTaskSelection.js', () => ({ useTaskSelection: () => ({ isSelected: () => false, selectFromEvent: vi.fn() }) }));
vi.mock('@/components/molecules/Home/useTimer', () => ({ useTimer: () => ({ timer: { active: null }, elapsedMs: { value: 0 }, isTracking: () => false }) }));
vi.mock('@/utils/assigneeOptions', () => ({ permittedAssignees: () => [], selfAssignable: () => [], sprintOf: () => null }));
vi.mock('@/utils/TaskOperations', () => ({ default: { updateArchiveDelete: vi.fn(() => Promise.resolve({ status: true })) } }));
vi.mock('@/views/Projects/helper', () => ({ useUpdateTasks: () => ({ updateTaskByGroup: vi.fn() }) }));
vi.mock('@/components/organisms/TaskDetailOverlay/useTaskOverlay', () => ({ openTask: vi.fn() }));
vi.mock('@/components/molecules/Provenance/provenance', () => ({ isAgentWork: () => false }));
vi.mock('vue-router', () => ({ useRoute: () => ({ name: 'Project', params: {} }), useRouter: () => ({ push: vi.fn(), resolve: () => ({ href: '/t1' }) }) }));
vi.mock('@vuepic/vue-datepicker/dist/main.css', () => ({}));
vi.mock('@vuepic/vue-datepicker', () => ({ default: defineComponent({ name: 'VueDatePicker', setup: () => () => h('div') }) }));

import { TASK_MENU, taskMenuItems, taskMenuRights } from '@/views/Projects/composables/taskMenu';
import TaskMenuSidebars from '@/views/Projects/components/taskMenu/TaskMenuSidebars.vue';
import BoardCard from '@/views/Projects/Kanban/BoardViewDisplayCardComponent.vue';
import ListRow from '@/views/Projects/ListView/ListRow.vue';
import { useListRowMenu } from '@/views/Projects/ListView/useListRowMenu.js';
import { templateDialog, closeTemplateDialog } from '@/components/molecules/TaskTemplates/taskTemplates';
import { dismissUndoToast, runUndo, undoToast } from '@/composable/useUndoToast';
import en from '@/locales/en';

const ALL = ['rename', 'subtask', 'copy-link', 'copy-key', 'new-tab', 'open', 'save-template',
    'convert-subtask', 'convert-list', 'move', 'remove-from-list', 'duplicate', 'duplicate-subtasks', 'merge',
    'archive', 'restore', 'delete'];

const task = (overrides = {}) => ({
    _id: 't1', TaskName: 'Write the brief', TaskKey: 'P1-4', ProjectID: 'p1', sprintId: 's1',
    sprintArray: { id: 's1', name: 'Sprint 1' }, statusKey: 1, isParentTask: true, subTasks: 2,
    AssigneeUserId: [], watchers: [], tagsArray: [], deletedStatusKey: 0, Task_Priority: 'HIGH',
    ...overrides
});
const project = { _id: 'p1', ProjectCode: 'P1', ProjectName: 'Project one', isGlobalPermission: true, viewColumn: [], tagsArray: [], taskStatusData: [], sprintsObj: { s1: { id: 's1', name: 'Sprint 1' } } };
const check = (path) => (path in perms.value ? perms.value[path] : true);
const rightsNow = (archived = false) => taskMenuRights(check, { archived });

const store = () => createStore({
    state: { projectData: { tasks: {}, searchedTasks: [] } },
    getters: {
        'settings/companyUsers': () => [],
        'settings/designations': () => [],
        'settings/companyOwnerDetail': () => ({ userId: 'owner' }),
        'settings/companyDateFormat': () => ({ dateFormat: 'DD/MM/YYYY' }),
        'settings/companyPriority': () => [],
        'users/myCounts': () => ({ data: {} }),
        'projectData/searchedTasks': () => [],
        'projectData/tasks': () => ({})
    }
});

const Sidebars = { name: 'TaskMenuSidebars', props: ['mode', 'task'], emits: ['close'], template: '<div class="sidebars" :data-mode="mode || \'\'"></div>' };

function mountBoard({ data = task(), archived = false, listId = '' } = {}) {
    const boardMenu = { rights: ref(rightsNow(archived)), rename: vi.fn(), duplicate: vi.fn(), removeFromList: vi.fn() };
    const toggleTaskDetail = vi.fn();
    const wrapper = mount(BoardCard, {
        props: { data, groupValue: 0, isSubTask: false, ...(listId ? { itemData: { sprintId: listId } } : {}) },
        attachTo: document.body,
        global: {
            plugins: [store()],
            provide: {
                showArchived: ref(archived),
                toggleTaskDetail,
                selectedProject: ref(project),
                searchedTask: ref(false),
                taskCollapsed: ref(true),
                boardTaskMenu: boardMenu,
                $dateFormat: ref('DD/MM/YYYY')
            },
            stubs: {
                TaskMenuSidebars: Sidebars,
                Assignee: true, Priority: true, CalenderCompo: true, ProvenanceBadge: true, BoardViewTaskCreate: true,
                ConfirmationSidebar: true, TagChip: true, CreateTagPopup: true
            }
        }
    });
    return { wrapper, boardMenu, toggleTaskDetail };
}

function mountList({ data = task(), archived = false, isSub = false, listId = '' } = {}) {
    const rights = rightsNow(archived);
    const edit = {
        rights: ref({ status: false, assignee: false, due: false, priority: false, estimate: false, points: false, customField: false, rename: rights.rename, subtask: rights.subtask, template: rights.template }),
        statuses: ref([]), showPriority: ref(false), multipleAssignees: ref(false),
        taskHref: () => 'https://x/t1', assigneeOptions: () => [], copyLink: vi.fn(), copyKey: vi.fn(), rename: vi.fn()
    };
    const menu = {
        rights: ref(rights), archive: vi.fn(), remove: vi.fn(), restore: vi.fn(), startMove: vi.fn(), duplicate: vi.fn(), openSidebar: vi.fn(), removeFromList: vi.fn()
    };
    const wrapper = mount(ListRow, {
        props: { data, isSub },
        attachTo: document.body,
        global: {
            plugins: [store()],
            provide: { listRowEdit: edit, listRowMenu: menu, listColumns: ref([]), selectedProject: ref(project), ...(listId ? { viewedList: ref({ sprintId: listId, projectId: 'p1' }) } : {}) },
            stubs: { ShellIcon: true, ProvenanceBadge: true, TaskTagCell: true, ListStatusCircle: true }
        }
    });
    return { wrapper, edit, menu };
}

async function boardItems(wrapper) {
    await wrapper.find('.option-list__trigger').trigger('click');
    return [...document.body.querySelectorAll('.task-menu [role="menuitem"]')].map((item) => [item.dataset.item, item.textContent]);
}
async function listItems(wrapper) {
    await wrapper.find('[data-action="menu"]').trigger('click');
    return wrapper.findAll('[role="menu"] [role="menuitem"]').map((item) => [item.attributes('data-item'), item.text()]);
}
async function pickBoard(wrapper, id) {
    await wrapper.find('.option-list__trigger').trigger('click');
    document.body.querySelector(`.task-menu [data-item="${id}"]`).click();
    await nextTick();
}
async function pickList(wrapper, id) {
    await wrapper.find('[data-action="menu"]').trigger('click');
    await wrapper.find(`[role="menu"] [data-item="${id}"]`).trigger('click');
}

beforeEach(() => {
    perms.value = {};
    apiRequest.mockReset();
    closeTemplateDialog();
    dismissUndoToast();
});

describe('the one definition of the task menu', () => {
    it('lists every action once, in the order both views show them', () => {
        expect(TASK_MENU.map((item) => item.id)).toEqual(ALL);
    });

    it('has English text for every label', () => {
        for (const item of TASK_MENU) {
            const text = item.labelKey.split('.').reduce((node, key) => node?.[key], en);
            expect(typeof text, item.labelKey).toBe('string');
        }
    });

    it('with every permission an open task gets everything but restore', () => {
        expect(taskMenuItems(task(), rightsNow()).map((item) => item.id)).toEqual(ALL.filter((id) => id !== 'restore' && id !== 'remove-from-list'));
    });

    it('takes each action away with its own permission', () => {
        const without = (path) => {
            perms.value = { [path]: false };
            return taskMenuItems(task(), rightsNow()).map((item) => item.id);
        };
        expect(without('task.task_name_edit')).not.toContain('rename');
        expect(without('task.sub_task_create')).not.toEqual(expect.arrayContaining(['subtask']));
        expect(without('task.sub_task_create')).not.toContain('convert-subtask');
        expect(without('task.task_create')).not.toContain('save-template');
        expect(without('task.task_convert_to_subtask')).not.toContain('convert-subtask');
        expect(without('task.task_convert_to_list')).not.toContain('convert-list');
        expect(without('project.project_sprint_create')).not.toContain('convert-list');
        expect(without('task.task_move')).not.toContain('move');
        expect(without('task.task_duplicate')).not.toEqual(expect.arrayContaining(['duplicate']));
        expect(without('task.task_duplicate')).not.toContain('duplicate-subtasks');
        expect(without('task.task_merge')).not.toContain('merge');
        expect(without('task.task_archive')).not.toContain('archive');
        expect(without('task.task_delete')).not.toContain('delete');
        expect(without('task.task_list')).toEqual(expect.not.arrayContaining(['rename', 'subtask', 'save-template']));
    });

    it('a read-only permission is not enough', () => {
        perms.value = { 'task.task_merge': null, 'task.task_archive': 1 };
        const ids = taskMenuItems(task(), rightsNow()).map((item) => item.id);
        expect(ids).not.toContain('merge');
        expect(ids).not.toContain('archive');
    });

    it('an archived task can be copied, opened, restored and deleted, and nothing else', () => {
        const ids = taskMenuItems(task({ deletedStatusKey: 2 }), rightsNow(true)).map((item) => item.id);
        expect(ids).toEqual(['copy-link', 'copy-key', 'new-tab', 'open', 'restore', 'delete']);
        perms.value = { 'task.task_archive': false };
        expect(taskMenuItems(task({ deletedStatusKey: 2 }), rightsNow(true)).map((item) => item.id)).not.toContain('restore');
    });

    it('a subtask has no subtasks, template or conversion of its own', () => {
        const ids = taskMenuItems(task({ isParentTask: false, subTasks: 0 }), rightsNow()).map((item) => item.id);
        for (const id of ['subtask', 'save-template', 'convert-subtask', 'duplicate-subtasks']) expect(ids).not.toContain(id);
        expect(ids).toEqual(expect.arrayContaining(['rename', 'move', 'duplicate', 'merge', 'convert-list', 'archive', 'delete']));
    });

    it('offers "Duplicate with subtasks" only when there are some, and "Copy task ID" only with an id', () => {
        const ids = taskMenuItems(task({ subTasks: 0, TaskKey: '--' }), rightsNow()).map((item) => item.id);
        expect(ids).not.toContain('duplicate-subtasks');
        expect(ids).not.toContain('copy-key');
    });

    it('marks where a new group starts and which item is destructive', () => {
        const items = taskMenuItems(task(), rightsNow());
        expect(items.filter((item) => item.separated).map((item) => item.id)).toEqual(['convert-subtask', 'archive']);
        expect(items.filter((item) => item.danger).map((item) => item.id)).toEqual(['delete']);
    });
});

describe('the Board card and the List row show the same menu', () => {
    const cases = [
        ['with every permission', {}, {}],
        ['without merge, convert and template rights', { 'task.task_merge': false, 'task.task_convert_to_list': false, 'task.task_create': false }, {}],
        ['for a task with no subtasks and no id', {}, { subTasks: 0, TaskKey: '--' }],
        ['with read-only access', { 'task.task_list': false, 'task.task_archive': false, 'task.task_delete': false, 'task.task_move': false, 'task.task_duplicate': false }, {}]
    ];

    it.each(cases)('%s', async (_, granted, overrides) => {
        perms.value = granted;
        const board = mountBoard({ data: task(overrides) });
        const list = mountList({ data: task(overrides) });
        const expected = taskMenuItems(task(overrides), rightsNow()).map((item) => [item.id, item.labelKey]);
        expect(await boardItems(board.wrapper)).toEqual(expected);
        expect(await listItems(list.wrapper)).toEqual(expected);
        board.wrapper.unmount();
        list.wrapper.unmount();
    });

    it('for an archived task too', async () => {
        const data = task({ deletedStatusKey: 2 });
        const board = mountBoard({ data, archived: true });
        const list = mountList({ data, archived: true });
        const expected = taskMenuItems(data, rightsNow(true)).map((item) => [item.id, item.labelKey]);
        expect(expected.map(([id]) => id)).toContain('restore');
        expect(await boardItems(board.wrapper)).toEqual(expected);
        expect(await listItems(list.wrapper)).toEqual(expected);
        board.wrapper.unmount();
        list.wrapper.unmount();
    });
});

describe('a task shown in a list it was added to', () => {
    const HERE = 's2';
    const added = () => task({ extraLists: [{ projectId: 'p1', sprintId: HERE }] });

    it('can be taken out of that list from the Board card and from the List row', async () => {
        const board = mountBoard({ data: added(), listId: HERE });
        const list = mountList({ data: added(), listId: HERE });
        const expected = taskMenuItems(added(), rightsNow(), { listId: HERE }).map((item) => [item.id, item.labelKey]);

        expect(expected).toContainEqual(['remove-from-list', 'TaskLists.menu_remove_here']);
        expect(await boardItems(board.wrapper)).toEqual(expected);
        expect(await listItems(list.wrapper)).toEqual(expected);
        board.wrapper.unmount();
        list.wrapper.unmount();
    });

    it('picking it asks for the removal from the list on screen', async () => {
        const board = mountBoard({ data: added(), listId: HERE });
        await pickBoard(board.wrapper, 'remove-from-list');
        expect(board.boardMenu.removeFromList).toHaveBeenCalledWith(expect.objectContaining({ _id: 't1' }), HERE);
        board.wrapper.unmount();

        const list = mountList({ data: added(), listId: HERE });
        await pickList(list.wrapper, 'remove-from-list');
        expect(list.menu.removeFromList).toHaveBeenCalledWith(expect.objectContaining({ _id: 't1' }), HERE);
        list.wrapper.unmount();
    });

    it('carries a mark naming the list it lives in, which a task that lives here does not', async () => {
        const board = mountBoard({ data: added(), listId: HERE });
        const list = mountList({ data: added(), listId: HERE });
        const atHome = mountList({ data: task(), listId: 's1' });

        expect(board.wrapper.find('[data-home-mark]').text()).toBe('Sprint 1');
        expect(list.wrapper.find('[data-home-mark]').text()).toBe('Sprint 1');
        expect(atHome.wrapper.find('[data-home-mark]').exists()).toBe(false);
        expect(await listItems(atHome.wrapper)).not.toContainEqual(['remove-from-list', 'TaskLists.menu_remove_here']);
        [board, list, atHome].forEach((mounted) => mounted.wrapper.unmount());
    });
});

describe('Add subtask on the Board follows the depth of the task', () => {
    const offered = async (overrides) => {
        const board = mountBoard({ data: task(overrides) });
        const ids = (await boardItems(board.wrapper)).map(([id]) => id);
        board.wrapper.unmount();
        return ids;
    };

    it('a task and a subtask take one', async () => {
        expect(await offered({})).toContain('subtask');
        expect(await offered({ isParentTask: false, ParentTaskId: 'a', ancestors: ['a'] })).toContain('subtask');
    });

    it('a sub-subtask is on the last level and takes none', async () => {
        expect(await offered({ isParentTask: false, ParentTaskId: 'b', ancestors: ['a', 'b'] })).not.toContain('subtask');
    });
});

describe('what the Board gained', () => {
    it('renames in place through the shared rename', async () => {
        const { wrapper, boardMenu } = mountBoard();
        await pickBoard(wrapper, 'rename');
        await nextTick();
        const input = wrapper.find('input.card-rename');
        expect(input.exists()).toBe(true);
        expect(input.element.value).toBe('Write the brief');
        await input.setValue('Write the launch brief');
        await input.trigger('keydown', { key: 'Enter' });
        expect(boardMenu.rename).toHaveBeenCalledWith(expect.objectContaining({ _id: 't1' }), 'Write the launch brief');
        expect(wrapper.find('input.card-rename').exists()).toBe(false);

        await pickBoard(wrapper, 'rename');
        await nextTick();
        await wrapper.find('input.card-rename').trigger('keydown', { key: 'Escape' });
        expect(wrapper.find('input.card-rename').exists()).toBe(false);
        expect(boardMenu.rename).toHaveBeenCalledTimes(1);
        wrapper.unmount();
    });

    it('opens the subtask form under the card', async () => {
        const { wrapper } = mountBoard();
        expect(wrapper.findComponent({ name: 'BoardViewTaskCreate' }).exists()).toBe(false);
        await pickBoard(wrapper, 'subtask');
        expect(wrapper.findComponent({ name: 'BoardViewTaskCreate' }).exists()).toBe(true);
        wrapper.unmount();
    });

    it('opens the task, here or in a new tab', async () => {
        const opened = vi.spyOn(window, 'open').mockImplementation(() => null);
        const { wrapper, toggleTaskDetail } = mountBoard();
        await pickBoard(wrapper, 'open');
        expect(toggleTaskDetail).toHaveBeenCalledWith(expect.objectContaining({ _id: 't1' }));
        await pickBoard(wrapper, 'new-tab');
        expect(opened).toHaveBeenCalledWith(new URL('/t1', window.location.href).toString(), '_blank', 'noopener');
        opened.mockRestore();
        wrapper.unmount();
    });

    it('saves the task as a template', async () => {
        const { wrapper } = mountBoard();
        await pickBoard(wrapper, 'save-template');
        expect(templateDialog).toMatchObject({ open: true, mode: 'save', task: expect.objectContaining({ _id: 't1' }) });
        wrapper.unmount();
    });

    it('duplicates with subtasks through the List\'s own duplicate', async () => {
        const { wrapper, boardMenu } = mountBoard();
        await pickBoard(wrapper, 'duplicate-subtasks');
        expect(boardMenu.duplicate).toHaveBeenCalledWith(expect.objectContaining({ _id: 't1' }), { withSubtasks: true });
        wrapper.unmount();
    });

    it('still converts, moves, duplicates and merges through its sidebars', async () => {
        const { wrapper } = mountBoard();
        for (const id of ['convert-subtask', 'convert-list', 'move', 'duplicate', 'merge']) {
            await pickBoard(wrapper, id);
            expect(wrapper.find('.sidebars').attributes('data-mode'), id).toBe(id);
            wrapper.findComponent({ name: 'TaskMenuSidebars' }).vm.$emit('close');
            await nextTick();
            expect(wrapper.find('.sidebars').attributes('data-mode')).toBe('');
        }
        wrapper.unmount();
    });
});

describe('what the List gained', () => {
    it('converts and merges through the sidebars the Board uses', async () => {
        const { wrapper, menu } = mountList();
        for (const id of ['convert-subtask', 'convert-list', 'merge']) {
            await pickList(wrapper, id);
            expect(menu.openSidebar).toHaveBeenLastCalledWith(id, expect.objectContaining({ _id: 't1' }));
        }
        expect(menu.openSidebar).toHaveBeenCalledTimes(3);
        wrapper.unmount();
    });

    it('keeps its own move and duplicate for a task, and uses the sidebars for a subtask', async () => {
        const parent = mountList();
        await pickList(parent.wrapper, 'move');
        await pickList(parent.wrapper, 'duplicate');
        expect(parent.menu.startMove).toHaveBeenCalledTimes(1);
        expect(parent.menu.duplicate).toHaveBeenCalledTimes(1);
        expect(parent.menu.openSidebar).not.toHaveBeenCalled();
        parent.wrapper.unmount();

        const sub = mountList({ data: task({ _id: 's1', isParentTask: false, subTasks: 0 }), isSub: true });
        await pickList(sub.wrapper, 'move');
        expect(sub.menu.openSidebar).toHaveBeenLastCalledWith('move', expect.objectContaining({ _id: 's1' }));
        await pickList(sub.wrapper, 'duplicate');
        expect(sub.menu.openSidebar).toHaveBeenLastCalledWith('duplicate', expect.objectContaining({ _id: 's1' }));
        expect(sub.menu.startMove).not.toHaveBeenCalled();
        expect(sub.menu.duplicate).not.toHaveBeenCalled();
        sub.wrapper.unmount();
    });

    it('restores an archived task from its row', async () => {
        const { wrapper, menu } = mountList({ data: task({ deletedStatusKey: 2 }), archived: true });
        await pickList(wrapper, 'restore');
        expect(menu.restore).toHaveBeenCalledWith(expect.objectContaining({ _id: 't1' }));
        wrapper.unmount();
    });
});

describe('the List row menu on archived tasks', () => {
    const bodies = () => apiRequest.mock.calls.map(([method, url, body]) => ({ method, url, ...body }));
    function useMenu(archived) {
        let api;
        mount(defineComponent({
            setup() {
                api = useListRowMenu(ref(project), ref(archived));
                return () => h('div');
            }
        }), { global: { plugins: [store()] } });
        return api;
    }

    it('restore goes through bulkRestore and Undo archives it again', async () => {
        apiRequest.mockImplementation(() => Promise.resolve({ data: { status: true, data: { updated: ['t1'] } } }));
        const menu = useMenu(true);
        await menu.restore(task({ deletedStatusKey: 2 }));
        await flushPromises();
        expect(bodies()[0]).toMatchObject({ action: 'bulkRestore', taskIds: ['t1'] });
        expect(undoToast.current?.message).toBe('List.row_restored');
        await runUndo();
        await flushPromises();
        expect(bodies()[1]).toMatchObject({ action: 'bulkArchive', taskIds: ['t1'] });
    });

    it('Undo of deleting an archived task puts it back in the archive', async () => {
        apiRequest.mockImplementation(() => Promise.resolve({ data: { status: true, data: { updated: ['t1'] } } }));
        const menu = useMenu(true);
        await menu.remove(task({ deletedStatusKey: 2 }));
        await flushPromises();
        expect(bodies()[0]).toMatchObject({ action: 'bulkTrash', taskIds: ['t1'] });
        await runUndo();
        await flushPromises();
        expect(bodies().slice(1).map((body) => body.action)).toEqual(['bulkRestore', 'bulkArchive']);
    });

    it('does not restore without the archive permission', async () => {
        perms.value = { 'task.task_archive': false };
        await useMenu(true).restore(task({ deletedStatusKey: 2 }));
        expect(apiRequest).not.toHaveBeenCalled();
    });

    it('holds the sidebar a row asked for until it closes', () => {
        const menu = useMenu(false);
        expect(menu.sidebar.value).toBe(null);
        menu.openSidebar('merge', task());
        expect(menu.sidebar.value).toMatchObject({ mode: 'merge', task: { _id: 't1' } });
        menu.closeSidebar();
        expect(menu.sidebar.value).toBe(null);
    });
});

describe('TaskMenuSidebars', () => {
    const Convert = { name: 'ConvertToSubTaskSidebar', props: ['closeSideBar', 'isMoveTask', 'openMoveSubTask', 'isMergeTask', 'isDuplicate', 'isOpenSubTask', 'task'], emits: ['isConvertSubtaskOPen'], template: '<div class="convert" />' };
    const ToList = { name: 'ConvertToList', props: ['openSidebar', 'task'], emits: ['closeSidebar'], template: '<div class="to-list" />' };
    const mountSidebars = (mode, data = task()) => mount(TaskMenuSidebars, {
        props: { mode, task: data },
        global: { stubs: { ConvertToSubTaskSidebar: Convert, ConvertToList: ToList } }
    });
    const flags = (wrapper) => {
        const props = wrapper.findComponent(Convert).props();
        return Object.keys(props).filter((key) => props[key] === true && key !== 'closeSideBar');
    };

    it('shows nothing until a mode is picked', () => {
        const wrapper = mountSidebars(null);
        expect(wrapper.find('.convert').exists()).toBe(false);
        expect(wrapper.find('.to-list').exists()).toBe(false);
    });

    it('opens the existing sidebar in the mode the menu item names', () => {
        expect(flags(mountSidebars('convert-subtask'))).toEqual(['isOpenSubTask']);
        expect(flags(mountSidebars('merge'))).toEqual(['isMergeTask']);
        expect(flags(mountSidebars('duplicate'))).toEqual(['isDuplicate']);
        expect(flags(mountSidebars('move'))).toEqual(['isMoveTask']);
        expect(flags(mountSidebars('move', task({ isParentTask: false })))).toEqual(['openMoveSubTask']);
        expect(mountSidebars('merge').findComponent(Convert).props('task')).toMatchObject({ _id: 't1' });
    });

    it('opens Convert to List on its own sidebar', () => {
        const wrapper = mountSidebars('convert-list');
        expect(wrapper.find('.convert').exists()).toBe(false);
        expect(wrapper.findComponent(ToList).props()).toMatchObject({ openSidebar: true, task: { _id: 't1' } });
    });

    it('tells its host when either sidebar closes', () => {
        const merge = mountSidebars('merge');
        merge.findComponent(Convert).vm.$emit('isConvertSubtaskOPen', false);
        expect(merge.emitted('close')).toHaveLength(1);
        const list = mountSidebars('convert-list');
        list.findComponent(ToList).vm.$emit('closeSidebar', false);
        expect(list.emitted('close')).toHaveLength(1);
    });
});
