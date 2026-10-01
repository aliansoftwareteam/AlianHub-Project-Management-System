const vm = require('vm');
const { shiftClock, parseDays } = require('./support/shift-clock');
const { summarize } = require('./support/clock-summary');

const DAY = 86400000;

describe('shiftClock', () => {
    const freshDate = () => vm.runInNewContext('Date');
    const makeTarget = () => ({ Date: freshDate() });
    const realNow = freshDate().now();

    test('moves the no-argument constructor and Date.now forward', () => {
        const Shifted = shiftClock(makeTarget(), 40);
        const nowDelta = Shifted.now() - realNow;
        const ctorDelta = new Shifted().getTime() - realNow;
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
        const target = makeTarget();
        const Real = target.Date;
        const Shifted = shiftClock(target, 3);
        expect(new Shifted() instanceof Real).toBe(true);
        expect(new Real() instanceof Shifted).toBe(true);
        expect(typeof Shifted()).toBe('string');
    });

    test('lets jest.spyOn(Date, "now") pin the clock', () => {
        const target = makeTarget();
        const Shifted = shiftClock(target, 40);
        const spy = jest.spyOn(Shifted, 'now').mockReturnValue(1000);
        expect(Shifted.now()).toBe(1000);
        spy.mockRestore();
        expect(Shifted.now() - realNow).toBeGreaterThanOrEqual(40 * DAY);
    });

    test('replaces the Date on the target it is given and applies once', () => {
        const target = makeTarget();
        const first = shiftClock(target, 3);
        expect(target.Date).toBe(first);
        expect(shiftClock(target, 3)).toBe(first);
        expect(first.now() - realNow).toBeLessThan(3 * DAY + 5000);
    });

    test('does nothing for a zero shift', () => {
        const target = makeTarget();
        const Real = target.Date;
        expect(shiftClock(target, 0)).toBe(Real);
        expect(target.Date).toBe(Real);
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
