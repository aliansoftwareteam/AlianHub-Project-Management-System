export const REPORT_KEYS = Object.freeze(["daily_briefing", "deadline_watch", "mentions_digest", "weekly_status"]);
export const EVERY = Object.freeze(["daily", "weekdays", "weekly"]);
export const WEEKDAYS = Object.freeze([1, 2, 3, 4, 5, 6, 0]);
export const MAX_DAYS = 30;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ID = /^[0-9a-fA-F]{24}$/;

export const viewerTimeZone = () => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (e) { return "UTC"; }
};

const knownZone = (zone) => {
    if (!zone) return false;
    try { new Intl.DateTimeFormat("en", { timeZone: zone }); return true; } catch (e) { return false; }
};

export const blankSchedule = (timeZone = viewerTimeZone()) => ({
    report: "daily_briefing", every: "weekdays", at: "09:00", weekday: 1, timezone: timeZone,
    days: 3, email: false, taskId: "", pageProjectId: "", enabled: true
});

export const scheduleForm = (row = {}) => ({
    ...blankSchedule(row.timezone || viewerTimeZone()),
    report: row.report || "daily_briefing",
    every: row.every || "weekdays",
    at: row.at || "09:00",
    weekday: Number.isInteger(row.weekday) ? row.weekday : 1,
    days: Number(row.options?.days) || 3,
    email: Boolean(row.deliver?.email),
    taskId: row.deliver?.taskId || "",
    pageProjectId: row.deliver?.pageProjectId || "",
    enabled: row.enabled !== false
});

/* The i18n key of the first thing wrong with the form, or "". */
export const scheduleError = (form) => {
    if (!REPORT_KEYS.includes(form.report)) return "Ai.schedule_error_report";
    if (!EVERY.includes(form.every)) return "Ai.schedule_error_every";
    if (!TIME.test(String(form.at || ""))) return "Ai.schedule_error_time";
    if (!knownZone(String(form.timezone || "").trim())) return "Ai.schedule_error_timezone";
    if (form.every === "weekly" && !WEEKDAYS.includes(Number(form.weekday))) return "Ai.schedule_error_weekday";
    if (form.report === "deadline_watch" && !(Number.isInteger(Number(form.days)) && Number(form.days) >= 1 && Number(form.days) <= MAX_DAYS)) return "Ai.schedule_error_days";
    const taskId = String(form.taskId || "").trim();
    if (taskId && !ID.test(taskId)) return "Ai.schedule_error_task";
    return "";
};

export const schedulePayload = (form) => {
    const taskId = String(form.taskId || "").trim();
    const pageProjectId = String(form.pageProjectId || "").trim();
    return {
        report: form.report,
        every: form.every,
        at: form.at,
        ...(form.every === "weekly" ? { weekday: Number(form.weekday) } : {}),
        timezone: String(form.timezone).trim(),
        enabled: form.enabled !== false,
        options: form.report === "deadline_watch" ? { days: Number(form.days) } : {},
        deliver: { email: Boolean(form.email), ...(taskId ? { taskId } : {}), ...(pageProjectId ? { pageProjectId } : {}) }
    };
};

export const weekdayName = (t, weekday) => t(`Ai.schedule_weekday_${weekday}`);

export const describeSchedule = (t, s) => {
    const zone = s.timezone || "UTC";
    if (s.every === "weekly") return t("Ai.schedule_every_weekly", { day: weekdayName(t, s.weekday), at: s.at, zone });
    return t(`Ai.schedule_every_${s.every === "daily" ? "daily" : "weekdays"}`, { at: s.at, zone });
};

export const formatInZone = (at, timeZone, locale) => {
    const options = { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false };
    try { return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(new Date(at)); } catch (e) { return new Intl.DateTimeFormat(locale, options).format(new Date(at)); }
};

export const nextRunText = (t, s, { locale } = {}) => {
    if (s.enabled === false) return t("Ai.schedule_off");
    if (!s.nextRunAt) return t("Ai.schedule_next_unknown");
    return t("Ai.schedule_next_run", { when: formatInZone(s.nextRunAt, s.timezone || "UTC", locale) });
};

const RESULT_KEYS = ["done", "failed", "skipped", "missed", "deduplicated"];

export const lastResultText = (t, s) => {
    const result = s.lastResult;
    if (!result || !result.status) return t("Ai.schedule_never_ran");
    const status = RESULT_KEYS.includes(result.status) ? result.status : "failed";
    return t(`Ai.schedule_result_${status}`);
};
