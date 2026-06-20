/**
 * Timesheet Approval Rules Test Suite
 * AlianHub Project Management System
 *
 * Unit tests for Modules/TimesheetApproval/helpers/approvalRules.js. Pure — no DB.
 */

const {
    APPROVAL_STATUSES,
    REVIEW_ACTIONS,
    MAX_NOTE_LENGTH,
    canReview,
    parsePeriod,
    validateSubmitInput,
    resolveTransition,
    validateReason,
    isApprovalStatus,
    coversDate,
} = require('../Modules/TimesheetApproval/helpers/approvalRules');

const USER = '64b7f0c2a1b2c3d4e5f60700';

describe('⏱️ TIMESHEET APPROVAL - Rules', () => {

    describe('parsePeriod', () => {
        test('valid week passes and normalises to start-of-day', () => {
            const r = parsePeriod({ periodStart: '2026-06-15', periodEnd: '2026-06-21' });
            expect(r.valid).toBe(true);
            expect(r.periodStart.getHours()).toBe(0);
            expect(r.periodStart.getMinutes()).toBe(0);
            expect(r.periodStart.getSeconds()).toBe(0);
            expect(r.periodStart.getMilliseconds()).toBe(0);
            expect(r.periodEnd.getHours()).toBe(0);
        });
        test('same-day period is valid', () => {
            expect(parsePeriod({ periodStart: '2026-06-15', periodEnd: '2026-06-15' }).valid).toBe(true);
        });
        test('missing start fails', () => {
            expect(parsePeriod({ periodEnd: '2026-06-21' }).valid).toBe(false);
        });
        test('missing end fails', () => {
            expect(parsePeriod({ periodStart: '2026-06-15' }).valid).toBe(false);
        });
        test('invalid date fails', () => {
            expect(parsePeriod({ periodStart: 'not-a-date', periodEnd: '2026-06-21' }).valid).toBe(false);
        });
        test('start after end fails', () => {
            expect(parsePeriod({ periodStart: '2026-06-22', periodEnd: '2026-06-15' }).valid).toBe(false);
        });
    });

    describe('validateSubmitInput', () => {
        test('valid input passes', () => {
            expect(validateSubmitInput({ userId: USER, periodStart: '2026-06-15', periodEnd: '2026-06-21' }).valid).toBe(true);
        });
        test('invalid userId fails', () => {
            expect(validateSubmitInput({ userId: 'nope', periodStart: '2026-06-15', periodEnd: '2026-06-21' }).valid).toBe(false);
        });
        test('over-long note fails', () => {
            const note = 'x'.repeat(MAX_NOTE_LENGTH + 1);
            expect(validateSubmitInput({ userId: USER, periodStart: '2026-06-15', periodEnd: '2026-06-21', note }).valid).toBe(false);
        });
        test('bad period fails', () => {
            expect(validateSubmitInput({ userId: USER, periodStart: '2026-06-22', periodEnd: '2026-06-15' }).valid).toBe(false);
        });
    });

    describe('resolveTransition', () => {
        test('approve a submitted -> approved', () => {
            expect(resolveTransition({ from: 'submitted', action: 'approve' })).toMatchObject({ valid: true, to: 'approved' });
        });
        test('reject a submitted -> rejected', () => {
            expect(resolveTransition({ from: 'submitted', action: 'reject' })).toMatchObject({ valid: true, to: 'rejected' });
        });
        test('reopen an approved -> submitted', () => {
            expect(resolveTransition({ from: 'approved', action: 'reopen' })).toMatchObject({ valid: true, to: 'submitted' });
        });
        test('reopen a rejected -> submitted', () => {
            expect(resolveTransition({ from: 'rejected', action: 'reopen' })).toMatchObject({ valid: true, to: 'submitted' });
        });
        test('cannot approve an already-approved', () => {
            expect(resolveTransition({ from: 'approved', action: 'approve' }).valid).toBe(false);
        });
        test('cannot reject an approved', () => {
            expect(resolveTransition({ from: 'approved', action: 'reject' }).valid).toBe(false);
        });
        test('cannot reopen a submitted', () => {
            expect(resolveTransition({ from: 'submitted', action: 'reopen' }).valid).toBe(false);
        });
        test('unknown action fails', () => {
            expect(resolveTransition({ from: 'submitted', action: 'delete' }).valid).toBe(false);
        });
        test('unknown from-state fails', () => {
            expect(resolveTransition({ from: 'draft', action: 'approve' }).valid).toBe(false);
        });
    });

    describe('canReview', () => {
        test('owner (1) can review', () => { expect(canReview({ roleType: 1 })).toBe(true); });
        test('admin (2) can review', () => { expect(canReview({ roleType: 2 })).toBe(true); });
        test('member (3) cannot review', () => { expect(canReview({ roleType: 3 })).toBe(false); });
        test('non-member (null) cannot review', () => { expect(canReview({ roleType: null })).toBe(false); });
        test('missing arg cannot review', () => { expect(canReview()).toBe(false); });
    });

    describe('validateReason', () => {
        test('non-empty reason passes', () => { expect(validateReason('Missing Friday entries').valid).toBe(true); });
        test('empty reason fails', () => { expect(validateReason('').valid).toBe(false); });
        test('whitespace-only reason fails', () => { expect(validateReason('   ').valid).toBe(false); });
    });

    describe('constants & guards', () => {
        test('APPROVAL_STATUSES are the three workflow states', () => {
            expect(APPROVAL_STATUSES).toEqual(['submitted', 'approved', 'rejected']);
        });
        test('REVIEW_ACTIONS are approve/reject/reopen', () => {
            expect(REVIEW_ACTIONS).toEqual(['approve', 'reject', 'reopen']);
        });
        test('isApprovalStatus recognises valid + rejects invalid', () => {
            expect(isApprovalStatus('submitted')).toBe(true);
            expect(isApprovalStatus('draft')).toBe(false);
        });
    });

    describe('coversDate (TIME-03 period lock)', () => {
        const P = { periodStart: '2026-06-15', periodEnd: '2026-06-21' };
        test('date inside the period is covered', () => { expect(coversDate({ ...P, date: '2026-06-17' })).toBe(true); });
        test('start boundary is covered', () => { expect(coversDate({ ...P, date: '2026-06-15' })).toBe(true); });
        test('end boundary is covered', () => { expect(coversDate({ ...P, date: '2026-06-21' })).toBe(true); });
        test('date before the period is not covered', () => { expect(coversDate({ ...P, date: '2026-06-14' })).toBe(false); });
        test('date after the period is not covered', () => { expect(coversDate({ ...P, date: '2026-06-22' })).toBe(false); });
        test('invalid date is not covered', () => { expect(coversDate({ ...P, date: 'nope' })).toBe(false); });
    });
});
