import { beforeEach, describe, expect, it, vi } from 'vitest';

const { perm } = vi.hoisted(() => ({ perm: { level: 0 } }));
vi.mock('@/composable/index.js', () => ({ useCustomComposable: () => ({ checkPermission: () => perm.level }) }));

import * as m from '@/store/ProjectData/mutations';
import { holdOwnEdit, tabUpdateMarker } from '@/utils/taskUpdateMarker';

const OWNER = 1;
const MEMBER = 3;

const freshState = () => ({
    allProjects: [],
    tasks: {},
    tableTasks: {},
    tableGroupCounts: {},
    items: [],
    currentProjectDetails: {},
    searchedTasks: [],
    otherProjectChanges: 0,
    searchedProjects: [],
    projectTemplate: [],
    defaultTemplate: [],
    mongoUpdatedTask: {},
    sprints: {},
    folders: {},
    getTaskSnapShotPayload: {},
    getPaginatedTaskPayload: [],
    getTableTaskPayload: [],
    taskDetailData: {},
    taskDetailPayloadId: {},
    allTaskData: []
});

let state;
beforeEach(() => {
    state = freshState();
    perm.level = 0;
});

const project = (id, extra = {}) => ({ _id: id, ProjectName: `Project ${id}`, AssigneeUserId: [], LeadUserId: [], sprintsObj: {}, sprintsfolders: {}, ...extra });
const loadProjects = (...list) => { state.allProjects = { data: list, privateSnap: null, publicSnap: null }; };

describe('projects list (mutateProjects)', () => {
    it('does nothing for an empty or missing payload', () => {
        m.mutateProjects(state, undefined);
        m.mutateProjects(state, []);
        expect(state.allProjects).toEqual([]);
    });

    it('starts the list with the first project and remembers which snapshot it came from', () => {
        m.mutateProjects(state, [{ op: 'added', snap: 'pub', privateSnap: false, data: project('p1') }]);
        expect(state.allProjects.data.map((p) => p._id)).toEqual(['p1']);
        expect(state.allProjects).toMatchObject({ publicSnap: 'pub', privateSnap: null });

        state = freshState();
        m.mutateProjects(state, [{ op: 'added', snap: 'priv', privateSnap: true, data: project('p1') }]);
        expect(state.allProjects).toMatchObject({ privateSnap: 'priv', publicSnap: null });
    });

    it('fills the missing snapshot slot when the other kind arrives, and never overwrites a held one', () => {
        m.mutateProjects(state, [{ op: 'added', snap: 'pub', privateSnap: false, data: project('p1') }]);
        m.mutateProjects(state, [{ op: 'added', snap: 'priv', privateSnap: true, data: project('p2') }]);
        m.mutateProjects(state, [{ op: 'added', snap: 'priv2', privateSnap: true, data: project('p3') }]);
        expect(state.allProjects).toMatchObject({ publicSnap: 'pub', privateSnap: 'priv' });
    });

    it('lists sprints and folder sprints newest first when a project is added', () => {
        m.mutateProjects(state, [{ op: 'added', data: project('p1') }]);
        m.mutateProjects(state, [{
            op: 'added',
            data: project('p2', {
                sprintsObj: {
                    a: { id: 'a', createdAt: { seconds: 10 } },
                    b: { id: 'b', createdAt: { seconds: 30 } },
                    c: { id: 'c', createdAt: { seconds: 20 } }
                },
                sprintsfolders: { f1: { sprintsObj: { x: { id: 'x', createdAt: { seconds: 1 } }, y: { id: 'y', createdAt: { seconds: 2 } } } } }
            })
        }]);
        const added = state.allProjects.data[1];
        expect(Object.keys(added.sprintsObj)).toEqual(['b', 'c', 'a']);
        expect(Object.keys(added.sprintsfolders.f1.sprintsObj)).toEqual(['y', 'x']);
    });

    it('merges an added project that is already listed instead of duplicating it', () => {
        loadProjects(project('p1', { ProjectName: 'Old', extra: 'kept' }));
        m.mutateProjects(state, [{ op: 'added', data: project('p1', { ProjectName: 'New' }) }]);
        expect(state.allProjects.data).toHaveLength(1);
        expect(state.allProjects.data[0]).toMatchObject({ ProjectName: 'New', extra: 'kept' });
    });

    it('lets an owner see a modified project and merges its sprints with those already known', () => {
        loadProjects(project('p1', { sprintsObj: { a: { id: 'a', createdAt: { seconds: 1 } } } }));
        m.mutateProjects(state, [{
            op: 'modified', roleType: OWNER, userId: 'u1',
            data: project('p1', { ProjectName: 'Renamed', sprintsObj: { b: { id: 'b', createdAt: { seconds: 5 } } } })
        }]);
        const p = state.allProjects.data[0];
        expect(p.ProjectName).toBe('Renamed');
        expect(Object.keys(p.sprintsObj)).toEqual(['b', 'a']);
    });

    it('hides a private space from a member who is not in it', () => {
        loadProjects(project('p1'), project('p2'));
        m.mutateProjects(state, [{
            op: 'modified', roleType: MEMBER, userId: 'u1',
            data: project('p1', { isPrivateSpace: true, AssigneeUserId: ['someoneElse'] })
        }]);
        expect(state.allProjects.data.map((p) => p._id)).toEqual(['p2']);
    });

    it('keeps a private space for a member who is in it', () => {
        loadProjects(project('p1'));
        m.mutateProjects(state, [{
            op: 'modified', roleType: MEMBER, userId: 'u1',
            data: project('p1', { isPrivateSpace: true, AssigneeUserId: ['u1'], ProjectName: 'Mine' })
        }]);
        expect(state.allProjects.data[0].ProjectName).toBe('Mine');
    });

    it('keeps a private space for a member granted full private-project permission', () => {
        perm.level = 2;
        loadProjects(project('p1'));
        m.mutateProjects(state, [{
            op: 'modified', roleType: MEMBER, userId: 'u1',
            data: project('p1', { isPrivateSpace: true, AssigneeUserId: [] })
        }]);
        expect(state.allProjects.data).toHaveLength(1);
    });

    it('ignores a modification of a project that is not listed, and removes a listed one', () => {
        loadProjects(project('p1'));
        m.mutateProjects(state, [{ op: 'modified', roleType: OWNER, data: project('zzz') }]);
        expect(state.allProjects.data.map((p) => p._id)).toEqual(['p1']);

        m.mutateProjects(state, [{ op: 'removed', data: { _id: 'zzz' } }]);
        expect(state.allProjects.data).toHaveLength(1);
        m.mutateProjects(state, [{ op: 'removed', data: { _id: 'p1' } }]);
        expect(state.allProjects.data).toEqual([]);
    });
});

