const { shiftClock, parseDays } = require('./support/shift-clock');
const { summarize } = require('./support/clock-summary');

const DAY = 86400000;

describe('shiftClock', () => {
    const makeTarget = () => ({ Date });

    test('moves the no-argument constructor and Date.now forward', () => {
        const target = makeTarget();
        const before = Date.now();
        const Shifted = shiftClock(target, 40);
        const nowDelta = Shifted.now() - before;
        const ctorDelta = new Shifted().getTime() - before;
        expect(nowDelta).toBeGreaterThanOrEqual(40 * DAY);
        expect(nowDelta).toBeLessThan(40 * DAY + 5000);
        expect(ctorDelta).toBeGreaterThanOrEqual(40 * DAY);
        expect(ctorDelta).toBeLessThan(40 * DAY + 5000);
    });

    test('leaves explicit dates untouched', () => {
        const Shifted = shiftClock(makeTarget(), 400);
        expect(new Shifted('2024-05-01T00:00:00Z').toISOString()).toBe('2024-05-01T00:00:00.000Z');
        expect(new Shifted(0).getTime()).toBe(0);
        expect(new Shifted(2024, 0, 15).getFullYear()).toBe(2024);
        expect(new Shifted(undefined).getTime()).toBeNaN();
        expect(Shifted.parse('2024-05-01T00:00:00Z')).toBe(Date.parse('2024-05-01T00:00:00Z'));
        expect(Shifted.UTC(2024, 0, 1)).toBe(Date.UTC(2024, 0, 1));
    });

    test('keeps instanceof and the string form working', () => {
        const Shifted = shiftClock(makeTarget(), 3);
        expect(new Shifted() instanceof Date).toBe(true);
        expect(new Date() instanceof Shifted).toBe(true);
        expect(typeof Shifted()).toBe('string');
    });

    test('replaces the Date on the target it is given and applies once', () => {
        const target = makeTarget();
        const first = shiftClock(target, 3);
        expect(target.Date).toBe(first);
        expect(shiftClock(target, 3).now()).toBeLessThan(Date.now() + 3 * DAY + 5000);
    });

    test('does nothing for a zero shift', () => {
        const target = makeTarget();
        expect(shiftClock(target, 0)).toBe(Date);
        expect(target.Date).toBe(Date);
    });

    test('leaves timers alone', async () => {
        shiftClock(makeTarget(), 400);
        const start = process.hrtime.bigint();
        await new Promise((resolve) => setTimeout(resolve, 20));
        const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
        expect(elapsedMs).toBeLessThan(2000);
    });
});

describe('parseDays', () => {
    test('reads a number, defaults to zero, rejects junk', () => {
        expect(parseDays('40')).toBe(40);
        expect(parseDays(undefined)).toBe(0);
        expect(parseDays('')).toBe(0);
        expect(() => parseDays('soon')).toThrow(/CLOCK_SHIFT_DAYS/);
    });
});

describe('summarize', () => {
    test('names each failing test and the offset', () => {
        const report = {
            testResults: [
                { name: '/r/tests/a.test.js', status: 'failed', assertionResults: [{ status: 'passed', fullName: 'ok' }, { status: 'failed', fullName: 'a thing expires' }] },
                { name: '/r/tests/b.test.js', status: 'passed', assertionResults: [{ status: 'passed', fullName: 'fine' }] }
            ]
        };
        const text = summarize(report, { label: 'Backend shard 1/2', days: 40 });
        expect(text).toContain('+40 days');
        expect(text).toContain('/r/tests/a.test.js');
        expect(text).toContain('a thing expires');
        expect(text).not.toContain('b.test.js');
    });

    test('reports a clean run', () => {
        expect(summarize({ testResults: [] }, { label: 'Frontend', days: 3 })).toContain('No failing tests');
    });
});
