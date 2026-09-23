// The one copy of an agent's daily run limit rule, read by runs.canStart and, through
// the `@agentDailyRunLimit` alias, by the agent settings page, so the number the page
// shows is the number the server enforces. Dependency-free so it can be bundled.
//
// A stored 0 is the explicit choice of no daily limit; only a limit that was never
// stored falls back to the default.

const DEFAULT_RATE_LIMIT_PER_DAY = 40;

const isStored = (value) => value !== undefined && value !== null && value !== '';

const dailyRunLimitOf = (agent) => {
    const stored = agent ? agent.rateLimitPerDay : undefined;
    if (!isStored(stored)) return DEFAULT_RATE_LIMIT_PER_DAY;
    return Math.max(0, Number(stored) || 0);
};

module.exports = { DEFAULT_RATE_LIMIT_PER_DAY, dailyRunLimitOf };