describe('plain project setters', () => {
    it('replaces project details only when they changed', () => {
        const details = { _id: 'p1' };
        m.mutateCurrentProjectDetails(state, details);
        expect(state.currentProjectDetails).toBe(details);
        m.mutateCurrentProjectDetails(state, { _id: 'p1' });
        expect(state.currentProjectDetails).toBe(details);
        m.mutateCurrentProjectDetails(state, { _id: 'p2' });
        expect(state.currentProjectDetails).toEqual({ _id: 'p2' });
    });

    it('replaces the current project tasks only when they changed', () => {
        const tasks = [{ _id: 't1' }];
        m.mutateCurrentProjectTasks(state, tasks);
        m.mutateCurrentProjectTasks(state, [{ _id: 't1' }]);
        expect(state.currentProjectTasks).toBe(tasks);
    });

    it('stores the simple payloads', () => {
        m.mutateTaskItems(state, [1, 2]);
        m.mutateMongoUpdatedTask(state, { _id: 't1' });
        m.mutatedefaultTemplate(state, [{ _id: 'd' }]);
        m.setTaskSnapShotPayload(state, { pid: 'p1' });
        m.setTaskDetailData(state, { _id: 't9' });
        m.setTaskdetailPayloadId(state, { taskId: 't9' });
        m.emptyTableTasks(state, {});
        expect(state).toMatchObject({
            items: [1, 2], mongoUpdatedTask: { _id: 't1' }, defaultTemplate: [{ _id: 'd' }], getTaskSnapShotPayload: { pid: 'p1' },
            taskDetailData: { _id: 't9' }, taskDetailPayloadId: { taskId: 't9' }, tableTasks: {}
        });
    });

    it('forgets the tasks of a project', () => {
        state.tasks = { p1: {}, p2: {} };
        m.removeProjectTaskSnap(state, 'p1');
        expect(Object.keys(state.tasks)).toEqual(['p2']);
    });
});

describe('paging payload bookkeeping', () => {
    it.each([
        ['setGetPaginatedTasksPayload', 'getPaginatedTaskPayload'],
        ['setGetTableTaskPayload', 'getTableTaskPayload']
    ])('%s adds a request and removes only the one for the same project and list', (name, key) => {
        m[name](state, { op: 'add', data: { pid: 'p1', sprintId: 's1' } });
        m[name](state, { op: 'add', data: { pid: 'p1', sprintId: 's2' } });
        m[name](state, { op: 'add', data: { pid: 'p2', sprintId: 's1' } });
        m[name](state, { op: 'remove', data: { pid: 'p1', sprintId: 's1' } });
        expect(state[key].map((r) => `${r.data.pid}/${r.data.sprintId}`)).toEqual(['p1/s2', 'p2/s1']);
        m[name](state, { op: 'other', data: { pid: 'p1', sprintId: 's2' } });
        expect(state[key]).toHaveLength(2);
    });
});

describe('typesense task pages (mutateTypesenseTasks)', () => {
    it('creates the project and list on the first page and nests subtasks under their parent', () => {
        m.mutateTypesenseTasks(state, { pid: 'p1', sprintId: 's1', nextPage: { status_a: 35 }, found: { status_a: 40 }, data: { _id: 't1', isParentTask: true } });
        m.mutateTypesenseTasks(state, { pid: 'p1', sprintId: 's1', nextPage: { status_a: 36 }, found: { status_a: 40 }, data: { _id: 'c1', isParentTask: false, ParentTaskId: 't1' } });

        const list = state.tasks.p1.s1;
        expect(state.tasks.p1.sprints).toEqual(['s1']);
        expect(list.index).toEqual({ status_a: 36 });
        expect(list.found).toEqual({ status_a: 40 });
        expect(list.tasks.map((t) => t._id)).toEqual(['t1']);
        expect(list.tasks[0].subtaskArray.map((t) => t._id)).toEqual(['c1']);
    });

    it('adds a second list to a known project without touching the first', () => {
        m.mutateTypesenseTasks(state, { pid: 'p1', sprintId: 's1', nextPage: {}, found: {}, data: { _id: 't1', isParentTask: true } });
        m.mutateTypesenseTasks(state, { pid: 'p1', sprintId: 's2', nextPage: { k: 1 }, found: { k: 1 }, data: { _id: 't2', isParentTask: true } });
        expect(state.tasks.p1.sprints).toEqual(['s1', 's2']);
        expect(state.tasks.p1.s1.tasks.map((t) => t._id)).toEqual(['t1']);
        expect(state.tasks.p1.s2.tasks.map((t) => t._id)).toEqual(['t2']);
    });

    it('records an empty page without inventing a task', () => {
        m.mutateTypesenseTasks(state, { pid: 'p1', sprintId: 's1', nextPage: { k: 0 }, found: { k: 0 }, data: null });
        m.mutateTypesenseTasks(state, { pid: 'p1', sprintId: 's1', nextPage: { k: 0 }, found: { k: 0 }, data: null });
        expect(state.tasks.p1.s1.tasks).toEqual([]);
        expect(state.tasks.p1.s1.index).toEqual({ k: 0 });
    });

    it('does not duplicate a task that arrives on two pages, and updates its fields', () => {
        m.mutateTypesenseTasks(state, { pid: 'p1', sprintId: 's1', nextPage: {}, found: {}, data: { _id: 't1', isParentTask: true, TaskName: 'a' } });
        m.mutateTypesenseTasks(state, { pid: 'p1', sprintId: 's1', nextPage: {}, found: {}, data: { _id: 't1', isParentTask: true, TaskName: 'b' } });
        expect(state.tasks.p1.s1.tasks).toHaveLength(1);
        expect(state.tasks.p1.s1.tasks[0].TaskName).toBe('b');
    });

    it('keeps a subtask whose parent has not arrived yet and attaches it when the parent comes', () => {
        m.mutateTypesenseTasks(state, { pid: 'p1', sprintId: 's1', nextPage: {}, found: {}, data: { _id: 'c1', isParentTask: false, ParentTaskId: 't1' } });
        expect(state.tasks.p1.s1.tasks).toEqual([]);
        m.mutateTypesenseTasks(state, { pid: 'p1', sprintId: 's1', nextPage: {}, found: {}, data: { _id: 't1', isParentTask: true } });
        expect(state.tasks.p1.s1.tasks[0].subtaskArray.map((t) => t._id)).toEqual(['c1']);
    });
});

