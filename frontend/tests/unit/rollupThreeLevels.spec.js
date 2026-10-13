/* Task 046 N6: a rollup counts every level under a task, the same number the server stores. */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ data: {} })) }));

import { computeCustomFieldValue, withRollupSources } from '@/plugins/customFieldView/formulaEngine.js';

const COST = { _id: 'cost', fieldTitle: 'Cost', fieldType: 'number', fieldTaskTypes: [1] };
const TOTAL = { _id: 'total', fieldTitle: 'Total cost', fieldType: 'rollup', rollupFunction: 'sum', rollupSourceFieldId: 'cost' };
const ROWS = { _id: 'rows', fieldTitle: 'Rows below', fieldType: 'rollup', rollupFunction: 'count', rollupSourceFieldId: '' };
const DEFS = [COST, TOTAL, ROWS];

const row = (_id, parent, ancestors, cost, extra = {}) => ({
    _id, ParentTaskId: parent, isParentTask: !parent, ancestors, TaskTypeKey: 1, deletedStatusKey: 0, subTasks: 0,
    customField: cost === null ? {} : { cost: { fieldValue: cost } },
    ...extra
});

const flat = () => [
    row('root', '', [], null, { subTasks: 3, customField: { total: { fieldValue: 18 }, rows: { fieldValue: 5 } } }),
    row('child', 'root', ['root'], 10, { subTasks: 2 }),
    row('grandchild', 'child', ['root', 'child'], 5),
    row('second', 'root', ['root'], 1),
    row('unchained', 'child', undefined, 2),
    row('bug', 'root', ['root'], 50, { TaskTypeKey: 2 }),
    row('other', '', [], null, { subTasks: 1 }),
    row('other-child', 'other', ['other'], 100)
];

const task = (rows, id) => rows.find((entry) => entry._id === id);
const value = (def, rows, id) => computeCustomFieldValue(def, task(rows, id), rows, DEFS);

describe('a rollup on a task with three levels', () => {
    it('sums every level under the task, leaving out a row the source field is not for', () => {
        expect(value(TOTAL, flat(), 'root')).toBe(18);
    });

    it('counts every row under the task once', () => {
        const rows = flat();
        expect(value(ROWS, [...rows, ...rows], 'root')).toBe(5);
    });

    it('on a level-two task counts its own subtasks', () => {
        expect(value(TOTAL, flat(), 'child')).toBe(7);
        expect(value(ROWS, flat(), 'child')).toBe(2);
    });

    it('reads rows nested in the store tree as well as a flat list', () => {
        const rows = flat();
        const child = { ...task(rows, 'child'), subtaskArray: [task(rows, 'grandchild'), task(rows, 'unchained')] };
        const root = { ...task(rows, 'root'), subtaskArray: [child, task(rows, 'second'), task(rows, 'bug')] };
        expect(computeCustomFieldValue(TOTAL, root, [root], DEFS)).toBe(18);
        expect(computeCustomFieldValue(ROWS, root, [], DEFS)).toBe(5);
    });

    it('finds the source field on a definition that carries it, when the caller has no list of fields', () => {
        const [, total] = withRollupSources([COST, TOTAL]);
        const rows = flat();
        expect(computeCustomFieldValue(total, task(rows, 'root'), rows)).toBe(18);
    });
});

describe('a rollup whose rows are not all loaded', () => {
    it('shows the number the server stored when a level is missing', () => {
        const rows = flat().filter((entry) => !['grandchild', 'unchained'].includes(entry._id));
        expect(value(TOTAL, rows, 'root')).toBe(18);
        expect(value(ROWS, rows, 'root')).toBe(5);
    });

    it('shows the number the server stored when nothing under the task is loaded', () => {
        const rows = flat().filter((entry) => entry._id === 'root');
        expect(value(TOTAL, rows, 'root')).toBe(18);
    });

    it('shows nothing rather than a part when the server has stored no number yet', () => {
        const rows = flat().filter((entry) => entry._id !== 'grandchild').map((entry) => (entry._id === 'root' ? { ...entry, customField: {} } : entry));
        expect(value(TOTAL, rows, 'root')).toBe('');
    });

    it('leaves out a deleted row', () => {
        const rows = [...flat(), row('gone', 'root', ['root'], 1000, { deletedStatusKey: 1 })];
        expect(value(TOTAL, rows, 'root')).toBe(18);
    });
});
