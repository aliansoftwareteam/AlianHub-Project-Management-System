const { formatDate, formatNotificationDate, momentToLuxonFormat } = require('../utils/dateHelpers');

const monday = new Date(2026, 0, 5, 14, 30);

describe('momentToLuxonFormat', () => {
    it('turns the common moment tokens into luxon ones', () => {
        expect(momentToLuxonFormat('DD/MM/YYYY')).toBe('dd/LL/yyyy');
        expect(momentToLuxonFormat('dddd, MMM YY')).toBe('cccc, LLL yy');
    });

    it('leaves empty and non-string input alone', () => {
        expect(momentToLuxonFormat('')).toBe('');
        expect(momentToLuxonFormat(undefined)).toBeUndefined();
        expect(momentToLuxonFormat(5)).toBe(5);
    });
});

describe('formatDate', () => {
    it('defaults to year-month-day', () => {
        expect(formatDate(monday)).toBe('2026-01-05');
    });

    it('formats a Date, millis, ISO text and a {seconds} stamp the same way', () => {
        expect(formatDate(monday, 'DD/MM/YYYY')).toBe('05/01/2026');
        expect(formatDate(monday.getTime(), 'DD/MM/YYYY')).toBe('05/01/2026');
        expect(formatDate({ seconds: monday.getTime() / 1000 }, 'DD/MM/YYYY')).toBe('05/01/2026');
        expect(formatDate('2026-01-05', 'DD/MM/YYYY')).toBe('05/01/2026');
    });

    it('accepts moment weekday and month names', () => {
        expect(formatDate(monday, 'dddd')).toBe('Monday');
        expect(formatDate(monday, 'ddd MMM')).toBe('Mon Jan');
    });

    it('keeps the 24-hour clock with minutes', () => {
        expect(formatDate(monday, 'YYYY-MM-DD HH:mm')).toBe('2026-01-05 14:30');
    });

    it('returns an empty string for nothing or for a date that cannot be read', () => {
        expect(formatDate(null)).toBe('');
        expect(formatDate(undefined)).toBe('');
        expect(formatDate('not a date')).toBe('');
        expect(formatDate(NaN)).toBe('');
    });

    it.failing('writes a day of the month for the moment token D (it prints a localized date instead)', () => {
        expect(formatDate(monday, 'MMMM D, YYYY')).toBe('January 5, 2026');
    });

    it.failing('writes the meridiem for the moment token A (it prints a literal A)', () => {
        expect(formatDate(monday, 'h:mm A')).toBe('2:30 PM');
    });

    it.failing('writes the ordinal day for the moment token Do (the header says it is covered)', () => {
        expect(formatDate(monday, 'MMM Do')).toBe('Jan 5th');
    });
});

describe('formatNotificationDate', () => {
    it('shows N/A when there is no date or it cannot be read', () => {
        expect(formatNotificationDate(null)).toBe('N/A');
        expect(formatNotificationDate(undefined)).toBe('N/A');
        expect(formatNotificationDate('junk')).toBe('N/A');
    });

    it('shows the day-month-year, the AM/PM half of the day and the zone label', () => {
        expect(formatNotificationDate(monday)).toMatch(/^05-01-2026 14:\d\d PM \[IST\]$/);
        expect(formatNotificationDate(new Date(2026, 0, 5, 9, 5))).toMatch(/^05-01-2026 09:\d\d AM \[IST\]$/);
        expect(formatNotificationDate(new Date(2026, 0, 5, 12, 0))).toMatch(/ PM \[IST\]$/);
        expect(formatNotificationDate(new Date(2026, 0, 5, 0, 0))).toMatch(/ AM \[IST\]$/);
    });

    it('reads millis and {seconds} stamps like a Date', () => {
        expect(formatNotificationDate(monday.getTime())).toBe(formatNotificationDate(monday));
        expect(formatNotificationDate({ seconds: monday.getTime() / 1000 })).toBe(formatNotificationDate(monday));
    });

    it.failing('shows the minutes after the hour, not the month number', () => {
        expect(formatNotificationDate(monday)).toBe('05-01-2026 14:30 PM [IST]');
    });
});
