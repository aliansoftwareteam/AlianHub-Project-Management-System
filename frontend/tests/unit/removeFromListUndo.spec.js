import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { h } from 'vue';

const { api, toast } = vi.hoisted(() => ({
    api: { calls: [], answer: null },
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
}));

vi.mock('@/composable/index.js', () => ({ useCustomComposable: () => ({ checkPermission: () => true }) }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id, Employee_Name: 'Max Member' }) })
}));
vi.mock('@/services', () => ({
    apiRequest: vi.fn((method, url, body) => {
        api.calls.push({ method, url, body });
        return api.answer({ method, url, body });
    })
}));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/composable/otherProjectRules', () => ({
    useOtherProjectRules: () => ({ check: (path, project) => (project && project._id ? true : null), load: () => Promise.resolve(), loadAll: () => Promise.resolve() })
}));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/components/molecules/ConvertToSubTaskSidebar/ConvertToSubTaskSidebar.vue', () => ({
    __esModule: true,
    default: { name: 'ConvertToSubTaskSidebar', render: () => h('div') }
}));

import TaskListsRow from '@/components/organisms/TaskDetailOverlay/TaskListsRow.vue';
import { useListRowMenu } from '@/views/Projects/ListView/useListRowMenu';
import { mutateUpdateFirebaseTasks } from '@/store/ProjectData/mutations';
import { dismissUndoToast, runUndo, undoToast } from '@/composable/useUndoToast';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);
const t = i18n.global.t;

const PID = 'p1';
const HOME = 'list-home';
const HERE = 'list-here';
const THIRD = 'list-third';
const HOME_PROJECT = { _id: PID, ProjectName: 'Website', isGlobalPermission: true, statusType: 'active', sprintsObj: { [HOME]: { id: HOME } }, sprintsfolders: {} };

const stored = (sprintId) => ({ projectId: PID, sprintId, addedBy: 'u1', addedAt: '2026-10-01T00:00:00.000Z' });
const named = (sprintId, name) => ({ ...stored(sprintId), name, projectName: 'Website' });
const answer = (lists) => Promise.resolve({ status: 200, data: { status: true, data: { taskId: 't1', extraLists: lists } } });
const writes = () => api.calls.filter((call) => call.method === 'patch').map((call) => call.body);

beforeEach(() => {
    api.calls.length = 0;
    api.answer = ({ method }) => (method === 'get' ? answer([named(HERE, 'Design queue'), named(THIRD, 'Roadmap')]) : answer([]));
    Object.values(toast).forEach((spy) => spy.mockClear());
});
afterEach(() => dismissUndoToast());

describe('the "×" on a list chip in the task panel', () => {
    const task = { _id: 't1', TaskName: 'Landing page', ProjectID: PID, sprintId: HOME, sprintArray: { id: HOME, name: 'Sprint board' }, isParentTask: true, ParentTaskId: '', deletedStatusKey: 0, extraLists: [stored(HERE), stored(THIRD)] };

    async function removeDesignQueue() {
        const wrapper = mount(TaskListsRow, {
            props: { task, project: HOME_PROJECT, homeName: 'Sprint board' },
            global: { plugins: [createStore({ getters: { 'projectData/onlyActiveProjects': () => ({ data: [HOME_PROJECT] }) } })], mocks: { $t: t } }
        });
        await flushPromises();
        api.answer = () => answer([named(THIRD, 'Roadmap')]);
        await wrapper.find(`[data-list="${HERE}"] .ah-detail__list-remove`).trigger('click');
        await flushPromises();
        return wrapper;
    }

    it('removes at once and offers Undo with the same text the chip toasted before', async () => {
        await removeDesignQueue();

        expect(writes()).toEqual([{ action: 'removeFromList', taskId: 't1', sprintId: HERE }]);
        expect(undoToast.current.message).toBe('Removed from Design queue.');
    });

    it('Undo adds the task back to the same list with one call', async () => {
        const wrapper = await removeDesignQueue();
        api.answer = () => answer([named(THIRD, 'Roadmap'), named(HERE, 'Design queue')]);

        await runUndo();
        await flushPromises();

        expect(writes()).toEqual([
            { action: 'removeFromList', taskId: 't1', sprintId: HERE },
            { action: 'addToList', taskId: 't1', sprintId: HERE }
        ]);
        expect(wrapper.find(`[data-list="${HERE}"]`).exists()).toBe(true);
        expect(undoToast.current).toBeNull();
    });
});

describe('"Remove from this list" in the row menu', () => {
    const entry = (sprintId) => stored(sprintId);
    const task = { _id: 't1', TaskName: 'Task t1', ProjectID: PID, sprintId: HOME, sprintArray: { id: HOME, name: 'Sprint board' }, isParentTask: true, ParentTaskId: '', ancestors: [], statusKey: 1, deletedStatusKey: 0, subTasks: 0, extraLists: [entry(HERE), entry(THIRD)] };

    function menuIn(commit) {
        let menu;
        const store = createStore({
            getters: { 'settings/companyOwnerDetail': () => ({}) },
            mutations: { 'projectData/mutateUpdateFirebaseTasks': (_, change) => commit('tasks', change), 'projectData/mutateTypesenseTableTasks': (_, change) => commit('table', change) }
        });
        mount({ setup() { menu = useListRowMenu({ _id: PID, isGlobalPermission: true }, false); return () => null; } }, { global: { plugins: [store], provide: { $userId: { value: 'u1' } } } });
        return menu;
    }

    it('offers Undo with the existing text instead of a plain toast', async () => {
        api.answer = () => answer([named(THIRD, 'Roadmap')]);

        await menuIn(vi.fn()).removeFromList(task, HERE);

        expect(undoToast.current.message).toBe('Removed from this list.');
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('Undo adds the task back to the list on screen with one call and the row returns', async () => {
        const state = { tasks: { [PID]: { projectId: PID, sprints: [HERE], [HERE]: { index: {}, found: {}, tasks: [], snapshot: null } } }, tableTasks: {}, searchedTasks: [] };
        const commit = vi.fn((bucket, change) => { if (bucket === 'tasks') mutateUpdateFirebaseTasks(state, change); });
        api.answer = () => answer([named(THIRD, 'Roadmap')]);
        await menuIn(commit).removeFromList(task, HERE);

        api.answer = () => answer([named(THIRD, 'Roadmap'), named(HERE, 'Design queue')]);
        await runUndo();
        await flushPromises();

        expect(writes()).toEqual([
            { action: 'removeFromList', taskId: 't1', sprintId: HERE },
            { action: 'addToList', taskId: 't1', sprintId: HERE }
        ]);
        expect(state.tasks[PID][HERE].tasks.map((row) => row._id)).toEqual(['t1']);
    });

    it('says why when the Undo is refused', async () => {
        api.answer = () => answer([named(THIRD, 'Roadmap')]);
        await menuIn(vi.fn()).removeFromList(task, HERE);

        api.answer = () => Promise.reject({ response: { status: 403, data: { status: false, code: 'NOT_PERMITTED' } } });
        await runUndo();
        await flushPromises();

        expect(toast.error).toHaveBeenCalledWith(en.TaskLists.refusal_not_permitted, expect.anything());
    });
});
