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
    MAX_NAME_LENGTH,
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
});
