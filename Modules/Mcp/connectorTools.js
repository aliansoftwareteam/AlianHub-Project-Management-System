const registry = require('../Agents/registry');
const connectorTools = require('../Connectors/tools');
const runner = require('../Connectors/toolRunner');

const READ_SCOPE = 'connectors:read';
const WRITE_SCOPE = 'connectors:write';
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

const withConnectionId = (tool) => ({ ...tool.input, properties: { ...tool.input.properties, connectionId: CONNECTION_ID } });

const readOf = (tool) => Object.freeze({
    name: tool.key,
    action: tool.key,
    description: `${tool.input.description} It reads only your own ${tool.definition.name} connection, as text.`,
    input: withConnectionId(tool),
    strict: true,
    optIn: READ_SCOPE,
    visibility: 'none',
    visibilityReason: 'reads the caller\'s own account at another app, never anything in this workspace',
    readParams: () => ({}),
    run: answered((ctx, args) => runner.read({ companyId: ctx.companyId, userId: ctx.userId, via: runner.VIA.MCP, key: tool.key, input: args })),
});

/* No write is made or approved inside the AI client: the call is filed as a proposal that waits in the person's Inbox. */
const writeOf = (tool) => Object.freeze({
    name: tool.key,
    action: tool.key,
    description: `${tool.input.description} Nothing is sent from here: it waits in your AlianHub Inbox until you approve exactly what goes out to ${tool.definition.name}.`,
    input: withConnectionId(tool),
    strict: true,
    optIn: WRITE_SCOPE,
    alwaysProposed: true,
    pendingMessage: `Nothing was sent to ${tool.definition.name}. It waits in your AlianHub Inbox as the proposal named here; only you can approve it there, and it is sent once, exactly as you approve it.`,
    filing: answered((file) => file()),
    visibility: 'none',
    visibilityReason: 'writes to the caller\'s own account at another app, never to anything in this workspace',
    params: (args) => ({ ...args }),
});

const TOOLS = Object.freeze([...connectorTools.reads().map(readOf), ...connectorTools.writes().map(writeOf)]);
const SCOPES = Object.freeze(Object.fromEntries(TOOLS.map((tool) => [tool.name, tool.alwaysProposed ? WRITE_SCOPE : READ_SCOPE])));

const offered = () => TOOLS.filter((tool) => registry.has(tool.action));

module.exports = { TOOLS, SCOPES, READ_SCOPE, WRITE_SCOPE, offered };
