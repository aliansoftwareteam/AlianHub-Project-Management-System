const R = require('../frontend/src/views/Timesheet/report/reportRange');

describe('report date presets', () => {
    const today = '2026-11-04'; // a Wednesday

    it.each([
        ['today', '2026-11-04', '2026-11-04'],
        ['yesterday', '2026-11-03', '2026-11-03'],
        ['this_week', '2026-11-02', '2026-11-08'],
        ['last_week', '2026-10-26', '2026-11-01'],
        ['this_month', '2026-11-01', '2026-11-30'],
        ['last_month', '2026-10-01', '2026-10-31'],
        ['this_quarter', '2026-10-01', '2026-12-31'],
        ['last_quarter', '2026-07-01', '2026-09-30'],
        ['this_year', '2026-01-01', '2026-12-31'],
        ['last_year', '2025-01-01', '2025-12-31'],
        ['last_7', '2026-10-29', '2026-11-04'],
        ['last_30', '2026-10-06', '2026-11-04'],
        ['last_90', '2026-08-07', '2026-11-04'],
    ])('%s', (preset, start, end) => {
        expect(R.rangeOf(preset, today)).toEqual({ start, end });
    });

    it('starts the week on Monday, also on a Sunday and across a new year', () => {
        expect(R.rangeOf('this_week', '2026-11-08')).toEqual({ start: '2026-11-02', end: '2026-11-08' });
        expect(R.rangeOf('this_week', '2027-01-01')).toEqual({ start: '2026-12-28', end: '2027-01-03' });
        expect(R.rangeOf('last_week', '2027-01-04')).toEqual({ start: '2026-12-28', end: '2027-01-03' });
    });

    it('handles the first quarter, January and leap years', () => {
        expect(R.rangeOf('last_quarter', '2026-02-10')).toEqual({ start: '2025-10-01', end: '2025-12-31' });
        expect(R.rangeOf('last_month', '2026-01-15')).toEqual({ start: '2025-12-01', end: '2025-12-31' });
        expect(R.rangeOf('this_month', '2028-02-10')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
        expect(R.rangeOf('last_month', '2028-03-31')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
    });

    it('keeps a custom range, in order, and falls back when its days are not real', () => {
        expect(R.rangeOf('custom', today, { start: '2026-10-10', end: '2026-10-20' })).toEqual({ start: '2026-10-10', end: '2026-10-20' });
        expect(R.rangeOf('custom', today, { start: '2026-10-20', end: '2026-10-10' })).toEqual({ start: '2026-10-10', end: '2026-10-20' });
        expect(R.rangeOf('custom', today, { start: '2026-10-20' })).toEqual({ start: '2026-10-20', end: '2026-10-20' });
        expect(R.rangeOf('custom', today, { start: '2026-02-30', end: '2026-03-01' })).toEqual({ start: today, end: today });
        expect(R.rangeOf('nonsense', today)).toEqual(R.rangeOf('this_week', today));
    });

    it('steps a calendar preset by its own period and anything else by its length', () => {
        expect(R.shiftRange({ start: '2026-11-02', end: '2026-11-08' }, 'this_week', -1)).toEqual({ start: '2026-10-26', end: '2026-11-01' });
        expect(R.shiftRange({ start: '2026-01-01', end: '2026-01-31' }, 'this_month', 1)).toEqual({ start: '2026-02-01', end: '2026-02-28' });
        expect(R.shiftRange({ start: '2026-10-01', end: '2026-12-31' }, 'this_quarter', 1)).toEqual({ start: '2027-01-01', end: '2027-03-31' });
        expect(R.shiftRange({ start: '2026-01-01', end: '2026-12-31' }, 'this_year', -1)).toEqual({ start: '2025-01-01', end: '2025-12-31' });
        expect(R.shiftRange({ start: '2026-11-04', end: '2026-11-04' }, 'today', 1)).toEqual({ start: '2026-11-05', end: '2026-11-05' });
        expect(R.shiftRange({ start: '2026-10-29', end: '2026-11-04' }, 'last_7', -1)).toEqual({ start: '2026-10-22', end: '2026-10-28' });
    });

    it('names a range by the preset it matches today', () => {
        expect(R.presetFor({ start: '2026-11-02', end: '2026-11-08' }, today)).toBe('this_week');
        expect(R.presetFor({ start: '2026-11-03', end: '2026-11-03' }, today)).toBe('yesterday');
        expect(R.presetFor({ start: '2026-11-03', end: '2026-11-05' }, today)).toBe('custom');
        expect(R.presetFor({ start: '2026-11-02', end: '2026-11-08' }, today, ['today', 'custom'])).toBe('custom');
    });

    it('tells one ISO week apart from other ranges', () => {
        expect(R.isOneIsoWeek({ start: '2026-11-02', end: '2026-11-08' })).toBe(true);
        expect(R.isOneIsoWeek({ start: '2026-11-03', end: '2026-11-09' })).toBe(false);
        expect(R.isOneIsoWeek({ start: '2026-11-01', end: '2026-11-30' })).toBe(false);
    });

    it('uses days up to a month, then weeks, then months, and buckets clip to the range', () => {
        expect(R.granularityOf({ start: '2026-10-01', end: '2026-10-31' })).toBe('day');
        expect(R.granularityOf({ start: '2026-08-07', end: '2026-11-04' })).toBe('week');
        expect(R.granularityOf({ start: '2026-01-01', end: '2026-12-31' })).toBe('month');

        const weeks = R.bucketsOf({ start: '2026-10-29', end: '2026-11-10' }, 'week');
        expect(weeks.map((b) => [b.key, b.start, b.end, b.days.length])).toEqual([
            ['2026-10-26', '2026-10-29', '2026-11-01', 4],
            ['2026-11-02', '2026-11-02', '2026-11-08', 7],
            ['2026-11-09', '2026-11-09', '2026-11-10', 2],
        ]);
        const months = R.bucketsOf({ start: '2026-01-15', end: '2026-03-02' }, 'month');
        expect(months.map((b) => [b.key, b.days.length])).toEqual([['2026-01-01', 17], ['2026-02-01', 28], ['2026-03-01', 2]]);
        expect(R.daysOf({ start: '2026-12-30', end: '2027-01-02' })).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
    });

    it('checks calendar days strictly', () => {
        expect(R.isDay('2026-11-04')).toBe(true);
        expect(R.isDay('2026-13-01')).toBe(false);
        expect(R.isDay('2026-11-4')).toBe(false);
        expect(R.isDay(20261104)).toBe(false);
    });
});

describe('the any-time preset of a queue', () => {
    it('covers everything, does not step, and is recognised only where it is offered', () => {
        const all = R.rangeOf(R.ANY_TIME, '2026-11-04');
        expect(all).toEqual({ start: '1970-01-01', end: '2999-12-31' });
        expect(R.shiftRange(all, R.ANY_TIME, 1)).toEqual(all);
        expect(R.presetFor(all, '2026-11-04', [R.ANY_TIME, ...R.PRESETS])).toBe(R.ANY_TIME);
        expect(R.presetFor(all, '2026-11-04')).toBe('custom');
    });
});
