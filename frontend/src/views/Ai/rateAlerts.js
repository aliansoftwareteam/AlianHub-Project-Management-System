export const ALERT_TYPES = Object.freeze(["agent_error_rate", "approval_rate_falling", "cost_forecast", "queue_age"]);

export const ALERT_DEFAULTS = Object.freeze({
    enabled: true,
    errorRatePct: 20,
    errorMinRuns: 5,
    approvalFloorPct: 50,
    approvalDropPts: 20,
    costForecastPct: 110,
    queueAgeMinutes: 15
});

export const THRESHOLD_FIELDS = Object.freeze([
    { key: "errorRatePct", type: "agent_error_rate", min: 1, max: 100, integer: false, label: "AiAlerts.field_error_rate", help: "AiAlerts.field_error_rate_help" },
    { key: "errorMinRuns", type: "agent_error_rate", min: 1, max: 1000, integer: true, label: "AiAlerts.field_error_min_runs", help: "AiAlerts.field_error_min_runs_help" },
    { key: "approvalFloorPct", type: "approval_rate_falling", min: 0, max: 100, integer: false, label: "AiAlerts.field_approval_floor", help: "AiAlerts.field_approval_floor_help" },
    { key: "approvalDropPts", type: "approval_rate_falling", min: 1, max: 100, integer: false, label: "AiAlerts.field_approval_drop", help: "AiAlerts.field_approval_drop_help" },
    { key: "costForecastPct", type: "cost_forecast", min: 1, max: 1000, integer: false, label: "AiAlerts.field_cost_forecast", help: "AiAlerts.field_cost_forecast_help" },
    { key: "queueAgeMinutes", type: "queue_age", min: 1, max: 1440, integer: true, label: "AiAlerts.field_queue_age", help: "AiAlerts.field_queue_age_help" }
]);

const fieldOf = (key) => THRESHOLD_FIELDS.find((f) => f.key === key);

const inRange = (field, n) => typeof n === "number" && Number.isFinite(n) && n >= field.min && n <= field.max && (!field.integer || Number.isInteger(n));

export const alertSettingsOf = (stored) => {
    const s = stored && typeof stored === "object" ? stored : {};
    const out = { enabled: typeof s.enabled === "boolean" ? s.enabled : ALERT_DEFAULTS.enabled };
    THRESHOLD_FIELDS.forEach((field) => {
        out[field.key] = inRange(field, Number(s[field.key])) && s[field.key] !== null && s[field.key] !== "" ? Number(s[field.key]) : ALERT_DEFAULTS[field.key];
    });
    return out;
};

export const thresholdErrors = (draft) => Object.fromEntries(THRESHOLD_FIELDS
    .filter((field) => !inRange(field, draft?.[field.key]))
    .map((field) => [field.key, { key: field.integer ? "AiAlerts.error_whole_range" : "AiAlerts.error_range", params: { min: field.min, max: field.max } }]));

export const changedSettings = (draft, baseline) => Object.fromEntries(["enabled", ...THRESHOLD_FIELDS.map((f) => f.key)]
    .filter((key) => draft?.[key] !== baseline?.[key])
    .map((key) => [key, draft[key]]));

export const explanationOf = (type, settings) => {
    const s = alertSettingsOf(settings);
    const params = {
        agent_error_rate: { pct: s.errorRatePct, runs: s.errorMinRuns },
        approval_rate_falling: { floor: s.approvalFloorPct, drop: s.approvalDropPts },
        cost_forecast: { pct: s.costForecastPct },
        queue_age: { minutes: s.queueAgeMinutes }
    }[type];
    return { key: `AiAlerts.explain_${type}`, params };
};

export const ALERT_FORMS = Object.freeze({
    agent_error_rate: "diamond",
    approval_rate_falling: "triangle",
    cost_forecast: "square",
    queue_age: "circle"
});

export const incidentTextOf = (incident) => ({
    key: `AiAlerts.incident_${incident?.type}`,
    params: {
        agent: incident?.agentName || "",
        value: incident?.lastValue ?? "",
        threshold: incident?.threshold ?? ""
    }
});

export const noticeTextOf = (changeData) => {
    const type = ALERT_TYPES.includes(changeData?.alertType) ? changeData.alertType : null;
    if (!type) return null;
    const state = changeData.state === "resolved" ? "resolved" : "open";
    return { key: `AiAlerts.notice_${state}_${type}`, params: { agent: changeData.agentName || "", value: changeData.lastValue ?? "", threshold: changeData.threshold ?? "" } };
};

export const isKnownField = (key) => Boolean(fieldOf(key));
