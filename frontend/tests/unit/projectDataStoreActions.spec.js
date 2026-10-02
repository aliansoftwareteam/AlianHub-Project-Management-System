import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'vuex';

const { apiRequest, tableSortStages } = vi.hoisted(() => ({ apiRequest: vi.fn(), tableSortStages: vi.fn() }));
vi.mock('../../src/services/index', () => ({ apiRequest }));
vi.mock('@/composable/index.js', () => ({ useCustomComposable: () => ({ checkPermission: () => 0 }) }));
vi.mock('@/views/Projects/composables/customFieldQuery', () => ({ tableSortStages }));

import * as env from '@/config/env';
import projectData from '@/store/ProjectData';

const initialState = () => structuredClone({
    allProjects: [], tasks: {}, tableTasks: {}, tableGroupCounts: {}, items: [], currentProjectDetails: {}, searchedTasks: [],
    otherProjectChanges: 0, searchedProjects: [], projectTemplate: [], defaultTemplate: [], mongoUpdatedTask: {}, sprints: {}, folders: {},
    getTaskSnapShotPayload: {}, getPaginatedTaskPayload: [], getTableTaskPayload: [], taskDetailData: {}, taskDetailPayloadId: {}, allTaskData: []
});

const makeSocket = (rooms = []) => {
    const handlers = {};
    return {
        id: 'sock-1',
        handlers,
        rooms,
        emit: vi.fn((event, ...args) => { if (event === 'getRoomList') args[1](rooms); }),
        off: vi.fn((event) => { delete handlers[event]; }),
        on: vi.fn((event, fn) => { handlers[event] = fn; })
    };
};

const build = (socketInstance = null, getters = {}) => createStore({
    modules: {
        settings: { namespaced: true, state: { socketInstance }, getters: { finalCustomFields: () => getters.fields } },
        users: { namespaced: true, getters: { users: () => getters.users } },
        projectData: { ...projectData, state: initialState }
    }
});

const FIND = `${env.TASK}/find`;
const ok = (data) => Promise.resolve({ status: 200, data });
const page = (result, count) => ok([{ result, ...(count === undefined ? {} : { count: [{ count }] }) }]);
const parentTask = (id, extra = {}) => ({ _id: id, isParentTask: true, sprintId: 's1', ProjectID: 'p1', statusKey: 'st1', ...extra });
const STATUS_ITEM = { searchKey: 'statusKey', searchValue: 'st1', indexName: 'groupByStatusIndex', conditions: [{ statusKey: 'st1' }] };

let store;
let errorSpy;
beforeEach(() => {
    apiRequest.mockReset();
    tableSortStages.mockReset();
    store = build();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
    errorSpy.mockRestore();
    vi.useRealTimers();
});

const seed = (pid = 'p1', sprintId = 's1') => store.commit('projectData/mutateTypesenseTasks', { pid, sprintId, nextPage: {}, found: {}, data: null });
const listOf = (pid = 'p1', sprintId = 's1') => store.state.projectData.tasks[pid][sprintId];
const firstQuery = () => apiRequest.mock.calls[0][2].findQuery;

describe('loading projects (setProjects)', () => {
    it('lists every project the server returns, collapsed, tagged with the caller role', async () => {
        apiRequest.mockResolvedValue({ data: [{ _id: 'p1', ProjectName: 'A', sprintsObj: {} }, { _id: 'p2', ProjectName: 'B', sprintsObj: {} }] });
        const result = await store.dispatch('projectData/setProjects', { roleType: 1 });

        expect(result.map((r) => r.roleType)).toEqual([1, 1]);
        expect(store.state.projectData.allProjects.data.map((p) => [p._id, p.isExpanded])).toEqual([['p1', false], ['p2', false]]);
    });

    it('stays empty when the server has no projects', async () => {
        apiRequest.mockResolvedValue({ data: [] });
        await expect(store.dispatch('projectData/setProjects', { roleType: 1 })).resolves.toEqual([]);
        expect(store.getters['projectData/projects']).toEqual([]);
    });

    it('clears the old list before reading again', async () => {
        store.state.projectData.allProjects = { data: [{ _id: 'old' }] };
        apiRequest.mockReturnValue(new Promise(() => {}));
        store.dispatch('projectData/setProjects', { roleType: 1 });
        expect(store.state.projectData.allProjects).toEqual([]);
    });

    // the .catch only logs, so an awaiting caller (Projects.vue) never gets control back
    it.fails('settles when the projects request fails', async () => {
        apiRequest.mockRejectedValue(new Error('offline'));
        const outcome = await Promise.race([
            store.dispatch('projectData/setProjects', { roleType: 1 }).then(() => 'settled', () => 'settled'),
            new Promise((resolve) => setTimeout(() => resolve('hung'), 30))
        ]);
        expect(outcome).toBe('settled');
    });
});

