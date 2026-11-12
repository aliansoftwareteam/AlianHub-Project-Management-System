const crypto = require('crypto');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const logger = require('../../Config/loggerConfig');
const agentFetch = require('../Agents/engine/agentFetch');

const LOG = '[connectors]';
const CLIENT_INFO = Object.freeze({ name: 'AlianHub', version: '1.0.0' });
const TIMEOUT_MS = 15000;
const MAX_BYTES = 512 * 1024;
const LISTING_TTL_MS = 10 * 60 * 1000;
const MAX_PAGES = 10;
const NO_BODY = Object.freeze([101, 103, 204, 205, 304]);
const SHAPE = /^[a-f0-9]{64}$/;

const refusal = (code, message) => Object.assign(new Error(`${code}: ${message}`), { code, deterministic: true });

/* Sorted keys, so the same tool hashes the same whatever order its server writes the fields in. */
const stable = (value) => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
    return value;
};

/* What was reviewed is what a model is told about and what it can send: the name, the description and the input
 * schema. Hints and output schemas are left out, since AlianHub decides read or write itself. */
const shapeOf = (tool) => crypto.createHash('sha256')
    .update(JSON.stringify(stable({ name: String(tool.name || ''), description: String(tool.description || ''), inputSchema: tool.inputSchema || {} })))
    .digest('hex');

const headersObject = (headers) => {
    if (!headers) return {};
    if (typeof headers.forEach === 'function' && !Array.isArray(headers)) {
        const out = {};
        headers.forEach((value, name) => { out[name] = value; });
        return out;
    }
    return Array.isArray(headers) ? Object.fromEntries(headers) : { ...headers };
};

const responseHeaders = (headers) => {
    const out = new Headers();
    Object.entries(headers || {}).forEach(([name, value]) => {
        if (value !== undefined && value !== null) out.set(name, Array.isArray(value) ? value.join(', ') : String(value));
    });
    return out;
};

/* The fetch the MCP client is given. Every request leaves through the connector's egress path; the stream a client may
 * open with GET is answered "not offered" here, so one request is one answer and nothing stays open. */
const fetchFor = ({ hosts, token, timeoutMs, maxBytes, seen }) => async (input, init = {}) => {
    const url = typeof input === 'string' ? input : String(input.href || input.url);
    const method = String(init.method || 'get').toLowerCase();
    if (method === 'get') return new Response(null, { status: 405 });
    const res = await agentFetch.callMcp(url, { method, body: init.body, headers: headersObject(init.headers), token, hosts, timeoutMs, maxBytes });
    if (method === 'post') Object.assign(seen, { status: res.status, headers: res.headers || {} });
    return new Response(NO_BODY.includes(res.status) ? null : res.body, { status: res.status, headers: responseHeaders(res.headers) });
};

/* The status the server last answered travels with the error, so the caller can tell a rate limit or a dead token from
 * any other failure. */
const failed = (error, seen) => {
    if (error && error.deterministic) return error;
    if (seen.status >= 400) return Object.assign(new Error(`the MCP server answered ${seen.status}`), { code: 'mcp_http', status: seen.status, headers: seen.headers || {} });
    return Object.assign(new Error(`the MCP server could not be used (${(error && error.message) || 'no answer'})`), { code: 'mcp_failed' });
};

const withSession = async ({ url, hosts, token, timeoutMs = TIMEOUT_MS, maxBytes = MAX_BYTES }, work) => {
    const seen = {};
    const transport = new StreamableHTTPClientTransport(new URL(url), {
        fetch: fetchFor({ hosts, token, timeoutMs, maxBytes, seen }),
        reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
    });
    const client = new Client(CLIENT_INFO, { capabilities: {} });
    const options = { timeout: timeoutMs };
    try {
        await client.connect(transport, options);
        return await work(client, options);
    } catch (error) {
        throw failed(error, seen);
    } finally {
        await transport.terminateSession().catch(() => {});
        await client.close().catch(() => {});
    }
};

const listAll = async (client, options) => {
    const tools = [];
    let cursor;
    for (let page = 0; page < MAX_PAGES; page += 1) {
        const answer = await client.listTools(cursor ? { cursor } : {}, options);
        tools.push(...(answer.tools || []));
        if (!answer.nextCursor) break;
        cursor = answer.nextCursor;
    }
    return tools;
};

const listings = new Map();

const remember = (provider, tools, now) => {
    const shapes = new Map(tools.map((tool) => [String(tool.name), shapeOf(tool)]));
    listings.set(provider, { at: now, shapes });
    return shapes;
};

const fresh = (provider, now) => {
    const listing = listings.get(provider);
    return listing && now - listing.at < LISTING_TTL_MS ? listing.shapes : null;
};

/* Every tool the server offers, with the shape it has now: what an owner or admin reviews before turning one on. */
const listTools = (call, now = Date.now()) => withSession(call, async (client, options) => {
    const tools = await listAll(client, options);
    remember(call.provider, tools, now);
    return tools.map((tool) => ({ name: String(tool.name), description: String(tool.description || ''), inputSchema: tool.inputSchema || {}, shape: shapeOf(tool) }));
});

/* A tool is called only while the server still describes it as it was reviewed. The listing is kept a few minutes per
 * provider and read again when the tool is not in it, so a changed or withdrawn tool is caught before it is sent. */
const callTool = (call, now = Date.now()) => withSession(call, async (client, options) => {
    const { provider, name, args, shape } = call;
    if (!SHAPE.test(String(shape || ''))) throw refusal('tool_unreviewed', `${name} has not been reviewed, so it was not called.`);
    let shapes = fresh(provider, now);
    if (!shapes || !shapes.has(name)) shapes = remember(provider, await listAll(client, options), now);
    if (!shapes.has(name)) throw refusal('tool_missing', `The app no longer offers ${name}, so it was not called.`);
    if (shapes.get(name) !== shape) {
        logger.error(`${LOG} ${provider} tool ${name} changed since it was reviewed; it stays off until it is reviewed again`);
        throw Object.assign(refusal('tool_changed', `The app changed ${name} since it was reviewed, so it was not called. An owner or admin reviews it again first.`), { current: shapes.get(name) });
    }
    return client.callTool({ name, arguments: args || {} }, undefined, options);
});

/* A result as plain text for the model: text parts as they are, anything else named but not passed on. */
const textOf = (result) => (Array.isArray(result && result.content) ? result.content : []).map((part) => {
    if (!part || typeof part !== 'object') return '';
    if (part.type === 'text') return String(part.text || '');
    if (part.type === 'resource' && part.resource && typeof part.resource.text === 'string') return part.resource.text;
    if (part.type === 'resource_link') return `${String(part.name || '')} ${String(part.uri || '')}`.trim();
    return `[${String(part.type || 'content')} left out]`;
}).filter(Boolean).join('\n');

const forget = () => listings.clear();

module.exports = { shapeOf, listTools, callTool, textOf, forget, SHAPE, TIMEOUT_MS, MAX_BYTES };
