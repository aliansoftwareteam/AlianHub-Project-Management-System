const R = require('../Modules/Calendar/helpers/icalRules');

describe('feed tokens', () => {
    test('36 hex, unique, recognised', () => {
        const t = R.generateFeedToken();
        expect(t).toMatch(/^[a-f0-9]{36}$/);
        expect(R.isFeedToken(t)).toBe(true);
        expect(R.generateFeedToken()).not.toBe(t);
    });
    test('junk rejected', () => { expect(R.isFeedToken('x')).toBe(false); expect(R.isFeedToken(null)).toBe(false); });
});

describe('fmtDate', () => {
    test('UTC all-day', () => { expect(R.fmtDate('2026-06-20T10:00:00Z')).toBe('20260620'); });
    test('invalid → null', () => { expect(R.fmtDate('nope')).toBeNull(); });
});

describe('escapeText', () => {
    test('escapes ; , \\ and newlines', () => {
        expect(R.escapeText('a;b,c\\d\ne')).toBe('a\\;b\\,c\\\\d\\ne');
    });
});

describe('buildIcs', () => {
    const ics = R.buildIcs({
        calName: 'My Cal', stamp: '20260620T000000Z',
        events: [{ uid: 'T1', summary: 'Fix; bug', date: '2026-06-22', url: 'http://x', description: 'do it' }],
    });
    test('valid envelope', () => {
        expect(ics).toContain('BEGIN:VCALENDAR');
        expect(ics).toContain('END:VCALENDAR');
        expect(ics).toContain('VERSION:2.0');
    });
    test('event rendered, escaped, all-day', () => {
        expect(ics).toContain('BEGIN:VEVENT');
        expect(ics).toContain('DTSTART;VALUE=DATE:20260622');
        expect(ics).toContain('SUMMARY:Fix\\; bug');
        expect(ics).toContain('UID:T1@alianhub');
    });
    test('skips events with bad dates', () => {
        const i = R.buildIcs({ stamp: '20260620T000000Z', events: [{ summary: 'x', date: 'bad' }] });
        expect(i).not.toContain('BEGIN:VEVENT');
    });
    test('CRLF line endings', () => { expect(ics).toContain('\r\n'); });
});
