export const HEALTH_WINDOWS = Object.freeze(["1h", "24h", "7d", "30d"]);
export const DEFAULT_HEALTH_WINDOW = "24h";
export const ERROR_RATE_WARN = 0.1;
export const APPROVAL_RATE_WARN = 0.5;

export const AGENT_COLUMNS = Object.freeze([
    { key: "agentName", label: "AiHealth.col_agent" },
    { key: "runs", label: "AiHealth.col_runs" },
    { key: "errorRate", label: "AiHealth.col_error_rate" },
    { key: "approvalRate", label: "AiHealth.col_approval_rate" },
    { key: "p95DurationMs", label: "AiHealth.col_p95" },
    { key: "costUsd", label: "AiHealth.col_cost" }
]);

const isBlank = (value) => value === null || value === undefined || value === "";

/* Rows without a value sink to the bottom in either direction, so "no decisions yet" never reads as the best or worst. */
export const sortAgents = (rows, key, dir = "desc") => {
    const sign = dir === "asc" ? 1 : -1;
    return [...(rows || [])].sort((a, b) => {
        const x = a?.[key];
        const y = b?.[key];
        if (isBlank(x) || isBlank(y)) return Number(isBlank(x)) - Number(isBlank(y));
        const order = typeof x === "string" || typeof y === "string" ? String(x).localeCompare(String(y)) : x - y;
        return sign * order;
    });
};

export const nextSort = (current, key) => {
    if (current?.key === key) return { key, dir: current.dir === "desc" ? "asc" : "desc" };
    return { key, dir: key === "agentName" ? "asc" : "desc" };
};

export const warningsOf = (agent) => [
    ...(typeof agent?.errorRate === "number" && agent.errorRate > ERROR_RATE_WARN ? ["error"] : []),
    ...(typeof agent?.approvalRate === "number" && agent.approvalRate < APPROVAL_RATE_WARN ? ["approval"] : [])
];

const tenth = (n) => Math.round(n * 10) / 10;

export const sparkPoints = (series, width = 64, height = 18) => {
    const counts = (series || []).map((bucket) => Number(bucket?.runs) || 0);
    if (!counts.length) return "";
    const max = Math.max(...counts, 1);
    const step = counts.length > 1 ? width / (counts.length - 1) : 0;
    return counts.map((n, i) => `${tenth(i * step)},${tenth(height - (n / max) * height)}`).join(" ");
};

export const percentOf = (rate) => tenth(rate * 100);

export const durationParts = (ms) => {
    if (ms < 1000) return { key: "AiHealth.duration_ms", n: Math.round(ms) };
    if (ms < 60 * 1000) return { key: "AiHealth.duration_s", n: tenth(ms / 1000) };
    return { key: "AiHealth.duration_min", n: tenth(ms / 60000) };
};

export const costOf = (usd) => (Number(usd) || 0).toFixed(Number(usd) > 0 && Number(usd) < 0.01 ? 4 : 2);

export const isEmptyMetrics = (metrics) => !metrics || (!Number(metrics.totals?.runs) && !Number(metrics.totals?.calls));
