/* An MCP app's tool is data: its AlianHub key, label, read or write, input and caps as any tool has, plus the server's
 * tool it calls and the shape that tool had when it was reviewed. `shape: null` is a tool nobody has reviewed yet,
 * which is never offered. `args` reshapes AlianHub's input into the server's arguments when they differ. */
const mcpTool = ({ tool, shape = null, args = (input) => input, ...definition }) => Object.freeze({
    ...definition,
    mcp: Object.freeze({ tool, shape }),
    run: async ({ input, connection }) => connection.mcp(tool, args(input)),
});

module.exports = { mcpTool };
