/**
 * Export Rules Test Suite
 * AlianHub Project Management System
 *
 * Unit tests for Modules/ExportJobs/helpers/exportRules.js. Pure — no DB.
 */

const {
    validateExportInput,
    buildFileName,
    taskToRow,
    csvEscape,
    rowsToCsv,
} = require('../Modules/ExportJobs/helpers/exportRules');

const COMPANY = '64b7f0c2a1b2c3d4e5f60700';
const PROJECT = '64b7f0c2a1b2c3d4e5f60711';

describe('📦 EXPORTS - Rules', () => {

    describe('validateExportInput', () => {

        const valid = { companyId: COMPANY, format: 'csv', projectId: PROJECT, userId: 'u1' };

        test('csv and xlsx pass; other formats fail', () => {
            expect(validateExportInput(valid).valid).toBe(true);
            expect(validateExportInput({ ...valid, format: 'xlsx' }).valid).toBe(true);
            expect(validateExportInput({ ...valid, format: 'pdf' }).valid).toBe(false);
        });

        test('missing companyId/userId/projectId fail', () => {
            expect(validateExportInput({ ...valid, companyId: '' }).valid).toBe(false);
            expect(validateExportInput({ ...valid, userId: '' }).valid).toBe(false);
            expect(validateExportInput({ ...valid, projectId: 'bad' }).valid).toBe(false);
        });

        test('sprintId optional but validated when present', () => {
            expect(validateExportInput({ ...valid, sprintId: '' }).valid).toBe(true);
            expect(validateExportInput({ ...valid, sprintId: PROJECT }).valid).toBe(true);
            expect(validateExportInput({ ...valid, sprintId: 'bad' }).valid).toBe(false);
        });
    });

    describe('buildFileName', () => {

        test('sanitises the project name and stamps it', () => {
            const name = buildFileName({ projectName: 'Web / Proto: Test!', format: 'csv', stamp: '2026-06-10' });
            expect(name).toBe('Web-Proto-Test-tasks-2026-06-10.csv');
        });

        test('falls back when the name sanitises to nothing', () => {
            expect(buildFileName({ projectName: '!!!', format: 'xlsx', stamp: 's' })).toBe('tasks-tasks-s.xlsx');
        });
    });

    describe('csv building', () => {

        test('escapes commas, quotes and newlines', () => {
            expect(csvEscape('plain')).toBe('plain');
            expect(csvEscape('a,b')).toBe('"a,b"');
            expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
            expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
            expect(csvEscape(null)).toBe('');
        });

        test('rowsToCsv emits a header and one line per row', () => {
            const csv = rowsToCsv([
                { A: '1', B: 'x,y' },
                { A: '2', B: 'plain' },
            ]);
            const lines = csv.split('\r\n');
            expect(lines[0]).toBe('A,B');
            expect(lines[1]).toBe('1,"x,y"');
            expect(lines[2]).toBe('2,plain');
        });

        test('empty input gives an empty string', () => {
            expect(rowsToCsv([])).toBe('');
        });
    });

    describe('taskToRow', () => {

        test('flattens the document with stable columns', () => {
            const row = taskToRow({
                TaskKey: 'AH-1',
                TaskName: 'Do it',
                status: { text: 'To Do' },
                statusType: 'open',
                Task_Priority: 'High',
                AssigneeUserId: ['u1', 'u2'],
                DueDate: '2026-06-15T00:00:00Z',
                totalEstimatedTime: 90,
                createdAt: '2026-06-01T10:00:00Z',
                updatedAt: '2026-06-02T10:00:00Z',
            });
            expect(row.TaskKey).toBe('AH-1');
            expect(row.Status).toBe('To Do');
            expect(row.Assignees).toBe('u1; u2');
            expect(row.DueDate).toBe('2026-06-15');
            expect(Object.keys(row)[0]).toBe('TaskKey');
        });

        test('null-safe on sparse documents', () => {
            const row = taskToRow({});
            expect(row.TaskName).toBe('');
            expect(row.Assignees).toBe('');
            expect(row.DueDate).toBe('');
        });
    });
});
