/**
 * Timesheet CSV Export Test Suite
 * AlianHub Project Management System
 *
 * Unit tests for Modules/TimeSheet/helpers/timesheetCsv.js. Pure — no DB.
 */

const { buildTimesheetCsv, escapeCsv, CSV_HEADERS } = require('../Modules/TimeSheet/helpers/timesheetCsv');

describe('🧾 TIMESHEET CSV - Export', () => {

    describe('escapeCsv', () => {
        test('plain text passes through', () => expect(escapeCsv('abc')).toBe('abc'));
        test('comma is quoted', () => expect(escapeCsv('a,b')).toBe('"a,b"'));
        test('quote is doubled and quoted', () => expect(escapeCsv('a"b')).toBe('"a""b"'));
        test('newline is quoted', () => expect(escapeCsv('a\nb')).toBe('"a\nb"'));
        test('null becomes empty', () => expect(escapeCsv(null)).toBe(''));
    });

    describe('buildTimesheetCsv', () => {
        test('header only when there are no entries', () => {
            expect(buildTimesheetCsv([])).toBe(CSV_HEADERS.join(','));
            expect(buildTimesheetCsv(null)).toBe(CSV_HEADERS.join(','));
        });
        test('maps names + formats hours and billable', () => {
            const csv = buildTimesheetCsv([
                { Loggeduser: 'u1', ProjectId: 'p1', LogStartTime: 1750377600, LogDescription: 'Work', billable: true, LogTimeDuration: 90 },
            ], { userMap: { u1: 'Alice' }, projectMap: { p1: 'Apollo' } });
            const lines = csv.split('\n');
            expect(lines[0]).toBe('User,Project,Date,Description,Billable,Hours');
            expect(lines[1]).toContain('Alice');
            expect(lines[1]).toContain('Apollo');
            expect(lines[1]).toContain('1.50');
            expect(lines[1]).toContain('Yes');
        });
        test('non-billable + missing names fall back to ids', () => {
            const line = buildTimesheetCsv([
                { Loggeduser: 'u9', ProjectId: 'p9', LogStartTime: 1750377600, LogDescription: 'x', billable: false, LogTimeDuration: 30 },
            ], {}).split('\n')[1];
            expect(line).toContain('u9');
            expect(line).toContain('No');
            expect(line).toContain('0.50');
        });
        test('escapes a description containing commas', () => {
            const line = buildTimesheetCsv([
                { Loggeduser: 'u1', ProjectId: 'p1', LogStartTime: 1750377600, LogDescription: 'a, b, c', LogTimeDuration: 60 },
            ], {}).split('\n')[1];
            expect(line).toContain('"a, b, c"');
        });
    });
});
