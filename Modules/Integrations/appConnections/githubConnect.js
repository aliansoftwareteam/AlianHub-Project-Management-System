const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../../utils/commonFunctions');
const logger = require('../../../Config/loggerConfig');
const { getRoleType, isPrivileged } = require('../../../Config/permissionGuard');
const { pinSessionTenant } = require('../../../Config/tenant');
const { recordAuditFromReq } = require('../../Audit/recorder');
const { requestAddress } = require('../../../utils/requestAddress');
const R = require('../helpers/integrationsRules');
const H = require('../helpers/secretHandles');
const { connectionsChanged } = require('../helpers/connectionsChanged');
const flag = require('./flag');
const oauth = require('./github/oauth');
const api = require('./github/api');
const repoMap = require('./github/repoMap');
const { visibleProjectIds } = require('../../Agents/scope');
const { idForms } = require('../../../utils/mongo-handler/objectIdKeys');

const T = SCHEMA_TYPE.INTEGRATION_CONNECTIONS;
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const STALE = 'This GitHub sign-in is no longer valid. Click Connect again.';
const UNCONFIGURED = 'One-click GitHub needs GITHUB_CONNECT_CLIENT_ID and GITHUB_CONNECT_CLIENT_SECRET on the server.';

const refuse = (res, code, statusText) => res.status(code).send({ status: false, statusText, message: statusText });

const egressBlocked = (res, host) => res.status(409).send({
    status: false, code: api.EGRESS_BLOCKED, statusText: api.egressBlockedMessage(host), message: api.egressBlockedMessage(host), data: { host },
});

const failed = (res, e, what) => {
    logger.error(`appConnections github ${what}: ${(e && e.message) || e}`);
    const host = api.egressBlockedHost(e);
    if (host) return egressBlocked(res, host);
    return refuse(res, 500, 'Something went wrong.');
};

const managerOrRefuse = async (req, res) => {
    const companyId = pinSessionTenant(req, res);
    if (!companyId) return null;
    if (!isPrivileged(await getRoleType(companyId, req.uid))) { refuse(res, 403, 'Only an owner or admin can manage integrations.'); return null; }
    if (!flag.enabled()) { refuse(res, 404, 'App connections are not switched on.'); return null; }
    return companyId;
};

const liveGithub = (companyId, extra = {}) => MongoDbCrudOpration(companyId, { type: T, data: [{ type: 'github', deletedStatusKey: { $ne: 1 }, ...extra }] }, 'findOne');

const githubOf = async (req, res, companyId) => {
    const id = String(req.params.id || '');
    if (!OBJECT_ID.test(id)) { refuse(res, 400, 'A valid connection id is required.'); return null; }
    const conn = await liveGithub(companyId, { _id: new mongoose.Types.ObjectId(id) });
    if (!conn) { refuse(res, 404, 'Not found.'); return null; }
    return conn;
};

const tokenOf = async (companyId, conn) => (await H.openSecrets({ companyId, row: conn })).token || '';

const withoutSecrets = (config) => Object.fromEntries(Object.entries(config || {}).filter(([key]) => !R.secretKeys('github').includes(key)));

const NO_PROJECT = 'That project does not exist in this workspace.';
const NO_TOKEN = 'No GitHub token is stored; connect GitHub again.';

const liveProject = (companyId, projectId) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.PROJECTS, data: [{ _id: { $in: idForms([projectId]) }, deletedStatusKey: { $nin: [1, 2] }, isPersonal: { $ne: true } }, { _id: 1 }],
}, 'findOne');

/* Another GitHub account may not see what the earlier one did: every repository starts again from now, failures cleared. */
const restarted = (row, sameReading) => repoMap.reposOf(row).map(({ repo, projectIds, sync }) => ({
    repo, projectIds, sync: sameReading ? { ...sync, failures: 0, nextAttemptAt: null, lastError: '', errorCode: '', blockedHost: '' } : { cursor: new Date().toISOString() },
}));

const isOAuth = (row) => !!row && row.type === 'github' && (row.config || {}).auth === 'oauth';

