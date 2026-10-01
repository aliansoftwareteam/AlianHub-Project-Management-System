/* The task panel's Lists row: the home list first, then each extra list as the server names it for
   this reader, with add and remove shown only to someone the server would let through. The
   permission check here answers only for a project it is handed, as the real one does inside the
   panel, which provides the project and so cannot inject it. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { h, ref } from 'vue';

const { api, toast, rights } = vi.hoisted(() => ({
    api: { lists: [], write: null, calls: [] },
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
    rights: { granted: {}, asked: [], loaded: [] }
}));

vi.mock('@/services', () => ({
    apiRequest: vi.fn((method, url, body) => {
        api.calls.push({ method, url, body });
        if (method === 'get') return Promise.resolve({ status: 200, data: { status: true, data: { taskId: 'task-1', extraLists: api.lists } } });
        return api.write(body);
    })
}));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/composable/otherProjectRules', () => ({
    useOtherProjectRules: () => ({
        check: (path, project) => {
            rights.asked.push({ path, project });
            return project && project._id && (rights.granted[project._id] || []).includes(path) ? true : null;
        },
        load: () => Promise.resolve(),
        loadAll: (projects) => { rights.loaded.push((projects || []).map((project) => project._id)); return Promise.resolve(); }
    })
}));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/components/molecules/ConvertToSubTaskSidebar/ConvertToSubTaskSidebar.vue', () => ({
    __esModule: true,
    default: {
        name: 'ConvertToSubTaskSidebar',
        props: ['task', 'selectedProjectObject', 'projectOptions', 'listPicker', 'isMoveTask', 'isBulkMove'],
        emits: ['bulkMoveConfirm', 'isConvertSubtaskOPen'],
        render: () => h('div', { class: 'picker-stub' })
    }
}));

import TaskListsRow from '@/components/organisms/TaskDetailOverlay/TaskListsRow.vue';
import { REFUSAL_CODES } from '@/components/organisms/TaskDetailOverlay/taskLists';
import { MAX_EXTRA_LISTS, REFUSALS } from '@taskExtraListsRules';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);
const t = i18n.global.t;

const MOVE = 'task.task_move';
const HOME = { _id: 'proj-1', ProjectName: 'Website', isGlobalPermission: true, statusType: 'active', sprintsObj: { 'list-1': { id: 'list-1' } }, sprintsfolders: {} };
const MARKETING = { _id: 'proj-2', ProjectName: 'Marketing', isGlobalPermission: false, statusType: 'active' };
const PERSONAL = { _id: 'proj-3', ProjectName: 'My tasks', isPersonal: true, statusType: 'active' };
const CLOSED = { _id: 'proj-4', ProjectName: 'Old site', statusType: 'close' };
const NO_RIGHTS = { _id: 'proj-5', ProjectName: 'Finance', statusType: 'active' };
const PROJECTS = [HOME, MARKETING, PERSONAL, CLOSED, NO_RIGHTS];

const stored = (projectId, sprintId) => ({ projectId, sprintId, addedBy: 'u1', addedAt: '2026-10-01T00:00:00.000Z' });
const named = (projectId, sprintId, name, projectName) => ({ ...stored(projectId, sprintId), name, projectName });
const SAME_PROJECT = named('proj-1', 'list-2', 'Design queue', 'Website');
const OTHER_PROJECT = named('proj-2', 'list-3', 'Launch plan', 'Marketing');
const HIDDEN = stored('proj-9', 'list-4');

const taskWith = (entries = [], extra = {}) => ({
    _id: 'task-1', TaskName: 'Landing page', ProjectID: 'proj-1', sprintId: 'list-1', sprintArray: { id: 'list-1', name: 'Sprint board' },
    isParentTask: true, ParentTaskId: '', deletedStatusKey: 0, extraLists: entries.map((entry) => stored(entry.projectId, entry.sprintId)), ...extra
});

const store = () => createStore({ getters: { 'projectData/onlyActiveProjects': () => ({ data: PROJECTS }) } });

async function open(task, { provide = {} } = {}) {
    const wrapper = mount(TaskListsRow, {
        props: { task, project: HOME, homeName: 'Sprint board' },
        global: { plugins: [store()], mocks: { $t: t }, provide }
    });
    await flushPromises();
    return wrapper;
}

const chips = (wrapper) => wrapper.findAll('.ah-detail__list-chip')
    .map((chip) => chip.findAll('.ah-detail__list-name, .ah-detail__list-mark').map((part) => part.text()).join(' '));
const chipOf = (wrapper, sprintId) => wrapper.find(`[data-list="${sprintId}"]`);
const reads = () => api.calls.filter((call) => call.method === 'get');
const writes = () => api.calls.filter((call) => call.method === 'patch');
const answer = (lists) => Promise.resolve({ status: 200, data: { status: true, data: { taskId: 'task-1', extraLists: lists } } });
const refuse = (status, body) => Promise.reject({ response: { status, data: { status: false, ...body } } });
async function pick(wrapper, list) {
    await wrapper.find('[data-list-add]').trigger('click');
    await flushPromises();
    const picker = wrapper.findComponent({ name: 'ConvertToSubTaskSidebar' });
    picker.vm.$emit('bulkMoveConfirm', { project: MARKETING, sprint: list });
    await flushPromises();
    return picker;
}

beforeEach(() => {
    api.lists = [];
    api.calls.length = 0;
    api.write = () => answer([]);
    rights.granted = { 'proj-1': [MOVE], 'proj-2': [MOVE] };
    rights.asked.length = 0;
    rights.loaded.length = 0;
    Object.values(toast).forEach((spy) => spy.mockClear());
});

describe('what the row shows', () => {
    it('the home list first, marked as home, then each extra list with its project when that is another one', async () => {
        api.lists = [SAME_PROJECT, OTHER_PROJECT, HIDDEN];

        const wrapper = await open(taskWith(api.lists));

        expect(reads().map((call) => call.url)).toEqual(['/api/v2/tasks/task-1/lists']);
        expect(chips(wrapper)).toEqual(['Sprint board Home', 'Design queue', 'Launch plan Marketing', 'A list you cannot open']);
        expect(wrapper.find('[data-list="home"]').classes()).toContain('ah-detail__list-chip--home');
    });

    it('an entry the server gives no name for has no remove control', async () => {
        api.lists = [SAME_PROJECT, HIDDEN];

        const wrapper = await open(taskWith(api.lists));

        expect(chipOf(wrapper, 'list-2').find('.ah-detail__list-remove').exists()).toBe(true);
        expect(chipOf(wrapper, 'list-4').find('.ah-detail__list-remove').exists()).toBe(false);
        expect(chipOf(wrapper, 'list-4').text()).toBe('A list you cannot open');
    });

    it('asks for no names when the task is in no other list', async () => {
        const wrapper = await open(taskWith());

        expect(reads()).toEqual([]);
        expect(chips(wrapper)).toEqual(['Sprint board Home']);
        expect(wrapper.find('[data-list-add]').text()).toBe('Add to another list');
    });

    it('nothing at all for a subtask', async () => {
        const wrapper = await open(taskWith([], { isParentTask: false, ParentTaskId: 'task-0' }));

        expect(wrapper.find('[data-task-lists]').exists()).toBe(false);
    });
});

describe('adding to another list', () => {
    it('offers projects the person may move tasks in, and lists the task is not in yet', async () => {
        api.lists = [SAME_PROJECT];
        const wrapper = await open(taskWith(api.lists));

        await wrapper.find('[data-list-add]').trigger('click');
        await flushPromises();
        const picker = wrapper.findComponent({ name: 'ConvertToSubTaskSidebar' });
        const { listPicker, projectOptions, selectedProjectObject, isMoveTask, isBulkMove } = picker.props();

        expect([isMoveTask, isBulkMove]).toEqual([true, true]);
        expect(projectOptions.map((project) => project._id)).toEqual(['proj-1', 'proj-2']);
        expect(selectedProjectObject._id).toBe('proj-1');
        expect([listPicker.title, listPicker.confirm]).toEqual(['Add to another list', 'Add']);
        expect(listPicker.note).toContain('Website');
        const offered = (list) => listPicker.offers({ deletedStatusKey: 0, ...list });
        expect(offered({ _id: 'list-9' })).toBe(true);
        expect(offered({ _id: 'list-1' })).toBe(false);
        expect(offered({ _id: 'list-2' })).toBe(false);
        expect(offered({ _id: 'list-9', isScrum: true })).toBe(false);
        expect(offered({ _id: 'list-9', isBacklog: true })).toBe(false);
        expect(offered({ _id: 'list-9', deletedStatusKey: 1 })).toBe(false);
    });

    it('sends addToList and shows the answer without reading again', async () => {
        const wrapper = await open(taskWith());
        api.write = () => answer([OTHER_PROJECT]);

        await pick(wrapper, { _id: 'list-3', name: 'Launch plan' });

        expect(writes().map((call) => [call.url, call.body])).toEqual([['/api/v2/tasks', { action: 'addToList', taskId: 'task-1', sprintId: 'list-3' }]]);
        expect(chips(wrapper)).toEqual(['Sprint board Home', 'Launch plan Marketing']);
        expect(wrapper.emitted('changed')).toEqual([[[stored('proj-2', 'list-3')]]]);
        expect(toast.success).toHaveBeenCalledWith('Added to Launch plan.', expect.anything());

        await wrapper.setProps({ task: taskWith([OTHER_PROJECT]) });
        await flushPromises();
        expect(reads()).toEqual([]);
    });

    it('is not offered once the task is in as many lists as it may be', async () => {
        api.lists = Array.from({ length: MAX_EXTRA_LISTS }, (_, n) => named('proj-1', `list-${n + 10}`, `List ${n}`, 'Website'));

        const wrapper = await open(taskWith(api.lists));

        expect(chips(wrapper)).toHaveLength(MAX_EXTRA_LISTS + 1);
        expect(wrapper.find('[data-list-add]').exists()).toBe(false);
    });
});

describe('removing from a list', () => {
    it('sends removeFromList and drops the chip', async () => {
        api.lists = [SAME_PROJECT, OTHER_PROJECT];
        const wrapper = await open(taskWith(api.lists));
        api.write = () => answer([OTHER_PROJECT]);

        await chipOf(wrapper, 'list-2').find('.ah-detail__list-remove').trigger('click');
        await flushPromises();

        expect(writes().map((call) => call.body)).toEqual([{ action: 'removeFromList', taskId: 'task-1', sprintId: 'list-2' }]);
        expect(chips(wrapper)).toEqual(['Sprint board Home', 'Launch plan Marketing']);
        expect(wrapper.emitted('changed')).toEqual([[[stored('proj-2', 'list-3')]]]);
        expect(toast.success).toHaveBeenCalledWith('Removed from Design queue.', expect.anything());
        expect(chipOf(wrapper, 'list-3').find('.ah-detail__list-remove').attributes('aria-label')).toBe('Remove from Launch plan');
    });
});

describe('a refusal', () => {
    it('has a translated message for every code the server can answer', () => {
        expect(REFUSAL_CODES).toEqual(expect.arrayContaining(Object.keys(REFUSALS)));
        REFUSAL_CODES.forEach((code) => expect(en.TaskLists[`refusal_${code.toLowerCase()}`], code).toEqual(expect.any(String)));
    });

    it.each(REFUSAL_CODES.filter((code) => code !== 'TASK_NOT_FOUND'))('%s is said in words', async (code) => {
        const wrapper = await open(taskWith());
        api.write = () => refuse(400, { statusText: 'server text', code });

        await pick(wrapper, { _id: 'list-3', name: 'Launch plan' });

        expect(toast.error).toHaveBeenCalledWith(t(`TaskLists.refusal_${code.toLowerCase()}`, { max: MAX_EXTRA_LISTS }), expect.anything());
        expect(toast.error.mock.calls[0][0]).not.toMatch(/refusal_|\{max\}|server text/);
        expect(chips(wrapper)).toEqual(['Sprint board Home']);
        expect(wrapper.emitted('changed')).toBeUndefined();
    });

    it('a missing task, which answers with no code, and a code this build does not know', async () => {
        const wrapper = await open(taskWith());

        api.write = () => refuse(404, { statusText: 'Task not found' });
        await pick(wrapper, { _id: 'list-3', name: 'Launch plan' });
        api.write = () => refuse(400, { code: 'SOMETHING_NEW' });
        await pick(wrapper, { _id: 'list-3', name: 'Launch plan' });

        expect(toast.error.mock.calls.map(([message]) => message)).toEqual([en.TaskLists.refusal_task_not_found, en.TaskLists.refusal_unknown]);
    });

    it('that means the lists changed elsewhere reads them again', async () => {
        const wrapper = await open(taskWith());
        api.write = () => refuse(400, { code: 'ALREADY_IN_LIST' });
        api.lists = [OTHER_PROJECT];

        await pick(wrapper, { _id: 'list-3', name: 'Launch plan' });

        expect(reads()).toHaveLength(1);
        expect(chips(wrapper)).toEqual(['Sprint board Home', 'Launch plan Marketing']);
    });
});

describe('who gets the controls', () => {
    it('no add and no remove without the right to move tasks, and no row when there is nothing to show', async () => {
        rights.granted = {};
        api.lists = [SAME_PROJECT, OTHER_PROJECT];

        const withLists = await open(taskWith(api.lists));
        expect(chips(withLists)).toEqual(['Sprint board Home', 'Design queue', 'Launch plan Marketing']);
        expect(withLists.find('[data-list-add]').exists()).toBe(false);
        expect(withLists.findAll('.ah-detail__list-remove')).toHaveLength(0);

        const withNone = await open(taskWith());
        expect(withNone.find('[data-task-lists]').exists()).toBe(false);
    });

    it('the right to move tasks in the list\'s own project is enough to remove that one entry', async () => {
        rights.granted = { 'proj-2': [MOVE] };
        api.lists = [SAME_PROJECT, OTHER_PROJECT];

        const wrapper = await open(taskWith(api.lists));

        expect(chipOf(wrapper, 'list-2').find('.ah-detail__list-remove').exists()).toBe(false);
        expect(chipOf(wrapper, 'list-3').find('.ah-detail__list-remove').exists()).toBe(true);
        expect(wrapper.find('[data-list-add]').exists()).toBe(false);
    });

    it('no add for an archived task or a task in a personal or closed project', async () => {
        const archived = await open(taskWith([], { deletedStatusKey: 2 }));
        expect(archived.find('[data-list-add]').exists()).toBe(false);

        for (const home of [{ ...HOME, isPersonal: true }, { ...HOME, statusType: 'close' }]) {
            const wrapper = mount(TaskListsRow, { props: { task: taskWith(), project: home, homeName: 'Sprint board' }, global: { plugins: [store()], mocks: { $t: t } } });
            await flushPromises();
            expect(wrapper.find('[data-list-add]').exists()).toBe(false);
        }
    });

    it('is judged on the project the row is handed, whatever project the page around it provides', async () => {
        const wrapper = await open(taskWith(), { provide: { selectedProject: ref(NO_RIGHTS) } });

        expect(wrapper.find('[data-list-add]').exists()).toBe(true);
        expect(rights.asked.length).toBeGreaterThan(0);
        rights.asked.forEach(({ project }) => expect(project && project._id).toBeTruthy());
        expect(rights.asked.some(({ project }) => project._id === 'proj-5')).toBe(false);
        expect(rights.loaded[0]).toEqual(['proj-1']);
    });
});

describe('keeping up with the task', () => {
    it('reads the names again when the task\'s update brings other lists, and only then', async () => {
        api.lists = [SAME_PROJECT];
        const wrapper = await open(taskWith(api.lists));
        expect(reads()).toHaveLength(1);

        await wrapper.setProps({ task: taskWith([SAME_PROJECT], { TaskName: 'Renamed' }) });
        await flushPromises();
        expect(reads()).toHaveLength(1);

        api.lists = [SAME_PROJECT, OTHER_PROJECT];
        await wrapper.setProps({ task: taskWith(api.lists) });
        await flushPromises();
        expect(reads()).toHaveLength(2);
        expect(chips(wrapper)).toEqual(['Sprint board Home', 'Design queue', 'Launch plan Marketing']);

        await wrapper.setProps({ task: taskWith([]) });
        await flushPromises();
        expect(reads()).toHaveLength(2);
        expect(chips(wrapper)).toEqual(['Sprint board Home']);
    });
});
