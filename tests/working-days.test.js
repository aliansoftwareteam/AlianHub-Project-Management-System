const mongoose = require('mongoose');
const { DEFAULT_WORKING_DAYS, checkWorkingDays, workingDaysFor, weekendDaysFor, countsEveryDay } = require('../Modules/Company/helpers/workingDays');
const { shiftDependants } = require('../Modules/Tasks/helpers/ganttShift');
const R = require('../Modules/Pto/helpers/ptoRules');

const MON_TO_FRI = [1, 2, 3, 4, 5];
const SUN_TO_THU = [0, 1, 2, 3, 4];
const MON_TO_SAT = [1, 2, 3, 4, 5, 6];
const FRI_TO_SUN = [0, 5, 6];

describe('workingDaysFor', () => {
    test('a company that never chose works Monday to Friday', () => {
        expect(DEFAULT_WORKING_DAYS).toEqual(MON_TO_FRI);
        expect(workingDaysFor({})).toEqual(MON_TO_FRI);
        expect(workingDaysFor(null, null)).toEqual(MON_TO_FRI);
        expect(workingDaysFor()).toEqual(MON_TO_FRI);
    });

    test('a company with its own week uses it', () => {
        expect(workingDaysFor({ workingDays: SUN_TO_THU })).toEqual(SUN_TO_THU);
    });

    test('a project with its own week overrides the company', () => {
        expect(workingDaysFor({ workingDays: SUN_TO_THU }, { workingDays: [6, 5, 0] })).toEqual(FRI_TO_SUN);
        expect(workingDaysFor({}, { workingDays: MON_TO_SAT })).toEqual(MON_TO_SAT);
    });

    test.each([['null', null], ['nothing', undefined], ['an empty list', []]])('a project storing %s uses the company\'s week', (label, stored) => {
        expect(workingDaysFor({ workingDays: SUN_TO_THU }, { workingDays: stored })).toEqual(SUN_TO_THU);
        expect(workingDaysFor({}, { workingDays: stored })).toEqual(MON_TO_FRI);
    });

    test('a stored list that is not a week is passed over', () => {
        expect(workingDaysFor({ workingDays: SUN_TO_THU }, { workingDays: [9] })).toEqual(SUN_TO_THU);
        expect(workingDaysFor({ workingDays: 'weekdays' })).toEqual(MON_TO_FRI);
    });

    test('never hands out the shared default list', () => {
        workingDaysFor({}).push(6);
        expect(workingDaysFor({})).toEqual(MON_TO_FRI);
    });
});

describe('weekendDaysFor', () => {
    test('is every day the resolved week leaves out', () => {
        expect(weekendDaysFor({})).toEqual([0, 6]);
        expect(weekendDaysFor({ workingDays: SUN_TO_THU })).toEqual([5, 6]);
        expect(weekendDaysFor({ workingDays: SUN_TO_THU }, { workingDays: FRI_TO_SUN })).toEqual([1, 2, 3, 4]);
    });
});

describe('countsEveryDay', () => {
    test('is true only for a seven-day week', () => {
        expect(countsEveryDay([0, 1, 2, 3, 4, 5, 6])).toBe(true);
        expect(countsEveryDay(MON_TO_FRI)).toBe(false);
    });
});

describe('checkWorkingDays', () => {
    test('accepts a week and stores it sorted without repeats', () => {
        expect(checkWorkingDays([5, 1, 1, 3])).toEqual({ ok: true, days: [1, 3, 5] });
        expect(checkWorkingDays([0, 1, 2, 3, 4, 5, 6])).toEqual({ ok: true, days: [0, 1, 2, 3, 4, 5, 6] });
        expect(checkWorkingDays([0])).toEqual({ ok: true, days: [0] });
    });

    test.each([
        ['no days', []],
        ['a day past Saturday', [1, 7]],
        ['a negative day', [-1, 1]],
        ['a fraction', [1.5]],
        ['a day sent as text', ['1']],
        ['an empty entry', [1, null]],
        ['a name', 'weekdays'],
        ['a number', 5],
        ['an object', { 1: true }],
        ['nothing', undefined],
        ['null', null],
    ])('refuses %s', (label, value) => {
        expect(checkWorkingDays(value)).toEqual({ ok: false, error: expect.any(String) });
    });
});