/* Never rejects, and callers do not wait on it: ending the grant at GitHub must not hold up a reconnect or a disconnect. */
const revokeGrant = async (grant) => {
    if (!grant || !grant.token) return;
    try {
        const outcome = await oauth.revokeToken(grant.token, grant.issuer);
        if (outcome === 'skipped') logger.warn('appConnections github: the GitHub app that issued the earlier grant is no longer configured, so it was not revoked');
        else if (outcome !== 'revoked') logger.warn('appConnections github: GitHub did not revoke the earlier grant');
    } catch (e) {
        logger.warn(`appConnections github revoke: ${(e && e.message) || e}`);
    }
};

const grantOf = async (companyId, row) => {
    if (!isOAuth(row)) return null;
    try { return { token: await tokenOf(companyId, row), issuer: String((row.config || {}).clientId || '') }; } catch (e) { return null; }
};

const revokeGrantOf = async (companyId, row) => { revokeGrant(await grantOf(companyId, row)); };

exports.authorize = async (req, res) => {
    try {
        const companyId = await managerOrRefuse(req, res);
        if (!companyId) return undefined;
        if (!oauth.isConfigured()) return refuse(res, 409, UNCONFIGURED);
        const projectId = String((req.query || {}).projectId || '');
        if (projectId && (!OBJECT_ID.test(projectId) || !await liveProject(companyId, projectId))) return refuse(res, 400, NO_PROJECT);
        const signed = oauth.encodeState({ companyId, userId: req.uid, sessionId: req.sessionId, returnOrigin: oauth.returnOriginOf(req), projectId });
        return res.send({ status: true, statusText: 'Open GitHub to connect.', data: { url: oauth.authorizeUrl(signed) } });
    } catch (e) { return failed(res, e, 'authorize'); }
};

/* Public, and it exchanges nothing: it hands the code to the signed-in page in the URL fragment, which no server or referrer receives. */
exports.callback = (req, res) => {
    const query = req.query || {};
    const claims = oauth.decodeState(query.state);
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    const go = (origin, path, params) => res.redirect(302, `${origin}/#${path}?${new URLSearchParams(params)}`);
    if (!claims) return go(oauth.fallbackOrigin(), '/', { github: 'expired' });
    const origin = claims.returnOrigin || oauth.fallbackOrigin();
    const toProject = OBJECT_ID.test(String(claims.projectId || ''));
    const page = toProject ? `/${claims.companyId}/project/${claims.projectId}/p` : `/${claims.companyId}/app-connections`;
    const at = toProject ? { tab: 'ProjectDetail', section: 'github' } : {};
    if (query.error) return go(origin, page, { ...at, github: 'denied' });
    const code = oauth.usableCode(query.code);
    if (!code) return go(origin, page, { ...at, github: 'failed' });
    return go(origin, page, { ...at, github: 'complete', state: query.state, code });
};

