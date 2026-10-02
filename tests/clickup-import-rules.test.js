const readRows = require('./fixtures/importers/clickupRows');
const {
    MAX_ROWS,
    validateClickUpRows,
    previewClickUpRows,
    transformClickUpRows,
    clickUpStatuses,
    resolveStatuses,
    parseEstimateMinutes,
    mapClickUpPriority,
} = require('../Modules/Importers/helpers/clickupRules');
const { levelRows } = require('../Modules/Tasks/helpers/taskTreeRules');

const rows = readRows();
const asIs = (name) => name;
const transform = () => transformClickUpRows({ rows, statusFor: asIs, leaderId: 'leader-1' });
const task = (name) => transform().tasks.find((t) => t.TaskName === name);

describe('a ClickUp export is checked before anything is read', () => {
    it('accepts the export', () => {
        expect(validateClickUpRows(rows)).toEqual({ valid: true, reason: '' });
    });

    it('refuses a file without a task name column, and an oversized one', () => {
        expect(validateClickUpRows([{ Title: 'x' }]).valid).toBe(false);
        expect(validateClickUpRows([]).valid).toBe(false);
        expect(validateClickUpRows(Array.from({ length: MAX_ROWS + 1 }, () => ({ 'Task Name': 'x' }))).valid).toBe(false);
    });
});

describe('the preview counts each ClickUp list', () => {
    const preview = previewClickUpRows(rows);

    it('groups rows by list and tells tasks from subtasks', () => {
        expect(preview.lists.map(({ name, folder, space, tasks, subtasks }) => ({ name, folder, space, tasks, subtasks }))).toEqual([
            { name: 'Sprint Backlog', folder: 'Web', space: 'Product', tasks: 1, subtasks: 2 },
            { name: 'Launch', folder: '', space: 'Product', tasks: 2, subtasks: 0 },
        ]);
        expect(preview.lists[0].rowIndexes).toEqual([0, 1, 4]);
    });

    it('names each skipped row and why', () => {
        expect(preview).toMatchObject({ total: 6, importable: 5 });
        expect(preview.skippedRows).toEqual([{ row: 4, code: 'no_name', reason: expect.stringMatching(/no name/i) }]);
    });

    it('lists the statuses, tags, custom fields and people the file names', () => {
        expect(preview.statuses).toEqual([
            { name: 'In Progress', type: 'active' },
            { name: 'To Do', type: 'default_active' },
            { name: 'Complete', type: 'close' },
            { name: 'In Review', type: 'active' },
        ]);
        expect(preview.tags).toEqual(['billing', 'frontend']);
        expect(preview.customFields).toEqual([
            { name: 'Story Points', type: 'number' },
            { name: 'Launch Date', type: 'date' },
            { name: 'Client', type: 'text' },
        ]);
        expect(preview.assigneeEmails).toEqual(['max@member.test', 'ghost@nowhere.test']);
        expect(preview.unnamedAssignees).toEqual(['Pat Example']);
    });
});

describe('ClickUp rows become tasks', () => {
    it('skips a row without a name and keeps the rest', () => {
        const out = transform();
        expect(out.tasks).toHaveLength(5);
        expect(out.skipped).toBe(1);
    });

    it('carries the name, description, priority, dates and estimate', () => {
        expect(task('Set up the billing page')).toMatchObject({
            _id: '86a1aaa01',
            rawDescription: 'Build the plan picker and the invoice list',
            Task_Priority: 'HIGH',
            DueDate: '2026-01-15T00:00:00.000Z',
            startDate: '2026-01-08T00:00:00.000Z',
            totalEstimatedTime: 150,
            Task_Leader: 'leader-1',
            AssigneeUserId: [],
        });
        expect(task('Ship the release notes').totalEstimatedTime).toBe(45);
    });

    it('hangs each subtask off the parent the file names, so a subtask of a subtask keeps its own parent', () => {
        expect(task('Write the billing tests').ParentTaskId).toBe('86a1aaa01');
        expect(task('Check the rounding').ParentTaskId).toBe('86a1aaa02');
        expect(task('Set up the billing page').ParentTaskId).toBe('');
    });

    it('arrives as three levels, and a parent that is not in the file is reported and leaves a task', () => {
        const { levels, adjusted } = levelRows(transform().tasks);
        expect(levels.map((level) => level.map((row) => row.TaskName))).toEqual([
            ['Set up the billing page', 'Ship the release notes', 'Follow up with legal'],
            ['Write the billing tests'],
            ['Check the rounding'],
        ]);
        expect(adjusted).toEqual([{ _id: '86a1aaa06', TaskName: 'Follow up with legal', reason: 'PARENT_MISSING' }]);
    });

    it('re-hangs a subtask deeper than three levels on its level-two ancestor and reports it', () => {
        const chain = ['Root', 'Child', 'Grandchild', 'Too deep', 'Deeper still']
            .map((name, i) => ({ 'Task ID': `id-${i}`, 'Task Name': name, 'Parent ID': i ? `id-${i - 1}` : '', Status: 'to do' }));
        const { tasks } = transformClickUpRows({ rows: [...chain].reverse(), statusFor: asIs, leaderId: 'leader-1' });
        const { levels, parentIdOf, adjusted } = levelRows(tasks);
        expect(levels.map((level) => level.map((row) => row.TaskName).sort())).toEqual([['Root'], ['Child'], ['Deeper still', 'Grandchild', 'Too deep']]);
        expect(levels[2].map((row) => parentIdOf.get(row))).toEqual(['id-1', 'id-1', 'id-1']);
        expect(adjusted.map(({ TaskName, reason }) => ({ TaskName, reason })).sort((a, b) => a.TaskName.localeCompare(b.TaskName))).toEqual([
            { TaskName: 'Deeper still', reason: 'TOO_DEEP' },
            { TaskName: 'Too deep', reason: 'TOO_DEEP' },
        ]);
    });

    it('keeps the ClickUp status for the caller to map', () => {
        expect(task('Ship the release notes').status).toBe('complete');
    });

    it('carries tags by name, once each', () => {
        expect(task('Set up the billing page').tagNames).toEqual(['billing', 'frontend']);
        expect(task('Check the rounding').tagNames).toEqual(['Billing']);
    });

    it('carries assignees as emails only, never a name', () => {
        expect(task('Set up the billing page').memberEmails).toEqual(['max@member.test']);
        expect(task('Check the rounding').memberEmails).toEqual(['max@member.test']);
        expect(transform().unnamedAssignees).toEqual(['Pat Example']);
    });

    it('carries each typed custom-field column as written, for the importer to plan', () => {
        expect(task('Set up the billing page').fieldCells).toEqual({ 'Story Points (number)': '5', 'Launch Date (date)': '1769904000000', 'Client (short_text)': 'Acme' });
        expect(task('Ship the release notes').fieldCells).toEqual({ 'Client (short_text)': 'Globex' });
        expect(task('Write the billing tests').fieldCells).toBeUndefined();
        expect(transform().fields.map(({ name, type }) => [name, type])).toEqual([['Story Points', 'number'], ['Launch Date', 'date'], ['Client', 'text']]);
    });
});

