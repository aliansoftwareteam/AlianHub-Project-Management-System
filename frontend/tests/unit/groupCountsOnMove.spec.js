/* A group counts a task where it lives. When the server moves a task between lists or between
   statuses, each group it left and each group it entered has to read the new number, including a
   list that is held but not on screen and a task the store never loaded. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/composable/index.js', () => ({ useCustomComposable: () => ({ checkPermission: () => true }) }));

import { mutateUpdateFirebaseTasks } from '@/store/ProjectData/mutations';

const PID = 'p1';
const FROM = 'list-from';
const INTO = 'list-into';
const TODO = { key: 'statusKey_1', value: 1 };
const REVIEW = { key: 'statusKey_2', value: 2 };

const task = (id, over = {}) => ({
    _id: id, TaskName: `Task ${id}`, ProjectID: PID, sprintId: FROM, isParentTask: true,
    ParentTaskId: '', ancestors: [], statusKey: 1, deletedStatusKey: 0, subTasks: 0, ...over
});

let state;
const seed = (buckets) => {
    state = {
        tasks: {
            [PID]: {
                projectId: PID,
                sprints: Object.keys(buckets),
                groupBy: { type: 0, items: [TODO, REVIEW] },
                ...Object.fromEntries(Object.entries(buckets).map(([id, { rows, found }]) => [id, { index: {}, found, tasks: rows, snapshot: null }]))
            }
        },
        tableTasks: {},
        searchedTasks: []
    };
};
const found = (sprintId) => state.tasks[PID][sprintId].found;
const stale = (sprintId) => state.tasks[PID][sprintId].countsStale || 0;
const fromServer = (roomId, data, updatedFields) => mutateUpdateFirebaseTasks(state, { snap: {}, op: 'modified', pid: PID, sprintId: roomId, data: { ...data }, updatedFields });

beforeEach(() => {
    seed({
        [FROM]: { rows: [task('t1'), task('t2')], found: { statusKey_1: 2, statusKey_2: 0 } },
        [INTO]: { rows: [task('t3', { sprintId: INTO })], found: { statusKey_1: 12, statusKey_2: 0 } }
    });
});

describe('a task the server moves from one list to another', () => {
    it('lowers the count of the group it left and raises the count of the group it entered', () => {
        fromServer(FROM, task('t1', { sprintId: INTO }), { sprintId: INTO });

        expect(found(FROM)).toEqual({ statusKey_1: 1, statusKey_2: 0 });
        expect(found(INTO)).toEqual({ statusKey_1: 13, statusKey_2: 0 });
    });

    it('does the same when the event reaches the list the task entered', () => {
        fromServer(INTO, task('t1', { sprintId: INTO }), { sprintId: INTO });

        expect(found(FROM)).toEqual({ statusKey_1: 1, statusKey_2: 0 });
        expect(found(INTO)).toEqual({ statusKey_1: 13, statusKey_2: 0 });
    });

    it('counts the entered group by the status the task has now', () => {
        fromServer(FROM, task('t1', { sprintId: INTO, statusKey: 2 }), { sprintId: INTO, statusKey: 2 });

        expect(found(FROM)).toEqual({ statusKey_1: 1, statusKey_2: 0 });
        expect(found(INTO)).toEqual({ statusKey_1: 12, statusKey_2: 1 });
    });

    it('raises the marker of the list it entered, so the list on screen asks the server', () => {
        fromServer(FROM, task('t1', { sprintId: INTO }), { sprintId: INTO });

        expect(stale(FROM)).toBe(1);
        expect(stale(INTO)).toBe(1);
    });

    it('counts a task the store never loaded in the list it entered, and leaves the other lists alone', () => {
        fromServer(INTO, task('t9', { sprintId: INTO, statusKey: 2 }), { sprintId: INTO });

        expect(found(INTO)).toEqual({ statusKey_1: 12, statusKey_2: 1 });
        expect(found(FROM)).toEqual({ statusKey_1: 2, statusKey_2: 0 });
        expect(stale(INTO)).toBe(1);
    });

    it('counts it once when the same event arrives through both lists', () => {
        fromServer(FROM, task('t1', { sprintId: INTO }), { sprintId: INTO });
        fromServer(INTO, task('t1', { sprintId: INTO }), { sprintId: INTO });

        expect(found(FROM)).toEqual({ statusKey_1: 1, statusKey_2: 0 });
        expect(found(INTO)).toEqual({ statusKey_1: 13, statusKey_2: 0 });
    });

    it('does not count a task added to a list, which still lives elsewhere', () => {
        const extra = [{ projectId: PID, sprintId: INTO, addedBy: 'u1', addedAt: '2026-10-01T00:00:00.000Z' }];
        fromServer(INTO, task('t1', { sprintId: FROM, extraLists: extra }), { extraLists: extra });

        expect(found(INTO)).toEqual({ statusKey_1: 12, statusKey_2: 0 });
        expect(found(FROM)).toEqual({ statusKey_1: 2, statusKey_2: 0 });
    });
});

describe('a task the server moves between statuses of one list', () => {
    it('lowers the status it left and raises the status it entered', () => {
        fromServer(FROM, task('t1', { statusKey: 2 }), { statusKey: 2 });

        expect(found(FROM)).toEqual({ statusKey_1: 1, statusKey_2: 1 });
        expect(found(INTO)).toEqual({ statusKey_1: 12, statusKey_2: 0 });
    });

    it('raises the status it entered for a task the store never loaded', () => {
        fromServer(FROM, task('t9', { statusKey: 2 }), { statusKey: 2 });

        expect(found(FROM).statusKey_2).toBe(1);
        expect(stale(FROM)).toBe(1);
    });
});