describe('group counts and page frontier', () => {
    beforeEach(() => {
        m.mutateTypesenseTasks(state, { pid: 'p1', sprintId: 's1', nextPage: {}, found: { a: 1 }, data: null });
    });

    it('merges server counts and totals into the list', () => {
        m.mutateGroupCounts(state, { pid: 'p1', sprintId: 's1', found: { b: 4 }, totals: { a: { points: 3 } } });
        m.mutateGroupCounts(state, { pid: 'p1', sprintId: 's1', found: { a: 9 }, totals: null });
        expect(state.tasks.p1.s1.found).toEqual({ a: 9, b: 4 });
        expect(state.tasks.p1.s1.totals).toEqual({ a: { points: 3 } });
    });

    it('ignores counts for a list the store does not hold', () => {
        m.mutateGroupCounts(state, { pid: 'p1', sprintId: 'zzz', found: { a: 5 } });
        m.mutateGroupCounts(state, { pid: 'nope', sprintId: 's1', found: { a: 5 } });
        expect(state.tasks.p1.s1.found).toEqual({ a: 1 });
        expect(state.tasks.nope).toBeUndefined();
    });

    it('keeps the last row of each group as where the next page starts', () => {
        m.mutatePageFrontier(state, { pid: 'p1', sprintId: 's1', key: 'a', row: { _id: 't9' } });
        m.mutatePageFrontier(state, { pid: 'p1', sprintId: 's1', key: 'b', row: { _id: 't3' } });
        m.mutatePageFrontier(state, { pid: 'p1', sprintId: 'zzz', key: 'a', row: { _id: 'x' } });
        expect(state.tasks.p1.s1.frontier).toEqual({ a: { _id: 't9' }, b: { _id: 't3' } });
    });

    it('keeps table counts per project and list, and totals only once supplied', () => {
        m.mutateTableGroupCounts(state, { pid: 'p1', sprintId: 's1', found: { a: 2 } });
        expect(state.tableGroupCounts.p1.s1).toEqual({ found: { a: 2 }, totals: undefined });
        m.mutateTableGroupCounts(state, { pid: 'p1', sprintId: 's1', found: { b: 1 }, totals: { a: { points: 2 } } });
        m.mutateTableGroupCounts(state, { pid: 'p1', sprintId: 's2', found: { z: 7 } });
        expect(state.tableGroupCounts.p1.s1).toEqual({ found: { a: 2, b: 1 }, totals: { a: { points: 2 } } });
        expect(state.tableGroupCounts.p1.s2.found).toEqual({ z: 7 });
    });
});

