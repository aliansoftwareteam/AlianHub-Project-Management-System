const { DAY_MS, normaliseTzOffset, localDayStart, localWeekday } = require('../utils/localDay');

describe('normaliseTzOffset', () => {
    test('keeps a whole-minute offset inside the real range of zones', () => {
        expect(normaliseTzOffset(-330)).toBe(-330);
        expect(normaliseTzOffset('300')).toBe(300);
        expect(normaliseTzOffset(840)).toBe(840);
        expect(normaliseTzOffset(-840)).toBe(-840);
    });

    test('an offset past 14 hours, a fraction or text that is not a number counts as UTC', () => {
        expect(normaliseTzOffset(841)).toBe(0);
        expect(normaliseTzOffset(-2000)).toBe(0);
        expect(normaliseTzOffset(30.5)).toBe(0);
        expect(normaliseTzOffset('abc')).toBe(0);
        expect(normaliseTzOffset(undefined)).toBe(0);
        expect(normaliseTzOffset(NaN)).toBe(0);
    });

    test('an empty string or null reads as zero, which is UTC too', () => {
        expect(normaliseTzOffset('')).toBe(0);
        expect(normaliseTzOffset(null)).toBe(0);
    });
});

describe('localDayStart', () => {
    test('with no offset the day starts at midnight UTC', () => {
        expect(localDayStart('2025-03-10T15:45:00Z').toISOString()).toBe('2025-03-10T00:00:00.000Z');
    });

    test('a person in New York (offset 300) at 02:00 UTC is still on the day before', () => {
        expect(localDayStart('2025-03-10T02:00:00Z', 300).toISOString()).toBe('2025-03-09T05:00:00.000Z');
    });

    test('a person in India (offset -330) at 20:00 UTC is already on the next day', () => {
        expect(localDayStart('2025-03-10T20:00:00Z', -330).toISOString()).toBe('2025-03-10T18:30:00.000Z');
    });

    test('the very first instant of a local day belongs to that day', () => {
        const start = localDayStart('2025-06-01T05:00:00Z', 300);
        expect(start.toISOString()).toBe('2025-06-01T05:00:00.000Z');
        expect(localDayStart(new Date(start.getTime() - 1), 300).toISOString()).toBe('2025-05-31T05:00:00.000Z');
    });

    test('leap day: 29 February is its own day and the next one starts a day later', () => {
        const leap = localDayStart('2024-02-29T12:00:00Z');
        expect(leap.toISOString()).toBe('2024-02-29T00:00:00.000Z');
        expect(localDayStart(new Date(leap.getTime() + DAY_MS)).toISOString()).toBe('2024-03-01T00:00:00.000Z');
        expect(localDayStart('2023-03-01T00:00:00Z').getTime() - localDayStart('2023-02-28T00:00:00Z').getTime()).toBe(DAY_MS);
    });

    test('an unusable offset falls back to UTC rather than shifting the day', () => {
        expect(localDayStart('2025-03-10T02:00:00Z', 99999).toISOString()).toBe('2025-03-10T00:00:00.000Z');
    });

    test('a date that does not parse gives an invalid date, not a guess', () => {
        expect(Number.isNaN(localDayStart('not a date').getTime())).toBe(true);
    });
});

describe('localWeekday', () => {
    test('2025-03-10 at noon UTC is a Monday', () => {
        expect(localWeekday('2025-03-10T12:00:00Z')).toBe(1);
    });

    test('the weekday follows the person: Sunday night in UTC is still Saturday in Los Angeles', () => {
        expect(localWeekday('2025-03-09T03:00:00Z', 480)).toBe(6);
        expect(localWeekday('2025-03-09T03:00:00Z', 0)).toBe(0);
    });

    test('Saturday evening in UTC is already Sunday in Tokyo', () => {
        expect(localWeekday('2025-03-08T20:00:00Z', -540)).toBe(0);
    });

    test('29 February 2024 is a Thursday', () => {
        expect(localWeekday('2024-02-29T12:00:00Z')).toBe(4);
    });
});
