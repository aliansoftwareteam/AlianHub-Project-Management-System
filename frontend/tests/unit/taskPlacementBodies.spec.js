/* A move, a copy and a conversion name the list and folder a task lands in. The pickers hold the
   stored list and folder with everything on them; the request carries the few values the route reads. */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { defineComponent, h, ref } from 'vue';

const sent = vi.hoisted(() => {
    const pending = () => new Promise(() => {});
    return { moveTask: vi.fn(pending), duplicateTask: vi.fn(pending), convertToTask: vi.fn(pending), convertToList: vi.fn(pending) };
});
const composable = vi.hoisted(() => ({
    useCustomComposable: () => ({ checkPermission: () => true, checkApps: () => true, debounce: (fn) => fn }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id, Employee_Name: 'Max Member', companyOwnerId: 'owner' }) })
}));

vi.mock('@/utils/TaskOperations', () => ({ default: sent }));
vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ status: 200, data: [] })) }));
vi.mock('@/composable', () => composable);
vi.mock('@/composable/commonFunction', () => ({
    taskPlanPermission: () => ({ checkTaskPerSprintPermisssion: () => Promise.resolve(true) }),
    sprintPlanPermission: () => ({ checkPerProjectSprintPermission: () => Promise.resolve(true) })
}));
vi.mock('@/composable/Validation', () => ({ useValidation: () => ({ checkErrors: vi.fn() }) }));
vi.mock('vue-router', () => ({ useRoute: () => ({ name: 'Project', params: { id: 'p1' }, query: {} }), useRouter: () => ({ push: vi.fn() }) }));

import ConvertToSubTaskSidebar from '@/components/molecules/ConvertToSubTaskSidebar/ConvertToSubTaskSidebar.vue';
import ConvertToList from '@/components/molecules/ConvertToList/ConvertToList.vue';

const placement = () => import('@/views/Projects/composables/taskPlacement');

/* A list as GET sprints answers it and the picker keeps it. */
const storedList = (id, extra = {}) => ({
    _id: id, name: `List ${id}`, projectId: 'p1', tasks: 4, archiveTaskCount: 1, private: false, deletedStatusKey: 0,
    AssigneeUserId: ['u1', 'u2'], watchers: { u1: 'all' }, favouriteTasks: [{ userId: 'u1' }], legacyId: 'legacy-1',
    isScrum: false, isBacklog: false, goal: '', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z', ...extra
});
const storedFolder = (id, name) => ({ _id: id, name, projectId: 'p1', deletedStatusKey: 0, parentFolderId: null });

const task = (extra = {}) => ({
    _id: 't1', TaskName: 'Write the brief', TaskKey: 'QAS-16', ProjectID: 'p1', sprintId: 's1', folderObjId: '',
    sprintArray: { id: 's1', name: 'List s1' }, isParentTask: true, ParentTaskId: '', subTasks: 0, AssigneeUserId: ['u1'], watchers: ['u2'], ...extra
});
const project = (extra = {}) => ({
    _id: 'p1', ProjectCode: 'QAS', ProjectName: 'QA Sandbox', isGlobalPermission: true, taskStatusData: [{ key: 1, name: 'To Do' }],
    taskTypeCounts: [{ key: 1, value: 'task' }], projectIcon: { type: 'color', data: 'teal' }, sprintsObj: {}, sprintsfolders: {}, ...extra
});

const PickerRow = defineComponent({
    name: 'SideBarSprintFolderData',
    props: { data: Object },
    emits: ['clickSprint'],
    setup: (props, { emit }) => () => h('div', { class: 'pick', 'data-id': props.data.id || props.data.folderId }, Object.values(props.data.sprintsObj || {}).map((list) => h('button', {
        class: 'pick-inside', 'data-id': list.id, onClick: (event) => { event.stopPropagation(); emit('clickSprint', list); }
    })))
});
const Slots = defineComponent({ name: 'SidebarSlots', setup: (_, { slots }) => () => h('div', [slots['head-right']?.(), slots.body?.()]) });
const Confirm = defineComponent({ name: 'ConfirmationSidebar', emits: ['confirm'], setup: () => () => h('div') });

const provide = (selectedProject) => ({
    $companyId: ref('company-1'), $userId: ref('u1'), $clientWidth: ref(1280), selectedProject: ref(selectedProject), toggleTaskDetail: vi.fn()
});

