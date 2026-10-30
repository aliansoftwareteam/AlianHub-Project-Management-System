const registry = require('../Agents/registry');
const connectorTools = require('../Connectors/tools');
const runner = require('../Connectors/toolRunner');

const READ_SCOPE = 'connectors:read';
const CONNECTION_ID = Object.freeze({ type: 'string', maxLength: 64, description: 'Leave out: your own connection is used. Kept for when a person can connect more than one account.' });

/* A refusal is the answer, so the client can tell the person what to do; anything else fails the call. */
const answered = (run) => async (...args) => {
    try {
        return await run(...args);
    } catch (error) {
        if (error && error.deterministic) return { error: String(error.message).replace(/^[a-z_]+: /, ''), code: error.code };
        throw error;
    }
};

const toolOf = (tool) => Object.freeze({
    name: tool.key,
    action: tool.key,
    description: `${tool.input.description} It reads only your own ${tool.definition.name} connection, as text.`,
    input: { ...tool.input, properties: { ...tool.input.properties, connectionId: CONNECTION_ID } },
    strict: true,
    optIn: READ_SCOPE,
    visibility: 'none',
    visibilityReason: 'reads the caller\'s own account at another app, never anything in this workspace',
    readParams: () => ({}),
    run: answered((ctx, args) => runner.read({ companyId: ctx.companyId, userId: ctx.userId, via: runner.VIA.MCP, key: tool.key, input: args })),
});

const TOOLS = Object.freeze(connectorTools.reads().map(toolOf));
const SCOPES = Object.freeze(Object.fromEntries(TOOLS.map((tool) => [tool.name, READ_SCOPE])));

const offered = () => TOOLS.filter((tool) => registry.has(tool.action));

module.exports = { TOOLS, SCOPES, READ_SCOPE, offered };
