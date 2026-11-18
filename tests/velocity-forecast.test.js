const F = require('../frontend/src/views/Projects/Reports/composables/forecast');

describe('mean / stdDev', () => {
    test('ignores non-numeric entries', () => {
        expect(F.mean([10, '20', null, undefined, 30])).toBe(20);
        expect(F.mean([])).toBe(0);
    });
    test('population standard deviation', () => {
        expect(F.stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
        expect(F.stdDev([5])).toBe(0);
        expect(F.stdDev([])).toBe(0);
    });
});

describe('forecastBand', () => {
    test('refuses to guess without enough history', () => {
        const out = F.forecastBand([21, 24]);
        expect(out.ok).toBe(false);
        expect(out.reason).toBe('not-enough-history');
        expect(out.samples).toBe(2);
        expect(out.minSamples).toBe(3);
    });

    test('centres on the mean and spreads one standard deviation', () => {
        const out = F.forecastBand([20, 24, 28]);
        expect(out.ok).toBe(true);
        expect(out.mean).toBe(24);
        expect(out.stdDev).toBe(3.3);
        expect(out.low).toBe(21);
        expect(out.high).toBe(27);
    });

    test('a flat history gives a zero-width band, not an inverted one', () => {
        const out = F.forecastBand([25, 25, 25, 25]);
        expect(out.low).toBe(25);
        expect(out.high).toBe(25);
    });

    test('never forecasts negative points', () => {
        const out = F.forecastBand([0, 1, 20]);
        expect(out.low).toBe(0);
        expect(out.high).toBeGreaterThan(out.low);
    });

    test('only the last `window` sprints count', () => {
        const all = [100, 100, 100, 10, 10, 10, 10, 10, 10];
        expect(F.forecastBand(all, { window: 6 }).mean).toBe(10);
        expect(F.forecastBand(all, { window: 9 }).mean).toBe(40);
    });

    test('spread multiplier widens the band', () => {
        const narrow = F.forecastBand([20, 24, 28], { spread: 1 });
        const wide = F.forecastBand([20, 24, 28], { spread: 2 });
        expect(wide.high - wide.low).toBeGreaterThan(narrow.high - narrow.low);
    });
});

describe('completedSeries', () => {
    const rows = [
        { completed: 24, completedHuman: 15, completedAgent: 9 },
        { completed: 20, completedHuman: 12, completedAgent: 8 },
    ];
    test('totals by default', () => {
        expect(F.completedSeries(rows)).toEqual([24, 20]);
    });
    test('human-only reads the split', () => {
        expect(F.completedSeries(rows, { humanOnly: true })).toEqual([15, 12]);
    });
    test('a sprint with no split contributes null rather than a guess', () => {
        expect(F.completedSeries([{ completed: 24 }], { humanOnly: true })).toEqual([null]);
    });
    test('accepts the humanCompleted spelling too', () => {
        expect(F.completedSeries([{ completed: 9, humanCompleted: 4 }], { humanOnly: true })).toEqual([4]);
    });
});

describe('hasActorSplit', () => {
    test('true only when every sprint carries both halves', () => {
        expect(F.hasActorSplit([{ completedHuman: 1, completedAgent: 2 }])).toBe(true);
        expect(F.hasActorSplit([{ completedHuman: 1, completedAgent: 2 }, { completed: 4 }])).toBe(false);
        expect(F.hasActorSplit([])).toBe(false);
        expect(F.hasActorSplit(null)).toBe(false);
    });
});
