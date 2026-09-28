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

    it('hangs subtasks off their parent, a subtask of a subtask off the top task, and an orphan stays a task', () => {
        expect(task('Write the billing tests').ParentTaskId).toBe('86a1aaa01');
        expect(task('Check the rounding').ParentTaskId).toBe('86a1aaa01');
        expect(task('Follow up with legal').ParentTaskId).toBe('');
        expect(task('Set up the billing page').ParentTaskId).toBe('');
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

    it('maps typed custom-field columns onto field types, and the first task defines every field', () => {
        const first = task('Set up the billing page');
        expect(first['custom_Story Points']).toEqual({ type: 'number', value: 5 });
        expect(first['custom_Launch Date']).toEqual({ type: 'date', value: '2026-02-01T00:00:00.000Z' });
        expect(first.custom_Client).toEqual({ type: 'text', value: 'Acme' });
        expect(task('Ship the release notes').custom_Client).toEqual({ type: 'text', value: 'Globex' });
        expect(task('Ship the release notes')['custom_Story Points']).toBeUndefined();
        expect(Object.keys(first)).not.toContain('custom_Latest Comment');
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
