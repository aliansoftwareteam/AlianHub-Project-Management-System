import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    AUTO_RANGE_ID,
    bucketForStatus,
    formatMinutes,
    resolveCardRange,
    resolveIsoRange,
} from '@/composable/useResourceWorkload';

const localIso = (...parts) => new Date(...parts).toISOString();

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 1, 29, 15, 30, 0));
});

afterEach(() => {
    vi.useRealTimers();
});

describe('formatMinutes', () => {
    it('shows minutes under an hour as minutes', () => {
        expect(formatMinutes(45)).toBe('45m');
        expect(formatMinutes(1)).toBe('1m');
    });

    it('shows whole hours without minutes', () => {
        expect(formatMinutes(60)).toBe('1h');
        expect(formatMinutes(180)).toBe('3h');
    });

    it('pads the minutes after an hour to two digits', () => {
        expect(formatMinutes(185)).toBe('3h 05m');
        expect(formatMinutes(75)).toBe('1h 15m');
    });

    it('rolls minutes that round up to 60 into the next hour', () => {
        expect(formatMinutes(119.6)).toBe('2h');
        expect(formatMinutes(59.6)).toBe('1h');
    });

    it('shows nothing worked as 0h', () => {
        expect(formatMinutes(0)).toBe('0h');
        expect(formatMinutes(-30)).toBe('0h');
        expect(formatMinutes(null)).toBe('0h');
        expect(formatMinutes(undefined)).toBe('0h');
        expect(formatMinutes('abc')).toBe('0h');
    });

    it('reads a number sent as text', () => {
        expect(formatMinutes('90')).toBe('1h 30m');
    });

    it('rounds a fractional minute', () => {
        expect(formatMinutes(90.4)).toBe('1h 30m');
        expect(formatMinutes(90.6)).toBe('1h 31m');
    });

    it('shows long totals in hours', () => {
        expect(formatMinutes(60 * 100 + 5)).toBe('100h 05m');
    });
});

describe('bucketForStatus', () => {
    it('counts a closed or done status as complete whatever its name', () => {
        expect(bucketForStatus('In Review', 'close')).toBe('complete');
        expect(bucketForStatus('Backlog', 'done')).toBe('complete');
        expect(bucketForStatus(undefined, 'close')).toBe('complete');
    });

    it('buckets by words in the name, in any case', () => {
        expect(bucketForStatus('Code REVIEW')).toBe('review');
        expect(bucketForStatus('QA')).toBe('review');
        expect(bucketForStatus('To Do')).toBe('backlog');
        expect(bucketForStatus('Backlog')).toBe('backlog');
        expect(bucketForStatus('In Progress')).toBe('progress');
        expect(bucketForStatus('WIP')).toBe('progress');
    });

    it('reads a status that matches nothing as progress', () => {
        expect(bucketForStatus('Waiting on vendor', 'active')).toBe('progress');
        expect(bucketForStatus('')).toBe('progress');
        expect(bucketForStatus(null)).toBe('progress');
        expect(bucketForStatus('حالة جديدة')).toBe('progress');
    });

    it('lets review win over progress when a name carries both', () => {
        expect(bucketForStatus('Dev review')).toBe('review');
    });

    it('reads a word inside another word, as the server does', () => {
        expect(bucketForStatus('Testing')).toBe('review');
        expect(bucketForStatus('Opening')).toBe('backlog');
    });
});

describe('resolveIsoRange', () => {
    it('resolves today from midnight to the last millisecond', () => {
        expect(resolveIsoRange(1)).toEqual({ dateFrom: localIso(2024, 1, 29), dateTo: localIso(2024, 1, 29, 23, 59, 59, 999) });
    });

    it('resolves yesterday', () => {
        expect(resolveIsoRange(2)).toEqual({ dateFrom: localIso(2024, 1, 28), dateTo: localIso(2024, 1, 28, 23, 59, 59, 999) });
    });

    it('resolves this week from Sunday to Saturday', () => {
        expect(resolveIsoRange(3)).toEqual({ dateFrom: localIso(2024, 1, 25), dateTo: localIso(2024, 2, 2, 23, 59, 59, 999) });
    });

    it('resolves last week', () => {
        expect(resolveIsoRange(4)).toEqual({ dateFrom: localIso(2024, 1, 18), dateTo: localIso(2024, 1, 24, 23, 59, 59, 999) });
    });

    it('ends this month on the leap day', () => {
        expect(resolveIsoRange(5)).toEqual({ dateFrom: localIso(2024, 1, 1), dateTo: localIso(2024, 1, 29, 23, 59, 59, 999) });
    });

    it('resolves last month', () => {
        expect(resolveIsoRange(6)).toEqual({ dateFrom: localIso(2024, 0, 1), dateTo: localIso(2024, 0, 31, 23, 59, 59, 999) });
    });

    it('resolves the last 30 days up to now', () => {
        expect(resolveIsoRange(8)).toEqual({ dateFrom: localIso(2024, 0, 30), dateTo: localIso(2024, 1, 29, 15, 30, 0) });
    });

    it('falls back to today for an id that is not 1 to 8', () => {
        const today = resolveIsoRange(1);
        expect(resolveIsoRange(0)).toEqual(today);
        expect(resolveIsoRange(9)).toEqual(today);
        expect(resolveIsoRange(-2)).toEqual(today);
        expect(resolveIsoRange(undefined)).toEqual(today);
        expect(resolveIsoRange('abc')).toEqual(today);
    });

    it('reads an id sent as text', () => {
        expect(resolveIsoRange('5')).toEqual(resolveIsoRange(5));
    });

    it('answers dates as ISO text', () => {
        const { dateFrom, dateTo } = resolveIsoRange(1);
        expect(dateFrom).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        expect(new Date(dateTo).getTime()).toBeGreaterThan(new Date(dateFrom).getTime());
    });
});

describe('resolveCardRange', () => {
    const global = { dateFrom: '2024-01-01T00:00:00.000Z', dateTo: '2024-01-31T23:59:59.999Z' };

    it('follows the dashboard range for the auto id', () => {
        expect(AUTO_RANGE_ID).toBe(0);
        expect(resolveCardRange(0, global)).toEqual(global);
        expect(resolveCardRange('0', global)).toEqual(global);
    });

    it('uses its own preset for any other id even when a dashboard range exists', () => {
        expect(resolveCardRange(1, global)).toEqual(resolveIsoRange(1));
    });

    it('falls back to the preset resolver when auto has no usable dashboard range', () => {
        expect(resolveCardRange(0, undefined)).toEqual(resolveIsoRange(0));
        expect(resolveCardRange(0, { dateFrom: global.dateFrom })).toEqual(resolveIsoRange(0));
        expect(resolveCardRange(0, { dateTo: global.dateTo })).toEqual(resolveIsoRange(0));
    });

    it('copies only the two dates from the dashboard range', () => {
        expect(resolveCardRange(0, { ...global, extra: 1 })).toEqual(global);
    });
});