describe('live task events (mutateUpdateFirebaseTasks)', () => {
    const PID = 'p1';
    const task = (id, extra = {}) => ({ _id: id, isParentTask: true, sprintId: 's1', ProjectID: PID, ...extra });
    const open = (...sprints) => (sprints.length ? sprints : ['s1']).forEach((sprintId) => m.mutateTypesenseTasks(state, { pid: PID, sprintId, nextPage: {}, found: {}, data: null }));
    const fire = (op, data, extra = {}) => m.mutateUpdateFirebaseTasks(state, { snap: {}, op, pid: PID, sprintId: 's1', data, updatedFields: op === 'added' ? { ...data } : {}, ...extra });
    const ids = (sprintId = 's1') => state.tasks[PID][sprintId].tasks.map((t) => t._id);

    beforeEach(() => open());

    it('shows a new task, an edit to it and its removal', () => {
        fire('added', task('t1', { TaskName: 'a' }));
        fire('modified', task('t1', { TaskName: 'b' }), { updatedFields: { TaskName: 'b' } });
        expect(state.tasks[PID].s1.tasks[0].TaskName).toBe('b');
        fire('removed', task('t1'));
        expect(ids()).toEqual([]);
    });

    it('ignores events for a project or list it never loaded', () => {
        m.mutateUpdateFirebaseTasks(state, { snap: {}, op: 'added', pid: 'other', sprintId: 's1', data: task('t1', { ProjectID: 'other' }), updatedFields: {} });
        fire('added', task('t2', { sprintId: 'sX' }), { sprintId: 'sX' });
        expect(ids()).toEqual([]);
        expect(state.tasks.other).toBeUndefined();
    });

    it('ignores a task whose home list is another one and which this list never held', () => {
        fire('added', task('t1', { sprintId: 's2' }));
        expect(ids()).toEqual([]);
    });

    it('nests an added subtask under its parent and counts the removal of a subtask', () => {
        fire('added', task('t1', { subTasks: 0 }));
        fire('modified', task('c1', { isParentTask: false, ParentTaskId: 't1' }), { dragDropcheck: true, updatedFields: { ParentTaskId: 't1' } });
        const parent = state.tasks[PID].s1.tasks[0];
        expect(parent.subtaskArray.map((t) => t._id)).toEqual(['c1']);
        expect(parent.subTasks).toBe(1);

        fire('removed', task('c1', { isParentTask: false, ParentTaskId: 't1' }));
        expect(state.tasks[PID].s1.tasks[0].subtaskArray).toEqual([]);
        expect(state.tasks[PID].s1.tasks[0].subTasks).toBe(0);
    });

    it('never lets a parent task subtask counter go below zero', () => {
        fire('added', task('t1', { subTasks: 0 }));
        fire('modified', task('c1', { isParentTask: false, ParentTaskId: 't1' }), { updatedFields: {} });
        fire('removed', task('c1', { isParentTask: false, ParentTaskId: 't1' }));
        fire('removed', task('c1', { isParentTask: false, ParentTaskId: 't1' }));
        expect(state.tasks[PID].s1.tasks[0].subTasks).toBe(0);
    });

    it('takes a task out of the list it was moved away from', () => {
        fire('added', task('t1'));
        fire('modified', task('t1', { sprintId: 's2' }), { updatedFields: { sprintId: 's2' } });
        expect(ids()).toEqual([]);
    });

    it('counts a change that touches another project so lists can reread', () => {
        fire('added', task('t1', { ProjectID: 'other' }));
        fire('modified', task('t2', { extraLists: [{ sprintId: 'sx', projectId: 'other' }] }), { updatedFields: { extraLists: [] } });
        expect(state.otherProjectChanges).toBe(2);
    });

    it('does not count an ordinary change as touching another project', () => {
        fire('added', task('t1'));
        expect(state.otherProjectChanges).toBe(0);
    });

    it('keeps the first snapshot and takes the grouping on the initial load', () => {
        const groupBy = { type: 0, items: [] };
        fire('inital', null, { snap: 'first', groupBy });
        fire('inital', null, { snap: 'second', groupBy: { type: 2, items: [] } });
        expect(state.tasks[PID].s1.snapshot).toBe('first');
        expect(state.tasks[PID].groupBy.type).toBe(2);
    });

    it('keeps what the person just edited when an older server value arrives', () => {
        fire('added', task('t1', { statusKey: 'st2' }));
        const hold = holdOwnEdit('t1', { statusKey: 'st2' }, { statusKey: 'st1' });
        try {
            fire('modified', task('t1', { statusKey: 'st1' }), { updatedFields: { statusKey: 'st1' } });
            expect(state.tasks[PID].s1.tasks[0].statusKey).toBe('st2');
        } finally {
            hold.confirm();
        }
        fire('modified', task('t1', { statusKey: 'st1' }), { updatedFields: { statusKey: 'st1' } });
        expect(state.tasks[PID].s1.tasks[0].statusKey).toBe('st1');
    });

    it('lets a reorder this tab made echo back without overwriting the row, only confirming the index', () => {
        fire('added', task('t1', { TaskName: 'local', updateTimeStamp: 5, groupByStatusIndex: 1 }));
        const echo = task('t1', { TaskName: 'server', islocalSnapStop: true, updateToken: tabUpdateMarker(9), groupByStatusIndex: 4 });
        fire('modified', echo, { updatedFields: { updateToken: { timeStamp: 9 }, groupByStatusIndex: 4 } });
        expect(state.tasks[PID].s1.tasks[0]).toMatchObject({ TaskName: 'local', groupByStatusIndex: 4 });
    });

    it('applies a reorder echo from another tab in full', () => {
        fire('added', task('t1', { TaskName: 'local', updateTimeStamp: 5 }));
        const echo = task('t1', { TaskName: 'server', islocalSnapStop: true, updateToken: { user: 'other-tab', timeStamp: 9 } });
        fire('modified', echo, { updatedFields: { updateToken: { timeStamp: 9 } } });
        expect(state.tasks[PID].s1.tasks[0].TaskName).toBe('server');
    });

    describe('group counts', () => {
        const statusGroups = { type: 0, items: [{ key: 'todo', value: 'st1' }, { key: 'done', value: 'st2' }] };
        beforeEach(() => {
            state.tasks[PID].groupBy = statusGroups;
        });

        it('moves one from the old status group to the new one when a task changes status', () => {
            fire('added', task('t1', { statusKey: 'st1' }));
            expect(state.tasks[PID].s1.found).toEqual({ todo: 1 });
            fire('modified', task('t1', { statusKey: 'st2' }), { updatedFields: { statusKey: 'st2' } });
            expect(state.tasks[PID].s1.found).toEqual({ todo: 0, done: 1 });
        });

        it('leaves the count of a removed task to the recount the server is asked for', () => {
            fire('added', task('t1', { statusKey: 'st1' }));
            fire('removed', task('t1', { statusKey: 'st1' }));
            expect(ids()).toEqual([]);
            expect(state.tasks[PID].s1.countsStale).toBe(2);
            expect(state.tasks[PID].s1.found.todo).toBeGreaterThanOrEqual(0);
        });

        it('does not count a subtask in any group', () => {
            fire('added', task('t1', { statusKey: 'st1' }));
            fire('added', task('c1', { isParentTask: false, ParentTaskId: 't1', statusKey: 'st1' }));
            expect(state.tasks[PID].s1.found).toEqual({ todo: 1 });
        });

        it('asks for a recount when a server event can change group membership, but not for other edits', () => {
            fire('added', task('t1', { statusKey: 'st1' }));
            expect(state.tasks[PID].s1.countsStale).toBe(1);
            fire('modified', task('t1', { TaskName: 'x' }), { updatedFields: { TaskName: 'x' } });
            expect(state.tasks[PID].s1.countsStale).toBe(1);
            fire('modified', task('t1', { statusKey: 'st2' }), { updatedFields: { statusKey: 'st2' } });
            expect(state.tasks[PID].s1.countsStale).toBe(2);
            fire('removed', task('t1'));
            expect(state.tasks[PID].s1.countsStale).toBe(3);
        });

        it('does not ask for a recount for a local, optimistic write', () => {
            fire('added', task('t1', { statusKey: 'st1' }), { snap: null });
            expect(state.tasks[PID].s1.countsStale).toBeUndefined();
        });

        it('asks for new totals only when points or a custom field changed', () => {
            fire('added', task('t1', { statusKey: 'st1' }));
            fire('modified', task('t1'), { updatedFields: { TaskName: 'n' } });
            expect(state.tasks[PID].s1.totalsStale).toBeUndefined();
            fire('modified', task('t1', { points: 3 }), { updatedFields: { points: 3 } });
            fire('modified', task('t1'), { updatedFields: { 'customField.abc': 1 } });
            expect(state.tasks[PID].s1.totalsStale).toBe(2);
        });

        it('groups by priority', () => {
            state.tasks[PID].groupBy = { type: 2, items: [{ key: 'hi', value: 'High' }, { key: 'lo', value: 'Low' }] };
            fire('added', task('t1', { Task_Priority: 'High' }));
            fire('modified', task('t1', { Task_Priority: 'Low' }), { updatedFields: { Task_Priority: 'Low' } });
            expect(state.tasks[PID].s1.found).toEqual({ hi: 0, lo: 1 });
        });

        it('moves a task into the No due date group when its due date is cleared', () => {
            const yesterday = new Date(Date.now() - 2 * 864e5);
            state.tasks[PID].groupBy = {
                type: 3,
                items: [{ name: 'Overdue', value: 'over', key: 'late' }, { name: 'Next', value: 9e12, key: 'next' }, { value: 'DueDate_0', key: 'none' }]
            };
            fire('added', task('t1', { DueDate: yesterday }), { updatedFields: {} });
            fire('modified', task('t1', { DueDate: null }), { updatedFields: { DueDate: null } });
            expect(state.tasks[PID].s1.found.none).toBe(1);
            expect(state.tasks[PID].s1.found.late).toBe(0);
        });

        describe('by assignee', () => {
            beforeEach(() => {
                state.tasks[PID].groupBy = { type: 1, items: [{ key: 'ua', value: ['u1'] }, { key: 'ub', value: ['u2'] }, { key: 'nobody', value: '[]' }] };
                state.tasks[PID].s1.found = { ua: 1, ub: 0, nobody: 0 };
                fire('added', task('t1', { AssigneeUserId: ['u1'] }));
                state.tasks[PID].s1.found = { ua: 1, ub: 0, nobody: 0 };
            });

            it('moves a task between people', () => {
                fire('modified', task('t1', { AssigneeUserId: ['u2'] }), { updatedFields: { AssigneeUserId: ['u2'] } });
                expect(state.tasks[PID].s1.found).toEqual({ ua: 0, ub: 1, nobody: 0 });
            });

            it('moves a task to Unassigned when nobody is left', () => {
                fire('modified', task('t1', { AssigneeUserId: [] }), { updatedFields: { AssigneeUserId: [] } });
                expect(state.tasks[PID].s1.found).toEqual({ ua: 0, ub: 0, nobody: 1 });
            });

            it('counts a task in both groups when a person is added, and leaves teams to the server', () => {
                fire('modified', task('t1', { AssigneeUserId: ['u1', 'u2'] }), { updatedFields: { AssigneeUserId: ['u1', 'u2'] } });
                expect(state.tasks[PID].s1.found).toEqual({ ua: 1, ub: 1, nobody: 0 });
                fire('modified', task('t1', { AssigneeUserId: ['tId_1'] }), { updatedFields: { AssigneeUserId: ['tId_1'] } });
                expect(state.tasks[PID].s1.found).toEqual({ ua: 1, ub: 1, nobody: 0 });
            });
        });
    });

    describe('moving a task to another list', () => {
        const statusGroups = { type: 0, items: [{ key: 'todo', value: 'st1' }] };
        beforeEach(() => {
            open('s2');
            state.tasks[PID].groupBy = statusGroups;
            fire('added', task('t1', { statusKey: 'st1' }));
        });
        const moveEvent = () => m.mutateUpdateFirebaseTasks(state, {
            snap: {}, op: 'modified', pid: PID, sprintId: 's2', data: task('t1', { sprintId: 's2', statusKey: 'st1' }), updatedFields: { sprintId: 's2' }
        });

        it('shows the task in the new list and drops it from the old one, counting one in each group', () => {
            moveEvent();
            expect(ids('s1')).toEqual([]);
            expect(ids('s2')).toEqual(['t1']);
            expect(state.tasks[PID].s1.found.todo).toBe(0);
            expect(state.tasks[PID].s2.found.todo).toBe(1);
        });

        it('counts the move once even when the same event arrives through two rooms', () => {
            moveEvent();
            moveEvent();
            expect(state.tasks[PID].s2.found.todo).toBe(1);
            expect(state.tasks[PID].s1.found.todo).toBe(0);
        });
    });

    it('drops a task from a list it was only added to when it stops being shown there', () => {
        open('s2');
        m.mutateUpdateFirebaseTasks(state, {
            snap: {}, op: 'added', pid: PID, sprintId: 's2',
            data: task('t1', { extraLists: [{ sprintId: 's2', projectId: PID }] }), updatedFields: {}
        });
        expect(ids('s2')).toEqual(['t1']);
        m.mutateUpdateFirebaseTasks(state, {
            snap: {}, op: 'removed', pid: PID, sprintId: 's1', data: task('t1'), updatedFields: {}
        });
        expect(ids('s2')).toEqual([]);
    });
});

