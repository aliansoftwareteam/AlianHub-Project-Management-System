import moment from "moment";

const pad = (n) => String(n).padStart(2, "0");
const MINUTES_PER_DAY = 24 * 60;

export function formatMinutes(total) {
    const minutes = Math.max(0, Math.round(Number(total) || 0));
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h ? `${h}h ${pad(m)}m` : `${m}m`;
}

export const clockOf = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

const minutesOfClock = (clock) => {
    const [h, m] = String(clock || "").split(":").map(Number);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
};

export function emptyTimeForm(now = new Date()) {
    return { timeSheetId: "", userId: "", date: moment(now).format("YYYY-MM-DD"), start: "09:00", hours: 1, minutes: 0, note: "", billable: true, previousMinutes: 0 };
}

export function timeFormFromEntry(entry) {
    const start = moment((Number(entry.startedAt) || 0) * 1000);
    return {
        timeSheetId: entry._id,
        userId: entry.userId,
        date: start.format("YYYY-MM-DD"),
        start: start.format("HH:mm"),
        hours: Math.floor(entry.minutes / 60),
        minutes: entry.minutes % 60,
        note: entry.note || "",
        billable: entry.billable !== false,
        previousMinutes: entry.minutes
    };
}

export const durationOf = (form) => Math.max(0, Math.round(Number(form.hours) || 0)) * 60 + Math.max(0, Math.round(Number(form.minutes) || 0));

/* An i18n key for what stops the entry being saved, or "". The manual-time route stores the
 * start and end on the entry's day, so an entry cannot run past midnight. */
export function timeFormProblem(form) {
    const duration = durationOf(form);
    if (!form.date || duration <= 0) return "TaskPanel.time_duration_required";
    if (minutesOfClock(form.start) + duration > MINUTES_PER_DAY - 1) return "TaskPanel.time_past_midnight";
    return "";
}

/* The body POST /api/v2/manualLogtime takes, for a new entry or an edit of one. */
export function manualLogBody(form, context) {
    const duration = durationOf(form);
    const startMinutes = minutesOfClock(form.start);
    return {
        logTimeDate: form.date,
        description: form.note.trim() || context.defaultNote,
        startLogTime: clockOf(startMinutes),
        endLogTime: clockOf(startMinutes + duration),
        timeDuration: clockOf(duration),
        ticketId: context.task._id,
        taskId: context.task._id,
        projectId: context.task.ProjectID,
        companyId: context.companyId,
        userId: form.userId || context.userId,
        isEdit: Boolean(form.timeSheetId),
        timeSheetId: form.timeSheetId || "",
        previousLoggedTime: form.timeSheetId ? clockOf(form.previousMinutes) : "",
        dateFormat: context.dateFormat,
        taskName: context.task.TaskName,
        projectName: context.projectName,
        sprintId: context.task.sprintId,
        folderId: context.task.folderObjId || "",
        companyOwnerId: context.companyOwnerId,
        timeZone: context.timeZone,
        billable: form.billable !== false
    };
}

export function deleteLogBody(entry, context) {
    const start = moment((Number(entry.startedAt) || 0) * 1000);
    const end = moment((Number(entry.endedAt) || entry.startedAt) * 1000);
    return {
        timeSheetId: entry._id,
        userId: entry.userId,
        logTimeDate: start.format("YYYY-MM-DD"),
        dateFormat: context.dateFormat,
        timeDuration: entry.minutes,
        startLogTime: start.format("HH:mm"),
        endLogTime: end.format("HH:mm"),
        LogStartTime: entry.startedAt,
        LogEndTime: entry.endedAt,
        projectId: context.task.ProjectID,
        ticketId: context.task._id,
        sprintId: context.task.sprintId,
        folderId: context.task.folderObjId || "",
        companyId: context.companyId,
        companyOwnerId: context.companyOwnerId,
        taskName: context.task.TaskName,
        projectName: context.projectName
    };
}
