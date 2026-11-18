// CommonJS so the server-side jest suite tests it.

const sum = (list, key) => list.reduce((total, item) => total + (Number(item[key]) || 0), 0);

/* A person's grid days folded into the report's buckets (days, weeks or months). Days off count only when the whole
 * bucket is off; chips keep the day they are planned on. */
const bucketDays = (days, buckets) => {
    const byDate = new Map((days || []).map((day) => [day.date, day]));
    return buckets.map((bucket) => {
        const inBucket = bucket.days.map((date) => byDate.get(date)).filter(Boolean);
        const allOff = inBucket.length > 0 && inBucket.every((day) => day.pto || day.unavailable);
        return {
            key: bucket.key,
            start: bucket.start,
            end: bucket.end,
            date: bucket.start,
            days: bucket.days,
            estimated: sum(inBucket, 'estimated'),
            logged: sum(inBucket, 'logged'),
            capacityMinutes: sum(inBucket, 'capacityMinutes'),
            pto: allOff && inBucket.some((day) => day.pto),
            unavailable: allOff && !inBucket.some((day) => day.pto),
            chips: inBucket.flatMap((day) => (day.chips || []).map((chip) => ({ ...chip, date: day.date }))),
        };
    });
};

/* The panel's list: one row per task, its planned minutes summed over the period, biggest first. */
const tasksOf = (chips) => {
    const rows = new Map();
    (chips || []).forEach((chip) => {
        const key = chip.taskId || chip.estimateId;
        const row = rows.get(key) || {
            taskId: chip.taskId || '', name: chip.name || '', projectId: chip.projectId || '', projectName: chip.projectName || '',
            projectColor: chip.projectColor || '', sprintId: chip.sprintId || '', minutes: 0, dates: [], chips: [],
        };
        row.minutes += Number(chip.minutes) || 0;
        row.chips.push(chip);
        if (chip.date && !row.dates.includes(chip.date)) row.dates.push(chip.date);
        rows.set(key, row);
    });
    return [...rows.values()].map((row) => ({ ...row, dates: row.dates.sort() })).sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
};

/* Under 3 minutes rounds to 0.0h, which would read as nothing planned. */
const hoursLabel = (minutes) => {
    const m = Number(minutes) || 0;
    if (m > 0 && m < 3) return '<0.1h';
    const h = m / 60;
    return `${h >= 10 || Number.isInteger(h) ? Math.round(h) : Math.round(h * 10) / 10}h`;
};

const fillPercent = (minutes, capacityMinutes) => {
    const m = Number(minutes) || 0;
    if (!(capacityMinutes > 0)) return m > 0 ? 100 : 0;
    return Math.min(100, (m / capacityMinutes) * 100);
};

module.exports = { bucketDays, tasksOf, hoursLabel, fillPercent };