describe('table task events (mutateUpdateFirebaseTableTasks)', () => {
    const PID = 'p1';
    beforeEach(() => {
        state.tableTasks = { [PID]: { sprints: ['s1'], s1: { tasks: [], index: {} } } };
    });
    const fire = (op, data, sprintId = 's1', pid = PID) => m.mutateUpdateFirebaseTableTasks(state, { op, pid, sprintId, data });
    const rows = () => state.tableTasks[PID].s1.tasks;

    it('adds a task once and merges a repeat', () => {
        fire('added', { id: 'a', isParentTask: true, name: 'x' });
        fire('added', { id: 'a', isParentTask: true, name: 'y', extra: 1 });
        expect(rows()).toEqual([{ id: 'a', isParentTask: true, name: 'y', extra: 1 }]);
    });

    it('puts a subtask under its parent, creating or merging into the subtask list', () => {
        fire('added', { id: 'a', isParentTask: true });
        fire('added', { id: 's1', isParentTask: false, ParentTaskId: 'a', n: 1 });
        fire('added', { id: 's2', isParentTask: false, ParentTaskId: 'a' });
        fire('added', { id: 's1', isParentTask: false, ParentTaskId: 'a', n: 2 });
        expect(rows()[0].subtaskArray).toEqual([
            { id: 's1', isParentTask: false, ParentTaskId: 'a', n: 2 },
            { id: 's2', isParentTask: false, ParentTaskId: 'a' }
        ]);
    });

    it('drops a subtask whose parent is not in the table', () => {
        fire('added', { id: 's1', isParentTask: false, ParentTaskId: 'nope' });
        expect(rows()).toEqual([]);
    });

    it('edits a task and a subtask in place and ignores a missing task', () => {
        fire('added', { id: 'a', isParentTask: true, name: 'x' });
        fire('added', { id: 's1', isParentTask: false, ParentTaskId: 'a', name: 's' });
        fire('modified', { id: 'a', isParentTask: true, name: 'X2' });
        fire('modified', { id: 's1', isParentTask: false, ParentTaskId: 'a', name: 'S2' });
        fire('modified', { id: 'ghost', isParentTask: true, name: 'g' });
        expect(rows()).toHaveLength(1);
        expect(rows()[0].name).toBe('X2');
        expect(rows()[0].subtaskArray[0].name).toBe('S2');
    });

    it('removes a task and a subtask', () => {
        fire('added', { id: 'a', isParentTask: true });
        fire('added', { id: 'b', isParentTask: true });
        fire('added', { id: 's1', isParentTask: false, ParentTaskId: 'a' });
        fire('removed', { id: 's1', isParentTask: false, ParentTaskId: 'a' });
        expect(rows()[0].subtaskArray).toEqual([]);
        fire('removed', { id: 'a', isParentTask: true });
        fire('removed', { id: 'ghost', isParentTask: true });
        expect(rows().map((r) => r.id)).toEqual(['b']);
    });

    // splice(-1, 1) drops the last subtask when the removed one is not found
    it.fails('keeps the other subtasks when the subtask to remove is not in the table', () => {
        fire('added', { id: 'a', isParentTask: true });
        fire('added', { id: 's1', isParentTask: false, ParentTaskId: 'a' });
        fire('removed', { id: 'ghost', isParentTask: false, ParentTaskId: 'a' });
        expect(rows()[0].subtaskArray.map((s) => s.id)).toEqual(['s1']);
    });

    it('ignores events for a project or list the table does not hold', () => {
        fire('added', { id: 'a', isParentTask: true }, 's9');
        fire('added', { id: 'a', isParentTask: true }, 's1', 'other');
        expect(rows()).toEqual([]);
        expect(state.tableTasks.other).toBeUndefined();
    });
});

describe('table pages (mutateTypesenseTableTasks)', () => {
    it('creates the project and list with the page total and the first row', () => {
        m.mutateTypesenseTableTasks(state, { pid: 'p1', sprintId: 's1', nextPage: { k: 1 }, total: 80, data: { _id: 't1' } });
        expect(state.tableTasks.p1.sprints).toEqual(['s1']);
        expect(state.tableTasks.p1.s1).toMatchObject({ index: { k: 1 }, total: 80, tasks: [{ _id: 't1' }] });
    });

    it('starts a second list empty when the page had no rows', () => {
        m.mutateTypesenseTableTasks(state, { pid: 'p1', sprintId: 's1', nextPage: {}, data: { _id: 't1' } });
        m.mutateTypesenseTableTasks(state, { pid: 'p1', sprintId: 's2', nextPage: { k: 0 }, data: null });
        expect(state.tableTasks.p1.s2).toMatchObject({ tasks: [], total: 0, index: { k: 0 } });
    });

    it('appends rows of later pages, replaces a row it holds, and advances the page index', () => {
        m.mutateTypesenseTableTasks(state, { pid: 'p1', sprintId: 's1', nextPage: { k: 1 }, data: { _id: 't1', n: 1 } });
        m.mutateTypesenseTableTasks(state, { pid: 'p1', sprintId: 's1', nextPage: { k: 2 }, data: { _id: 't2' } });
        m.mutateTypesenseTableTasks(state, { pid: 'p1', sprintId: 's1', nextPage: { k: 2 }, data: { _id: 't1', n: 2 } });
        expect(state.tableTasks.p1.s1.tasks).toEqual([{ _id: 't1', n: 2 }, { _id: 't2' }]);
        expect(state.tableTasks.p1.s1.index).toEqual({ k: 2 });
    });

    it('leaves a known list unchanged when the page is empty', () => {
        m.mutateTypesenseTableTasks(state, { pid: 'p1', sprintId: 's1', nextPage: { k: 1 }, data: { _id: 't1' } });
        m.mutateTypesenseTableTasks(state, { pid: 'p1', sprintId: 's1', nextPage: { k: 9 }, data: null });
        expect(state.tableTasks.p1.s1.index).toEqual({ k: 1 });
    });

    it('removes a row from the table when an event says the task no longer belongs to the list', () => {
        m.mutateTypesenseTableTasks(state, { pid: 'p1', sprintId: 's1', nextPage: {}, data: { _id: 't1', sprintId: 's1' } });
        m.mutateTypesenseTableTasks(state, { pid: 'p1', sprintId: 's1', nextPage: {}, op: 'modified', data: { _id: 't1', isParentTask: true, sprintId: 's2' } });
        expect(state.tableTasks.p1.s1.tasks).toEqual([]);
    });

    it('does not create a project from an event about a task that is not shown', () => {
        m.mutateTypesenseTableTasks(state, { pid: 'p1', sprintId: 's1', nextPage: {}, op: 'modified', data: { _id: 't1', isParentTask: true, sprintId: 's2' } });
        expect(state.tableTasks.p1).toBeUndefined();
    });
});