describe('list counters (refreshSprintCounts)', () => {
    beforeEach(() => {
        store.commit('projectData/mutateSprints', { op: 'added', data: { _id: 's1', projectId: 'p1', tasks: 1, archiveTaskCount: 0 } });
        store.commit('projectData/mutateSprints', { op: 'added', data: { _id: 's2', projectId: 'p1', tasks: 4, archiveTaskCount: 1 } });
    });
    const counts = () => store.state.projectData.sprints.p1.map((s) => [s._id, s.tasks, s.archiveTaskCount]);

    it('shows the counters the server holds now, only for lists whose numbers changed', async () => {
        apiRequest.mockResolvedValue({ data: [{ _id: 's1', tasks: 7, archiveTaskCount: 2 }, { _id: 's2', tasks: 4, archiveTaskCount: 1 }, { _id: 'unknown', tasks: 9 }] });
        await store.dispatch('projectData/refreshSprintCounts', { pid: 'p1' });
        expect(counts()).toEqual([['s1', 7, 2], ['s2', 4, 1]]);
    });

    it('keeps the old counters and does not throw when the read fails', async () => {
        apiRequest.mockRejectedValue(new Error('offline'));
        await expect(store.dispatch('projectData/refreshSprintCounts', { pid: 'p1' })).resolves.toBeUndefined();
        expect(counts()).toEqual([['s1', 1, 0], ['s2', 4, 1]]);
    });

    it('does nothing for a project with no lists loaded or an empty answer', async () => {
        apiRequest.mockResolvedValue(undefined);
        await store.dispatch('projectData/refreshSprintCounts', { pid: 'p1' });
        await store.dispatch('projectData/refreshSprintCounts', { pid: 'unknown' });
        expect(counts()).toEqual([['s1', 1, 0], ['s2', 4, 1]]);
    });
});

