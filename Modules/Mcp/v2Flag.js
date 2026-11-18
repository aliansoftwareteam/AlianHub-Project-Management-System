// Read on every call like the other feature flags: off, the MCP tool list and
// every result keep the shapes they had before names, cursors and annotations.
const enabled = () => ['on', 'true', '1'].includes(String(process.env.MCP_TOOLS_V2 || 'off').trim().toLowerCase());

module.exports = { enabled };
