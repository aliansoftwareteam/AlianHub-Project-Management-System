const { bucketDays, tasksOf, hoursLabel, fillPercent } = require('../frontend/src/views/Timesheet/WorkloadTimesheet/workloadBuckets');
const { bucketsOf } = require('../frontend/src/views/Timesheet/report/reportRange');

const day = (date, extra = {}) => ({ date, estimated: 0, logged: 0, capacityMinutes: 480, pto: false, unavailable: false, chips: [], ...extra });

describe('workload cells for weeks and months (task 086)', () => {
    it('sums a week and keeps each chip with the day it is planned on', () => {
        const days = [
            day('2026-11-02', { estimated: 120, logged: 60, chips: [{ taskId: 't1', name: 'Spec', minutes: 120 }] }),
            day('2026-11-03', { estimated: 240, chips: [{ taskId: 't1', name: 'Spec', minutes: 60 }, { taskId: 't2', name: 'Build', minutes: 180 }] }),
            day('2026-11-09', { estimated: 30, chips: [{ taskId: 't3', name: 'Ship', minutes: 30 }] }),
        ];
        const [first, second] = bucketDays(days, bucketsOf({ start: '2026-11-02', end: '2026-11-15' }, 'week'));
        expect(first).toMatchObject({ key: '2026-11-02', start: '2026-11-02', end: '2026-11-08', estimated: 360, logged: 60, capacityMinutes: 960, pto: false, unavailable: false });
        expect(first.chips.map((c) => [c.taskId, c.date])).toEqual([['t1', '2026-11-02'], ['t1', '2026-11-03'], ['t2', '2026-11-03']]);
        expect(second).toMatchObject({ key: '2026-11-09', estimated: 30 });
    });

    it('marks a period off only when every day in it is off', () => {
        const buckets = bucketsOf({ start: '2026-11-02', end: '2026-11-03' }, 'week');
        expect(bucketDays([day('2026-11-02', { pto: true }), day('2026-11-03', { pto: true })], buckets)[0]).toMatchObject({ pto: true, unavailable: false });
        expect(bucketDays([day('2026-11-02', { unavailable: true }), day('2026-11-03', { unavailable: true })], buckets)[0]).toMatchObject({ pto: false, unavailable: true });
        expect(bucketDays([day('2026-11-02', { pto: true }), day('2026-11-03')], buckets)[0]).toMatchObject({ pto: false, unavailable: false });
    });

    it('lists one row per task in the panel, minutes summed, biggest first', () => {
        const rows = tasksOf([
            { taskId: 't1', name: 'Spec', projectId: 'p', minutes: 60, date: '2026-11-03' },
            { taskId: 't2', name: 'Build', projectId: 'p', minutes: 180, date: '2026-11-03' },
            { taskId: 't1', name: 'Spec', projectId: 'p', minutes: 150, date: '2026-11-02' },
            { estimateId: 'e9', name: '', minutes: 15 },
        ]);
        expect(rows.map((r) => [r.taskId, r.minutes, r.dates])).toEqual([
            ['t1', 210, ['2026-11-02', '2026-11-03']],
            ['t2', 180, ['2026-11-03']],
            ['', 15, []],
        ]);
    });
});

describe('a workload cell reads as its hours (task 093)', () => {
    it('labels hours to a tenth under ten, whole from ten, and never reads a little time as nothing', () => {
        expect([0, 30, 15, 90, 480, 750, 2, 3].map(hoursLabel)).toEqual(['0h', '0.5h', '0.3h', '1.5h', '8h', '13h', '<0.1h', '0.1h']);
    });

    it('fills the bar to the share of capacity, full when over it or when there is no capacity', () => {
        expect(fillPercent(240, 480)).toBe(50);
        expect(fillPercent(600, 480)).toBe(100);
        expect(fillPercent(30, 0)).toBe(100);
        expect(fillPercent(0, 0)).toBe(0);
    });

    it('keeps each task row\'s estimates so the row can be moved as a whole', () => {
        const [row] = tasksOf([{ taskId: 't1', estimateId: 'e1', name: 'Spec', minutes: 30 }, { taskId: 't1', estimateId: 'e2', name: 'Spec', minutes: 45 }]);
        expect(row.minutes).toBe(75);
        expect(row.chips.map((chip) => chip.estimateId)).toEqual(['e1', 'e2']);
    });
});