describe('live task rooms (getTasksFromMongoDB)', () => {
    let socket;
    const join = (payload = {}, rooms = []) => {
        socket = makeSocket(rooms);
        store = build(socket);
        seed();
        return store.dispatch('projectData/getTasksFromMongoDB', { pid: 'p1', sprintId: 's1', userId: 'u1', showAllTasks: true, ...payload });
    };

    it('remembers what was asked for and resolves without waiting for the room list', async () => {
        const payload = { pid: 'p1', sprintId: 's1', userId: 'u1', showAllTasks: true };
        await expect(join()).resolves.toBeUndefined();
        expect(store.state.projectData.getTaskSnapShotPayload).toEqual(payload);
    });

    it('rejects when there is no socket to ask', async () => {
        store = build(null);
        await expect(store.dispatch('projectData/getTasksFromMongoDB', { pid: 'p1', sprintId: 's1' })).rejects.toThrow();
    });

    it('shows a task inserted, edited and deleted by someone else', async () => {
        await join();
        socket.handlers.taskInsert({ fullDocument: parentTask('t1', { TaskName: 'a' }) });
        expect(listOf().tasks.map((t) => t.TaskName)).toEqual(['a']);
        expect(store.state.projectData.tableTasks.p1.s1.tasks.map((t) => t._id)).toEqual(['t1']);

        socket.handlers.taskUpdate({ fullDocument: parentTask('t1', { TaskName: 'b' }), updatedFields: { TaskName: 'b' } });
        expect(listOf().tasks[0].TaskName).toBe('b');
        expect(store.state.projectData.mongoUpdatedTask.data.TaskName).toBe('b');

        socket.handlers.taskDelete({ fullDocument: parentTask('t1') });
        expect(listOf().tasks).toEqual([]);
        expect(store.state.projectData.mongoUpdatedTask.op).toBe('removed');
    });

    // mutateTypesenseTableTasks has no 'removed' branch, so the delete event upserts the row it should drop
    it.fails('drops a deleted task from the table too', async () => {
        await join();
        socket.handlers.taskInsert({ fullDocument: parentTask('t1') });
        socket.handlers.taskDelete({ fullDocument: parentTask('t1') });
        expect(store.state.projectData.tableTasks.p1.s1.tasks).toEqual([]);
    });

    it('treats a replaced task by its document key as a modification', async () => {
        await join();
        socket.handlers.taskInsert({ fullDocument: parentTask('t1', { TaskName: 'a' }) });
        socket.handlers.taskReplace({ documentKey: parentTask('t1', { TaskName: 'replaced' }) });
        expect(listOf().tasks[0].TaskName).toBe('replaced');
    });

    it('leaves a previously joined list before joining another, and forgets its payloads', async () => {
        store = build(makeSocket([]));
        socket = makeSocket(['/ns#sock-1', 'project_sprint_sock-1_p1']);
        store = build(socket);
        seed();
        store.commit('projectData/setGetPaginatedTasksPayload', { op: 'add', data: { pid: 'p1', sprintId: 's1' } });
        store.commit('projectData/setGetTableTaskPayload', { op: 'add', data: { pid: 'p1', sprintId: 's1' } });
        await store.dispatch('projectData/getTasksFromMongoDB', { pid: 'p1', sprintId: 's1', showAllTasks: true });

        expect(store.state.projectData.getPaginatedTaskPayload).toEqual([]);
        expect(store.state.projectData.getTableTaskPayload).toEqual([]);
        expect(socket.emit).toHaveBeenCalledWith('leaveProjectSprintForTask', 'project_sprint_sock-1_p1');
        socket.handlers.taskInsert({ fullDocument: parentTask('t1') });
        expect(listOf().tasks).toHaveLength(1);
    });

    it('asks only for the user own tasks when the view hides the rest', async () => {
        await join({ showAllTasks: false });
        const joinCall = socket.emit.mock.calls.find(([event]) => event === 'joinProjectSprintForTask');
        expect(joinCall[1]).toEqual({ projectId: 'p1', sprintId: 's1', socketId: 'sock-1', userId: 'u1' });
        expect(store.state.projectData.getTaskSnapShotPayload.showAllTasks).toBe(false);
    });

    it('swaps the grouping when the view regroups an already loaded project', async () => {
        store = build(makeSocket());
        seed();
        store.state.projectData.tasks.p1.groupBy = { type: 0, items: [] };
        await store.dispatch('projectData/getTasksFromMongoDB', { pid: 'p1', sprintId: 's1', groupBy: { type: 2, items: [] } });
        expect(store.state.projectData.tasks.p1.groupBy.type).toBe(2);
    });

    it('re-reads the list counters once a burst of changes has settled', async () => {
        vi.useFakeTimers();
        await join();
        store.commit('projectData/mutateSprints', { op: 'added', data: { _id: 's1', projectId: 'p1', tasks: 0, archiveTaskCount: 0 } });
        apiRequest.mockResolvedValue({ data: [{ _id: 's1', tasks: 3, archiveTaskCount: 0 }] });

        socket.handlers.taskInsert({ fullDocument: parentTask('t1') });
        socket.handlers.taskInsert({ fullDocument: parentTask('t2') });
        vi.advanceTimersByTime(500);
        expect(store.state.projectData.sprints.p1[0].tasks).toBe(0);
        await vi.advanceTimersByTimeAsync(400);
        expect(store.state.projectData.sprints.p1[0].tasks).toBe(3);
        expect(apiRequest).toHaveBeenCalledTimes(1);
    });

    it('does not re-read the counters for an edit that cannot move them', async () => {
        vi.useFakeTimers();
        await join();
        socket.handlers.taskUpdate({ fullDocument: parentTask('t1'), updatedFields: { TaskName: 'x' } });
        await vi.advanceTimersByTimeAsync(2000);
        expect(apiRequest).not.toHaveBeenCalled();
    });

    it('re-reads the counters when a task is moved to another list', async () => {
        vi.useFakeTimers();
        await join();
        apiRequest.mockResolvedValue({ data: [] });
        socket.handlers.taskUpdate({ fullDocument: parentTask('t1', { sprintId: 's2' }), updatedFields: { sprintId: 's2' } });
        await vi.advanceTimersByTimeAsync(900);
        expect(apiRequest).toHaveBeenCalledTimes(1);
        expect(apiRequest.mock.calls[0][1]).toContain('collection=sprints');
    });
});

