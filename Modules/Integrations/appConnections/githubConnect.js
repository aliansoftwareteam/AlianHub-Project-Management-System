const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../../utils/commonFunctions');
const logger = require('../../../Config/loggerConfig');
const { getRoleType, isPrivileged } = require('../../../Config/permissionGuard');
const { pinSessionTenant } = require('../../../Config/tenant');
const { recordAudit, recordAuditFromReq } = require('../../Audit/recorder');
const R = require('../helpers/integrationsRules');
const H = require('../helpers/secretHandles');
const { connectionsChanged } = require('../helpers/connectionsChanged');
const flag = require('./flag');
const oauth = require('./github/oauth');
const api = require('./github/api');

const T = SCHEMA_TYPE.INTEGRATION_CONNECTIONS;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const refuse = (res, code, statusText) => res.status(code).send({ status: false, statusText, message: statusText });

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

exports.authorize = async (req, res) => {
    try {
        const companyId = await managerOrRefuse(req, res);
        if (!companyId) return undefined;
        if (!oauth.isConfigured()) return refuse(res, 409, 'One-click GitHub needs GITHUB_CONNECT_CLIENT_ID and GITHUB_CONNECT_CLIENT_SECRET on the server.');
        const state = oauth.encodeState({ companyId, userId: req.uid, returnOrigin: oauth.returnOriginOf(req) });
        return res.send({ status: true, statusText: 'Open GitHub to connect.', data: { url: oauth.authorizeUrl(state) } });
    } catch (e) { logger.error(`appConnections github authorize: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

/* Public: GitHub's redirect carries no session, so the signed state names the company and person, and their rights are read again here. */
exports.callback = async (req, res) => {
    const { code, state, error } = req.query || {};
    const decoded = oauth.decodeState(state);
    const back = (outcome) => {
        const origin = (decoded && decoded.returnOrigin) || oauth.apiBase();
        const page = decoded ? `/${decoded.companyId}/app-connections` : '/';
        return res.redirect(`${origin}${page}?github=${outcome}`);
    };
    try {
        if (!decoded) return back('expired');
        if (!oauth.spendNonce(decoded.nonce, decoded.exp)) return back('expired');
        if (error) return back('denied');
        if (!code) return back('failed');
        const { companyId, userId } = decoded;
        if (!flag.enabled() || !oauth.isConfigured()) return back('off');
        if (!isPrivileged(await getRoleType(companyId, userId))) return back('rights');

        const { token } = await oauth.exchangeCode(code);
        const actor = { id: String(userId), ip: '' };
        const existing = await liveGithub(companyId);
        const config = { ...withoutSecrets(existing && existing.config), token, auth: 'oauth' };
        const kept = await H.storeSecrets({ companyId, type: 'github', config, existing, actor });
        let id;
        if (existing) {
            id = existing._id;
            await MongoDbCrudOpration(companyId, {
                type: T,
                data: [{ _id: existing._id }, { $set: { ...kept.set, status: 'connected', enabled: true, secretsVersion: R.SECRETS_VERSION, updatedBy: String(userId), connectedBy: String(userId) }, ...(kept.unset ? { $unset: kept.unset } : {}) }, { returnDocument: 'after' }],
            }, 'findOneAndUpdate');
            await H.retireSecrets({ companyId, handles: kept.stale, actor });
        } else {
            id = new mongoose.Types.ObjectId();
            await MongoDbCrudOpration(companyId, {
                type: T,
                data: { _id: id, type: 'github', name: 'GitHub', ...kept.set, secretsVersion: R.SECRETS_VERSION, status: 'connected', enabled: true, createdBy: String(userId), connectedBy: String(userId), connectedAt: new Date(), deletedStatusKey: 0 },
            }, 'save');
        }
        removeCache(`integration_connections:${companyId}`);
        connectionsChanged(companyId, id, { status: 'connected', enabled: true });
        recordAudit(companyId, { actorId: String(userId), action: 'app_connection.connected', entityType: 'integration', entityId: String(id), entityName: 'GitHub', meta: { via: 'oauth' } });
        return back('connected');
    } catch (e) {
        logger.error(`appConnections github callback: ${e.message}`);
        return back('failed');
    }
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
    } catch (e) { logger.error(`appConnections github repos: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

exports.setRepo = async (req, res) => {
    try {
        const companyId = await managerOrRefuse(req, res);
        if (!companyId) return undefined;
        const repo = String((req.body || {}).repo || '').trim();
        if (!R.isGithubRepo(repo)) return refuse(res, 400, 'The repository must look like owner/repo.');
        const conn = await githubOf(req, res, companyId);
        if (!conn) return undefined;
        const token = await tokenOf(companyId, conn);
        if (!token) return refuse(res, 400, 'No GitHub token is stored; connect GitHub again.');
        if (!await api.canReadRepo({ repo, token, companyId })) return refuse(res, 400, 'This GitHub connection cannot read that repository.');
        const changed = (conn.config || {}).repo !== repo;
        await MongoDbCrudOpration(companyId, {
            type: T,
            data: [{ _id: conn._id }, { $set: { config: { ...(conn.config || {}), repo }, updatedBy: String(req.uid || ''), ...(changed ? { sync: {}, connectedAt: new Date() } : {}) } }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        removeCache(`integration_connections:${companyId}`);
        connectionsChanged(companyId, conn._id, { target: repo });
        recordAuditFromReq(req, { action: 'app_connection.repo', entityType: 'integration', entityId: String(conn._id), entityName: conn.name || 'GitHub', meta: { repo } });
        return res.send({ status: true, statusText: 'Updated.', data: { id: String(conn._id), repo } });
    } catch (e) { logger.error(`appConnections github setRepo: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};