describe('statuses, priorities and estimates', () => {
    it('maps ClickUp statuses onto the project, creating only what is missing', () => {
        const existing = [
            { name: 'To Do', key: 1, type: 'default_active' },
            { name: 'In Progress', key: 3, type: 'active' },
            { name: 'Done', key: 6, type: 'close' },
        ];
        const { mapping, missing } = resolveStatuses({ wanted: clickUpStatuses(rows), existing });
        expect(mapping).toEqual({ 'in progress': 'In Progress', 'to do': 'To Do', complete: 'Done', 'in review': 'In Review' });
        expect(missing).toEqual([{ name: 'In Review', type: 'active' }]);
    });

    it('maps priorities onto the company defaults', () => {
        expect(['urgent', 'high', 'normal', 'low', '', 'odd'].map(mapClickUpPriority)).toEqual(['HIGH', 'HIGH', 'MEDIUM', 'LOW', 'MEDIUM', 'MEDIUM']);
    });

    it('reads estimates in milliseconds or as text', () => {
        expect(parseEstimateMinutes('5400000', '')).toBe(90);
        expect(parseEstimateMinutes('', '1h 15m')).toBe(75);
        expect(parseEstimateMinutes('', '')).toBeNull();
    });
});

describe('dates written as numbers with the day first', () => {
    const read = (dueDates, dayFirst) => transformClickUpRows({
        rows: dueDates.map((due, at) => ({ 'Task ID': `d${at}`, 'Task Name': `Task ${at}`, Status: 'to do', 'Due Date': due })),
        statusFor: asIs,
        leaderId: 'leader-1',
        dayFirst,
    });
    const day = (iso) => { const date = new Date(iso); return [date.getFullYear(), date.getMonth() + 1, date.getDate()]; };

    it('are read day first when one of the column has a day past the twelfth and none a month past it', () => {
        const { tasks, unreadDates } = read(['15/12/2025', '05/12/2025', '1.2.2026']);
        expect(tasks.map((task) => day(task.DueDate))).toEqual([[2025, 12, 15], [2025, 12, 5], [2026, 2, 1]]);
        expect(unreadDates).toEqual([]);
    });

    it('are read month first, as before, when nothing in the column says otherwise', () => {
        expect(day(read(['05/12/2025']).tasks[0].DueDate)).toEqual([2025, 5, 12]);
    });

    it('are reported, not guessed, in a column that mixes both orders', () => {
        const { tasks, unreadDates } = read(['15/12/2025', '12/15/2025']);
        expect(tasks[0].DueDate).toBeNull();
        expect(day(tasks[1].DueDate)).toEqual([2025, 12, 15]);
        expect(unreadDates).toEqual([{ row: 1, name: 'Task 0', column: 'Due Date', value: '15/12/2025' }]);
    });

    it('follow the order the whole file was found to hold, when the importer is told it', () => {
        expect(day(read(['05/12/2025'], ['due']).tasks[0].DueDate)).toEqual([2025, 12, 5]);
        expect(read(['31/02/2025'], ['due']).unreadDates).toHaveLength(1);
    });
});

describe('a task id that a row above already holds', () => {
    it('leaves the later row out and says so', () => {
        const repeated = [
            { 'Task ID': 'r1', 'Task Name': 'First', Status: 'to do' },
            { 'Task ID': 'r1', 'Task Name': 'Second', Status: 'to do' },
            { 'Task ID': 'r2', 'Task Name': 'Child', Status: 'to do', 'Parent ID': 'r1' },
        ];
        const { tasks, skippedRows } = transformClickUpRows({ rows: repeated, statusFor: asIs, leaderId: 'leader-1' });
        expect(tasks.map((task) => task.TaskName)).toEqual(['First', 'Child']);
        expect(skippedRows).toEqual([{ row: 2, code: 'repeated_id', reason: 'A row above has the same task id.' }]);
    });
});
