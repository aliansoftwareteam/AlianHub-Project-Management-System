const { startHarness } = require('../../e2e/support/harness');

/* The MCP surface and taint routing default on; the shared server keeps them off so the files that compare
 * against "as before" have an off server, and each file that needs them on starts its own. */
const FLAGS_OFF = {
    MCP_TOOLS_DATA: 'off',
    MCP_TOOLS_MANAGE: 'off',
    MCP_TOOLS_WORK: 'off',
    MCP_OAUTH: 'off',
    AGENT_TAINT_ROUTING: 'off',
};

module.exports = async () => {
    globalThis.__E2E_HARNESS__ = await startHarness({ name: 'integration', env: FLAGS_OFF });
};
