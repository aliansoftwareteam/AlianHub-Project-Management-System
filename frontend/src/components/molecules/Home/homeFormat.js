import moment from "moment";

export const PRIORITY_RANK = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

export const priorityKey = (value) => String(value || "").toUpperCase();

export function priorityMeta(value) {
    const key = priorityKey(value);
    if (key === "URGENT") return { key, label: "HomeV2.priority_urgent", cls: "ah-chip--danger" };
    if (key === "HIGH") return { key, label: "HomeV2.priority_high", cls: "ah-chip--warn" };
    if (key === "LOW") return { key, label: "HomeV2.priority_low", cls: "" };
    return { key: "MEDIUM", label: "HomeV2.priority_medium", cls: "" };
}

export function dueBucket(task) {
    if (!task || !task.DueDate) return "unscheduled";
    const due = moment(task.DueDate);
    const today = moment().startOf("day");
    if (due.isBefore(today)) return "overdue";
    if (due.isSame(today, "day")) return "today";
    return "next";
}

export function dueLabel(date, t) {
    if (!date) return "";
    const d = moment(date);
    const today = moment().startOf("day");
    if (d.isSame(today, "day")) return t("HomeV2.today");
    if (d.isSame(today.clone().add(1, "day"), "day")) return t("HomeV2.tomorrow");
    const diff = d.startOf("day").diff(today, "days");
    if (diff > 1 && diff < 7) return d.format("ddd");
    return d.format("MMM D");
}

export function compareTasks(a, b, sortBy) {
    if (sortBy === "name") return String(a.TaskName || "").localeCompare(String(b.TaskName || ""));
    if (sortBy === "due") {
        const ad = a.DueDate ? new Date(a.DueDate).getTime() : Infinity;
        const bd = b.DueDate ? new Date(b.DueDate).getTime() : Infinity;
        if (ad !== bd) return ad - bd;
    }
    const ap = PRIORITY_RANK[priorityKey(a.Task_Priority)] ?? 9;
    const bp = PRIORITY_RANK[priorityKey(b.Task_Priority)] ?? 9;
    if (ap !== bp) return ap - bp;
    const ad = a.DueDate ? new Date(a.DueDate).getTime() : Infinity;
    const bd = b.DueDate ? new Date(b.DueDate).getTime() : Infinity;
    return ad - bd;
}

export function fmtClock(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

export function fmtShortClock(ms) {
    const total = Math.max(0, Math.floor(ms / 60000));
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function fmtEstimate(minutes) {
    const m = Number(minutes) || 0;
    if (!m) return "";
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    const rest = m % 60;
    return rest ? `${h}h ${rest}m` : `${h}h`;
}

export function projectColor(project) {
    if (project?.projectIcon?.type === "color" && project.projectIcon.data) return project.projectIcon.data;
    return "var(--brand)";
}

export const uid = () => Math.random().toString(36).slice(2, 10);
