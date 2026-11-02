// Plain CommonJS so the server-side jest suite can test it; dates are calendar days ('YYYY-MM-DD'), weeks start on Monday.

const PRESETS = Object.freeze([
    'today', 'yesterday',
    'this_week', 'last_week',
    'this_month', 'last_month',
    'this_quarter', 'last_quarter',
    'this_year', 'last_year',
    'last_7', 'last_30', 'last_90',
    'custom',
]);
const DAY_PRESETS = Object.freeze(['today', 'yesterday', 'custom']);
const DAY_MS = 86400000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const pad = (n) => String(n).padStart(2, '0');
const toUtc = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
};
const fromUtc = (ms) => {
    const date = new Date(ms);
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};
const localDay = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const addDays = (iso, n) => fromUtc(toUtc(iso) + n * DAY_MS);

const isDay = (value) => {
    if (typeof value !== 'string' || !ISO_DAY.test(value)) return false;
    return fromUtc(toUtc(value)) === value;
};

const weekStart = (iso) => addDays(iso, -((new Date(toUtc(iso)).getUTCDay() + 6) % 7));
const monthStart = (iso) => `${iso.slice(0, 8)}01`;
const monthEnd = (iso) => {
    const [y, m] = iso.split('-').map(Number);
    return fromUtc(Date.UTC(y, m, 0));
};
const addMonths = (iso, n) => {
    const [y, m] = iso.split('-').map(Number);
    return fromUtc(Date.UTC(y, m - 1 + n, 1));
};
const quarterStart = (iso) => {
    const [y, m] = iso.split('-').map(Number);
    return `${y}-${pad(Math.floor((m - 1) / 3) * 3 + 1)}-01`;
};

const daysBetween = (start, end) => Math.round((toUtc(end) - toUtc(start)) / DAY_MS) + 1;

const ordered = (start, end) => (toUtc(start) <= toUtc(end) ? { start, end } : { start: end, end: start });

/* The range a preset stands for on the day `today`. `custom` keeps the given days, in order. */
const rangeOf = (preset, today = localDay(), custom = {}) => {
    switch (preset) {
    case 'today': return { start: today, end: today };
    case 'yesterday': { const d = addDays(today, -1); return { start: d, end: d }; }
    case 'this_week': { const s = weekStart(today); return { start: s, end: addDays(s, 6) }; }
    case 'last_week': { const s = addDays(weekStart(today), -7); return { start: s, end: addDays(s, 6) }; }
    case 'this_month': return { start: monthStart(today), end: monthEnd(today) };
    case 'last_month': { const s = addMonths(today, -1); return { start: s, end: monthEnd(s) }; }
    case 'this_quarter': { const s = quarterStart(today); return { start: s, end: monthEnd(addMonths(s, 2)) }; }
    case 'last_quarter': { const s = addMonths(quarterStart(today), -3); return { start: s, end: monthEnd(addMonths(s, 2)) }; }
    case 'this_year': return { start: `${today.slice(0, 4)}-01-01`, end: `${today.slice(0, 4)}-12-31` };
    case 'last_year': { const y = Number(today.slice(0, 4)) - 1; return { start: `${y}-01-01`, end: `${y}-12-31` }; }
    case 'last_7': return { start: addDays(today, -6), end: today };
    case 'last_30': return { start: addDays(today, -29), end: today };
    case 'last_90': return { start: addDays(today, -89), end: today };
    case 'custom': {
        if (isDay(custom.start) && isDay(custom.end)) return ordered(custom.start, custom.end);
        if (isDay(custom.start)) return { start: custom.start, end: custom.start };
        return { start: today, end: today };
    }
    default: return rangeOf('this_week', today);
    }
};

const UNIT_OF = Object.freeze({
    today: 'day', yesterday: 'day',
    this_week: 'week', last_week: 'week',
    this_month: 'month', last_month: 'month',
    this_quarter: 'quarter', last_quarter: 'quarter',
    this_year: 'year', last_year: 'year',
});

/* The ‹ › stepper: a calendar preset moves by its own period, anything else by the range's length. The result is a custom range. */
const shiftRange = (range, preset, step) => {
    const unit = UNIT_OF[preset];
    if (unit === 'day') return { start: addDays(range.start, step), end: addDays(range.end, step) };
    if (unit === 'week') return { start: addDays(range.start, 7 * step), end: addDays(range.end, 7 * step) };
    if (unit === 'month' || unit === 'quarter' || unit === 'year') {
        const months = { month: 1, quarter: 3, year: 12 }[unit] * step;
        const start = addMonths(range.start, months);
        return { start, end: monthEnd(addMonths(range.end, months)) };
    }
    const span = daysBetween(range.start, range.end);
    return { start: addDays(range.start, span * step), end: addDays(range.end, span * step) };
};

/* The preset whose range is exactly this one on `today`, so a stepped range that lands back on "this week" reads as such. */
const presetFor = (range, today = localDay(), allowed = PRESETS) => allowed
    .filter((preset) => preset !== 'custom')
    .find((preset) => { const r = rangeOf(preset, today); return r.start === range.start && r.end === range.end; }) || 'custom';

const isOneIsoWeek = (range) => weekStart(range.start) === range.start && addDays(range.start, 6) === range.end;

/* Columns a time grid uses for a range: days up to a month, then ISO weeks, then months. */
const granularityOf = (range) => {
    const span = daysBetween(range.start, range.end);
    if (span <= 31) return 'day';
    if (span <= 183) return 'week';
    return 'month';
};

const daysOf = (range) => {
    const out = [];
    for (let d = range.start; toUtc(d) <= toUtc(range.end); d = addDays(d, 1)) out.push(d);
    return out;
};

/* Buckets of days for a granularity: [{ key, start, end, days: [...] }], clipped to the range. */
const bucketsOf = (range, granularity = granularityOf(range)) => {
    const buckets = [];
    daysOf(range).forEach((day) => {
        const key = granularity === 'week' ? weekStart(day) : granularity === 'month' ? monthStart(day) : day;
        const last = buckets[buckets.length - 1];
        if (last && last.key === key) {
            last.days.push(day);
            last.end = day;
        } else {
            buckets.push({ key, start: day, end: day, days: [day] });
        }
    });
    return buckets;
};

module.exports = {
    PRESETS, DAY_PRESETS,
    isDay, localDay, addDays, weekStart, monthEnd, daysBetween,
    rangeOf, shiftRange, presetFor, isOneIsoWeek, granularityOf, daysOf, bucketsOf,
};
