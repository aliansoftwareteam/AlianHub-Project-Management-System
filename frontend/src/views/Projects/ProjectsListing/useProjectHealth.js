import { reactive } from "vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { i18n } from "@/locales/main";

const t = i18n.global.t;

const DAY = 86400000;

// projectId -> { loading, loaded, total, done, overdue, progressPct, sprint }
const snapshots = reactive({});
const queue = [];
let active = 0;
const MAX_PARALLEL = 3;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const isLiveSprint = (s) => s && s.mainChat !== true && s.isBacklog !== true && s.deletedStatusKey !== 1 && s.deletedStatusKey !== 2;

/* The sprint a project header would show: the running one, else the next planned
   one, else the newest sprint that has a date window at all. */
function pickSprint(rows) {
    const live = (rows || []).filter(isLiveSprint);
    const running = live.find((s) => s.state === "active" || s.state === "overdue");
    if (running) return running;
    const planned = live
        .filter((s) => s.state === "planned" && s.startDate)
        .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))[0];
    if (planned) return planned;
    return live.filter((s) => s.endDate).sort((a, b) => new Date(b.endDate) - new Date(a.endDate))[0] || null;
}

export function sprintWindow(sprint) {
    if (!sprint || !sprint.startDate || !sprint.endDate) return null;
    const start = new Date(sprint.startDate).getTime();
    const end = new Date(sprint.endDate).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    const now = Date.now();
    const daysLeft = Math.max(0, Math.ceil((end - now) / DAY));
    const elapsedPct = Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100)));
    return { start, end, daysLeft, elapsedPct, over: now > end };
}

function drain() {
    while (active < MAX_PARALLEL && queue.length) {
        const job = queue.shift();
        active += 1;
        job().finally(() => {
            active -= 1;
            drain();
        });
    }
}

/**
 * One row's numbers, from endpoints the product already has:
 * `/api/v1/project-dashboard/:id` (task totals + overdue, permission-scoped
 * server-side) and the project's own sprint list. Fetched once per project and
 * kept for the life of the page.
 */
export function loadProjectSnapshot(projectId) {
    const id = String(projectId || "");
    if (!id || snapshots[id]) return;
    snapshots[id] = { loading: true, loaded: false, total: 0, done: 0, overdue: 0, progressPct: 0, sprint: null };

    queue.push(async () => {
        const [dash, sprints] = await Promise.allSettled([
            apiRequest("get", `${env.PROJECT_DASHBOARD}/${id}`),
            apiRequest("get", `/api/v1/${env.GET_SPRINT_OR_PROJECT}/${id}?collection=sprints`)
        ]);
        const snap = snapshots[id];
        if (dash.status === "fulfilled" && dash.value?.data?.status === true) {
            const d = dash.value.data.data || {};
            snap.total = num(d.totalTasks);
            snap.done = num(d.completedTasks);
            snap.overdue = num(d.overdueTasks);
            snap.progressPct = num(d.taskCompletionPct);
        }
        if (sprints.status === "fulfilled") {
            snap.sprint = pickSprint(sprints.value?.data?.data || sprints.value?.data || []);
        }
        snap.loading = false;
        snap.loaded = true;
    });
    drain();
}

export function projectSnapshot(projectId) {
    return snapshots[String(projectId || "")] || null;
}

/**
 * Health, derived on the client from the numbers above: how much of the work is
 * overdue, and how far the sprint burn-down has drifted behind the calendar.
 *
 * An agent-set value wins: the Daily PM agent writes `health` (and optionally
 * `healthReason`) onto the project document, and when that field is present it
 * is shown verbatim instead of anything computed here.
 */
export function deriveHealth(project, snap) {
    const agentSet = project && project.health;
    if (agentSet && ["on-track", "at-risk", "blocked"].includes(String(agentSet))) {
        return {
            key: String(agentSet),
            label: t(`ProjectsV2.health_${String(agentSet).replace("-", "_")}`),
            bySource: t("ProjectsV2.health_by_agent"),
            reasons: project.healthReason ? [String(project.healthReason)] : []
        };
    }

    const reasons = [];
    let key = "on-track";

    if (!snap || !snap.loaded) {
        return { key: "unknown", label: t("ProjectsV2.health_unknown"), bySource: "", reasons: [] };
    }

    const open = Math.max(0, snap.total - snap.done);
    const overdueShare = open > 0 ? snap.overdue / open : 0;

    if (snap.overdue > 0) {
        key = "at-risk";
        reasons.push(t("ProjectsV2.why_overdue", { n: snap.overdue }));
    }
    if (snap.overdue > 0 && (snap.progressPct < 50 || overdueShare >= 0.25)) {
        key = "blocked";
    }

    const win = sprintWindow(snap.sprint);
    if (win) {
        const drift = snap.progressPct - win.elapsedPct;
        if (win.over && snap.progressPct < 100) {
            key = "blocked";
            reasons.push(t("ProjectsV2.why_sprint_over"));
        } else if (drift <= -20) {
            if (key === "on-track") key = "at-risk";
            reasons.push(t("ProjectsV2.why_burndown", { drift: Math.abs(drift), elapsed: win.elapsedPct, done: snap.progressPct }));
        }
    }

    if (!reasons.length) reasons.push(t("ProjectsV2.why_clear"));

    return {
        key,
        label: t(`ProjectsV2.health_${key.replace("-", "_")}`),
        bySource: t("ProjectsV2.health_by_signals"),
        reasons
    };
}
