const calendar = require('../frontend/src/views/Projects/composables/workingCalendar');
const R = require('../frontend/src/views/Projects/composables/criticalPath');
const { workingDaysFor } = require('../Modules/Company/helpers/workingDays');

/* Local dates, as the chart reads them. 2026-09-04 is a Friday. */
const day = (d, h = 0) => new Date(2026, 8, d, h);
const task = (id, start, end, blocks = []) => ({ id, startDate: start, DueDate: end, blocks });
const WEEKDAYS = [1, 2, 3, 4, 5];
const FRI_TO_SUN = [0, 5, 6];
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

describe('workingDaySet', () => {
    test('is nothing when every day counts', () => {
        expect(calendar.workingDaySet(undefined)).toBeNull();
        expect(calendar.workingDaySet([])).toBeNull();
        expect(calendar.workingDaySet(EVERY_DAY)).toBeNull();
    });

    test('holds the working days otherwise', () => {
        expect([...calendar.workingDaySet(FRI_TO_SUN)].sort()).toEqual(FRI_TO_SUN);
    });
});

describe('workingDaysBetween', () => {
    test('counts the working days from the first day to the last, both included', () => {
        expect(calendar.workingDaysBetween(day(4), day(7), calendar.workingDaySet(WEEKDAYS))).toBe(2);
        expect(calendar.workingDaysBetween(day(4), day(13), calendar.workingDaySet(FRI_TO_SUN))).toBe(6);
        expect(calendar.workingDaysBetween(day(7, 9), day(10, 17), calendar.workingDaySet(FRI_TO_SUN))).toBe(0);
    });

    test('counts every day without a working week', () => {
        expect(calendar.workingDaysBetween(day(4), day(7), null)).toBe(4);
    });

    test('is nothing for a range that ends before it starts', () => {
        expect(calendar.workingDaysBetween(day(7), day(4), calendar.workingDaySet(WEEKDAYS))).toBe(0);
    });
});

describe('durationDays in working days', () => {
    test('leaves out the days the week does not work', () => {
        expect(R.durationDays(day(4), day(7), WEEKDAYS)).toBe(2);
        expect(R.durationDays(day(4), day(7), FRI_TO_SUN)).toBe(3);
    });

    test('is never less than a day, even for a task that sits wholly on days off', () => {
        expect(R.durationDays(day(5), day(6), WEEKDAYS)).toBe(1);
    });

    test('counts as before for a seven-day week or no week at all', () => {
        expect(R.durationDays(day(4), day(7), EVERY_DAY)).toBe(R.durationDays(day(4), day(7)));
        expect(R.durationDays(day(4), day(7))).toBe(4);
    });
});

describe('criticalPath in working days', () => {
    /* b runs Friday to Monday: four calendar days and two working ones. c runs Tuesday to Thursday: three either way. */
    const tasks = [
        task('a', day(1), day(2), ['b', 'c']),
        task('b', day(4), day(7)),
        task('c', day(8), day(10)),
    ];

    test('in calendar days the chain through the weekend is the longest', () => {
        expect(R.criticalPath(tasks)).toMatchObject({ path: ['a', 'b'], durationDays: 6 });
    });

    test('in the default week the weekend does not count, so the other chain is', () => {
        expect(R.criticalPath(tasks, { workingDays: workingDaysFor({}) })).toMatchObject({ path: ['a', 'c'], durationDays: 5 });
    });

    test('a seven-day week reads as calendar days', () => {
        expect(R.criticalPath(tasks, { workingDays: EVERY_DAY })).toMatchObject({ path: ['a', 'b'], durationDays: 6 });
    });
});

describe('the Gantt shift counts through the same calendar', () => {
    test('exports nothing of its own to step over days off', () => {
        const shift = require('../frontend/src/views/Projects/composables/ganttShift');
        expect(Object.keys(shift)).toEqual(['shiftDependants']);
        const source = require('fs').readFileSync(require.resolve('../frontend/src/views/Projects/composables/ganttShift'), 'utf8');
        expect(source).toContain("require('./workingCalendar')");
        expect(source).not.toMatch(/const nextWorkingDay\s*=/);
    });
});
