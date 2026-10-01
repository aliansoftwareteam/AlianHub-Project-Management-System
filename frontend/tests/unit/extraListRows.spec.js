/* A list shows the tasks that live in it and the tasks added to it. The store keeps a row while
   the list on screen is still one of the task's lists, a person's own edit reaches the row they are
   looking at, the queries ask the server for the list by name, and the row says where it lives. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { readFileSync } from 'fs';
import path from 'path';

const { sent, toast, groupWrites } = vi.hoisted(() => ({
    sent: { calls: [], answer: null },
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
    groupWrites: []
}));

vi.mock('@/composable/index.js', () => ({ useCustomComposable: () => ({ checkPermission: () => true }) }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id, Employee_Name: 'Max Member' }) })
}));
vi.mock('@/services', () => ({
    apiRequest: vi.fn((method, url, body) => {
        sent.calls.push({ method, url, body });
        return sent.answer ? sent.answer({ method, url, body }) : Promise.resolve({ status: 200, data: [{ result: [], count: [] }] });
    })
}));
vi.mock('../../src/services/index', async () => import('@/services'));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/composable/useUndoToast', () => ({ showUndoToast: vi.fn() }));
vi.mock('@/views/Projects/helper.js', () => ({
    useUpdateTasks: () => ({ updateTaskByGroup: (...args) => { groupWrites.push(args); return Promise.resolve(); } })
}));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import { mutateTypesenseTableTasks, mutateUpdateFirebaseTasks } from '@/store/ProjectData/mutations';
import { getPaginatedTasks, refreshGroupCounts, setTableTasksFromTypesense } from '@/store/ProjectData/actions';
import { homeListOf, isStranger, leftList, shownInList } from '@/store/ProjectData/listMembership';
import { homeMarkText, homeOf, isAddedRow, putBack } from '@/views/Projects/composables/taskHomeMark';
import { listSourceTasks } from '@/views/Projects/ListView/listFilter';
import { taskMenuItems, taskMenuRights } from '@/views/Projects/composables/taskMenu';
import { placementActions } from '@/views/Projects/ListView/bulkPlacement';
import { useListDragDrop } from '@/views/Projects/ListView/useListDragDrop';
import { useListRowMenu } from '@/views/Projects/ListView/useListRowMenu';
import { offersAnyTask } from '@/components/organisms/TaskDetailOverlay/taskLists';
import TaskHomeMark from '@/views/Projects/components/TaskHomeMark.vue';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);
const t = i18n.global.t;

const PID = 'p1';
const OTHER_PROJECT = 'p2';
const HOME = 'list-home';
const HERE = 'list-here';
const THIRD = 'list-third';

const entry = (sprintId, projectId = PID) => ({ projectId, sprintId, addedBy: 'u1', addedAt: '2026-10-01T00:00:00.000Z' });
const task = (id, over = {}) => ({
    _id: id, TaskName: `Task ${id}`, ProjectID: PID, sprintId: HOME, sprintArray: { id: HOME, name: 'Sprint board' },
    isParentTask: true, ParentTaskId: '', ancestors: [], statusKey: 1, deletedStatusKey: 0, subTasks: 0, ...over
});
const added = (id, over = {}) => task(id, { extraLists: [entry(HERE)], ...over });
const sub = (id, parentId, over = {}) => task(id, { isParentTask: false, ParentTaskId: parentId, ancestors: [parentId], ...over });

let state;
const bucketOf = (sprintId) => ({ index: {}, found: {}, tasks: [], snapshot: null, ...sprintId });
const seed = (buckets) => {
    state = {
        tasks: { [PID]: { projectId: PID, sprints: Object.keys(buckets), ...Object.fromEntries(Object.entries(buckets).map(([id, rows]) => [id, bucketOf({ tasks: rows })])) } },
        tableTasks: {},
        searchedTasks: []
    };
};
const ids = (sprintId) => state.tasks[PID][sprintId].tasks.map((row) => row._id);
const row = (sprintId, id) => state.tasks[PID][sprintId].tasks.find((item) => item._id === id);
const fromServer = (sprintId, data, updatedFields = {}) => mutateUpdateFirebaseTasks(state, { snap: {}, op: 'modified', pid: PID, sprintId, data: { ...data }, updatedFields });
const ownEdit = (data, updatedFields) => mutateUpdateFirebaseTasks(state, { snap: null, op: 'modified', pid: String(data.ProjectID), sprintId: String(data.sprintId), data: { ...data, ...updatedFields }, updatedFields });

beforeEach(() => {
    sent.calls.length = 0;
    sent.answer = null;
    groupWrites.length = 0;
    Object.values(toast).forEach((spy) => spy.mockClear());
    seed({ [HERE]: [added('t1'), task('t2', { sprintId: HERE })] });
});

describe('which rows a list shows', () => {
    it('its own tasks, and the tasks of its project that were added to it', () => {
        expect(shownInList(task('a', { sprintId: HERE }), PID, HERE)).toBe(true);
        expect(shownInList(added('a'), PID, HERE)).toBe(true);
        expect(shownInList(task('a'), PID, HERE)).toBe(false);
        expect(shownInList(added('a', { extraLists: [entry(THIRD)] }), PID, HERE)).toBe(false);
        expect(shownInList(added('a', { ProjectID: OTHER_PROJECT }), PID, HERE)).toBe(false);
    });

    it('a subtask sits where its parent does, and a payload that names no list says nothing', () => {
        expect(shownInList(sub('a', 't1'), PID, HERE)).toBe(true);
        expect(shownInList({ _id: 'a', watchers: [] }, PID, HERE)).toBe(true);
    });

    it('a row leaves when the list stops being its home or one of its lists', () => {
        expect(leftList(task('a', { sprintId: THIRD }), PID, HERE, { sprintId: THIRD })).toBe(true);
        expect(leftList(task('a', { sprintId: THIRD, extraLists: [entry(HERE)] }), PID, HERE, { sprintId: THIRD })).toBe(false);
        expect(leftList(task('a', { extraLists: [] }), PID, HERE, { extraLists: [] })).toBe(true);
        expect(leftList(added('a'), PID, HERE, { extraLists: [entry(HERE)] })).toBe(false);
        expect(leftList(task('a', { sprintId: HERE }), PID, HERE, { sprintId: HERE })).toBe(false);
        expect(leftList(task('a'), PID, HERE, { statusKey: 2 })).toBe(false);
        expect(leftList(sub('a', 't1', { sprintId: THIRD }), PID, HERE, { sprintId: THIRD })).toBe(true);
        expect(leftList(sub('a', 't1'), PID, HERE, { statusKey: 2 })).toBe(false);
    });

    it('a task of another project that reaches the list is a stranger to it', () => {
        expect(isStranger(state.tasks[PID][HERE], added('x', { ProjectID: OTHER_PROJECT }), PID, HERE)).toBe(true);
        expect(isStranger(state.tasks[PID][HERE], added('t1', { extraLists: [] }), PID, HERE)).toBe(false);
        expect(isStranger(state.tasks[PID][HERE], added('x'), PID, HERE)).toBe(false);
    });
});

describe('the store, on a change from the server', () => {
    it('keeps a row whose home moved while the list on screen is still one of its lists', () => {
        fromServer(HERE, added('t1', { sprintId: THIRD }), { sprintId: THIRD });

        expect(ids(HERE)).toEqual(['t1', 't2']);
        expect(row(HERE, 't1').sprintId).toBe(THIRD);
    });

    it('drops a row whose home moved elsewhere, as before', () => {
        fromServer(HERE, task('t2', { sprintId: THIRD }), { sprintId: THIRD });

        expect(ids(HERE)).toEqual(['t1']);
    });

    it('drops a row taken out of the list, and raises the count marker', () => {
        state.tasks[PID].groupBy = { type: 0, items: [] };

        fromServer(HERE, task('t1', { extraLists: [] }), { extraLists: [] });

        expect(ids(HERE)).toEqual(['t2']);
        expect(state.tasks[PID][HERE].countsStale).toBe(1);
    });

    it('takes in a task that was just added to the list', () => {
        fromServer(HERE, added('t9', { TaskName: 'New here' }), { extraLists: [entry(HERE)] });

        expect(ids(HERE)).toEqual(['t1', 't2', 't9']);
    });

    it('takes in nothing of a task of another project, and leaves the counts alone', () => {
        state.tasks[PID].groupBy = { type: 0, items: [{ key: 'statusKey_2', value: 2 }] };

        fromServer(HERE, added('x', { ProjectID: OTHER_PROJECT, statusKey: 2 }), { statusKey: 2 });

        expect(ids(HERE)).toEqual(['t1', 't2']);
        expect(state.tasks[PID][HERE].found).toEqual({});
        expect(state.tasks[PID][HERE].countsStale).toBeUndefined();
    });

    it('updates an added row like any other', () => {
        fromServer(HERE, added('t1', { TaskName: 'Renamed' }), { TaskName: 'Renamed' });

        expect(row(HERE, 't1').TaskName).toBe('Renamed');
    });
});

describe('a person\'s own edit', () => {
    it('reaches the row in the list on screen though it is written for the task\'s home', () => {
        ownEdit(added('t1'), { statusKey: 3 });

        expect(row(HERE, 't1').statusKey).toBe(3);
    });

    it('reaches both buckets when the home list is loaded too', () => {
        seed({ [HERE]: [added('t1')], [HOME]: [added('t1')] });

        ownEdit(added('t1'), { TaskName: 'Renamed' });

        expect([row(HERE, 't1').TaskName, row(HOME, 't1').TaskName]).toEqual(['Renamed', 'Renamed']);
    });

    it('reaches a subtask shown under an added task', () => {
        seed({ [HERE]: [added('t1', { subTasks: 1, subtaskArray: [sub('s1', 't1')] })] });

        ownEdit(sub('s1', 't1'), { statusKey: 3 });

        expect(row(HERE, 't1').subtaskArray[0].statusKey).toBe(3);
    });

    it('with only the changed field still finds the row', () => {
        mutateUpdateFirebaseTasks(state, { snap: null, op: 'modified', pid: PID, sprintId: HOME, data: { _id: 't1', watchers: ['u2'] }, updatedFields: { watchers: ['u2'] } });

        expect(row(HERE, 't1').watchers).toEqual(['u2']);
        expect(row(HERE, 't1').TaskName).toBe('Task t1');
    });

    it('takes a stale copy out of a list that no longer shows the task', () => {
        seed({ [HERE]: [task('t1', { sprintId: HERE })], [HOME]: [task('t1')] });

        ownEdit(task('t1'), { statusKey: 3 });

        expect(ids(HERE)).toEqual([]);
        expect(row(HOME, 't1').statusKey).toBe(3);
    });
});

describe('the Table\'s rows', () => {
    const table = (rows) => { state.tableTasks = { [PID]: { projectId: PID, sprints: [HERE], [HERE]: { index: {}, tasks: rows, total: 0, snapshot: null } } }; };
    const tableIds = () => state.tableTasks[PID][HERE].tasks.map((item) => item._id);
    const event = (data) => mutateTypesenseTableTasks(state, { snap: {}, op: 'modified', pid: PID, sprintId: HERE, data });

    beforeEach(() => table([added('t1'), task('t2', { sprintId: HERE })]));

    it('drop a row taken out of the list, and one whose home moved away', () => {
        event(task('t1', { extraLists: [] }));
        event(task('t2', { sprintId: THIRD }));

        expect(tableIds()).toEqual([]);
    });

    it('take in a task added to the list, and nothing of another project', () => {
        event(added('t9'));
        event(added('x', { ProjectID: OTHER_PROJECT }));

        expect(tableIds()).toEqual(['t1', 't2', 't9']);
    });

    it('a page the Table asked for is taken as it comes', () => {
        mutateTypesenseTableTasks(state, { pid: PID, sprintId: HERE, data: added('t8'), nextPage: {} });

        expect(tableIds()).toEqual(['t1', 't2', 't8']);
    });
});

describe('the queries', () => {
    const item = { searchKey: 'statusKey', searchValue: 1, indexName: 'groupByStatusIndex', conditions: [{ statusKey: 1 }] };
    const commit = vi.fn();
    const lastBody = () => sent.calls[sent.calls.length - 1].body;

    it('a page of a list names the list, so the server adds the tasks added to it', async () => {
        await getPaginatedTasks({ state: { tasks: {} }, commit }, { pid: PID, sprintId: HERE, item, fetchNew: true });

        expect(lastBody().inList).toBe(HERE);
        expect(lastBody().findQuery[0].$match).toMatchObject({ objId: { sprintId: HERE, ProjectID: PID }, isParentTask: true });
    });

    it('the subtasks of an added task are read where that task lives, without the list', async () => {
        await getPaginatedTasks({ state, commit }, { pid: PID, sprintId: HERE, item, fetchNew: true, parentId: 't1' });

        expect(lastBody()).not.toHaveProperty('inList');
        expect(lastBody().findQuery[0].$match).toMatchObject({ objId: { sprintId: HOME, ProjectID: PID }, ParentTaskId: 't1' });
        expect(homeListOf(state, PID, HERE, 't2')).toBe(HERE);
        expect(homeListOf(state, PID, HERE, 'unknown')).toBe(HERE);
    });

    it('the group counts and the Table name the list too', async () => {
        await refreshGroupCounts({ state, commit }, { pid: PID, sprintId: HERE, items: [item] });
        expect(lastBody().inList).toBe(HERE);

        sent.answer = () => Promise.resolve({ status: 200, data: [] });
        await setTableTasksFromTypesense({ state: { tableTasks: {} }, commit, rootGetters: {} }, { pid: PID, sprintId: HERE, item, fetchNew: true });
        expect(lastBody().inList).toBe(HERE);
    });
});

describe('the mark on a row shown in a list it was added to', () => {
    const projects = [{ _id: PID, ProjectName: 'Website' }, { _id: OTHER_PROJECT, ProjectName: 'Marketing' }];
    const list = { sprintId: HERE, projectId: PID };
    const mark = (row, known = projects) => homeMarkText(homeOf(row, list, known), t);

    it('names the list the task lives in', () => {
        expect(mark(added('t1'))).toEqual({ name: 'Sprint board', title: 'Lives in Sprint board' });
    });

    it('is not there for a task that lives in the list, a subtask, or a view with no list', () => {
        expect(mark(task('t2', { sprintId: HERE }))).toBeNull();
        expect(mark(sub('s1', 't1'))).toBeNull();
        expect(homeMarkText(homeOf(added('t1'), null, projects), t)).toBeNull();
        expect(isAddedRow(added('t1'), HERE)).toBe(true);
    });

    it('names the project too when the task lives in another one, and says so when it cannot', () => {
        const elsewhere = added('t1', { ProjectID: OTHER_PROJECT });

        expect(mark(elsewhere)).toEqual({ name: 'Sprint board', title: 'Lives in Sprint board, in Marketing' });
        expect(mark(elsewhere, [])).toEqual({ name: 'Another project', title: 'Lives in a list in another project' });
        expect(mark(added('t1', { sprintArray: {} }))).toEqual({ name: 'Another list', title: 'Lives in another list' });
    });

    it('is drawn with the name and a spoken label', () => {
        const store = createStore({ getters: { 'projectData/onlyActiveProjects': () => ({ data: projects }) } });
        const shown = mount(TaskHomeMark, { props: { task: added('t1'), list }, global: { plugins: [store] } });
        const absent = mount(TaskHomeMark, { props: { task: task('t2', { sprintId: HERE }), list }, global: { plugins: [store] } });

        expect(shown.find('[data-home-mark]').text()).toBe('Sprint board');
        expect(shown.find('[data-home-mark]').attributes('aria-label')).toBe('Lives in Sprint board');
        expect(absent.find('[data-home-mark]').exists()).toBe(false);
    });
});

describe('the row menu', () => {
    const rights = taskMenuRights(() => true);
    const idsOf = (items) => items.map((entryItem) => entryItem.id);

    it('offers "Remove from this list" only on a row shown in a list it was added to', () => {
        expect(idsOf(taskMenuItems(added('t1'), rights, { listId: HERE }))).toContain('remove-from-list');
        expect(idsOf(taskMenuItems(task('t2', { sprintId: HERE }), rights, { listId: HERE }))).not.toContain('remove-from-list');
        expect(idsOf(taskMenuItems(added('t1'), rights))).not.toContain('remove-from-list');
        expect(idsOf(taskMenuItems(sub('s1', 't1'), rights, { listId: HERE }))).not.toContain('remove-from-list');
        expect(en.TaskLists.menu_remove_here).toBe('Remove from this list');
    });

    it('not without the right to move tasks, and not among archived tasks', () => {
        const without = taskMenuRights((path) => path !== 'task.task_move');

        expect(idsOf(taskMenuItems(added('t1'), without, { listId: HERE }))).not.toContain('remove-from-list');
        expect(idsOf(taskMenuItems(added('t1'), taskMenuRights(() => true, { archived: true }), { listId: HERE }))).not.toContain('remove-from-list');
    });

    const menuIn = (commit) => {
        let menu;
        const store = createStore({
            getters: { 'settings/companyOwnerDetail': () => ({}) },
            mutations: { 'projectData/mutateUpdateFirebaseTasks': (_, change) => commit('tasks', change), 'projectData/mutateTypesenseTableTasks': (_, change) => commit('table', change) }
        });
        mount({ setup() { menu = useListRowMenu({ _id: PID, isGlobalPermission: true }, false); return () => null; } }, { global: { plugins: [store], provide: { $userId: { value: 'u1' } } } });
        return menu;
    };

    it('sends removeFromList for the list on screen and writes the answer to that list', async () => {
        const commit = vi.fn();
        sent.answer = () => Promise.resolve({ status: 200, data: { status: true, data: { taskId: 't1', extraLists: [{ ...entry(THIRD), name: 'Roadmap', projectName: 'Website' }] } } });

        await menuIn(commit).removeFromList(added('t1', { extraLists: [entry(HERE), entry(THIRD)] }), HERE);

        expect(sent.calls.map((call) => [call.method, call.url, call.body])).toEqual([['patch', '/api/v2/tasks', { action: 'removeFromList', taskId: 't1', sprintId: HERE }]]);
        const [bucket, change] = commit.mock.calls[0];
        expect(bucket).toBe('tasks');
        expect(change).toMatchObject({ op: 'modified', pid: PID, sprintId: HERE, updatedFields: { extraLists: [entry(THIRD)] } });
        expect(change.snap).toBeTruthy();
        expect(commit.mock.calls.map(([name]) => name)).toEqual(['tasks', 'table']);
        expect(toast.success).toHaveBeenCalledWith('Removed from this list.', expect.anything());

        fromServer(HERE, change.data, change.updatedFields);
        expect(ids(HERE)).toEqual(['t2']);
    });

    it('says why when the server refuses, and changes nothing', async () => {
        const commit = vi.fn();
        sent.answer = () => Promise.reject({ response: { status: 403, data: { status: false, code: 'NOT_PERMITTED' } } });

        await menuIn(commit).removeFromList(added('t1'), HERE);

        expect(commit).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith(en.TaskLists.refusal_not_permitted, expect.anything());
    });
});

describe('dragging a row shown in a list it was added to', () => {
    const status = { name: 'Doing', key: 2, type: 'active', value: 2, searchKey: 'statusKey', searchValue: 2, indexName: 'groupByStatusIndex' };
    const drag = (event, listId = HERE, rows = [added('t1'), task('t2', { sprintId: HERE })]) => {
        let api;
        mount({ setup() { api = useListDragDrop(); return () => null; } }, { global: { plugins: [createStore({ mutations: { 'projectData/mutateTaskForDragAndDrop': () => {} } })] } });
        return api.applyDrag({ event, item: status, groupType: 0, rows, project: { _id: PID }, listId });
    };
    const indexWrites = () => sent.calls.filter((call) => String(call.url).includes('taskIndex'));

    it('to another group edits the task and writes no place for it', async () => {
        const result = drag({ added: { element: added('t1'), newIndex: 0 } });
        await flushPromises();

        expect(groupWrites).toHaveLength(1);
        expect(groupWrites[0][0]._id).toBe('t1');
        expect(indexWrites()).toEqual([]);
        expect(result).toBeUndefined();
    });

    it('to another place in its group is refused, and the List puts the rows back and says why', async () => {
        const result = drag({ moved: { element: added('t1'), newIndex: 1 } });
        await flushPromises();

        expect(result).toBe(false);
        expect(groupWrites).toEqual([]);
        expect(indexWrites()).toEqual([]);
        const group = readFileSync(path.resolve(__dirname, '../../src/views/Projects/ListView/ListGroup.vue'), 'utf8');
        expect(group).toMatch(/if \(kept !== false\) return;\s*rows\.value = \[\.\.\.groupTasks\.value\];\s*\$toast\.info\(t\("TaskLists\.order_kept_at_home"\)/);
        expect(en.TaskLists.order_kept_at_home).toEqual(expect.any(String));
    });

    it('a row that lives in the list is reordered as before', async () => {
        sent.answer = () => Promise.resolve({ status: 200, data: {} });
        const result = drag({ moved: { element: task('t2', { sprintId: HERE }), newIndex: 0 } });
        await flushPromises();

        expect(result).toBeUndefined();
        expect(indexWrites()).toHaveLength(1);
    });
});

describe('the Board and the Table', () => {
    const source = (file) => readFileSync(path.resolve(__dirname, '../../src', file), 'utf8');

    it('the Table row carries the mark for the list its group belongs to', () => {
        expect(source('views/Projects/TableView/TableRow.vue')).toMatch(/<TaskHomeMark v-if="!depth" :task="data" :list="viewedList" \/>/);
        expect(source('views/Projects/TableView/TableViewTable.vue')).toMatch(/provide\("viewedList", computed\(\(\) => \(\{ sprintId: props\.sprintId, projectId: project\?\.value\?\._id \}\)\)\)/);
    });

    it('a Board card dropped in another column edits the task before the place of an added card is left unwritten', () => {
        const board = source('views/Projects/Kanban/KanbanBoard.vue');
        const edit = board.indexOf('updateTaskByGroup(element, task, groupValue.value, null, true)');
        const guard = board.indexOf('if (isAddedRow(element, columns.value[0]?.sprintId || props.sprintId))');
        const place = board.indexOf('apiRequest("post", env.UPDATA_TASK_INDEX');

        expect(edit).toBeGreaterThan(-1);
        expect(guard).toBeGreaterThan(edit);
        expect(place).toBeGreaterThan(guard);
        expect(board.slice(guard, place)).toMatch(/if \(event\.moved\) \{\s*putBack\(task\.tasksArray, event\.moved\);\s*\$toast\.info\(t\("TaskLists\.order_kept_at_home"\)[^\n]*\n\s*\}\s*return;/);
    });

    it('a card whose reorder is refused goes back to where it was, with no refresh', () => {
        const cards = [{ _id: 'b' }, { _id: 'c' }, { _id: 'a' }];

        putBack(cards, { element: cards[2], oldIndex: 0, newIndex: 2 });
        expect(cards.map((card) => card._id)).toEqual(['a', 'b', 'c']);

        putBack(cards, { element: { _id: 'gone' }, oldIndex: 0, newIndex: 2 });
        putBack(undefined, { element: cards[0], oldIndex: 0, newIndex: 1 });
        expect(cards.map((card) => card._id)).toEqual(['a', 'b', 'c']);
    });
});

describe('under a search or a filter', () => {
    const source = (file) => readFileSync(path.resolve(__dirname, '../../src', file), 'utf8');
    const found = [added('t1'), task('t2', { sprintId: HERE }), task('t3'), added('t4', { extraLists: [entry(THIRD)] })];

    it('the List keeps a matching row of a task added to the list, as it keeps one that lives there', () => {
        expect(listSourceTasks({ searched: true, searchedTasks: found, sprintId: HERE }).map((row) => row._id)).toEqual(['t1', 't2']);
        expect(listSourceTasks({ searched: true, searchedTasks: found, sprintId: HOME }).map((row) => row._id)).toEqual(['t1', 't3', 't4']);
        expect(listSourceTasks({ searched: false, storeTasks: found, sprintId: HERE })).toBe(found);
    });

    it('the Board, the Table and the list of lists follow the same rule', () => {
        expect(source('views/Projects/Kanban/BoardView.vue')).toContain('searchedTasksData.value.filter(task => inList(task, currentSprintId))');
        expect(source('views/Projects/TableView/TableViewTable.vue')).toContain('.filter((task) => inList(task, props.sprintId))');
        expect(source('views/Projects/Projects.vue').match(/inList\(y, x\.id\)/g)).toHaveLength(2);
    });
});

describe('adding the selection to another list from the bulk bar', () => {
    const shape = (count, subtasks) => ({ count, subtasks, looseSubtasks: subtasks });

    it('needs the right to move tasks, and a selection that is not all subtasks', () => {
        expect(placementActions(shape(2, 0), { addToList: true }).addToList).toEqual({ enabled: true });
        expect(placementActions(shape(2, 1), { addToList: true }).addToList).toEqual({ enabled: true });
        expect(placementActions(shape(2, 2), { addToList: true }).addToList).toEqual({ enabled: false, reason: 'TaskLists.bulk_subtasks_hint' });
        expect(placementActions(shape(2, 0), { addToList: false }).addToList).toEqual({ enabled: false, reason: 'BulkActions.move_denied' });
        expect(en.TaskLists.bulk_subtasks_hint).toEqual(expect.any(String));
    });

    it('offers every list a task could be added to: not a Scrum sprint, a backlog or a list in the trash', () => {
        expect(offersAnyTask({ _id: 'a' })).toBe(true);
        expect([{ isScrum: true }, { isBacklog: true }, { deletedStatusKey: 1 }].map(offersAnyTask)).toEqual([false, false, false]);
    });
});
