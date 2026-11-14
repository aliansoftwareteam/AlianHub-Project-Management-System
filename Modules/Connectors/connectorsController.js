const { tenantOf, TenantError } = require('../../Config/tenant');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const { ROLE_GUEST } = require('../../Config/roleTypes');
const store = require('../../Config/secrets');
const logger = require('../../Config/loggerConfig');
const { requestAddress } = require('../../utils/requestAddress');
const { buildCorsAllowList } = require('../../utils/cors');
const aiRights = require('../../Config/aiRights');
const registry = require('./registry');
const apps = require('./apps');
const connection = require('./connection');
const toolReviews = require('./toolReviews');

const refuse = (res, code, statusText, extra = {}) => res.status(code).send({ status: false, statusText, ...extra });

/* The tenant is the verified header and the person is the session, never a field of the request; a token holds no
 * personal connection, and a guest or a removed member has no seat to hold one with. */
const personOrRefuse = async (req, res) => {
    let companyId;
    try {
        companyId = tenantOf(req);
    } catch (error) {
        if (!(error instanceof TenantError)) throw error;
        refuse(res, error.statusCode, error.message);
        return null;
    }
    if (req.apiToken) { refuse(res, 403, 'An API token cannot hold or manage a personal connection.'); return null; }
    const role = await getRoleType(companyId, req.uid);
    if (role === null || role === undefined || role === ROLE_GUEST) { refuse(res, 403, 'Only a member of this workspace can connect an account.'); return null; }
    return { companyId, userId: String(req.uid), manager: isPrivileged(role), actor: { id: String(req.uid), ip: requestAddress(req) } };
};

/* Only the message of an error this module made itself is sent or logged; anything else is named by its type, so
 * a provider or transport error can never carry a credential into a response or a log line. */
const failed = (res, error, what) => {
    if (error instanceof connection.ConnectionError) return refuse(res, error.status, error.message, error.code ? { code: error.code } : {});
    if (error instanceof apps.AppError) return refuse(res, error.statusCode, error.message, error.code ? { code: error.code } : {});
    if (error instanceof store.SecretsStoreError) return refuse(res, error.statusCode, error.message);
    logger.error(`ERROR in ${what}: ${(error && error.name) || 'Error'}`);
    return refuse(res, 500, 'Something went wrong.');
};

const handle = (what, statusText, run) => async (req, res) => {
    try {
        const who = await personOrRefuse(req, res);
        if (!who) return undefined;
        const data = await run(who, req, res);
        return data === undefined ? undefined : res.send({ status: true, statusText, data });
    } catch (error) {
        return failed(res, error, what);
    }
};

/* Connecting or extending an account for AI is a row of Security & Permissions; seeing and ending one's own
 * connection is not. */
const connectsApps = (run) => async (who, req, res) => {
    if (await aiRights.mayUse(who.companyId, who.userId, aiRights.AI_RIGHT.CONNECTORS)) return run(who, req, res);
    refuse(res, 403, aiRights.REFUSAL[aiRights.AI_RIGHT.CONNECTORS]);
    return undefined;
};

/* A catalog id, or a workspace's custom server (`custom_<id>`), which the lifecycle then looks up in the caller's own
 * workspace only. */
const knownProvider = (provider) => Boolean(registry.get(provider)) || require('./customServers').isCustomId(provider);

const providerOf = (req, res) => {
    const provider = String((req.params || {}).provider || '');
    if (!knownProvider(provider)) { refuse(res, 404, 'This connector is not available.'); return ''; }
    return provider;
};

/* Where the browser returns after consent: the origin the request came from when the server already allows it,
 * and the configured web address otherwise. */
const originOf = (req) => {
    const value = String((req.headers || {}).origin || '').replace(/\/+$/, '');
    return /^https?:\/\//i.test(value) && buildCorsAllowList().has(value) ? value : connection.fallbackOrigin();
};

const productsOf = (body) => {
    const given = (body || {}).products;
    return Array.isArray(given) ? given.filter((p) => typeof p === 'string') : undefined;
};

exports.list = handle('list the connectors', 'Connectors fetched.', (who) => connection.list(who.companyId, who.userId));

exports.connect = handle('start a connection', 'Continue with the provider.', connectsApps((who, req, res) => {
    const provider = providerOf(req, res);
    return provider ? connection.start({
        companyId: who.companyId, userId: who.userId, sessionId: req.sessionId, provider, products: productsOf(req.body), origin: originOf(req),
    }) : undefined;
}));

exports.complete = handle('complete a connection', 'Connected.', connectsApps((who, req, res) => {
    const provider = providerOf(req, res);
    if (!provider) return undefined;
    const body = req.body || {};
    return connection.complete({ companyId: who.companyId, userId: who.userId, sessionId: req.sessionId, provider, state: body.state, code: body.code, actor: who.actor });
}));

exports.saveToken = handle('connect with a token', 'Connected.', connectsApps((who, req, res) => {
    const provider = providerOf(req, res);
    if (!provider) return undefined;
    return connection.saveToken({ companyId: who.companyId, userId: who.userId, sessionId: req.sessionId, provider, token: (req.body || {}).token, actor: who.actor });
}));

exports.setProducts = handle('change a connection\'s products', 'Products updated.', connectsApps(async (who, req, res) => {
    const connectionId = String((req.params || {}).id || '');
    const row = await connection.byId(who.companyId, connectionId);
    if (!row || String(row.userId) !== who.userId) { refuse(res, 404, 'There is no such connection.'); return undefined; }
    return connection.setProducts({
        companyId: who.companyId, userId: who.userId, sessionId: req.sessionId, provider: row.provider, connectionId, products: productsOf(req.body) || [], origin: originOf(req), actor: who.actor,
    });
}));

exports.disconnect = handle('end a connection', 'Disconnected.', async (who, req, res) => {
    const connectionId = String((req.params || {}).id || '');
    const row = await connection.byId(who.companyId, connectionId);
    const mine = row && String(row.userId) === who.userId;
    if (!row || (!mine && !who.manager)) { refuse(res, 404, 'There is no such connection.'); return undefined; }
    return connection.disconnect({
        companyId: who.companyId, userId: String(row.userId), provider: row.provider, connectionId, actor: who.actor, by: mine ? connection.BY.SELF : connection.BY.ADMIN,
    });
});

/* Public: a redirect from the provider carries no session. It exchanges nothing and stores no token; it sends the
 * browser back to the signed-in page, which completes the connection under its own session. */
exports.callback = async (req, res) => {
    const provider = String((req.params || {}).provider || '');
    let target;
    try {
        if (!knownProvider(provider)) throw new Error('unknown provider');
        const query = req.query || {};
        const error = query.error === undefined || query.error === '' ? '' : (typeof query.error === 'string' ? query.error : 'provider_error');
        target = await connection.returnFor({ provider, state: query.state, code: query.code, error });
    } catch (error) {
        logger.error(`ERROR in the connector callback: ${(error && error.name) || 'Error'}`);
        target = { origin: connection.fallbackOrigin(), path: '/', query: { connector: provider || 'connector', result: 'error', reason: 'failed' } };
    }
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    return res.redirect(302, `${target.origin}/#${target.path}?${new URLSearchParams(target.query)}`);
};

const managerOrRefuse = (run) => async (who, req, res) => {
    if (who.manager) return run(who, req, res);
    refuse(res, 403, 'Only an owner or admin can review the tools of a connected app.');
    return undefined;
};

const catalogToolsOf = (provider) => require('./tools').all().filter((tool) => tool.provider === provider);

/* Any member: what each tool of an app does and whether it is on here. Never the app's own words or input shapes. */
exports.memberTools = handle('list a connector\'s tools', 'Tools fetched.', (who, req, res) => {
    const provider = providerOf(req, res);
    if (!provider) return undefined;
    const { isOn } = require('./tools');
    return { tools: catalogToolsOf(provider).map((tool) => ({ key: tool.key, label: tool.label, kind: tool.kind, on: isOn(tool) })) };
});

/* Only the connection's owner turns its tools off for their own use. It can only narrow what the connection already
 * allows, so unlike the products it is not a row of Security & Permissions. */
exports.setToolsOff = handle('change a connection\'s tools', 'Tools updated.', async (who, req, res) => {
    const connectionId = String((req.params || {}).id || '');
    const row = await connection.byId(who.companyId, connectionId);
    if (!row || String(row.userId) !== who.userId) { refuse(res, 404, 'There is no such connection.'); return undefined; }
    const given = (req.body || {}).toolsOff;
    const keys = catalogToolsOf(row.provider).map((tool) => tool.key);
    if (!Array.isArray(given) || given.some((key) => !keys.includes(key))) {
        refuse(res, 400, 'Those are not tools of this connector.', { code: 'unknown_tool' });
        return undefined;
    }
    return connection.setToolsOff({ companyId: who.companyId, row, toolsOff: [...new Set(given)], actor: who.actor });
});

/* A custom server's tools are reviewed on its own routes (customController.js), so these take catalog ids only. */
const catalogProviderOf = (req, res) => {
    const provider = String((req.params || {}).provider || '');
    if (!registry.get(provider)) { refuse(res, 404, 'This connector is not available.'); return ''; }
    return provider;
};

/* Owner/admin: each tool of an MCP app, and whether the app changed it since it was reviewed. */
exports.tools = handle('list a connector\'s tools', 'Tools fetched.', managerOrRefuse(async (who, req, res) => {
    const provider = catalogProviderOf(req, res);
    return provider ? { tools: await toolReviews.listFor(who.companyId, registry.get(provider), catalogToolsOf(provider)) } : undefined;
}));

/* Owner/admin: approve a changed tool as the app describes it now, or keep it off. */
exports.reviewTool = handle('review a connector\'s tool', 'Tool reviewed.', managerOrRefuse(async (who, req, res) => {
    const provider = catalogProviderOf(req, res);
    if (!provider) return undefined;
    const tool = String((req.params || {}).tool || '');
    if (!catalogToolsOf(provider).some((t) => t.mcp && t.mcp.tool === tool)) { refuse(res, 404, 'This app has no such tool.'); return undefined; }
    const out = await toolReviews.review({ companyId: who.companyId, definition: registry.get(provider), tool, enabled: (req.body || {}).enabled === true, actor: who.actor });
    if (!out.ok) { refuse(res, 409, 'This tool has not changed since it was reviewed, so there is nothing to look at again.', { code: out.code }); return undefined; }
    return { tools: await toolReviews.listFor(who.companyId, registry.get(provider), catalogToolsOf(provider)) };
}));

/* Owner/admin: the connections members hold, without whose account or any handle. */
exports.members = async (req, res) => {
    try {
        const who = await personOrRefuse(req, res);
        if (!who) return undefined;
        if (!who.manager) { refuse(res, 403, 'Only an owner or admin can see other people\'s connections.'); return undefined; }
        return res.send({ status: true, statusText: 'Connections fetched.', data: { connections: await connection.membersWithConnections(who.companyId) } });
    } catch (error) {
        return failed(res, error, 'list the members\' connections');
    }
};
