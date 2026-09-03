const R = require('../Modules/TimeSheet/helpers/weekRules');

describe('dayKeys', () => {
    test('lists inclusive days and rejects inverted ranges', () => {
        expect(R.dayKeys('2026-08-31', '2026-09-06')).toEqual(['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06']);
        expect(R.dayKeys('2026-09-06', '2026-08-31')).toEqual([]);
        expect(R.dayKeys('nope', '2026-09-06')).toEqual([]);
    });
    test('caps very long ranges', () => {
        expect(R.dayKeys('2026-01-01', '2026-12-31')).toHaveLength(R.MAX_DAYS);
    });
});

describe('groupEntriesByTask', () => {
    const dayOf = (e) => e.day;
    test('sums per task per day, flags non-billable, largest first', () => {
        const rows = R.groupEntriesByTask([
            { _id: 'a', TicketID: 't1', ProjectId: 'p1', LogTimeDuration: 60, day: '2026-09-01' },
            { _id: 'b', TicketID: 't1', ProjectId: 'p1', LogTimeDuration: 30, day: '2026-09-01', billable: false },
            { _id: 'c', TicketID: 't2', ProjectId: 'p2', LogTimeDuration: 200, day: '2026-09-02' },
            { _id: 'd', TicketID: '', LogTimeDuration: 999, day: '2026-09-02' },
        ], dayOf);
        expect(rows.map((r) => r.taskId)).toEqual(['t2', 't1']);
        expect(rows[1].byDay['2026-09-01']).toBe(90);
        expect(rows[1].billable).toBe(false);
        expect(rows[1].entryIds).toEqual(['a', 'b']);
        expect(rows[0].billable).toBe(true);
    });
});

describe('capacity + totals', () => {
    const days = R.dayKeys('2026-08-31', '2026-09-06');
    test('weekends and PTO days carry no capacity', () => {
        const pto = R.ptoDaysIn([{ status: 'approved', startDate: '2026-09-02', endDate: '2026-09-03' }, { status: 'pending', startDate: '2026-09-04', endDate: '2026-09-04' }], days);
        expect(pto).toEqual(['2026-09-02', '2026-09-03']);
        const caps = R.dayCapacity({ days, hoursPerDay: 8, ptoDays: pto });
        expect(caps.find((d) => d.date === '2026-09-02').capacityMinutes).toBe(0);
        expect(caps.find((d) => d.date === '2026-09-05').weekend).toBe(true);
        expect(caps.find((d) => d.date === '2026-09-04').capacityMinutes).toBe(480);
    });
    test('totals and under-capacity days only look backwards', () => {
        const rows = [
            { total: 360, billable: true, byDay: { '2026-08-31': 360 } },
            { total: 120, billable: false, byDay: { '2026-09-01': 120 } },
        ];
        const t = R.totals(rows, days);
        expect(t.weekMinutes).toBe(480);
        expect(t.billableMinutes).toBe(360);
        const caps = R.dayCapacity({ days, hoursPerDay: 8 });
        const under = R.underCapacityDays(caps, t.byDay, '2026-09-01');
        expect(under).toEqual([{ date: '2026-08-31', gapMinutes: 120 }, { date: '2026-09-01', gapMinutes: 360 }]);
    });
});

describe('workloadDays', () => {
    test('marks over-capacity days and computes utilization', () => {
        const days = R.dayKeys('2026-09-01', '2026-09-02');
        const w = R.workloadDays({
            days, hoursPerDay: 8,
            chipsByDay: { '2026-09-01': [{ minutes: 300 }, { minutes: 240 }], '2026-09-02': [{ minutes: 120 }] },
            loggedByDay: { '2026-09-01': 100 },
        });
        expect(w.days[0].over).toBe(true);
        expect(w.days[1].over).toBe(false);
        expect(w.totalEstimated).toBe(660);
        expect(w.totalLogged).toBe(100);
        expect(w.utilizationPct).toBe(69);
    });
});
