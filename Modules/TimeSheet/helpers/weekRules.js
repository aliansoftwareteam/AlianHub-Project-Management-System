// Pure week-grid / workload rules — no I/O. Minutes everywhere, days as 'YYYY-MM-DD'.
// Unit-tested in tests/timesheet-week-rules.test.js.

const DEFAULT_WEEKEND = [0, 6];
const MAX_DAYS = 62;

const pad = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utcDay = (s) => new Date(`${String(s).slice(0, 10)}T00:00:00Z`);

const dayKeys = (start, end) => {
    const s = utcDay(start);
    const e = utcDay(end);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return [];
    const out = [];
    const cur = new Date(s);
    while (cur <= e && out.length < MAX_DAYS) {
        out.push(isoDay(cur));
        cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return out;
};

/* Group raw time entries into one row per task. `dayOf(entry)` resolves the
 * entry's local day so the caller owns the timezone decision. A row is
 * billable only when none of its entries is explicitly non-billable. */
const groupEntriesByTask = (entries, dayOf) => {
    const map = {};
    (entries || []).forEach((e) => {
        const taskId = String((e && e.TicketID) || '');
        if (!taskId) return;
        const row = map[taskId] || (map[taskId] = {
            taskId, projectId: String(e.ProjectId || ''), billable: true, byDay: {}, total: 0, entryIds: [],
        });
        const minutes = Number(e.LogTimeDuration) || 0;
        const day = dayOf(e);
        row.byDay[day] = (row.byDay[day] || 0) + minutes;
        row.total += minutes;
        row.entryIds.push(String(e._id));
        if (e.billable === false) row.billable = false;
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
};

const ptoDaysIn = (ptoEntries, days) => {
    const ranges = (ptoEntries || [])
        .filter((e) => e && e.status === 'approved')
        .map((e) => ({ s: isoDay(new Date(e.startDate)), e: isoDay(new Date(e.endDate)) }))
        .filter((r) => r.s !== 'NaN-NaN-NaN' && r.e !== 'NaN-NaN-NaN');
    return (days || []).filter((d) => ranges.some((r) => r.s <= d && d <= r.e));
};

const dayCapacity = ({ days = [], hoursPerDay = 8, ptoDays = [], weekendDays = DEFAULT_WEEKEND } = {}) => days.map((date) => {
    const weekend = weekendDays.includes(utcDay(date).getUTCDay());
    const pto = ptoDays.includes(date);
    return { date, weekend, pto, capacityMinutes: weekend || pto ? 0 : Math.round(hoursPerDay * 60) };
});

const totals = (rows, days) => {
    const byDay = {};
    (days || []).forEach((d) => { byDay[d] = 0; });
    let weekMinutes = 0;
    let billableMinutes = 0;
    (rows || []).forEach((r) => {
        weekMinutes += r.total;
        if (r.billable) billableMinutes += r.total;
        Object.keys(r.byDay).forEach((d) => { if (d in byDay) byDay[d] += r.byDay[d]; });
    });
    return { byDay, weekMinutes, billableMinutes };
};

/* Past working days (up to and including `today`) logged below capacity. */
const underCapacityDays = (dayCaps, byDay, today) => (dayCaps || [])
    .filter((d) => d.capacityMinutes > 0 && d.date <= today && (byDay[d.date] || 0) < d.capacityMinutes)
    .map((d) => ({ date: d.date, gapMinutes: d.capacityMinutes - (byDay[d.date] || 0) }));

/* One person's workload row: estimate chips + logged minutes per day against capacity. */
const workloadDays = ({ days = [], hoursPerDay = 8, ptoDays = [], weekendDays = DEFAULT_WEEKEND, chipsByDay = {}, loggedByDay = {} } = {}) => {
    let totalEstimated = 0;
    let totalLogged = 0;
    let capacityMinutes = 0;
    const out = dayCapacity({ days, hoursPerDay, ptoDays, weekendDays }).map((c) => {
        const chips = chipsByDay[c.date] || [];
        const estimated = chips.reduce((s, ch) => s + (Number(ch.minutes) || 0), 0);
        const logged = loggedByDay[c.date] || 0;
        totalEstimated += estimated;
        totalLogged += logged;
        capacityMinutes += c.capacityMinutes;
        return { ...c, estimated, logged, chips, over: c.capacityMinutes > 0 ? estimated > c.capacityMinutes : estimated > 0 };
    });
    const utilizationPct = capacityMinutes > 0
        ? Math.round((totalEstimated / capacityMinutes) * 100)
        : (totalEstimated > 0 ? 100 : 0);
    return { days: out, totalEstimated, totalLogged, capacityMinutes, utilizationPct };
};

module.exports = {
    DEFAULT_WEEKEND,
    MAX_DAYS,
    isoDay,
    dayKeys,
    groupEntriesByTask,
    ptoDaysIn,
    dayCapacity,
    totals,
    underCapacityDays,
    workloadDays,
};
