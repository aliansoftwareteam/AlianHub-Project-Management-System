import dailyRunLimit from "@agentDailyRunLimit";
import { sameValue } from "./revisionDiff";

/* The form fills fields the agent never set with display defaults (a missing
 * rate limit reads as the server's default), so a save must not send what the user left alone:
 * the server would store the default and the revision would name the field. */
export const formFromAgent = (agent) => ({
    autonomy: Number(agent.autonomy ?? 1),
    rateLimitPerDay: dailyRunLimit.dailyRunLimitOf(agent),
    spendCapUsd: Number(agent.spendCapUsd || 30),
    model: agent.model || "",
    projectIds: (agent.projectIds || []).map(String),
});

export const skillsPayload = (skills, namedKeys) => skills
    .filter((s) => s.enabled || namedKeys.has(s.key))
    .map((s) => ({ key: s.key, name: s.name, enabled: s.enabled }));

export const changedFields = (baseline, current) => Object.keys(current)
    .filter((key) => !sameValue(baseline[key], current[key]))
    .reduce((patch, key) => ({ ...patch, [key]: current[key] }), {});
