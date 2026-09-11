export const ALERT_THRESHOLDS = [80, 100];

/* Mirrors Modules/AICore/features.js; anything else is shown as untagged. */
export const KNOWN_FEATURES = [
    "agent_run", "project_plan", "project_tasks", "clarifier", "meeting_notes", "task_summary", "description", "task_category",
    "task_estimate", "workload_summary", "ask", "assist", "project_template", "portfolio_summary", "page_compose", "guide", "mcp_brief",
];

export const featureLabelKey = (feature) => (KNOWN_FEATURES.includes(feature) ? `Instance.feature_${feature}` : "Instance.feature_unknown");

export function budgetView(budget) {
    const b = budget || {};
    const used = Number(b.usedUsd || 0);
    const cap = Number(b.budgetUsd || 0);
    const percent = Number.isFinite(Number(b.percent)) && b.percent !== null && b.percent !== undefined
        ? Math.round(Number(b.percent))
        : (cap > 0 ? Math.round((used / cap) * 100) : 0);
    const level = cap > 0 && percent >= 100 ? "over" : cap > 0 && percent >= 80 ? "warn" : "ok";
    const alerts = ALERT_THRESHOLDS.map((threshold) => ({ threshold, at: (b.alerts && b.alerts[String(threshold)]) || null }));
    const features = (Array.isArray(b.features) ? b.features : [])
        .map((f) => ({ feature: String(f.feature || "unknown"), usd: Number(f.usd || 0), calls: Number(f.calls || 0), tokens: Number(f.tokens || 0) }))
        .map((f) => ({ ...f, share: used > 0 ? Math.round((f.usd / used) * 100) : 0 }));
    return { month: b.month || "", used, cap, percent, width: Math.min(100, Math.max(0, percent)), level, alerts, features };
}
