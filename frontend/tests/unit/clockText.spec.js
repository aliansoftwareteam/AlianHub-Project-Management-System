import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    clockPrefs, followClockPrefs, clockText, dayText, dayClockText, weekdayClockText, recentText, recentClockText, fullText, hourCycleOption,
} from '@/utils/clockText';

const AFTERNOON = new Date(2026, 9, 2, 14, 57, 30);
const EARLY = new Date(2026, 9, 2, 8, 4);
const LAST_MONTH = new Date(2026, 8, 12, 12, 19, 37);
const LAST_YEAR = new Date(2025, 11, 31, 23, 5);

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 2, 18, 0) });
    followClockPrefs();
});

afterEach(() => vi.useRealTimers());

describe('with nothing set', () => {
    it('the clock is 12-hour and the date is day first', () => {
        expect(clockPrefs).toEqual({ twelveHour: true, dateFormat: 'DD/MM/YYYY' });
        expect(clockText(AFTERNOON)).toBe('2:57 PM');
        expect(fullText(AFTERNOON)).toBe('02/10/2026, 2:57 PM');
    });
});

describe('the person chose 12-hour time', () => {
    beforeEach(() => followClockPrefs({ timeFormat: '12', dateFormat: 'DD/MM/YYYY' }));

    it('every text shows the same clock', () => {
        expect(clockText(EARLY)).toBe('8:04 AM');
        expect(dayClockText(LAST_MONTH)).toBe('12 Sep, 12:19 PM');
        expect(weekdayClockText(LAST_MONTH)).toBe('Sat 12 Sep, 12:19 PM');
        expect(recentClockText(LAST_MONTH)).toBe('12 Sep, 12:19 PM');
        expect(fullText(LAST_MONTH)).toBe('12/09/2026, 12:19 PM');
    });

    it('an Intl formatter is told the same', () => {
        expect(hourCycleOption()).toEqual({ hourCycle: 'h12' });
    });
});

describe('the person chose 24-hour time', () => {
    beforeEach(() => followClockPrefs({ timeFormat: '24', dateFormat: 'DD/MM/YYYY' }));

    it('every text shows the same clock', () => {
        expect(clockText(AFTERNOON)).toBe('14:57');
        expect(clockText(EARLY)).toBe('08:04');
        expect(dayClockText(LAST_MONTH)).toBe('12 Sep, 12:19');
        expect(weekdayClockText(AFTERNOON)).toBe('Fri 2 Oct, 14:57');
        expect(recentClockText(LAST_MONTH)).toBe('12 Sep, 12:19');
        expect(fullText(LAST_MONTH)).toBe('12/09/2026, 12:19');
    });

    it('an Intl formatter is told the same', () => {
        expect(hourCycleOption()).toEqual({ hourCycle: 'h23' });
        expect(new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit', ...hourCycleOption() }).format(new Date(2026, 9, 2, 0, 5))).toBe('00:05');
    });

    it('a number is read as the person chose it too', () => {
        followClockPrefs({ timeFormat: 24 });
        expect(clockText(AFTERNOON)).toBe('14:57');
    });
});

describe('today and older', () => {
    it('a row of today shows the time, an older one the day', () => {
        expect(recentText(AFTERNOON)).toBe('2:57 PM');
        expect(recentText(LAST_MONTH)).toBe('12 Sep');
        expect(recentClockText(AFTERNOON)).toBe('2:57 PM');
    });

    it('another year is named', () => {
        expect(dayText(LAST_YEAR)).toBe('31 Dec 2025');
        expect(recentText(LAST_YEAR)).toBe('31 Dec 2025');
        expect(dayClockText(LAST_YEAR)).toBe('31 Dec 2025, 11:05 PM');
    });
});

describe('the workspace date format', () => {
    it('is the date of the full text', () => {
        followClockPrefs({ timeFormat: '24', dateFormat: 'MM/DD/YYYY' });
        expect(fullText(LAST_MONTH)).toBe('09/12/2026, 12:19');
        followClockPrefs({ timeFormat: '12', dateFormat: 'YYYY-MM-DD' });
        expect(fullText(LAST_MONTH)).toBe('2026-09-12, 12:19 PM');
    });
});

describe('what a time can be given as', () => {
    it('a date, milliseconds, an ISO text or a stored seconds object', () => {
        const ms = AFTERNOON.getTime();
        expect([clockText(ms), clockText(AFTERNOON.toISOString()), clockText({ seconds: ms / 1000 })]).toEqual(['2:57 PM', '2:57 PM', '2:57 PM']);
    });

    it('nothing, or something that is no time, gives no text', () => {
        const texts = [clockText, dayText, dayClockText, weekdayClockText, recentText, recentClockText, fullText];
        ['', null, undefined, 'not a date', NaN].forEach((value) => {
            expect(texts.map((text) => text(value))).toEqual(['', '', '', '', '', '', '']);
        });
    });
});
