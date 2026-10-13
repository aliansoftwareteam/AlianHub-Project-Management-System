/* The duplicate options show which of a task's people come along to the place the copy lands in.
   The request has to name those people, not everyone on the original. */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { defineComponent, h, ref } from 'vue';

const sent = vi.hoisted(() => {
    const pending = () => new Promise(() => {});
    return { duplicateTask: vi.fn(pending) };
});
const posted = vi.hoisted(() => ({ apiRequest: vi.fn(() => Promise.resolve({ status: 200, data: { status: true, data: { newTaskIds: [] } } })) }));
const composable = vi.hoisted(() => ({
    useCustomComposable: () => ({ checkPermission: () => true, checkApps: () => true, debounce: (fn) => fn }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id, Employee_Name: 'Max Member', companyOwnerId: 'owner' }) })
}));

vi.mock('@/utils/TaskOperations', () => ({ default: sent }));
vi.mock('@/services', () => posted);
vi.mock('@/composable', () => composable);
vi.mock('@/composable/commonFunction', () => ({ taskPlanPermission: () => ({ checkTaskPerSprintPermisssion: () => Promise.resolve(true) }) }));
vi.mock('@/composable/Validation', () => ({ useValidation: () => ({ checkErrors: vi.fn() }) }));
vi.mock('@/composable/useUndoToast', () => ({ showUndoToast: vi.fn() }));
vi.mock('vue-router', () => ({ useRoute: () => ({ name: 'Project', params: { id: 'p1' }, query: {} }), useRouter: () => ({ push: vi.fn() }) }));

import ConvertToSubTaskSidebar from '@/components/molecules/ConvertToSubTaskSidebar/ConvertToSubTaskSidebar.vue';
import { useListRowMenu } from '@/views/Projects/ListView/useListRowMenu';

const MEMBER = 3;
const ADMIN = 2;
const seat = (userId, roleType = MEMBER, extra = {}) => ({ userId, roleType, status: 2, isDelete: false, ...extra });
const person = (id) => ({ _id: id, Employee_Name: `Person ${id}` });

const SEATS = [seat('u1'), seat('u2'), seat('u3'), seat('u4'), seat('u5', ADMIN), seat('gone', MEMBER, { status: 3 })];
const PEOPLE = ['u1', 'u2', 'u3', 'u4', 'u5', 'gone'].map(person);

const list = (id, extra = {}) => ({ _id: id, name: `List ${id}`, projectId: 'p1', tasks: 4, private: false, deletedStatusKey: 0, AssigneeUserId: [], ...extra });
const task = (extra = {}) => ({
    _id: 't1', TaskName: 'Write the brief', TaskKey: 'QAS-16', ProjectID: 'p1', sprintId: 's1', folderObjId: '',
    sprintArray: { id: 's1', name: 'List s1' }, isParentTask: true, ParentTaskId: '', subTasks: 0,
    AssigneeUserId: ['u1', 'u2', 'u3'], watchers: ['u2', 'u4'], ...extra
});
const project = (extra = {}) => ({
    _id: 'p1', ProjectCode: 'QAS', ProjectName: 'QA Sandbox', isGlobalPermission: true, isPrivateSpace: true, AssigneeUserId: ['u1', 'u2'],
    taskStatusData: [{ key: 1, name: 'To Do' }], taskTypeCounts: [{ key: 1, value: 'task' }], projectIcon: { type: 'color', data: 'teal' },
    sprintsObj: {}, sprintsfolders: {}, ...extra
});

const PickerRow = defineComponent({
    name: 'SideBarSprintFolderData',
    props: { data: Object },
    setup: (props) => () => h('div', { class: 'pick', 'data-id': props.data.id })
});
const Slots = defineComponent({ name: 'SidebarSlots', setup: (_, { slots }) => () => h('div', [slots['head-right']?.(), slots.body?.()]) });
const Tick = defineComponent({
    name: 'CheckboxComponent',
    props: { modelValue: Boolean },
    emits: ['update:modelValue', 'change'],
    setup: (props, { emit }) => () => h('input', {
        type: 'checkbox', class: 'tick', checked: props.modelValue,
        onChange: (event) => { emit('update:modelValue', event.target.checked); emit('change', event); }
    })
});

