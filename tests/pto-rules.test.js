const R = require('../Modules/Pto/helpers/ptoRules');

describe('validatePtoEntry', () => {
    test('accepts a valid entry and normalizes defaults', () => {
        const r = R.validatePtoEntry({ userId: 'u1', startDate: '2026-07-01', endDate: '2026-07-03' });
        expect(r.valid).toBe(true);
        expect(r.value.type).toBe('casual');
        expect(r.value.status).toBe('pending');
        expect(r.value.hoursPerDay).toBe(8);
    });
    test('rejects missing user and inverted dates', () => {
        expect(R.validatePtoEntry({ startDate: '2026-07-01', endDate: '2026-07-03' }).valid).toBe(false);
        expect(R.validatePtoEntry({ userId: 'u1', startDate: '2026-07-05', endDate: '2026-07-01' }).valid).toBe(false);
    });
    test('clamps bad hoursPerDay and unknown type/status', () => {
        const r = R.validatePtoEntry({ userId: 'u1', startDate: '2026-07-01', endDate: '2026-07-01', hoursPerDay: 99, type: 'nope', status: 'weird' });
        expect(r.value.hoursPerDay).toBe(8);
        expect(r.value.type).toBe('casual');
        expect(r.value.status).toBe('pending');
    });
    test('accepts the configured leave types (casual, privilege, sick)', () => {
        for (const t of ['casual', 'privilege', 'sick']) {
            const r = R.validatePtoEntry({ userId: 'u1', startDate: '2026-07-01', endDate: '2026-07-01', type: t });
            expect(r.value.type).toBe(t);
        }
    });
});

describe('workingDaysBetween', () => {
    test('counts Mon–Fri inclusive, skips weekend', () => {
        // 2026-07-01 is a Wednesday; through Tue 2026-07-07 → Wed,Thu,Fri,Mon,Tue = 5
        expect(R.workingDaysBetween('2026-07-01', '2026-07-07')).toBe(5);
    });
    test('a single weekend day is 0 working days', () => {
        // 2026-07-04 is a Saturday
        expect(R.workingDaysBetween('2026-07-04', '2026-07-04')).toBe(0);
    });
    test('inverted / invalid ranges are 0', () => {
        expect(R.workingDaysBetween('2026-07-07', '2026-07-01')).toBe(0);
        expect(R.workingDaysBetween('bad', '2026-07-01')).toBe(0);
    });
});

describe('ptoHoursInRange', () => {
    test('working days in the overlap × hoursPerDay', () => {
        const entry = { startDate: '2026-07-01', endDate: '2026-07-03', hoursPerDay: 8, status: 'approved' };
        // Wed–Fri = 3 working days × 8 = 24
        expect(R.ptoHoursInRange(entry, '2026-07-01', '2026-07-31')).toBe(24);
    });
    test('clips to the query window', () => {
        const entry = { startDate: '2026-06-29', endDate: '2026-07-03', hoursPerDay: 8 };
        // window starts 2026-07-01 (Wed); overlap Wed–Fri = 3 × 8 = 24
        expect(R.ptoHoursInRange(entry, '2026-07-01', '2026-07-03')).toBe(24);
    });
    test('no overlap → 0', () => {
        const entry = { startDate: '2026-08-01', endDate: '2026-08-05', hoursPerDay: 8 };
        expect(R.ptoHoursInRange(entry, '2026-07-01', '2026-07-31')).toBe(0);
    });
});

describe('computeAvailableCapacity (the done-when)', () => {
    const RANGE = { rangeStart: '2026-07-01', rangeEnd: '2026-07-31' };
    // July 2026 has 23 weekdays → 23 × 8 = 184h total capacity.
    test('no PTO → full capacity', () => {
        const c = R.computeAvailableCapacity({ ...RANGE, ptoEntries: [] });
        expect(c.totalCapacityHours).toBe(184);
        expect(c.ptoHours).toBe(0);
        expect(c.availableHours).toBe(184);
    });
    test('approved PTO reduces available capacity', () => {
        const c = R.computeAvailableCapacity({
            ...RANGE,
            ptoEntries: [{ startDate: '2026-07-06', endDate: '2026-07-10', hoursPerDay: 8, status: 'approved' }], // Mon–Fri = 40h
        });
        expect(c.ptoHours).toBe(40);
        expect(c.availableHours).toBe(144);
    });
    test('pending / rejected PTO does NOT reduce capacity', () => {
        const c = R.computeAvailableCapacity({
            ...RANGE,
            ptoEntries: [
                { startDate: '2026-07-06', endDate: '2026-07-10', hoursPerDay: 8, status: 'pending' },
                { startDate: '2026-07-13', endDate: '2026-07-17', hoursPerDay: 8, status: 'rejected' },
            ],
        });
        expect(c.ptoHours).toBe(0);
        expect(c.availableHours).toBe(184);
    });
    test('never goes negative', () => {
        const c = R.computeAvailableCapacity({
            rangeStart: '2026-07-06', rangeEnd: '2026-07-06', // one Monday = 8h
            ptoEntries: [{ startDate: '2026-07-06', endDate: '2026-07-06', hoursPerDay: 8, status: 'approved' }],
        });
        expect(c.availableHours).toBe(0);
    });
});
