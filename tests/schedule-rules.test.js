const R = require('../Modules/ScheduledReports/helpers/scheduleRules');

describe('validateSchedule', () => {
    test('valid (string recipients)', () => {
        const v = R.validateSchedule({ savedReportId: 'abc', cadence: 'daily', recipients: 'a@x.com, b@y.com' });
        expect(v.valid).toBe(true);
        expect(v.value.recipients).toEqual(['a@x.com', 'b@y.com']);
        expect(v.value.cadence).toBe('daily');
    });
    test('missing report id + no valid email → 2 errors', () => {
        const v = R.validateSchedule({ recipients: 'not-an-email' });
        expect(v.valid).toBe(false);
        expect(v.errors.length).toBe(2);
    });
    test('unknown cadence falls back to weekly', () => {
        expect(R.validateSchedule({ savedReportId: 'x', cadence: 'hourly', recipients: ['a@x.com'] }).value.cadence).toBe('weekly');
    });
    test('dedupes + lowercases recipients', () => {
        expect(R.validateSchedule({ savedReportId: 'x', recipients: ['A@x.com', 'a@x.com'] }).value.recipients).toEqual(['a@x.com']);
    });
});

describe('computeNextRun', () => {
    const from = new Date('2026-06-20T07:00:00.000Z');
    test('daily +1 day', () => { expect(R.computeNextRun('daily', from).toISOString()).toBe('2026-06-21T07:00:00.000Z'); });
    test('weekly +7 days', () => { expect(R.computeNextRun('weekly', from).toISOString()).toBe('2026-06-27T07:00:00.000Z'); });
    test('monthly +1 month', () => { expect(R.computeNextRun('monthly', from).toISOString()).toBe('2026-07-20T07:00:00.000Z'); });
    test('invalid date → null', () => { expect(R.computeNextRun('daily', 'nope')).toBeNull(); });
});

describe('isDue', () => {
    const now = new Date('2026-06-20T12:00:00.000Z');
    test('active + past nextRunAt → due', () => { expect(R.isDue({ active: true, nextRunAt: '2026-06-20T06:00:00.000Z' }, now)).toBe(true); });
    test('active + future → not due', () => { expect(R.isDue({ active: true, nextRunAt: '2026-06-21T06:00:00.000Z' }, now)).toBe(false); });
    test('inactive → not due', () => { expect(R.isDue({ active: false, nextRunAt: '2020-01-01T00:00:00.000Z' }, now)).toBe(false); });
    test('never run (no nextRunAt) + active → due', () => { expect(R.isDue({ active: true }, now)).toBe(true); });
    test('deleted → not due', () => { expect(R.isDue({ active: true, deletedStatusKey: 1, nextRunAt: '2020-01-01T00:00:00.000Z' }, now)).toBe(false); });
});

describe('reportEmailHtml', () => {
    test('renders rows + escapes HTML', () => {
        const html = R.reportEmailHtml({ name: 'My <b>Rpt', rows: [{ label: 'A & B', value: 3 }], total: 3 });
        expect(html).toContain('My &lt;b&gt;Rpt');
        expect(html).toContain('A &amp; B');
        expect(html).toContain('Total');
    });
    test('empty rows → "No data."', () => {
        expect(R.reportEmailHtml({ name: 'X', rows: [], total: 0 })).toContain('No data.');
    });
});
