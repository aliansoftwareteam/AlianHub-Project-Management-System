/**
 * Jira Import Rules Test Suite
 * AlianHub Project Management System
 *
 * Unit tests for Modules/Importers/helpers/jiraRules.js. Pure — no DB.
 */

const {
    MAX_ROWS,
    fieldOf,
    mapPriority,
    mapStatusName,
    validateImportInput,
    transformJiraRows,
} = require('../Modules/Importers/helpers/jiraRules');

const COMPANY = '64b7f0c2a1b2c3d4e5f60700';
const PROJECT = '64b7f0c2a1b2c3d4e5f60711';
const SPRINT = '64b7f0c2a1b2c3d4e5f60712';

describe('📥 JIRA IMPORT - Rules', () => {

    describe('fieldOf', () => {

        test('matches headers case-insensitively with trimming', () => {
            expect(fieldOf({ 'Summary ': 'Fix login' }, ['summary'])).toBe('Fix login');
            expect(fieldOf({ 'ISSUE KEY': 'AH-1' }, ['issue key'])).toBe('AH-1');
            expect(fieldOf({ Summary: '  ' }, ['summary'])).toBe('');
        });
    });

    describe('mapPriority', () => {

        test('Jira scale maps onto app defaults; unknown passes through', () => {
            expect(mapPriority('Highest')).toBe('Urgent');
            expect(mapPriority('high')).toBe('High');
            expect(mapPriority('Medium')).toBe('Normal');
            expect(mapPriority('Lowest')).toBe('Low');
            expect(mapPriority('Blocker')).toBe('Blocker');
            expect(mapPriority('')).toBe('Normal');
        });
    });

    describe('mapStatusName', () => {

        const names = ['To Do', 'In Progress', 'In Review', 'Completed'];

        test('exact case-insensitive match wins', () => {
            expect(mapStatusName('in progress', names)).toBe('In Progress');
        });

        test('done aliases to completed; unknown falls back to first', () => {
            expect(mapStatusName('Done', names)).toBe('Completed');
            expect(mapStatusName('Blocked', names)).toBe('To Do');
        });
    });

    describe('validateImportInput', () => {

        const valid = { companyId: COMPANY, projectId: PROJECT, sprintId: SPRINT, rows: [{ Summary: 'x' }], userId: 'u1' };

        test('valid input passes', () => {
            expect(validateImportInput(valid).valid).toBe(true);
        });

        test('each missing piece fails', () => {
            expect(validateImportInput({ ...valid, companyId: '' }).valid).toBe(false);
            expect(validateImportInput({ ...valid, userId: '' }).valid).toBe(false);
            expect(validateImportInput({ ...valid, projectId: 'x' }).valid).toBe(false);
            expect(validateImportInput({ ...valid, sprintId: 'x' }).valid).toBe(false);
            expect(validateImportInput({ ...valid, rows: [] }).valid).toBe(false);
            expect(validateImportInput({ ...valid, rows: new Array(MAX_ROWS + 1).fill({}) }).valid).toBe(false);
        });
    });

    describe('transformJiraRows', () => {

        const statusNames = ['To Do', 'Completed'];

        test('maps a typical Jira row', () => {
            const { tasks, skipped } = transformJiraRows({
                rows: [{ Summary: 'Fix login', Status: 'Done', Priority: 'Highest', 'Due date': '2026-07-01', Description: 'details' }],
                statusNames,
                leaderId: 'u1',
            });
            expect(skipped).toBe(0);
            expect(tasks[0].TaskName).toBe('Fix login');
            expect(tasks[0].status).toBe('Completed');
            expect(tasks[0].Task_Priority).toBe('Urgent');
            expect(tasks[0].Task_Leader).toBe('u1');
            expect(tasks[0].DueDate).toMatch(/^2026-07-01/);
            expect(tasks[0].rawDescription).toBe('details');
        });

        test('rows without a summary are skipped, junk dates dropped', () => {
            const { tasks, skipped } = transformJiraRows({
                rows: [{ Status: 'Done' }, { Summary: 'ok', 'Due date': 'not-a-date' }],
                statusNames,
                leaderId: 'u1',
            });
            expect(skipped).toBe(1);
            expect(tasks).toHaveLength(1);
            expect(tasks[0].DueDate).toBe(null);
        });
    });
});
