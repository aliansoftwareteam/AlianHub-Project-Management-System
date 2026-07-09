// SEC-08 — pure time-off / PTO rules (no DB, no I/O). The capacity math here is
// the heart of the feature: approved PTO reduces a user's available capacity.
// Unit-tested in tests/pto-rules.test.js.

const PTO_TYPES = ['casual', 'privilege', 'sick'];
const PTO_STATUS = ['pending', 'approved', 'rejected'];
const DEFAULT_HOURS_PER_DAY = 8;
const DEFAULT_WEEKEND = [0, 6]; // Sun, Sat

const toDate = (v) => {
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    if (v === null || v === undefined || v === '') return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
};

// Normalize to UTC midnight — PTO is tracked at whole-day granularity.
const startOfDay = (v) => {
    const d = toDate(v);
    if (!d) return null;
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

const validatePtoEntry = (entry = {}) => {
    const errors = [];
    const start = startOfDay(entry.startDate);
    const end = startOfDay(entry.endDate);
    if (!entry.userId) errors.push('userId is required');
    if (!start) errors.push('a valid startDate is required');
    if (!end) errors.push('a valid endDate is required');
    if (start && end && end < start) errors.push('endDate must be on or after startDate');
    const type = PTO_TYPES.includes(entry.type) ? entry.type : 'casual';
    let hoursPerDay = Number(entry.hoursPerDay);
    if (!hoursPerDay || hoursPerDay <= 0 || hoursPerDay > 24) hoursPerDay = DEFAULT_HOURS_PER_DAY;
    const status = PTO_STATUS.includes(entry.status) ? entry.status : 'pending';
    return {
        valid: errors.length === 0,
        errors,
        value: errors.length ? null : {
            userId: String(entry.userId),
            type,
            status,
            startDate: start,
            endDate: end,
            hoursPerDay,
            reason: entry.reason ? String(entry.reason).slice(0, 500) : '',
        },
    };
};

// Whole days, inclusive.
const inclusiveDays = (start, end) => {
    const s = startOfDay(start);
    const e = startOfDay(end);
    if (!s || !e || e < s) return 0;
    return Math.round((e - s) / 86400000) + 1;
};

// Working days (Mon–Fri by default), inclusive.
const workingDaysBetween = (start, end, weekendDays = DEFAULT_WEEKEND) => {
    const s = startOfDay(start);
    const e = startOfDay(end);
    if (!s || !e || e < s) return 0;
    let count = 0;
    const cur = new Date(s);
    while (cur <= e) {
        if (!weekendDays.includes(cur.getUTCDay())) count++;
        cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return count;
};

// Inclusive overlap of an entry with [rangeStart, rangeEnd] → { start, end } | null.
const overlapRange = (entry, rangeStart, rangeEnd) => {
    const es = startOfDay(entry && entry.startDate);
    const ee = startOfDay(entry && entry.endDate);
    const rs = startOfDay(rangeStart);
    const re = startOfDay(rangeEnd);
    if (!es || !ee || !rs || !re) return null;
    const start = es > rs ? es : rs;
    const end = ee < re ? ee : re;
    if (end < start) return null;
    return { start, end };
};

// Hours an entry consumes within a window = working days in the overlap × hoursPerDay.
const ptoHoursInRange = (entry, rangeStart, rangeEnd, weekendDays = DEFAULT_WEEKEND) => {
    const ov = overlapRange(entry, rangeStart, rangeEnd);
    if (!ov) return 0;
    const hpd = Number(entry && entry.hoursPerDay) > 0 ? Number(entry.hoursPerDay) : DEFAULT_HOURS_PER_DAY;
    return workingDaysBetween(ov.start, ov.end, weekendDays) * hpd;
};

// Available capacity over [rangeStart, rangeEnd], subtracting APPROVED PTO only.
const computeAvailableCapacity = ({
    rangeStart,
    rangeEnd,
    ptoEntries = [],
    workingHoursPerDay = DEFAULT_HOURS_PER_DAY,
    weekendDays = DEFAULT_WEEKEND,
} = {}) => {
    const workingDays = workingDaysBetween(rangeStart, rangeEnd, weekendDays);
    const totalCapacityHours = workingDays * workingHoursPerDay;
    const ptoHours = (ptoEntries || [])
        .filter((e) => e && e.status === 'approved')
        .reduce((sum, e) => sum + ptoHoursInRange(e, rangeStart, rangeEnd, weekendDays), 0);
    const availableHours = Math.max(0, totalCapacityHours - ptoHours);
    return { workingDays, totalCapacityHours, ptoHours, availableHours };
};

module.exports = {
    PTO_TYPES,
    PTO_STATUS,
    DEFAULT_HOURS_PER_DAY,
    DEFAULT_WEEKEND,
    startOfDay,
    validatePtoEntry,
    inclusiveDays,
    workingDaysBetween,
    overlapRange,
    ptoHoursInRange,
    computeAvailableCapacity,
};
