/* The move sidebar as a plain list picker ("Add to another list"), and what it says before a task
   that is in other lists becomes a subtask. The sidebar is the real one; only its shell and rows are stubbed. */
import { describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { defineComponent, h, ref } from 'vue';

vi.mock('@/utils/TaskOperations', () => ({ default: {} }));
vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ status: 200, data: { status: true, data: [] } })) }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true, checkApps: () => true, debounce: (fn) => fn }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id, Employee_Name: 'Max Member' }) })
}));
vi.mock('@/composable/commonFunction', () => ({ taskPlanPermission: () => ({ checkTaskPerSprintPermisssion: () => Promise.resolve(true) }) }));
vi.mock('@/composable/Validation', () => ({ useValidation: () => ({ checkErrors: vi.fn() }) }));
vi.mock('vue-router', () => ({ useRoute: () => ({ name: 'Project', params: { id: 'p1' }, query: {} }), useRouter: () => ({ push: vi.fn() }) }));

import ConvertToSubTaskSidebar from '@/components/molecules/ConvertToSubTaskSidebar/ConvertToSubTaskSidebar.vue';
import { offersList } from '@/components/organisms/TaskDetailOverlay/taskLists';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);

const list = (id, extra = {}) => ({ _id: id, name: `List ${id}`, projectId: 'p1', private: false, deletedStatusKey: 0, AssigneeUserId: [], ...extra });
const LISTS = [list('s1'), list('s2'), list('s3'), list('s4', { isScrum: true }), list('s5', { isBacklog: true }), list('s6', { folderId: 'f1' }), list('s7', { folderId: 'f1' })];
const FOLDERS = [{ _id: 'f1', name: 'Quarter', projectId: 'p1', deletedStatusKey: 0 }];
const TASK = { _id: 't1', TaskName: 'Write the brief', ProjectID: 'p1', sprintId: 's1', sprintArray: { id: 's1', name: 'List s1' }, isParentTask: true, ParentTaskId: '', AssigneeUserId: [], watchers: [] };
const IN_LISTS = [{ projectId: 'p1', sprintId: 's3' }, { projectId: 'p1', sprintId: 's7' }];
const project = () => ({ _id: 'p1', ProjectName: 'QA Sandbox', ProjectCode: 'QAS', isGlobalPermission: true, projectIcon: { type: 'color', data: 'teal' }, sprintsObj: {}, sprintsfolders: {} });

const PickerRow = defineComponent({
    name: 'SideBarSprintFolderData',
    props: { data: Object },
    setup: (props) => () => h('div', { class: 'pick', 'data-id': props.data.id, 'data-inside': Object.keys(props.data.sprintsObj || {}).join(',') })
});
const Shell = defineComponent({
    name: 'SidebarShell',
    props: { title: String },
    setup: (props, { slots }) => () => h('div', [h('h2', { class: 'shell-title' }, props.title), slots['head-right']?.(), slots.body?.()])
});

const store = () => createStore({
    getters: {
        'projectData/sprints': () => ({ p1: LISTS.map((item) => ({ ...item })) }),
        'projectData/folders': () => ({ p1: FOLDERS.map((item) => ({ ...item })) }),
        'projectData/onlyActiveProjects': () => ({ data: [project()] }),
        'projectData/tasks': () => ({}),
        'settings/companyUsers': () => [],
        'settings/rules': () => ({}),
        'settings/companyOwnerDetail': () => ({ userId: 'owner' })
    }
});

async function open(props) {
    const wrapper = mount(ConvertToSubTaskSidebar, {
        props: { closeSideBar: true, task: TASK, ...props },
        global: {
            plugins: [store()],
            mocks: { $t: i18n.global.t },
            provide: { $companyId: ref('company-1'), $userId: ref('u1'), $clientWidth: ref(1280), selectedProject: ref(project()), toggleTaskDetail: vi.fn() },
            stubs: { Sidebar: Shell, SideBarSprintFolderData: PickerRow, ConfirmationsInTask: true, SpinnerComp: true, WasabiImage: true, InputText: true, DuplicateCompo: true }
        }
    });
    await flushPromises();
    return wrapper;
}

const picker = (extra = {}) => ({
    isMoveTask: true,
    isBulkMove: true,
    selectedProjectObject: project(),
    projectOptions: [project()],
    listPicker: { title: 'Add to another list', confirm: 'Add', note: 'Only people who can open QA Sandbox will see it there.', offers: offersList(TASK, IN_LISTS) },
    ...extra
});

describe('the move sidebar as a list picker', () => {
    it('carries its own title, confirm label and note', async () => {
        const wrapper = await open(picker());

        expect(wrapper.find('.shell-title').text()).toBe('Add to another list');
        expect(wrapper.find('.convert__picker-note').text()).toBe('Only people who can open QA Sandbox will see it there.');
        expect(wrapper.findAll('button').map((button) => button.text())).toEqual(expect.arrayContaining(['Add']));
        expect(wrapper.text()).not.toContain(en.ProjectDetails.move);
    });

    it('offers neither the home list, a list the task is in, a Scrum sprint nor a backlog, in or out of a folder', async () => {
        const wrapper = await open(picker());

        const rows = wrapper.findAll('.pick').map((row) => [row.attributes('data-id'), row.attributes('data-inside')]);
        expect(rows).toEqual([['f1', 's6'], ['s2', '']]);
    });

    it('writes the lists it offers onto a copy, never onto the project it was handed or one it browses to', async () => {
        const handed = project();
        const other = { ...project(), sprintsObj: { kept: { id: 'kept' } } };
        const wrapper = await open(picker({ selectedProjectObject: handed, projectOptions: [other] }));

        await wrapper.vm.$.setupState.changeProject(other);
        await flushPromises();

        expect(wrapper.findAll('.pick').map((row) => row.attributes('data-id'))).toEqual(['f1', 's2']);
        expect(handed.sprintsObj).toEqual({});
        expect(other.sprintsObj).toEqual({ kept: { id: 'kept' } });
    });

    it('hands back the chosen list and closes', async () => {
        const wrapper = await open(picker());

        await wrapper.find('.pick[data-id="s2"]').trigger('click');
        await flushPromises();
        await wrapper.findAll('button.ah-btn--primary')[0].trigger('click');
        await flushPromises();

        const [[picked]] = wrapper.emitted('bulkMoveConfirm');
        expect([picked.project._id, picked.sprint._id]).toEqual(['p1', 's2']);
        expect(wrapper.emitted('isConvertSubtaskOPen')).toEqual([[false]]);
    });

    it('a plain move keeps its own words and offers every other list', async () => {
        const wrapper = await open({ isMoveTask: true, isBulkMove: true, selectedProjectObject: project(), projectOptions: [project()] });

        expect(wrapper.find('.shell-title').text()).toBe(en.DuplicateTask.move_task);
        expect(wrapper.find('.convert__picker-note').exists()).toBe(false);
        expect(wrapper.findAll('.pick').map((row) => row.attributes('data-id'))).toEqual(['f1', 's2', 's3', 's4', 's5']);
    });
});

describe('converting a task to a subtask', () => {
    it('says the task leaves its other lists, and only when it is in any', async () => {
        const inLists = await open({ isOpenSubTask: true, task: { ...TASK, extraLists: IN_LISTS } });
        const inNone = await open({ isOpenSubTask: true });

        expect(inLists.text()).toContain(en.TaskLists.convert_note);
        expect(inNone.text()).not.toContain(en.TaskLists.convert_note);
    });
});
