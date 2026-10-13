// Off by default, and read on every call like the other feature flags: off, the
// registry, the ratings and the MCP tool list are exactly what they were before.
const ACTION = 'performance.read';

const enabled = () => ['on', 'true', '1'].includes(String(process.env.AGENT_PERFORMANCE_READ || 'off').trim().toLowerCase());

module.exports = { ACTION, enabled };
