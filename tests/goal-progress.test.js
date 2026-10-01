/* Task 046 M3: how far a goal's targets are, and the goal with them. Pure maths, no database. */
const { targetRatio, goalRatio, pctOf, withProgress } = require('../Modules/Goals/helpers/goalProgress');

const number = (start, target, current, extra = {}) => ({ kind: 'number', start, target, current, ...extra });
const flag = (done, extra = {}) => ({ kind: 'boolean', done, ...extra });

describe('a target\'s progress', () => {
    it.each([
        ['at the start', number(0, 10, 0), 0],
        ['part of the way', number(0, 10, 3), 0.3],
        ['at the target', number(0, 10, 10), 1],
        ['from a start that is not zero', number(20, 120, 45), 0.25],
        ['with a negative start', number(-10, 10, 0), 0.5],
        ['in a currency, the same way', { ...number(1000, 5000, 2000), kind: 'currency', currencyCode: 'USD' }, 0.25],
    ])('is the share of the range covered: %s', (_case, target, ratio) => {
        expect(targetRatio(target)).toBeCloseTo(ratio, 10);
    });

    it.each([
        ['past the target', number(0, 10, 14), 1],
        ['behind the start', number(0, 10, -4), 0],
        ['past a downward target', number(100, 20, 5), 1],
        ['behind a downward start', number(100, 20, 130), 0],
    ])('is held between none and all: %s', (_case, target, ratio) => {
        expect(targetRatio(target)).toBe(ratio);
    });

    it('works downwards: fewer open bugs is progress', () => {
        expect(targetRatio(number(100, 20, 80))).toBeCloseTo(0.25, 10);
        expect(targetRatio(number(100, 20, 20))).toBe(1);
    });

    it('never divides by a range with no width', () => {
        expect(targetRatio(number(5, 5, 5))).toBe(1);
        expect(targetRatio(number(5, 5, 4))).toBe(0);
        expect(targetRatio(number(0, 0, 0))).toBe(1);
    });

    it('is all or nothing for a true or false target', () => {
        expect(targetRatio(flag(true))).toBe(1);
        expect(targetRatio(flag(false))).toBe(0);
        expect(targetRatio(flag('yes'))).toBe(0);
        expect(targetRatio({ kind: 'boolean' })).toBe(0);
    });

    it.each([
        ['a missing value', { kind: 'number', start: 0, target: 10 }],
        ['a value that is not a number', number(0, 10, 'half')],
        ['an endless value', number(0, Infinity, 5)],
        ['a kind it does not measure', { kind: 'tasks', start: 0, target: 10, current: 10 }],
        ['nothing', undefined],
    ])('is none for %s', (_case, target) => {
        expect(targetRatio(target)).toBe(0);
    });
});

describe('a percentage', () => {
    it('is a whole number, and says 100 only once the target has arrived', () => {
        expect(pctOf(0)).toBe(0);
        expect(pctOf(0.3)).toBe(30);
        expect(pctOf(0.29)).toBe(29);
        expect(pctOf(0.004)).toBe(0);
        expect(pctOf(0.996)).toBe(99);
        expect(pctOf(1)).toBe(100);
        expect(pctOf(7)).toBe(100);
        expect(pctOf(-2)).toBe(0);
    });
});

describe('a goal\'s progress', () => {
    it('is the mean of its targets', () => {
        expect(goalRatio([number(0, 10, 5), flag(true), flag(false)])).toBeCloseTo(0.5, 10);
    });

    it('is none for a goal with no target', () => {
        expect(goalRatio([])).toBe(0);
        expect(goalRatio()).toBe(0);
    });

    it('leans towards the heavier target', () => {
        expect(goalRatio([flag(true, { weight: 3 }), flag(false, { weight: 1 })])).toBeCloseTo(0.75, 10);
        expect(goalRatio([flag(true, { weight: 1 }), flag(false, { weight: 3 })])).toBeCloseTo(0.25, 10);
    });

    it('reads a weight that is missing, zero or not a number as one', () => {
        expect(goalRatio([flag(true, { weight: 0 }), flag(false, { weight: 'heavy' }), flag(false)])).toBeCloseTo(1 / 3, 10);
    });

    it('is taken from the targets\' exact progress, not from their rounded percentages', () => {
        const thirds = [number(0, 3, 1), number(0, 3, 1), number(0, 3, 1)];
        expect(withProgress(thirds).progressPct).toBe(33);
        expect(withProgress([number(0, 1000, 996), flag(true)]).progressPct).toBe(99);
    });
});

describe('the stored numbers', () => {
    const NOW = new Date('2026-10-01T10:00:00.000Z');
    const EARLIER = new Date('2026-09-01T10:00:00.000Z');

    it('are a percentage on each target and one on the goal', () => {
        const measured = withProgress([number(0, 10, 3, { id: 'a' }), flag(true, { id: 'b' })], NOW);
        expect(measured.targets.map((target) => [target.id, target.progressPct])).toEqual([['a', 30], ['b', 100]]);
        expect(measured.progressPct).toBe(65);
    });

    it('mark the moment a target arrives, keep it while it stays, and clear it when it falls back', () => {
        const [arrived] = withProgress([number(0, 10, 10)], NOW).targets;
        expect(arrived.reachedAt).toBe(NOW);
        const [stayed] = withProgress([number(0, 10, 12, { reachedAt: EARLIER })], NOW).targets;
        expect(stayed.reachedAt).toBe(EARLIER);
        const [fell] = withProgress([number(0, 10, 9, { reachedAt: EARLIER })], NOW).targets;
        expect(fell.reachedAt).toBeNull();
        expect(withProgress([number(0, 10, 2)], NOW).targets[0].reachedAt).toBeNull();
    });

    it('leave the targets they were given untouched', () => {
        const given = [number(0, 10, 10)];
        withProgress(given, NOW);
        expect(given).toEqual([number(0, 10, 10)]);
    });
});
