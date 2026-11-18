/* The web app reads this file through the @workingDays alias, so the API, the Gantt and the settings screens resolve the same week.
 * Days are JavaScript weekday numbers: 0 is Sunday, 6 is Saturday. */

const WEEK = [0, 1, 2, 3, 4, 5, 6];
const DEFAULT_WORKING_DAYS = Object.freeze([1, 2, 3, 4, 5]);

const isWeekday = (value) => Number.isInteger(value) && value >= 0 && value <= 6;

const checkWorkingDays = (value) => {
    if (!Array.isArray(value) || !value.every(isWeekday)) {
        return { ok: false, error: 'Working days must be a list of weekday numbers from 0 (Sunday) to 6 (Saturday).' };
    }
    if (!value.length) return { ok: false, error: 'At least one working day is required.' };
    return { ok: true, days: WEEK.filter((day) => value.includes(day)) };
};

const storedWeek = (holder) => {
    const checked = checkWorkingDays(holder && holder.workingDays);
    return checked.ok ? checked.days : null;
};

/* A project without a week of its own (absent, null or empty) uses the company's; a company without one works Monday to Friday. */
const workingDaysFor = (company, project) => storedWeek(project) || storedWeek(company) || [...DEFAULT_WORKING_DAYS];

const weekendDaysFor = (company, project) => {
    const working = workingDaysFor(company, project);
    return WEEK.filter((day) => !working.includes(day));
};

const countsEveryDay = (days) => WEEK.every((day) => (days || []).includes(day));

module.exports = { DEFAULT_WORKING_DAYS, checkWorkingDays, workingDaysFor, weekendDaysFor, countsEveryDay };