describe('paged task loading (getPaginatedTasks)', () => {
    const load = (extra = {}) => store.dispatch('projectData/getPaginatedTasks', { pid: 'p1', sprintId: 's1', item: STATUS_ITEM, userId: 'u1', showAllTasks: true, ...extra });

    it('loads the first page into the list with its count, cursor and frontier', async () => {
        apiRequest.mockReturnValue(page([parentTask('t1', { groupByStatusIndex: 1, createdAt: 10 }), parentTask('t2', { groupByStatusIndex: 2, createdAt: 20 })], 40));
        const res = await load();

        expect(res.responseData).toHaveLength(2);
        expect(listOf().tasks.map((t) => t._id)).toEqual(['t1', 't2']);
        expect(listOf().found).toEqual({ statusKey_st1: 40 });
        expect(listOf().index).toEqual({ statusKey_st1: 2 });
        expect(listOf().frontier.statusKey_st1).toEqual({ index: 2, createdAt: 20, _id: 't2' });
        expect(firstQuery()[0].$match).toMatchObject({ objId: { sprintId: 's1', ProjectID: 'p1' }, isParentTask: true, statusKey: 'st1', deletedStatusKey: 0 });
        expect(firstQuery()[1].$sort).toEqual({ groupByStatusIndex: 1, createdAt: 1, _id: 1 });
        expect(store.state.projectData.getPaginatedTaskPayload).toHaveLength(1);
    });

    it('turns start and due dates from seconds into dates', async () => {
        apiRequest.mockReturnValue(page([parentTask('t1', { startDate: 1700000000, DueDate: 1700086400 })], 1));
        await load();
        expect(listOf().tasks[0].startDate).toEqual(new Date(1700000000 * 1000));
        expect(listOf().tasks[0].DueDate).toEqual(new Date(1700086400 * 1000));
    });

    it('records a group with no tasks as empty', async () => {
        apiRequest.mockReturnValue(page([], undefined));
        await load();
        expect(listOf().tasks).toEqual([]);
        expect(listOf().found).toEqual({ statusKey_st1: 0 });
        expect(listOf().index).toEqual({ statusKey_st1: 0 });
    });

    it('does not ask again for a list it holds, unless a fresh read is wanted', async () => {
        apiRequest.mockReturnValue(page([parentTask('t1')], 1));
        await load();
        await expect(load()).resolves.toBeUndefined();
        expect(apiRequest).toHaveBeenCalledTimes(1);
        expect(listOf().tasks).toHaveLength(1);
    });

    it('continues from where the previous page ended', async () => {
        apiRequest.mockReturnValueOnce(page([parentTask('t1'), parentTask('t2')], 3));
        await load();
        apiRequest.mockReturnValueOnce(page([parentTask('t3')], 3));
        await load({ fetchNew: true });

        expect(apiRequest.mock.calls[1][2].findQuery[2].$facet.result[0]).toEqual({ $skip: 2 });
        expect(listOf().tasks.map((t) => t._id)).toEqual(['t1', 't2', 't3']);
        expect(listOf().index.statusKey_st1).toBe(3);
    });

    it('starts at the row the List says when it counted rows itself', async () => {
        apiRequest.mockReturnValueOnce(page([parentTask('t1')], 5));
        await load();
        apiRequest.mockReturnValueOnce(page([parentTask('t4')], 5));
        await load({ fetchNew: true, skip: 3 });
        expect(apiRequest.mock.calls[1][2].findQuery[2].$facet.result[0]).toEqual({ $skip: 3 });
    });

    it('opening a group read before does not ask the server again', async () => {
        apiRequest.mockReturnValue(page([parentTask('t1')], 1));
        await load();
        await load({ fetchNew: true, firstPageOnly: true });
        expect(apiRequest).toHaveBeenCalledTimes(1);
    });

    it('reads subtasks under their parent, in the list the parent lives in', async () => {
        apiRequest.mockReturnValueOnce(page([parentTask('t1')], 1));
        await load();
        apiRequest.mockReturnValueOnce(page([{ _id: 'c1', isParentTask: false, ParentTaskId: 't1', sprintId: 's1' }], 1));
        await load({ parentId: 't1', fetchNew: true });

        const body = apiRequest.mock.calls[1][2];
        expect(body.findQuery[0].$match.ParentTaskId).toBe('t1');
        expect(body.findQuery[0].$match.isParentTask).toBeUndefined();
        expect(body.inList).toBeUndefined();
        expect(listOf().tasks[0].subtaskArray.map((t) => t._id)).toEqual(['c1']);
        expect(listOf().index).toMatchObject({ 't1_statusKey_st1': 1 });
    });

    it('asks only for the user own tasks when the view hides the rest', async () => {
        apiRequest.mockReturnValue(page([parentTask('t1')], 1));
        await load({ showAllTasks: false });
        expect(firstQuery()[0].$match.AssigneeUserId).toEqual({ $in: ['u1'] });
        expect(listOf().tasks).toHaveLength(1);
    });

    it('shares one request between two callers asking for the same page', async () => {
        let release;
        apiRequest.mockReturnValue(new Promise((resolve) => { release = resolve; }));
        const first = load();
        const second = load();
        release({ status: 200, data: [{ result: [parentTask('t1')], count: [{ count: 1 }] }] });
        const [a, b] = await Promise.all([first, second]);

        expect(apiRequest).toHaveBeenCalledTimes(1);
        expect(a.responseData).toHaveLength(1);
        expect(b.responseData).toHaveLength(1);
        expect(listOf().tasks).toHaveLength(1);
    });

    it('rejects and leaves the list unloaded when the answer is not a success', async () => {
        apiRequest.mockResolvedValue({ status: 500, data: [] });
        await expect(load()).rejects.toBeUndefined();
        expect(store.state.projectData.tasks.p1).toBeUndefined();
    });

    it('rejects when the request fails, and a retry asks the server again', async () => {
        apiRequest.mockRejectedValueOnce(new Error('offline'));
        await expect(load()).rejects.toThrow('offline');
        apiRequest.mockReturnValueOnce(page([parentTask('t1')], 1));
        await load();
        expect(apiRequest).toHaveBeenCalledTimes(2);
        expect(listOf().tasks).toHaveLength(1);
    });
});

