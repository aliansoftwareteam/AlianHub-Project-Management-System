// Read on every call like the other feature flags: off, the MCP prompt list is what it was before the roles,
// and a role cannot be downloaded as a skill.
const enabled = () => ['on', 'true', '1'].includes(String(process.env.MCP_ROLE_PROMPTS || 'off').trim().toLowerCase());

module.exports = { enabled };