const openSidebar = async (props, { lists = [storedList('s1'), storedList('s2')], folders = [] } = {}) => {
    const store = createStore({
        getters: {
            'projectData/sprints': () => ({ p1: lists }),
            'projectData/folders': () => ({ p1: folders }),
            'projectData/onlyActiveProjects': () => ({ data: [] }),
            'projectData/tasks': () => ({})
        }
    });
    const wrapper = mount(ConvertToSubTaskSidebar, {
        props: { closeSideBar: true, task: task(), ...props },
        global: {
            plugins: [store],
            provide: provide(project()),
            stubs: { Sidebar: Slots, SideBarSprintFolderData: PickerRow, DuplicateCompo: true, ConfirmationsInTask: true, SpinnerComp: true, WasabiImage: true, InputText: true }
        }
    });
    await flushPromises();
    return wrapper;
};

const press = async (wrapper, selector) => {
    await wrapper.find(selector).trigger('click');
    await flushPromises();
};
const confirm = async (wrapper) => {
    await wrapper.findAll('button.btn-primary')[0].trigger('click');
    await flushPromises();
};

beforeEach(() => {
    Object.values(sent).forEach((spy) => spy.mockClear());
});

describe('the list a task lands in', () => {
    test('is its id and name, with the folder when it sits in one', async () => {
        const { placedSprint } = await placement();

        expect(placedSprint({ ...storedList('s2'), id: 's2', isDuplicateSprint: true, isTaskExpanded: true })).toEqual({ id: 's2', name: 'List s2' });
        expect(placedSprint({ ...storedList('s3', { folderId: 'f1' }), id: 's3', folderName: 'Design', isDuplicateSprint: true }))
            .toEqual({ id: 's3', name: 'List s3', folderId: 'f1', folderName: 'Design' });
    });

    test('keeps the value a task stores of its list and reads a list that only has _id', async () => {
        const { placedSprint } = await placement();

        expect(placedSprint({ id: 's1', name: 'Sprint 1', value: 'sprint_1' })).toEqual({ id: 's1', name: 'Sprint 1', value: 'sprint_1' });
        expect(placedSprint(storedList('s9'))).toEqual({ id: 's9', name: 'List s9' });
    });

    test('never carries the groups a view hangs on it', async () => {
        const { placedSprint } = await placement();
        const grouped = { id: 's1', name: 'Sprint 1', isExpanded: true, items: [{ conditions: [{ statusKey: { $eq: 1 } }], tasksArray: [task()] }] };

        expect(JSON.stringify(placedSprint(grouped))).not.toContain('$');
        expect(placedSprint(grouped)).toEqual({ id: 's1', name: 'Sprint 1' });
    });
});

describe('the folder a new list lands in', () => {
    test('is its id and name, and nothing when none was picked', async () => {
        const { placedFolder } = await placement();
        const node = { folderId: 'f1', id: 'f1', _id: 'f1', name: 'Design', deletedStatusKey: 0, parentFolderId: null, depth: 0, path: 'Design', sprintsObj: { s3: storedList('s3') } };

        expect(placedFolder(node)).toEqual({ folderId: 'f1', name: 'Design' });
        expect(placedFolder({})).toBeNull();
        expect(placedFolder(null)).toBeNull();
    });
});