describe('group counts from the server (refreshGroupCounts)', () => {
    const items = [{ searchKey: 'statusKey', searchValue: 'st1', conditions: [{ statusKey: 'st1' }] }, { searchKey: 'statusKey', searchValue: 'st2', conditions: [{ statusKey: 'st2' }] }];
    const refresh = (extra = {}) => store.dispatch('projectData/refreshGroupCounts', { pid: 'p1', sprintId: 's1', items, userId: 'u1', ...extra });
    const facets = { g0: [{ count: 4 }], g1: [] };

    it('does not ask for a list that is not loaded or when there are no groups', async () => {
        await refresh();
        seed();
        await refresh({ items: [] });
        expect(apiRequest).not.toHaveBeenCalled();
        expect(listOf().found).toEqual({});
    });

    it('stores a count per group, zero for a group the server found nothing for', async () => {
        seed();
        apiRequest.mockResolvedValue({ status: 200, data: [facets] });
        await refresh();
        expect(listOf().found).toEqual({ statusKey_st1: 4, statusKey_st2: 0 });
        expect(listOf().totals).toBeUndefined();
    });

    it('stores column totals next to the counts', async () => {
        seed();
        apiRequest.mockResolvedValue({ status: 200, data: [{ g0: [{ count: 2, t0: 9 }], g1: [{ count: 1, t0: 'x' }] }] });
        await refresh({ totals: [{ id: 'points', path: 'points' }] });
        expect(listOf().totals).toEqual({ statusKey_st1: { points: 9 }, statusKey_st2: { points: 0 } });
    });

    it('fills the table counts without needing the list view loaded', async () => {
        apiRequest.mockResolvedValue({ status: 200, data: [facets] });
        await refresh({ table: true });
        expect(store.state.projectData.tableGroupCounts.p1.s1.found).toEqual({ statusKey_st1: 4, statusKey_st2: 0 });
    });

    it('keeps the old counts when the answer is not a success', async () => {
        seed();
        apiRequest.mockResolvedValue({ status: 500, data: [] });
        await refresh();
        expect(listOf().found).toEqual({});
    });

    it('passes a failed request on to the caller', async () => {
        seed();
        apiRequest.mockRejectedValue(new Error('offline'));
        await expect(refresh()).rejects.toThrow('offline');
    });
});

describe('tab sync of task pages (tabSyncTaskCommit)', () => {
    const sync = (response, extra = {}) => store.dispatch('projectData/tabSyncTaskCommit', {
        response, payloadObjcet: { pid: 'p1', sprintId: 's1', item: STATUS_ITEM, ...extra }
    });

    it('shows the rows another tab loaded with their count and dates', () => {
        sync({ data: [{ result: [parentTask('t1', { startDate: 1700000000, DueDate: 1700086400 })], count: [{ count: 9 }] }] });
        expect(listOf().tasks[0].DueDate).toEqual(new Date(1700086400 * 1000));
        expect(listOf().found).toEqual({ statusKey_st1: 9 });
        expect(listOf().index).toEqual({ statusKey_st1: 1 });
    });

    it('records an empty page', () => {
        sync({ data: [{ result: [], count: [] }] });
        expect(listOf().tasks).toEqual([]);
        expect(listOf().found).toEqual({ statusKey_st1: 0 });
    });

    it('survives a malformed response without changing the store', () => {
        expect(() => sync(undefined)).not.toThrow();
        expect(store.state.projectData.tasks).toEqual({});
    });

    // `{...'u1'}` spreads a string into {0: 'u', 1: '1'}
    it.fails('keeps each favouring user as an object with the user id', () => {
        sync({ data: [{ result: [parentTask('t1', { favouriteTasks: ['u1'] })], count: [{ count: 1 }] }] });
        expect(listOf().tasks[0].favouriteTasks).toEqual([{ userId: 'u1' }]);
    });
});

