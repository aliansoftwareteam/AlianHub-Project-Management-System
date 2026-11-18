/* Task 046 — status, priority, assignee, due date and title change on screen before the server
   answers, return to what they were when it refuses, and are not moved again by their own echo. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, ref } from 'vue';

const h = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn() }
}));

vi.mock('@/composable/index.js', () => ({
    useCustomComposable: () => ({ checkPermission: () => true, getWasabiImageLink: () => Promise.resolve(''), sanitizeInput: (value) => value }),
    useGetterFunctions: () => ({
        getUser: (id) => ({ id, Employee_Name: `User ${id}`, companyOwnerId: 'u1' }),
        getTaskStatus: () => ({ name: 'Open', bgColor: '', textColor: '' }),
        getPriority: () => ({ value: 'LOW', image: '' }),
        getTaskType: () => ({})
    }),
    useMoment: () => ({ changeDateFormate: () => '' })
}));
vi.mock('@/services', () => ({ apiRequest: h.apiRequest }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => key } } }));
vi.mock('vue-toast-notification', () => ({ useToast: () => h.toast }));
vi.mock('sweetalert2', () => ({ default: { fire: vi.fn() } }));
vi.mock('@/store/index', async () => {
    const { createStore } = await import('vuex');
    const { mutateUpdateFirebaseTasks } = await import('@/store/ProjectData/mutations');
    return {
        default: createStore({
            getters: { 'settings/companyOwnerDetail': () => ({ userId: 'u1' }), 'settings/companyPriority': () => [] },
            modules: {
                projectData: {
                    namespaced: true,
                    state: () => ({ tasks: {}, tableTasks: {}, searchedTasks: [] }),
                    getters: { tableTasks: (state) => state.tableTasks, searchedTasks: (state) => state.searchedTasks },
                    mutations: {
                        mutateUpdateFirebaseTasks,
                        mutateTypesenseTableTasks: (state, { pid, sprintId, data }) => {
                            const rows = state.tableTasks[pid][sprintId].tasks;
                            rows.splice(rows.findIndex((task) => task._id === data._id), 1, data);
                        }
                    }
                }
            }
        })
    };
});

import Store from '@/store/index';
import taskClass from '@/utils/TaskOperations';
import { onInstantEdit } from '@/utils/instantTaskEdit';
import { useListInlineEdit } from '@/views/Projects/ListView/useListInlineEdit';
import { useUpdateTasks } from '@/views/Projects/helper';

const PID = 'p1';
const SPRINT = 's1';
const PROJECT = { _id: PID, CompanyId: 'c1', ProjectName: 'Website', ProjectCode: 'WEB' };
const USER = { id: 'u1', Employee_Name: 'Olivia Owner', companyOwnerId: 'u1' };
const TOAST = { position: 'top-right' };
const CANNOT_OPEN_PROJECT = 'A person named here cannot open this project.';

const OPEN = { status: { text: 'Open', key: 1, type: 'default_active' }, statusType: 'default_active', statusKey: 1 };
const PROGRESS = { status: { text: 'In Progress', key: 3, type: 'active' }, statusType: 'active', statusKey: 3 };
const DONE = { status: { text: 'Done', key: 2, type: 'close' }, statusType: 'close', statusKey: 2 };
const OLD_DUE = '2026-10-05T00:00:00.000Z';
const NEW_DUE = new Date('2026-10-09T00:00:00.000Z');

const STATUS_GROUPS = { type: 0, items: [{ key: 'statusKey_1', value: 1, name: 'Open' }, { key: 'statusKey_3', value: 3, name: 'In Progress' }, { key: 'statusKey_2', value: 2, name: 'Done' }] };
const ASSIGNEE_GROUPS = { type: 1, items: [{ key: 'AssigneeUserId_u1', value: ['u1'], name: 'Assignee' }, { key: 'AssigneeUserId_u2', value: ['u2'], name: 'Assignee' }, { key: 'AssigneeUserId_[]', value: '[]', name: 'Unassigned' }] };

const seed = ({ groupBy = STATUS_GROUPS, found = { statusKey_1: 1, statusKey_3: 0, statusKey_2: 0 }, over = {} } = {}) => {
    Store.state.projectData.tasks = {
        [PID]: {
            projectId: PID, sprints: [SPRINT], groupBy,
            [SPRINT]: {
                index: {}, found: { ...found }, snapshot: null,
                tasks: [{
                    _id: 't1', TaskName: 'Old title', ProjectID: PID, sprintId: SPRINT, isParentTask: true, ParentTaskId: '', ancestors: [],
                    ...OPEN, Task_Priority: 'LOW', AssigneeUserId: ['u1'], DueDate: OLD_DUE, dueDateDeadLine: [], ...over
                }]
            }
        }
    };
};

const bucket = () => Store.state.projectData.tasks[PID][SPRINT];
const row = () => bucket().tasks.find((task) => task._id === 't1');
const sent = () => ({ ...row(), AssigneeUserId: [...row().AssigneeUserId] });

let pending;
const answer = (index = 0) => pending[index].resolve({ data: { status: true } });
const refuse = (index = 0, statusText = '') => pending[index].reject({ response: { status: 400, data: { status: false, statusText } } });
const echo = (fields) => Store.commit('projectData/mutateUpdateFirebaseTasks', {
    snap: {}, op: 'modified', pid: PID, sprintId: SPRINT, data: { ...sent(), ...fields }, updatedFields: { ...fields }
});

const setStatus = (next, options = {}) => taskClass.updateStatus({ newStatus: next, prevStatus: { taskId: 't1' }, projectData: PROJECT, task: sent(), userData: USER, ...options });
const setAssignee = (type, uid, options = {}) => taskClass.updateAssignee({ firebaseObj: { AssigneeUserId: uid }, projectData: PROJECT, taskData: sent(), employeeName: 'Max Member', type, userData: USER, ...options });

const EDITS = [
    { name: 'status', write: (options) => setStatus(DONE, options), shown: () => row().statusKey, before: 1, after: 2, stale: OPEN, failure: 'Toast.Status_not_updated' },
    {
        name: 'priority',
        write: (options) => taskClass.updatePriority({ firebaseObj: { Task_Priority: 'HIGH' }, projectData: PROJECT, taskData: sent(), priorityObj: { taskId: 't1' }, userData: USER, ...options }),
        shown: () => row().Task_Priority, before: 'LOW', after: 'HIGH', stale: { Task_Priority: 'LOW' }, failure: 'Toast.Priority_not_updated'
    },
    { name: 'assignee added', write: (options) => setAssignee('assigneeAdd', 'u2', options), shown: () => row().AssigneeUserId, before: ['u1'], after: ['u1', 'u2'], stale: { AssigneeUserId: ['u1'] }, failure: 'Toast.Assignee_not_updated' },
    { name: 'assignee removed', write: (options) => setAssignee('assigneRemove', 'u1', options), shown: () => row().AssigneeUserId, before: ['u1'], after: [], stale: { AssigneeUserId: ['u1'] }, failure: 'Toast.Assignee_not_updated' },
    {
        name: 'due date',
        write: (options) => taskClass.updateDueDate({ commonDateFormatString: 'DD/MM/YYYY', firebaseObj: { DueDate: NEW_DUE, dueDateDeadLine: [{ date: NEW_DUE }] }, project: PROJECT, task: sent(), obj: {}, userData: USER, ...options }),
        shown: () => row().DueDate, before: OLD_DUE, after: NEW_DUE, stale: { DueDate: OLD_DUE, dueDateDeadLine: [] }, failure: 'Toast.Due_date_not_updated'
    },
    {
        name: 'title',
        write: (options) => taskClass.updateTaskName({ firebaseObj: { TaskName: 'New title' }, projectData: PROJECT, taskData: sent(), obj: { previousTaskName: 'Old title' }, userData: USER, ...options }),
        shown: () => row().TaskName, before: 'Old title', after: 'New title', stale: { TaskName: 'Old title' }, failure: 'Toast.something_went_wrong'
    }
];

beforeEach(() => {
    pending = [];
    h.apiRequest.mockReset();
    h.apiRequest.mockImplementation(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
    h.toast.error.mockReset();
    h.toast.success.mockReset();
    seed();
});

describe.each(EDITS)('an edit of the $name', ({ write, shown, before, after, stale, failure }) => {
    it('changes the row before the server answers', async () => {
        const done = write();
        expect(shown()).toEqual(after);
        await flushPromises();
        expect(pending).toHaveLength(1);
        answer();
        await expect(done).resolves.toMatchObject({ status: true });
        expect(shown()).toEqual(after);
    });

    it('puts the old value back and says so when the write fails', async () => {
        const done = write({ announce: true });
        await flushPromises();
        refuse();
        await expect(done).rejects.toMatchObject({ status: false, announced: true });
        expect(shown()).toEqual(before);
        expect(h.toast.error).toHaveBeenCalledTimes(1);
        expect(h.toast.error).toHaveBeenCalledWith(failure, TOAST);
    });

    it('leaves the toast to a caller that shows its own', async () => {
        const done = write();
        await flushPromises();
        refuse();
        await expect(done).rejects.toMatchObject({ status: false, announced: false });
        expect(shown()).toEqual(before);
        expect(h.toast.error).not.toHaveBeenCalled();
    });

    it('is not put back by an event that left the server before the write did', async () => {
        const done = write();
        echo(stale);
        expect(shown()).toEqual(after);
        await flushPromises();
        answer();
        await done;
        expect(shown()).toEqual(after);
    });

    it('follows the server again once the write is answered', async () => {
        const done = write();
        await flushPromises();
        answer();
        await done;
        echo(stale);
        expect(shown()).toEqual(before);
    });
});

describe('a write that is never answered', () => {
    afterEach(() => vi.useRealTimers());

    it('stops holding the row after half a minute', () => {
        vi.useFakeTimers();
        setStatus(DONE);
        vi.advanceTimersByTime(29000);
        echo(OPEN);
        expect(row().statusKey).toBe(2);
        vi.advanceTimersByTime(2000);
        echo(OPEN);
        expect(row().statusKey).toBe(1);
    });
});

describe('a row grouped by status', () => {
    it('moves once, with the group counts, and its own echo moves nothing', async () => {
        const done = setStatus(DONE);
        expect(bucket().found).toMatchObject({ statusKey_1: 0, statusKey_2: 1 });
        echo(DONE);
        answer();
        await done;
        echo(DONE);
        expect(row().statusKey).toBe(2);
        expect(bucket().found).toMatchObject({ statusKey_1: 0, statusKey_3: 0, statusKey_2: 1 });
    });

    it('does not go back through a status the person has already left', async () => {
        const first = setStatus(PROGRESS);
        const second = setStatus(DONE);
        echo(PROGRESS);
        expect(row().statusKey).toBe(2);
        expect(bucket().found).toMatchObject({ statusKey_1: 0, statusKey_3: 0, statusKey_2: 1 });
        answer(0);
        answer(1);
        await Promise.all([first, second]);
        echo(DONE);
        expect(row().statusKey).toBe(2);
        expect(bucket().found).toMatchObject({ statusKey_1: 0, statusKey_3: 0, statusKey_2: 1 });
    });

    it('returns to its group, with the counts, when the server refuses the status and says why', async () => {
        const done = setStatus(DONE, { announce: true });
        expect(bucket().found).toMatchObject({ statusKey_1: 0, statusKey_2: 1 });
        refuse(0, 'This status is not part of the project.');
        await expect(done).rejects.toMatchObject({ serverReason: 'This status is not part of the project.' });
        expect(row()).toMatchObject(OPEN);
        expect(bucket().found).toMatchObject({ statusKey_1: 1, statusKey_3: 0, statusKey_2: 0 });
        expect(h.toast.error).toHaveBeenCalledWith('This status is not part of the project.', TOAST);
    });

    it('keeps a later status when an earlier write fails, and returns to the start when both do', async () => {
        const first = setStatus(PROGRESS);
        const second = setStatus(DONE);
        refuse(0);
        await expect(first).rejects.toMatchObject({ status: false });
        expect(row().statusKey).toBe(2);
        refuse(1);
        await expect(second).rejects.toMatchObject({ status: false });
        expect(row()).toMatchObject(OPEN);
        expect(bucket().found).toMatchObject({ statusKey_1: 1, statusKey_3: 0, statusKey_2: 0 });
    });

    it('answers a refusal the server sends as a 200', async () => {
        const done = setStatus(DONE, { announce: true });
        pending[0].resolve({ data: { status: false, statusText: 'Task not found' } });
        await expect(done).rejects.toMatchObject({ status: false, serverReason: 'Task not found' });
        expect(row().statusKey).toBe(1);
        expect(h.toast.error).toHaveBeenCalledWith('Task not found', TOAST);
    });
});

describe('a row grouped by assignee', () => {
    const counts = { 'AssigneeUserId_u1': 1, 'AssigneeUserId_u2': 0, 'AssigneeUserId_[]': 0 };
    beforeEach(() => seed({ groupBy: ASSIGNEE_GROUPS, found: counts }));

    it('joins the added person\'s group at once and the count follows', async () => {
        const done = setAssignee('assigneeAdd', 'u2');
        expect(row().AssigneeUserId).toEqual(['u1', 'u2']);
        expect(bucket().found).toMatchObject({ 'AssigneeUserId_u1': 1, 'AssigneeUserId_u2': 1, 'AssigneeUserId_[]': 0 });
        answer();
        await done;
        echo({ AssigneeUserId: ['u1', 'u2'] });
        expect(bucket().found).toMatchObject({ 'AssigneeUserId_u1': 1, 'AssigneeUserId_u2': 1, 'AssigneeUserId_[]': 0 });
    });

    it('moves to Unassigned when its last person is removed', () => {
        setAssignee('assigneRemove', 'u1');
        expect(bucket().found).toMatchObject({ 'AssigneeUserId_u1': 0, 'AssigneeUserId_u2': 0, 'AssigneeUserId_[]': 1 });
    });

    it('holds only the picked person after a replace', () => {
        setAssignee('replace', 'u2');
        expect(row().AssigneeUserId).toEqual(['u2']);
        expect(bucket().found).toMatchObject({ 'AssigneeUserId_u1': 0, 'AssigneeUserId_u2': 1, 'AssigneeUserId_[]': 0 });
    });

    it('returns to its group when the person cannot open the project, and says so', async () => {
        const done = setAssignee('assigneeAdd', 'u2', { announce: true });
        refuse(0, CANNOT_OPEN_PROJECT);
        await expect(done).rejects.toMatchObject({ serverReason: CANNOT_OPEN_PROJECT });
        expect(row().AssigneeUserId).toEqual(['u1']);
        expect(bucket().found).toMatchObject(counts);
        expect(h.toast.error).toHaveBeenCalledWith(CANNOT_OPEN_PROJECT, TOAST);
    });

    it('sends the task as it was, not as it will be', () => {
        const taskData = sent();
        taskClass.updateAssignee({ firebaseObj: { AssigneeUserId: 'u2' }, projectData: PROJECT, taskData, employeeName: 'Max Member', type: 'assigneeAdd', userData: USER });
        expect(taskData.AssigneeUserId).toEqual(['u1']);
        expect(h.apiRequest.mock.calls[0][2]).toMatchObject({ action: 'updateAssignee', firebaseObj: { AssigneeUserId: 'u2' }, type: 'assigneeAdd' });
    });
});

describe('a view that keeps its own copy of the task', () => {
    it('hears the change at once and hears the old value when the write fails', async () => {
        const heard = [];
        const stop = onInstantEdit((taskId, fields) => heard.push([taskId, fields]));
        const done = setStatus(DONE);
        expect(heard).toEqual([['t1', DONE]]);
        refuse();
        await done.catch(() => {});
        expect(heard[1]).toEqual(['t1', OPEN]);
        stop();
        setStatus(DONE);
        await flushPromises();
        expect(heard).toHaveLength(2);
    });

    it('hears a task the store does not hold', () => {
        Store.state.projectData.tasks = {};
        const heard = [];
        const stop = onInstantEdit((taskId, fields) => heard.push([taskId, fields]));
        taskClass.updateTaskName({ firebaseObj: { TaskName: 'New title' }, projectData: PROJECT, taskData: { _id: 't9', TaskName: 'Old title', ProjectID: PID, sprintId: SPRINT }, obj: {}, userData: USER });
        expect(heard).toEqual([['t9', { TaskName: 'New title' }]]);
        stop();
    });
});

const PROVIDE = { $userId: ref('u1'), $companyId: ref('c1'), $dateFormat: ref('DD/MM/YYYY'), searchedTask: ref(false) };
const STATUSES = [{ key: 1, name: 'Open', type: 'default_active', value: 'open' }, { key: 2, name: 'Done', type: 'close', value: 'done' }];

describe('a row of the List', () => {
    let list;
    const tableRow = () => Store.state.projectData.tableTasks[PID][SPRINT].tasks[0];

    beforeEach(() => {
        Store.state.projectData.tableTasks = { [PID]: { sprints: [SPRINT], [SPRINT]: { tasks: [{ _id: 't1', statusKey: 1 }] } } };
        const Host = defineComponent({ setup() { list = useListInlineEdit(ref({ ...PROJECT, taskStatusData: STATUSES })); return () => null; } });
        mount(Host, { global: { plugins: [Store], provide: PROVIDE } });
    });

    it('returns to its status, in the List and in the Table copy, with one message that gives the server\'s reason', async () => {
        const done = list.setStatus(sent(), STATUSES[1]);
        expect(row().statusKey).toBe(2);
        expect(tableRow().statusKey).toBe(2);
        refuse(0, 'This status is not part of the project.');
        await done;
        expect(row().statusKey).toBe(1);
        expect(tableRow().statusKey).toBe(1);
        expect(h.toast.error).toHaveBeenCalledTimes(1);
        expect(h.toast.error).toHaveBeenCalledWith('This status is not part of the project.', TOAST);
        expect(h.toast.success).not.toHaveBeenCalled();
    });

    it('shows a new priority without waiting for the icon links of the history entry', () => {
        list.setPriority(sent(), { value: 'HIGH' });
        expect(row().Task_Priority).toBe('HIGH');
        expect(pending).toHaveLength(0);
    });

    it('shows a person picked in place of another at once', () => {
        list.setAssignee(sent(), { type: 'replace', uid: 'u2' });
        expect(row().AssigneeUserId).toEqual(['u2']);
    });
});

describe('a Board card, or a row dropped into another group', () => {
    let updateTaskByGroup;

    beforeEach(() => {
        const Host = defineComponent({ setup() { ({ updateTaskByGroup } = useUpdateTasks(ref(PROJECT))); return () => null; } });
        mount(Host, { global: { provide: PROVIDE } });
    });

    it.each([
        ['status', 0, { key: 2, name: 'Done', type: 'close' }, () => row().statusKey, 1, 2, 'Toast.Status_not_updated'],
        ['assignee', 1, { value: 'u2' }, () => row().AssigneeUserId, ['u1'], ['u2'], 'Toast.Assignee_not_updated'],
        ['priority', 2, { value: 'HIGH', image: '' }, () => row().Task_Priority, 'LOW', 'HIGH', 'Toast.Priority_not_updated'],
        ['due date', 3, { seconds: NEW_DUE.getTime() / 1000 }, () => new Date(row().DueDate).toISOString(), OLD_DUE, NEW_DUE.toISOString(), 'Toast.Due_date_not_updated']
    ])('shows the new %s at once and puts the old one back, with one message, when the server refuses', async (name, groupType, to, shown, before, after, failure) => {
        const done = updateTaskByGroup(sent(), to, groupType);
        expect(shown()).toEqual(after);
        await flushPromises();
        refuse();
        await expect(done).rejects.toMatchObject({ announced: true });
        expect(shown()).toEqual(before);
        expect(h.toast.error).toHaveBeenCalledTimes(1);
        expect(h.toast.error).toHaveBeenCalledWith(failure, TOAST);
        expect(h.toast.success).not.toHaveBeenCalled();
    });
});
