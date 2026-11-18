/* Pure schedule maths for recurring task definitions.
 *
 * Split out of helper.js so the same rules can be asserted without loading the
 * task/mongo stack, and so the client preview
 * (frontend/src/views/Projects/composables/recurrence.js) can be tested against
 * the code that actually creates the tasks. No I/O here. */

const FREQS = ['daily', 'weekly', 'monthly'];
const MISSED_POLICIES = ['skip', 'create', 'roll'];
const DEFAULT_HOUR = 9;
const MAX_MONTH_DAY = 28;

function atHour(year, month, day, hour) {
    return new Date(year, month, day, hour, 0, 0, 0);
}

// The next run strictly after `fromDate`, per the definition's schedule. A weekly
// rule lands on the next matching weekday; `interval` only widens the search.
function computeNextRun(def, fromDate) {
    const from = fromDate ? new Date(fromDate) : new Date();
    const hour = Number.isFinite(Number(def.runHour)) ? Number(def.runHour) : DEFAULT_HOUR;
    const interval = Math.max(1, Number(def.interval) || 1);

    if (def.freq === 'weekly') {
        const days = (Array.isArray(def.byweekday) && def.byweekday.length) ? def.byweekday.map(Number) : [from.getDay()];
        for (let i = 1; i <= 7 * interval + 7; i++) {
            const c = atHour(from.getFullYear(), from.getMonth(), from.getDate() + i, hour);
            if (days.includes(c.getDay())) return c;
        }
        return atHour(from.getFullYear(), from.getMonth(), from.getDate() + 7, hour);
    }
    if (def.freq === 'monthly') {
        // cap at 28 so we never overflow into the next month on short months
        const dom = Math.min(MAX_MONTH_DAY, Math.max(1, Number(def.monthday) || from.getDate()));
        let c = atHour(from.getFullYear(), from.getMonth(), dom, hour);
        while (c <= from) {
            c = atHour(c.getFullYear(), c.getMonth() + interval, dom, hour);
        }
        return c;
    }
    // daily (default)
    return atHour(from.getFullYear(), from.getMonth(), from.getDate() + interval, hour);
}

// Definitions written before the picker existed only stored `skipIfOpen`.
function missedPolicyOf(def) {
    const stored = def && def.missedPolicy;
    if (MISSED_POLICIES.includes(stored)) return stored;
    return (def && def.skipIfOpen) ? 'skip' : 'create';
}

// What an occurrence does when the previous instance is still open.
function resolveOccurrence(policy, previousStillOpen) {
    if (!previousStillOpen) return 'create';
    return MISSED_POLICIES.includes(policy) ? policy : 'create';
}

const MAX_INTERVAL = 365;
const MAX_RUNS = 1000;

const invalid = (reason) => ({ valid: false, reason });

const wholeIn = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

/* The schedule fields a request may set, validated so the scheduler never meets a value it
 * cannot step through. Absent optional fields read as "not set". */
function scheduleFrom(body) {
    const b = body || {};
    if (!FREQS.includes(b.freq)) return invalid(`freq must be one of: ${FREQS.join(', ')}.`);
    const interval = b.interval === undefined || b.interval === null || b.interval === '' ? 1 : Number(b.interval);
    if (!wholeIn(interval, 1, MAX_INTERVAL)) return invalid(`interval must be a whole number from 1 to ${MAX_INTERVAL}.`);
    const byweekday = b.byweekday === undefined ? [] : b.byweekday;
    if (!Array.isArray(byweekday) || !byweekday.every((d) => wholeIn(Number(d), 0, 6))) return invalid('byweekday must list days 0 (Sunday) to 6.');
    const monthday = b.monthday === undefined || b.monthday === null || b.monthday === '' ? null : Number(b.monthday);
    if (monthday !== null && !wholeIn(monthday, 1, MAX_MONTH_DAY)) return invalid(`monthday must be from 1 to ${MAX_MONTH_DAY}.`);
    const runHour = b.runHour === undefined || b.runHour === null || b.runHour === '' ? DEFAULT_HOUR : Number(b.runHour);
    if (!wholeIn(runHour, 0, 23)) return invalid('runHour must be from 0 to 23.');
    const until = b.until ? new Date(b.until) : null;
    if (until && Number.isNaN(until.getTime())) return invalid('until must be a date.');
    const maxRuns = b.maxRuns === undefined || b.maxRuns === null || b.maxRuns === '' ? null : Number(b.maxRuns);
    if (maxRuns !== null && !wholeIn(maxRuns, 1, MAX_RUNS)) return invalid(`maxRuns must be a whole number from 1 to ${MAX_RUNS}.`);
    const missedPolicy = MISSED_POLICIES.includes(b.missedPolicy) ? b.missedPolicy : 'skip';
    return {
        valid: true,
        reason: '',
        fields: {
            freq: b.freq,
            interval,
            byweekday: [...new Set(byweekday.map(Number))].sort(),
            monthday,
            runHour,
            until,
            maxRuns,
            missedPolicy,
            skipIfOpen: missedPolicy !== 'create',
        },
    };
}

/* A rule is spent once it has made its last occurrence, or its next run falls past its end date. */
function hasEnded(def, next) {
    const maxRuns = Number(def && def.maxRuns) || 0;
    if (maxRuns && (Number(def.runCount) || 0) >= maxRuns) return true;
    return Boolean(def && def.until && next && new Date(next) > new Date(def.until));
}

module.exports = {
    FREQS,
    MISSED_POLICIES,
    computeNextRun,
    missedPolicyOf,
    resolveOccurrence,
    scheduleFrom,
    hasEnded,
};
