/* Task 047, tenth sweep — deleting a task from the panel says what happens to the task (not to the
   project), and the panel closes once the task is gone. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { h, ref } from 'vue';
import { readFileSync } from 'fs';
import path from 'path';

const { stub, slots, toast, writes } = vi.hoisted(() => ({
    stub: (name) => ({ default: { name, render: () => null } }),
    slots: (name) => ({ default: { name, render() { return Object.values(this.$slots).map((slot) => slot({})); } } }),
    toast: { success: vi.fn(), error: vi.fn() },
    writes: []
}));

vi.mock('@/utils/TaskOperations', () => ({
    default: { updateArchiveDelete: vi.fn((args) => new Promise((resolve, reject) => writes.push({ args, resolve, reject }))) }
}));
vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ data: {} })) }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true, debounce: (fn) => fn }),
    useGetterFunctions: () => ({ getUser: () => ({ id: 'u1', Employee_Name: 'Olivia Owner', companyOwnerId: 'u1' }) })
}));
vi.mock('@/views/Goals/goalLinking', () => ({ useGoalLinking: () => ({ offered: ref(false), prefetch: vi.fn() }) }));
vi.mock('@/components/molecules/TaskTemplates/taskTemplates', () => ({ openTemplateDialog: vi.fn() }));
vi.mock('@/components/molecules/DropDown/DropDown', () => slots('DropDown'));
vi.mock('@/components/molecules/DropDownOption/DropDownOption', () => ({
    default: { name: 'DropDownOption', render() { return h('button', { type: 'button' }, this.$slots.default?.()); } }
}));
vi.mock('@/components/atom/InputText/InputText.vue', () => stub('InputText'));
vi.mock('@/components/molecules/ConvertToSubTaskSidebar/ConvertToSubTaskSidebar.vue', () => stub('ConvertToSubTaskSidebar'));
vi.mock('@/components/molecules/ConvertToList/ConvertToList.vue', () => stub('ConvertToList'));
vi.mock('@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue', () => stub('WasabiIamgeCompp'));
vi.mock('@/components/atom/SubtaskProgressBadge/SubtaskProgressBadge.vue', () => stub('SubtaskProgressBadge'));
vi.mock('@/components/atom/Skelaton/Skelaton.vue', () => stub('Skelaton'));
vi.mock('@/components/molecules/ConfirmationSidebar/ConfirmationSidebar.vue', () => ({
    default: { name: 'ConfirmationSidebar', props: ['modelValue', 'title', 'message', 'confirmationString', 'acceptButton', 'acceptButtonClass', 'showSpinner'], emits: ['confirm', 'update:modelValue'], render: () => null }
}));

import TaskDetailAction from '@/components/molecules/TaskDetailAction/TaskDetailAction.vue';
import { taskRemovalMessageKey } from '@/utils/taskRemovalWords';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);

const sprint = () => ({ id: 'sprint-1', name: 'List', tasks: 4 });

function open(task = {}) {
    return mount(TaskDetailAction, {
        props: { watchers: [], task: { _id: 'task-1', TaskName: 'Landing page', sprintId: 'sprint-1', isParentTask: true, subTasks: 0, AssigneeUserId: [], ...task } },
        global: {
            plugins: [createStore({
                getters: { 'settings/companyUsers': () => [] },
                mutations: { 'projectData/mutateSprints': () => {} }
            })],
            mocks: { $t: i18n.global.t },
            provide: {
                $userId: ref('u1'), $companyId: ref('company-1'), $clientWidth: ref(1280),
                selectedProject: ref({ _id: 'proj-1', CompanyId: 'company-1', ProjectName: 'Website', isGlobalPermission: true, sprintsObj: { 'sprint-1': sprint() } })
            }
        }
    });
}

const press = (wrapper, label) => wrapper.findAll('button').find((button) => button.text() === label).trigger('click');
const confirmBox = (wrapper) => wrapper.findComponent({ name: 'ConfirmationSidebar' });

beforeEach(() => {
    writes.length = 0;
});

describe('the confirm before a task is deleted or archived', () => {
    it('says the task goes to the Trash and can be restored, with no word of the project', async () => {
        const wrapper = open();
        await press(wrapper, en.Projects.delete);
        expect(confirmBox(wrapper).props('modelValue')).toBe(true);
        expect(confirmBox(wrapper).props('message')).toBe('This task goes to the Trash. You can restore it from there.');
        expect(confirmBox(wrapper).props('message')).not.toMatch(/project|template|erased/i);
        wrapper.unmount();
    });

    it('names the subtasks when the task has some', async () => {
        const wrapper = open({ subTasks: 2 });
        await press(wrapper, en.Projects.delete);
        expect(confirmBox(wrapper).props('message')).toBe('This task and its subtasks go to the Trash. You can restore them from there.');
        wrapper.unmount();
    });

    it('says what archiving a task does, not what archiving a list does', async () => {
        const wrapper = open();
        await press(wrapper, en.Projects.archive);
        expect(confirmBox(wrapper).props('message')).toBe(en.conformationmsg.archive_task);
        expect(en.conformationmsg.archive_task).not.toMatch(/\bA List\b/);
        wrapper.unmount();
    });

    it('uses the same words in the list row, the board card and the dashboard row', () => {
        const read = (file) => readFileSync(path.resolve(__dirname, '../../src', file), 'utf8');
        ['components/organisms/Task/Task.vue', 'views/Projects/Kanban/BoardViewDisplayCardComponent.vue', 'plugins/tasklistDashboard/components/organisms/Task/Task.vue'].forEach((file) => {
            expect(read(file)).toContain('$t(taskRemovalMessageKey(');
            expect(read(file)).not.toContain("$t('conformationmsg.delete')");
        });
        expect(taskRemovalMessageKey({ subTasks: 0 }, false)).toBe('conformationmsg.delete_task');
        expect(taskRemovalMessageKey({ subTasks: 3 }, false)).toBe('conformationmsg.delete_task_with_subtasks');
        expect(taskRemovalMessageKey({ subTasks: 3 }, true)).toBe('conformationmsg.archive_task');
    });
});

describe('the task panel after its task was deleted', () => {
    it('closes, with one message', async () => {
        const wrapper = open();
        await press(wrapper, en.Projects.delete);
        confirmBox(wrapper).vm.$emit('confirm');
        await flushPromises();
        expect(writes).toHaveLength(1);
        expect(writes[0].args.deletedStatusKey).toBe(1);
        expect(wrapper.emitted('close')).toBeUndefined();
        writes[0].resolve({ status: true });
        await flushPromises();
        expect(wrapper.emitted('close')).toHaveLength(1);
        expect(toast.success).toHaveBeenCalledTimes(1);
        expect(toast.success).toHaveBeenCalledWith(en.Toast.Task_deleted_successfully, { position: 'top-right' });
        wrapper.unmount();
    });

    it('stays open and says so when the server refuses the delete', async () => {
        const wrapper = open();
        await press(wrapper, en.Projects.delete);
        confirmBox(wrapper).vm.$emit('confirm');
        await flushPromises();
        writes[0].reject({ status: false, error: { response: { data: { statusText: 'You cannot delete this task.' } } } });
        await flushPromises();
        expect(wrapper.emitted('close')).toBeUndefined();
        expect(toast.error).toHaveBeenCalledWith('You cannot delete this task.', { position: 'top-right' });
        expect(confirmBox(wrapper).props('showSpinner')).toBe(false);
        wrapper.unmount();
    });
});
