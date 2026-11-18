import { describe, expect, it } from 'vitest';
import { GOAL_COLORS, formatNumber, formatAmount, formatDay, formatWhen, periodLabel } from '@/views/Goals/goalFormat';

const t = (key, params = {}) => `${key}:${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(',')}`;

describe('goal colours', () => {
    it('are all #rrggbb, because the server stores them that way', () => {
        expect(GOAL_COLORS.length).toBeGreaterThan(0);
        GOAL_COLORS.forEach((color) => expect(color).toMatch(/^#[0-9a-fA-F]{6}$/));
    });

    it('has no repeated colour', () => {
        const lower = GOAL_COLORS.map((c) => c.toLowerCase());
        expect(new Set(lower).size).toBe(lower.length);
    });
});

describe('formatNumber', () => {
    it('groups thousands and keeps at most two decimals', () => {
        expect(formatNumber(1234567.891, 'en-US')).toBe('1,234,567.89');
        expect(formatNumber(0.5, 'en-US')).toBe('0.5');
        expect(formatNumber(-42, 'en-US')).toBe('-42');
        expect(formatNumber(0, 'en-US')).toBe('0');
    });

    it('a number in text is read as a number', () => {
        expect(formatNumber('2500', 'en-US')).toBe('2,500');
    });

    it('a value that is not a number gives nothing to show', () => {
        expect(formatNumber('abc', 'en-US')).toBe('');
        expect(formatNumber(NaN, 'en-US')).toBe('');
        expect(formatNumber(Infinity, 'en-US')).toBe('');
        expect(formatNumber(undefined, 'en-US')).toBe('');
    });

    it('a locale code the browser does not know still formats, using its default', () => {
        expect(formatNumber(1500, 'not a locale!!')).toMatch(/1.?500/);
    });
});

describe('formatAmount', () => {
    it('a currency target shows the currency symbol and drops empty cents', () => {
        expect(formatAmount({ kind: 'currency', currencyCode: 'USD' }, 1500, 'en-US')).toBe('$1,500');
        expect(formatAmount({ kind: 'currency', currencyCode: 'USD' }, 1500.5, 'en-US')).toBe('$1,500.5');
    });

    it('a currency code that does not exist falls back to the code and the number', () => {
        expect(formatAmount({ kind: 'currency', currencyCode: 'x1' }, 12, 'en-US')).toBe('x1 12');
    });

    it('a number target adds its unit after the number', () => {
        expect(formatAmount({ kind: 'number', unit: 'tasks' }, 1200, 'en-US')).toBe('1,200 tasks');
        expect(formatAmount({ kind: 'number' }, 7, 'en-US')).toBe('7');
    });

    it('a currency target with no code is shown as a plain number', () => {
        expect(formatAmount({ kind: 'currency' }, 7, 'en-US')).toBe('7');
    });

    it('no amount gives nothing to show', () => {
        expect(formatAmount({ kind: 'number' }, 'x', 'en-US')).toBe('');
        expect(formatAmount({ kind: 'number' }, Infinity, 'en-US')).toBe('');
    });

    it('null reads as zero, since Number(null) is 0', () => {
        expect(formatAmount({ kind: 'number' }, null, 'en-US')).toBe('0');
    });
});

describe('formatDay', () => {
    it('shows a stored day in the reader\'s own style', () => {
        expect(formatDay('2025-03-05', 'en-US')).toBe('Mar 5, 2025');
    });

    it('29 February of a leap year is a real day', () => {
        expect(formatDay('2024-02-29', 'en-US')).toBe('Feb 29, 2024');
    });

    it('a day without a part, or not a day, shows nothing', () => {
        expect(formatDay('', 'en-US')).toBe('');
        expect(formatDay(undefined, 'en-US')).toBe('');
        expect(formatDay('2025-03', 'en-US')).toBe('');
        expect(formatDay('nonsense', 'en-US')).toBe('');
    });
});

describe('formatWhen', () => {
    it('shows the date and the time', () => {
        const out = formatWhen(new Date(2025, 2, 5, 15, 30).getTime(), 'en-US');
        expect(out).toMatch(/Mar 5, 2025/);
        expect(out).toMatch(/3:30/);
    });

    it('no stamp, zero, or a bad stamp shows nothing', () => {
        expect(formatWhen('', 'en-US')).toBe('');
        expect(formatWhen(null, 'en-US')).toBe('');
        expect(formatWhen(0, 'en-US')).toBe('');
        expect(formatWhen('not a date', 'en-US')).toBe('');
    });
});

describe('periodLabel', () => {
    it('names both ends of the period', () => {
        const label = periodLabel({ periodStart: '2025-01-01', periodEnd: '2025-03-31' }, t, 'en-US');
        expect(label).toBe('Goals.period_range:start=Jan 1, 2025,end=Mar 31, 2025');
    });

    it('with only a start it says "from", with only an end it says "until"', () => {
        expect(periodLabel({ periodStart: '2025-01-01' }, t, 'en-US')).toBe('Goals.period_from:start=Jan 1, 2025');
        expect(periodLabel({ periodEnd: '2025-03-31' }, t, 'en-US')).toBe('Goals.period_until:end=Mar 31, 2025');
    });

    it('with no dates it says there is no period', () => {
        expect(periodLabel({}, t, 'en-US')).toBe('Goals.period_none:');
        expect(periodLabel({ periodStart: 'bad', periodEnd: '' }, t, 'en-US')).toBe('Goals.period_none:');
    });
});
