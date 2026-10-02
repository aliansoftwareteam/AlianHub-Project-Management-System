import { nextOccurrences } from "@/views/Projects/composables/recurrence";

export const REPEAT_FREQS = ["daily", "weekly", "monthly"];
export const REPEAT_ENDS = ["never", "on", "after"];
export const MISSED_POLICIES = ["skip", "create", "roll"];
const MAX_MONTH_DAY = 28;
const DEFAULT_RUNS = 10;

const pad = (n) => String(n).padStart(2, "0");
const isoDay = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export function emptyRepeat(today = new Date()) {
    return {
        freq: "weekly",
        interval: 1,
        byweekday: [today.getDay()],
        monthday: Math.min(MAX_MONTH_DAY, today.getDate()),
        ends: "never",
        until: "",
        maxRuns: DEFAULT_RUNS,
        missedPolicy: "skip"
    };
}

export function repeatFromRule(rule, today = new Date()) {
    if (!rule) return emptyRepeat(today);
    const base = emptyRepeat(today);
    const ends = rule.maxRuns ? "after" : (rule.until ? "on" : "never");
    return {
        freq: REPEAT_FREQS.includes(rule.freq) ? rule.freq : base.freq,
        interval: Math.max(1, Number(rule.interval) || 1),
        byweekday: Array.isArray(rule.byweekday) && rule.byweekday.length ? rule.byweekday.map(Number) : base.byweekday,
        monthday: Number(rule.monthday) || base.monthday,
        ends,
        until: rule.until ? isoDay(new Date(rule.until)) : "",
        maxRuns: Number(rule.maxRuns) || DEFAULT_RUNS,
        missedPolicy: MISSED_POLICIES.includes(rule.missedPolicy) ? rule.missedPolicy : (rule.skipIfOpen === false ? "create" : "skip")
    };
}

/* The body the task's repeat route takes; fields that do not apply to the chosen shape are cleared. */
export function ruleFromRepeat(form) {
    return {
        freq: form.freq,
        interval: Math.max(1, Math.round(Number(form.interval) || 1)),
        byweekday: form.freq === "weekly" ? [...new Set(form.byweekday.map(Number))].sort() : [],
        monthday: form.freq === "monthly" ? Math.min(MAX_MONTH_DAY, Math.max(1, Math.round(Number(form.monthday) || 1))) : null,
        until: form.ends === "on" && form.until ? form.until : null,
        maxRuns: form.ends === "after" ? Math.max(1, Math.round(Number(form.maxRuns) || 1)) : null,
        missedPolicy: form.missedPolicy
    };
}

/* An i18n key for what stops the form being saved, or "". */
export function repeatProblem(form) {
    if (form.freq === "weekly" && !form.byweekday.length) return "TaskPanel.repeat_pick_day";
    if (form.ends === "on" && !form.until) return "TaskPanel.repeat_until_required";
    return "";
}

export function weekdayNames(locale) {
    // 7 January 2024 was a Sunday, so index 0 lines up with Date#getDay.
    return Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 7 + i).toLocaleDateString(locale, { weekday: "short" }));
}

export function describeRepeat(rule, { t, locale } = {}) {
    if (!rule) return t("TaskPanel.repeat_none");
    const n = Math.max(1, Number(rule.interval) || 1);
    const names = weekdayNames(locale);
    let text;
    if (rule.freq === "weekly") {
        const days = (rule.byweekday || []).map((d) => names[Number(d)]).join(", ");
        text = t("TaskPanel.repeat_summary_weekly", { n, days }, n);
    } else if (rule.freq === "monthly") {
        text = t("TaskPanel.repeat_summary_monthly", { n, day: rule.monthday || 1 }, n);
    } else {
        text = t("TaskPanel.repeat_summary_daily", { n }, n);
    }
    if (rule.maxRuns) return t("TaskPanel.repeat_summary_times", { rule: text, n: rule.maxRuns }, rule.maxRuns);
    if (rule.until) return t("TaskPanel.repeat_summary_until", { rule: text, date: new Date(rule.until).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }) });
    return text;
}

/* The next runs the scheduler would make, capped by what is left of "after N". */
export function upcomingRuns(rule, { from = new Date(), count = 3, runCount = 0 } = {}) {
    const left = rule.maxRuns ? Math.max(0, Number(rule.maxRuns) - (Number(runCount) || 0)) : count;
    return nextOccurrences(rule, from, Math.min(count, left));
}
