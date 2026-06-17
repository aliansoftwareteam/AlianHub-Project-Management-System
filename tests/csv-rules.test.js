const rules = require('../Modules/Importers/helpers/csvRules');

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

describe('csvRules — validateCsvInput', () => {
    const base = { companyId: 'c', userId: 'u', projectId: PID, sprintId: SID, rows: [{ a: 1 }] };
    test('accepts valid input', () => { expect(rules.validateCsvInput(base).valid).toBe(true); });
    test('rejects empty rows', () => { expect(rules.validateCsvInput({ ...base, rows: [] }).valid).toBe(false); });
    test('rejects a bad projectId', () => { expect(rules.validateCsvInput({ ...base, projectId: 'x' }).valid).toBe(false); });
    test('rejects a missing userId', () => { expect(rules.validateCsvInput({ ...base, userId: '' }).valid).toBe(false); });
    test('rejects too many rows', () => { expect(rules.validateCsvInput({ ...base, rows: new Array(rules.MAX_ROWS + 1).fill({ a: 1 }) }).valid).toBe(false); });
});
