const R = require('../frontend/src/views/Projects/composables/recurrence');
const backend = require('../Modules/RecurringTasks/recurrenceRules');

const at = (y, m, d, h = 0) => new Date(y, m - 1, d, h, 0, 0, 0);
const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:00`;

describe('normalizeRule', () => {
    test('fills the defaults the scheduler assumes', () => {
        expect(R.normalizeRule({})).toMatchObject({ freq: 'daily', interval: 1, byweekday: [], monthday: null, runHour: 9, until: null });
    });
    test('clamps the hour, the month day and the interval', () => {
        const r = R.normalizeRule({ freq: 'monthly', interval: 0, monthday: 31, runHour: 99 });
        expect(r).toMatchObject({ interval: 1, monthday: 28, runHour: 23 });
    });
    test('drops weekday values that are not weekdays', () => {
        expect(R.normalizeRule({ freq: 'weekly', byweekday: [5, 5, 9, -1, 'x'] }).byweekday).toEqual([5]);
    });
});

describe('computeNextRun', () => {
    test('daily honours the interval and the run hour', () => {
        const next = R.computeNextRun({ freq: 'daily', interval: 3, runHour: 7 }, at(2026, 9, 3, 18));
        expect(iso(next)).toBe('2026-09-06 07:00');
    });
    test('weekly lands on the next chosen weekday', () => {
        // Thu 3 Sep 2026 → Friday is the next day.
        const next = R.computeNextRun({ freq: 'weekly', byweekday: [5], runHour: 16 }, at(2026, 9, 3, 9));
        expect(next.getDay()).toBe(5);
        expect(iso(next)).toBe('2026-09-04 16:00');
    });
    test('weekly with no weekday repeats the day it started on', () => {
        const next = R.computeNextRun({ freq: 'weekly' }, at(2026, 9, 3, 9));
        expect(iso(next)).toBe('2026-09-10 09:00');
    });
    test('monthly skips to the next month when this month is already past', () => {
        const next = R.computeNextRun({ freq: 'monthly', monthday: 1, runHour: 9 }, at(2026, 9, 3, 9));
        expect(iso(next)).toBe('2026-10-01 09:00');
    });
    test('monthly never overflows a short month', () => {
        const next = R.computeNextRun({ freq: 'monthly', monthday: 31 }, at(2026, 1, 30, 9));
        expect(next.getMonth()).toBe(1);
        expect(next.getDate()).toBe(28);
    });
    test('agrees with the scheduler that actually creates the tasks', () => {
        const from = at(2026, 9, 3, 11);
        [
            { freq: 'daily', interval: 2, runHour: 9 },
            { freq: 'weekly', interval: 2, byweekday: [5], runHour: 16 },
            { freq: 'weekly', byweekday: [1, 3], runHour: 8 },
            { freq: 'monthly', interval: 1, monthday: 6, runHour: 7 }
        ].forEach((rule) => {
            expect(iso(R.computeNextRun(rule, from))).toBe(iso(backend.computeNextRun(rule, from)));
        });
    });
});

describe('nextOccurrences', () => {
    test('previews a fortnightly-style retro as consecutive Fridays', () => {
        const dates = R.nextOccurrences({ freq: 'weekly', byweekday: [5], runHour: 16 }, at(2026, 9, 3, 9), 4);
        expect(dates.map(iso)).toEqual([
            '2026-09-04 16:00',
            '2026-09-11 16:00',
            '2026-09-18 16:00',
            '2026-09-25 16:00'
        ]);
    });
    test('stops at the rule end date', () => {
        const dates = R.nextOccurrences({ freq: 'daily', interval: 1, runHour: 9, until: at(2026, 9, 6, 23) }, at(2026, 9, 3, 9), 5);
        expect(dates.map(iso)).toEqual(['2026-09-04 09:00', '2026-09-05 09:00', '2026-09-06 09:00']);
    });
    test('asking for none returns none', () => {
        expect(R.nextOccurrences({ freq: 'daily' }, at(2026, 9, 3), 0)).toEqual([]);
    });
    test('each preview date is strictly after the one before it', () => {
        const dates = R.nextOccurrences({ freq: 'monthly', monthday: 6, interval: 1 }, at(2026, 9, 3), 4);
        dates.forEach((date, i) => { if (i) expect(date.getTime()).toBeGreaterThan(dates[i - 1].getTime()); });
    });
});

describe('missed-occurrence policy', () => {
    test('reads a rule that only ever stored skipIfOpen', () => {
        expect(R.missedPolicyOf({ skipIfOpen: true })).toBe('skip');
        expect(R.missedPolicyOf({ skipIfOpen: false })).toBe('create');
    });
    test('an explicit policy wins over the legacy flag', () => {
        expect(R.missedPolicyOf({ skipIfOpen: false, missedPolicy: 'roll' })).toBe('roll');
    });
    test('sends skipIfOpen alongside the policy so an old server still obeys', () => {
        expect(R.missedPolicyFields('roll')).toEqual({ missedPolicy: 'roll', skipIfOpen: true });
        expect(R.missedPolicyFields('create')).toEqual({ missedPolicy: 'create', skipIfOpen: false });
        expect(R.missedPolicyFields('nonsense')).toEqual({ missedPolicy: 'create', skipIfOpen: false });
    });
    test('nothing is skipped when the last one is finished', () => {
        expect(R.resolveOccurrence('skip', false)).toBe('create');
        expect(R.resolveOccurrence('roll', false)).toBe('create');
    });
    test('an open previous instance follows the policy', () => {
        expect(R.resolveOccurrence('skip', true)).toBe('skip');
        expect(R.resolveOccurrence('roll', true)).toBe('roll');
        expect(R.resolveOccurrence('create', true)).toBe('create');
    });
});
