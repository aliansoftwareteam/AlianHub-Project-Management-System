/* The MCP flags are on when unset. A spec written against the registry, the tool list or the records as they
 * were before those tools existed requires this first, so its baseline is the flags explicitly off. */
const FLAGS = Object.freeze(['MCP_TOOLS_DATA', 'MCP_TOOLS_MANAGE', 'MCP_TOOLS_WORK', 'MCP_OAUTH', 'AGENT_TAINT_ROUTING']);

FLAGS.forEach((key) => { process.env[key] = 'off'; });

module.exports = { FLAGS };