describe('table loading (setTableTasksFromTypesense)', () => {
    const load = (extra = {}) => store.dispatch('projectData/setTableTasksFromTypesense', { pid: 'p1', sprintId: 's1', item: STATUS_ITEM, userId: 'u1', ...extra });
    const tableRows = () => store.state.projectData.tableTasks.p1.s1.tasks.map((t) => t._id);

    it('loads the first page of the table and resolves with the rows and page', async () => {
        apiRequest.mockResolvedValue({ status: 200, data: [parentTask('t1'), parentTask('t2')] });
        const res = await load();
        expect(res.page).toBe(0);
        expect(res.result).toHaveLength(2);
        expect(tableRows()).toEqual(['t1', 't2']);
        expect(store.state.projectData.tableTasks.p1.s1.index).toEqual({ statusKey_st1: 1 });
        expect(store.state.projectData.getTableTaskPayload).toHaveLength(1);
    });

    it('sorts by the list own index unless a column sort is asked for', async () => {
        apiRequest.mockResolvedValue({ status: 200, data: [] });
        await load();
        const stages = firstQuery();
        expect(stages.find((s) => s.$sort).$sort).toEqual({ groupByStatusIndex: 1 });
        expect(stages.find((s) => s.$limit).$limit).toBe(35);
        expect(stages.find((s) => 'skip' in s || '$skip' in s).$skip).toBe(0);
    });

    it('uses the column sort stages when a sort key is given', async () => {
        tableSortStages.mockReturnValue([{ $sort: { byColumn: -1 } }]);
        apiRequest.mockResolvedValue({ status: 200, data: [] });
        await load({ sortKey: 'name' });
        expect(firstQuery().find((s) => s.$sort).$sort).toEqual({ byColumn: -1 });
        expect(tableSortStages.mock.calls[0][0]).toBe('name');
    });

    it('records an empty table without rows', async () => {
        apiRequest.mockResolvedValue({ status: 200, data: [] });
        const res = await load();
        expect(res.result).toEqual([]);
        expect(store.state.projectData.tableTasks.p1.s1.tasks).toEqual([]);
    });

    it('only the user own tasks are asked for when the view hides the rest', async () => {
        apiRequest.mockResolvedValue({ status: 200, data: [parentTask('t1')] });
        await load({ showAllTasks: false });
        const filters = firstQuery()[0].$match.$and;
        expect(filters.some((f) => f.$and?.[0]?.AssigneeUserId?.$in?.[0] === 'u1')).toBe(true);
        expect(tableRows()).toEqual(['t1']);
    });

    it('does not ask again for a table it already holds', async () => {
        apiRequest.mockResolvedValue({ status: 200, data: [parentTask('t1')] });
        await load();
        await expect(load({ fetchNew: true })).resolves.toBeUndefined();
        expect(apiRequest).toHaveBeenCalledTimes(1);
    });

    it('starts over when the table is reset', async () => {
        apiRequest.mockResolvedValue({ status: 200, data: [parentTask('t1')] });
        await load();
        apiRequest.mockResolvedValue({ status: 200, data: [parentTask('t9')] });
        await load({ fetchNew: true, resetTable: true });
        expect(tableRows()).toEqual(['t9']);
    });

    it('rejects when the request fails', async () => {
        apiRequest.mockRejectedValue(new Error('offline'));
        await expect(load()).rejects.toThrow('offline');
        expect(store.state.projectData.tableTasks).toEqual({});
    });
});

describe('tab sync of table pages (tabSyncTableCommit)', () => {
    const sync = (response) => store.dispatch('projectData/tabSyncTableCommit', { response, payloadObjcet: { pid: 'p1', sprintId: 's1', item: STATUS_ITEM } });

    it('shows the rows another tab loaded', () => {
        sync({ data: [parentTask('t1'), parentTask('t2')] });
        expect(store.state.projectData.tableTasks.p1.s1.tasks.map((t) => t._id)).toEqual(['t1', 't2']);
    });

    it('records an empty page and survives a malformed response', () => {
        sync({ data: [] });
        expect(store.state.projectData.tableTasks.p1.s1.tasks).toEqual([]);
        expect(() => sync(undefined)).not.toThrow();
    });
});