/* Only the person who started the sign-in, in the same session and workspace, and still an owner or admin, completes it. */
exports.complete = async (req, res) => {
    try {
        const companyId = await managerOrRefuse(req, res);
        if (!companyId) return undefined;
        if (!oauth.isConfigured()) return refuse(res, 409, UNCONFIGURED);
        const body = req.body || {};
        const claims = oauth.decodeState(body.state);
        const code = oauth.usableCode(body.code);
        if (!claims || claims.companyId !== String(companyId) || claims.userId !== String(req.uid) || !oauth.sessionMatches(claims, req.sessionId) || !code) return refuse(res, 400, STALE);
        if (!oauth.spendNonce(claims.nonce, claims.exp)) return refuse(res, 400, STALE);
        const verifier = oauth.verifierOf(claims);
        if (!verifier) return refuse(res, 400, STALE);

        let token;
        try {
            ({ token } = await oauth.exchangeCode({ code, verifier }));
        } catch (e) {
            logger.error(`appConnections github exchange: ${(e && e.message) || e}`);
            return refuse(res, 400, STALE);
        }
        let blockedHost = '';
        const account = await api.accountOf({ token, companyId }).catch((e) => {
            blockedHost = api.egressBlockedHost(e);
            return { id: '', login: '' };
        });
        const existing = await liveGithub(companyId);
        const before = (existing && existing.config) || {};
        const earlier = await grantOf(companyId, existing);
        let repo = before.repo || '';
        if (repo && !await api.canReadRepo({ repo, token, companyId }).catch(() => true)) repo = '';
        const sameReading = !!existing && !!account.id && before.accountId === account.id && repo === (before.repo || '');

        const config = { ...withoutSecrets(before), token, auth: 'oauth', clientId: oauth.clientId(), accountId: account.id, accountLogin: account.login };
        if (repo) config.repo = repo; else delete config.repo;
        const uid = String(req.uid || '');
        const actor = { id: uid, ip: requestAddress(req) };
        const kept = await H.storeSecrets({ companyId, type: 'github', config, existing, actor });
        let id;
        if (existing) {
            id = existing._id;
            const sync = sameReading ? { ...(existing.sync || {}), failures: 0, nextAttemptAt: null, lastError: '', errorCode: '', blockedHost: '' } : {};
            const repos = repoMap.isMapped(existing) ? { repos: restarted(existing, sameReading) } : {};
            await MongoDbCrudOpration(companyId, {
                type: T,
                data: [{ _id: existing._id }, { $set: { ...kept.set, ...repos, status: 'connected', enabled: true, secretsVersion: R.SECRETS_VERSION, updatedBy: uid, connectedBy: uid, sync, ...(sameReading ? {} : { connectedAt: new Date() }) }, ...(kept.unset ? { $unset: kept.unset } : {}) }, { returnDocument: 'after' }],
            }, 'findOneAndUpdate');
            await H.retireSecrets({ companyId, handles: kept.stale, actor });
        } else {
            id = new mongoose.Types.ObjectId();
            await MongoDbCrudOpration(companyId, {
                type: T,
                data: { _id: id, type: 'github', name: 'GitHub', ...kept.set, secretsVersion: R.SECRETS_VERSION, status: 'connected', enabled: true, createdBy: uid, connectedBy: uid, connectedAt: new Date(), deletedStatusKey: 0 },
            }, 'save');
        }
        if (earlier && earlier.token !== token) revokeGrant(earlier);
        removeCache(`integration_connections:${companyId}`);
        connectionsChanged(companyId, id, { status: 'connected', enabled: true });
        recordAuditFromReq(req, { action: 'app_connection.connected', entityType: 'integration', entityId: String(id), entityName: 'GitHub', meta: { via: 'oauth' } });
        return res.send({ status: true, statusText: 'Connected.', data: { id: String(id), repo, account: account.login, ...(blockedHost ? { egressBlocked: { host: blockedHost } } : {}) } });
    } catch (e) { return failed(res, e, 'complete'); }
};

exports.repos = async (req, res) => {
    try {
        const companyId = await managerOrRefuse(req, res);
        if (!companyId) return undefined;
        const conn = await githubOf(req, res, companyId);
        if (!conn) return undefined;
        const token = await tokenOf(companyId, conn);
        if (!token) return refuse(res, 400, 'No GitHub token is stored; connect GitHub again.');
        const data = await api.listRepos({ token, companyId, page: (req.query || {}).page });
        return res.send({ status: true, statusText: 'Repositories.', data });
    } catch (e) { return failed(res, e, 'repos'); }
};

const mappingChanged = async (req, companyId, conn, entries, action, meta) => {
    const update = repoMap.mappingUpdate(entries);
    update.$set.updatedBy = String(req.uid || '');
    await MongoDbCrudOpration(companyId, { type: T, data: [{ _id: conn._id }, update, { returnDocument: 'after' }] }, 'findOneAndUpdate');
    removeCache(`integration_connections:${companyId}`);
    connectionsChanged(companyId, conn._id, { repos: entries.length });
    recordAuditFromReq(req, { action, entityType: 'integration', entityId: String(conn._id), entityName: conn.name || 'GitHub', meta });
};

const connectorOf = (conn) => String(conn.connectedBy || conn.createdBy || '');

