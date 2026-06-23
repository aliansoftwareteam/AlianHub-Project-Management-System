/**
 * Monday.com Import Rules Test Suite
 * AlianHub Project Management System
 *
 * Unit tests for Modules/Importers/helpers/mondayRules.js. Pure — no DB.
 */

const {
    MAX_ROWS,
    valueFor,
    validateMondayInput,
    parseMondayExport,
} = require('../Modules/Importers/helpers/mondayRules');

const COMPANY = '64b7f0c2a1b2c3d4e5f60700';
const PROJECT = '64b7f0c2a1b2c3d4e5f60711';
const SPRINT = '64b7f0c2a1b2c3d4e5f60712';

const statusNames = ['To Do', 'In Progress', 'Completed'];

describe('📥 MONDAY IMPORT - Rules', () => {

    describe('valueFor', () => {

        test('explicit mapping wins; otherwise auto-detect from candidates', () => {
            expect(valueFor({ Title: 'X' }, { taskName: 'Title' }, 'taskName', ['name'])).toBe('X');
            expect(valueFor({ Name: 'Y' }, {}, 'taskName', ['name'])).toBe('Y');
            // Mapped column blank → falls through to candidate auto-detect.
            expect(valueFor({ Custom: '', Name: 'Z' }, { taskName: 'Custom' }, 'taskName', ['name'])).toBe('Z');
        });
    });

    describe('validateMondayInput', () => {

        const valid = { companyId: COMPANY, projectId: PROJECT, sprintId: SPRINT, rows: [{ Name: 'x' }], userId: 'u1' };

        test('valid input passes', () => {
            expect(validateMondayInput(valid).valid).toBe(true);
        });

        test('each missing piece fails', () => {
            expect(validateMondayInput({ ...valid, companyId: '' }).valid).toBe(false);
            expect(validateMondayInput({ ...valid, userId: '' }).valid).toBe(false);
            expect(validateMondayInput({ ...valid, projectId: 'x' }).valid).toBe(false);
            expect(validateMondayInput({ ...valid, sprintId: 'x' }).valid).toBe(false);
            expect(validateMondayInput({ ...valid, rows: [] }).valid).toBe(false);
            expect(validateMondayInput({ ...valid, rows: new Array(MAX_ROWS + 1).fill({}) }).valid).toBe(false);
        });
    });

    describe('parseMondayExport', () => {

        test('auto-detects Monday columns (Name/Status/Priority/Due Date/Notes)', () => {
            const { tasks, skipped } = parseMondayExport({
                rows: [{ Name: 'Fix login', Status: 'Done', Priority: 'High', 'Due Date': '2026-07-01', Notes: 'details' }],
                statusNames,
                leaderId: 'u1',
            });
            expect(skipped).toBe(0);
            expect(tasks[0].TaskName).toBe('Fix login');
            expect(tasks[0].status).toBe('Completed'); // "Done" aliases to Completed
            expect(tasks[0].Task_Priority).toBe('High');
            expect(tasks[0].Task_Leader).toBe('u1');
            expect(tasks[0].DueDate).toMatch(/^2026-07-01/);
            expect(tasks[0].rawDescription).toBe('details');
            expect(tasks[0].ParentTaskId).toBe('');
        });

        test('honors an explicit column mapping over auto-detect', () => {
            const { tasks } = parseMondayExport({
                rows: [{ Item: 'Custom mapped', State: 'In Progress', 'Long Text': 'desc here' }],
                mapping: { taskName: 'Item', status: 'State', description: 'Long Text' },
                statusNames,
                leaderId: 'u1',
            });
            expect(tasks[0].TaskName).toBe('Custom mapped');
            expect(tasks[0].status).toBe('In Progress');
            expect(tasks[0].rawDescription).toBe('desc here');
        });

        test('maps the Jira priority scale and defaults blanks to Normal', () => {
            const { tasks } = parseMondayExport({
                rows: [
                    { Name: 'a', Priority: 'Highest' },
                    { Name: 'b', Priority: '' },
                    { Name: 'c', Priority: 'Critical' },
                ],
                statusNames,
                leaderId: 'u1',
            });
            expect(tasks[0].Task_Priority).toBe('Urgent');
            expect(tasks[1].Task_Priority).toBe('Normal');
            expect(tasks[2].Task_Priority).toBe('Critical'); // unknown passes through
        });

        test('rows without a name are skipped; junk dates dropped; unknown status → first', () => {
            const { tasks, skipped } = parseMondayExport({
                rows: [{ Status: 'Done' }, { Name: 'ok', 'Due Date': 'not-a-date', Status: 'Mystery' }],
                statusNames,
                leaderId: 'u1',
            });
            expect(skipped).toBe(1);
            expect(tasks).toHaveLength(1);
            expect(tasks[0].DueDate).toBe(null);
            expect(tasks[0].status).toBe('To Do'); // unknown status falls back to first
        });
    });
});
