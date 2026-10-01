const { NOW, SEEDED, TIMEZONE, freezeTimestamps } = require('../scripts/visual/freeze');

const RUN_START = Date.parse('2026-10-01T09:00:00.000Z');
const run = { from: RUN_START, to: RUN_START + 20 * 60 * 1000 };
const minuteOf = (iso) => iso.slice(0, 16);

describe('the fixed clock', () => {
    test('the page reads a morning in the past, in one time zone', () => {
        expect(TIMEZONE).toBe('UTC');
        expect(new Date(NOW).getUTCHours()).toBeLessThan(12);
        // A session or licence that ends after the real today must still read as in the future.
        expect(Date.parse(NOW)).toBeLessThan(Date.parse('2026-10-01T00:00:00Z'));
    });

    test('the seeded records read as made earlier the same day', () => {
        expect(Date.parse(SEEDED)).toBeLessThan(Date.parse(NOW));
        expect(SEEDED.slice(0, 10)).toBe(NOW.slice(0, 10));
    });
});

describe('freezing the dates the server stamped during the run', () => {
    test('a stamp from the run becomes the seeded moment', () => {
        const body = JSON.stringify({ createdAt: '2026-10-01T09:00:00.000Z' });
        expect(JSON.parse(freezeTimestamps(body, run)).createdAt).toBe(SEEDED);
    });

    test('two runs on different days give the same minute', () => {
        const monday = freezeTimestamps('"2026-10-05T14:01:05.120Z"', { from: Date.parse('2026-10-05T14:00:00Z'), to: Date.parse('2026-10-05T14:30:00Z') });
        const friday = freezeTimestamps('"2026-10-09T03:31:11.900Z"', { from: Date.parse('2026-10-09T03:30:00Z'), to: Date.parse('2026-10-09T04:00:00Z') });
        expect(minuteOf(JSON.parse(monday))).toBe(minuteOf(SEEDED));
        expect(minuteOf(JSON.parse(friday))).toBe(minuteOf(SEEDED));
    });

    test('records keep the order they were made in', () => {
        const body = JSON.stringify(['2026-10-01T09:00:02.000Z', '2026-10-01T09:00:01.000Z', '2026-10-01T09:05:00.000Z']);
        const [second, first, last] = JSON.parse(freezeTimestamps(body, run));
        expect(first < second).toBe(true);
        expect(second < last).toBe(true);
        expect(minuteOf(last)).toBe(minuteOf(SEEDED));
    });

    test('a stamp written with an offset or without milliseconds is recognised', () => {
        expect(freezeTimestamps('"2026-10-01T14:30:00+05:30"', run)).toBe(`"${SEEDED}"`);
        expect(freezeTimestamps('"2026-10-01T09:00:00Z"', run)).toBe(`"${SEEDED}"`);
    });

    test('dates from outside the run are left alone: due dates, expiries, anything older', () => {
        const body = JSON.stringify({ due: '2026-01-16T00:00:00.000Z', expires: '2026-10-02T09:00:00.000Z', founded: '2019-03-04T10:00:00.000Z' });
        expect(freezeTimestamps(body, run)).toBe(body);
    });

    test('ids, counts and plain dates are left alone', () => {
        const body = JSON.stringify({ _id: '66fb1e2a9c3d4e5f6a7b8c9d', key: 1759309200000, count: 42, day: '2026-10-01' });
        expect(freezeTimestamps(body, run)).toBe(body);
    });

    test('a socket.io polling frame is text, not JSON, and is handled the same way', () => {
        expect(freezeTimestamps('42["taskUpdated",{"updatedAt":"2026-10-01T09:10:00.000Z"}]', run)).toContain(minuteOf(SEEDED));
    });
});
