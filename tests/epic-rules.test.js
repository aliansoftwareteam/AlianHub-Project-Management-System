/**
 * Epic Rules Test Suite
 * AlianHub Project Management System
 *
 * Unit tests for Modules/Epics/helpers/epicRules.js. Pure — no DB.
 */

const {
    validateEpicInput,
    validateAssignInput,
    countDeltas,
    parseEpicDates,
    MAX_NAME_LENGTH,
    EPIC_STATUSES,
    EPIC_PRIORITIES,
} = require('../Modules/Epics/helpers/epicRules');

const COMPANY = '64b7f0c2a1b2c3d4e5f60700';
const PROJECT = '64b7f0c2a1b2c3d4e5f60711';
const TASK = '64b7f0c2a1b2c3d4e5f60712';
const EPIC_A = '64b7f0c2a1b2c3d4e5f60713';
const EPIC_B = '64b7f0c2a1b2c3d4e5f60714';

describe('🏔️ EPICS - Rules', () => {

    describe('validateEpicInput', () => {

        test('valid input passes', () => {
            expect(validateEpicInput({ companyId: COMPANY, name: 'Onboarding revamp', projectId: PROJECT }).valid).toBe(true);
        });

        test('valid hex color passes; junk color fails', () => {
            expect(validateEpicInput({ companyId: COMPANY, name: 'E', projectId: PROJECT, color: '#7b68ee' }).valid).toBe(true);
            expect(validateEpicInput({ companyId: COMPANY, name: 'E', projectId: PROJECT, color: 'purple' }).valid).toBe(false);
        });

        test('missing name, oversized name, bad project fail', () => {
            expect(validateEpicInput({ companyId: COMPANY, name: '  ', projectId: PROJECT }).valid).toBe(false);
            expect(validateEpicInput({ companyId: COMPANY, name: 'x'.repeat(MAX_NAME_LENGTH + 1), projectId: PROJECT }).valid).toBe(false);
            expect(validateEpicInput({ companyId: COMPANY, name: 'E', projectId: 'nope' }).valid).toBe(false);
        });

        test('valid priority passes; unknown priority fails; omitted priority is fine', () => {
            expect(validateEpicInput({ companyId: COMPANY, name: 'E', projectId: PROJECT, priority: 'high' }).valid).toBe(true);
            expect(validateEpicInput({ companyId: COMPANY, name: 'E', projectId: PROJECT, priority: 'urgent' }).valid).toBe(false);
            expect(validateEpicInput({ companyId: COMPANY, name: 'E', projectId: PROJECT }).valid).toBe(true);
        });
    });

    describe('validateAssignInput', () => {

        test('assign and remove forms pass', () => {
            expect(validateAssignInput({ companyId: COMPANY, taskId: TASK, epicId: EPIC_A }).valid).toBe(true);
            expect(validateAssignInput({ companyId: COMPANY, taskId: TASK, epicId: null }).valid).toBe(true);
            expect(validateAssignInput({ companyId: COMPANY, taskId: TASK, epicId: '' }).valid).toBe(true);
        });

        test('bad ids fail', () => {
            expect(validateAssignInput({ companyId: COMPANY, taskId: 'x', epicId: EPIC_A }).valid).toBe(false);
            expect(validateAssignInput({ companyId: COMPANY, taskId: TASK, epicId: 'x' }).valid).toBe(false);
        });
    });

    describe('countDeltas', () => {

        test('moving between epics decrements old and increments new', () => {
            const deltas = countDeltas({ oldEpicId: EPIC_A, newEpicId: EPIC_B, isCompleted: true });
            expect(deltas).toEqual([
                { epicId: EPIC_A, inc: { taskCount: -1, completedCount: -1 } },
                { epicId: EPIC_B, inc: { taskCount: 1, completedCount: 1 } },
            ]);
        });

        test('open task moves carry no completed delta', () => {
            const deltas = countDeltas({ oldEpicId: null, newEpicId: EPIC_B, isCompleted: false });
            expect(deltas).toEqual([{ epicId: EPIC_B, inc: { taskCount: 1, completedCount: 0 } }]);
        });

        test('removal only decrements the old epic', () => {
            const deltas = countDeltas({ oldEpicId: EPIC_A, newEpicId: null, isCompleted: false });
            expect(deltas).toEqual([{ epicId: EPIC_A, inc: { taskCount: -1, completedCount: -0 } }]);
        });

        test('no-op when nothing changes', () => {
            expect(countDeltas({ oldEpicId: EPIC_A, newEpicId: EPIC_A, isCompleted: true })).toEqual([]);
            expect(countDeltas({ oldEpicId: null, newEpicId: null, isCompleted: true })).toEqual([]);
        });
    });

    describe('statuses & priorities', () => {

        test('EPIC_STATUSES includes the new in_progress state', () => {
            expect(EPIC_STATUSES).toContain('open');
            expect(EPIC_STATUSES).toContain('in_progress');
            expect(EPIC_STATUSES).toContain('done');
        });

        test('EPIC_PRIORITIES are low / medium / high', () => {
            expect(EPIC_PRIORITIES).toEqual(['low', 'medium', 'high']);
        });
    });

    describe('parseEpicDates', () => {

        test('parses a valid start + due into Date objects', () => {
            const result = parseEpicDates({ startDate: '2026-06-01', dueDate: '2026-06-30' });
            expect(result.valid).toBe(true);
            expect(result.startDate instanceof Date).toBe(true);
            expect(result.dueDate instanceof Date).toBe(true);
        });

        test('empty string / null clears a date to null', () => {
            const result = parseEpicDates({ startDate: '', dueDate: null });
            expect(result.valid).toBe(true);
            expect(result.startDate).toBeNull();
            expect(result.dueDate).toBeNull();
        });

        test('omitted fields stay undefined (partial update, no change)', () => {
            const result = parseEpicDates({});
            expect(result.valid).toBe(true);
            expect(result.startDate).toBeUndefined();
            expect(result.dueDate).toBeUndefined();
        });

        test('an unparseable date fails', () => {
            expect(parseEpicDates({ dueDate: 'not-a-date' }).valid).toBe(false);
        });

        test('startDate after dueDate fails', () => {
            const result = parseEpicDates({ startDate: '2026-07-01', dueDate: '2026-06-01' });
            expect(result.valid).toBe(false);
            expect(result.reason).toMatch(/on or before/);
        });
    });
});
