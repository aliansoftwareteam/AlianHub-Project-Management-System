const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { idForms } = require('../../../utils/mongo-handler/objectIdKeys');
const { removeCache } = require('../../../utils/commonFunctions');
const logger = require('../../../Config/loggerConfig');
const { getRoleType, isPrivileged } = require('../../../Config/permissionGuard');
const { pinSessionTenant } = require('../../../Config/tenant');
const { recordAuditFromReq } = require('../../Audit/recorder');
const { visibleProjects } = require('../../Agents/scope');
const R = require('../helpers/integrationsRules');
const flag = require('./flag');
const githubOAuth = require('./github/oauth');
const registry = require('./registry');
const { connectionsChanged } = require('../helpers/connectionsChanged');
const repoMap = require('./github/repoMap');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const PROJECTS_MAX = 100;
const T = SCHEMA_TYPE.INTEGRATION_CONNECTIONS;

const refuse = (res, code, statusText) => res.status(code).send({ status: false, statusText, message: statusText });

const targetOf = (row) => { const c = row.config || {}; return c.repo || c.project || c.default_channel || ''; };

/* A linked project the viewer cannot open is never named. An admin is told its id, so a save keeps the link; anyone else only how many. */
const linkedProjects = (row, names, privileged) => {
    const ids = row.type === 'github' ? repoMap.mappedProjectIds(row) : (row.projectIds || []).map(String);
    const shown = ids.filter((id) => names.has(id)).map((id) => ({ id, name: names.get(id) }));
    const unseen = ids.filter((id) => !names.has(id));
    return {
        projects: privileged ? [...shown, ...unseen.map((id) => ({ id, name: '', hidden: true }))] : shown,
        hiddenProjects: unseen.length,
    };
};

/* The Project → Repository table: one row per pair, a project the viewer cannot open shown to an admin by id alone. */
const repoRows = (row, names, privileged) => repoMap.reposOf(row).flatMap(({ repo, projectIds, sync }) => projectIds
    .filter((id) => privileged || names.has(id))
    .map((id) => ({
        repo, projectId: id, projectName: names.get(id) || '', hidden: !names.has(id),
        lastSyncAt: sync.lastSyncAt || null, lastError: sync.lastError || '', errorCode: sync.errorCode || '', blockedHost: sync.blockedHost || '',
    })));

const connectionRow = (row, names, privileged) => {
    const sync = row.sync || {};
    return {
        id: String(row._id), name: row.name, enabled: row.enabled !== false, status: row.status, target: targetOf(row),
        connectedAt: row.connectedAt || null, secrets: R.redact(row).secrets, viaOAuth: (row.config || {}).auth === 'oauth',
        lastSyncAt: sync.lastSyncAt || null, lastError: sync.lastError || '', errorCode: sync.errorCode || '', blockedHost: sync.blockedHost || '', failures: Number(sync.failures) || 0, nextAttemptAt: sync.nextAttemptAt || null,
        ...linkedProjects(row, names, privileged),
        ...(row.type === 'github' ? { repos: repoRows(row, names, privileged) } : {}),
    };
};

const githubSetup = () => ({ homepageUrl: githubOAuth.fallbackOrigin(), callbackUrl: githubOAuth.redirectUri() });

exports.hub = async (req, res) => {
    try {
        const companyId = pinSessionTenant(req, res);
        if (!companyId) return undefined;
        if (!flag.enabled()) return res.send({ status: true, data: { enabled: false, canManage: false, apps: [], projects: [] } });
        const [rows, projects, roleType] = await Promise.all([
            MongoDbCrudOpration(companyId, { type: T, data: [{ deletedStatusKey: { $ne: 1 } }, {}, { sort: { updatedAt: -1 } }] }, 'find'),
            visibleProjects(companyId, req.uid),
            getRoleType(companyId, req.uid),
        ]);
        const privileged = isPrivileged(roleType);
        const names = new Map((projects || []).map((p) => [String(p._id), p.ProjectName || '']));
        const githubReady = githubOAuth.isConfigured();
        const apps = R.getCatalog().map((item) => ({
            key: item.key, name: item.name, category: item.category, icon: item.icon, description: item.description, multiple: item.multiple, fields: item.fields,
            syncs: !!registry.get(item.key), oneClick: item.key === 'github' && githubReady,
            ...(item.key === 'github' && !githubReady && privileged ? { setup: githubSetup() } : {}),
            connections: (rows || []).filter((r) => r.type === item.key).map((r) => connectionRow(r, names, privileged)),
        }));
        return res.send({ status: true, data: { enabled: true, canManage: privileged, apps, projects: (projects || []).map((p) => ({ id: String(p._id), name: p.ProjectName || '' })) } });
    } catch (e) { logger.error(`appConnections hub: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

exports.setProjects = async (req, res) => {
    try {
        const companyId = pinSessionTenant(req, res);
        if (!companyId) return undefined;
        if (!isPrivileged(await getRoleType(companyId, req.uid))) return refuse(res, 403, 'Only an owner or admin can manage integrations.');
        if (!flag.enabled()) return refuse(res, 404, 'App connections are not switched on.');
        const id = String(req.params.id || '');
        if (!OBJECT_ID.test(id)) return refuse(res, 400, 'A valid connection id is required.');
        const given = (req.body || {}).projectIds;
        if (!Array.isArray(given) || given.length > PROJECTS_MAX || !given.every((p) => typeof p === 'string' && OBJECT_ID.test(p))) {
            return refuse(res, 400, `projectIds is a list of at most ${PROJECTS_MAX} project ids.`);
        }
        const ids = [...new Set(given)];
        const conn = await MongoDbCrudOpration(companyId, { type: T, data: [{ _id: new mongoose.Types.ObjectId(id), deletedStatusKey: { $ne: 1 } }] }, 'findOne');
        if (!conn) return refuse(res, 404, 'Not found.');
        if (!registry.get(conn.type)) return refuse(res, 400, 'This app does not link to projects.');
        if (repoMap.isMapped(conn)) return refuse(res, 400, 'Each project picks its own repositories; add or remove them per repository.');
        const found = ids.length ? await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PROJECTS, data: [{ _id: { $in: idForms(ids) }, deletedStatusKey: { $nin: [1, 2] }, isPersonal: { $ne: true } }, { _id: 1 }],
        }, 'find') : [];
        const valid = new Set((found || []).map((p) => String(p._id)));
        if (ids.some((p) => !valid.has(p))) return refuse(res, 400, 'One of the projects does not exist in this workspace.');
        const updated = await MongoDbCrudOpration(companyId, {
            type: T, data: [{ _id: conn._id }, { $set: { projectIds: ids, updatedBy: String(req.uid || '') } }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        removeCache(`integration_connections:${companyId}`);
        connectionsChanged(companyId, id, { projectIds: ids });
        recordAuditFromReq(req, { action: 'app_connection.projects', entityType: 'integration', entityId: id, entityName: conn.name || conn.type, meta: { projects: ids.length } });
        return res.send({ status: true, statusText: 'Updated.', data: { id, projectIds: (updated.projectIds || []).map(String) } });
    } catch (e) { logger.error(`appConnections setProjects: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};
