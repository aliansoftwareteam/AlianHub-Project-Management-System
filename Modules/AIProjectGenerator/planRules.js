/**
 * Company planning rules the AI features must produce work against.
 *
 * Three rules, all enforced here rather than only asked for in a prompt. A
 * prompt is a request; a model that ignores it produces a plan that breaks the
 * rule and nobody notices until the sprint is underway. These functions are the
 * place the rule actually holds.
 *
 *   1. No task carries more than TWO hours of estimate.
 *   2. Work larger than that is split into sub-tasks that each fit the cap.
 *      The parent carries none of it, so the cap stays literally true of every
 *      task and the hours are not counted twice in any roll-up.
 *   3. Sprints are named for the week they run, matching the format the team
 *      already uses by hand: "AHE - 10 - 14 Aug 2026".
 */
'use strict';

/**
 * The cap, in minutes. Env-overridable because it is a company policy rather
 * than a fact about the software — a team that changes the rule should not need
 * a deploy. Falls back to two hours.
 */
const MAX_TASK_MINUTES = (() => {
    const raw = Number(process.env.AI_MAX_TASK_MINUTES);
    return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 120;
})();

const MAX_TASK_HOURS = MAX_TASK_MINUTES / 60;

/** Hard ceiling on a split, so a wild estimate cannot spawn hundreds of rows. */
const MAX_SPLIT_PARTS = 20;

/**
 * Split a total into parts that each respect the cap.
 *
 * Remainders are spread across the leading parts rather than left as one short
 * tail piece: a 10-hour job becomes five 2-hour sub-tasks, and a 9-hour job
 * becomes four 2-hour sub-tasks and one of 1 hour, not four of 2 and a stray 1.
 *
 * @param {number} totalMinutes
 * @returns {number[]} minutes per part; empty when there is nothing to split
 */
function splitIntoCappedParts(totalMinutes) {
    const total = Math.round(Number(totalMinutes));
    if (!Number.isFinite(total) || total <= 0) return [];
    if (total <= MAX_TASK_MINUTES) return [total];

    const parts = Math.min(Math.ceil(total / MAX_TASK_MINUTES), MAX_SPLIT_PARTS);
    // With the part count fixed, spread evenly rather than filling each to the
    // cap and leaving a stub. Every part still lands under the cap because
    // parts >= total/cap.
    const base = Math.floor(total / parts);
    let remainder = total - base * parts;
    const out = [];
    for (let i = 0; i < parts; i += 1) {
        const extra = remainder > 0 ? 1 : 0;
        remainder -= extra;
        out.push(Math.min(base + extra, MAX_TASK_MINUTES));
    }
    return out;
}

/** True when this much work has to become sub-tasks. */
function exceedsCap(minutes) {
    const n = Number(minutes);
    return Number.isFinite(n) && n > MAX_TASK_MINUTES;
}

/* ── Rule 3: weekly sprint names ───────────────────────────────────────── */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad2 = (n) => String(n).padStart(2, '0');

/** Monday of the week `date` falls in. Sunday counts as the week just ending. */
function mondayOf(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = d.getDay();                    // 0 Sun … 6 Sat
    const backToMonday = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - backToMonday);
    return d;
}

/**
 * Name for the working week starting at `monday`, in the format the team
 * already uses by hand.
 *
 *   same month   →  AHE - 10 - 14 Aug 2026
 *   across months→  AHE - 31 Aug - 04 Sep 2026
 *   across years →  AHE - 30 Dec 2025 - 03 Jan 2026
 *
 * The month is named rather than numbered so the range can never be read the
 * wrong way round, which is the one thing a purely numeric date cannot promise.
 */
function formatWeekRange(prefix, monday) {
    const start = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate());
    const end = new Date(start);
    end.setDate(end.getDate() + 4);            // Monday → Friday

    const head = String(prefix || '').trim();
    const lead = head ? `${head} - ` : '';

    if (start.getFullYear() !== end.getFullYear()) {
        return `${lead}${pad2(start.getDate())} ${MONTHS[start.getMonth()]} ${start.getFullYear()}`
            + ` - ${pad2(end.getDate())} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`;
    }
    if (start.getMonth() !== end.getMonth()) {
        return `${lead}${pad2(start.getDate())} ${MONTHS[start.getMonth()]}`
            + ` - ${pad2(end.getDate())} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`;
    }
    return `${lead}${pad2(start.getDate())} - ${pad2(end.getDate())} ${MONTHS[start.getMonth()]} ${start.getFullYear()}`;
}

/**
 * Names for a run of consecutive weekly sprints.
 *
 * Computed here, never asked of the model: an LLM does not reliably know
 * today's date and is worse at date arithmetic, and a wrong date would be
 * baked into the sprint name for good.
 *
 * @param {object} args
 * @param {string} args.prefix  - project key, e.g. "AHE"
 * @param {number} args.count   - how many sprints
 * @param {Date}   [args.from]  - defaults to the current week
 * @returns {string[]}
 */
function weeklySprintNames({ prefix, count, from }) {
    const total = Math.max(0, Math.round(Number(count) || 0));
    const start = mondayOf(from instanceof Date && !Number.isNaN(from.getTime()) ? from : new Date());
    const names = [];
    for (let i = 0; i < total; i += 1) {
        const monday = new Date(start);
        monday.setDate(monday.getDate() + i * 7);
        names.push(formatWeekRange(prefix, monday));
    }
    return names;
}

module.exports = {
    MAX_TASK_MINUTES,
    MAX_TASK_HOURS,
    MAX_SPLIT_PARTS,
    splitIntoCappedParts,
    exceedsCap,
    weeklySprintNames,
    formatWeekRange,
    mondayOf,
};