const storeFor = (lists) => createStore({
    getters: {
        'projectData/sprints': () => ({ p1: lists }),
        'projectData/folders': () => ({ p1: [] }),
        'projectData/onlyActiveProjects': () => ({ data: [] }),
        'projectData/tasks': () => ({}),
        'users/users': () => PEOPLE,
        'settings/companyUsers': () => SEATS,
        'settings/teams': () => [],
        'settings/rules': () => ({}),
        'settings/companyOwnerDetail': () => ({ userId: 'owner' })
    }
});

const openDuplicate = async ({ shown = project(), original = task(), lists = [list('s1'), list('s2')] } = {}) => {
    const wrapper = mount(ConvertToSubTaskSidebar, {
        props: { closeSideBar: true, isDuplicate: true, task: original },
        global: {
            plugins: [storeFor(lists)],
            provide: { $companyId: ref('company-1'), $userId: ref('u1'), $clientWidth: ref(1280), $defaultUserAvatar: 'avatar.png', selectedProject: ref(shown), toggleTaskDetail: vi.fn() },
            stubs: {
                Sidebar: Slots, SideBarSprintFolderData: PickerRow, CheckboxComponent: Tick, ConfirmationsInTask: true, SpinnerComp: true,
                WasabiImage: true, InputText: true, UserProfile: true, DropDown: true, DropDownOption: true
            }
        }
    });
    await flushPromises();
    return wrapper;
};

const tickEverything = async (wrapper) => {
    await wrapper.findAll('input.tick')[0].setValue(true);
    await flushPromises();
};
const duplicateInto = async (wrapper, listId) => {
    await wrapper.find(`.pick[data-id="${listId}"]`).trigger('click');
    await flushPromises();
    await wrapper.findAll('button.ah-btn--primary')[0].trigger('click');
    await flushPromises();
    return sent.duplicateTask.mock.calls[0][0];
};

beforeEach(() => {
    sent.duplicateTask.mockClear();
    posted.apiRequest.mockClear();
});

describe('the duplicate sidebar', () => {
    test('names the two assignees and the one watcher the options show for a private project', async () => {
        const wrapper = await openDuplicate();

        await tickEverything(wrapper);
        const body = await duplicateInto(wrapper, 's2');

        expect(body.duplicateData).toEqual(expect.arrayContaining(['Copy Assignees', 'Copy Watchers']));
        expect(body.assignee).toEqual(['u1', 'u2']);
        expect(body.watcher).toEqual(['u2']);
    });

    test('keeps an admin who is not on the private project, and leaves out someone whose seat ended', async () => {
        const wrapper = await openDuplicate({ original: task({ AssigneeUserId: ['u1', 'u5', 'gone'], watchers: ['u5', 'gone'] }) });

        await tickEverything(wrapper);
        const body = await duplicateInto(wrapper, 's2');

        expect(body.assignee).toEqual(['u1', 'u5']);
        expect(body.watcher).toEqual(['u5']);
    });

    test('names every active person on the task for a public project', async () => {
        const wrapper = await openDuplicate({ shown: project({ isPrivateSpace: false, AssigneeUserId: [] }), original: task({ AssigneeUserId: ['u1', 'u3', 'gone'] }) });

        await tickEverything(wrapper);
        const body = await duplicateInto(wrapper, 's2');

        expect(body.assignee).toEqual(['u1', 'u3']);
        expect(body.watcher).toEqual(['u2', 'u4']);
    });

    test('narrows to the people of a private list', async () => {
        const wrapper = await openDuplicate({ lists: [list('s1'), list('s2', { private: true, AssigneeUserId: ['u2'] })] });

        await tickEverything(wrapper);
        const body = await duplicateInto(wrapper, 's2');

        expect(body.assignee).toEqual(['u2']);
        expect(body.watcher).toEqual(['u2']);
    });
});

describe('duplicate from the row menu', () => {
    const Host = (shown) => defineComponent({
        setup(_, { expose }) {
            expose(useListRowMenu(ref(shown), ref(false)));
            return () => h('div');
        }
    });

    test('names the people on the task who can open the project', async () => {
        const shown = project({ sprintsObj: { s1: { id: 's1', name: 'List s1' } } });
        const wrapper = mount(Host(shown), { global: { plugins: [storeFor([])], provide: { $userId: ref('u1') } } });

        await wrapper.vm.duplicate(task({ AssigneeUserId: ['u1', 'u3', 'gone'], watchers: ['u2', 'u4'] }));
        await flushPromises();

        const body = posted.apiRequest.mock.calls[0][2];
        expect(body.action).toBe('bulkDuplicate');
        expect(body.assignee).toEqual(['u1']);
        expect(body.watcher).toEqual(['u2']);
    });
});