describe('task search (searchTask)', () => {
    const search = (extra = {}) => store.dispatch('projectData/searchTask', { query: [{ $match: { q: 1 } }], ...extra });

    it('resolves with the matches and shows them as a tree', async () => {
        const rows = [parentTask('t1'), { _id: 'c1', isParentTask: false, ParentTaskId: 't1' }];
        apiRequest.mockResolvedValue({ status: 200, data: rows });
        await expect(search()).resolves.toEqual(rows);
        expect(store.state.projectData.searchedTasks.map((t) => t._id)).toEqual(['t1']);
        expect(store.state.projectData.searchedTasks[0].subtaskArray.map((t) => t._id)).toEqual(['c1']);
    });

    it('reads the parents of a matching subtask so it can be shown under them', async () => {
        apiRequest.mockResolvedValueOnce({ status: 200, data: [{ _id: 'c1', isParentTask: false, ParentTaskId: 't1', ancestors: ['t0', 't1'] }] });
        apiRequest.mockResolvedValueOnce({ status: 200, data: [parentTask('t1'), { ...parentTask('t0'), isParentTask: true }] });
        const res = await search();

        const lookup = apiRequest.mock.calls[1][2].findQuery[0].$match.$and;
        expect(lookup[0]._id.objId.$in.sort()).toEqual(['t0', 't1']);
        expect(lookup[1].deletedStatusKey.$in).toEqual([0]);
        expect(res.map((r) => r._id)).toEqual(['c1', 't1', 't0']);
    });

    it('includes archived parents when archived tasks are shown', async () => {
        apiRequest.mockResolvedValueOnce({ status: 200, data: [{ _id: 'c1', isParentTask: false, ParentTaskId: 't1' }] });
        apiRequest.mockResolvedValueOnce({ status: 200, data: [parentTask('t1')] });
        await search({ showArchived: true });
        expect(apiRequest.mock.calls[1][2].findQuery[0].$match.$and[1].deletedStatusKey.$in).toEqual([0, 2]);
        expect(store.state.projectData.searchedTasks.map((t) => t._id)).toEqual(['t1']);
    });

    it('does not read a parent it already has', async () => {
        apiRequest.mockResolvedValue({ status: 200, data: [parentTask('t1'), { _id: 'c1', isParentTask: false, ParentTaskId: 't1' }] });
        await search();
        expect(apiRequest).toHaveBeenCalledTimes(1);
    });

    it('falls back to the matches alone when the parent lookup fails to answer properly', async () => {
        const rows = [{ _id: 'c1', isParentTask: false, ParentTaskId: 't1' }];
        apiRequest.mockResolvedValueOnce({ status: 200, data: rows });
        apiRequest.mockResolvedValueOnce({ status: 500 });
        await expect(search()).resolves.toEqual(rows);
        expect(store.state.projectData.searchedTasks).toEqual([]);
    });

    it('rejects when the search is not a success, or any request fails', async () => {
        apiRequest.mockResolvedValueOnce({ status: 500 });
        await expect(search()).rejects.toBeUndefined();

        apiRequest.mockRejectedValueOnce(new Error('offline'));
        await expect(search()).rejects.toThrow('offline');

        apiRequest.mockResolvedValueOnce({ status: 200, data: [{ _id: 'c1', isParentTask: false, ParentTaskId: 't1' }] });
        apiRequest.mockRejectedValueOnce(new Error('lookup failed'));
        await expect(search()).rejects.toThrow('lookup failed');
    });

    it('cancels the earlier search when a newer one starts', async () => {
        apiRequest.mockReturnValue(new Promise(() => {}));
        search();
        search();
        const [firstSignal, secondSignal] = apiRequest.mock.calls.map((c) => c[4].signal);
        expect(firstSignal.aborted).toBe(true);
        expect(secondSignal.aborted).toBe(false);
    });
});

describe('project templates (setprojectTemplate)', () => {
    it('lists the templates the server returns, newest added first', async () => {
        apiRequest.mockResolvedValue({ data: { status: true, data: [{ _id: 'a', name: 'A' }, { _id: 'b', name: 'B' }] } });
        await store.dispatch('projectData/setprojectTemplate');
        expect(store.state.projectData.projectTemplate.data.map((t) => [t.id, t.name])).toEqual([['b', 'B'], ['a', 'A']]);
    });

    it('shows no templates when the server says it failed', async () => {
        store.state.projectData.projectTemplate = { data: [{ _id: 'old' }] };
        apiRequest.mockResolvedValue({ data: { status: false } });
        await store.dispatch('projectData/setprojectTemplate');
        expect(store.state.projectData.projectTemplate).toEqual({});
    });

    it('rejects when the request fails', async () => {
        apiRequest.mockRejectedValue(new Error('offline'));
        await expect(store.dispatch('projectData/setprojectTemplate')).rejects.toThrow('offline');
        expect(store.state.projectData.projectTemplate).toEqual({});
    });
});

describe.each([
    ['setSprints', 'sprints'],
    ['setFolders', 'folders']
])('%s', (action, collection) => {
    it('caches what the server returns under the project and resolves with it', async () => {
        apiRequest.mockResolvedValue({ data: [{ _id: 'x1', projectId: 'p1' }, { _id: 'x2', projectId: 'p1' }] });
        const res = await store.dispatch(`projectData/${action}`, { projectId: 'p1' });
        expect(res).toHaveLength(2);
        expect(store.state.projectData[collection].p1.map((x) => x._id)).toEqual(['x1', 'x2']);
        expect(apiRequest.mock.calls[0][1]).toContain(`/p1?collection=${collection}`);
    });

    it('resolves empty when the answer has no data', async () => {
        apiRequest.mockResolvedValue(undefined);
        await expect(store.dispatch(`projectData/${action}`, { projectId: 'p1' })).resolves.toEqual([]);
        expect(store.state.projectData[collection]).toEqual({});
    });

    it('rejects when the request fails', async () => {
        apiRequest.mockRejectedValue(new Error('offline'));
        await expect(store.dispatch(`projectData/${action}`, { projectId: 'p1' })).rejects.toThrow('offline');
    });
});

