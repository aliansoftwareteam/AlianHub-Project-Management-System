const apiTokens = require('../ApiTokens/controller');
const { hasScope } = require('../ApiTokens/helpers/apiTokenRules');
const { verifyCompanyMembership } = require('../../Config/jwt');
const { resolveActor } = require('../Agents/actor');
const { RefusedError } = require('../Agents/actions');
const registry = require('../Agents/registry');
const tools = require('./tools');
const scopes = require('./scopes');
const oauthAuth = require('./oauthAuth');
const mcpOAuth = require('../../Config/mcpOAuth');
const { TOKEN_PREFIX } = require('../ApiTokens/helpers/apiTokenRules');
const logger = require('../../Config/loggerConfig');

const PROTOCOL_VERSION = '2025-06-18';
const LATEST_PROTOCOL_VERSION = '2025-11-25';
const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze([LATEST_PROTOCOL_VERSION, PROTOCOL_VERSION]);
const buildInfo = require('../../Config/buildInfo');

const rpcError = (id, code, message, data) => ({
    jsonrpc: '2.0', id: id === undefined ? null : id,
    error: data === undefined ? { code, message } : { code, message, data },
});
const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const contentResult = (payload) => ({ content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] });

const ipOf = (req) => String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();

const NOT_A_MEMBER = 'You are no longer a member of this company';

const messagesOf = (body) => (Array.isArray(body) ? body : [body]);

const bearerOf = (req) => {
    const header = String(req.headers.authorization || '');
    return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
};

/* RFC 6750 §3.1: no error code when no credentials were sent, invalid_token when they were. */
const unauthorized = (req, res) => {
    if (!mcpOAuth.isOn()) {
        res.set('WWW-Authenticate', 'Bearer realm="alianhub-mcp"');
    } else {
        const needed = scopes.scopesFor(messagesOf(req.body));
        res.set('WWW-Authenticate', scopes.challenge({
            realm: 'alianhub-mcp',
            error: bearerOf(req) ? 'invalid_token' : '',
            resource_metadata: mcpOAuth.resourceMetadataUrl(),
            scope: (needed.length ? needed : scopes.DISCOVERY_SCOPES).join(' '),
        }));
    }
    return res.status(401).json(rpcError(null, -32001, 'A valid bearer token and companyId are required.'));
};

const QUERY_TOKEN_KEYS = ['access_token', 'token', 'bearer'];

const hasQueryToken = (req) => Object.entries(req.query || {}).some(([key, value]) =>
    QUERY_TOKEN_KEYS.includes(String(key).toLowerCase())
    || [].concat(value).some((v) => String(v).startsWith(TOKEN_PREFIX) || oauthAuth.looksLikeOAuthSecret(v)));

/* MCP 2025-11-25 "Access Token Usage": tokens never travel in the URI, where
 * proxies and access logs keep them. Refused before any lookup. */
const queryTokenRefused = (res) => {
    res.set('WWW-Authenticate', scopes.challenge({
        error: 'invalid_request',
        error_description: 'Send the access token in the Authorization header, not the query string.',
        resource_metadata: mcpOAuth.resourceMetadataUrl(),
    }));
    return res.status(400).json(rpcError(null, -32600, 'Access tokens are accepted only in the Authorization header.'));
};

/* MCP 2025-11-25 "Scope Challenge Handling": the scope parameter carries what the
 * token holds plus what it lacks, so stepping up does not drop a granted scope. */
const insufficientScope = (res, ctx, body, missing) => {
    const granted = scopes.grantedScopes(ctx.token);
    const wanted = mcpOAuth.SCOPES.filter((scope) => granted.includes(scope) || missing.includes(scope));
    const message = `This call needs the ${missing.join(' ')} scope${missing.length > 1 ? 's' : ''}.`;
    res.set('WWW-Authenticate', scopes.challenge({
        error: 'insufficient_scope',
        scope: wanted.join(' '),
        resource_metadata: mcpOAuth.resourceMetadataUrl(),
        error_description: message,
    }));
    const id = Array.isArray(body) ? null : body && body.id;
    return res.status(403).json(rpcError(id, -32004, message, { error: 'insufficient_scope', requiredScopes: missing, scope: wanted.join(' ') }));
};

const forbidden = (res) => res.status(403).json({
    ...rpcError(null, -32003, NOT_A_MEMBER), status: false, error: NOT_A_MEMBER, statusText: 'Forbidden',
});

const WRONG_WORKSPACE = 'This token is bound to another workspace than the companyId the request names.';

const wrongWorkspace = (res) => res.status(403).json(rpcError(null, -32003, WRONG_WORKSPACE));

