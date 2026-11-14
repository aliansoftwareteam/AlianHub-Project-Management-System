/* A stand-in for an app's remote MCP server behind safeFetch: it speaks JSON-RPC over POST, answers as JSON or as an
 * event stream, and records every request so a test can see what was sent and with which token. Nothing here is a
 * real server, token or account. */

const { shapeOf } = require('../../Modules/Connectors/mcpClient');

const HOST = 'mcp.notes.test';
const URL_OF = `https://${HOST}/mcp`;

const TOOLS = Object.freeze({
    search_notes: {
        name: 'search_notes',
        description: 'Search the notes of the signed-in person.',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
    archive_notes: {
        name: 'archive_notes',
        description: 'Archive every note older than a date.',
        inputSchema: { type: 'object', properties: { before: { type: 'string' } } },
    },
    create_note: {
        name: 'create_note',
        description: 'Create a note for the signed-in person.',
        inputSchema: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } }, required: ['title', 'body'] },
    },
});

const headerOf = (headers, name) => {
    const found = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name);
    return found ? String(found[1]) : '';
};

const create = () => {
    const server = {
        requests: [],
        calls: [],
        tools: JSON.parse(JSON.stringify(TOOLS)),
        stream: false,
        failures: new Map(),
        answers: {
            search_notes: ({ query }) => ({ content: [{ type: 'text', text: `Found 2 notes for ${query}: Board meeting; Call the bank` }] }),
            create_note: ({ title }) => ({ content: [{ type: 'text', text: `Saved ${title}` }] }),
        },
    };

    /* The next request for this JSON-RPC method gets this HTTP answer instead. */
    server.failOn = (method, status, headers = {}) => server.failures.set(method, { status, headers });

    const answer = (message, result) => {
        const payload = JSON.stringify({ jsonrpc: '2.0', id: message.id, ...result });
        return server.stream
            ? { status: 200, headers: { 'content-type': 'text/event-stream', 'mcp-session-id': 'session-1' }, body: `event: message\ndata: ${payload}\n\n` }
            : { status: 200, headers: { 'content-type': 'application/json', 'mcp-session-id': 'session-1' }, body: payload };
    };

    server.handle = async (url, opts = {}) => {
        const target = new URL(url);
        if (target.hostname !== HOST) return { status: 404, headers: {}, body: '' };
        const method = String(opts.method || 'get').toLowerCase();
        const message = method === 'post' ? JSON.parse(opts.data) : null;
        server.requests.push({ method, rpc: message && message.method, authorization: headerOf(opts.headers, 'authorization'), headers: opts.headers });
        if (method !== 'post') return { status: method === 'delete' ? 200 : 405, headers: {}, body: '' };

        const failure = server.failures.get(message.method);
        if (failure) {
            server.failures.delete(message.method);
            return { status: failure.status, headers: failure.headers, body: '' };
        }
        if (message.id === undefined) return { status: 202, headers: {}, body: '' };
        if (message.method === 'initialize') {
            return answer(message, { result: { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'notes', version: '1.0.0' } } });
        }
        if (message.method === 'tools/list') return answer(message, { result: { tools: Object.values(server.tools) } });
        if (message.method === 'tools/call') {
            const { name, arguments: args } = message.params;
            server.calls.push({ name, args, authorization: headerOf(opts.headers, 'authorization') });
            const run = server.answers[name];
            return answer(message, { result: run ? run(args || {}) : { content: [{ type: 'text', text: 'done' }] } });
        }
        return answer(message, { error: { code: -32601, message: 'Method not found' } });
    };

    return server;
};

const shapeOfTool = (name) => shapeOf(TOOLS[name]);

module.exports = { create, shapeOfTool, HOST, URL: URL_OF, TOOLS };