describe('search results', () => {
    it('builds a tree out of a flat search result', () => {
        m.mutateSearchTask(state, {
            op: 'added',
            data: [{ _id: 'c1', isParentTask: false, ParentTaskId: 't1' }, { _id: 't1', isParentTask: true }, { _id: 't2', isParentTask: true }]
        });
        expect(state.searchedTasks.map((t) => t._id)).toEqual(['t1', 't2']);
        expect(state.searchedTasks[0].subtaskArray.map((t) => t._id)).toEqual(['c1']);
        expect(state.searchedTasks[1].subtaskArray).toEqual([]);
    });

    it('empties the results for an empty search', () => {
        state.searchedTasks = [{ _id: 'old' }];
        m.mutateSearchTask(state, { op: 'added', data: [] });
        expect(state.searchedTasks).toEqual([]);
    });

    it('swaps in a changed task wherever it sits in the tree, and ignores an unknown one', () => {
        m.mutateSearchTask(state, { op: 'added', data: [{ _id: 't1', isParentTask: true }, { _id: 'c1', isParentTask: false, ParentTaskId: 't1', n: 1 }] });
        m.mutateSearchTask(state, { op: 'modified', data: [{ _id: 'c1', isParentTask: false, ParentTaskId: 't1', n: 2 }] });
        m.mutateSearchTask(state, { op: 'modified', data: [{ _id: 'ghost' }] });
        expect(state.searchedTasks[0].subtaskArray[0].n).toBe(2);
        expect(state.searchedTasks).toHaveLength(1);
    });
});

describe('drag and drop helpers', () => {
    beforeEach(() => {
        m.mutateTypesenseTasks(state, { pid: 'p1', sprintId: 's1', nextPage: {}, found: {}, data: { _id: 't1', isParentTask: true, idx: 1 } });
    });

    it('pushes the dragged tasks to the end of the order until the server answers', () => {
        m.mutateTaskIndex(state, { pid: 'p1', sprintId: 's1', indexName: 'idx', tasksArray: [{ _id: 't1' }, { _id: 'ghost' }] });
        expect(state.tasks.p1.s1.tasks[0].idx).toBe(99999999999999);
        expect(state.tasks.p1.s1.tasks).toHaveLength(1);
    });

    it('swaps in the dropped task when it is held, and ignores one that is not', () => {
        m.mutateTaskForDragAndDrop(state, { pid: 'p1', sprintId: 's1', task: { _id: 't1', isParentTask: true, idx: 5 } });
        m.mutateTaskForDragAndDrop(state, { pid: 'p1', sprintId: 's1', task: { _id: 'ghost' } });
        expect(state.tasks.p1.s1.tasks).toEqual([{ _id: 't1', isParentTask: true, idx: 5 }]);
    });
});

describe('project templates', () => {
    const add = (data) => m.mutateprojectTemplate(state, [{ op: 'add', data }]);

    it('clears the list when there are no templates', () => {
        state.projectTemplate = { data: [{ _id: 'a' }] };
        m.mutateprojectTemplate(state, []);
        expect(state.projectTemplate).toEqual({});
        state.projectTemplate = { data: [{ _id: 'a' }] };
        m.mutateprojectTemplate(state, undefined);
        expect(state.projectTemplate).toEqual({});
    });

    it('lists the newest template first and replaces one that already exists', () => {
        add({ _id: 'a', id: 'a', name: 'A' });
        add({ _id: 'b', id: 'b', name: 'B' });
        add({ _id: 'a', id: 'a', name: 'A2' });
        expect(state.projectTemplate.data.map((t) => t.name)).toEqual(['B', 'A2']);
    });

    it('deletes a template, and returns to the empty state when the last one goes', () => {
        add({ _id: 'a', id: 'a' });
        add({ _id: 'b', id: 'b' });
        m.mutateprojectTemplate(state, [{ op: 'del', data: { id: 'a' } }]);
        expect(state.projectTemplate.data.map((t) => t.id)).toEqual(['b']);
        m.mutateprojectTemplate(state, [{ op: 'del', data: { id: 'nope' } }]);
        expect(state.projectTemplate.data).toHaveLength(1);
        m.mutateprojectTemplate(state, [{ op: 'del', data: { id: 'b' } }]);
        expect(state.projectTemplate).toEqual({});
    });
});

describe.each([
    ['sprints', 'mutateSprints', 'sprints', 'id'],
    ['folders', 'mutateFolders', 'folders', '_id']
])('%s per project', (_n, mutation, key, removeBy) => {
    const run = (op, data) => m[mutation](state, { op, data });
    const idsOf = (pid) => state[key][pid].map((x) => x._id);

    it('adds items once per id and edits them in place', () => {
        run('added', { _id: 'x1', projectId: 'p1', name: 'a' });
        run('added', { _id: 'x1', projectId: 'p1', name: 'dup' });
        run('added', { _id: 'x2', projectId: 'p1' });
        run('modified', { _id: 'x1', projectId: 'p1', name: 'b' });
        run('modified', { _id: 'ghost', projectId: 'p1' });
        run('modified', { _id: 'x1', projectId: 'unknown' });
        expect(state[key].p1).toEqual([{ _id: 'x1', projectId: 'p1', name: 'b' }, { _id: 'x2', projectId: 'p1' }]);
        expect(state[key].unknown).toBeUndefined();
    });

    it('removes an item', () => {
        run('added', { _id: 'x1', id: 'x1', projectId: 'p1' });
        run('added', { _id: 'x2', id: 'x2', projectId: 'p1' });
        run('removed', { [removeBy]: 'x1', projectId: 'p1' });
        expect(idsOf('p1')).toEqual(['x2']);
    });

    // a new project replaces the whole map, so loading a second project's items forgets the first
    it.fails('keeps the items of other projects when another project is loaded', () => {
        run('added', { _id: 'x1', projectId: 'p1' });
        run('added', { _id: 'x2', projectId: 'p2' });
        expect(Object.keys(state[key]).sort()).toEqual(['p1', 'p2']);
    });
});

describe('folders edge cases', () => {
    // no guard for a project with no folders loaded, so findIndex returns undefined and splice runs on undefined
    it.fails('ignores removing a folder of a project with no folders', () => {
        expect(() => m.mutateFolders(state, { op: 'removed', data: { _id: 'f1', projectId: 'p9' } })).not.toThrow();
    });

    it('replaces the folders of one project and leaves the others', () => {
        state.folders = { p1: [{ _id: 'a' }], p2: [{ _id: 'b' }] };
        m.replaceFolders(state, { projectId: 'p1', folders: [{ _id: 'c' }] });
        expect(state.folders).toEqual({ p1: [{ _id: 'c' }], p2: [{ _id: 'b' }] });
    });
});

