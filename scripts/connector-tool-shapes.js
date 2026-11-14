#!/usr/bin/env node
/* For whoever maintains the connector catalog: lists an MCP app's tools as its server describes them now, with the
 * shape AlianHub compares calls against, next to what the provider's tools.js pins. Read the descriptions before
 * pinning a shape: pinning one is the review. Nothing is written.
 *
 *   CONNECTOR_REVIEW_TOKEN=<an access token of a test account> node scripts/connector-tool-shapes.js <provider>
 */
const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { shapeOf } = require('../Modules/Connectors/mcpClient');

const provider = String(process.argv[2] || '');
const token = String(process.env.CONNECTOR_REVIEW_TOKEN || '');
const folder = path.join(__dirname, '..', 'Modules', 'Connectors', 'providers', provider);

const fail = (message) => { console.error(message); process.exit(1); };

(async () => {
    if (!/^[a-z][a-z0-9_]*$/.test(provider)) fail('Name a provider folder, e.g. notion.');
    if (!token) fail('Set CONNECTOR_REVIEW_TOKEN to an access token of a test account.');
    const definition = require(path.join(folder, 'index.js'));
    if (definition.transport !== 'mcp') fail(`${provider} is not reached through MCP.`);
    let pinned = [];
    try { pinned = require(path.join(folder, 'tools.js')).filter((tool) => tool.mcp); } catch (e) { pinned = []; }

    const transport = new StreamableHTTPClientTransport(new URL(definition.mcp.url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
    const client = new Client({ name: 'AlianHub catalog review', version: '1.0.0' }, { capabilities: {} });
    await client.connect(transport);
    const tools = [];
    let cursor;
    do {
        // eslint-disable-next-line no-await-in-loop
        const page = await client.listTools(cursor ? { cursor } : {});
        tools.push(...page.tools);
        cursor = page.nextCursor;
    } while (cursor);
    await transport.terminateSession().catch(() => {});
    await client.close();

    const live = new Map(tools.map((tool) => [tool.name, tool]));
    tools.forEach((tool) => {
        const mapped = pinned.find((p) => p.mcp.tool === tool.name);
        const shape = shapeOf(tool);
        const status = !mapped ? 'not in the catalog' : (mapped.mcp.shape === shape ? 'pinned, unchanged' : (mapped.mcp.shape ? 'CHANGED since pinned' : 'in the catalog, not reviewed'));
        console.log(`\n${tool.name}  [${status}]${mapped ? `  -> ${mapped.key} (${mapped.kind})` : ''}`);
        console.log(`  shape: '${shape}'`);
        console.log(`  description: ${String(tool.description || '').replace(/\s+/g, ' ').slice(0, 400)}`);
        console.log(`  input: ${JSON.stringify(tool.inputSchema || {}).slice(0, 400)}`);
    });
    pinned.filter((p) => !live.has(p.mcp.tool)).forEach((p) => console.log(`\n${p.mcp.tool}  [the server no longer offers it]  -> ${p.key}`));
})().catch((error) => fail(`Could not list the tools: ${error.message}`));
