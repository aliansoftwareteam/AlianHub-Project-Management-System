/* The task store keeps three levels: a row sits under its parent at any depth, whichever of
   them arrives first, and one event moves it when its parent changes. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/composable/index.js', () => ({ useCustomComposable: () => ({ checkPermission: () => 0 }) }));

import { mutateUpdateFirebaseTasks, mutateTypesenseTasks, mutateSearchTask } from '@/store/ProjectData/mutations';

const PID = 'p1';
const SPRINT = 's1';

const top = (id, over = {}) => ({ _id: id, TaskName: `Task ${id}`, ProjectID: PID, sprintId: SPRINT, isParentTask: true, ParentTaskId: '', ancestors: [], statusKey: 1, subTasks: 0, ...over });
const child = (id, parentId, over = {}) => ({ _id: id, TaskName: `Subtask ${id}`, ProjectID: PID, sprintId: SPRINT, isParentTask: false, ParentTaskId: parentId, ancestors: [parentId], statusKey: 1, subTasks: 0, ...over });
const grandchild = (id, parentId, rootId, over = {}) => child(id, parentId, { ancestors: [rootId, parentId], ...over });

let state;
const bucket = () => state.tasks[PID][SPRINT];
const seed = (tasks = []) => {
    state = { tasks: { [PID]: { projectId: PID, sprints: [SPRINT], [SPRINT]: { index: {}, found: {}, tasks, snapshot: null } } }, searchedTasks: [] };
};

const fromSocket = (op, data, updatedFields = {}) => mutateUpdateFirebaseTasks(state, { snap: {}, op, pid: PID, sprintId: SPRINT, data: { ...data }, updatedFields });
const fromPage = (data, parentId = '') => mutateTypesenseTasks(state, {
    pid: PID, sprintId: SPRINT, data: { ...data }, found: {}, nextPage: { [`${parentId ? `${parentId}_` : ''}statusKey_1`]: 1 }
});

const ids = (rows) => (rows || []).map((row) => row._id);
const rowAt = (...path) => path.reduce((rows, id, index) => {
    const row = (rows || []).find((candidate) => candidate._id === id);
    return index === path.length - 1 ? row : row?.subtaskArray;
}, bucket().tasks);
const everyId = (rows = bucket().tasks) => rows.flatMap((row) => [row._id, ...everyId(row.subtaskArray || [])]);

beforeEach(() => seed([top('t1', { subTasks: 1 })]));

describe('a row sits under its parent at any depth', () => {
    it('a page of children goes under a top-level task', () => {
        fromPage(child('a', 't1'), 't1');
        fromPage(child('b', 't1'), 't1');
        expect(ids(rowAt('t1').subtaskArray)).toEqual(['a', 'b']);
    });

    it('a page of grandchildren goes under their level-two parent, not to the top', () => {
        fromPage(child('a', 't1', { subTasks: 2 }), 't1');
        fromPage(grandchild('a1', 'a', 't1'), 'a');
        fromPage(grandchild('a2', 'a', 't1'), 'a');
        expect(ids(bucket().tasks)).toEqual(['t1']);
        expect(ids(rowAt('t1', 'a').subtaskArray)).toEqual(['a1', 'a2']);
    });

    it('a socket insert of a level-three row lands under its level-two parent', () => {
        fromPage(child('a', 't1'), 't1');
        fromSocket('added', grandchild('a1', 'a', 't1'), grandchild('a1', 'a', 't1'));
        expect(ids(rowAt('t1', 'a').subtaskArray)).toEqual(['a1']);
    });

    it('a socket update of a level-three row changes that row where it is', () => {
        fromPage(child('a', 't1'), 't1');
        fromPage(grandchild('a1', 'a', 't1'), 'a');
        fromSocket('modified', grandchild('a1', 'a', 't1', { statusKey: 2 }), { statusKey: 2 });
        expect(rowAt('t1', 'a', 'a1').statusKey).toBe(2);
        expect(everyId()).toEqual(['t1', 'a', 'a1']);
    });

    it('keeps the children a row holds when the row itself is updated or read again', () => {
        fromPage(child('a', 't1'), 't1');
        fromPage(grandchild('a1', 'a', 't1'), 'a');
        fromSocket('modified', child('a', 't1', { TaskName: 'Renamed' }), { TaskName: 'Renamed' });
        fromPage(child('a', 't1', { TaskName: 'Read again' }), 't1');
        expect(rowAt('t1', 'a').TaskName).toBe('Read again');
        expect(ids(rowAt('t1', 'a').subtaskArray)).toEqual(['a1']);
    });

    it('falls back to ParentTaskId for a row stored before the ancestors field existed', () => {
        fromPage({ ...child('a', 't1'), ancestors: undefined }, 't1');
        fromPage({ ...grandchild('a1', 'a', 't1'), ancestors: undefined }, 'a');
        expect(ids(rowAt('t1', 'a').subtaskArray)).toEqual(['a1']);
    });

    it('merges a partial update into the row at any depth, and never makes a row out of one', () => {
        fromPage(child('a', 't1'), 't1');
        fromPage(grandchild('a1', 'a', 't1'), 'a');
        mutateUpdateFirebaseTasks(state, { snap: null, op: 'modified', pid: PID, sprintId: SPRINT, data: { _id: 'a1', tagsArray: ['tag1'] }, updatedFields: { tagsArray: ['tag1'] } });
        mutateUpdateFirebaseTasks(state, { snap: null, op: 'modified', pid: PID, sprintId: SPRINT, data: { _id: 'unknown', tagsArray: ['tag1'] }, updatedFields: { tagsArray: ['tag1'] } });
        expect(rowAt('t1', 'a', 'a1')).toMatchObject({ TaskName: 'Subtask a1', tagsArray: ['tag1'] });
        expect(everyId()).toEqual(['t1', 'a', 'a1']);
    });
});

describe('a row whose parent is not in the store yet', () => {
    it('is held, not dropped, and attached when the parent loads', () => {
        fromSocket('modified', grandchild('a1', 'a', 't1', { statusKey: 2 }), { statusKey: 2 });
        expect(everyId()).toEqual(['t1']);

        fromPage(child('a', 't1', { subTasks: 1 }), 't1');
        expect(ids(rowAt('t1', 'a').subtaskArray)).toEqual(['a1']);
        expect(rowAt('t1', 'a', 'a1').statusKey).toBe(2);
    });

    it('is attached with its own children when a whole branch arrives bottom up', () => {
        seed([]);
        fromSocket('added', grandchild('a1', 'a', 't1'), grandchild('a1', 'a', 't1'));
        fromSocket('added', child('a', 't1'), child('a', 't1'));
        expect(everyId()).toEqual([]);

        fromSocket('added', top('t1'), top('t1'));
        expect(everyId()).toEqual(['t1', 'a', 'a1']);
    });

    it('is held once, however many events arrive for it', () => {
        fromSocket('modified', grandchild('a1', 'a', 't1', { statusKey: 2 }), { statusKey: 2 });
        fromSocket('modified', grandchild('a1', 'a', 't1', { statusKey: 3 }), { statusKey: 3 });
        fromPage(child('a', 't1'), 't1');
        expect(ids(rowAt('t1', 'a').subtaskArray)).toEqual(['a1']);
        expect(rowAt('t1', 'a', 'a1').statusKey).toBe(3);
    });

    it('is forgotten when it is removed before its parent arrives', () => {
        fromSocket('added', grandchild('a1', 'a', 't1'), grandchild('a1', 'a', 't1'));
        fromSocket('removed', grandchild('a1', 'a', 't1'));
        fromPage(child('a', 't1'), 't1');
        expect(everyId()).toEqual(['t1', 'a']);
    });
});

describe('one event moves a row whose parent changes', () => {
    beforeEach(() => {
        seed([top('t1', { subTasks: 1 }), top('t2', { subTasks: 1 })]);
        fromPage(child('a', 't1', { subTasks: 1 }), 't1');
        fromPage(grandchild('a1', 'a', 't1'), 'a');
        fromPage(child('b', 't2'), 't2');
    });

    it('a subtask converted to a task goes to the top with its own subtasks', () => {
        const promoted = { ...child('a', 't1', { subTasks: 1 }), isParentTask: true, ParentTaskId: '', ancestors: [] };
        fromSocket('modified', promoted, { isParentTask: true, ParentTaskId: '', ancestors: [] });
        expect(ids(bucket().tasks)).toEqual(['t1', 't2', 'a']);
        expect(ids(rowAt('t1').subtaskArray)).toEqual([]);
        expect(ids(rowAt('a').subtaskArray)).toEqual(['a1']);
    });

    it('a task converted to a subtask leaves the top and goes under its new parent', () => {
        const nested = { ...top('t2', { subTasks: 1 }), isParentTask: false, ParentTaskId: 't1', ancestors: ['t1'] };
        fromSocket('modified', nested, { isParentTask: false, ParentTaskId: 't1', ancestors: ['t1'] });
        expect(ids(bucket().tasks)).toEqual(['t1']);
        expect(ids(rowAt('t1').subtaskArray)).toEqual(['a', 't2']);
        expect(ids(rowAt('t1', 't2').subtaskArray)).toEqual(['b']);
    });

    it('a level-three row moved under another parent leaves the old one', () => {
        fromSocket('modified', grandchild('a1', 'b', 't2'), { ParentTaskId: 'b', ancestors: ['t2', 'b'] });
        expect(ids(rowAt('t1', 'a').subtaskArray)).toEqual([]);
        expect(ids(rowAt('t2', 'b').subtaskArray)).toEqual(['a1']);
        expect(everyId().filter((id) => id === 'a1')).toHaveLength(1);
    });

    it('a row moved under a parent the store does not hold leaves its old place and waits', () => {
        fromSocket('modified', grandchild('a1', 'x', 't9'), { ParentTaskId: 'x', ancestors: ['t9', 'x'] });
        expect(everyId()).toEqual(['t1', 'a', 't2', 'b']);
    });

    it('a row moved to another sprint leaves this one, with what is under it', () => {
        fromSocket('modified', { ...top('t1', { subTasks: 1 }), sprintId: 's2' }, { sprintId: 's2' });
        expect(everyId()).toEqual(['t2', 'b']);
    });
});

describe('removing a row', () => {
    beforeEach(() => {
        fromPage(child('a', 't1', { subTasks: 2 }), 't1');
        fromPage(child('b', 't1'), 't1');
        fromPage(grandchild('a1', 'a', 't1'), 'a');
        fromPage(grandchild('a2', 'a', 't1'), 'a');
    });

    it('a removed level-two row takes its children out of the store', () => {
        fromSocket('removed', child('a', 't1'));
        expect(everyId()).toEqual(['t1', 'b']);
    });

    it('a removed level-three row leaves its siblings', () => {
        fromSocket('removed', grandchild('a1', 'a', 't1'));
        expect(ids(rowAt('t1', 'a').subtaskArray)).toEqual(['a2']);
    });

    it('removing a row the store does not hold removes nothing', () => {
        fromSocket('removed', grandchild('zz', 'a', 't1'));
        fromSocket('removed', child('yy', 't1'));
        expect(everyId()).toEqual(['t1', 'a', 'a1', 'a2', 'b']);
    });

    it('lowers the parent count by the one row removed, whatever part of its children is loaded', () => {
        seed([top('t1', { subTasks: 40 })]);
        fromPage(child('a', 't1'), 't1');
        fromPage(child('b', 't1'), 't1');
        fromSocket('removed', child('a', 't1'));
        expect(rowAt('t1').subTasks).toBe(39);
    });
});

describe('a search result keeps three levels', () => {
    it('nests each match under its parent, whatever order the rows come in', () => {
        mutateSearchTask(state, { op: 'added', data: [grandchild('a1', 'a', 't1'), child('a', 't1'), top('t1'), top('t2')] });
        const found = state.searchedTasks;
        expect(ids(found).sort()).toEqual(['t1', 't2']);
        const root = found.find((row) => row._id === 't1');
        expect(ids(root.subtaskArray)).toEqual(['a']);
        expect(ids(root.subtaskArray[0].subtaskArray)).toEqual(['a1']);
        expect(found.find((row) => row._id === 't2').subtaskArray).toEqual([]);
    });

    it('leaves out a match whose parents did not come with it', () => {
        mutateSearchTask(state, { op: 'added', data: [grandchild('a1', 'a', 't1'), top('t2')] });
        expect(ids(state.searchedTasks)).toEqual(['t2']);
    });

    it('updates a searched row at any depth', () => {
        mutateSearchTask(state, { op: 'added', data: [top('t1'), child('a', 't1'), grandchild('a1', 'a', 't1')] });
        mutateSearchTask(state, { op: 'modified', data: [grandchild('a1', 'a', 't1', { statusKey: 2 })] });
        expect(state.searchedTasks[0].subtaskArray[0].subtaskArray[0].statusKey).toBe(2);
    });
});
