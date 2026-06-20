const R = require('../Modules/VarianceReport/helpers/varianceRules');

describe('taskVariance', () => {
    test('over estimate', () => {
        const v = R.taskVariance(60, 90);
        expect(v).toMatchObject({ estimatedMinutes: 60, actualMinutes: 90, variance: 30, variancePct: 50, status: 'over' });
    });
    test('under estimate', () => {
        const v = R.taskVariance(120, 60);
        expect(v).toMatchObject({ variance: -60, variancePct: -50, status: 'under' });
    });
    test('on track (exact)', () => {
        expect(R.taskVariance(60, 60).status).toBe('on-track');
    });
    test('no estimate but logged', () => {
        const v = R.taskVariance(0, 45);
        expect(v.status).toBe('no-estimate');
        expect(v.variance).toBe(45);
    });
    test('handles missing/garbage input as 0', () => {
        expect(R.taskVariance(undefined, null)).toMatchObject({ estimatedMinutes: 0, actualMinutes: 0, variance: 0, status: 'on-track' });
    });
});

describe('rollup', () => {
    test('aggregates totals + status counts', () => {
        const rows = [
            R.taskVariance(60, 90),   // over +30
            R.taskVariance(120, 60),  // under -60
            R.taskVariance(30, 30),   // on-track
            R.taskVariance(0, 20),    // no-estimate
        ];
        const t = R.rollup(rows);
        expect(t.tasks).toBe(4);
        expect(t.totalEstimated).toBe(210);
        expect(t.totalActual).toBe(200);
        expect(t.totalVariance).toBe(-10);
        expect(t.over).toBe(1);
        expect(t.under).toBe(1);
        expect(t.onTrack).toBe(1);
        expect(t.noEstimate).toBe(1);
    });
    test('empty → zeros', () => {
        expect(R.rollup([])).toMatchObject({ tasks: 0, totalEstimated: 0, totalActual: 0, totalVariance: 0, totalVariancePct: 0 });
    });
});
