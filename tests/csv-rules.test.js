const rules = require('../Modules/Importers/helpers/csvRules');
const { levelRows } = require('../Modules/Tasks/helpers/taskTreeRules');

const STATUSES = ['To Do', 'In Progress', 'Completed'];
const PID = '6571e7195470e64b120328dd';
const SID = '6a071189c7e0ff41978a57ce';

describe('csvRules — transformCsvRows', () => {
    test('auto-detects common columns', () => {
        const { tasks, skipped } = rules.transformCsvRows({
            rows: [{ Summary: 'Build login', Status: 'In Progress', Priority: 'High', 'Due Date': '2026-07-01', Description: 'desc' }],
            statusNames: STATUSES,
            leaderId: 'u1',
        });
        expect(skipped).toBe(0);
        expect(tasks).toHaveLength(1);
        expect(tasks[0].TaskName).toBe('Build login');
        expect(tasks[0].status).toBe('In Progress');
        expect(tasks[0].Task_Priority).toBe('High');
        expect(tasks[0].Task_Leader).toBe('u1');
        expect(tasks[0].rawDescription).toBe('desc');
        expect(tasks[0].DueDate).toContain('2026-07-01');
        expect(tasks[0].TaskType).toBe('task');
    });

    test('uses an explicit column mapping over auto-detect', () => {
        const { tasks } = rules.transformCsvRows({
            rows: [{ A: 'Task X', B: 'Completed' }],
            mapping: { taskName: 'A', status: 'B' },
            statusNames: STATUSES,
            leaderId: 'u1',
        });
        expect(tasks[0].TaskName).toBe('Task X');
        expect(tasks[0].status).toBe('Completed');
    });

    test('skips rows without a task name; unknown status falls back to the first', () => {
        const { tasks, skipped } = rules.transformCsvRows({
            rows: [{ Status: 'whatever' }, { Summary: 'Has name', Status: 'nope' }],
            statusNames: STATUSES,
            leaderId: 'u1',
        });
        expect(skipped).toBe(1);
        expect(tasks).toHaveLength(1);
        expect(tasks[0].status).toBe('To Do');
    });
});

describe('csvRules — a file that names each row\'s parent', () => {
    const transform = (rows, mapping) => rules.transformCsvRows({ rows, mapping, statusNames: STATUSES, leaderId: 'u1' }).tasks;
    const names = (level) => level.map((row) => row.TaskName);
    const parentNames = (tasks) => {
        const { levels, parentIdOf } = levelRows(tasks);
        const byId = new Map(tasks.map((task) => [task._id, task.TaskName]));
        return Object.fromEntries(levels.flat().map((row) => [row.TaskName, byId.get(parentIdOf.get(row)) || '']));
    };

    test('keeps three levels whatever order the rows come in', () => {
        const tasks = transform([
            { 'Task Key': 'T-3', Title: 'Grandchild', Parent: 'T-2' },
            { 'Task Key': 'T-4', Title: 'Second child', Parent: 'T-1' },
            { 'Task Key': 'T-1', Title: 'Root' },
            { 'Task Key': 'T-2', Title: 'Child', Parent: 'T-1' },
        ]);
        const { levels, adjusted } = levelRows(tasks);
        expect(levels.map(names)).toEqual([['Root'], ['Second child', 'Child'], ['Grandchild']]);
        expect(parentNames(tasks)).toEqual({ Root: '', 'Second child': 'Root', Child: 'Root', Grandchild: 'Child' });
        expect(adjusted).toEqual([]);
    });

    test('reads the parent from a mapped column', () => {
        const tasks = transform([{ A: 'Child', B: '2', C: '1' }, { A: 'Root', B: '1', C: '' }], { taskName: 'A', taskKey: 'B', parent: 'C' });
        expect(parentNames(tasks)).toEqual({ Root: '', Child: 'Root' });
    });

    test('a parent named by its title is found when one row holds that title', () => {
        const tasks = transform([{ Title: 'Child', Parent: 'root' }, { Title: 'Root' }]);
        expect(parentNames(tasks)).toEqual({ Root: '', Child: 'Root' });
    });

    test('a row whose parent is not in the file becomes a task and is listed', () => {
        const tasks = transform([{ 'Task Key': 'T-1', Title: 'Root' }, { 'Task Key': 'T-9', Title: 'Orphan', Parent: 'T-404' }]);
        const { levels, adjusted } = levelRows(tasks);
        expect(names(levels[0])).toEqual(['Root', 'Orphan']);
        expect(adjusted).toEqual([{ _id: 'T-9', TaskName: 'Orphan', reason: 'PARENT_MISSING' }]);
    });

    test('rows whose parents loop, and the rows under them, become tasks and are listed', () => {
        const tasks = transform([
            { 'Task Key': 'A', Title: 'First', Parent: 'B' },
            { 'Task Key': 'B', Title: 'Second', Parent: 'A' },
            { 'Task Key': 'C', Title: 'Under the loop', Parent: 'A' },
            { 'Task Key': 'D', Title: 'Apart' },
        ]);
        const { levels, adjusted } = levelRows(tasks);
        expect(names(levels[0])).toEqual(['First', 'Second', 'Under the loop', 'Apart']);
        expect(adjusted.map(({ TaskName, reason }) => [TaskName, reason])).toEqual([['First', 'CYCLE'], ['Second', 'CYCLE'], ['Under the loop', 'CYCLE']]);
    });

    test('a Jira export, whose parent column holds the issue id, still finds the parent', () => {
        const tasks = transform([
            { Summary: 'Story', 'Issue key': 'WEB-1', 'Issue id': '10001' },
            { Summary: 'Sub-task', 'Issue key': 'WEB-2', 'Issue id': '10002', 'Parent id': '10001' },
        ]);
        expect(parentNames(tasks)).toEqual({ Story: '', 'Sub-task': 'Story' });
    });

    test('a file without a parent column imports every row as a task', () => {
        const tasks = transform([{ Title: 'One' }, { Title: 'Two' }]);
        expect(levelRows(tasks)).toMatchObject({ levels: [[{ TaskName: 'One' }, { TaskName: 'Two' }], [], []], adjusted: [] });
    });

    test('offers the task key and the parent as mapping targets', () => {
        expect(rules.TARGET_KEYS).toEqual(expect.arrayContaining(['taskKey', 'parent']));
    });
});

describe('csvRules — validateCsvInput', () => {
    const base = { companyId: 'c', userId: 'u', projectId: PID, sprintId: SID, rows: [{ a: 1 }] };
    test('accepts valid input', () => { expect(rules.validateCsvInput(base).valid).toBe(true); });
    test('rejects empty rows', () => { expect(rules.validateCsvInput({ ...base, rows: [] }).valid).toBe(false); });
    test('rejects a bad projectId', () => { expect(rules.validateCsvInput({ ...base, projectId: 'x' }).valid).toBe(false); });
    test('rejects a missing userId', () => { expect(rules.validateCsvInput({ ...base, userId: '' }).valid).toBe(false); });
    test('rejects too many rows', () => { expect(rules.validateCsvInput({ ...base, rows: new Array(rules.MAX_ROWS + 1).fill({ a: 1 }) }).valid).toBe(false); });
});
