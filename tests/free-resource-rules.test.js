const R = require('../frontend/src/composable/freeResourceRules');

// Helper to build an advanced-filter row the way HomeTaskFilter/FieldsTable do.
const row = (fieldValue, op, values) => ({
    name: { value: fieldValue },
    comparison: { value: op },
    values,
});

describe('splitAssigneeRows', () => {
    test('separates Assignee rows from task-field rows', () => {
        const rows = [
            row('AssigneeUserId', ':', ['u1']),
            row('Task_Priority', ':', ['p1']),
            row('AssigneeUserId', ':!=', ['u2']),
        ];
        const { assigneeRows, taskRows } = R.splitAssigneeRows(rows);
        expect(assigneeRows).toHaveLength(2);
        expect(taskRows).toHaveLength(1);
        expect(taskRows[0].name.value).toBe('Task_Priority');
    });
    test('tolerates non-array / empty input', () => {
        expect(R.splitAssigneeRows(null)).toEqual({ assigneeRows: [], taskRows: [] });
        expect(R.splitAssigneeRows(undefined)).toEqual({ assigneeRows: [], taskRows: [] });
    });
});

describe('resolveAssigneeFilter', () => {
    test('"Is" builds an include set', () => {
        const f = R.resolveAssigneeFilter([row('AssigneeUserId', ':', ['u1', 'u2'])]);
        expect([...f.include]).toEqual(['u1', 'u2']);
        expect(f.exclude.size).toBe(0);
        expect(f.hasInclude).toBe(true);
    });
    test('"Is Not" (:!=) builds an exclude set', () => {
        const f = R.resolveAssigneeFilter([row('AssigneeUserId', ':!=', ['u3'])]);
        expect([...f.exclude]).toEqual(['u3']);
        expect(f.hasInclude).toBe(false);
    });
    test('ignores non-assignee rows', () => {
        const f = R.resolveAssigneeFilter([row('TaskTypeKey', ':', ['t1'])]);
        expect(f.include.size).toBe(0);
        expect(f.exclude.size).toBe(0);
    });
    test('expands team ids through the resolver and normalizes to strings', () => {
        const resolve = (ids) => ids.flatMap((id) => (id === 'tId_A' ? ['ua', 'ub'] : [id]));
        const f = R.resolveAssigneeFilter([row('AssigneeUserId', ':!=', ['tId_A', 99])], resolve);
        expect([...f.exclude].sort()).toEqual(['99', 'ua', 'ub']);
    });
    test('supports both include and exclude rows together', () => {
        const f = R.resolveAssigneeFilter([
            row('AssigneeUserId', ':', ['keep1']),
            row('AssigneeUserId', ':!=', ['drop1']),
        ]);
        expect([...f.include]).toEqual(['keep1']);
        expect([...f.exclude]).toEqual(['drop1']);
    });
});

describe('passesAssigneeFilter', () => {
    const excludeOnly = R.resolveAssigneeFilter([row('AssigneeUserId', ':!=', ['x'])]);
    const includeOnly = R.resolveAssigneeFilter([row('AssigneeUserId', ':', ['y'])]);

    test('no filter → everyone passes', () => {
        expect(R.passesAssigneeFilter('anyone', null)).toBe(true);
        expect(R.passesAssigneeFilter('anyone', R.resolveAssigneeFilter([]))).toBe(true);
    });
    test('excluded user is dropped, others pass', () => {
        expect(R.passesAssigneeFilter('x', excludeOnly)).toBe(false);
        expect(R.passesAssigneeFilter('z', excludeOnly)).toBe(true);
    });
    test('include list keeps only listed users', () => {
        expect(R.passesAssigneeFilter('y', includeOnly)).toBe(true);
        expect(R.passesAssigneeFilter('z', includeOnly)).toBe(false);
    });
    test('matches on string-coerced id', () => {
        expect(R.passesAssigneeFilter(123, R.resolveAssigneeFilter([row('AssigneeUserId', ':!=', ['123'])]))).toBe(false);
    });
});

describe('isFree', () => {
    const PLAN = 180; // 3h planned threshold
    const LOG = 0;    // logged threshold: nothing logged
    test('no plan and nothing logged → free', () => {
        expect(R.isFree(0, 0, PLAN, LOG)).toBe(true);
    });
    test('planned at/over the threshold → busy (strict <)', () => {
        expect(R.isFree(180, 0, PLAN, LOG)).toBe(false);
        expect(R.isFree(200, 0, PLAN, LOG)).toBe(false);
    });
    test('any logged time over the logged threshold → busy', () => {
        expect(R.isFree(60, 30, PLAN, LOG)).toBe(false);
    });
    test('logged threshold is inclusive (<=)', () => {
        expect(R.isFree(60, 120, PLAN, 120)).toBe(true);
        expect(R.isFree(60, 121, PLAN, 120)).toBe(false);
    });
    test('the regression: a busy user is never free even with zeroed inputs guarded', () => {
        // real workload used → busy stays busy
        expect(R.isFree(240, 300, PLAN, LOG)).toBe(false);
    });
    test('coerces nullish minutes to 0', () => {
        expect(R.isFree(undefined, null, PLAN, LOG)).toBe(true);
    });
});
