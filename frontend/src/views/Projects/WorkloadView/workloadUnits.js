export const WORKLOAD_UNITS = Object.freeze(['hours', 'points', 'count']);
export const CAPACITY_PERIODS = Object.freeze(['day', 'week']);
export const DEFAULT_UNIT_CAPACITY = Object.freeze({
    points: Object.freeze({ value: 10, per: 'week' }),
    count: Object.freeze({ value: 10, per: 'week' }),
});

export const roundAmount = (n) => Math.round((Number(n) || 0) * 10) / 10;

export const unitCapacity = (raw) => Object.fromEntries(Object.keys(DEFAULT_UNIT_CAPACITY).map((unit) => {
    const entry = raw && raw[unit];
    const value = Number(entry && entry.value);
    const usable = entry && Number.isFinite(value) && value >= 0 && CAPACITY_PERIODS.includes(entry.per);
    return [unit, usable ? { value, per: entry.per } : { ...DEFAULT_UNIT_CAPACITY[unit] }];
}));

/* Hours capacity is minutes per working day; points and count spread a weekly amount over
   the days the person works. */
export const dailyCapacity = ({ unit, hoursPerDay = 8, rule, workDays = 5 }) => {
    if (unit === 'hours') return hoursPerDay * 60;
    const entry = rule || DEFAULT_UNIT_CAPACITY[unit] || DEFAULT_UNIT_CAPACITY.points;
    const value = Number(entry.value) || 0;
    return entry.per === 'day' ? value : value / (workDays > 0 ? workDays : 5);
};

export const cellLoad = (unit, mode, day) => {
    if (unit !== 'hours') return Number(day.load) || 0;
    return Number(mode === 'logged' ? day.logged : day.estimated) || 0;
};

export const plannedLoad = (unit, day) => Number(unit === 'hours' ? day.estimated : day.load) || 0;

export const chipSize = (unit, chip) => Number(unit === 'hours' ? chip.minutes : chip.amount) || 0;
