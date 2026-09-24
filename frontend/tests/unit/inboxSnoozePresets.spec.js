import { describe, expect, it, vi } from 'vitest';
import { resolveTimeZone, snoozeTarget, zonedToUtc } from '@/views/Inbox/snoozePresets';
import { laterStorageKey, migrateLegacyLater, readLegacyLater } from '@/views/Inbox/laterMigration';

describe('snooze presets, in the reader\'s time zone', () => {
    // Thursday 24 September 2026, 10:20 in New York (UTC-4).
    const now = new Date('2026-09-24T14:20:00Z');

    it('later today is three hours on, at the top of the hour', () => {
        expect(snoozeTarget('later_today', { now, timeZone: 'America/New_York' })).toEqual({ until: '2026-09-24T18:00:00.000Z' });
    });

    it('tomorrow is 9:00 the next morning where the reader is', () => {
        expect(snoozeTarget('tomorrow', { now, timeZone: 'America/New_York' })).toEqual({ until: '2026-09-25T13:00:00.000Z' });
        expect(snoozeTarget('tomorrow', { now, timeZone: 'Asia/Kolkata' })).toEqual({ until: '2026-09-25T03:30:00.000Z' });
    });

    it('next week is Monday at 9:00', () => {
        expect(snoozeTarget('next_week', { now, timeZone: 'America/New_York' })).toEqual({ until: '2026-09-28T13:00:00.000Z' });
        const monday = new Date('2026-09-28T14:00:00Z');
        expect(snoozeTarget('next_week', { now: monday, timeZone: 'America/New_York' })).toEqual({ until: '2026-10-05T13:00:00.000Z' });
    });

    it('"until it changes" carries no time', () => {
        expect(snoozeTarget('until_change', { now, timeZone: 'UTC' })).toEqual({ untilChange: true });
    });

    it('a picked date and time is read in the reader\'s zone, across a clock change', () => {
        expect(zonedToUtc('2026-09-30T08:15', 'America/New_York').toISOString()).toBe('2026-09-30T12:15:00.000Z');
        expect(zonedToUtc('2026-11-02T08:15', 'America/New_York').toISOString()).toBe('2026-11-02T13:15:00.000Z');
        expect(snoozeTarget('custom', { now, timeZone: 'Asia/Kolkata', value: '2026-09-30T09:00' })).toEqual({ until: '2026-09-30T03:30:00.000Z' });
    });

    it('refuses a picked time that has already passed', () => {
        expect(snoozeTarget('custom', { now, timeZone: 'UTC', value: '2026-09-24T09:00' })).toBeNull();
        expect(snoozeTarget('custom', { now, timeZone: 'UTC', value: '' })).toBeNull();
    });

    it('falls back to the browser zone when the profile holds no valid one', () => {
        expect(resolveTimeZone('Asia/Kolkata')).toBe('Asia/Kolkata');
        expect(resolveTimeZone('Not/AZone')).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
        expect(resolveTimeZone('')).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    });
});

describe('moving browser-stored "Later" to the server', () => {
    const storage = () => {
        const data = new Map();
        return {
            getItem: (k) => (data.has(k) ? data.get(k) : null),
            setItem: (k, v) => data.set(k, String(v)),
            removeItem: (k) => data.delete(k),
            data,
        };
    };
    const key = laterStorageKey('c1', 'u1');
    const N = '64a000000000000000000001';
    const M = '64a000000000000000000002';

    it('reads the old per-device list', () => {
        const s = storage();
        s.setItem(key, JSON.stringify({ [`notification:${N}`]: 1, [`mention:${M}`]: 2, 'approval:x': 3, junk: 4 }));
        expect(key).toBe('alianhub.inbox.later.c1.u1');
        expect(readLegacyLater(s, key)).toEqual([{ sourceType: 'notification', sourceId: N }, { sourceType: 'mention', sourceId: M }]);
    });

    it('snoozes the entries on the server, then drops the local key', async () => {
        const s = storage();
        s.setItem(key, JSON.stringify({ [`notification:${N}`]: 1 }));
        const snooze = vi.fn().mockResolvedValue(true);
        expect(await migrateLegacyLater({ storage: s, key, snooze })).toBe(1);
        expect(snooze).toHaveBeenCalledWith([{ sourceType: 'notification', sourceId: N }]);
        expect(s.getItem(key)).toBeNull();
    });

    it('keeps the local key when the server refuses, to try again next time', async () => {
        const s = storage();
        s.setItem(key, JSON.stringify({ [`mention:${M}`]: 1 }));
        expect(await migrateLegacyLater({ storage: s, key, snooze: vi.fn().mockResolvedValue(false) })).toBe(0);
        expect(s.getItem(key)).not.toBeNull();
    });

    it('does nothing, and calls nobody, when there is no old list', async () => {
        const snooze = vi.fn();
        expect(await migrateLegacyLater({ storage: storage(), key, snooze })).toBe(0);
        expect(snooze).not.toHaveBeenCalled();
    });

    it('drops an unreadable or empty list without calling the server', async () => {
        const s = storage();
        s.setItem(key, '{not json');
        const snooze = vi.fn();
        expect(await migrateLegacyLater({ storage: s, key, snooze })).toBe(0);
        expect(snooze).not.toHaveBeenCalled();
        expect(s.getItem(key)).toBeNull();
    });
});
