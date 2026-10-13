const { tenantOf, TenantError } = require('../../Config/tenant');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const { ROLE_GUEST } = require('../../Config/roleTypes');
const store = require('../../Config/secrets');
const logger = require('../../Config/loggerConfig');
const { requestAddress } = require('../../utils/requestAddress');
const { buildCorsAllowList } = require('../../utils/cors');
const flag = require('../Agents/connectors/flag');
const google = require('../Agents/connectors/googleConnection');

const OBJECT_ID = /^[a-f0-9]{24}$/i;

const refuse = (res, code, statusText, extra = {}) => res.status(code).send({ status: false, statusText, ...extra });

/* The tenant is the verified header and the person is the session, never a field of the request; a token holds
 * no personal connection, and a guest or a removed member has no seat to hold one with. */
const personOrRefuse = async (req, res, { managerOnly = false } = {}) => {
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
    if (managerOnly && !isPrivileged(role)) { refuse(res, 403, 'Only an owner or admin can see or end other people\'s connections.'); return null; }
    return { companyId, userId: String(req.uid), manager: isPrivileged(role), actor: { id: String(req.uid), ip: requestAddress(req) } };
};

/* Why a connector stays off names server settings, which are an owner's or admin's business. */
const refuseOff = (res, who, problems) => (who.manager
    ? refuse(res, 409, `This connector stays off: ${problems.map((p) => p.text).join('; ')}.`, { problems: problems.map((p) => p.code) })
    : refuse(res, 409, 'This connector is not available yet. Ask an owner or admin of the workspace.'));

const connectorOrRefuse = (req, res, who) => {
    const connector = String((req.params || {}).connector || '');
    const state = google.isConnector(connector) ? flag.status(connector) : { requested: false };
    if (!state.requested) { refuse(res, 404, 'This connector is off.'); return ''; }
    if (!state.on) { refuseOff(res, who, state.problems); return ''; }
    return connector;
};

/* Only the message of an error this module made itself is sent or logged; anything else is named by its type,
 * so a provider or transport error can never carry a credential into a response or a log line. */
const failed = (res, error, what) => {
    if (error instanceof google.ConnectionError) return refuse(res, error.status, error.message, error.code ? { code: error.code } : {});
    if (error instanceof store.SecretsStoreError) return refuse(res, error.statusCode, error.message);
    logger.error(`ERROR in ${what}: ${(error && error.name) || 'Error'}`);
    return refuse(res, 500, 'Something went wrong.');
};

const handle = (what, statusText, run, options = {}) => async (req, res) => {
    try {
        const who = await personOrRefuse(req, res, options);
        if (!who) return undefined;
        const data = await run(who, req, res);
        return data === undefined ? undefined : res.send({ status: true, statusText, data });
    } catch (error) {
        return failed(res, error, what);
    }
};

const forConnector = (run) => (who, req, res) => {
    const connector = connectorOrRefuse(req, res, who);
    return connector ? run(who, connector, req, res) : undefined;
};

/* Where the browser returns after consent: the origin the request came from when the server already allows it,
 * and the configured web address otherwise. */
const originOf = (req) => {
    const value = String((req.headers || {}).origin || '').replace(/\/+$/, '');
    return /^https?:\/\//i.test(value) && buildCorsAllowList().has(value) ? value : google.fallbackOrigin();
};

const namedOrRefuse = (res) => {
    const names = flag.requestedGoogle();
    if (!names.length) refuse(res, 404, 'This connector is off.');
    return names;
};

/* The one route that answers while a connector is named but off, so the screen can say so. */
exports.mine = handle('list my Google connections', 'Connections fetched.', async (who, req, res) => {
    const names = namedOrRefuse(res);
    if (!names.length) return undefined;
    const connections = [];
    for (const connector of names) {
        const state = flag.status(connector);
        // eslint-disable-next-line no-await-in-loop
        connections.push(state.on
            ? { on: true, problems: [], ...(await google.describe(who.companyId, who.userId, connector)) }
            : { connector, on: false, problems: who.manager ? state.problems.map((p) => p.code) : [] });
    }
    return { connections };
});

exports.connect = handle('start a Google connection', 'Continue with Google.', forConnector((who, connector, req) => google.start({
    companyId: who.companyId, userId: who.userId, sessionId: req.sessionId, connector, origin: originOf(req),
})));

exports.complete = handle('complete a Google connection', 'Connected.', forConnector((who, connector, req) => {
    const body = req.body || {};
    return google.complete({ companyId: who.companyId, userId: who.userId, sessionId: req.sessionId, connector, state: body.state, code: body.code, actor: who.actor });
}));

exports.disconnect = handle('end a Google connection', 'Disconnected.', forConnector((who, connector) => google.disconnect({
    companyId: who.companyId, userId: who.userId, connector, actor: who.actor, by: google.BY.SELF,
})));

const listForManager = (who, res) => {
    const names = namedOrRefuse(res);
    if (!names.length) return undefined;
    const off = names.map((name) => flag.status(name)).filter((state) => !state.on);
    if (off.length === names.length) { refuseOff(res, who, off[0].problems); return undefined; }
    return google.membersWithConnections(who.companyId).then((connections) => ({ connections }));
};

exports.members = handle('list the members\' Google connections', 'Connections fetched.', (who, req, res) => listForManager(who, res), { managerOnly: true });

exports.disconnectMember = handle('end a member\'s Google connection', 'Disconnected.', forConnector(async (who, connector, req, res) => {
    const userId = String((req.params || {}).userId || '');
    if (!OBJECT_ID.test(userId)) throw new google.ConnectionError(400, 'That is not a member.', 'invalid_member');
    await google.disconnect({ companyId: who.companyId, userId, connector, actor: who.actor, by: google.BY.ADMIN });
    return listForManager(who, res);
}), { managerOnly: true });

/* Public: a redirect from Google carries no session. It exchanges nothing and stores no token; it sends the
 * browser back to the signed-in page, which completes the connection under its own session. */
exports.callback = async (req, res) => {
    let target;
    try {
        const query = req.query || {};
        const error = query.error === undefined || query.error === '' ? '' : (typeof query.error === 'string' ? query.error : 'provider_error');
        target = await google.returnFor({ state: query.state, code: query.code, error });
    } catch (error) {
        logger.error(`ERROR in the Google connector callback: ${(error && error.name) || 'Error'}`);
        target = { origin: google.fallbackOrigin(), path: '/', query: { connector: 'google', result: 'error', reason: 'failed' } };
    }
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    return res.redirect(302, `${target.origin}/#${target.path}?${new URLSearchParams(target.query)}`);
};
