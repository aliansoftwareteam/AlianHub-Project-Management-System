/**
 * Asana Import Rules Test Suite
 * AlianHub Project Management System
 *
 * Unit tests for Modules/Importers/helpers/asanaRules.js. Pure — no DB.
 */

const {
    MAX_TASKS,
    tasksOf,
    sectionNameOf,
    priorityOf,
    validateAsanaInput,
    parseAsanaExport,
} = require('../Modules/Importers/helpers/asanaRules');

const COMPANY = '64b7f0c2a1b2c3d4e5f60700';
const PROJECT = '64b7f0c2a1b2c3d4e5f60711';
const SPRINT = '64b7f0c2a1b2c3d4e5f60712';

const statusNames = ['To Do', 'In Progress', 'Completed'];

describe('📥 ASANA IMPORT - Rules', () => {

    describe('tasksOf', () => {

        test('reads tasks from the common export shapes', () => {
            expect(tasksOf({ tasks: [{ name: 'a' }] })).toHaveLength(1);
            expect(tasksOf({ data: { tasks: [{ name: 'a' }, { name: 'b' }] } })).toHaveLength(2);
            expect(tasksOf([{ name: 'a' }])).toHaveLength(1);
            expect(tasksOf({ data: [{ name: 'a' }] })).toHaveLength(1);
            expect(tasksOf(null)).toEqual([]);
            expect(tasksOf({})).toEqual([]);
        });
    });

    describe('sectionNameOf', () => {

        test('pulls the section from memberships, with fallbacks', () => {
            expect(sectionNameOf({ memberships: [{ section: { name: 'In Progress' } }] })).toBe('In Progress');
            expect(sectionNameOf({ section: { name: 'Backlog' } })).toBe('Backlog');
            expect(sectionNameOf({ section: 'Done' })).toBe('Done');
            expect(sectionNameOf({ section_name: 'Review' })).toBe('Review');
            expect(sectionNameOf({})).toBe('');
        });
    });

    describe('priorityOf', () => {

        test('reads a Priority custom field across value shapes', () => {
            expect(priorityOf({ custom_fields: [{ name: 'Priority', display_value: 'High' }] })).toBe('High');
            expect(priorityOf({ custom_fields: [{ name: 'priority', enum_value: { name: 'Low' } }] })).toBe('Low');
            expect(priorityOf({ custom_fields: [{ name: 'Priority', text_value: 'Medium' }] })).toBe('Medium');
            expect(priorityOf({ custom_fields: [{ name: 'Estimate', display_value: '3' }] })).toBe('');
            expect(priorityOf({})).toBe('');
        });
    });

    describe('validateAsanaInput', () => {

        const valid = { companyId: COMPANY, projectId: PROJECT, sprintId: SPRINT, asana: { tasks: [{ name: 'x' }] }, userId: 'u1' };

        test('valid input passes', () => {
            expect(validateAsanaInput(valid).valid).toBe(true);
        });

        test('each missing piece fails', () => {
            expect(validateAsanaInput({ ...valid, companyId: '' }).valid).toBe(false);
            expect(validateAsanaInput({ ...valid, userId: '' }).valid).toBe(false);
            expect(validateAsanaInput({ ...valid, projectId: 'x' }).valid).toBe(false);
            expect(validateAsanaInput({ ...valid, sprintId: 'x' }).valid).toBe(false);
            expect(validateAsanaInput({ ...valid, asana: { tasks: [] } }).valid).toBe(false);
            expect(validateAsanaInput({ ...valid, asana: { tasks: [{ name: '  ' }] } }).valid).toBe(false);
            expect(validateAsanaInput({ ...valid, asana: { tasks: new Array(MAX_TASKS + 1).fill({ name: 'x' }) } }).valid).toBe(false);
        });
    });

    describe('parseAsanaExport', () => {

        test('maps a typical Asana task (section → status, custom-field priority, notes, due)', () => {
            const { tasks, skipped } = parseAsanaExport({
                asana: {
                    tasks: [{
                        name: 'Fix login',
                        notes: 'details',
                        completed: false,
                        due_on: '2026-07-01',
                        assignee: { email: 'alex@example.com', name: 'Alex' },
                        memberships: [{ section: { name: 'In Progress' } }],
                        custom_fields: [{ name: 'Priority', display_value: 'High' }],
                    }],
                },
                statusNames,
                leaderId: 'u1',
            });
            expect(skipped).toBe(0);
            expect(tasks[0].TaskName).toBe('Fix login');
            expect(tasks[0].status).toBe('In Progress');
            expect(tasks[0].Task_Priority).toBe('High');
            expect(tasks[0].Task_Leader).toBe('u1');
            expect(tasks[0].DueDate).toMatch(/^2026-07-01/);
            expect(tasks[0].rawDescription).toBe('details');
            expect(tasks[0].ParentTaskId).toBe('');
            expect(tasks[0].memberEmails).toEqual(['alex@example.com']);
        });

        test('completed task with no section falls back to Done → Completed; missing priority defaults to Normal', () => {
            const { tasks } = parseAsanaExport({
                asana: { tasks: [{ name: 'Ship it', completed: true }] },
                statusNames,
                leaderId: 'u1',
            });
            expect(tasks[0].status).toBe('Completed');
            expect(tasks[0].Task_Priority).toBe('Normal');
        });

        test('nameless tasks are skipped; junk dates dropped', () => {
            const { tasks, skipped } = parseAsanaExport({
                asana: { tasks: [{ notes: 'no name' }, { name: 'ok', due_on: 'not-a-date' }] },
                statusNames,
                leaderId: 'u1',
            });
            expect(skipped).toBe(1);
            expect(tasks).toHaveLength(1);
            expect(tasks[0].DueDate).toBe(null);
        });

        test('subtasks are skipped for the MVP and counted in skipped', () => {
            const { tasks, skipped } = parseAsanaExport({
                asana: {
                    tasks: [{
                        name: 'Parent task',
                        memberships: [{ section: { name: 'To Do' } }],
                        subtasks: [{ name: 'Subtask A' }, { name: 'Subtask B' }, { name: '  ' }],
                    }],
                },
                statusNames,
                leaderId: 'u1',
            });
            // Only the parent is imported; the two named subtasks are counted as skipped.
            expect(tasks).toHaveLength(1);
            expect(tasks[0].TaskName).toBe('Parent task');
            expect(skipped).toBe(2);
        });

        test('collects the section names encountered', () => {
            const { sectionNames } = parseAsanaExport({
                asana: {
                    tasks: [
                        { name: 'a', memberships: [{ section: { name: 'To Do' } }] },
                        { name: 'b', memberships: [{ section: { name: 'In Progress' } }] },
                        { name: 'c', memberships: [{ section: { name: 'To Do' } }] },
                    ],
                },
                statusNames,
                leaderId: 'u1',
            });
            expect(sectionNames.sort()).toEqual(['In Progress', 'To Do']);
        });
    });
});
