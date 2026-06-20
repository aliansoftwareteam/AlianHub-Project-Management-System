/**
 * Billable Rules Test Suite
 * AlianHub Project Management System
 *
 * Unit tests for Modules/TimeSheet/helpers/billableRules.js. Pure — no DB.
 */

const { normalizeBillable, summarize } = require('../Modules/TimeSheet/helpers/billableRules');

describe('💵 BILLABLE - Rules', () => {

    describe('normalizeBillable', () => {
        test('true stays billable', () => expect(normalizeBillable(true)).toBe(true));
        test('undefined defaults to billable', () => expect(normalizeBillable(undefined)).toBe(true));
        test('only an explicit false is non-billable', () => expect(normalizeBillable(false)).toBe(false));
    });

    describe('summarize', () => {
        test('empty list returns zeros', () => {
            expect(summarize([])).toEqual({
                billableMinutes: 0, nonBillableMinutes: 0, billableEntries: 0, nonBillableEntries: 0, totalMinutes: 0,
            });
        });
        test('null is treated as empty', () => {
            expect(summarize(null).totalMinutes).toBe(0);
        });
        test('splits billable vs non-billable; missing flag counts as billable', () => {
            const r = summarize([
                { billable: true, LogTimeDuration: 60 },
                { billable: false, LogTimeDuration: 30 },
                { LogTimeDuration: 15 },
            ]);
            expect(r.billableMinutes).toBe(75);
            expect(r.nonBillableMinutes).toBe(30);
            expect(r.billableEntries).toBe(2);
            expect(r.nonBillableEntries).toBe(1);
            expect(r.totalMinutes).toBe(105);
        });
        test('non-numeric durations count as 0', () => {
            const r = summarize([{ billable: true, LogTimeDuration: 'x' }, { billable: false }]);
            expect(r.billableMinutes).toBe(0);
            expect(r.nonBillableMinutes).toBe(0);
            expect(r.billableEntries).toBe(1);
            expect(r.nonBillableEntries).toBe(1);
        });
    });
});
