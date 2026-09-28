export const QUALITY_WINDOWS = Object.freeze([7, 30, 90]);
export const DEFAULT_QUALITY_WINDOW = 30;

/* AICore FEATURES that people can rate or that spend; anything else shows its raw tag. */
export const FEATURE_LABELS = Object.freeze([
    "agent_run", "project_plan", "project_tasks", "clarifier", "meeting_notes", "task_summary", "description", "task_category",
    "task_estimate", "workload_summary", "ask", "assist", "project_template", "portfolio_summary", "page_compose", "guide",
    "mcp_brief", "knowledge_embed"
]);

export const KIND_LABELS = Object.freeze(["ask_turn", "preview", "proposal"]);

export const likedPercent = ({ up = 0, down = 0 } = {}) => (up + down ? Math.round((up / (up + down)) * 100) : null);

/* Stacked day bars: thumbs down on the baseline, thumbs up above it, scaled to the busiest day. */
export function trendBars(series = [], width = 300, height = 48) {
    if (!series.length) return [];
    const peak = Math.max(1, ...series.map((d) => (d.up || 0) + (d.down || 0)));
    const step = width / series.length;
    const barWidth = Math.max(1, step * 0.7);
    return series.map((d, i) => {
        const downH = ((d.down || 0) / peak) * height;
        const upH = ((d.up || 0) / peak) * height;
        const x = i * step + (step - barWidth) / 2;
        return { day: d.day, x, width: barWidth, down: { y: height - downH, height: downH }, up: { y: height - downH - upH, height: upH } };
    });
}