describe('local project edits (projectLocalUpdate)', () => {
    const edit = (key, extra = {}) => m.projectLocalUpdate(state, { key, ...extra });
    const first = () => state.allProjects.data[0];

    beforeEach(() => {
        loadProjects(project('p1', { AssigneeUserId: ['u1', 'u2'], LeadUserId: ['u2'], watchers: { u1: 'all' }, ProjectRequiredComponent: [{ _id: 'v1', name: 'List' }] }));
    });

    it('renames a project', () => {
        edit('ProjectName', { itemData: { _id: 'p1', ProjectName: 'Renamed' } });
        expect(first().ProjectName).toBe('Renamed');
    });

    it('swaps in a removed project and drops it from search results', () => {
        state.searchedProjects = [{ _id: 'p1' }, { _id: 'p2' }];
        edit('RemoveProject', { itemData: project('p1', { deletedStatusKey: 1 }) });
        expect(first().deletedStatusKey).toBe(1);
        expect(state.searchedProjects.map((p) => p._id)).toEqual(['p2']);
    });

    it('stars and unstars a project for a user', () => {
        edit('MarkAsFavourite', { itemData: { _id: 'p1' }, subKey: 'add', userId: 'u1' });
        edit('MarkAsFavourite', { itemData: { _id: 'p1' }, subKey: 'add', userId: 'u2' });
        expect(first().favouriteTasks).toEqual([{ userId: 'u1' }, { userId: 'u2' }]);
        edit('MarkAsFavourite', { itemData: { _id: 'p1' }, subKey: 'remove', userId: 'u1' });
        edit('MarkAsFavourite', { itemData: { _id: 'p1' }, subKey: 'remove', userId: 'nobody' });
        expect(first().favouriteTasks).toEqual([{ userId: 'u2' }]);
    });

    it('sets the icon', () => {
        edit('ProjectIcon', { itemData: 'rocket', projectId: 'p1' });
        expect(first().projectIcon).toBe('rocket');
    });

    it('adds a member, and removes a member who also stops being a lead', () => {
        edit('AssigneeChange', { subKey: 'add', userId: 'u3', projectId: 'p1' });
        expect(first().AssigneeUserId).toEqual(['u1', 'u2', 'u3']);
        edit('AssigneeChange', { subKey: 'remove', userId: 'u2', projectId: 'p1' });
        expect(first().AssigneeUserId).toEqual(['u1', 'u3']);
        expect(first().LeadUserId).toEqual([]);
    });

    it('makes a lead a member too, and removing a lead removes both roles', () => {
        edit('LeadUserChange', { subKey: 'add', userId: 'u3', projectId: 'p1' });
        expect(first().AssigneeUserId).toContain('u3');
        expect(first().LeadUserId).toEqual(['u2', 'u3']);
        edit('LeadUserChange', { subKey: 'remove', userId: 'u3', projectId: 'p1' });
        expect(first().AssigneeUserId).not.toContain('u3');
        expect(first().LeadUserId).toEqual(['u2']);
    });

    it('sets and clears a watcher', () => {
        edit('ProjectWatcher', { subKey: '$set', userId: 'u2', itemData: { watchType: 'mentions' }, projectId: 'p1' });
        expect(first().watchers).toEqual({ u1: 'all', u2: 'mentions' });
        edit('ProjectWatcher', { subKey: '$unset', userId: 'u1', projectId: 'p1' });
        expect(first().watchers).toEqual({ u2: 'mentions' });
    });

    it('adds, edits and deletes a project view', () => {
        edit('ProjectView', { subKey: 'add', itemData: { _id: 'v2', name: 'Board' }, projectId: 'p1' });
        edit('ProjectView', { subKey: 'edit', itemData: { elementId: 'v1', field: 'name', updateValue: 'Table' }, projectId: 'p1' });
        edit('ProjectView', { subKey: 'edit', itemData: { elementId: 'ghost', field: 'name', updateValue: 'x' }, projectId: 'p1' });
        expect(first().ProjectRequiredComponent).toEqual([{ _id: 'v1', name: 'Table' }, { _id: 'v2', name: 'Board' }]);
        edit('ProjectView', { subKey: 'delete', itemData: { _id: 'v1' }, projectId: 'p1' });
        expect(first().ProjectRequiredComponent.map((v) => v._id)).toEqual(['v2']);
    });

    it('replaces apps and tabs wholesale', () => {
        edit('ProjectAppChange', { itemData: ['chat'], projectId: 'p1' });
        edit('ProjectTabChange', { itemData: [{ _id: 'tab' }], projectId: 'p1' });
        expect(first().apps).toEqual(['chat']);
        expect(first().ProjectRequiredComponent).toEqual([{ _id: 'tab' }]);
    });

    it('swaps in the project when its type changes, and for any other key', () => {
        edit('ProjectTypeChange', { itemData: project('p1', { type: 'agile' }), projectId: 'p1' });
        expect(first().type).toBe('agile');
        edit('SomethingElse', { itemData: project('p1', { type: 'kanban' }) });
        expect(first().type).toBe('kanban');
    });

    it('does nothing for a project that is not listed', () => {
        const before = JSON.stringify(state.allProjects);
        edit('ProjectName', { itemData: { _id: 'zzz', ProjectName: 'x' } });
        edit('ProjectIcon', { itemData: 'x', projectId: 'zzz' });
        edit('AssigneeChange', { subKey: 'add', userId: 'u9', projectId: 'zzz' });
        edit('SomethingElse', { itemData: { _id: 'zzz' } });
        expect(JSON.stringify(state.allProjects)).toBe(before);
    });
});

