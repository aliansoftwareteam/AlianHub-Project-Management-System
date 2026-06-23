// REP-01 — pure portfolio rollup math (no DB, no I/O). Unit-tested in
// tests/portfolio-rules.test.js. Aggregates per-project task/milestone metrics
// into the cross-project leadership view.

// A task is done when its statusType is a completion type. The codebase uses
// 'close' (velocity/cfd) and 'done' (dashboard) interchangeably — accept both.
const DONE_TYPES = ['close', 'done'];
const isDone = (statusType) => DONE_TYPES.includes(String(statusType || '').toLowerCase());

// Open + past its due date = at risk / overdue.
const isOverdue = (task, nowMs) => {
    if (!task || isDone(task.statusType)) return false;
    if (task.DueDate === undefined || task.DueDate === null || task.DueDate === '') return false;
    const due = new Date(task.DueDate).getTime();
    return !isNaN(due) && due < nowMs;
};

// Health signal from progress + overdue load.
const healthOf = (progressPct, overdue, open) => {
    if (overdue > 0 && (progressPct < 50 || overdue >= Math.max(1, Math.ceil(open * 0.25)))) return 'off-track';
    if (overdue > 0) return 'at-risk';
    return 'on-track';
};

// One project's tasks → rollup metrics.
const summarizeProject = (tasks = [], nowMs = 0) => {
    const total = tasks.length;
    let done = 0;
    let overdue = 0;
    for (const t of tasks) {
        if (isDone(t.statusType)) done++;
        else if (isOverdue(t, nowMs)) overdue++;
    }
    const open = total - done;
    const progressPct = total ? Math.round((done / total) * 100) : 0;
    return { total, done, open, overdue, progressPct, health: healthOf(progressPct, overdue, open) };
};

// Milestone counts (by date; "overdue" = past its due/end date).
const summarizeMilestones = (milestones = [], nowMs = 0) => {
    let upcoming = 0;
    let overdue = 0;
    for (const m of milestones) {
        const raw = m && (m.dueDate || m.endDate);
        if (raw === undefined || raw === null || raw === '') continue;
        const t = new Date(raw).getTime();
        if (isNaN(t)) continue;
        if (t < nowMs) overdue++; else upcoming++;
    }
    return { total: Array.isArray(milestones) ? milestones.length : 0, upcoming, overdue };
};

// Many project summaries → portfolio totals.
const rollupPortfolio = (projectSummaries = []) => {
    const totals = projectSummaries.reduce((a, p) => {
        a.totalTasks += p.total; a.doneTasks += p.done; a.openTasks += p.open; a.overdueTasks += p.overdue;
        if (p.health === 'off-track') a.offTrack++;
        else if (p.health === 'at-risk') a.atRisk++;
        else a.onTrack++;
        return a;
    }, { projects: projectSummaries.length, totalTasks: 0, doneTasks: 0, openTasks: 0, overdueTasks: 0, onTrack: 0, atRisk: 0, offTrack: 0 });
    totals.progressPct = totals.totalTasks ? Math.round((totals.doneTasks / totals.totalTasks) * 100) : 0;
    return totals;
};

module.exports = {
    DONE_TYPES, isDone, isOverdue, healthOf,
    summarizeProject, summarizeMilestones, rollupPortfolio,
};
