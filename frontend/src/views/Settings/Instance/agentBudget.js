export const ALERT_THRESHOLDS = [80, 100];

export function budgetView(budget) {
    const b = budget || {};
    const used = Number(b.usedUsd || 0);
    const cap = Number(b.budgetUsd || 0);
    const percent = Number.isFinite(Number(b.percent)) && b.percent !== null && b.percent !== undefined
        ? Math.round(Number(b.percent))
        : (cap > 0 ? Math.round((used / cap) * 100) : 0);
    const level = cap > 0 && percent >= 100 ? "over" : cap > 0 && percent >= 80 ? "warn" : "ok";
    const alerts = ALERT_THRESHOLDS.map((threshold) => ({ threshold, at: (b.alerts && b.alerts[String(threshold)]) || null }));
    return { month: b.month || "", used, cap, percent, width: Math.min(100, Math.max(0, percent)), level, alerts };
}