describe('the move, duplicate and convert sidebar', () => {
    test('a move names the picked list in plain values', async () => {
        const wrapper = await openSidebar({ isMoveTask: true });

        await press(wrapper, '.pick[data-id="s2"]');
        await confirm(wrapper);

        expect(sent.moveTask).toHaveBeenCalledTimes(1);
        expect(sent.moveTask.mock.calls[0][0]).toEqual({
            companyId: 'company-1',
            projectData: { id: 'p1', ProjectCode: 'QAS', ProjectName: 'QA Sandbox' },
            sprintObj: { id: 's2', name: 'List s2' },
            moveTaskId: 't1',
            oldSprintObj: { id: 's1', folderId: null, name: 'List s1', folderName: '' },
            oldProject: { id: 'p1', taskTypeCounts: [{ key: 1, value: 'task' }], taskStatusData: [{ key: 1, name: 'To Do' }], ProjectName: 'QA Sandbox' },
            isSubTask: false,
            assignee: ['u1'],
            watcher: ['u2'],
            userData: { id: 'u1', Employee_Name: 'Max Member', companyOwnerId: 'owner' }
        });
    });

    test('a move into a folder list names the folder too', async () => {
        const wrapper = await openSidebar({ isMoveTask: true }, {
            lists: [storedList('s1'), storedList('s3', { folderId: 'f1' })],
            folders: [storedFolder('f1', 'Design')]
        });

        await press(wrapper, '.pick-inside[data-id="s3"]');
        await confirm(wrapper);

        expect(sent.moveTask.mock.calls[0][0].sprintObj).toEqual({ id: 's3', name: 'List s3', folderId: 'f1', folderName: 'Design' });
    });

    test('a duplicate names the picked list in plain values', async () => {
        const wrapper = await openSidebar({ isDuplicate: true });

        await press(wrapper, '.pick[data-id="s2"]');
        await confirm(wrapper);

        expect(sent.duplicateTask).toHaveBeenCalledTimes(1);
        expect(sent.duplicateTask.mock.calls[0][0]).toMatchObject({
            projectData: { id: 'p1', ProjectCode: 'QAS', ProjectName: 'QA Sandbox' },
            selectedTaskId: 't1',
            oldSprintObj: { folderId: null, name: 'List s1', folderName: '' }
        });
        expect(sent.duplicateTask.mock.calls[0][0].sprintObj).toEqual({ id: 's2', name: 'List s2' });
    });

    test('a subtask made a task names the picked list in plain values', async () => {
        const wrapper = await openSidebar({ isConvertTask: true, task: task({ _id: 't2', isParentTask: false, ParentTaskId: 't1' }) });

        await press(wrapper, '.pick[data-id="s2"]');
        await confirm(wrapper);

        expect(sent.convertToTask).toHaveBeenCalledTimes(1);
        expect(sent.convertToTask.mock.calls[0][0]).toEqual({
            companyId: 'company-1',
            projectData: { id: 'p1' },
            taskId: 't2',
            parentTaskId: 't1',
            sprintObj: { id: 's2', name: 'List s2' },
            oldSprintObj: { id: 's1', folderId: null },
            oldProject: { id: 'p1', taskTypeCounts: [{ key: 1, value: 'task' }], taskStatusData: [{ key: 1, name: 'To Do' }] }
        });
    });
});

describe('convert to list', () => {
    const folderNode = { folderId: 'f1', id: 'f1', _id: 'f1', name: 'Design', deletedStatusKey: 0, parentFolderId: null, sprintsObj: { s3: { ...storedList('s3', { folderId: 'f1' }), id: 's3', folderName: 'Design' } } };

    const openConvert = async (selectedProject) => {
        const store = createStore({ getters: { 'settings/companyOwnerDetail': () => ({ userId: 'owner' }) } });
        const wrapper = mount(ConvertToList, {
            props: { openSidebar: true, task: task() },
            global: { plugins: [store], provide: provide(selectedProject), stubs: { Sidebar: Slots, SideBarSprintFolderData: PickerRow, ConfirmationSidebar: Confirm } }
        });
        await flushPromises();
        return wrapper;
    };
    const accept = async (wrapper) => {
        wrapper.findComponent({ name: 'ConfirmationSidebar' }).vm.$emit('confirm');
        await flushPromises();
    };

    test('names the picked folder by its id and name', async () => {
        const wrapper = await openConvert(project({ sprintsfolders: { f1: folderNode } }));

        await press(wrapper, '.pick[data-id="f1"]');
        await accept(wrapper);

        expect(sent.convertToList).toHaveBeenCalledTimes(1);
        expect(sent.convertToList.mock.calls[0][0]).toEqual({
            companyId: 'company-1',
            projectData: { id: 'p1', ProjectName: 'QA Sandbox' },
            taskId: 't1',
            userData: { id: 'u1', Employee_Name: 'Max Member', companyOwnerId: 'owner' },
            folderData: { folderId: 'f1', name: 'Design' },
            sprintObj: { id: 's1', folderId: null },
            isSubTask: false
        });
    });

    test('names no folder in a project without folders', async () => {
        const wrapper = await openConvert(project());

        await accept(wrapper);

        expect(sent.convertToList.mock.calls[0][0].folderData).toBeNull();
    });
});
