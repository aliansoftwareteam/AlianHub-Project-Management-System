/* Stepping and counting over a working week for the Gantt: the shift rule and the critical path both read it.
 * Days are local-calendar days, so a daylight-saving change never nudges a bar off its hour. CommonJS so the jest suite can require it. */

const MAX_STEPS = 36600;

/* A seven-day week, an empty one and none at all count every day, which null says. */
const workingDaySet = (days) => {
    const set = Array.isArray(days) ? new Set(days.map(Number)) : new Set();
    return set.size && set.size < 7 ? set : null;
};

const nextWorkingDay = (date, working) => {
    const next = new Date(date.getTime());
    for (let i = 0; i < 7; i += 1) {
        next.setDate(next.getDate() + 1);
        if (!working || working.has(next.getDay())) return next;
    }
    return next;
};

const addWorkingDays = (date, count, working) => {
    let at = date;
    for (let i = 0; i < count; i += 1) at = nextWorkingDay(at, working);
    return at;
};

const workingDaysBetween = (start, end, working) => {
    const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    let count = 0;
    for (let steps = 0; cursor <= last && steps < MAX_STEPS; steps += 1) {
        if (!working || working.has(cursor.getDay())) count += 1;
        cursor.setDate(cursor.getDate() + 1);
    }
    return count;
};

module.exports = { MAX_STEPS, workingDaySet, nextWorkingDay, addWorkingDays, workingDaysBetween };