describe('the Gantt shift under a resolved week', () => {
    /* Local dates, as the shift rule reads them. 2026-09-04 is a Friday. */
    const day = (d) => new Date(2026, 8, d);
    const task = (id, start, end) => ({ id, startDate: start, DueDate: end });
    const link = (source, target) => ({ source, target });
    const plain = (shifts) => shifts.map((s) => [s.id, s.days, s.to.startDate, s.to.DueDate]);

    test('a Friday-to-Sunday week lands each dependant on the next working day and keeps its working length', () => {
        const tasks = [task('a', day(4), day(6)), task('b', day(6), day(7)), task('c', day(11), day(13))];
        const week = workingDaysFor({ workingDays: MON_TO_FRI }, { workingDays: FRI_TO_SUN });
        const { shifts } = shiftDependants(tasks, [link('a', 'b'), link('b', 'c')], 'a', { startDate: day(4), DueDate: day(7) }, { workingDays: week });
        expect(plain(shifts)).toEqual([
            ['b', 1, day(11), day(12)],
            ['c', 1, day(12), day(14)],
        ]);
    });

    test('the default week gives the Monday-to-Friday result the shift rule already had', () => {
        const tasks = [task('a', day(1), day(3)), task('b', day(3), day(4)), task('c', day(4), day(9))];
        const links = [link('a', 'b'), link('b', 'c')];
        const moved = { startDate: day(1), DueDate: day(5) };
        const today = shiftDependants(tasks, links, 'a', moved, { workingDays: MON_TO_FRI });
        expect(shiftDependants(tasks, links, 'a', moved, { workingDays: workingDaysFor({}, {}) })).toEqual(today);
        expect(plain(today.shifts)[0]).toEqual(['b', 2, day(7), day(8)]);
    });

    test('a seven-day week counts calendar days', () => {
        const tasks = [task('a', day(1), day(3)), task('b', day(3), day(4))];
        const week = workingDaysFor({ workingDays: [0, 1, 2, 3, 4, 5, 6] });
        const { shifts } = shiftDependants(tasks, [link('a', 'b')], 'a', { startDate: day(1), DueDate: day(5) }, { workingDays: week });
        expect(plain(shifts)).toEqual([['b', 2, day(5), day(6)]]);
    });
});

describe('time off and capacity under a resolved week', () => {
    /* 2026-07-03 is a Friday, 2026-07-05 a Sunday. */
    const leave = { startDate: '2026-07-03', endDate: '2026-07-06', hoursPerDay: 9, status: 'approved' };

    test('the default week counts exactly what the hard-coded weekend counted', () => {
        const weekend = weekendDaysFor({});
        expect(R.workingDaysBetween('2026-07-01', '2026-07-31', weekend)).toBe(R.workingDaysBetween('2026-07-01', '2026-07-31'));
        expect(R.leaveDays(leave, R.DEFAULT_HOURS_PER_DAY, weekend)).toBe(R.leaveDays(leave));
        expect(R.computeAvailableCapacity({ rangeStart: '2026-07-01', rangeEnd: '2026-07-31', ptoEntries: [leave], weekendDays: weekend }))
            .toEqual(R.computeAvailableCapacity({ rangeStart: '2026-07-01', rangeEnd: '2026-07-31', ptoEntries: [leave] }));
    });

    test('a Monday-to-Saturday company counts Saturday as leave and as capacity', () => {
        const weekend = weekendDaysFor({ workingDays: MON_TO_SAT });
        expect(R.leaveDays(leave, R.DEFAULT_HOURS_PER_DAY, weekend)).toBe(3);
        expect(R.computeAvailableCapacity({ rangeStart: '2026-07-01', rangeEnd: '2026-07-31', ptoEntries: [leave], weekendDays: weekend }))
            .toEqual({ workingDays: 27, totalCapacityHours: 243, ptoHours: 27, availableHours: 216 });
    });

    test('a Sunday-to-Thursday company counts Sunday and not Friday', () => {
        const weekend = weekendDaysFor({ workingDays: SUN_TO_THU });
        expect(R.workingDaysBetween('2026-07-03', '2026-07-03', weekend)).toBe(0);
        expect(R.workingDaysBetween('2026-07-05', '2026-07-05', weekend)).toBe(1);
    });
});

describe('the strict schemas declare workingDays', () => {
    const { companies, projectsSchema } = require('../utils/mongo-handler/createSchema');
    const Company = mongoose.models.WorkingDaysCompanyProbe || mongoose.model('WorkingDaysCompanyProbe', companies);
    const Project = mongoose.models.WorkingDaysProjectProbe || mongoose.model('WorkingDaysProjectProbe', projectsSchema);

    test('both schemas are strict', () => {
        expect(companies.options.strict).toBe(true);
        expect(projectsSchema.options.strict).toBe(true);
    });

    test('a company keeps its week', () => {
        expect(new Company({ workingDays: SUN_TO_THU }).toObject().workingDays).toEqual(SUN_TO_THU);
    });

    test('a project keeps its override', () => {
        expect(new Project({ workingDays: FRI_TO_SUN }).toObject().workingDays).toEqual(FRI_TO_SUN);
    });

    /* getCompanyDataFun keeps hydrated company documents in node-cache, which clones them on the way in and out. */
    test('a cached company document still gives its week', () => {
        const NodeCache = require('node-cache');
        const cache = new NodeCache();
        cache.set('company', Company.hydrate({ _id: new mongoose.Types.ObjectId(), Cst_CompanyName: 'Acme', workingDays: SUN_TO_THU }));
        expect(workingDaysFor(cache.get('company'))).toEqual(SUN_TO_THU);
        expect(weekendDaysFor(cache.get('company'))).toEqual([5, 6]);
    });

    test('neither invents a week for a document that never chose one', () => {
        expect(new Company({}).toObject().workingDays).toBeUndefined();
        expect(new Project({}).toObject().workingDays).toBeUndefined();
    });
});
