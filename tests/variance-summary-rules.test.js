const R = require('../Modules/VarianceReport/helpers/varianceRules');

const rows = [
    { taskId: 'a', projectId: 'web', hasDescription: true, ...R.taskVariance(600, 660) },
    { taskId: 'b', projectId: 'web', hasDescription: false, ...R.taskVariance(300, 500) },
    { taskId: 'c', projectId: 'mkt', hasDescription: false, ...R.taskVariance(720, 3720) },
    { taskId: 'd', projectId: 'app', hasDescription: true, ...R.taskVariance(400, 360) },
    { taskId: 'e', projectId: '', hasDescription: true, ...R.taskVariance(0, 30) },
];

describe('groupVariance', () => {
    test('groups by key, largest absolute delta first, skips empty keys', () => {
        const g = R.groupVariance(rows, (r) => r.projectId, (r, k) => k.toUpperCase());
        expect(g.map((x) => x.key)).toEqual(['mkt', 'web', 'app']);
        expect(g[1]).toMatchObject({ name: 'WEB', estimatedMinutes: 900, actualMinutes: 1160, variancePct: 29, tasks: 2 });
    });
});

describe('driftDrivers / biggestOverrun', () => {
    test('averages drift per driver and sorts by drift', () => {
        const d = R.driftDrivers(rows, [
            { key: 'no_description', test: (r) => !r.hasDescription },
            { key: 'described', test: (r) => r.hasDescription },
        ]);
        expect(d[0]).toMatchObject({ key: 'no_description', tasks: 2, driftPct: 314 });
        expect(d[1]).toMatchObject({ key: 'described', tasks: 2, driftPct: 2 });
    });
    test('the takeaway subject is the single largest over-run', () => {
        expect(R.biggestOverrun(rows).taskId).toBe('c');
        expect(R.biggestOverrun([rows[3]])).toBeNull();
    });
});
