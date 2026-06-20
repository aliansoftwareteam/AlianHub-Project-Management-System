const R = require('../Modules/CapacityPlanning/helpers/capacityRules');

describe('userUtilization', () => {
    test('under-allocated', () => {
        const u = R.userUtilization({ capacityHours: 40, allocatedHours: 20 });
        expect(u).toMatchObject({ availableHours: 20, utilizationPct: 50, status: 'under' });
    });
    test('full (>=80%, <=100%)', () => {
        expect(R.userUtilization({ capacityHours: 40, allocatedHours: 36 }).status).toBe('full');
        expect(R.userUtilization({ capacityHours: 40, allocatedHours: 40 }).status).toBe('full');
    });
    test('over-allocated', () => {
        const u = R.userUtilization({ capacityHours: 40, allocatedHours: 52 });
        expect(u.status).toBe('over');
        expect(u.utilizationPct).toBe(130);
        expect(u.availableHours).toBe(0);
    });
    test('no capacity (all PTO) but allocated → over', () => {
        expect(R.userUtilization({ capacityHours: 0, allocatedHours: 8 }).status).toBe('over');
    });
    test('no capacity + nothing allocated → under, 0%', () => {
        expect(R.userUtilization({ capacityHours: 0, allocatedHours: 0 })).toMatchObject({ utilizationPct: 0, status: 'under' });
    });
});

describe('summarize', () => {
    test('aggregates capacity/allocation + status counts', () => {
        const rows = [
            R.userUtilization({ capacityHours: 40, allocatedHours: 20 }), // under
            R.userUtilization({ capacityHours: 40, allocatedHours: 38 }), // full
            R.userUtilization({ capacityHours: 40, allocatedHours: 50 }), // over
        ];
        const t = R.summarize(rows);
        expect(t.users).toBe(3);
        expect(t.totalCapacity).toBe(120);
        expect(t.totalAllocated).toBe(108);
        expect(t.utilizationPct).toBe(90);
        expect(t.under).toBe(1);
        expect(t.full).toBe(1);
        expect(t.over).toBe(1);
    });
    test('empty → zeros', () => {
        expect(R.summarize([])).toMatchObject({ users: 0, totalCapacity: 0, utilizationPct: 0 });
    });
});