describe('moving a sprint between folders (relocateSprint)', () => {
    const sprint = (id, seconds, extra = {}) => ({ id, _id: id, projectId: 'p1', createdAt: { seconds }, ...extra });
    beforeEach(() => {
        loadProjects(project('p1', {
            sprintsObj: { s1: sprint('s1', 10), s2: sprint('s2', 20) },
            sprintsfolders: { f1: { name: 'Design', sprintsObj: { s3: sprint('s3', 5, { folderId: 'f1' }) } }, f2: { name: 'Dev', sprintsObj: {} } }
        }));
    });
    const proj = () => state.allProjects.data[0];

    it('moves a root sprint into a folder', () => {
        m.relocateSprint(state, { data: sprint('s1', 10, { folderId: 'f2', folderName: 'Dev' }), oldFolderId: null });
        expect(Object.keys(proj().sprintsObj)).toEqual(['s2']);
        expect(proj().sprintsfolders.f2.sprintsObj.s1).toMatchObject({ folderId: 'f2', folderName: 'Dev' });
    });

    it('moves a folder sprint to the root, newest first, without a folder name', () => {
        m.relocateSprint(state, { data: sprint('s3', 5, { folderId: null }), oldFolderId: 'f1' });
        expect(proj().sprintsfolders.f1.sprintsObj).toEqual({});
        expect(Object.keys(proj().sprintsObj)).toEqual(['s2', 's1', 's3']);
        expect(proj().sprintsObj.s3).toMatchObject({ folderId: null, folderName: '' });
    });

    it('moves a sprint from one folder to another', () => {
        m.relocateSprint(state, { data: sprint('s3', 5, { folderId: 'f2', folderName: 'Dev' }), oldFolderId: 'f1' });
        expect(Object.keys(proj().sprintsfolders.f1.sprintsObj)).toEqual([]);
        expect(Object.keys(proj().sprintsfolders.f2.sprintsObj)).toEqual(['s3']);
    });

    it('creates the folder bucket when the target folder was not loaded', () => {
        delete proj().sprintsfolders;
        m.relocateSprint(state, { data: sprint('s1', 10, { folderId: 'f9', folderName: 'New' }), oldFolderId: null });
        expect(Object.keys(proj().sprintsfolders.f9.sprintsObj)).toEqual(['s1']);
    });

    it('carries the new folder onto the tasks of that sprint that are already loaded', () => {
        state.tasks = { p1: { s1: { tasks: [{ _id: 't1', folderObjId: 'old', subtaskArray: [{ _id: 'c1' }] }] } } };
        state.tableTasks = { p1: { s1: { tasks: [{ _id: 't1' }] } } };
        m.relocateSprint(state, { data: sprint('s1', 10, { folderId: 'f2', folderName: 'Dev' }), oldFolderId: null });
        const t = state.tasks.p1.s1.tasks[0];
        expect(t).toMatchObject({ folderObjId: 'f2', sprintArray: { folderId: 'f2', folderName: 'Dev' } });
        expect(t.subtaskArray[0].folderObjId).toBe('f2');
        expect(state.tableTasks.p1.s1.tasks[0].folderObjId).toBe('f2');
    });

    it('removes the folder from loaded tasks when the sprint goes back to the root', () => {
        state.tasks = { p1: { s3: { tasks: [{ _id: 't1', folderObjId: 'f1', sprintArray: { folderId: 'f1', folderName: 'Design', keep: 1 } }] } } };
        m.relocateSprint(state, { data: sprint('s3', 5), oldFolderId: 'f1' });
        const t = state.tasks.p1.s3.tasks[0];
        expect(t.folderObjId).toBeUndefined();
        expect(t.sprintArray).toEqual({ keep: 1 });
    });

    it('does nothing without data, for an unknown project, or with no projects loaded', () => {
        const before = JSON.stringify(state.allProjects);
        m.relocateSprint(state, undefined);
        m.relocateSprint(state, { data: sprint('s1', 1, { projectId: 'zzz' }) });
        m.relocateSprint(state, { data: { id: 's1' } });
        expect(JSON.stringify(state.allProjects)).toBe(before);
        state.allProjects = [];
        expect(() => m.relocateSprint(state, { data: sprint('s1', 1) })).not.toThrow();
    });
});

describe('project search results', () => {
    beforeEach(() => {
        loadProjects(project('p1'), project('p2'));
    });

    it('takes name search results as they are', () => {
        const found = [{ _id: 'p2' }];
        m.mutateSearchedProjects(state, { searchType: 'projectName', data: found });
        expect(state.searchedProjects).toBe(found);
    });

    it('builds root sprints and folder sprints for a sprint search, and skips projects that are not loaded', () => {
        m.mutateSearchedProjects(state, {
            searchType: 'sprint',
            data: [
                {
                    _id: 'p1',
                    sprints: [{ _id: 's1', projectId: 'p1' }, { _id: 's2', projectId: 'p1', folderId: 'f1' }, { _id: 's3', projectId: 'p1', folderId: 'gone' }],
                    folders: [{ _id: 'f1', projectId: 'p1', name: 'Design' }]
                },
                { _id: 'unknown', sprints: [], folders: [] }
            ]
        });
        expect(state.searchedProjects).toHaveLength(1);
        const found = state.searchedProjects[0];
        expect(Object.keys(found.sprintsObj)).toEqual(['s1']);
        expect(found.sprintsfolders.f1).toMatchObject({ name: 'Design', parentFolderId: null, isExpanded: true });
        expect(found.sprintsfolders.f1.sprintsObj.s2).toMatchObject({ id: 's2', folderName: 'Design' });
        expect(found.sprintsfolders.f1.sprintsObj.s3).toBeUndefined();
    });

    it('handles a folder search with no folders in the answer', () => {
        m.mutateSearchedProjects(state, { searchType: 'folder', data: [{ _id: 'p1', sprints: [{ _id: 's1', projectId: 'p1' }] }] });
        expect(state.searchedProjects[0].sprintsfolders).toBeUndefined();
    });

    it('shows the loaded project itself for a project filter', () => {
        m.mutateSearchedProjects(state, { searchType: 'projectFilter', data: [{ _id: 'p2' }, { _id: 'nope' }] });
        expect(state.searchedProjects.map((p) => p._id)).toEqual(['p2']);
    });

    it('swaps in a changed search result and ignores one that is not listed', () => {
        state.searchedProjects = [{ _id: 'p1', ProjectName: 'a' }];
        m.mutateExistingSearchedProjects(state, { _id: 'p1', ProjectName: 'b' });
        m.mutateExistingSearchedProjects(state, { _id: 'zzz', ProjectName: 'c' });
        expect(state.searchedProjects).toEqual([{ _id: 'p1', ProjectName: 'b' }]);
    });
});

describe('all-tasks list (mutateAllTask)', () => {
    const run = (data, projectIds = ['p1']) => m.mutateAllTask(state, { data, projectIds });

    it('adds a task, merges a repeat, and keeps only tasks of the wanted projects', () => {
        run({ _id: 't1', isParentTask: true, ProjectID: 'p1', n: 1, keep: 1 });
        run({ _id: 't1', isParentTask: true, ProjectID: 'p1', n: 2 });
        run({ _id: 't2', isParentTask: true, ProjectID: 'p2' });
        expect(state.allTaskData).toEqual([{ _id: 't1', isParentTask: true, ProjectID: 'p1', n: 2, keep: 1 }]);
    });

    it('drops tasks of a project that is no longer wanted', () => {
        run({ _id: 't1', isParentTask: true, ProjectID: 'p1' }, ['p1', 'p2']);
        run({ _id: 't2', isParentTask: true, ProjectID: 'p2' }, ['p1', 'p2']);
        run({ _id: 't3', isParentTask: true, ProjectID: 'p1' }, ['p2']);
        expect(state.allTaskData.map((t) => t._id)).toEqual(['t2']);
    });

    it('nests subtasks under their parent, replacing one it already has, and ignores an orphan', () => {
        run({ _id: 't1', isParentTask: true, ProjectID: 'p1' });
        run({ _id: 'c1', isParentTask: false, ParentTaskId: 't1', n: 1 });
        run({ _id: 'c1', isParentTask: false, ParentTaskId: 't1', n: 2 });
        run({ _id: 'c2', isParentTask: false, ParentTaskId: 'ghost' });
        expect(state.allTaskData).toHaveLength(1);
        expect(state.allTaskData[0].subtaskArray).toEqual([{ _id: 'c1', isParentTask: false, ParentTaskId: 't1', n: 2 }]);
    });
});