describe('project search (searchProjects)', () => {
    const projects = [{ _id: 'p1', ProjectName: 'Alpha Launch' }, { _id: 'p2', ProjectName: 'Beta' }];

    it('filters the loaded projects by name, ignoring case, without asking the server', () => {
        store.dispatch('projectData/searchProjects', { type: 'projectName', search: 'LAUNCH', projectList: projects });
        expect(store.state.projectData.searchedProjects).toEqual([projects[0]]);
        expect(apiRequest).not.toHaveBeenCalled();
    });

    it('shows nothing when no project name matches', () => {
        store.dispatch('projectData/searchProjects', { type: 'projectName', search: 'zzz', projectList: projects });
        expect(store.state.projectData.searchedProjects).toEqual([]);
    });

    it('asks the server for other kinds of search and shows the loaded projects it names', async () => {
        store.commit('projectData/mutateProjects', [{ op: 'added', data: { _id: 'p1', ProjectName: 'A', sprintsObj: {} } }, { op: 'added', data: { _id: 'p2', ProjectName: 'B', sprintsObj: {} } }]);
        apiRequest.mockResolvedValue({ data: [{ _id: 'p2' }, { _id: 'unknown' }] });
        const payload = { type: 'projectFilter', search: 'x', projectList: projects };
        const res = await store.dispatch('projectData/searchProjects', payload);

        expect(res).toEqual({ data: [{ _id: 'p2' }, { _id: 'unknown' }], searchType: 'projectFilter' });
        expect(store.state.projectData.searchedProjects.map((p) => p._id)).toEqual(['p2']);
        expect(apiRequest.mock.calls[0][2].projectList).toBeUndefined();
    });

    it('rejects when the server search fails', async () => {
        apiRequest.mockRejectedValue(new Error('offline'));
        await expect(store.dispatch('projectData/searchProjects', { type: 'sprint', search: 'x' })).rejects.toThrow('offline');
    });
});

describe('task detail room (getTaskDetailSnapShot)', () => {
    it('follows the open task: updates and inserts replace its data, a delete clears it', () => {
        const socket = makeSocket();
        store = build(socket);
        store.dispatch('projectData/getTaskDetailSnapShot', { taskId: 't1' });
        expect(store.state.projectData.taskDetailPayloadId).toEqual({ taskId: 't1' });

        socket.handlers.taskDetail_taskUpdate({ _id: 't1', TaskName: 'a' });
        expect(store.getters['projectData/gettaskDetailData']).toEqual({ _id: 't1', TaskName: 'a' });
        socket.handlers.taskDetail_taskInsert({ _id: 't1', TaskName: 'b' });
        expect(store.getters['projectData/gettaskDetailData'].TaskName).toBe('b');
        socket.handlers.taskDetail_taskDelete();
        expect(store.getters['projectData/gettaskDetailData']).toEqual({});
    });

    it('still remembers the task when there is no socket', () => {
        store = build(null);
        expect(() => store.dispatch('projectData/getTaskDetailSnapShot', { taskId: 't1' })).not.toThrow();
        expect(store.state.projectData.taskDetailPayloadId).toEqual({ taskId: 't1' });
    });
});

describe('all tasks (getAllTask)', () => {
    const load = (extra = {}) => store.dispatch('projectData/getAllTask', { projectIds: ['p1'], sprintIds: ['s1'], skip: 0, ...extra });

    it('keeps the tasks of the wanted projects and resolves with every row the server sent', async () => {
        apiRequest.mockResolvedValue({ data: [parentTask('t1'), parentTask('t2', { ProjectID: 'p9' })] });
        const res = await load();
        expect(res).toHaveLength(2);
        expect(store.state.projectData.allTaskData.map((t) => t._id)).toEqual(['t1']);
    });

    it('asks for 15 top-level tasks from the given offset, or the subtasks of a parent', async () => {
        apiRequest.mockResolvedValue({ data: [] });
        await load({ skip: 30 });
        await load({ parentId: 't1' });
        const [top, sub] = apiRequest.mock.calls.map((c) => c[2].findQuery);
        expect(top[0].$match.isParentTask).toBe(true);
        expect(top[2]).toEqual({ $skip: 30 });
        expect(top[3]).toEqual({ $limit: 15 });
        expect(sub[0].$match).toMatchObject({ ParentTaskId: 't1' });
        expect(sub[0].$match.isParentTask).toBeUndefined();
    });

    it('resolves empty when the answer has no data', async () => {
        apiRequest.mockResolvedValue(undefined);
        await expect(load()).resolves.toEqual([]);
        expect(store.state.projectData.allTaskData).toEqual([]);
    });

    it('rejects when the request fails', async () => {
        apiRequest.mockRejectedValue(new Error('offline'));
        await expect(load()).rejects.toThrow('offline');
    });
});