/* MCP 2025-11-25 "Protocol Version Header": a version the server does not support is a 400. Absent,
 * the client predates the header and negotiated through initialize. */
const unsupportedVersion = (req) => {
    const version = req.headers['mcp-protocol-version'];
    if (version === undefined || SUPPORTED_PROTOCOL_VERSIONS.includes(String(version))) return '';
    return String(version).slice(0, 40);
};

const versionRefused = (res, version) => res.status(400).json(rpcError(null, -32600,
    `Unsupported MCP-Protocol-Version "${version}"; this server speaks ${SUPPORTED_PROTOCOL_VERSIONS.join(', ')}.`));

const refusedAtTheDoor = (req, res) => {
    if (!mcpOAuth.isOn()) return false;
    if (hasQueryToken(req)) { queryTokenRefused(res); return true; }
    const version = unsupportedVersion(req);
    if (version) { versionRefused(res, version); return true; }
    return false;
};

const refusedCaller = (req, res, ctx) => {
    if (!ctx) { unauthorized(req, res); return true; }
    if (ctx.forbidden) { forbidden(res); return true; }
    if (ctx.wrongWorkspace) { wrongWorkspace(res); return true; }
    return false;
};

const logActivity = (ctx, statusCode) => {
    const entry = { method: 'POST', path: '/mcp', statusCode, durationMs: 0, ip: ctx.ip };
    if (ctx.oauth) {
        apiTokens.logTokenActivity(ctx.companyId, null, { ...entry, clientId: ctx.oauth.clientId, grantId: ctx.oauth.grantId, userId: ctx.userId });
        return;
    }
    apiTokens.logTokenActivity(ctx.companyId, ctx.token._id, entry);
};

/* Only the Authorization header counts: a session cookie or an Mcp-Session-Id
 * is never authorization (MCP 2025-11-25, "Session Hijacking"). Membership is
 * checked on every call, so a removed member is cut off on the next request,
 * not when the token expires. */
const namedCompanies = (req) => [req.query.companyId, req.headers.companyid].filter(Boolean).map(String);

const authenticate = async (req) => {
    const raw = bearerOf(req);
    const mode = mcpOAuth.mode();
    if (raw && mode !== mcpOAuth.MODE.OFF && oauthAuth.isAccessToken(raw)) {
        const ctx = await oauthAuth.authenticate(req, raw, { namedCompanies: namedCompanies(req) });
        return ctx && !ctx.forbidden && !ctx.wrongWorkspace ? { ...ctx, ip: ipOf(req) } : ctx;
    }
    if (mode === mcpOAuth.MODE.ONLY) return null;
    const companyId = namedCompanies(req)[0] || '';
    if (!raw || !companyId) return null;

    const token = await apiTokens.verifyToken(companyId, raw);
    if (!token) return null;
    if (!(await verifyCompanyMembership(String(token.userId || ''), companyId))) return { forbidden: true };

    req.apiToken = token;
    req.uid = String(token.userId || '');
    req.mcp = true;
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

/* MCP lifecycle: answer with the requested version when supported, otherwise the latest supported. */
const negotiatedVersion = (requested) => {
    if (!mcpOAuth.isOn()) return PROTOCOL_VERSION;
    return SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL_VERSION;
};

const handleRpc = async (ctx, message) => {
    const { id, method, params = {} } = message || {};

    switch (method) {
        case 'initialize':
            return rpcResult(id, {
                protocolVersion: negotiatedVersion(params.protocolVersion),
                capabilities: { tools: { listChanged: false } },
                serverInfo: { name: 'alianhub', version: buildInfo.get().version },
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
                if (error && (error.code === -32601 || error.code === -32602)) return rpcError(id, error.code, error.message);
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
        const oauth = mcpOAuth.isOn();
        if (refusedAtTheDoor(req, res)) return undefined;
        const ctx = await authenticate(req);
        if (refusedCaller(req, res, ctx)) return undefined;

        const body = req.body;
        const batch = Array.isArray(body);
        const messages = messagesOf(body);

        const missing = oauth ? scopes.missingScopes(ctx.token, messages) : [];
        if (missing.length) {
            logActivity(ctx, 403);
            return insufficientScope(res, ctx, body, missing);
        }

        const replies = [];
        for (const message of messages) {
            const reply = await handleRpc(ctx, message);
            if (reply) replies.push(reply);
        }

        logActivity(ctx, 200);

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
    if (refusedAtTheDoor(req, res)) return undefined;
    const ctx = await authenticate(req);
    if (refusedCaller(req, res, ctx)) return undefined;
    return res.status(405).json(rpcError(null, -32000, 'This server replies on POST; no SSE stream is offered.'));
};

module.exports = { post, get, authenticate, handleRpc, PROTOCOL_VERSION, LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS };
