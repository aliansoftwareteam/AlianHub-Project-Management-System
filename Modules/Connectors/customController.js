const { tenantOf, TenantError } = require('../../Config/tenant');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const { ROLE_GUEST } = require('../../Config/roleTypes');
const store = require('../../Config/secrets');
const logger = require('../../Config/loggerConfig');
const aiRights = require('../../Config/aiRights');
const { requestAddress } = require('../../utils/requestAddress');
const customFlag = require('./customFlag');
const custom = require('./customServers');
const customReview = require('./customReview');
const connection = require('./connection');
const apps = require('./apps');
const callbacks = require('./callbacks');

/* The routes of a workspace's custom servers (task 096). Any member sees the servers and their own connection to
 * each; adding one takes "Add custom apps"; changing, removing and reviewing one takes an owner or admin, or the
 * person who added it while they still hold that right (FR-52, FR-54). */

const refuse = (res, code, statusText, extra = {}) => res.status(code).send({ status: false, statusText, ...extra });

const KNOWN_ERRORS = ['ServerError', 'ReviewError'];

/* Only an error this module or the lifecycle made is sent; anything else is named by its type in the log, so a
 * server's answer or a credential never reaches a response or a log line. */
const failed = (res, error, what) => {
    if (error && KNOWN_ERRORS.includes(error.name)) return refuse(res, error.status, error.message, { code: error.code });
    if (error instanceof connection.ConnectionError) return refuse(res, error.status, error.message, error.code ? { code: error.code } : {});
    if (error instanceof apps.AppError) return refuse(res, error.statusCode, error.message, error.code ? { code: error.code } : {});
    if (error instanceof store.SecretsStoreError) return refuse(res, error.statusCode, error.message);
    logger.error(`ERROR in ${what}: ${(error && error.name) || 'Error'}`);
    return refuse(res, 500, 'Something went wrong.');
};

const personOrRefuse = async (req, res) => {
    let companyId;
    try {
        companyId = tenantOf(req);
    } catch (error) {
        if (!(error instanceof TenantError)) throw error;
        refuse(res, error.statusCode, error.message);
        return null;
    }
    if (req.apiToken) { refuse(res, 403, 'An API token cannot manage custom apps.'); return null; }
    const role = await getRoleType(companyId, req.uid);
    if (role === null || role === undefined || role === ROLE_GUEST) { refuse(res, 403, 'Only a member of this workspace can use custom apps.'); return null; }
    const userId = String(req.uid);
    return {
        companyId, userId, manager: isPrivileged(role), actor: { id: userId, ip: requestAddress(req) },
        addsApps: await aiRights.mayUse(companyId, userId, aiRights.AI_RIGHT.CUSTOM_APPS),
    };
};

const handle = (what, statusText, run) => async (req, res) => {
    try {
        if (!customFlag.on()) return refuse(res, 404, 'Custom apps are switched off on this server.', { code: 'custom_off' });
        const who = await personOrRefuse(req, res);
        if (!who) return undefined;
        const data = await run(who, req, res);
        return data === undefined ? undefined : res.send({ status: true, statusText, data });
    } catch (error) {
        return failed(res, error, what);
    }
};

const mayManage = (who, row) => who.manager || (who.addsApps && String(row.addedBy) === who.userId);

const managedOrRefuse = (run) => async (who, req, res) => {
    const row = await custom.findRow(who.companyId, String((req.params || {}).id || ''));
    if (!row) { refuse(res, 404, 'There is no such custom app here.'); return undefined; }
    if (!mayManage(who, row)) { refuse(res, 403, 'Only an owner or admin, or the person who added this app, can change it or its tools.'); return undefined; }
    return run(who, row, req, res);
};

const viewOf = async (who, row) => {
    const provider = custom.providerOf(row._id);
    const manages = mayManage(who, row);
    return {
        serverId: String(row._id),
        provider,
        name: row.name,
        url: row.url,
        signIn: row.signIn,
        status: row.status,
        hosts: [...(row.hosts || [])],
        createdAt: row.createdAt || null,
        addedByMe: String(row.addedBy) === who.userId,
        mayManage: manages,
        ...(manages && row.signIn === custom.SIGN_IN.REGISTERED_APP ? { callback: callbacks.redirectUri(provider), hasApp: Boolean(row.clientId) } : {}),
        connection: await connection.describe(who.companyId, who.userId, provider),
    };
};

exports.list = handle('list the custom apps', 'Custom apps fetched.', async (who) => {
    const servers = [];
    for (const row of await custom.rowsOf(who.companyId)) {
        // eslint-disable-next-line no-await-in-loop
        servers.push(await viewOf(who, row));
    }
    return { servers, mayAdd: who.addsApps };
});

exports.add = handle('add a custom app', 'Custom app added.', async (who, req, res) => {
    if (!who.addsApps) { refuse(res, 403, aiRights.REFUSAL[aiRights.AI_RIGHT.CUSTOM_APPS]); return undefined; }
    const body = req.body || {};
    const row = await custom.add({ companyId: who.companyId, actor: who.actor, name: body.name, url: body.url });
    return { server: await viewOf(who, row) };
});

exports.update = handle('change a custom app', 'Custom app saved.', managedOrRefuse(async (who, row, req) => {
    const body = req.body || {};
    const saved = await custom.update({ companyId: who.companyId, row, actor: who.actor, name: body.name, clientId: body.clientId, clientSecret: body.clientSecret });
    return { server: await viewOf(who, saved || row) };
}));

exports.remove = handle('remove a custom app', 'Custom app removed.', managedOrRefuse((who, row) => custom.remove({ companyId: who.companyId, row, actor: who.actor })));

exports.tools = handle('list a custom app\'s tools', 'Tools fetched.', managedOrRefuse(async (who, row) => ({
    tools: await customReview.forReview({ companyId: who.companyId, row, reviewer: who.userId }),
})));

exports.reviewTool = handle('review a custom app\'s tool', 'Tool reviewed.', managedOrRefuse(async (who, row, req) => ({
    tool: await customReview.review({ companyId: who.companyId, row, reviewer: who.actor, tool: String((req.params || {}).tool || ''), body: req.body || {} }),
})));
