const apiTokens = require('../ApiTokens/controller');
const { hasScope } = require('../ApiTokens/helpers/apiTokenRules');
const { resolveActor } = require('../Agents/actor');
const { RefusedError } = require('../Agents/actions');
const registry = require('../Agents/registry');
const tools = require('./tools');
const logger = require('../../Config/loggerConfig');

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'alianhub', version: require('../../package.json').version };

const rpcError = (id, code, message, data) => ({
    jsonrpc: '2.0', id: id === undefined ? null : id,
    error: data === undefined ? { code, message } : { code, message, data },
});
const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const contentResult = (payload) => ({ content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] });

const ipOf = (req) => String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();

/* Authenticate the bearer PAT and build the calling context. The token narrows
 * the user's own permissions — it never widens them. */
const authenticate = async (req) => {
    const header = String(req.headers.authorization || '');
    const raw = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const companyId = String(req.query.companyId || req.headers.companyid || '');
    if (!raw || !companyId) return null;

    const token = await apiTokens.verifyToken(companyId, raw);
    if (!token) return null;

    req.apiToken = token;
    req.uid = String(token.userId || '');
    const actor = await resolveActor(req);
    return {
        companyId,
        userId: String(token.userId || ''),
        actor,
        token,
        canWrite: hasScope(token, 'write'),
        projectIds: Array.isArray(token.projectIds) ? token.projectIds.map(String) : [],
        allowedActions: Array.isArray(token.allowedActions) && token.allowedActions.length ? token.allowedActions.map(String) : undefined,
        ip: ipOf(req),
    };
};

const handleRpc = async (ctx, message) => {
    const { id, method, params = {} } = message || {};

    switch (method) {
        case 'initialize':
            return rpcResult(id, {
                protocolVersion: PROTOCOL_VERSION,
                capabilities: { tools: { listChanged: false } },
                serverInfo: SERVER_INFO,
                instructions: [
                    'Start with tasks.next, then task.get for the brief before writing code.',
                    'Report findings with task.comment and attach the PR with task.link.',
                    'You may set status to In progress or In review. A person closes the task.',
                ].join(' '),
            });

        case 'notifications/initialized':
        case 'notifications/cancelled':
            return null;

        case 'ping':
            return rpcResult(id, {});

        case 'tools/list':
            return rpcResult(id, { tools: tools.manifest() });

        case 'resources/list':
            return rpcResult(id, { resources: [] });

        case 'prompts/list':
            return rpcResult(id, { prompts: [] });

        case 'tools/call': {
            const name = String(params.name || '');
            try {
                const out = await tools.call(ctx, name, params.arguments || {});
                return rpcResult(id, contentResult(out));
            } catch (error) {
                if (error instanceof RefusedError) {
                    return rpcResult(id, {
                        ...contentResult({
                            refused: true,
                            action: name,
                            reason: error.message,
                            auditId: error.auditId || null,
                            neverAvailable: registry.NEVER,
                        }),
                        isError: true,
                    });
                }
                if (error && error.code === -32601) return rpcError(id, -32601, error.message);
                logger.error(`mcp tools/call ${name}: ${error.message}`);
                return rpcResult(id, { ...contentResult({ error: error.message }), isError: true });
            }
        }

        default:
            return rpcError(id, -32601, `Method not found: ${method}`);
    }
};

/* POST /mcp — Streamable HTTP transport: one JSON-RPC message (or a batch) per
 * request, answered with JSON. Notifications get 202 and no body. */
const post = async (req, res) => {
    try {
        const ctx = await authenticate(req);
        if (!ctx) {
            res.set('WWW-Authenticate', 'Bearer realm="alianhub-mcp"');
            return res.status(401).json(rpcError(null, -32001, 'A valid bearer token and companyId are required.'));
        }

        const body = req.body;
        const batch = Array.isArray(body);
        const messages = batch ? body : [body];
        const replies = [];
        for (const message of messages) {
            const reply = await handleRpc(ctx, message);
            if (reply) replies.push(reply);
        }

        apiTokens.logTokenActivity(ctx.companyId, ctx.token._id, {
            method: 'POST', path: '/mcp', statusCode: 200, durationMs: 0, ip: ctx.ip,
        });

        if (!replies.length) return res.status(202).end();
        return res.json(batch ? replies : replies[0]);
    } catch (error) {
        logger.error(`mcp post: ${error.message}`);
        return res.status(500).json(rpcError(null, -32603, error.message));
    }
};

/* GET /mcp — clients probe this for a server-sent stream. This server answers
 * every request in the POST response, so there is no stream to open. */
const get = async (req, res) => {
    const ctx = await authenticate(req);
    if (!ctx) {
        res.set('WWW-Authenticate', 'Bearer realm="alianhub-mcp"');
        return res.status(401).json(rpcError(null, -32001, 'A valid bearer token and companyId are required.'));
    }
    return res.status(405).json(rpcError(null, -32000, 'This server replies on POST; no SSE stream is offered.'));
};

module.exports = { post, get, authenticate, handleRpc, PROTOCOL_VERSION };
