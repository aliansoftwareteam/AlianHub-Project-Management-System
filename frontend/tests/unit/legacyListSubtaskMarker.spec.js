/* The legacy item list (ItemList, Task) no longer reads "the row holds some subtasks" as "its
   subtasks were read": it uses the store's own marker and the List's counting rule. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

vi.mock('@/composable/index.js', () => ({ useCustomComposable: () => ({ checkPermission: () => 0 }) }));

import { mutateTypesenseTasks, mutateUpdateFirebaseTasks } from '@/store/ProjectData/mutations';
import { childrenWereRead } from '@/store/ProjectData/taskTree';
import { subtaskProgress } from '@/views/Projects/ListView/subtaskProgress';
import { PID, SPRINT, TODO_GROUP, row, under } from '../threeLevelTasks';

const SRC = path.resolve(__dirname, '../../src');
const source = (file) => readFileSync(path.join(SRC, file), 'utf8');

let state;
const bucket = () => state.tasks[PID][SPRINT];
const parent = row('t1', 'Parent', { subTasks: 30 });

beforeEach(() => {
    state = { tasks: { [PID]: { projectId: PID, sprints: [SPRINT], [SPRINT]: { index: {}, found: {}, tasks: [{ ...parent }], snapshot: null } } }, searchedTasks: [] };
});

describe('whether a task\'s subtasks were read', () => {
    it('is not said by rows that arrived as events', () => {
        const added = under(parent, 's1', 'Child one');
        mutateUpdateFirebaseTasks(state, { snap: {}, op: 'added', pid: PID, sprintId: SPRINT, data: added, updatedFields: added });
        expect(bucket().tasks[0].subtaskArray).toHaveLength(1);
        expect(childrenWereRead(bucket(), 't1', TODO_GROUP)).toBe(false);
    });

    it('is said by the page the loader read for that task', () => {
        mutateTypesenseTasks(state, { pid: PID, sprintId: SPRINT, data: under(parent, 's1', 'Child one'), found: {}, nextPage: { t1_statusKey_1: 1 } });
        expect(childrenWereRead(bucket(), 't1', TODO_GROUP)).toBe(true);
    });

    it('is said for a task with no subtasks once it was asked', () => {
        mutateTypesenseTasks(state, { pid: PID, sprintId: SPRINT, data: null, found: {}, nextPage: { t1_statusKey_1: 0 } });
        expect(childrenWereRead(bucket(), 't1', TODO_GROUP)).toBe(true);
    });

    it('is false for a sprint the store does not hold', () => {
        expect(childrenWereRead(undefined, 't1', TODO_GROUP)).toBe(false);
    });
});

describe('the legacy list', () => {
    const itemList = source('components/organisms/ItemList/ItemList.vue');
    const task = source('components/organisms/Task/Task.vue');

    it('reads a row\'s subtasks when they were not read, however many the row already holds', () => {
        expect(itemList).toMatch(/childrenWereRead\(/);
        expect(itemList).not.toMatch(/subtaskArray\.length\s*<\s*25/);
    });

    it('asks for the subtasks of the row that was opened, on any level', () => {
        expect(itemList).not.toMatch(/parentId:\s*task\.isParentTask\s*\?/);
    });

    it('counts done subtasks with the List\'s rule', () => {
        expect(task).toMatch(/import \{[^}]*subtaskProgress[^}]*\} from ['"]@\/views\/Projects\/ListView\/subtaskProgress['"]/);
        expect(task).not.toMatch(/if \(loaded\.length\) \{/);
        expect(task).not.toMatch(/subtaskArray\.length\) return;/);
    });

    it('that rule trusts the loaded rows only when they are all of them', () => {
        const some = { subTasks: 3, subtaskArray: [{ _id: 'a', statusType: 'close' }] };
        expect(subtaskProgress(some, { total: 3, completed: 2 })).toEqual({ done: 2, total: 3 });
        const all = { subTasks: 1, subtaskArray: [{ _id: 'a', statusType: 'close' }] };
        expect(subtaskProgress(all, { total: 1, completed: 0 })).toEqual({ done: 1, total: 1 });
    });
});
