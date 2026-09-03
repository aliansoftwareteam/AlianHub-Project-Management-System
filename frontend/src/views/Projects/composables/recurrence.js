/* Occurrence maths for recurring task rules.
 *
 * Mirrors computeNextRun in Modules/RecurringTasks/helper.js exactly, including
 * the fact that a weekly rule lands on the next matching weekday regardless of
 * `interval` — a preview that disagreed with the scheduler would be a lie. Pure:
 * no store, no clock of its own, no network. */

const FREQS = ['daily', 'weekly', 'monthly'];
const MISSED_POLICIES = ['skip', 'create', 'roll'];
const DEFAULT_HOUR = 9;
const MAX_MONTH_DAY = 28;

function atHour(year, month, day, hour) {
    return new Date(year, month, day, hour, 0, 0, 0);
}

function toDate(value) {
    if (!value) return null;
    const d = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeRule(rule) {
    const source = rule || {};
    const freq = FREQS.includes(source.freq) ? source.freq : 'daily';
    const byweekday = Array.isArray(source.byweekday)
        ? [...new Set(source.byweekday.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
        : [];
    const rawHour = Number(source.runHour);
    const rawDay = Number(source.monthday);
    return {
        freq,
        interval: Math.max(1, Number(source.interval) || 1),
        byweekday,
        monthday: Number.isFinite(rawDay) && rawDay > 0 ? Math.min(MAX_MONTH_DAY, Math.round(rawDay)) : null,
        runHour: Number.isFinite(rawHour) ? Math.min(23, Math.max(0, Math.round(rawHour))) : DEFAULT_HOUR,
        until: toDate(source.until)
    };
}

/* The first run strictly after `from`, ignoring `until`. */
function computeNextRun(rule, from) {
    const r = normalizeRule(rule);
    const start = toDate(from) || new Date();
    const hour = r.runHour;

    if (r.freq === 'weekly') {
        const days = r.byweekday.length ? r.byweekday : [start.getDay()];
        for (let i = 1; i <= 7 * r.interval + 7; i += 1) {
            const candidate = atHour(start.getFullYear(), start.getMonth(), start.getDate() + i, hour);
            if (days.includes(candidate.getDay())) return candidate;
        }
        return atHour(start.getFullYear(), start.getMonth(), start.getDate() + 7, hour);
    }

    if (r.freq === 'monthly') {
        const dom = r.monthday || Math.min(MAX_MONTH_DAY, start.getDate());
        let candidate = atHour(start.getFullYear(), start.getMonth(), dom, hour);
        while (candidate <= start) {
            candidate = atHour(candidate.getFullYear(), candidate.getMonth() + r.interval, dom, hour);
        }
        return candidate;
    }

    return atHour(start.getFullYear(), start.getMonth(), start.getDate() + r.interval, hour);
}

/* The next `count` runs after `from`, stopping at the rule's end date. */
function nextOccurrences(rule, from, count) {
    const wanted = Math.max(0, Number(count) || 0);
    const r = normalizeRule(rule);
    const out = [];
    let cursor = toDate(from) || new Date();
    for (let i = 0; i < wanted; i += 1) {
        const next = computeNextRun(r, cursor);
        if (r.until && next > r.until) break;
        out.push(next);
        cursor = next;
    }
    return out;
}

/* Old rules only stored `skipIfOpen`; read them as the policy they meant. */
function missedPolicyOf(rule) {
    const stored = rule && rule.missedPolicy;
    if (MISSED_POLICIES.includes(stored)) return stored;
    return rule && rule.skipIfOpen ? 'skip' : 'create';
}

/* The fields a rule must carry for a policy, so a server that only knows
   `skipIfOpen` still behaves the way the picker promised. */
function missedPolicyFields(policy) {
    const value = MISSED_POLICIES.includes(policy) ? policy : 'create';
    return { missedPolicy: value, skipIfOpen: value !== 'create' };
}

/* What happens at an occurrence, given the policy and whether the last instance
   is still open: 'create' a task, 'skip' it, or 'roll' the open one forward. */
function resolveOccurrence(policy, previousStillOpen) {
    if (!previousStillOpen) return 'create';
    const value = MISSED_POLICIES.includes(policy) ? policy : 'create';
    return value === 'create' ? 'create' : value;
}

module.exports = {
    FREQS,
    MISSED_POLICIES,
    normalizeRule,
    computeNextRun,
    nextOccurrences,
    missedPolicyOf,
    missedPolicyFields,
    resolveOccurrence
};