/* The sync reads as the person who connected GitHub, so a project they cannot open would never be fed. */
exports.addRepo = async (req, res) => {
    try {
        const companyId = await managerOrRefuse(req, res);
        if (!companyId) return undefined;
        const body = req.body || {};
        const repo = String(body.repo || '').trim();
        const projectId = String(body.projectId || '');
        if (!repoMap.isRepo(repo)) return refuse(res, 400, 'The repository must look like owner/repo.');
        if (!OBJECT_ID.test(projectId)) return refuse(res, 400, 'A valid project id is required.');
        const conn = await githubOf(req, res, companyId);
        if (!conn) return undefined;
        if (!await liveProject(companyId, projectId)) return refuse(res, 400, NO_PROJECT);
        const connector = connectorOf(conn);
        if (!connector || !(await visibleProjectIds(companyId, connector)).map(String).includes(projectId)) {
            return refuse(res, 400, 'The person who connected GitHub cannot open that project, so it would never be fed.');
        }
        const token = await tokenOf(companyId, conn);
        if (!token) return refuse(res, 400, NO_TOKEN);
        if (!await api.canReadRepo({ repo, token, companyId })) return refuse(res, 400, 'This GitHub connection cannot read that repository.');
        const { entries, changed } = repoMap.withProject(conn, repo, projectId, new Date().toISOString());
        if (changed) await mappingChanged(req, companyId, conn, entries, 'app_connection.repo_added', { repo, projectId });
        return res.send({ status: true, statusText: changed ? 'Added.' : 'Already linked.', data: { id: String(conn._id), repo, projectId } });
    } catch (e) { return failed(res, e, 'addRepo'); }
};

exports.removeRepo = async (req, res) => {
    try {
        const companyId = await managerOrRefuse(req, res);
        if (!companyId) return undefined;
        const repo = String((req.query || {}).repo || '').trim();
        const projectId = String((req.params || {}).projectId || '');
        if (!repoMap.isRepo(repo)) return refuse(res, 400, 'The repository must look like owner/repo.');
        if (!OBJECT_ID.test(projectId)) return refuse(res, 400, 'A valid project id is required.');
        const conn = await githubOf(req, res, companyId);
        if (!conn) return undefined;
        const { entries, changed } = repoMap.withoutProject(conn, repo, projectId);
        if (!changed) return refuse(res, 404, 'That repository is not linked to this project.');
        await mappingChanged(req, companyId, conn, entries, 'app_connection.repo_removed', { repo, projectId });
        return res.send({ status: true, statusText: 'Removed.', data: { id: String(conn._id), repo, projectId } });
    } catch (e) { return failed(res, e, 'removeRepo'); }
};

const repoRow = ({ repo, sync }) => ({
    repo, lastSyncAt: sync.lastSyncAt || null, lastError: sync.lastError || '', errorCode: sync.errorCode || '', blockedHost: sync.blockedHost || '',
});

/* Anyone who can open the project sees which repositories feed it; only an owner or admin is offered the changes. */
exports.projectView = async (req, res) => {
    try {
        const companyId = pinSessionTenant(req, res);
        if (!companyId) return undefined;
        if (!flag.enabled()) return res.send({ status: true, data: { enabled: false } });
        const projectId = String((req.params || {}).projectId || '');
        if (!OBJECT_ID.test(projectId)) return refuse(res, 400, 'A valid project id is required.');
        const [visible, roleType, conn] = await Promise.all([visibleProjectIds(companyId, req.uid), getRoleType(companyId, req.uid), liveGithub(companyId)]);
        if (!(visible || []).map(String).includes(projectId)) return refuse(res, 404, 'Not found.');
        const canManage = isPrivileged(roleType);
        const sync = (conn && conn.sync) || {};
        const connector = conn ? connectorOf(conn) : '';
        const reachable = !!conn && !!connector && (await visibleProjectIds(companyId, connector)).map(String).includes(projectId);
        return res.send({
            status: true,
            data: {
                enabled: true, canManage, oneClick: oauth.isConfigured(),
                connection: conn ? {
                    id: String(conn._id), enabled: conn.enabled !== false, viaOAuth: isOAuth(conn), account: (conn.config || {}).accountLogin || '', reachable,
                    errorCode: sync.errorCode || '', blockedHost: sync.blockedHost || '',
                } : null,
                repos: conn ? repoMap.reposOfProject(conn, projectId).map(repoRow) : [],
            },
        });
    } catch (e) { return failed(res, e, 'projectView'); }
};

exports.grantOf = grantOf;
exports.revokeGrant = revokeGrant;
exports.revokeGrantOf = revokeGrantOf;
