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

module.exports = {
    FREQS,
    MISSED_POLICIES,
    computeNextRun,
    missedPolicyOf,
    resolveOccurrence,
};
